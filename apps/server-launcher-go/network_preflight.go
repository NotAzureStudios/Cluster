package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Native preflight is intentionally policy-only. It does not modify firewall
// rules, bind public interfaces, or perform remote network requests.
type nativeNetworkPlan struct {
	WebHost             string
	WebPort             int
	PublicAPIPort       int
	PrivatePostgresPort int
}

func networkPort(value any, fallback int, label string) (int, error) {
	if value == nil {
		return fallback, nil
	}
	switch v := value.(type) {
	case int:
		if v >= 1 && v <= 65535 {
			return v, nil
		}
	case int64:
		if v >= 1 && v <= 65535 {
			return int(v), nil
		}
	case float64:
		if v >= 1 && v <= 65535 && v == float64(int(v)) {
			return int(v), nil
		}
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil && n >= 1 && n <= 65535 {
			return n, nil
		}
	}
	return 0, fmt.Errorf("%s must be a TCP port between 1 and 65535", label)
}

func parseNativeNetwork(settings map[string]any) (nativeNetworkPlan, error) {
	out := nativeNetworkPlan{WebHost: "127.0.0.1", WebPort: 3000, PublicAPIPort: 4000, PrivatePostgresPort: 54321}
	if raw, ok := settings["webHost"]; ok {
		host, ok := raw.(string)
		if !ok {
			return out, fmt.Errorf("webHost must be a string")
		}
		host = strings.TrimSpace(host)
		if host == "" || strings.EqualFold(host, "localhost") {
			host = "127.0.0.1"
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return out, fmt.Errorf("webHost must be localhost or an IP address (not a URL or hostname)")
		}
		out.WebHost = ip.String()
	}
	var err error
	if out.WebPort, err = networkPort(settings["webPort"], 3000, "webPort"); err != nil {
		return out, err
	}
	if out.PublicAPIPort, err = networkPort(settings["serverPort"], 4000, "serverPort"); err != nil {
		return out, err
	}
	if out.WebPort == out.PublicAPIPort {
		return out, fmt.Errorf("webPort and serverPort must not use the same TCP port")
	}
	if out.WebPort == out.PrivatePostgresPort || out.PublicAPIPort == out.PrivatePostgresPort {
		return out, fmt.Errorf("public listeners must not overlap the private PostgreSQL port %d", out.PrivatePostgresPort)
	}
	for _, key := range []string{"publicWebUrl", "publicApiUrl"} {
		raw, ok := settings[key]
		if !ok {
			continue
		}
		value, ok := raw.(string)
		if !ok {
			return out, fmt.Errorf("%s must be a URL string", key)
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" {
			return out, fmt.Errorf("%s must be a complete HTTP(S) URL without credentials or fragments", key)
		}
	}
	return out, nil
}

// This probes only local listener acquisition, never a remote website.
// Successful preflight is a point-in-time observation: Host binds again and
// fails closed if another process takes the port after this check.
func checkNativeNetworkListeners(plan nativeNetworkPlan) error {
	for _, item := range []struct {
		name, host string
		port       int
	}{
		{"Cluster web", plan.WebHost, plan.WebPort},
		{"private PostgreSQL", "127.0.0.1", plan.PrivatePostgresPort},
	} {
		l, err := net.Listen("tcp", net.JoinHostPort(item.host, strconv.Itoa(item.port)))
		if err != nil {
			return fmt.Errorf("%s listener %s:%d is unavailable; check port ownership before starting service: %w", item.name, item.host, item.port, err)
		}
		_ = l.Close()
	}
	return nil
}

// probeNativeReadiness verifies the server's own configured listener, not a
// user-chosen URL. No redirects, credentials, response bodies or TLS bypasses.
func probeNativeReadiness(plan nativeNetworkPlan, secure bool) string {
	host := plan.WebHost
	if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
		host = "127.0.0.1"
	}
	scheme := "http"
	if secure {
		scheme = "https"
	}
	target := scheme + "://" + net.JoinHostPort(host, strconv.Itoa(plan.WebPort)) + "/health/ready"
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return "Readiness unknown: invalid local endpoint"
	}
	client := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return "Application readiness unreachable (inspect API/TLS logs)"
	}
	_ = response.Body.Close()
	if response.StatusCode == http.StatusOK {
		return "Application readiness verified"
	}
	return fmt.Sprintf("Application degraded: readiness returned HTTP %d", response.StatusCode)
}

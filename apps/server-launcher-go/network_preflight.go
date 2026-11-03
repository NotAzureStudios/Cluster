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
	PublicWebOrigin     string
	AllowInsecureLANHTTP bool
	TLSCertFile          string
	TLSKeyFile           string
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
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || (parsed.Path != "" && parsed.Path != "/") {
			return out, fmt.Errorf("%s must be an HTTP(S) origin without credentials, paths, queries or fragments", key)
		}
		if key == "publicWebUrl" {
			out.PublicWebOrigin = strings.TrimSuffix(parsed.String(), "/")
		}
	}
	if value, exists := settings["allowInsecureLanHttp"]; exists {
		allowed, valid := value.(bool)
		if !valid { return out, fmt.Errorf("allowInsecureLanHttp must be a boolean") }
		out.AllowInsecureLANHTTP = allowed
	}
	if value, exists := settings["webTlsCertFile"]; exists {
		cert, valid := value.(string)
		if !valid { return out, fmt.Errorf("webTlsCertFile must be a file path") }
		out.TLSCertFile = strings.TrimSpace(cert)
	}
	if value, exists := settings["webTlsKeyFile"]; exists {
		key, valid := value.(string)
		if !valid { return out, fmt.Errorf("webTlsKeyFile must be a file path") }
		out.TLSKeyFile = strings.TrimSpace(key)
	}
	if (out.TLSCertFile == "") != (out.TLSKeyFile == "") {
		return out, fmt.Errorf("direct HTTPS needs both a TLS certificate and private key file")
	}
	if out.AllowInsecureLANHTTP && out.TLSCertFile != "" {
		return out, fmt.Errorf("choose direct TLS or explicitly approved insecure LAN HTTP, not both")
	}
	webIP := net.ParseIP(out.WebHost)
	if webIP != nil && !webIP.IsLoopback() {
		if out.PublicWebOrigin == "" {
			return out, fmt.Errorf("a non-loopback gateway must have a member-facing publicWebUrl")
		}
		origin, _ := url.Parse(out.PublicWebOrigin)
		if out.AllowInsecureLANHTTP {
			if !webIP.IsPrivate() || webIP.IsUnspecified() {
				return out, fmt.Errorf("insecure LAN HTTP is allowed only on an explicit private interface, never a wildcard or public address")
			}
			if origin.Scheme != "http" {
				return out, fmt.Errorf("insecure LAN HTTP requires an HTTP origin; HTTPS must terminate in a trusted gateway or use direct TLS")
			}
		} else if out.TLSCertFile == "" {
			return out, fmt.Errorf("a non-loopback gateway requires TLS certificate files or explicit private-LAN HTTP acknowledgement")
		}
		if out.TLSCertFile != "" && origin.Scheme != "https" {
			return out, fmt.Errorf("direct TLS requires an HTTPS publicWebUrl")
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

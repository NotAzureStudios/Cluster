package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func resolveRoot(value string) (string, error) {
	candidate := strings.TrimSpace(value)
	if candidate == "" {
		candidate = strings.TrimSpace(os.Getenv("CLUSTER_ROOT"))
	}
	if candidate == "" {
		if executable, err := os.Executable(); err == nil {
			fromBinary := filepath.Dir(filepath.Dir(executable))
			if fileExists(filepath.Join(fromBinary, "package.json")) {
				candidate = fromBinary
			}
		}
	}
	if candidate == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		candidate = cwd
	}
	absolute, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	if !fileExists(filepath.Join(absolute, "package.json")) {
		return "", fmt.Errorf("%s is not a Cluster workspace", absolute)
	}
	return absolute, nil
}

func clampPort(value, fallback int) int {
	if value < 1 || value > 65535 {
		return fallback
	}
	return value
}

func listenPreferred(bindAddress string, port int) (net.Listener, error) {
	listener, err := net.Listen("tcp", net.JoinHostPort(bindAddress, strconv.Itoa(port)))
	if err == nil {
		return listener, nil
	}
	log.Printf("Port %d is in use on %s; selecting an available port.", port, bindAddress)
	return net.Listen("tcp", net.JoinHostPort(bindAddress, "0"))
}

// Explicitly managed listeners must fail at the requested port. Selecting a
// random free port breaks TLS routing, firewall rules, operator expectations
// and native readiness checks.
func listenConfigured(bindAddress string, port int, strict bool) (net.Listener, error) {
	if !strict {
		return listenPreferred(bindAddress, port)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bindAddress, strconv.Itoa(port)))
	if err != nil {
		return nil, fmt.Errorf("configured web listener %s:%d is unavailable; correct the port conflict (automatic fallback disabled): %w", bindAddress, port, err)
	}
	return listener, nil
}

func availableConfiguredPort(port int, strict bool) (int, error) {
	if strict && (port < 1 || port > 65535) {
		return 0, fmt.Errorf("configured private API port must be between 1 and 65535")
	}
	if !strict {
		return availablePort(port)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return 0, fmt.Errorf("configured private API port 127.0.0.1:%d is unavailable (automatic fallback disabled): %w", port, err)
	}
	_ = listener.Close()
	return port, nil
}

func environmentOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func environmentBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func environmentInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func normalizeBindAddress(value string) (string, error) {
	candidate := strings.TrimSpace(value)
	if candidate == "" || strings.EqualFold(candidate, "localhost") {
		return "127.0.0.1", nil
	}
	if strings.Contains(candidate, "://") || strings.ContainsAny(candidate, "/\\") {
		return "", fmt.Errorf("bind address must be an IP address, not a URL")
	}
	ip := net.ParseIP(candidate)
	if ip == nil {
		return "", fmt.Errorf("unsupported bind address %q", candidate)
	}
	return ip.String(), nil
}

func isLoopbackBind(value string) bool {
	ip := net.ParseIP(value)
	return ip != nil && ip.IsLoopback()
}

func isLocalOnlyHostname(value string) bool {
	hostname := strings.Trim(strings.TrimSpace(value), "[]")
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

func resolveTLSFiles(certValue, keyValue string) (string, string, bool, error) {
	certValue = strings.TrimSpace(certValue)
	keyValue = strings.TrimSpace(keyValue)
	if certValue == "" && keyValue == "" {
		return "", "", false, nil
	}
	if certValue == "" || keyValue == "" {
		return "", "", false, fmt.Errorf("both TLS certificate and private key files are required")
	}
	certFile, err := filepath.Abs(certValue)
	if err != nil {
		return "", "", false, err
	}
	keyFile, err := filepath.Abs(keyValue)
	if err != nil {
		return "", "", false, err
	}
	if !fileExists(certFile) {
		return "", "", false, fmt.Errorf("TLS certificate is missing at %s", certFile)
	}
	if !fileExists(keyFile) {
		return "", "", false, fmt.Errorf("TLS private key is missing at %s", keyFile)
	}
	if _, err := tls.LoadX509KeyPair(certFile, keyFile); err != nil {
		return "", "", false, fmt.Errorf("TLS certificate and private key could not be loaded: %w", err)
	}
	return certFile, keyFile, true, nil
}

func resolvePublicOrigin(value, bindAddress string, port int, scheme string, remote bool) (string, error) {
	candidate := strings.TrimSpace(value)
	if candidate == "" {
		if remote {
			return "", fmt.Errorf("remote access requires --public-origin so redirects and share links use the reachable server URL")
		}
		return originForBind(bindAddress, port, scheme), nil
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Hostname() == "" {
		return "", fmt.Errorf("public origin must be an absolute HTTP or HTTPS URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("public origin must use http or https")
	}
	if parsed.Scheme != scheme {
		return "", fmt.Errorf("public origin scheme %s does not match the host transport %s", parsed.Scheme, scheme)
	}
	if remote && isLocalOnlyHostname(parsed.Hostname()) {
		return "", fmt.Errorf("remote public origin must not resolve to a loopback or unspecified host")
	}
	if parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("public origin must not contain credentials, a path, query, or fragment")
	}
	if parsed.Port() == "" && !((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) {
		parsed.Host = net.JoinHostPort(parsed.Hostname(), strconv.Itoa(port))
	}
	// A persisted older local public-origin setting may still name 127.0.0.1.
	// Canonicalize only loopback IP literals, never a network/LAN address.
	// Remote origin and transport validation above remain authoritative.
	if !remote && isLoopbackBind(bindAddress) && net.ParseIP(parsed.Hostname()) != nil && isLocalOnlyHostname(parsed.Hostname()) {
		parsed.Host = net.JoinHostPort("localhost", strconv.Itoa(port))
	}
	parsed.Path = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func originForBind(bindAddress string, port int, scheme string) string {
	// Browser WebAuthn refuses an IP literal as a relying-party ID. Keep the
	// network listener on 127.0.0.1, but expose the local browser UI at the
	// registrable, trustworthy loopback hostname "localhost" instead.
	host := "localhost"
	if scheme != "https" {
		scheme = "http"
	}
	return scheme + "://" + net.JoinHostPort(host, strconv.Itoa(port))
}

func networkOrigins(port int, scheme string) []string {
	interfaces, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	if scheme != "https" {
		scheme = "http"
	}
	seen := map[string]struct{}{}
	origins := []string{}
	for _, address := range interfaces {
		var ip net.IP
		switch value := address.(type) {
		case *net.IPNet:
			ip = value.IP
		case *net.IPAddr:
			ip = value.IP
		}
		if ip == nil || ip.IsLoopback() || ip.IsUnspecified() || !ip.IsPrivate() {
			continue
		}
		origin := scheme + "://" + net.JoinHostPort(ip.String(), strconv.Itoa(port))
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins
}

func availablePort(preferred int) (int, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferred))
	if err != nil {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return 0, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	return port, nil
}

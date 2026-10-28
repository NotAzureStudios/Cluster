package main

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (h *host) handler(target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalHost := request.Host
		request.Header.Del("Forwarded")
		request.Header.Del("X-Forwarded-For")
		request.Header.Del("X-Forwarded-Host")
		request.Header.Del("X-Forwarded-Proto")
		request.Header.Del("X-Real-IP")
		director(request)
		request.Host = target.Host
		request.Header.Set("X-Forwarded-Host", originalHost)
		request.Header.Set("X-Forwarded-Proto", h.scheme)
		if request.Header.Get("Origin") != "" {
			request.Header.Set("Origin", h.origin)
		}
		request.Header.Set("X-Cluster-Host", version)
		request.Header.Set("X-Cluster-Runtime-Profile", "managed-host")
		request.Header.Set("X-Cluster-Host-Secure", map[bool]string{true: "true", false: "false"}[h.secure])
	}
	proxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, _ error) {
		if h.apiRestarting.Load() {
			response.Header().Set("Retry-After", "2")
			writeJSON(response, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "Cluster API is restarting.", "code": "API_RESTARTING", "retryable": true})
			return
		}
		writeJSON(response, http.StatusBadGateway, map[string]any{"ok": false, "error": "Cluster API is unavailable.", "code": "API_UNAVAILABLE", "retryable": true})
	}
	webRoot := filepath.Join(h.root, "apps", "web", "dist")
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !h.hostAllowed(request.Host) {
			writeJSON(response, http.StatusMisdirectedRequest, map[string]any{"ok": false, "error": "Cluster rejected an unexpected Host header.", "code": "HOST_NOT_ALLOWED"})
			return
		}
		if !sameOriginRequest(request) {
			writeJSON(response, http.StatusForbidden, map[string]any{"ok": false, "error": "Cross-origin Cluster Host requests are not allowed.", "code": "ORIGIN_NOT_ALLOWED"})
			return
		}
		// Old bookmarks using http://127.0.0.1 need to reach localhost
		// before the browser requests a passkey registration challenge.
		// Redirect only safe navigation methods, never credentials or writes.
		canonical, _ := url.Parse(h.origin)
		incoming, _ := url.Parse("//" + request.Host)
		if !h.remoteAccess && canonical != nil && incoming != nil &&
			!strings.EqualFold(incoming.Hostname(), canonical.Hostname()) &&
			request.URL.Path != "/host/health" {
			if request.Method == http.MethodGet || request.Method == http.MethodHead {
				response.Header().Set("Cache-Control", "no-store")
				http.Redirect(response, request, h.origin+request.URL.RequestURI(), http.StatusTemporaryRedirect)
			} else {
				writeJSON(response, http.StatusMisdirectedRequest, map[string]any{"ok": false, "code": "CANONICAL_HOST_REQUIRED", "error": "Open Cluster using its canonical localhost browser address before submitting requests."})
			}
			return
		}
		pathValue := request.URL.Path
		switch {
		case pathValue == "/host/health":
			if request.Method != http.MethodGet && request.Method != http.MethodHead {
				response.Header().Set("Allow", "GET, HEAD")
				writeJSON(response, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed.", "code": "METHOD_NOT_ALLOWED"})
				return
			}
			writeJSON(response, http.StatusOK, map[string]any{
				"ok": true, "version": version, "runtime": "go", "runtimeProfile": "managed-host",
				"architecture": "go-gateway-node-api", "origin": h.origin, "apiOrigin": h.apiOrigin,
				"bindAddress": h.bindAddress, "webPort": h.webPort, "remoteAccess": h.remoteAccess,
				"scheme": h.scheme, "secure": h.secure, "apiRestarting": h.apiRestarting.Load(),
				"apiRestarts": h.apiRestartCount.Load(), "apiRestartLimit": h.apiRestartLimit,
				"uptimeMs": time.Since(h.startedAt).Milliseconds(),
			})
		case strings.HasPrefix(pathValue, "/health") || strings.HasPrefix(pathValue, "/api/") || pathValue == "/.well-known/security.txt" || pathValue == "/security.txt":
			proxy.ServeHTTP(response, request)
		default:
			if request.Method != http.MethodGet && request.Method != http.MethodHead {
				response.Header().Set("Allow", "GET, HEAD")
				writeJSON(response, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Static Cluster routes accept GET or HEAD only.", "code": "METHOD_NOT_ALLOWED"})
				return
			}
			serveWeb(response, request, webRoot, h.secure)
		}
	})
}

func serveWeb(response http.ResponseWriter, request *http.Request, root string, secure bool) {
	applyWebSecurityHeaders(response, secure)
	indexPath := filepath.Join(root, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.WriteHeader(http.StatusServiceUnavailable)
		_, _ = response.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cluster web client unavailable</title><style>body{margin:0;background:#101316;color:#e8edf2;font:15px system-ui;display:grid;min-height:100vh;place-items:center}.panel{max-width:620px;margin:24px;padding:28px;border:1px solid #303842;border-radius:18px;background:rgba(28,33,39,.9);box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{font-size:22px;margin:0 0 10px}p{line-height:1.55;color:#b9c2cc}code{color:#fff;background:#242a31;padding:3px 7px;border-radius:6px}</style></head><body><main class="panel"><h1>Cluster server is running</h1><p>The browser client has not been built yet. Run <code>npm run build:web</code> or choose <strong>Build / update web client</strong> from the Cluster Server menu.</p><p>The API remains available, so desktop and administrative recovery work can continue without the web build blocking the server.</p></main></body></html>`))
		return
	}
	cleaned := filepath.Clean(strings.TrimPrefix(request.URL.Path, "/"))
	if cleaned == "." || cleaned == "" {
		cleaned = "index.html"
	}
	candidate := filepath.Join(root, cleaned)
	relative, err := filepath.Rel(root, candidate)
	if err != nil || strings.HasPrefix(relative, "..") || filepath.IsAbs(relative) {
		http.Error(response, "Invalid path.", http.StatusBadRequest)
		return
	}
	if info, err := os.Stat(candidate); err != nil || info.IsDir() {
		candidate = filepath.Join(root, "index.html")
	}
	baseName := filepath.Base(candidate)
	if strings.HasSuffix(candidate, "index.html") {
		response.Header().Set("Cache-Control", "no-store")
	} else if baseName == "cluster-sw.js" || baseName == "manifest.webmanifest" {
		response.Header().Set("Cache-Control", "no-cache, max-age=0, must-revalidate")
	} else {
		response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	if value := mime.TypeByExtension(filepath.Ext(candidate)); value != "" {
		response.Header().Set("Content-Type", value)
	}
	http.ServeFile(response, request, candidate)
}

func applyWebSecurityHeaders(response http.ResponseWriter, secure bool) {
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("X-Frame-Options", "DENY")
	response.Header().Set("Referrer-Policy", "no-referrer")
	response.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()")
	response.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	response.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	response.Header().Set("X-Permitted-Cross-Domain-Policies", "none")
	response.Header().Set("X-DNS-Prefetch-Control", "off")
	response.Header().Set("Origin-Agent-Cluster", "?1")
	response.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: https:; connect-src 'self'; worker-src 'self' blob:; frame-src https://www.youtube-nocookie.com; manifest-src 'self'")
	if secure {
		response.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
}

func (h *host) hostAllowed(rawHost string) bool {
	requestHost := strings.TrimSpace(rawHost)
	if requestHost == "" {
		return false
	}
	requestURL, err := url.Parse("//" + requestHost)
	if err != nil || requestURL.Hostname() == "" {
		return false
	}
	originURL, err := url.Parse(h.origin)
	if err != nil || originURL.Hostname() == "" {
		return false
	}
	if strings.EqualFold(requestURL.Hostname(), originURL.Hostname()) {
		requestedPort := requestURL.Port()
		expectedPort := originURL.Port()
		if requestedPort == "" {
			requestedPort = map[bool]string{true: "443", false: "80"}[h.secure]
		}
		if expectedPort == "" {
			expectedPort = map[bool]string{true: "443", false: "80"}[h.secure]
		}
		return requestedPort == expectedPort
	}
	if !h.remoteAccess && isLoopbackBind(h.bindAddress) {
		host := strings.ToLower(requestURL.Hostname())
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return false
		}
		expectedPort := originURL.Port()
		if expectedPort == "" { expectedPort = map[bool]string{true: "443", false: "80"}[h.secure] }
		requestedPort := requestURL.Port()
		if requestedPort == "" { requestedPort = map[bool]string{true: "443", false: "80"}[h.secure] }
		return requestedPort == expectedPort
	}
	return false
}

func sameOriginRequest(request *http.Request) bool {
	if site := strings.ToLower(strings.TrimSpace(request.Header.Get("Sec-Fetch-Site"))); site == "cross-site" {
		return false
	}
	origin := strings.TrimSpace(request.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	if origin == "null" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	return strings.EqualFold(parsed.Host, request.Host)
}

func writeJSON(response http.ResponseWriter, status int, payload any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(payload)
}

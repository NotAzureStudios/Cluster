package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHandlerOwnsHealthAndAPIProxy(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Backend-Path", request.URL.Path)
		response.WriteHeader(http.StatusCreated)
		_, _ = response.Write([]byte(`{"ok":true}`))
	}))
	defer backend.Close()
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	runtimeHost := &host{origin: "http://127.0.0.1:3000", apiOrigin: backend.URL, bindAddress: "127.0.0.1", webPort: 3000, startedAt: time.Now()}
	for _, pathname := range []string{"/api/auth/login", "/health/ready", "/.well-known/security.txt", "/security.txt"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000"+pathname, nil)
		runtimeHost.handler(target).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("%s was not proxied: status %d", pathname, recorder.Code)
		}
		if recorder.Header().Get("X-Backend-Path") != pathname {
			t.Fatalf("%s proxy path changed", pathname)
		}
	}

	recorder := httptest.NewRecorder()
	runtimeHost.handler(target).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/host/health", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("host health returned %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["runtime"] != "go" || payload["version"] != version {
		t.Fatalf("unexpected host health payload: %#v", payload)
	}
}

func TestHandlerRejectsMutationsToStaticAndHostControlRoutes(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	runtimeHost := &host{origin: "http://127.0.0.1:3000", apiOrigin: backend.URL, bindAddress: "127.0.0.1", webPort: 3000, startedAt: time.Now()}
	for _, pathname := range []string{"/", "/host/health"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:3000"+pathname, nil)
		runtimeHost.handler(target).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s mutation returned %d", pathname, recorder.Code)
		}
	}
}

func TestServeWebUsesIndexFallbackAndBlocksTraversal(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("cluster renderer"), 0o600); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	serveWeb(recorder, httptest.NewRequest(http.MethodGet, "http://cluster.local/projects", nil), root, false)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "cluster renderer") {
		t.Fatalf("SPA fallback failed: %d %q", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	serveWeb(recorder, httptest.NewRequest(http.MethodGet, "http://cluster.local/../../outside", nil), root, false)
	if recorder.Code != http.StatusOK && recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected traversal response: %d", recorder.Code)
	}
}

func TestNormalizeHostPorts(t *testing.T) {
	if clampPort(0, 3000) != 3000 || clampPort(70000, 4100) != 4100 || clampPort(3200, 3000) != 3200 {
		t.Fatal("port clamping contract changed")
	}
}

func TestServeWebCachePolicy(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"index.html":           "cluster renderer",
		"cluster-sw.js":        "service worker",
		"manifest.webmanifest": "manifest",
	}
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	files[filepath.Join("assets", "app-abc123.js")] = "asset"
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		path  string
		cache string
	}{
		{"/", "no-store"},
		{"/cluster-sw.js", "no-cache, max-age=0, must-revalidate"},
		{"/manifest.webmanifest", "no-cache, max-age=0, must-revalidate"},
		{"/assets/app-abc123.js", "public, max-age=31536000, immutable"},
	}
	for _, item := range cases {
		recorder := httptest.NewRecorder()
		serveWeb(recorder, httptest.NewRequest(http.MethodGet, "http://cluster.local"+item.path, nil), root, false)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s returned %d", item.path, recorder.Code)
		}
		if actual := recorder.Header().Get("Cache-Control"); actual != item.cache {
			t.Fatalf("%s cache policy = %q, want %q", item.path, actual, item.cache)
		}
	}
}

func TestRemoteBindRequiresExplicitAddressAndSameOrigin(t *testing.T) {
	if normalized, err := normalizeBindAddress("0.0.0.0"); err != nil || normalized != "0.0.0.0" {
		t.Fatalf("remote bind normalization failed: %q %v", normalized, err)
	}
	if isLoopbackBind("0.0.0.0") || !isLoopbackBind("127.0.0.1") {
		t.Fatal("loopback bind classification changed")
	}
	request := httptest.NewRequest(http.MethodPost, "http://192.168.1.20:3000/api/projects", nil)
	request.Header.Set("Origin", "http://192.168.1.20:3000")
	if !sameOriginRequest(request) {
		t.Fatal("same-origin network request was rejected")
	}
	request.Header.Set("Origin", "https://evil.example")
	if sameOriginRequest(request) {
		t.Fatal("cross-origin request was accepted")
	}
	request.Header.Set("Origin", "null")
	if sameOriginRequest(request) {
		t.Fatal("opaque/null origin request was accepted")
	}
}

func TestOriginForRemoteBindKeepsLocalControlOrigin(t *testing.T) {
	if actual := originForBind("0.0.0.0", 3000, "http"); actual != "http://localhost:3000" {
		t.Fatalf("remote bind control origin = %q", actual)
	}
	if actual := originForBind("127.0.0.1", 3200, "http"); actual != "http://localhost:3200" {
		t.Fatalf("loopback origin = %q", actual)
	}
}

func TestManagedHostAPIEnvironmentUsesPrivateProfileWithoutExplicitCORS(t *testing.T) {
	root := t.TempDir()
	runtimeHost := &host{root: root, origin: "http://127.0.0.1:3000"}
	environment := runtimeHost.apiEnvironment(4100)
	if environment["CLUSTER_RUNTIME_PROFILE"] != "managed-host" {
		t.Fatalf("runtime profile = %q", environment["CLUSTER_RUNTIME_PROFILE"])
	}
	if environment["CLUSTER_HOST_RUNTIME"] != "go" || environment["CLUSTER_TRUST_PROXY"] != "true" {
		t.Fatalf("managed host trust boundary is incomplete: %#v", environment)
	}
	if environment["SESSION_SECURE"] != "false" {
		t.Fatalf("local HTTP host must not request secure-only cookies: %q", environment["SESSION_SECURE"])
	}
	if _, exists := environment["CLUSTER_CORS_ORIGINS"]; exists {
		t.Fatal("managed host must not inject its loopback origin as an explicit production CORS origin")
	}
	expectedEnv := filepath.Join(root, "apps", "server", ".env")
	if environment["DOTENV_CONFIG_PATH"] != expectedEnv {
		t.Fatalf("dotenv path = %q, want %q", environment["DOTENV_CONFIG_PATH"], expectedEnv)
	}
}

func TestManagedHostEnvironmentPreservesDatabaseSelection(t *testing.T) {
	root := t.TempDir()
	runtimeHost := &host{root: root, origin: "http://127.0.0.1:3000", shutdownToken: "managed-token"}
	environment := runtimeHost.apiEnvironment(4100)
	if _, exists := environment["DATABASE_URL"]; exists {
		t.Fatal("managed host must not override DATABASE_URL selected by the deployment")
	}
	if _, exists := environment["DIRECT_DATABASE_URL"]; exists {
		t.Fatal("managed host must not override DIRECT_DATABASE_URL selected by the deployment")
	}
	if environment["CLUSTER_HOST_SHUTDOWN_TOKEN"] != "managed-token" {
		t.Fatalf("managed shutdown token was not forwarded: %#v", environment)
	}
}

func TestManagedHostEnvironmentAllowsExplicitDataRoot(t *testing.T) {
	root := t.TempDir()
	customData := filepath.Join(t.TempDir(), "cluster-data")
	t.Setenv("CLUSTER_DATA_DIR", customData)
	runtimeHost := &host{root: root, origin: "http://127.0.0.1:3000", shutdownToken: "managed-token"}
	environment := runtimeHost.apiEnvironment(4100)
	if environment["CLUSTER_DATA_DIR"] != customData {
		t.Fatalf("custom data root = %q, want %q", environment["CLUSTER_DATA_DIR"], customData)
	}
}

func TestWaitForAPIRequiresReadiness(t *testing.T) {
	requests := make(chan string, 4)
	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests <- request.URL.Path
		if request.URL.Path != "/health/supervisor" {
			response.WriteHeader(http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true,"ready":true}`))
	}))
	defer backend.Close()
	runtimeHost := &host{apiOrigin: backend.URL, apiDone: make(chan struct{})}
	if err := runtimeHost.waitForAPI(context.Background(), 2*time.Second); err != nil {
		t.Fatal(err)
	}
	select {
	case pathname := <-requests:
		if pathname != "/health/supervisor" {
			t.Fatalf("readiness probe path = %q", pathname)
		}
	default:
		t.Fatal("readiness endpoint was not requested")
	}
}

func TestManagedShutdownRequestUsesPrivateToken(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/internal/host/shutdown" {
			t.Fatalf("unexpected managed shutdown request: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("X-Cluster-Host-Shutdown") != "managed-token" {
			t.Fatal("managed shutdown token was missing")
		}
		response.WriteHeader(http.StatusAccepted)
	}))
	defer backend.Close()
	runtimeHost := &host{apiOrigin: backend.URL, shutdownToken: "managed-token"}
	if err := runtimeHost.requestAPIShutdown(); err != nil {
		t.Fatal(err)
	}
}

func TestGeneratedShutdownTokensAreStrong(t *testing.T) {
	first, err := generateShutdownToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := generateShutdownToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 64 || first == second {
		t.Fatalf("unexpected shutdown tokens: lengths %d/%d equal=%v", len(first), len(second), first == second)
	}
}

func TestTLSConfigurationRequiresCertificateAndKey(t *testing.T) {
	if _, _, _, err := resolveTLSFiles("certificate.pem", ""); err == nil {
		t.Fatal("partial TLS configuration was accepted")
	}
	if cert, key, secure, err := resolveTLSFiles("", ""); err != nil || cert != "" || key != "" || secure {
		t.Fatalf("empty TLS configuration changed: cert=%q key=%q secure=%v err=%v", cert, key, secure, err)
	}
}

func TestSecureManagedHostEnablesSecureSessionsAndForwardedHTTPS(t *testing.T) {
	root := t.TempDir()
	runtimeHost := &host{root: root, origin: "https://127.0.0.1:3443", scheme: "https", secure: true, shutdownToken: "managed-token"}
	environment := runtimeHost.apiEnvironment(4100)
	if environment["SESSION_SECURE"] != "true" {
		t.Fatalf("secure host session flag = %q", environment["SESSION_SECURE"])
	}

	backend := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Forwarded-Proto") != "https" {
			t.Fatalf("forwarded protocol = %q", request.Header.Get("X-Forwarded-Proto"))
		}
		if request.Header.Get("X-Cluster-Host-Secure") != "true" {
			t.Fatalf("secure host header = %q", request.Header.Get("X-Cluster-Host-Secure"))
		}
		response.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	runtimeHost.apiOrigin = backend.URL
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "https://127.0.0.1:3443/health", nil)
	runtimeHost.handler(target).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("secure proxy returned %d", recorder.Code)
	}
}

func TestRestartBackoffIsBounded(t *testing.T) {
	if apiRestartDelay(1) != 500*time.Millisecond || apiRestartDelay(2) != time.Second {
		t.Fatal("initial API restart backoff changed")
	}
	if apiRestartDelay(20) != 8*time.Second {
		t.Fatalf("API restart backoff was not capped: %s", apiRestartDelay(20))
	}
}

func TestOriginSchemeIsPreserved(t *testing.T) {
	if actual := originForBind("0.0.0.0", 3443, "https"); actual != "https://localhost:3443" {
		t.Fatalf("secure control origin = %q", actual)
	}
}

func TestRemoteHostingRequiresReachablePublicOrigin(t *testing.T) {
	if _, err := resolvePublicOrigin("", "0.0.0.0", 3000, "https", true); err == nil {
		t.Fatal("remote host accepted an implicit loopback public origin")
	}
	origin, err := resolvePublicOrigin("https://cluster.studio", "0.0.0.0", 3000, "https", true)
	if err != nil {
		t.Fatal(err)
	}
	if origin != "https://cluster.studio:3000" {
		t.Fatalf("public origin = %q", origin)
	}
	if _, err := resolvePublicOrigin("http://cluster.studio", "0.0.0.0", 3000, "https", true); err == nil {
		t.Fatal("public origin with the wrong scheme was accepted")
	}
	if _, err := resolvePublicOrigin("https://127.0.0.1:3000", "0.0.0.0", 3000, "https", true); err == nil {
		t.Fatal("remote host accepted a loopback public origin")
	}
	if _, err := resolvePublicOrigin("https://localhost:3000", "0.0.0.0", 3000, "https", true); err == nil {
		t.Fatal("remote host accepted localhost as its public origin")
	}
}

func TestControlFileRequestsManagedShutdown(t *testing.T) {
	file := filepath.Join(t.TempDir(), "host.control")
	if err := os.WriteFile(file, []byte("run\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go watchControlFile(ctx, file, cancel)

	if err := os.WriteFile(file, []byte("stop\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("control file did not request managed shutdown")
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("control file should be removed after shutdown request, stat err=%v", err)
	}
}

// The managed server supports a configurable 120-second drain plus a watchdog.
// The Go Host must wait long enough before sending a second interrupt.
func TestManagedShutdownGracePreservesServerDrain(t *testing.T) {
	const maximumAPIShutdown = 120 * time.Second
	const serverWatchdogMargin = 5 * time.Second
	if managedAPIDrainGrace <= maximumAPIShutdown+serverWatchdogMargin {
		t.Fatalf("managed API grace %s truncates server drain %s", managedAPIDrainGrace, maximumAPIShutdown+serverWatchdogMargin)
	}
}

func TestPasskeyLocalhostCanonicalOriginAndLegacyAlias(t *testing.T) {
    origin, err := resolvePublicOrigin("", "127.0.0.1", 3000, "http", false)
    if err != nil || origin != "http://localhost:3000" {
        t.Fatalf("fresh local public origin = %q, %v", origin, err)
    }
    origin, err = resolvePublicOrigin("http://127.0.0.1:3000", "127.0.0.1", 3000, "http", false)
    if err != nil || origin != "http://localhost:3000" {
        t.Fatalf("older local public origin = %q, %v", origin, err)
    }
    origin, err = resolvePublicOrigin("https://cluster.example.com", "0.0.0.0", 3000, "https", true)
    if err != nil || origin != "https://cluster.example.com:3000" {
        t.Fatalf("remote TLS origin changed = %q, %v", origin, err)
    }
}

func TestPasskeyCanonicalLoopbackNavigationRedirectIsSafe(t *testing.T) {
    root := t.TempDir()
    runtimeHost := &host{root: root, origin: "http://localhost:3000", bindAddress: "127.0.0.1", webPort: 3000, scheme: "http", startedAt: time.Now()}
    backend, err := url.Parse("http://127.0.0.1:4000")
    if err != nil { t.Fatal(err) }
    handler := runtimeHost.handler(backend)

    legacy := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/login?state=1", nil)
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, legacy)
    if rec.Code != http.StatusTemporaryRedirect || rec.Header().Get("Location") != "http://localhost:3000/login?state=1" {
        t.Fatalf("legacy URL redirect status %d target %q", rec.Code, rec.Header().Get("Location"))
    }

    unsafe := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:3000/api/auth/mfa/passkeys/enroll/start", nil)
    unsafe.Header.Set("Origin", "http://127.0.0.1:3000")
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, unsafe)
    if rec.Code != http.StatusMisdirectedRequest { t.Fatalf("unsafe alias request status %d", rec.Code) }

    crossSite := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/login", nil)
    crossSite.Header.Set("Origin", "https://evil.example")
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, crossSite)
    if rec.Code != http.StatusForbidden || rec.Header().Get("Location") != "" { t.Fatalf("cross-site unexpectedly redirected (%d)", rec.Code) }

    otherPort := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3999/login", nil)
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, otherPort)
    if rec.Code != http.StatusMisdirectedRequest { t.Fatalf("wrong loopback port allowed (%d)", rec.Code) }

    health := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/host/health", nil)
    rec = httptest.NewRecorder()
    handler.ServeHTTP(rec, health)
    if rec.Code != http.StatusOK { t.Fatalf("native health check must still work (%d)", rec.Code) }
}

package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNetworkDefault(t *testing.T) {
	p, err := parseNativeNetwork(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if p.WebHost != "127.0.0.1" || p.WebPort != 3000 || p.PublicAPIPort != 4000 || p.PrivatePostgresPort != 54321 {
		t.Fatalf("invalid defaults: %+v", p)
	}
}
func TestNetworkSafeOverride(t *testing.T) {
	p, err := parseNativeNetwork(map[string]any{"webHost": "::1", "webPort": float64(8443), "serverPort": int64(4001), "publicWebUrl": "https://cluster.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	if p.WebHost != "::1" || p.WebPort != 8443 || p.PublicAPIPort != 4001 {
		t.Fatalf("bad override: %+v", p)
	}
}
func TestNetworkRejectsUnsafe(t *testing.T) {
	for _, tc := range []map[string]any{
		{"webHost": "https://127.0.0.1"}, {"webHost": "evil.example.org"}, {"webHost": true},
		{"webPort": 0}, {"webPort": 65536}, {"webPort": float64(4000.5)},
		{"webPort": 4000}, {"webPort": 54321}, {"serverPort": 54321},
		{"publicWebUrl": "javascript:alert(1)"}, {"publicApiUrl": "https://admin:secret@example.test"},
		{"publicWebUrl": "https://example.test/#unsafe"}, {"publicApiUrl": 123},
	} {
		if _, err := parseNativeNetwork(tc); err == nil {
			t.Fatalf("unsafe configuration accepted: %#v", tc)
		}
	}
}
func TestNetworkPort4100MayBeWebWhenPrivateAPIHasDifferentPort(t *testing.T) {
	plan, err := parseNativeNetwork(map[string]any{"webPort": 4100, "serverPort": 4000})
	if err != nil || plan.WebPort != 4100 || plan.PublicAPIPort != 4000 {
		t.Fatalf("configurable web/API ports unexpectedly rejected: plan=%+v error=%v", plan, err)
	}
}

func TestNetworkOccupancy(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	p := nativeNetworkPlan{WebHost: "127.0.0.1", WebPort: busy.Addr().(*net.TCPAddr).Port, PrivatePostgresPort: 54321}
	if err := checkNativeNetworkListeners(p); err == nil || !strings.Contains(err.Error(), "web") {
		t.Fatalf("missing occupied port error: %v", err)
	}
}
func TestNetworkConfiguredFree(t *testing.T) {
	a, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := a.Addr().(*net.TCPAddr).Port
	a.Close()
	b, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	pg := b.Addr().(*net.TCPAddr).Port
	b.Close()
	if port == pg {
		t.Skip("dynamic port coincidence")
	}
	if err := checkNativeNetworkListeners(nativeNetworkPlan{WebHost: "127.0.0.1", WebPort: port, PrivatePostgresPort: pg}); err != nil {
		t.Fatal(err)
	}
}

func TestNativeReadyProbeState(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health/ready" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(status)
	}))
	defer server.Close()
	addr := server.Listener.Addr().(*net.TCPAddr)
	plan := nativeNetworkPlan{WebHost: "127.0.0.1", WebPort: addr.Port}
	if msg := probeNativeReadiness(plan, false); msg != "Application readiness verified" {
		t.Fatal(msg)
	}
	status = http.StatusServiceUnavailable
	if msg := probeNativeReadiness(plan, false); !strings.Contains(msg, "503") {
		t.Fatal(msg)
	}
	status = http.StatusFound
	if msg := probeNativeReadiness(plan, false); !strings.Contains(msg, "302") {
		t.Fatal("redirect followed: " + msg)
	}
	server.Close()
	if msg := probeNativeReadiness(plan, false); !strings.Contains(msg, "unreachable") {
		t.Fatal(msg)
	}
}

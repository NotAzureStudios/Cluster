package main

import (
	nativealerts "cluster.local/native-alerts"
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestNativeReadinessTransitionsOnlyOnConfirmedChanges(t *testing.T) {
	var r readinessTransitions
	cases := []struct {
		healthy bool
		want    nativealerts.Code
	}{
		{true, ""}, {false, ""}, {true, ""}, // transient is not an incident
		{false, ""}, {false, nativealerts.APIReadinessLost},
		{false, ""}, {false, ""}, // same outage, no repeat notification
		{true, ""}, {false, ""}, // recovery must be consecutive
		{true, ""}, {true, nativealerts.APIReadinessRestored},
		{true, ""}, {false, ""}, {false, nativealerts.APIReadinessLost},
	}
	for i, tc := range cases {
		code, ok := r.observe(tc.healthy)
		if code != tc.want || ok != (tc.want != "") {
			t.Fatalf("step %d healthy=%v got %s %v want %s", i, tc.healthy, code, ok, tc.want)
		}
	}
}

func TestNativeReadinessHTTPOnlyAccepts200(t *testing.T) {
	var status atomic.Int64
	status.Store(200)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(int(status.Load())) }))
	defer server.Close()
	client := server.Client()
	if !nativeAPIReady(context.Background(), client, server.URL) {
		t.Fatal("expected ready on 200")
	}
	status.Store(503)
	if nativeAPIReady(context.Background(), client, server.URL) {
		t.Fatal("accepted unready API")
	}
	status.Store(302)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if nativeAPIReady(context.Background(), client, server.URL) {
		t.Fatal("accepted redirect")
	}
	server.Close()
	if nativeAPIReady(context.Background(), client, server.URL) {
		t.Fatal("accepted connection failure")
	}
}

// A planned maintenance hold intentionally returns HTTP 503 from /health/ready.
// The supervisor must only use the independent dependency/process contract.
func TestNativeReadinessUsesSupervisorContract(t *testing.T) {
	var called string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		called = request.URL.Path
		if called != "/health/supervisor" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	if !nativeAPIReady(context.Background(), server.Client(), server.URL) {
		t.Fatal("held but healthy service should not be treated as native failure")
	}
	if called != "/health/supervisor" {
		t.Fatalf("native watcher probed %q", called)
	}
}

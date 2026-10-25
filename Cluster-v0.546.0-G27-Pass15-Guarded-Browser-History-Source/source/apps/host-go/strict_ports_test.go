package main

import (
	"net"
	"testing"
)

func TestStrictWebPortConflict(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := busy.Addr().(*net.TCPAddr).Port
	if _, err := listenConfigured("127.0.0.1", port, true); err == nil {
		t.Fatal("strict web listener must not switch ports")
	}
	alt, err := listenConfigured("127.0.0.1", port, false)
	if err != nil {
		t.Fatal(err)
	}
	defer alt.Close()
	if alt.Addr().(*net.TCPAddr).Port == port {
		t.Fatal("fallback must select different port")
	}
}
func TestStrictPrivateAPIPortConflict(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := busy.Addr().(*net.TCPAddr).Port
	if _, err := availableConfiguredPort(port, true); err == nil {
		t.Fatal("strict private API port must not switch")
	}
	if chosen, err := availableConfiguredPort(port, false); err != nil || chosen == port {
		t.Fatalf("standalone fallback: %d, %v", chosen, err)
	}
}
func TestStrictWebPortAvailable(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	ready, err := listenConfigured("127.0.0.1", port, true)
	if err != nil {
		t.Fatal(err)
	}
	defer ready.Close()
	if ready.Addr().(*net.TCPAddr).Port != port {
		t.Fatal("web bind changed")
	}
	chosen, err := availableConfiguredPort(0, true)
	if err == nil {
		t.Fatalf("invalid private API port unexpectedly available: %d", chosen)
	}
}

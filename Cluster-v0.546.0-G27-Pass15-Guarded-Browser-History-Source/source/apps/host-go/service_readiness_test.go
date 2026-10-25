package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPublishServiceReadiness(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "health.ready")
	if err := publishServiceReadiness(path); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != serviceReadyToken {
		t.Fatalf("unexpected readiness %q", b)
	}
	if err := publishServiceReadiness(path); err != nil {
		t.Fatal(err)
	}
	if err := publishServiceReadiness(""); err == nil {
		t.Fatal("empty path accepted")
	}
}

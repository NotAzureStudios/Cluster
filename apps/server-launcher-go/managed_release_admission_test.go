package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedReleaseStartupNeverFallsBackToCompiler(t *testing.T) {
	root := t.TempDir()
	// Independent developer sources can still build on demand.
	if err := verifyManagedStartup(root, false, false, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".cluster-installer-managed.json"), []byte(`{"managedBy":"cluster-installer"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyManagedStartup(root, false, true, true); err != nil {
		t.Fatal(err)
	}
	if err := verifyManagedStartup(root, false, false, true); err == nil || !strings.Contains(err.Error(), "will not recompile") {
		t.Fatalf("missing prebuilt release was not blocked: %v", err)
	}
	if err := verifyManagedStartup(root, false, true, false); err == nil || !strings.Contains(err.Error(), "will not execute npm install") {
		t.Fatalf("missing dependencies did not fail closed: %v", err)
	}
	// Explicit repair command remains an intentionally separate operation.
	if err := verifyManagedStartup(root, true, false, false); err != nil {
		t.Fatal(err)
	}
}

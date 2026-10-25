package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureManagedWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, s := range []string{"data/system/config", "data/system/logs", "data/system/runtime", "data/postgresql"} {
		if err := os.MkdirAll(filepath.Join(root, s), 0700); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
func TestManagedWorkspaceWritable(t *testing.T) {
	root := fixtureManagedWorkspace(t)
	extra := filepath.Join(root, "NAS Uploads")
	if err := os.MkdirAll(extra, 0700); err != nil {
		t.Fatal(err)
	}
	if err := checkManagedWorkspaceWrites(root, map[string]any{"uploadRootOverride": extra}); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"data/system/config", "data/system/logs", "data/system/runtime", "data/postgresql", "NAS Uploads"} {
		matches, err := filepath.Glob(filepath.Join(root, p, ".cluster-service-write-check-*"))
		if err != nil || len(matches) != 0 {
			t.Fatalf("probe residue in %s: %v %v", p, matches, err)
		}
	}
}
func TestManagedWorkspaceMissingDirectory(t *testing.T) {
	root := fixtureManagedWorkspace(t)
	os.RemoveAll(filepath.Join(root, "data/system/config"))
	err := checkManagedWorkspaceWrites(root, nil)
	if err == nil || !strings.Contains(err.Error(), "system configuration") {
		t.Fatalf("missing fail-closed error: %v", err)
	}
}
func TestManagedWorkspaceExternalNotReachable(t *testing.T) {
	root := fixtureManagedWorkspace(t)
	err := checkManagedWorkspaceWrites(root, map[string]any{"uploadRootOverride": filepath.Join(root, "offline NAS")})
	if err == nil || !strings.Contains(err.Error(), "configured uploads") {
		t.Fatalf("unexpected result: %v", err)
	}
}
func TestManagedWorkspaceInvalidOverride(t *testing.T) {
	root := fixtureManagedWorkspace(t)
	if err := checkManagedWorkspaceWrites(root, map[string]any{"dataRootOverride": "relative"}); err == nil {
		t.Fatal("relative path permitted")
	}
	if err := checkManagedWorkspaceWrites(root, map[string]any{"dataRootOverride": 42}); err == nil {
		t.Fatal("nonstr path permitted")
	}
}

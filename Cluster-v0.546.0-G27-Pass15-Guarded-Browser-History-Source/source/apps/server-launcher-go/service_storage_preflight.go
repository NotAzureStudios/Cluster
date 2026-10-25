package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// checkManagedWorkspaceWrites runs under the actual service identity at startup.
// An installer-created marker is evidence of intent, not proof that LocalService
// can write the operational paths or access a configured NAS mount.
// Never creates, modifies, or deletes user Library files. Only temporary probe
// files are created inside existing directories and always removed.
func checkManagedWorkspaceWrites(root string, overrides map[string]any) error {
	paths := []struct{ label, path string }{
		{"data", filepath.Join(root, "data")},
		{"system configuration", filepath.Join(root, "data", "system", "config")},
		{"system logs", filepath.Join(root, "data", "system", "logs")},
		{"runtime state", filepath.Join(root, "data", "system", "runtime")},
	}
	if info, err := os.Stat(filepath.Join(root, "data", "postgresql")); err == nil && info.IsDir() {
		paths = append(paths, struct{ label, path string }{"private PostgreSQL data", filepath.Join(root, "data", "postgresql")})
	}
	for _, item := range []struct{ key, label string }{
		{"dataRootOverride", "configured data root"},
		{"uploadRootOverride", "configured uploads"},
	} {
		raw, ok := overrides[item.key]
		if !ok || raw == nil {
			continue
		}
		value, ok := raw.(string)
		if !ok {
			return fmt.Errorf("%s must be a path string", item.key)
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if !filepath.IsAbs(value) {
			return fmt.Errorf("%s must be an absolute path", item.key)
		}
		paths = append(paths, struct{ label, path string }{item.label, value})
	}
	// These two transient subdirectories may not exist until the first boot.
	// Creation happens under LocalService, never as a privileged installer.
	for _, sub := range []string{"logs", "runtime"} {
		if err := os.MkdirAll(filepath.Join(root, "data", "system", sub), 0700); err != nil {
			return fmt.Errorf("service account cannot prepare %s directory: %w", sub, err)
		}
	}
	seen := map[string]bool{}
	for _, item := range paths {
		p := filepath.Clean(item.path)
		if seen[p] {
			continue
		}
		seen[p] = true
		info, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf("service account cannot inspect %s directory: %w", item.label, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("service %s path is not a directory", item.label)
		}
		f, err := os.CreateTemp(p, ".cluster-service-write-check-*")
		if err != nil {
			return fmt.Errorf("service account cannot write to %s directory: %w", item.label, err)
		}
		filename := f.Name()
		_, writeErr := f.Write([]byte("Cluster service access probe\n"))
		closeErr := f.Close()
		removeErr := os.Remove(filename)
		if writeErr != nil || closeErr != nil || removeErr != nil {
			return fmt.Errorf("service account cannot safely write and remove its probe in %s (write=%v close=%v remove=%v)", item.label, writeErr, closeErr, removeErr)
		}
	}
	return nil
}

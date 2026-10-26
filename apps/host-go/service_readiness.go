package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const serviceReadyToken = "cluster-host-ready-v1\n"

// publishServiceReadiness publishes an atomic, private signal only after the
// host's API probe and web listener are both initialized. The Windows Service
// uses this instead of treating process creation as application readiness.
func publishServiceReadiness(path string) error {
	if path == "" {
		return fmt.Errorf("readiness path required")
	}
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, ".cluster-host-ready-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.WriteString(serviceReadyToken); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

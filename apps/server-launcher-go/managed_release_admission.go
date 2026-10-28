package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// A verified installer-managed release must always boot its installed artifacts.
// Any missing compiled component or dependency is a repair error, not a reason
// to run a compiler or npm install during routine service startup.
func verifyManagedStartup(root string, explicitRepair, prebuiltReady, dependencyGraphReady bool) error {
	if explicitRepair {
		return nil
	}
	if _, err := os.Stat(filepath.Join(root, ".cluster-installer-managed.json")); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return fmt.Errorf("cannot inspect managed Cluster installation: %w", err)
	}
	if !prebuiltReady {
		return fmt.Errorf("installed Cluster release is incomplete or its prebuilt marker is invalid; run Cluster-Installer.exe to repair the installation (normal startup will not recompile)")
	}
	if !dependencyGraphReady {
		return fmt.Errorf("installed Cluster dependency graph is incomplete; run Cluster-Installer.exe to repair the installation (normal startup will not execute npm install)")
	}
	return nil
}

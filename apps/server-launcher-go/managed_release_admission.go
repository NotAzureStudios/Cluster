package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// A verified installer-managed release must always boot its installed artifacts.
// Any missing compiled component or dependency is a repair error, not a reason
// to run a compiler or npm install during routine service startup.
func verifyManagedStartup(root string, explicitRepair, prebuiltReady, dependencyGraphReady bool) error {
	marker := filepath.Join(root, ".cluster-installer-managed.json")
	contents, err := os.ReadFile(marker)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("cannot inspect managed Cluster installation: %w", err)
	}
	var ownership struct {
		ManagedBy string `json:"managedBy"`
	}
	if json.Unmarshal(contents, &ownership) != nil || ownership.ManagedBy != "cluster-installer" {
		return fmt.Errorf("invalid installer ownership marker; refusing to start an unverified managed release")
	}
	if explicitRepair {
		return fmt.Errorf("managed Cluster releases cannot be source-repaired in place; run Cluster-Installer.exe to restore the verified package")
	}
	if !prebuiltReady {
		return fmt.Errorf("installed Cluster release is incomplete or its prebuilt marker is invalid; run Cluster-Installer.exe to repair the installation (normal startup will not recompile)")
	}
	if !dependencyGraphReady {
		return fmt.Errorf("installed Cluster dependency graph is incomplete; run Cluster-Installer.exe to repair the installation (normal startup will not execute npm install)")
	}
	return nil
}

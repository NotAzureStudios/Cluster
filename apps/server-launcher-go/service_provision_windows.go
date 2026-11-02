//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// Windows Service installation is the ONLY operation allowed to grant the
// LocalService identity access. The interactive Manager, normal startup and
// release installer must never silently rewrite filesystem permissions.
//
// ACLs are restricted to managed application data and the existing .env file.
// Neither executables, toolchains, the whole workspace nor external NAS roots
// are granted write permission. We rely on normal NTFS inheritance and the
// service's actual-identity startup probes, not a recursive icacls /T sweep.
const clusterLocalServiceSID = "*S-1-5-19"

type clusterServiceACL struct {
	Path  string
	Grant string
}

func checkServiceProvisionPath(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("cannot inspect service permission target %s: %w", path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("service permission target is a symlink or junction: %s", path)
	}
	if attr, ok := info.Sys().(*syscall.Win32FileAttributeData); ok && attr.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("service permission target is a reparse point: %s", path)
	}
	if directory && !info.IsDir() {
		return fmt.Errorf("service permission target is not a directory: %s", path)
	}
	if !directory && !info.Mode().IsRegular() {
		return fmt.Errorf("service permission target is not a regular file: %s", path)
	}
	return nil
}

func serviceACLPlan(root string) ([]clusterServiceACL, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := checkServiceProvisionPath(root, true); err != nil {
		return nil, err
	}
	data := filepath.Join(root, "data")
	envFile := filepath.Join(root, "apps", "server", ".env")
	for _, dir := range []string{data, filepath.Join(root, "data", "system"), filepath.Join(root, "data", "system", "config"), filepath.Join(root, "apps", "server")} {
		if err := checkServiceProvisionPath(dir, true); err != nil {
			return nil, err
		}
	}
	if err := checkServiceProvisionPath(envFile, false); err != nil {
		return nil, fmt.Errorf("run interactive Cluster setup before installing Windows Service: %w", err)
	}
	marker := filepath.Join(root, "data", "system", "config", "windows-service-ready.marker")
	if _, err := os.Lstat(marker); err == nil {
		if err := checkServiceProvisionPath(marker, false); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return []clusterServiceACL{
		{Path: data, Grant: clusterLocalServiceSID + ":(OI)(CI)M"},
		{Path: envFile, Grant: clusterLocalServiceSID + ":M"},
	}, nil
}

func provisionClusterServiceWorkspace(root string) error {
	plan, err := serviceACLPlan(root)
	if err != nil {
		return err
	}
	// Only an explicit, elevated --service-install command reaches this
	// function. No reparse targets and no recursive traversal beyond the
	// managed data root. Existing protected child ACLs must be fixed by the
	// operator rather than weakened with an automated recursive override.
	for _, target := range plan {
		cmd := exec.Command("icacls.exe", target.Path, "/grant:r", target.Grant)
		out, runErr := cmd.CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("LocalService permission provisioning failed for %s: %w: %s", target.Path, runErr, string(out))
		}
	}
	marker := filepath.Join(root, "data", "system", "config", "windows-service-ready.marker")
	// Marker confirms ONLY the explicit ACL grant operation, not successful
	// LocalService access. Service startup still probes actual write access
	// under the restricted identity and fails closed on inaccessible storage.
	if err := os.WriteFile(marker, []byte("localservice-workspace-v1\n"), 0600); err != nil {
		return fmt.Errorf("cannot write Windows Service provisioning marker: %w", err)
	}
	return nil
}

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Offline diagnostics never spawn Cluster, connect to PostgreSQL, mutate a
// database, read secret values or invoke a repair. Presence checks are not a
// substitute for PostgreSQL consistency checks or a real restore drill.
type nativeOfflineCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type nativeOfflineReport struct {
	Workspace string               `json:"workspace"`
	Release   string               `json:"release"`
	Healthy   bool                 `json:"healthy"`
	Checks    []nativeOfflineCheck `json:"checks"`
}

func collectNativeOfflineDiagnostics(root string) nativeOfflineReport {
	report := nativeOfflineReport{Workspace: root, Release: displayReleaseVersion(root), Healthy: true, Checks: []nativeOfflineCheck{}}
	add := func(name, status, detail string) {
		if status == "fail" {
			report.Healthy = false
		}
		report.Checks = append(report.Checks, nativeOfflineCheck{Name: name, Status: status, Detail: detail})
	}
	regular := func(rel string) bool {
		info, err := os.Lstat(filepath.Join(root, rel))
		return err == nil && info.Mode().IsRegular()
	}
	marker := filepath.Join(root, ".cluster-installer-managed.json")
	markerContent, markerErr := os.ReadFile(marker)
	managed := markerErr == nil
	if managed {
		var owner struct{ ManagedBy string `json:"managedBy"` }
		if json.Unmarshal(markerContent, &owner) != nil || owner.ManagedBy != "cluster-installer" {
			add("installer ownership", "fail", "Installer ownership marker is invalid; do not overwrite this workspace")
		} else {
			add("installer ownership", "pass", "Managed installation marker is valid")
		}
	} else if os.IsNotExist(markerErr) {
		add("installer ownership", "warn", "Unmanaged source workspace; managed repair guarantees do not apply")
	} else {
		add("installer ownership", "fail", "Cannot read installer ownership marker")
	}
	if releasePrebuiltReady(root) {
		add("release identity", "pass", "Release manifest matches the native launcher version")
	} else if managed {
		add("release identity", "fail", "Managed prebuilt release manifest is missing, malformed, or version-mismatched")
	} else {
		add("release identity", "warn", "No matching compiled release manifest (development source may be unbuilt)")
	}
	for _, item := range []struct{ label, path string }{
		{"server build", filepath.Join("apps", "server", "dist", "index.js")},
		{"web build", filepath.Join("apps", "web", "dist", "index.html")},
		{"shared build", filepath.Join("packages", "shared", "dist", "index.js")},
		{"Prisma CLI", filepath.Join("node_modules", "prisma", "build", "index.js")},
		{"Prisma client", filepath.Join("node_modules", "@prisma", "client", "package.json")},
		{"database command", filepath.Join("tools", "scripts", "database-command.mjs")},
	} {
		if regular(item.path) {
			add(item.label, "pass", "Required packaged file is present (contents not reverified)")
		} else if managed {
			add(item.label, "fail", "Required packaged file missing; repair using Cluster-Installer.exe")
		} else {
			add(item.label, "warn", "File not present in source workspace")
		}
	}
	installerNode := filepath.Join(filepath.Dir(root), "Toolchains", "node-v"+privateNodeVersion, "node.exe")
	localNode := filepath.Join(root, "runtime", "node", "node.exe")
	validFile := func(path string) bool {
		info, err := os.Lstat(path)
		return err == nil && info.Mode().IsRegular()
	}
	if validFile(installerNode) {
		add("private Node", "pass", "Installer-provisioned private Node is present; version not executed")
	} else if validFile(localNode) {
		add("private Node", "pass", "Server-local private Node is present; version not executed")
	} else if managed {
		add("private Node", "fail", "No private Node executable found; repair with Cluster-Installer.exe")
	} else {
		add("private Node", "warn", "Private Node has not been provisioned")
	}
	postgresBinary := filepath.Join(root, "runtime", "postgresql", "bin", "postgres.exe")
	if validFile(postgresBinary) {
		add("PostgreSQL runtime", "pass", "PostgreSQL binary is present; not executed")
	} else if managed {
		add("PostgreSQL runtime", "fail", "PostgreSQL runtime missing; start in interactive setup mode before enabling the service")
	} else {
		add("PostgreSQL runtime", "warn", "PostgreSQL runtime has not been provisioned")
	}
	data := filepath.Join(root, "data", "postgresql")
	pgVersion := filepath.Join(data, "PG_VERSION")
	value, err := os.ReadFile(pgVersion)
	switch {
	case err == nil && strings.TrimSpace(string(value)) == "18":
		add("PostgreSQL data", "pass", "Data-directory major version matches PostgreSQL 18; physical integrity not checked")
	case err == nil:
		add("PostgreSQL data", "fail", "Unexpected PostgreSQL data major version; do not auto-initialize or migrate")
	case os.IsNotExist(err):
		if info, statErr := os.Stat(data); statErr == nil && info.IsDir() {
			add("PostgreSQL data", "fail", "Data directory exists without PG_VERSION; preserve and inspect it before starting")
		} else {
			add("PostgreSQL data", "warn", "Database not initialized; no data was created")
		}
	default:
		add("PostgreSQL data", "fail", "Cannot inspect PostgreSQL data version")
	}
	if regular(filepath.Join("apps", "server", ".env")) {
		add("server environment", "pass", "Server environment file exists; secrets were not read")
	} else {
		add("server environment", "warn", "Server environment not initialized; startup may need interactive setup")
	}
	return report
}

func writeNativeOfflineDiagnostics(writer io.Writer, report nativeOfflineReport) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		return fmt.Errorf("cannot write offline diagnostic report: %w", err)
	}
	return nil
}

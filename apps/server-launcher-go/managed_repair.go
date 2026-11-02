package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Managed repair is deliberately narrower than reinstalling application files.
// Only exact known workspace links and the trusted private Node runtime may be
// modified. PostgreSQL data, secrets, Library files and release artifacts are
// never "recreated" by this operation.
type managedRepairAction struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type managedRepairReport struct {
	Ready   bool                  `json:"ready"`
	Actions []managedRepairAction `json:"actions"`
}

func (report *managedRepairReport) add(name, status, detail string) {
	report.Actions = append(report.Actions, managedRepairAction{Name: name, Status: status, Detail: detail})
	if status == "blocked" {
		report.Ready = false
	}
}

func writeManagedRepairReport(writer io.Writer, report managedRepairReport) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func validateManagedRepairRoot(root string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("refusing to repair a missing, linked or non-directory Cluster workspace")
	}
	markerPath := filepath.Join(root, ".cluster-installer-managed.json")
	markerInfo, err := os.Lstat(markerPath)
	if err != nil || !markerInfo.Mode().IsRegular() {
		return fmt.Errorf("refusing self-repair without a regular installer ownership marker")
	}
	data, err := os.ReadFile(markerPath)
	if err != nil || len(data) > 16*1024 {
		return fmt.Errorf("cannot read bounded installer ownership marker")
	}
	var owner struct {
		ManagedBy   string `json:"managedBy"`
		InstallRoot string `json:"installRoot"`
	}
	if err := json.Unmarshal(data, &owner); err != nil || owner.ManagedBy != "cluster-installer" {
		return fmt.Errorf("installer ownership marker is untrusted; refusing self-repair")
	}
	// The native Server root is WorkRoot/Server. Never repair a copied,
	// foreign, or relocated marker without installer-level reconciliation.
	expected := filepath.Clean(filepath.Dir(root))
	if owner.InstallRoot == "" || !strings.EqualFold(filepath.Clean(owner.InstallRoot), expected) {
		return fmt.Errorf("installer ownership marker does not match this workspace; use the verified installer")
	}
	for _, protected := range []string{filepath.Join(root, "data"), filepath.Join(root, "data", "postgresql")} {
		if info, err := os.Lstat(protected); err == nil {
			if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
				return fmt.Errorf("protected storage path is not a real directory; refusing self-repair")
			}
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("cannot safely inspect protected data path: %w", err)
		}
	}
	// If the database disappeared from a previously initialized install,
	// refuse repair as well as startup. This is frequently a disconnected NAS
	// or drive, not a reason to create a new empty database.
	dbPath := filepath.Join(root, "data", "postgresql")
	if _, err := os.Lstat(dbPath); os.IsNotExist(err) {
		for _, evidence := range []string{
			filepath.Join(root, "runtime", "postgresql-data-initialized.marker"),
			filepath.Join(root, "data", "system", "config", "embedded-postgres.env"),
		} {
			if _, evidenceErr := os.Lstat(evidence); evidenceErr == nil {
				return fmt.Errorf("PostgreSQL storage is missing but prior database initialization evidence exists; restore the original data volume before repair")
			} else if !os.IsNotExist(evidenceErr) {
				return fmt.Errorf("cannot inspect historical database evidence: %w", evidenceErr)
			}
		}
	} else if err != nil {
		return fmt.Errorf("cannot inspect PostgreSQL storage: %w", err)
	}
	// A missing PG_VERSION on existing data is a recovery incident. Never
	// modify the executable environment under a damaged/unknown database.
	if dataInfo, err := os.Lstat(dbPath); err == nil && dataInfo.IsDir() {
		v, err := os.ReadFile(filepath.Join(root, "data", "postgresql", "PG_VERSION"))
		if err != nil || strings.TrimSpace(string(v)) != "18" {
			return fmt.Errorf("PostgreSQL data is incomplete or has an incompatible version; repair is blocked until the data is safely recovered")
		}
	}
	return nil
}

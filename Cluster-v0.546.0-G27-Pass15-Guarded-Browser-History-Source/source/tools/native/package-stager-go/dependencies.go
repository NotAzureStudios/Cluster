package main

// Dependency pins are signed into a Package release. Matching a locally
// selected managed release is a prerequisite for content activation; this is
// NOT proof of OS software installation, which needs a separate installer.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var dependencyVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$`)

func validateManifestDependencies(m manifest) error {
	if len(m.Dependencies) > 12 {
		return errors.New("too many signed package dependencies")
	}
	seen := make(map[string]bool)
	for _, dep := range m.Dependencies {
		if !validPackageKey(dep.PackageKey) || dep.PackageKey == m.PackageKey || seen[dep.PackageKey] || !dependencyVersionPattern.MatchString(dep.Version) ||
			(dep.Requirement != "content-selected" && dep.Requirement != "msi-installed") ||
			(dep.Requirement == "msi-installed" && (m.Platform != "windows-x64" || m.Installer == nil)) {
			return errors.New("invalid or duplicated signed package dependency")
		}
		seen[dep.PackageKey] = true
	}
	return nil
}

// Check all selected prerequisites before any target mutation. A pointer is
// user-profile-local evidence of selected content, never an OS attestation.
func verifySelectedDependencies(root string, m manifest) error {
	if err := validateManifestDependencies(m); err != nil {
		return err
	}
	if len(m.Dependencies) == 0 {
		return nil
	}
	if err := directoryNoLinks(root); err != nil {
		return err
	}
	dir := filepath.Join(root, "managed-active")
	if err := directoryNoLinks(dir); err != nil {
		return fmt.Errorf("dependencies not selected: %w", err)
	}
	for _, dep := range m.Dependencies {
		pointer := filepath.Join(dir, dep.PackageKey+".json")
		info, err := os.Lstat(pointer)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
			return fmt.Errorf("dependency %s has no safe selected state", dep.PackageKey)
		}
		selected, err := readManagedPointer(pointer, dep.PackageKey)
		if err != nil || selected.Generation == 0 || selected.Active.Version != dep.Version {
			return fmt.Errorf("dependency %s requires selected version %s", dep.PackageKey, dep.Version)
		}
		content := filepath.Join(root, "managed", dep.PackageKey, selected.Active.ArchiveSha256)
		if err := directoryNoLinks(content); err != nil {
			return fmt.Errorf("dependency %s selected content missing or unsafe: %w", dep.PackageKey, err)
		}
	}
	return nil
}

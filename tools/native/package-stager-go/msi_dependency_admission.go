package main

// A signed dependency selected in managed-content state is not evidence that
// Windows installed it. Fresh MSI execution must independently find a bounded,
// exact, terminal local attempt and a stable Windows Installer registration for
// every signed prerequisite. This is a narrow launch guard, NOT application
// health attestation or an authorization to remove/update dependencies.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
)

type msiDependencyEvidence struct {
	PackageKey     string `json:"packageKey"`
	Version        string `json:"version"`
	ProductCode    string `json:"productCode"`
	ProductVersion string `json:"productVersion"`
	ReceiptSha256  string `json:"receiptSha256"`
}

func validMSIDependencyEvidence(deps []msiDependencyEvidence, owner string) bool {
	if len(deps) > 12 {
		return false
	}
	seen := map[string]bool{}
	for _, dep := range deps {
		if !validPackageKey(dep.PackageKey) || dep.PackageKey == owner || seen[dep.PackageKey] ||
			!dependencyVersionPattern.MatchString(dep.Version) ||
			!msiProductCodePattern.MatchString(dep.ProductCode) ||
			!msiProductVersionPattern.MatchString(dep.ProductVersion) || !validDigest(dep.ReceiptSha256) {
			return false
		}
		seen[dep.PackageKey] = true
	}
	return true
}

func checkedMSIDependencyStatus(dep packageDependency, status msiAttemptStatus) (msiDependencyEvidence, error) {
	var out msiDependencyEvidence
	if status.PackageKey != dep.PackageKey || !status.ReadOnly || status.OSAttested || status.RetryAuthorized ||
		!status.HasReceipt || status.Attempt == nil || status.Product == nil || !validDigest(status.ReceiptSha256) ||
		status.Attempt.PackageKey != dep.PackageKey || status.Attempt.Version != dep.Version ||
		status.State != "msi_exit_zero_not_os_attested" || status.Attempt.State != status.State ||
		status.Attempt.ExitCode != 0 || status.Attempt.LaunchCommittedAt == "" || status.Attempt.FinishedAt == "" ||
		status.Attempt.PreLaunchRegistration == nil || status.Attempt.PostExitRegistration == nil ||
		status.RegistrationTransition != msiTransitionMatchObserved ||
		status.RegistrationDrift != "registration_unchanged_since_exit" ||
		!validMSIRegistrationObservation(*status.Product, status.Attempt.ProductCode, status.Attempt.ProductVersion) ||
		status.Product.State != "registered_version_match" ||
		*status.Attempt.PostExitRegistration != *status.Product ||
		validateMSIRegistrationTransition(*status.Attempt) != nil {
		return out, fmt.Errorf("MSI prerequisite %s has no trustworthy exact installed registration evidence", dep.PackageKey)
	}
	return msiDependencyEvidence{PackageKey: dep.PackageKey, Version: dep.Version,
		ProductCode: status.Attempt.ProductCode, ProductVersion: status.Attempt.ProductVersion,
		ReceiptSha256: status.ReceiptSha256}, nil
}

// Injectable status reader permits adversarial Linux tests without fabricating
// Windows Installer registration. The production reader is OS-backed.
func inspectMSIDependenciesWithReader(root, owner string, deps []packageDependency,
	reader func(string, string) (msiAttemptStatus, error)) ([]msiDependencyEvidence, error) {
	if !validPackageKey(owner) || len(deps) > 12 || reader == nil {
		return nil, errors.New("invalid MSI dependency admission")
	}
	seen := map[string]bool{}
	result := make([]msiDependencyEvidence, 0, len(deps))
	for _, dep := range deps {
		if !validPackageKey(dep.PackageKey) || dep.PackageKey == owner || seen[dep.PackageKey] ||
			!dependencyVersionPattern.MatchString(dep.Version) ||
			(dep.Requirement != "content-selected" && dep.Requirement != "msi-installed") {
			return nil, errors.New("invalid signed MSI dependency")
		}
		seen[dep.PackageKey] = true
		if dep.Requirement == "content-selected" {
			continue
		}
		// The original installation receipt remains after supervised repair
		// or uninstall, so its old registration evidence is insufficient.
		if err := requireNoPriorMSILifecycle(root, dep.PackageKey); err != nil {
			return nil, fmt.Errorf("MSI prerequisite %s lifecycle hold: %w", dep.PackageKey, err)
		}
		// A conflicting MSI operation on the dependency is not made safe by our
		// profile-wide admission lock. Use Lstat, not a path-following read.
		lock := filepath.Join(root, "msi-attempts", dep.PackageKey+".lock")
		if info, err := os.Lstat(lock); err == nil {
			_ = info
			return nil, fmt.Errorf("MSI prerequisite %s has an operation lock", dep.PackageKey)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
		status, err := reader(root, dep.PackageKey)
		if err != nil {
			return nil, fmt.Errorf("MSI prerequisite %s inspection failed: %w", dep.PackageKey, err)
		}
		checked, err := checkedMSIDependencyStatus(dep, status)
		if err != nil {
			return nil, err
		}
		result = append(result, checked)
	}
	if !validMSIDependencyEvidence(result, owner) {
		return nil, errors.New("MSI dependency evidence invalid")
	}
	return result, nil
}

func inspectMSIInstalledDependencies(root string, m manifest) ([]msiDependencyEvidence, error) {
	if err := validateManifestDependencies(m); err != nil {
		return nil, err
	}
	return inspectMSIDependenciesWithReader(root, m.PackageKey, m.Dependencies, inspectMSIAttempt)
}

func requireUnchangedMSIInstalledDependencies(root string, m manifest, expected []msiDependencyEvidence) error {
	current, err := inspectMSIInstalledDependencies(root, m)
	if err != nil || !reflect.DeepEqual(current, expected) {
		return errors.New("MSI prerequisite installation evidence changed before launch; manual review required")
	}
	return nil
}

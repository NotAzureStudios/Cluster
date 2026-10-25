package main

// Distinct signed, default-disabled per-user Windows MSI uninstall.
// The original install receipt is never removed and the shared lifecycle
// journal makes repair/uninstall mutually exclusive until manual review.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func uninstallSupervisedMSI(o options, now time.Time) (msiRepairReceipt, error) {
	var out msiRepairReceipt
	if hostPlatform() != "windows-x64" {
		return out, errors.New("supervised uninstall requires Windows x64")
	}
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil || m.Installer.Scope != "user" {
		return out, errors.New("uninstall requires a signed user-scope MSI")
	}
	claim, err := verifyDeploymentGrant(o, m, fingerprint, "uninstall", now)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil || directoryNoLinks(root) != nil {
		return out, errors.New("unsafe uninstall profile root")
	}
	if err = verifyStaged(root, m, archive, fingerprint); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	sourcePath := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	if err = verifyRegularDigest(sourcePath, m.Installer.Sha256); err != nil {
		return out, err
	}
	identity, identityErr := inspectStagedMSIProperties(sourcePath, *m.Installer)
	if identityErr != nil || !identity.Verified {
		return out, errors.New("uninstall signed MSI identity failed")
	}
	parent := filepath.Join(root, "msi-attempts")
	if err = directoryNoLinks(parent); err != nil {
		return out, err
	}
	unlockAdmission, err := acquireMSIInstallLock(root, "msi-admission")
	if err != nil {
		return out, err
	}
	defer unlockAdmission()
	unlockPackage, err := acquireMSIInstallLock(parent, m.PackageKey)
	if err != nil {
		return out, err
	}
	defer unlockPackage()
	journalDir := filepath.Join(root, "msi-lifecycle")
	if err = os.MkdirAll(journalDir, 0700); err != nil {
		return out, err
	}
	if err = directoryNoLinks(journalDir); err != nil {
		return out, err
	}
	receipt := filepath.Join(journalDir, m.PackageKey+".json")
	if _, e := os.Lstat(receipt); e == nil {
		return out, errors.New("previous lifecycle action requires review; uninstall replay refused")
	} else if !os.IsNotExist(e) {
		return out, e
	}
	if err = requireUninstallOfExactKnownMSI(root, m, claim.PriorReceiptSha256); err != nil {
		return out, err
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	dependencies, err := inspectMSIInstalledDependencies(root, m)
	if err != nil {
		return out, err
	}
	out = msiRepairReceipt{Schema: 1, Operation: "uninstall", PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSISha256: m.Installer.Sha256,
		ProductCode: m.Installer.ProductCode, ProductVersion: m.Installer.ProductVersion,
		PriorReceiptSha256: claim.PriorReceiptSha256, State: "uninstall_prepared_not_launched",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano), OSAttested: false}
	if err = writeFirstMSIRepairReceipt(receipt, out); err != nil {
		return out, err
	}
	if err = consumeGrant(root, claim); err != nil {
		return out, err
	}
	if err = requireUninstallOfExactKnownMSI(root, m, claim.PriorReceiptSha256); err != nil {
		return out, err
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	if err = requireUnchangedMSIInstalledDependencies(root, m, dependencies); err != nil {
		return out, err
	}
	frozen, err := acquireMSIFrozenSource(sourcePath, m.Installer.Sha256)
	if err != nil {
		return out, err
	}
	defer frozen.close()
	baseline, queryErr := queryInstalledMSIProduct(m.Installer.ProductCode, m.Installer.ProductVersion)
	if err = requireExactMSIRepairRegistration(baseline, queryErr, m.Installer.ProductCode, m.Installer.ProductVersion); err != nil {
		return out, err
	}
	out.State = "uninstall_started_outcome_unknown"
	out.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(receipt, out); err != nil {
		return out, err
	}
	code, execErr := runWindowsUserMSIUninstall(frozen, baseline, root, m, dependencies)
	out.ExitCode = code
	out.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	switch {
	case execErr != nil:
		out.State = "uninstall_failed_or_outcome_unknown"
	case code == 0:
		out.State = "uninstall_exit_zero_not_os_attested"
	case code == 3010:
		out.State = "uninstall_restart_required_not_os_attested"
	default:
		out.State = "uninstall_failed_or_outcome_unknown"
	}
	if err = writeRawMSIRepairReceipt(receipt, out); err != nil {
		return out, fmt.Errorf("uninstall result uncertain; journal write failed: %w", err)
	}
	if execErr != nil {
		return out, execErr
	}
	if code != 0 && code != 3010 {
		return out, fmt.Errorf("uninstall process exited %d", code)
	}
	return out, nil
}

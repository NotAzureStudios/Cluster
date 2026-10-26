package main

// Explicit, separately authorized repair of an existing signed user MSI.
// Repair never reuses the fresh-install grant, receipt, or automatic retry
// path. Unknown outcomes remain as durable local journal evidence.
import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type msiRepairReceipt struct {
	Schema               int    `json:"schema"`
	Operation            string `json:"operation"`
	PackageKey           string `json:"packageKey"`
	Version              string `json:"version"`
	ArtifactSha256       string `json:"artifactSha256"`
	MSISha256            string `json:"msiSha256"`
	MSIPath              string `json:"msiPath,omitempty"`
	ProductCode          string `json:"productCode"`
	ProductVersion       string `json:"productVersion"`
	PriorReceiptSha256   string `json:"priorReceiptSha256"`
	PriorMSISha256       string `json:"priorMsiSha256,omitempty"`
	PriorProductVersion  string `json:"priorProductVersion,omitempty"`
	UpgradeJournalSha256 string `json:"upgradeJournalSha256,omitempty"`
	SuccessorMSISha256   string `json:"successorMsiSha256,omitempty"`
	State                string `json:"state"`
	StartedAt            string `json:"startedAt"`
	LaunchCommittedAt    string `json:"launchCommittedAt,omitempty"`
	FinishedAt           string `json:"finishedAt,omitempty"`
	ExitCode             int    `json:"exitCode,omitempty"`
	OSAttested           bool   `json:"osAttested"`
}

func requireRepairOfExactKnownMSI(root string, m manifest, priorSha string) error {
	return requireLifecycleOfExactKnownMSI(root, m, priorSha)
}
func requireUninstallOfExactKnownMSI(root string, m manifest, priorSha string) error {
	return requireLifecycleOfExactKnownMSIWithDisposition(root, m, priorSha, true)
}
func requireLifecycleOfExactKnownMSI(root string, m manifest, priorSha string) error {
	return requireLifecycleOfExactKnownMSIWithDisposition(root, m, priorSha, false)
}
func requireLifecycleOfExactKnownMSIWithDisposition(root string, m manifest, priorSha string, allowSettled bool) error {
	if m.Installer == nil || !validDigest(priorSha) {
		return errors.New("repair requires signed MSI and exact prior receipt")
	}
	profile, err := inspectMSIProfile(root)
	if err != nil || !profile.Complete {
		return errors.New("repair profile evidence incomplete; manual review required")
	}
	// The admission lock belongs to this operation. Other interrupted
	// per-Package locks are never guessed stale or silently cleared.
	for _, other := range profile.Records {
		if other.PackageKey != m.PackageKey {
			info, e := os.Lstat(filepath.Join(root, "msi-attempts", other.PackageKey+".lock"))
			if e == nil && info != nil {
				return fmt.Errorf("foreign MSI lock for %s blocks repair", other.PackageKey)
			}
			if e != nil && !os.IsNotExist(e) {
				return e
			}
		}
	}
	// The profile-wide admission lock belongs to this supervised operation;
	// it is not evidence of a competing writer. All foreign Package locks
	// were rejected above. Keep per-Package receipt/registration checks.
	checked := profile
	checked.AdmissionLockPresent = false
	checked.Records = append([]msiAttemptStatus(nil), profile.Records...)
	for i := range checked.Records {
		checked.Records[i].AdmissionLockPresent = false
	}
	for _, edge := range profile.DependencyEdges {
		if !edge.RecordedReceiptMatches {
			return errors.New("unresolved MSI dependency custody forbids repair")
		}
		if edge.DependencyPackageKey == m.PackageKey {
			if allowSettled && observedSettledMSIUninstall(checked, edge.DependentPackageKey) {
				continue
			}
			return errors.New("known dependent Package has no exact completed uninstall and OS absence evidence")
		}
	}
	var target *msiAttemptStatus
	for i := range profile.Records {
		if profile.Records[i].PackageKey == m.PackageKey {
			target = &profile.Records[i]
			break
		}
	}
	if target == nil || !target.HasReceipt || target.Attempt == nil || target.ReceiptSha256 != priorSha ||
		target.Attempt.Version != m.Version || target.Attempt.ArtifactSha256 != m.ArtifactSha256 ||
		target.Attempt.MSISha256 != m.Installer.Sha256 || target.Attempt.ProductCode != m.Installer.ProductCode ||
		target.Attempt.ProductVersion != m.Installer.ProductVersion || target.State != "msi_exit_zero_not_os_attested" ||
		target.Attempt.PreLaunchRegistration == nil || target.Attempt.PostExitRegistration == nil ||
		target.RegistrationDrift != "registration_unchanged_since_exit" || target.Product == nil ||
		target.Product.State != "registered_version_match" || !target.Product.VersionMatches ||
		!target.Product.ProbeComplete || target.Product.ProbeScope != "current_user_and_machine" ||
		*target.Product != *target.Attempt.PostExitRegistration {
		return errors.New("repair prior receipt or exact Windows registration cannot be verified")
	}
	return nil
}

func repairSupervisedMSI(o options, now time.Time) (msiRepairReceipt, error) {
	var out msiRepairReceipt
	if hostPlatform() != "windows-x64" {
		return out, errors.New("supervised repair requires Windows x64")
	}
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil || m.Installer.Scope != "user" {
		return out, errors.New("repair requires a signed user-scope MSI")
	}
	claim, err := verifyDeploymentGrant(o, m, fingerprint, "repair", now)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil || directoryNoLinks(root) != nil {
		return out, errors.New("unsafe repair profile root")
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
		return out, errors.New("repair signed MSI identity failed")
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
		return out, errors.New("previous lifecycle action requires review; repair replay refused")
	} else if !os.IsNotExist(e) {
		return out, e
	}
	if err = requireRepairOfExactKnownMSI(root, m, claim.PriorReceiptSha256); err != nil {
		return out, err
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	dependencies, err := inspectMSIInstalledDependencies(root, m)
	if err != nil {
		return out, err
	}
	out = msiRepairReceipt{Schema: 1, Operation: "repair", PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSISha256: m.Installer.Sha256,
		ProductCode: m.Installer.ProductCode, ProductVersion: m.Installer.ProductVersion,
		PriorReceiptSha256: claim.PriorReceiptSha256, State: "repair_prepared_not_launched",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano), OSAttested: false}
	if err = writeFirstMSIRepairReceipt(receipt, out); err != nil {
		return out, err
	}
	if err = consumeGrant(root, claim); err != nil {
		return out, err
	}
	if err = requireRepairOfExactKnownMSI(root, m, claim.PriorReceiptSha256); err != nil {
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
	out.State = "repair_started_outcome_unknown"
	out.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(receipt, out); err != nil {
		return out, err
	}
	code, execErr := runWindowsUserMSIRepair(frozen, baseline, root, m, dependencies)
	out.ExitCode = code
	out.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	switch {
	case execErr != nil:
		out.State = "repair_failed_or_outcome_unknown"
	case code == 0:
		out.State = "repair_exit_zero_not_os_attested"
	case code == 3010:
		out.State = "repair_restart_required_not_os_attested"
	default:
		out.State = "repair_failed_or_outcome_unknown"
	}
	if err = writeRawMSIRepairReceipt(receipt, out); err != nil {
		return out, fmt.Errorf("repair result uncertain; journal write failed: %w", err)
	}
	if execErr != nil {
		return out, execErr
	}
	if code != 0 && code != 3010 {
		return out, fmt.Errorf("repair process exited %d", code)
	}
	return out, nil
}
func writeRawMSIRepairReceipt(path string, value msiRepairReceipt) error {
	// Share the same pre-rename durable write convention as install receipts.
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := writeRawAtomic(path, data); err != nil {
		return err
	}
	return syncMSICustodyParent(path)
}
func requireExactMSIRepairRegistration(product msiProductState, queryErr error, code, version string) error {
	if queryErr != nil || product.ProductCode != code || product.ExpectedVersion != version ||
		product.State != "registered_version_match" || !product.VersionMatches || product.ReportedVersion != version ||
		!product.ReadOnly || product.OSAttested || !product.ProbeComplete || product.ProbeScope != "current_user_and_machine" {
		return errors.New("repair requires exact stable Windows Installer registration")
	}
	return nil
}

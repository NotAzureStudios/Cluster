package main

// Signed, one-use recovery execution of a previously upgraded per-user MSI.
// A rollback is NOT an automatic uninstall/reinstall or evidence of health.
// The original installation receipt and the completed upgrade journal remain
// unchanged. Any interruption permanently retains a separate rollback journal.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Ignore only the operation-owned locks and the prepared rollback journal.
// Preserve the immutable completed upgrade record as the sole input to review.
func reviewRollbackWithOwnedProfile(root, key, journalSHA string, profile msiProfileStatus, prepared bool, verify func(string, string) error) (msiRollbackReview, error) {
	var blocked msiRollbackReview
	if !profile.Complete || !profile.ReadOnly || profile.OSAttested || !profile.AdmissionLockPresent || profile.LifecycleMutationAuthorized || !validDigest(journalSHA) {
		return blocked, errors.New("rollback profile or global ownership incomplete")
	}
	// Preserve independently journaled completed dependent uninstalls. Remove
	// only this process's own in-flight rollback journal from the read-only
	// admission projection. Foreign/invalid journals remain visible and fail.
	var own, upgrade *msiRepairStatus
	remaining := make([]msiRepairStatus, 0, len(profile.LifecycleRecords))
	for i := range profile.LifecycleRecords {
		rec := &profile.LifecycleRecords[i]
		if rec.PackageKey == key && rec.Receipt != nil {
			switch rec.Receipt.Operation {
			case "upgrade":
				if upgrade != nil {
					return blocked, errors.New("duplicate upgrade custody")
				}
				upgrade = rec
			case "msi-rollback":
				if own != nil {
					return blocked, errors.New("duplicate rollback custody")
				}
				own = rec
			}
		}
		if rec != own {
			remaining = append(remaining, *rec)
		}
	}
	if upgrade == nil || upgrade.ReceiptSha256 != journalSHA || (prepared != (own != nil)) {
		return blocked, errors.New("completed upgrade or rollback journal set changed")
	}
	if prepared {
		if own.Receipt == nil ||
			(own.Receipt.State != "msi-rollback_prepared_not_launched" && own.Receipt.State != "msi-rollback_started_outcome_unknown") ||
			own.State != own.Receipt.State ||
			own.Receipt.UpgradeJournalSha256 != journalSHA || own.Receipt.PriorReceiptSha256 != upgrade.Receipt.PriorReceiptSha256 ||
			own.Receipt.PriorMSISha256 != upgrade.Receipt.PriorMSISha256 || own.Receipt.SuccessorMSISha256 != upgrade.Receipt.MSISha256 {
			return blocked, errors.New("prepared rollback changed or points to different upgrade")
		}
	}
	profile.LifecycleRecords = remaining
	found := false
	profile.Records = append([]msiAttemptStatus(nil), profile.Records...)
	for i := range profile.Records {
		record := &profile.Records[i]
		if record.PackageKey == key {
			if !record.LockPresent {
				return blocked, errors.New("rollback package ownership lock missing")
			}
			record.LockPresent = false
			found = true
		} else if record.LockPresent {
			return blocked, errors.New("foreign MSI Package mutation active")
		}
		record.AdmissionLockPresent = false
	}
	if !found {
		return blocked, errors.New("rollback target lock not represented in profile")
	}
	profile.AdmissionLockPresent = false
	return reviewMSIRollbackWithProfile(root, key, profile, verify)
}

func reviewRollbackWithOwnedLocks(root, key, journalSHA string, prepared bool) (msiRollbackReview, error) {
	profile, err := inspectMSIProfile(root)
	if err != nil {
		return msiRollbackReview{}, err
	}
	return reviewRollbackWithOwnedProfile(root, key, journalSHA, profile, prepared, verifyRegularDigest)
}

func requireCommittedMSIRollbackJournal(root string, m manifest, predecessor, successor *msiFrozenSource, successorVersion, journalSHA string) error {
	if predecessor == nil || successor == nil || m.Installer == nil || !validDigest(journalSHA) {
		return errors.New("rollback committed custody absent")
	}
	state, err := inspectMSIRollback(root, m.PackageKey)
	if err != nil || !state.HasReceipt || state.Receipt == nil || state.State != "msi-rollback_started_outcome_unknown" || !state.ManualReviewRequired || state.RetryAuthorized || state.OSAttested {
		return errors.New("rollback committed journal missing or altered")
	}
	rec := state.Receipt
	if rec.Operation != "msi-rollback" || rec.PackageKey != m.PackageKey || rec.ProductCode != m.Installer.ProductCode ||
		rec.ProductVersion != m.Installer.ProductVersion || rec.PriorProductVersion != successorVersion ||
		rec.MSISha256 != predecessor.sha256 || rec.PriorMSISha256 != predecessor.sha256 ||
		rec.SuccessorMSISha256 != successor.sha256 || rec.UpgradeJournalSha256 != journalSHA ||
		rec.ArtifactSha256 != m.ArtifactSha256 || rec.MSIPath != m.Installer.Path || rec.State != state.State {
		return errors.New("rollback launch journal custody mismatched")
	}
	upgraded, err := inspectMSIUpgrade(root, m.PackageKey)
	if err != nil || upgraded.ReceiptSha256 != journalSHA || !upgraded.HasReceipt || upgraded.Receipt == nil ||
		(upgraded.State != "upgrade_exit_zero_not_os_attested" && upgraded.State != "upgrade_restart_required_not_os_attested") ||
		upgraded.Receipt.MSISha256 != successor.sha256 || upgraded.Receipt.ProductVersion != successorVersion {
		return errors.New("completed upgrade changed before rollback resume")
	}
	// Check for newly recorded dependencies and changed product registration
	// under this process's locks directly before the suspended msiexec resumes.
	late, err := reviewRollbackWithOwnedLocks(root, m.PackageKey, journalSHA, true)
	if err != nil || late.State != "reviewable_not_authorized" || len(late.OutstandingDependents) != 0 ||
		late.UpgradeJournalSha256 != journalSHA || late.PredecessorMSISha256 != predecessor.sha256 ||
		late.SuccessorMSISha256 != successor.sha256 || late.SuccessorProductVersion != successorVersion {
		return errors.New("late rollback dependency or product custody changed")
	}
	return nil
}

func rollbackSupervisedMSI(o options, now time.Time) (msiRepairReceipt, error) {
	var out msiRepairReceipt
	if hostPlatform() != "windows-x64" || os.Getenv("CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION") != "true" {
		return out, errors.New("supervised MSI rollback requires independent Windows opt-in")
	}
	m, archive, signing, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Platform != "windows-x64" || m.Installer == nil || m.Installer.Scope != "user" {
		return out, errors.New("rollback target must be signed per-user Windows MSI")
	}
	grant, err := verifyDeploymentGrant(o, m, signing, "msi-rollback", now)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil || directoryNoLinks(root) != nil {
		return out, errors.New("unsafe rollback profile root")
	}
	if err = verifyStaged(root, m, archive, signing); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	if err = directoryNoLinks(filepath.Join(root, "msi-attempts")); err != nil {
		return out, err
	}
	unlockGlobal, err := acquireMSIInstallLock(root, "msi-admission")
	if err != nil {
		return out, err
	}
	defer unlockGlobal()
	unlockPackage, err := acquireMSIInstallLock(filepath.Join(root, "msi-attempts"), m.PackageKey)
	if err != nil {
		return out, err
	}
	defer unlockPackage()
	lifecycle := filepath.Join(root, "msi-lifecycle")
	if err = directoryNoLinks(lifecycle); err != nil {
		return out, err
	}
	journalPath := filepath.Join(lifecycle, "rollback_"+m.PackageKey+".json")
	if _, e := os.Lstat(journalPath); e == nil {
		return out, errors.New("rollback already attempted; never replay")
	} else if !os.IsNotExist(e) {
		return out, e
	}
	review, err := reviewRollbackWithOwnedLocks(root, m.PackageKey, grant.UpgradeJournalSha256, false)
	if err != nil {
		return out, err
	}
	if review.State != "reviewable_not_authorized" || len(review.OutstandingDependents) != 0 ||
		len(review.SettledDependents) != len(review.KnownDependents) || len(review.RecoveryOrder) != len(review.KnownDependents)+1 ||
		review.RecoveryOrder[len(review.RecoveryOrder)-1] != m.PackageKey ||
		review.PriorReceiptSha256 != grant.PriorReceiptSha256 || review.UpgradeJournalSha256 != grant.UpgradeJournalSha256 ||
		review.PredecessorMSISha256 != grant.PriorMSISha256 || review.SuccessorMSISha256 != grant.SuccessorMSISha256 ||
		review.PredecessorProductVersion != m.Installer.ProductVersion {
		return out, errors.New("signed rollback grant differs from exact recovery evidence")
	}
	old, err := inspectMSIAttempt(root, m.PackageKey)
	if err != nil || old.Attempt == nil || old.ReceiptSha256 != grant.PriorReceiptSha256 ||
		old.Attempt.Version != m.Version || old.Attempt.ArtifactSha256 != m.ArtifactSha256 ||
		old.Attempt.MSIPath != m.Installer.Path || old.Attempt.MSISha256 != m.Installer.Sha256 {
		return out, errors.New("signed predecessor release differs from original installation")
	}
	predecessorFile := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	identity, identityErr := inspectStagedMSIProperties(predecessorFile, *m.Installer)
	if identityErr != nil || !identity.Verified {
		return out, errors.New("retained predecessor MSI identity differs from signed declaration")
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	// Immutable evidence is created before any one-use authority is consumed.
	out = msiRepairReceipt{Schema: 1, Operation: "msi-rollback", PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSISha256: m.Installer.Sha256, MSIPath: m.Installer.Path, ProductCode: m.Installer.ProductCode,
		ProductVersion: m.Installer.ProductVersion, PriorReceiptSha256: grant.PriorReceiptSha256, PriorMSISha256: grant.PriorMSISha256,
		PriorProductVersion: review.SuccessorProductVersion, UpgradeJournalSha256: grant.UpgradeJournalSha256,
		SuccessorMSISha256: grant.SuccessorMSISha256, State: "msi-rollback_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err = writeFirstMSIRepairReceipt(journalPath, out); err != nil {
		return out, err
	}
	if err = consumeGrant(root, grant); err != nil {
		return out, err
	}
	again, err := reviewRollbackWithOwnedLocks(root, m.PackageKey, grant.UpgradeJournalSha256, true)
	if err != nil || again.State != "reviewable_not_authorized" || again.PriorReceiptSha256 != review.PriorReceiptSha256 ||
		again.PredecessorMSISha256 != review.PredecessorMSISha256 || again.SuccessorMSISha256 != review.SuccessorMSISha256 ||
		again.SuccessorProductVersion != review.SuccessorProductVersion || len(again.OutstandingDependents) != 0 || len(again.SettledDependents) != len(review.SettledDependents) {
		return out, errors.New("rollback evidence changed after grant consumption")
	}
	predecessorPath := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	upgraded, err := inspectMSIUpgrade(root, m.PackageKey)
	if err != nil || upgraded.Receipt == nil || upgraded.ReceiptSha256 != grant.UpgradeJournalSha256 {
		return out, errors.New("upgrade journal changed before rollback")
	}
	successorPath := filepath.Join(root, "staged", upgraded.Receipt.ArtifactSha256, filepath.FromSlash(upgraded.Receipt.MSIPath))
	predecessor, err := acquireMSIFrozenSource(predecessorPath, grant.PriorMSISha256)
	if err != nil {
		return out, err
	}
	defer predecessor.close()
	successor, err := acquireMSIFrozenSource(successorPath, grant.SuccessorMSISha256)
	if err != nil {
		return out, err
	}
	defer successor.close()
	observed, readErr := queryInstalledMSIProduct(m.Installer.ProductCode, review.SuccessorProductVersion)
	if err = requireExactMSIRepairRegistration(observed, readErr, m.Installer.ProductCode, review.SuccessorProductVersion); err != nil {
		return out, err
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	if err = predecessor.verify(); err != nil {
		return out, err
	}
	if err = successor.verify(); err != nil {
		return out, err
	}
	out.State = "msi-rollback_started_outcome_unknown"
	out.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(journalPath, out); err != nil {
		return out, err
	}
	if err = requireCommittedMSIRollbackJournal(root, m, predecessor, successor, review.SuccessorProductVersion, grant.UpgradeJournalSha256); err != nil {
		return out, err
	}
	// Windows Installer can refuse same-ProductCode downgrades. Never force an
	// uninstall or bypass custom actions to manufacture a successful rollback.
	exitCode, execErr := runWindowsUserMSIRollback(predecessor, successor, observed, root, m, grant.UpgradeJournalSha256)
	out.ExitCode, out.FinishedAt = exitCode, time.Now().UTC().Format(time.RFC3339Nano)
	switch {
	case execErr != nil:
		out.State = "msi-rollback_failed_or_outcome_unknown"
	case exitCode == 0:
		out.State = "msi-rollback_exit_zero_not_os_attested"
	case exitCode == 3010:
		out.State = "msi-rollback_restart_required_not_os_attested"
	default:
		out.State = "msi-rollback_failed_or_outcome_unknown"
	}
	if err = writeRawMSIRepairReceipt(journalPath, out); err != nil {
		return out, fmt.Errorf("rollback outcome uncertain; durable journal write failed: %w", err)
	}
	if execErr != nil {
		return out, execErr
	}
	if exitCode != 0 && exitCode != 3010 {
		return out, fmt.Errorf("Windows Installer refused or failed rollback with code %d; manual recovery required", exitCode)
	}
	return out, nil
}

package main

// One-use, independently signed, same-ProductCode per-user MSI upgrade.
// Never rewrites the original installation receipt or automatically retries,
// downgrades or rolls back an uncertain Windows Installer outcome.
import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func reviewUpgradeWithOwnedLocks(root string, m manifest, priorReceipt, priorMSI string, ourJournal bool) (msiUpgradeReadiness, error) {
	profile, err := inspectMSIProfile(root)
	if err != nil || !profile.Complete || !profile.AdmissionLockPresent || !profile.ReadOnly || profile.OSAttested {
		return msiUpgradeReadiness{}, errors.New("upgrade profile evidence incomplete or admission lock lost")
	}
	return reviewUpgradeWithOwnedProfile(root, m, priorReceipt, priorMSI, ourJournal, profile, verifyRegularDigest)
}

// A validated operation may ignore only its own process-owned admission locks
// and its own already verified prepared journal. Every foreign mutation holds.
func reviewUpgradeWithOwnedProfile(root string, m manifest, priorReceipt, priorMSI string, ourJournal bool, profile msiProfileStatus, verify func(string, string) error) (msiUpgradeReadiness, error) {
	if !profile.Complete || !profile.AdmissionLockPresent || !profile.ReadOnly || profile.OSAttested {
		return msiUpgradeReadiness{}, errors.New("upgrade requires verified owned admission")
	}
	if ourJournal {
		if len(profile.LifecycleRecords) != 1 || profile.LifecycleRecords[0].PackageKey != m.PackageKey ||
			profile.LifecycleRecords[0].Receipt == nil || profile.LifecycleRecords[0].Receipt.Operation != "upgrade" ||
			profile.LifecycleRecords[0].Receipt.PriorReceiptSha256 != priorReceipt ||
			profile.LifecycleRecords[0].Receipt.PriorMSISha256 != priorMSI ||
			profile.LifecycleRecords[0].State != "upgrade_prepared_not_launched" ||
			profile.LifecycleRecords[0].Receipt.State != profile.LifecycleRecords[0].State {
			return msiUpgradeReadiness{}, errors.New("unknown or changed upgrade lifecycle journal")
		}
		profile.LifecycleRecords = nil // precisely our own already validated journal
	} else if len(profile.LifecycleRecords) != 0 {
		return msiUpgradeReadiness{}, errors.New("prior lifecycle journal blocks upgrade")
	}
	profile.Records = append([]msiAttemptStatus(nil), profile.Records...)
	ownLock := false
	for i := range profile.Records {
		record := &profile.Records[i]
		if record.PackageKey == m.PackageKey {
			if !record.LockPresent {
				return msiUpgradeReadiness{}, errors.New("upgrade package admission lock missing")
			}
			ownLock = true
			record.LockPresent = false // This lock was acquired by our own operation, never a foreign lock.
		} else if record.LockPresent {
			return msiUpgradeReadiness{}, errors.New("foreign package lock blocks upgrade")
		}
		record.AdmissionLockPresent = false
	}
	if !ownLock {
		return msiUpgradeReadiness{}, errors.New("upgrade package lock unobservable")
	}
	profile.AdmissionLockPresent = false
	review, err := reviewMSIUpgradeWithProfile(root, m, priorReceipt, profile, verify)
	if err != nil {
		return review, err
	}
	if review.PriorMSISha256 != priorMSI {
		return review, errors.New("upgrade grant predecessor MSI digest differs from retained signed source")
	}
	return review, nil
}

// The final resumed child must see the exact persisted started journal; an
// interrupted or replaced journal is never proof that replay is acceptable.
func requireCommittedMSIUpgradeJournal(root string, m manifest, predecessor *msiFrozenSource, priorVersion, priorReceiptSha string) error {
	if m.Installer == nil || predecessor == nil || !validDigest(predecessor.sha256) {
		return errors.New("upgrade predecessor or signed target absent")
	}
	status, err := inspectMSIUpgrade(root, m.PackageKey)
	if err != nil || !status.HasReceipt || !status.ManualReviewRequired || status.Receipt == nil ||
		status.Receipt.Operation != "upgrade" || status.State != "upgrade_started_outcome_unknown" ||
		status.Receipt.PriorReceiptSha256 != priorReceiptSha ||
		status.Receipt.State != status.State || !validDigest(status.Receipt.PriorReceiptSha256) ||
		status.Receipt.PriorMSISha256 != predecessor.sha256 || status.Receipt.PriorProductVersion != priorVersion ||
		status.Receipt.ProductCode != m.Installer.ProductCode || status.Receipt.ProductVersion != m.Installer.ProductVersion ||
		status.Receipt.ArtifactSha256 != m.ArtifactSha256 || status.Receipt.MSISha256 != m.Installer.Sha256 || status.Receipt.MSIPath != m.Installer.Path ||
		status.Receipt.Version != m.Version || status.Receipt.OSAttested || status.RetryAuthorized {
		return errors.New("upgrade committed journal changed; suspended process must not execute")
	}
	return nil
}

func upgradeSupervisedMSI(o options, now time.Time) (msiRepairReceipt, error) {
	var out msiRepairReceipt
	if hostPlatform() != "windows-x64" {
		return out, errors.New("supervised upgrade requires Windows x64")
	}
	if os.Getenv("CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION") != "true" {
		return out, errors.New("native MSI upgrade execution requires explicit independent opt-in")
	}
	m, archive, signingPin, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if m.Installer == nil || m.Installer.Scope != "user" {
		return out, errors.New("upgrade requires signed user-scope MSI")
	}
	grant, err := verifyDeploymentGrant(o, m, signingPin, "upgrade", now)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil || directoryNoLinks(root) != nil {
		return out, errors.New("unsafe upgrade profile root")
	}
	if err = verifyStaged(root, m, archive, signingPin); err != nil {
		return out, err
	}
	if err = verifySelectedDependencies(root, m); err != nil {
		return out, err
	}
	targetPath := filepath.Join(root, "staged", m.ArtifactSha256, filepath.FromSlash(m.Installer.Path))
	if err = verifyRegularDigest(targetPath, m.Installer.Sha256); err != nil {
		return out, err
	}
	identity, identityErr := inspectStagedMSIProperties(targetPath, *m.Installer)
	if identityErr != nil || !identity.Verified {
		return out, errors.New("signed successor MSI identity mismatch")
	}
	parent := filepath.Join(root, "msi-attempts")
	if err = directoryNoLinks(parent); err != nil {
		return out, err
	}
	unlockGlobal, err := acquireMSIInstallLock(root, "msi-admission")
	if err != nil {
		return out, err
	}
	defer unlockGlobal()
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
	journalPath := filepath.Join(journalDir, m.PackageKey+".json")
	if _, e := os.Lstat(journalPath); e == nil {
		return out, errors.New("existing lifecycle action blocks upgrade replay")
	} else if !os.IsNotExist(e) {
		return out, e
	}
	review, err := reviewUpgradeWithOwnedLocks(root, m, grant.PriorReceiptSha256, grant.PriorMSISha256, false)
	if err != nil {
		return out, err
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	dependencies, err := inspectMSIInstalledDependencies(root, m)
	if err != nil {
		return out, err
	}
	// First durable evidence is written BEFORE consuming any one-use authority.
	out = msiRepairReceipt{Schema: 1, Operation: "upgrade", PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, MSISha256: m.Installer.Sha256, MSIPath: m.Installer.Path, ProductCode: m.Installer.ProductCode,
		ProductVersion: m.Installer.ProductVersion, PriorReceiptSha256: grant.PriorReceiptSha256,
		PriorMSISha256: grant.PriorMSISha256, PriorProductVersion: review.PriorProductVersion,
		State: "upgrade_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano), OSAttested: false}
	if err = writeFirstMSIRepairReceipt(journalPath, out); err != nil {
		return out, err
	}
	if err = consumeGrant(root, grant); err != nil {
		return out, err
	}
	current, err := reviewUpgradeWithOwnedLocks(root, m, grant.PriorReceiptSha256, grant.PriorMSISha256, true)
	if err != nil || current.PriorProductVersion != review.PriorProductVersion || current.PriorMSIPath != review.PriorMSIPath {
		return out, errors.New("upgrade predecessor or registration changed after grant consumption")
	}
	if err = requireCurrentUserMSIInstallScope(m.Installer.ProductCode); err != nil {
		return out, err
	}
	if err = requireUnchangedMSIInstalledDependencies(root, m, dependencies); err != nil {
		return out, err
	}
	// The predecessor archive digest is obtained from the original local receipt,
	// not from a renderer-controlled path, release or token.
	original, err := inspectMSIAttempt(root, m.PackageKey)
	if err != nil || original.Attempt == nil || original.ReceiptSha256 != grant.PriorReceiptSha256 {
		return out, errors.New("original upgrade installation receipt changed")
	}
	previousPath := filepath.Join(root, "staged", original.Attempt.ArtifactSha256, filepath.FromSlash(review.PriorMSIPath))
	predecessor, err := acquireMSIFrozenSource(previousPath, grant.PriorMSISha256)
	if err != nil {
		return out, err
	}
	defer predecessor.close()
	target, err := acquireMSIFrozenSource(targetPath, m.Installer.Sha256)
	if err != nil {
		return out, err
	}
	defer target.close()
	baseline, queryErr := queryInstalledMSIProduct(m.Installer.ProductCode, review.PriorProductVersion)
	if err = requireExactMSIRepairRegistration(baseline, queryErr, m.Installer.ProductCode, review.PriorProductVersion); err != nil {
		return out, err
	}
	if err = predecessor.verify(); err != nil {
		return out, err
	}
	out.State = "upgrade_started_outcome_unknown"
	out.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(journalPath, out); err != nil {
		return out, err
	}
	if err = requireCommittedMSIUpgradeJournal(root, m, predecessor, review.PriorProductVersion, grant.PriorReceiptSha256); err != nil {
		return out, err
	}
	code, execErr := runWindowsUserMSIUpgrade(target, predecessor, baseline, root, m, dependencies, grant.PriorReceiptSha256)
	out.ExitCode, out.FinishedAt = code, time.Now().UTC().Format(time.RFC3339Nano)
	switch {
	case execErr != nil:
		out.State = "upgrade_failed_or_outcome_unknown"
	case code == 0:
		out.State = "upgrade_exit_zero_not_os_attested"
	case code == 3010:
		out.State = "upgrade_restart_required_not_os_attested"
	default:
		out.State = "upgrade_failed_or_outcome_unknown"
	}
	if err = writeRawMSIRepairReceipt(journalPath, out); err != nil {
		return out, fmt.Errorf("upgrade outcome uncertain; journal write failed: %w", err)
	}
	if execErr != nil {
		return out, execErr
	}
	if code != 0 && code != 3010 {
		return out, fmt.Errorf("upgrade msiexec exited %d; manual review required", code)
	}
	return out, nil
}

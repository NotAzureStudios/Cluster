package main

// Rollback is a separate recovery decision, NOT a reverse upgrade or permission
// to execute msiexec. A current Windows registration result cannot attest
// application health or prove unknown third-party dependencies are absent.
import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
)

type msiRollbackReview struct {
	Schema                    int    `json:"schema"`
	PackageKey                string `json:"packageKey"`
	State                     string `json:"state"`
	ReadOnly                  bool   `json:"readOnly"`
	OSAttested                bool   `json:"osAttested"`
	MutationAuthorized        bool   `json:"mutationAuthorized"`
	RollbackAuthorized        bool   `json:"rollbackAuthorized"`
	PriorReceiptSha256        string `json:"priorReceiptSha256,omitempty"`
	UpgradeJournalSha256      string `json:"upgradeJournalSha256,omitempty"`
	PredecessorMSISha256      string `json:"predecessorMsiSha256,omitempty"`
	SuccessorMSISha256        string `json:"successorMsiSha256,omitempty"`
	PredecessorProductVersion string `json:"predecessorProductVersion,omitempty"`
	SuccessorProductVersion   string `json:"successorProductVersion,omitempty"`
	// KnownDependents are transitive. RecoveryOrder is dependents first,
	// then the requested Package. These are human review steps only.
	KnownDependents       []string `json:"knownDependents"`
	SettledDependents     []string `json:"settledDependents"`
	OutstandingDependents []string `json:"outstandingDependents"`
	RecoveryOrder         []string `json:"recoveryOrder"`
	Blockers              []string `json:"blockers"`
	Warnings              []string `json:"warnings"`
}

// This order comes solely from receipt-bound, coherent dependency evidence.
// Cycles and edges to unknown owners fail closed instead of being guessed away.
func rollbackDependencyOrder(key string, records []msiAttemptStatus, edges []msiDependencyEdge) ([]string, []string, error) {
	if !validPackageKey(key) || len(records) > maxMSIProfileEntries || len(edges) > maxMSIProfileDependencyEdges {
		return nil, nil, errors.New("rollback dependency graph exceeds bounds or has invalid target")
	}
	expected, err := knownMSIDependencyEdges(records)
	if err != nil || len(expected) != len(edges) {
		return nil, nil, errors.New("rollback dependency evidence differs from receipts")
	}
	for i := range expected {
		if expected[i] != edges[i] {
			return nil, nil, errors.New("rollback dependency edge mismatch")
		}
	}
	known := map[string]bool{}
	for _, rec := range records {
		known[rec.PackageKey] = true
	}
	if !known[key] {
		return nil, nil, errors.New("rollback target not in profile")
	}
	forward := map[string][]string{}
	for _, edge := range edges {
		if !edge.RecordedReceiptMatches || !known[edge.DependencyPackageKey] || !known[edge.DependentPackageKey] || edge.DependentPackageKey == edge.DependencyPackageKey {
			return nil, nil, errors.New("rollback dependency graph contains unresolved evidence")
		}
		forward[edge.DependencyPackageKey] = append(forward[edge.DependencyPackageKey], edge.DependentPackageKey)
	}
	for k := range forward {
		sort.Strings(forward[k])
	}
	visiting := map[string]int{}
	order := make([]string, 0, len(records))
	var visit func(string) error
	visit = func(node string) error {
		if visiting[node] == 1 {
			return errors.New("cyclic MSI dependency rollback graph")
		}
		if visiting[node] == 2 {
			return nil
		}
		visiting[node] = 1
		for _, dependent := range forward[node] {
			if err := visit(dependent); err != nil {
				return err
			}
		}
		visiting[node] = 2
		order = append(order, node)
		return nil
	}
	if err := visit(key); err != nil {
		return nil, nil, err
	}
	dependents := append([]string(nil), order[:len(order)-1]...)
	if dependents == nil {
		dependents = []string{}
	}
	return dependents, order, nil
}

func reviewMSIRollbackWithProfile(root, key string, profile msiProfileStatus, verify func(string, string) error) (msiRollbackReview, error) {
	out := msiRollbackReview{Schema: 1, PackageKey: key, State: "blocked", ReadOnly: true, OSAttested: false, MutationAuthorized: false, RollbackAuthorized: false,
		KnownDependents: []string{}, SettledDependents: []string{}, OutstandingDependents: []string{}, RecoveryOrder: []string{}, Blockers: []string{},
		Warnings: []string{"external_os_dependents_not_excluded", "windows_installer_downgrade_semantics_unverified", "application_health_not_attested", "independent_rollback_grant_required"}}
	if !validPackageKey(key) || verify == nil || !profile.Complete || !profile.ReadOnly || profile.OSAttested ||
		profile.RetryAuthorized || profile.LifecycleMutationAuthorized || profile.AdmissionLockPresent || len(profile.Records) > maxMSIProfileEntries {
		return out, errors.New("rollback requires a complete read-only unlocked profile")
	}
	var old *msiAttemptStatus
	for i := range profile.Records {
		if profile.Records[i].PackageKey == key {
			old = &profile.Records[i]
		}
		if profile.Records[i].LockPresent || profile.Records[i].AdmissionLockPresent {
			return out, errors.New("MSI operation lock blocks rollback")
		}
	}
	if old == nil || !old.HasReceipt || old.Attempt == nil || !validDigest(old.ReceiptSha256) ||
		(old.State != "msi_exit_zero_not_os_attested" && old.State != "msi_restart_required_not_os_attested") ||
		old.Attempt.State != old.State || old.Attempt.PreLaunchRegistration == nil || old.Attempt.PostExitRegistration == nil ||
		!validDigest(old.Attempt.ArtifactSha256) || !validDigest(old.Attempt.MSISha256) ||
		!msiPathPattern.MatchString(old.Attempt.MSIPath) || secureName(old.Attempt.MSIPath) != nil {
		return out, errors.New("original installation custody is incomplete")
	}
	// An unrelated in-flight, unreadable or same-ProductCode Package defeats
	// the claimed exclusive ownership of the Windows Installer identity.
	for _, record := range profile.Records {
		if record.PackageKey == key {
			continue
		}
		if !record.HasReceipt || record.Attempt == nil || !validDigest(record.ReceiptSha256) ||
			(record.State != "msi_exit_zero_not_os_attested" && record.State != "msi_restart_required_not_os_attested") ||
			record.Attempt.ProductCode == old.Attempt.ProductCode {
			return out, errors.New("foreign or incomplete MSI Package custody blocks rollback")
		}
	}
	var journal msiRepairStatus
	upgradeCount := 0
	for _, held := range profile.LifecycleRecords {
		if held.PackageKey == key && held.Receipt != nil && held.Receipt.Operation == "upgrade" {
			upgradeCount++
			journal = held
		}
	}
	if upgradeCount != 1 {
		return out, errors.New("rollback requires exactly one predecessor-bound upgrade journal")
	}
	if journal.PackageKey != key || !journal.HasReceipt || journal.Receipt == nil || !validDigest(journal.ReceiptSha256) ||
		journal.Receipt.Operation != "upgrade" || journal.Receipt.PackageKey != key || journal.Receipt.OSAttested ||
		journal.Receipt.PriorReceiptSha256 != old.ReceiptSha256 ||
		journal.Receipt.PriorMSISha256 != old.Attempt.MSISha256 ||
		journal.Receipt.ProductCode != old.Attempt.ProductCode ||
		journal.Receipt.PriorProductVersion != old.Attempt.ProductVersion ||
		!validDigest(journal.Receipt.ArtifactSha256) || !validDigest(journal.Receipt.MSISha256) ||
		journal.Receipt.ArtifactSha256 == old.Attempt.ArtifactSha256 ||
		journal.State != journal.Receipt.State || !journal.ReadOnly || journal.OSAttested || journal.RetryAuthorized ||
		!journal.ManualReviewRequired || (journal.State != "upgrade_exit_zero_not_os_attested" && journal.State != "upgrade_restart_required_not_os_attested") ||
		journal.UpgradeRecovery == nil || journal.UpgradeRecovery.State != "upgrade_target_registered_not_health_attested" ||
		!journal.UpgradeRecovery.ReadOnly || journal.UpgradeRecovery.OSAttested || journal.UpgradeRecovery.RollbackAuthorized {
		return out, errors.New("upgrade outcome and predecessor linkage do not permit rollback review")
	}
	if _, err := compareMSIVersions(old.Attempt.ProductVersion, journal.Receipt.ProductVersion); err != nil {
		return out, err
	}
	registration := journal.UpgradeRecovery.Registration
	if registration.ProductCode != old.Attempt.ProductCode || registration.ExpectedVersion != journal.Receipt.ProductVersion ||
		registration.ReportedVersion != journal.Receipt.ProductVersion || !registration.VersionMatches ||
		registration.State != "registered_version_match" || !registration.ProbeComplete || !registration.ReadOnly || registration.OSAttested ||
		registration.ProbeScope != "current_user_and_machine" {
		return out, errors.New("current successor registration is not stable and exact")
	}
	// A journal written by an older executor can remain readable, but it
	// cannot prove successor source custody without a path recorded at launch.
	if journal.Receipt.MSIPath == "" || !msiPathPattern.MatchString(journal.Receipt.MSIPath) || secureName(journal.Receipt.MSIPath) != nil {
		out.Blockers = append(out.Blockers, "successor_installer_path_not_recorded")
	}
	dependents, order, err := rollbackDependencyOrder(key, profile.Records, profile.DependencyEdges)
	if err != nil {
		return out, err
	}
	out.KnownDependents, out.RecoveryOrder = dependents, order
	out.PriorReceiptSha256, out.UpgradeJournalSha256 = old.ReceiptSha256, journal.ReceiptSha256
	out.PredecessorMSISha256, out.SuccessorMSISha256 = old.Attempt.MSISha256, journal.Receipt.MSISha256
	out.PredecessorProductVersion, out.SuccessorProductVersion = old.Attempt.ProductVersion, journal.Receipt.ProductVersion
	dependentSet := make(map[string]bool, len(dependents))
	for _, dep := range dependents {
		dependentSet[dep] = true
	}
	for _, held := range profile.LifecycleRecords {
		if held.PackageKey == key && held.Receipt != nil && held.Receipt.Operation == "upgrade" {
			continue
		}
		if !dependentSet[held.PackageKey] || held.Receipt == nil || held.Receipt.Operation != "uninstall" {
			return out, errors.New("unrelated or forged lifecycle journal blocks rollback")
		}
	}
	for _, dep := range dependents {
		if observedSettledMSIUninstall(profile, dep) {
			out.SettledDependents = append(out.SettledDependents, dep)
		} else {
			out.OutstandingDependents = append(out.OutstandingDependents, dep)
		}
	}
	if len(out.OutstandingDependents) > 0 {
		out.Blockers = append(out.Blockers, "dependent_packages_require_separate_ordered_disposition")
	}
	oldPath := filepath.Join(root, "staged", old.Attempt.ArtifactSha256, filepath.FromSlash(old.Attempt.MSIPath))
	if err := verify(oldPath, old.Attempt.MSISha256); err != nil {
		out.Blockers = append(out.Blockers, "predecessor_installer_integrity_missing")
	}
	if journal.Receipt.MSIPath != "" && msiPathPattern.MatchString(journal.Receipt.MSIPath) && secureName(journal.Receipt.MSIPath) == nil {
		newPath := filepath.Join(root, "staged", journal.Receipt.ArtifactSha256, filepath.FromSlash(journal.Receipt.MSIPath))
		if err := verify(newPath, journal.Receipt.MSISha256); err != nil {
			out.Blockers = append(out.Blockers, "successor_installer_integrity_missing")
		}
	}
	if len(out.Blockers) == 0 {
		out.State = "reviewable_not_authorized"
	}
	return out, nil
}

func inspectMSIRollbackReview(root, key string) (msiRollbackReview, error) {
	out := msiRollbackReview{Schema: 1, PackageKey: key, State: "blocked", ReadOnly: true, Blockers: []string{}, Warnings: []string{}, KnownDependents: []string{}, RecoveryOrder: []string{}}
	if !validPackageKey(key) || root == "" {
		return out, errors.New("invalid rollback review target")
	}
	absolute, err := filepath.Abs(root)
	if err != nil || directoryNoLinks(absolute) != nil {
		return out, errors.New("unsafe rollback review root")
	}
	profile, err := inspectMSIProfile(absolute)
	if err != nil {
		return out, fmt.Errorf("rollback profile unavailable: %w", err)
	}
	return reviewMSIRollbackWithProfile(absolute, key, profile, verifyRegularDigest)
}

package main

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func rollbackReviewFixture() (msiProfileStatus, string) {
	_, p, _ := upgradeFixture()
	old := &p.Records[0]
	old.RegistrationDrift = "registration_changed_since_exit"
	old.Product.State = "registered_version_mismatch"
	old.Product.ReportedVersion = "1.5.0"
	old.Product.VersionMatches = false
	old.Product.ExpectedVersion = "1.4.2"
	receipt := msiRepairReceipt{Schema: 1, Operation: "upgrade", PackageKey: "studio-core", Version: "1.5.0",
		ProductCode: old.Attempt.ProductCode, ProductVersion: "1.5.0", PriorProductVersion: "1.4.2",
		ArtifactSha256: strings.Repeat("d", 64), MSISha256: strings.Repeat("e", 64), MSIPath: "install/studio-core.msi",
		PriorReceiptSha256: old.ReceiptSha256, PriorMSISha256: old.Attempt.MSISha256, State: "upgrade_exit_zero_not_os_attested"}
	observed := msiProductState{State: "registered_version_match", ProductCode: receipt.ProductCode, ExpectedVersion: "1.5.0", ReportedVersion: "1.5.0", VersionMatches: true, ReadOnly: true, ProbeScope: "current_user_and_machine", ProbeComplete: true}
	p.LifecycleRecords = []msiRepairStatus{{Schema: 1, PackageKey: "studio-core", State: receipt.State, HasReceipt: true, ReadOnly: true, ManualReviewRequired: true, ReceiptSha256: strings.Repeat("f", 64), Receipt: &receipt,
		UpgradeRecovery: &msiUpgradeRecovery{State: "upgrade_target_registered_not_health_attested", ReadOnly: true, Registration: observed}}}
	return p, "studio-core"
}
func TestRollbackReviewRequiresBothRetainedSourcesAndNeverAuthorizes(t *testing.T) {
	p, key := rollbackReviewFixture()
	root := t.TempDir()
	paths := []string{}
	check := func(path, sha string) error {
		paths = append(paths, path)
		if !validDigest(sha) {
			return errors.New("bad digest")
		}
		return nil
	}
	out, e := reviewMSIRollbackWithProfile(root, key, p, check)
	if e != nil || out.State != "reviewable_not_authorized" || !out.ReadOnly || out.OSAttested || out.RollbackAuthorized || out.MutationAuthorized ||
		out.PredecessorMSISha256 != p.Records[0].Attempt.MSISha256 || out.UpgradeJournalSha256 != p.LifecycleRecords[0].ReceiptSha256 || len(out.RecoveryOrder) != 1 || out.RecoveryOrder[0] != key || len(paths) != 2 {
		t.Fatalf("valid review refused %v %+v paths %v", e, out, paths)
	}
	if paths[0] != filepath.Join(root, "staged", p.Records[0].Attempt.ArtifactSha256, "install", "studio-core.msi") ||
		paths[1] != filepath.Join(root, "staged", p.LifecycleRecords[0].Receipt.ArtifactSha256, "install", "studio-core.msi") {
		t.Fatal("wrong trusted paths", paths)
	}
	for name, fail := range map[string]int{"predecessor": 1, "successor": 2} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			got, e := reviewMSIRollbackWithProfile(root, key, p, func(string, string) error {
				calls++
				if calls == fail {
					return errors.New("source changed")
				}
				return nil
			})
			if e != nil || got.State != "blocked" || len(got.Blockers) != 1 || got.RollbackAuthorized {
				t.Fatalf("source failure escaped %+v %v", got, e)
			}
		})
	}
	old := *p.LifecycleRecords[0].Receipt
	old.MSIPath = ""
	p.LifecycleRecords[0].Receipt = &old
	got, e := reviewMSIRollbackWithProfile(root, key, p, check)
	if e != nil || got.State != "blocked" || len(got.Blockers) != 1 || got.Blockers[0] != "successor_installer_path_not_recorded" {
		t.Fatalf("legacy receipt falsely reviewable %+v %v", got, e)
	}
}
func TestRollbackReviewRejectsForgedCustodyAndUnexpectedStates(t *testing.T) {
	p, key := rollbackReviewFixture()
	cases := map[string]func(*msiProfileStatus){
		"foreign upgrade":             func(x *msiProfileStatus) { x.LifecycleRecords[0].Receipt.PackageKey = "other" },
		"changed original receipt":    func(x *msiProfileStatus) { x.Records[0].ReceiptSha256 = strings.Repeat("1", 64) },
		"changed predecessor MSI":     func(x *msiProfileStatus) { x.LifecycleRecords[0].Receipt.PriorMSISha256 = strings.Repeat("1", 64) },
		"changed predecessor version": func(x *msiProfileStatus) { x.LifecycleRecords[0].Receipt.PriorProductVersion = "1.4.3" },
		"unknown process outcome": func(x *msiProfileStatus) {
			x.LifecycleRecords[0].Receipt.State = "upgrade_failed_or_outcome_unknown"
			x.LifecycleRecords[0].State = "upgrade_failed_or_outcome_unknown"
		},
		"changed successor product": func(x *msiProfileStatus) {
			x.LifecycleRecords[0].UpgradeRecovery.Registration.ReportedVersion = "1.5.1"
		},
		"forged rollback authority": func(x *msiProfileStatus) { x.LifecycleRecords[0].UpgradeRecovery.RollbackAuthorized = true },
		"forged OS attestation":     func(x *msiProfileStatus) { x.LifecycleRecords[0].Receipt.OSAttested = true },
		"foreign lifecycle": func(x *msiProfileStatus) {
			x.LifecycleRecords = append(x.LifecycleRecords, msiRepairStatus{PackageKey: "foreign"})
		},
		"foreign lock":              func(x *msiProfileStatus) { x.AdmissionLockPresent = true },
		"original receipt missing":  func(x *msiProfileStatus) { x.Records[0].HasReceipt = false },
		"original source traversal": func(x *msiProfileStatus) { x.Records[0].Attempt.MSIPath = "../evil.msi" },
		"original unknown":          func(x *msiProfileStatus) { x.Records[0].State = "msi_failed_or_outcome_unknown" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			x := p
			x.Records = append([]msiAttemptStatus(nil), p.Records...)
			a := *x.Records[0].Attempt
			x.Records[0].Attempt = &a
			x.LifecycleRecords = append([]msiRepairStatus(nil), p.LifecycleRecords...)
			r := *x.LifecycleRecords[0].Receipt
			x.LifecycleRecords[0].Receipt = &r
			recovery := *x.LifecycleRecords[0].UpgradeRecovery
			x.LifecycleRecords[0].UpgradeRecovery = &recovery
			mutate(&x)
			out, e := reviewMSIRollbackWithProfile(t.TempDir(), key, x, func(string, string) error { return nil })
			if e == nil && out.State == "reviewable_not_authorized" {
				t.Fatalf("unsafe rollback review accepted %+v", out)
			}
		})
	}
}
func TestRollbackDependencyOrderTransitiveCycleAndDrift(t *testing.T) {
	root := sampleInstalledDependencyStatus("studio-core", "1.4.2")
	child := sampleInstalledDependencyStatus("studio-editor", "2.0.0")
	grand := sampleInstalledDependencyStatus("studio-project", "3.0.0")
	child.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: "studio-core", Version: root.Attempt.Version, ProductCode: root.Attempt.ProductCode, ProductVersion: root.Attempt.ProductVersion, ReceiptSha256: root.ReceiptSha256}}
	grand.Attempt.Dependencies = []msiDependencyEvidence{{PackageKey: "studio-editor", Version: child.Attempt.Version, ProductCode: child.Attempt.ProductCode, ProductVersion: child.Attempt.ProductVersion, ReceiptSha256: child.ReceiptSha256}}
	records := []msiAttemptStatus{root, child, grand}
	edges, e := knownMSIDependencyEdges(records)
	if e != nil {
		t.Fatal(e)
	}
	dependents, order, e := rollbackDependencyOrder("studio-core", records, edges)
	if e != nil || strings.Join(order, ",") != "studio-project,studio-editor,studio-core" || len(dependents) != 2 {
		t.Fatalf("order %+v %+v %v", dependents, order, e)
	}
	edges[0].RecordedReceiptMatches = false
	if _, _, e = rollbackDependencyOrder("studio-core", records, edges); e == nil {
		t.Fatal("changed dependency admitted")
	}
	grand.Attempt.Dependencies = append(grand.Attempt.Dependencies, msiDependencyEvidence{PackageKey: "studio-core", Version: root.Attempt.Version, ProductCode: root.Attempt.ProductCode, ProductVersion: root.Attempt.ProductVersion, ReceiptSha256: root.ReceiptSha256})
	child.Attempt.Dependencies = append(child.Attempt.Dependencies, msiDependencyEvidence{PackageKey: "studio-project", Version: grand.Attempt.Version, ProductCode: grand.Attempt.ProductCode, ProductVersion: grand.Attempt.ProductVersion, ReceiptSha256: grand.ReceiptSha256})
	edges, e = knownMSIDependencyEdges(records)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = rollbackDependencyOrder("studio-core", records, edges); e == nil {
		t.Fatal("cyclic dependency accepted")
	}
}

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRollbackOwnedLocksRejectForeignAndChangedJournal(t *testing.T) {
	p, key := rollbackReviewFixture()
	p.AdmissionLockPresent = true
	p.Records[0].LockPresent = true
	p.Records[0].AdmissionLockPresent = true
	journal := p.LifecycleRecords[0].ReceiptSha256
	check := func(string, string) error { return nil }
	out, err := reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, false, check)
	if err != nil || out.State != "reviewable_not_authorized" {
		t.Fatalf("owned admission refused: %+v %v", out, err)
	}
	prepared := msiRepairReceipt{Schema: 1, Operation: "msi-rollback", PackageKey: key, State: "msi-rollback_prepared_not_launched", PriorReceiptSha256: out.PriorReceiptSha256, PriorMSISha256: out.PredecessorMSISha256, SuccessorMSISha256: out.SuccessorMSISha256, UpgradeJournalSha256: journal}
	p.LifecycleRecords = append(p.LifecycleRecords, msiRepairStatus{Schema: 1, PackageKey: key, State: prepared.State, HasReceipt: true, ReadOnly: true, ManualReviewRequired: true, Receipt: &prepared})
	for _, state := range []string{"msi-rollback_prepared_not_launched", "msi-rollback_started_outcome_unknown"} {
		p.LifecycleRecords[1].State = state
		p.LifecycleRecords[1].Receipt.State = state
		out, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, true, check)
		if err != nil || out.State != "reviewable_not_authorized" {
			t.Fatalf("owned journal %q rejected: %+v %v", state, out, err)
		}
	}
	p.LifecycleRecords[1].Receipt.UpgradeJournalSha256 = strings.Repeat("a", 64)
	if _, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, true, check); err == nil {
		t.Fatal("changed upgrade digest allowed")
	}
	p.LifecycleRecords[1].Receipt.UpgradeJournalSha256 = journal
	p.LifecycleRecords[1].Receipt.State = "msi-rollback_failed_or_outcome_unknown"
	p.LifecycleRecords[1].State = p.LifecycleRecords[1].Receipt.State
	if _, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, true, check); err == nil {
		t.Fatal("previous failed rollback replayable")
	}
	p.LifecycleRecords[1].Receipt.State = "msi-rollback_prepared_not_launched"
	p.LifecycleRecords[1].State = p.LifecycleRecords[1].Receipt.State
	p.Records = append(p.Records, msiAttemptStatus{PackageKey: "foreign", LockPresent: true})
	if _, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, true, check); err == nil {
		t.Fatal("foreign lock ignored")
	}
	p.Records = p.Records[:1]
	p.LifecycleRecords[1].Receipt.SuccessorMSISha256 = strings.Repeat("0", 64)
	if _, err = reviewRollbackWithOwnedProfile(t.TempDir(), key, journal, p, true, check); err == nil {
		t.Fatal("successor source changed")
	}
}

func TestRollbackJournalFailClosedStateAndTamper(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	const key = "studio-core"
	old, newer := strings.Repeat("a", 64), strings.Repeat("b", 64)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	receipt := msiRepairReceipt{Schema: 1, Operation: "msi-rollback", PackageKey: key, Version: "1.4.2", ArtifactSha256: old,
		MSISha256: old, MSIPath: "install/studio-core.msi", ProductCode: "{AABBCCDD-1234-5678-ABCD-1234567890AB}", ProductVersion: "1.4.2",
		PriorReceiptSha256: old, PriorMSISha256: old, PriorProductVersion: "1.5.0", UpgradeJournalSha256: newer, SuccessorMSISha256: newer,
		State: "msi-rollback_prepared_not_launched", StartedAt: now}
	path := filepath.Join(dir, "rollback_"+key+".json")
	write := func(v msiRepairReceipt) {
		t.Helper()
		b, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, b, 0600); e != nil {
			t.Fatal(e)
		}
	}
	write(receipt)
	status, err := inspectMSIRollback(root, key)
	if err != nil || status.Receipt == nil || status.State != receipt.State || status.RetryAuthorized || status.OSAttested || !status.ManualReviewRequired {
		t.Fatalf("valid prepared journal rejected: %+v %v", status, err)
	}
	if err = requireNoPriorMSILifecycle(root, key); err == nil {
		t.Fatal("rollback journal did not block new mutation")
	}
	cases := map[string]func(*msiRepairReceipt){
		"wrong operation":     func(v *msiRepairReceipt) { v.Operation = "upgrade" },
		"wrong digest":        func(v *msiRepairReceipt) { v.SuccessorMSISha256 = "BROKEN" },
		"missing upgrade":     func(v *msiRepairReceipt) { v.UpgradeJournalSha256 = "" },
		"source traversal":    func(v *msiRepairReceipt) { v.MSIPath = "../payload.msi" },
		"same version":        func(v *msiRepairReceipt) { v.PriorProductVersion = v.ProductVersion },
		"wrong direction":     func(v *msiRepairReceipt) { v.PriorProductVersion = "1.3.0" },
		"false health":        func(v *msiRepairReceipt) { v.OSAttested = true },
		"invented completion": func(v *msiRepairReceipt) { v.State = "msi-rollback_exit_zero_not_os_attested" },
		"wrong key":           func(v *msiRepairReceipt) { v.PackageKey = "elsewhere" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			bad := receipt
			mutate(&bad)
			write(bad)
			if _, err := inspectMSIRollback(root, key); err == nil {
				t.Fatal("corrupt journal passed read-only inspection")
			}
		})
	}
	write(receipt)
	// Reserved filename must be rejected when used to smuggle a repair/upgrade record.
	b, _ := json.Marshal(receipt)
	renamed := filepath.Join(dir, key+".json")
	if err := os.WriteFile(renamed, b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectMSIProfile(root); err == nil {
		t.Fatal("misnamed rollback journal admitted")
	}
}

func TestRollbackExecutorRefusesNonWindowsWithoutJournal(t *testing.T) {
	if hostPlatform() == "windows-x64" {
		t.Skip("Windows runtime is separately verified")
	}
	dir := t.TempDir()
	_, err := rollbackSupervisedMSI(options{Root: dir}, time.Now())
	if err == nil {
		t.Fatal("non-Windows attempted rollback execution")
	}
	if _, err := os.Stat(filepath.Join(dir, "msi-lifecycle")); !os.IsNotExist(err) {
		t.Fatal("non-Windows mutation wrote journal")
	}
}

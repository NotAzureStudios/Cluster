package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIUpgradeOwnedAdmissionAndExactPredecessor(t *testing.T) {
	m, p, sha := upgradeFixture()
	prior := p.Records[0].Attempt.MSISha256
	p.AdmissionLockPresent = true
	p.Records[0].AdmissionLockPresent = true
	p.Records[0].LockPresent = true
	root := t.TempDir()
	check := func(path, hash string) error {
		expected := filepath.Join(root, "staged", p.Records[0].Attempt.ArtifactSha256, "install", "studio-core.msi")
		if path != expected || hash != prior {
			t.Fatalf("upgrade predecessor confusion %s %s", path, hash)
		}
		return nil
	}
	result, err := reviewUpgradeWithOwnedProfile(root, m, sha, prior, false, p, check)
	if err != nil || result.State != "reviewable_not_authorized" {
		t.Fatalf("owned admission refused %+v %v", result, err)
	}
	// Foreign locks, lifecycle operations, changed grant hashes and missing
	// own locks are never normalized into an apparently safe profile.
	cases := map[string]func(*msiProfileStatus){
		"no global lock":       func(x *msiProfileStatus) { x.AdmissionLockPresent = false },
		"missing Package lock": func(x *msiProfileStatus) { x.Records[0].LockPresent = false },
		"foreign lifecycle":    func(x *msiProfileStatus) { x.LifecycleRecords = []msiRepairStatus{{PackageKey: "other"}} },
		"foreign lock": func(x *msiProfileStatus) {
			v := p.Records[0]
			v.PackageKey = "foreign"
			v.LockPresent = true
			x.Records = append(x.Records, v)
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			x := p
			x.Records = append([]msiAttemptStatus{}, p.Records...)
			mutate(&x)
			if _, err := reviewUpgradeWithOwnedProfile(root, m, sha, prior, false, x, check); err == nil {
				t.Fatal("unsafe profile admitted")
			}
		})
	}
	if _, err := reviewUpgradeWithOwnedProfile(root, m, sha, strings.Repeat("f", 64), false, p, check); err == nil {
		t.Fatal("wrong signed predecessor hash admitted")
	}
	ownReceipt := msiRepairReceipt{Schema: 1, Operation: "upgrade", PackageKey: m.PackageKey, PriorReceiptSha256: sha, PriorMSISha256: prior, State: "upgrade_prepared_not_launched"}
	p.LifecycleRecords = []msiRepairStatus{{PackageKey: m.PackageKey, State: ownReceipt.State, Receipt: &ownReceipt}}
	if _, err := reviewUpgradeWithOwnedProfile(root, m, sha, prior, true, p, check); err != nil {
		t.Fatal(err)
	}
	ownReceipt.State = "upgrade_started_outcome_unknown"
	if _, err := reviewUpgradeWithOwnedProfile(root, m, sha, prior, true, p, check); err == nil {
		t.Fatal("started journal cannot be normalized for a fresh execution")
	}
}

func TestUpgradeJournalDurableImmutablePredecessorAndAdversarialTamper(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "test-package.json")
	original := sampleRepairReceipt()
	original.Operation = "upgrade"
	original.State = "upgrade_prepared_not_launched"
	original.PriorMSISha256 = strings.Repeat("d", 64)
	original.PriorProductVersion = "1.0.0"
	if err := writeFirstMSIRepairReceipt(path, original); err != nil {
		t.Fatal(err)
	}
	if err := writeFirstMSIRepairReceipt(path, original); err == nil {
		t.Fatal("upgrade journal replay allowed")
	}
	found, err := inspectMSIUpgrade(root, "test-package")
	if err != nil || !found.HasReceipt || !found.ManualReviewRequired || found.RetryAuthorized || found.OSAttested {
		t.Fatalf("lost upgrade record %+v %v", found, err)
	}
	profile, err := inspectMSIProfile(root)
	if err != nil || len(profile.LifecycleRecords) != 1 || profile.LifecycleRecords[0].Receipt.Operation != "upgrade" {
		t.Fatalf("lost profile custody %+v %v", profile, err)
	}
	original.State = "upgrade_started_outcome_unknown"
	original.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(path, original); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIUpgrade(root, "test-package"); err != nil {
		t.Fatal(err)
	}
	original.State = "upgrade_restart_required_not_os_attested"
	original.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	original.ExitCode = 3010
	if err = writeRawMSIRepairReceipt(path, original); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIUpgrade(root, "test-package"); err != nil {
		t.Fatal(err)
	}
	for name, fn := range map[string]func(*msiRepairReceipt){
		"missing prior installer hash": func(v *msiRepairReceipt) { v.PriorMSISha256 = "" },
		"forged OS success":            func(v *msiRepairReceipt) { v.OSAttested = true },
		"same product version":         func(v *msiRepairReceipt) { v.PriorProductVersion = v.ProductVersion },
		"untrusted receipt":            func(v *msiRepairReceipt) { v.PriorReceiptSha256 = "oops" },
		"backdated finish":             func(v *msiRepairReceipt) { v.FinishedAt = "2010-01-01T00:00:00Z" },
		"fake exit code":               func(v *msiRepairReceipt) { v.ExitCode = 0 },
		"unknown operation":            func(v *msiRepairReceipt) { v.Operation = "auto-rollback" },
	} {
		t.Run(name, func(t *testing.T) {
			r := original
			fn(&r)
			raw, _ := json.Marshal(r)
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := inspectMSIProfile(root); err == nil {
				t.Fatal("tampered upgrade inventory accepted")
			}
		})
	}
}

func TestUpgradeExecutorNeverAvailableOnUnsupportedHost(t *testing.T) {
	if hostPlatform() == "windows-x64" {
		t.Skip("Windows runtime suite")
	}
	if _, err := upgradeSupervisedMSI(options{}, time.Now()); err == nil {
		t.Fatal("non-Windows upgrade admitted")
	}
}

func TestCommittedUpgradeJournalRejectsChangedSourceAndOperation(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "msi-lifecycle"), 0700); err != nil {
		t.Fatal(err)
	}
	m, _, sha := upgradeFixture()
	prior := strings.Repeat("c", 64)
	r := msiRepairReceipt{Schema: 1, Operation: "upgrade", PackageKey: m.PackageKey, Version: m.Version, ArtifactSha256: m.ArtifactSha256,
		MSISha256: m.Installer.Sha256, MSIPath: m.Installer.Path, ProductCode: m.Installer.ProductCode, ProductVersion: m.Installer.ProductVersion,
		PriorReceiptSha256: sha, PriorMSISha256: prior, PriorProductVersion: "1.4.2", State: "upgrade_started_outcome_unknown",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano), LaunchCommittedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	path := filepath.Join(root, "msi-lifecycle", m.PackageKey+".json")
	if err := writeFirstMSIRepairReceipt(path, r); err != nil {
		t.Fatal(err)
	}
	old := &msiFrozenSource{sha256: prior}
	if err := requireCommittedMSIUpgradeJournal(root, m, old, "1.4.2", sha); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []msiRepairReceipt{
		func() msiRepairReceipt {
			v := r
			v.State = "upgrade_prepared_not_launched"
			v.LaunchCommittedAt = ""
			return v
		}(),
		func() msiRepairReceipt { v := r; v.PriorMSISha256 = strings.Repeat("d", 64); return v }(),
		func() msiRepairReceipt { v := r; v.ProductCode = "{00000000-1234-5678-ABCD-1234567890AB}"; return v }(),
	} {
		if err := writeRawMSIRepairReceipt(path, bad); err != nil {
			t.Fatal(err)
		}
		if err := requireCommittedMSIUpgradeJournal(root, m, old, "1.4.2", sha); err == nil {
			t.Fatal("tampered committed upgrade launched")
		}
	}
}

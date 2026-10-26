package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIProfileInventoryEmptyAndGlobalLock(t *testing.T) {
	root := t.TempDir()
	first, e := inspectMSIProfile(root)
	if e != nil || !first.ReadOnly || first.OSAttested || first.RetryAuthorized || !first.Complete || first.ManualReviewRequired || len(first.Records) != 0 || first.State != "no_recorded_msi_attempts" {
		t.Fatalf("untrue empty inventory: %+v %v", first, e)
	}
	if e := os.Mkdir(filepath.Join(root, "msi-admission.lock"), 0700); e != nil {
		t.Fatal(e)
	}
	orphan, e := inspectMSIProfile(root)
	if e != nil || !orphan.AdmissionLockPresent || !orphan.ManualReviewRequired || orphan.State != "msi_profile_manual_review" || len(orphan.Records) != 0 {
		t.Fatalf("orphan not disclosed: %+v %v", orphan, e)
	}
}

func TestMSIProfileInventorySortedWithReceiptAndLock(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.Mkdir(filepath.Join(dir, "zebra-package.lock"), 0700); e != nil {
		t.Fatal(e)
	}
	receipt := msiAttempt{Schema: 1, PackageKey: "alpha-package", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", State: "msi_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if e := writeMSIAttemptReceipt(filepath.Join(dir, "alpha-package.json"), receipt); e != nil {
		t.Fatal(e)
	}
	view, e := inspectMSIProfile(root)
	if e != nil || view.State != "msi_profile_manual_review" || !view.ManualReviewRequired || len(view.Records) != 2 || view.Records[0].PackageKey != "alpha-package" || view.Records[1].PackageKey != "zebra-package" || !view.Records[0].HasReceipt || !view.Records[1].LockPresent {
		t.Fatalf("incorrect profile record ordering: %+v %v", view, e)
	}
}

func TestMSIProfileInventoryRefusesUnknownTamperedAndOversized(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	bad := filepath.Join(dir, "unexpected.tmp")
	if e := os.WriteFile(bad, []byte("x"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := inspectMSIProfile(root); e == nil {
		t.Fatal("unknown profile artifact was ignored")
	}
	os.Remove(bad)
	bad = filepath.Join(dir, "beta-package.json")
	if e := os.WriteFile(bad, []byte("not JSON"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := inspectMSIProfile(root); e == nil {
		t.Fatal("corrupt receipt accepted")
	}
	os.Remove(bad)
	for i := 0; i < maxMSIProfileEntries+1; i++ {
		name := filepath.Join(dir, "package-"+string(rune('a'+i/26))+string(rune('a'+i%26))+".lock")
		if e := os.Mkdir(name, 0700); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := inspectMSIProfile(root); e == nil {
		t.Fatal("incomplete profile scan accepted")
	}
}

func TestMSIProfileInventoryRejectsSymlinkedLock(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(root, filepath.Join(dir, "alpha-package.lock")); e != nil {
		t.Skip("symlinks unsupported")
	}
	if _, e := inspectMSIProfile(root); e == nil {
		t.Fatal("symlink lock treated as valid")
	}
}

func TestMSIProfileSnapshotRefusesConcurrentEntryCreation(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	_, e := inspectMSIProfileWithCheckpoint(root, func() {
		if e := os.Mkdir(filepath.Join(dir, "new-package.lock"), 0700); e != nil {
			t.Fatal(e)
		}
	})
	if e == nil {
		t.Fatal("changed inventory was reported complete")
	}
}

func TestMSIProfileSnapshotRefusesChangingAdmissionLock(t *testing.T) {
	root := t.TempDir()
	_, e := inspectMSIProfileWithCheckpoint(root, func() {
		if e := os.Mkdir(filepath.Join(root, "msi-admission.lock"), 0700); e != nil {
			t.Fatal(e)
		}
	})
	if e == nil {
		t.Fatal("new admission during scan ignored")
	}
}

func TestMSIProfileSnapshotRefusesReplacedReceipt(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(dir, "alpha-package.json")
	receipt := msiAttempt{Schema: 1, PackageKey: "alpha-package", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64),
		MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0",
		State: "msi_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if e := writeMSIAttemptReceipt(path, receipt); e != nil {
		t.Fatal(e)
	}
	_, e := inspectMSIProfileWithCheckpoint(root, func() {
		if e := os.Remove(path); e != nil {
			t.Fatal(e)
		}
		if e := writeMSIAttemptReceipt(path, receipt); e != nil {
			t.Fatal(e)
		}
	})
	if e == nil {
		t.Fatal("replaced receipt under unchanged name accepted")
	}
}

func TestMSIProfileSnapshotRefusesAbsentRootBecomingPresent(t *testing.T) {
	root := filepath.Join(t.TempDir(), "created-later")
	_, e := inspectMSIProfileWithCheckpoint(root, func() {
		if e := os.Mkdir(root, 0700); e != nil {
			t.Fatal(e)
		}
	})
	if e == nil {
		t.Fatal("root appeared during allegedly complete empty inventory")
	}
}

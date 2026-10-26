package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testJournal(t *testing.T, root, key, op string) {
	t.Helper()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	value := msiRepairReceipt{Schema: 1, Operation: op, PackageKey: key, Version: "2.1.0",
		ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64),
		ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "2.1.0",
		PriorReceiptSha256: strings.Repeat("c", 64), State: op + "_prepared_not_launched",
		StartedAt: time.Now().UTC().Format(time.RFC3339Nano), OSAttested: false}
	if err := writeFirstMSIRepairReceipt(filepath.Join(dir, key+".json"), value); err != nil {
		t.Fatal(err)
	}
}

func TestLifecycleJournalInventoryNoInstallReceiptStillRequiresReview(t *testing.T) {
	for _, op := range []string{"repair", "uninstall"} {
		t.Run(op, func(t *testing.T) {
			root := t.TempDir()
			testJournal(t, root, "studio-core", op)
			result, err := inspectMSIProfile(root)
			if err != nil || !result.Complete || !result.ManualReviewRequired || result.State != "msi_profile_manual_review" ||
				result.OSAttested || result.RetryAuthorized || result.LifecycleMutationAuthorized ||
				len(result.LifecycleRecords) != 1 || len(result.Records) != 0 ||
				result.LifecycleRecords[0].Receipt == nil || result.LifecycleRecords[0].Receipt.Operation != op {
				t.Fatalf("lifecycle journal hidden: %+v %v", result, err)
			}
		})
	}
}
func TestLifecycleJournalRejectsDependencyAdmissionEvenWithOldInstallReceipt(t *testing.T) {
	root := t.TempDir()
	dep := packageDependency{PackageKey: "studio-core", Version: "2.1.0", Requirement: "msi-installed"}
	reader := func(_, _ string) (msiAttemptStatus, error) {
		return sampleInstalledDependencyStatus("studio-core", "2.1.0"), nil
	}
	// No prior mutation: the read-only receipt reader can still be consulted.
	if _, err := inspectMSIDependenciesWithReader(root, "studio-editor", []packageDependency{dep}, reader); err != nil {
		t.Fatal(err)
	}
	testJournal(t, root, "studio-core", "uninstall")
	called := false
	wrapped := func(_, _ string) (msiAttemptStatus, error) { called = true; return reader("", "") }
	if _, err := inspectMSIDependenciesWithReader(root, "studio-editor", []packageDependency{dep}, wrapped); err == nil || called {
		t.Fatalf("old install receipt reused after uninstall: err=%v read=%t", err, called)
	}
	// The signed content-selected requirement is not an OS installation claim.
	dep.Requirement = "content-selected"
	if got, err := inspectMSIDependenciesWithReader(root, "studio-editor", []packageDependency{dep}, wrapped); err != nil || len(got) != 0 || called {
		t.Fatalf("content-only regression: %v %+v", err, got)
	}
}
func TestLifecycleJournalProfileRejectsMutationAndUnrecognizedEntries(t *testing.T) {
	for _, scenario := range []string{"new-during-scan", "modified-during-scan", "unexpected-filename", "symlink", "oversize", "corrupt-state"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			testJournal(t, root, "studio-core", "repair")
			dir := filepath.Join(root, "msi-lifecycle")
			path := filepath.Join(dir, "studio-core.json")
			var hook func()
			switch scenario {
			case "new-during-scan":
				hook = func() { testJournal(t, root, "another-core", "uninstall") }
			case "modified-during-scan":
				hook = func() { _ = os.WriteFile(path, []byte(`{}`), 0600) }
			case "unexpected-filename":
				_ = os.WriteFile(filepath.Join(dir, "ignored.tmp"), []byte("x"), 0600)
			case "symlink":
				_ = os.Symlink(path, filepath.Join(dir, "redirect.json"))
			case "oversize":
				_ = os.WriteFile(path, []byte(strings.Repeat(" ", 4097)), 0600)
			case "corrupt-state":
				_ = os.WriteFile(path, []byte(`{"schema":1,"operation":"upgrade"}`), 0600)
			}
			if _, err := inspectMSIProfileWithCheckpoint(root, hook); err == nil {
				t.Fatal("unsafe lifecycle inventory accepted")
			}
		})
	}
}
func TestLifecycleJournalCorruptTargetNeverCountsAsAbsent(t *testing.T) {
	root := t.TempDir()
	testJournal(t, root, "studio-core", "repair")
	if err := requireNoPriorMSILifecycle(root, "studio-core"); err == nil {
		t.Fatal("prior lifecycle ignored")
	}
	if err := requireNoPriorMSILifecycle(root, "different-key"); err != nil {
		t.Fatal(err)
	}
	if err := requireNoPriorMSILifecycle(root, "../illegal"); err == nil {
		t.Fatal("path traversal key")
	}
	if err := os.RemoveAll(filepath.Join(root, "msi-lifecycle")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "msi-lifecycle")); err != nil {
		t.Skip("symlink creation unavailable")
	}
	if err := requireNoPriorMSILifecycle(root, "different-key"); err == nil {
		t.Fatal("symlinked journal directory accepted")
	}
}

func TestLifecycleProductCodeCollisionWithoutOriginalInstallReceipt(t *testing.T) {
	root := t.TempDir()
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	if err := requireNoConflictingMSILifecycle(root, code); err != nil {
		t.Fatal(err)
	}
	testJournal(t, root, "orphan-package", "uninstall")
	if err := requireNoConflictingMSILifecycle(root, code); err == nil {
		t.Fatal("orphan journal allowed ProductCode reinstall")
	}
	if err := requireNoConflictingMSILifecycle(root, "{AB123456-1234-ABCD-ABCD-1234567890AB}"); err != nil {
		t.Fatal("unrelated valid ProductCode blocked", err)
	}
	if err := os.WriteFile(filepath.Join(root, "msi-lifecycle", "rogue.tmp"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := requireNoConflictingMSILifecycle(root, "{AB123456-1234-ABCD-ABCD-1234567890AB}"); err == nil {
		t.Fatal("malformed foreign journal silently skipped")
	}
}

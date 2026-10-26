package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These tests exercise real receipt and replay-ledger filesystem writes
// without attempting to invoke Windows Installer from an untrusted host.
func TestMSIPrelaunchReceiptPrecedesOneUseGrant(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	receiptPath := filepath.Join(dir, "studio-tools.json")
	now := time.Now().UTC()
	receipt := msiAttempt{Schema: 1, PackageKey: "studio-tools", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64),
		MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0",
		State: "msi_prepared_not_launched", StartedAt: now.Format(time.RFC3339Nano)}
	claim := grantPayload{PackageKey: "studio-tools", Operation: "install", Nonce: "prelaunch-unique"}
	if err := prepareMSIInstall(receiptPath, root, claim, receipt); err != nil {
		t.Fatal(err)
	}
	inspection, err := inspectMSIAttempt(root, "studio-tools")
	if err != nil || !inspection.HasReceipt || !inspection.ManualReviewRequired || inspection.RetryAuthorized || inspection.OSAttested || inspection.RecoveryAssessment != "prepared_without_launch_manual_review" || inspection.State != "msi_prepared_not_launched" {
		t.Fatalf("prepared receipt must not imply execution: %+v, %v", inspection, err)
	}
	if inspection.Attempt.LaunchCommittedAt != "" || inspection.Attempt.FinishedAt != "" {
		t.Fatal("pre-launch receipt claims execution")
	}
	// Simulate a previously consumed nonce. A later attempt must still leave
	// evidence that the operator can review, not silently create a clean retry.
	second := filepath.Join(dir, "other.json")
	if err := prepareMSIInstall(second, root, claim, receipt); err == nil {
		t.Fatal("replayed installation grant accepted")
	}
	if info, err := os.Stat(second); err != nil || info.Size() == 0 {
		t.Fatal("replayed grant failure lost preparation receipt")
	}
}

func TestMSIPrelaunchFailureCannotConsumeGrant(t *testing.T) {
	root := t.TempDir()
	claim := grantPayload{PackageKey: "studio-tools", Operation: "install", Nonce: "prepare-fail"}
	record := msiAttempt{State: "msi_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err := prepareMSIInstall(filepath.Join(root, "not-created", "attempt.json"), root, claim, record); err == nil {
		t.Fatal("receipt creation failure was ignored")
	}
	if _, err := os.Stat(filepath.Join(root, "grant-consumed")); !os.IsNotExist(err) {
		t.Fatal("a grant was consumed without a receipt")
	}
	record.State = "msi_started_outcome_unknown"
	if err := prepareMSIInstall(filepath.Join(root, "bad.json"), root, claim, record); err == nil {
		t.Fatal("launch-state record accepted as preparation")
	}
	if _, err := os.Stat(filepath.Join(root, "bad.json")); !os.IsNotExist(err) {
		t.Fatal("invalid preparation mutated storage")
	}
}

func TestMSILaunchCommitReceiptTimeline(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	recordPath := filepath.Join(dir, "studio-tools.json")
	now := time.Now().UTC()
	rec := msiAttempt{Schema: 1, PackageKey: "studio-tools", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64),
		MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0",
		State: "msi_started_outcome_unknown", StartedAt: now.Format(time.RFC3339Nano), LaunchCommittedAt: now.Add(time.Second).Format(time.RFC3339Nano)}
	write := func() {
		t.Helper()
		if err := writeMSIAttemptReceipt(recordPath, rec); err != nil {
			t.Fatal(err)
		}
	}
	valid := func() {
		t.Helper()
		s, err := inspectMSIAttempt(root, "studio-tools")
		if err != nil || !s.ManualReviewRequired || s.RetryAuthorized || s.OSAttested {
			t.Fatalf("invalid launch assessment %+v %v", s, err)
		}
	}
	reject := func() {
		t.Helper()
		write()
		if _, err := inspectMSIAttempt(root, "studio-tools"); err == nil {
			t.Fatalf("inconsistent timeline accepted: %+v", rec)
		}
	}
	write()
	valid()
	rec.LaunchCommittedAt = now.Add(-time.Second).Format(time.RFC3339Nano)
	reject()
	rec.LaunchCommittedAt = now.Add(time.Second).Format(time.RFC3339Nano)
	rec.State = "msi_exit_zero_not_os_attested"
	rec.FinishedAt = now.Add(500 * time.Millisecond).Format(time.RFC3339Nano)
	reject()
	rec.FinishedAt = now.Add(2 * time.Second).Format(time.RFC3339Nano)
	write()
	valid()
	rec.State = "msi_prepared_not_launched"
	rec.FinishedAt = ""
	reject()
	rec.LaunchCommittedAt = ""
	write()
	valid()
	rec.State = "msi_started_outcome_unknown"
	rec.LaunchCommittedAt = "invalid timestamp"
	reject()
	// Older schema-1 launch records predate launchCommittedAt; they remain
	// inspectable without falsely asserting a precise launch time.
	rec.LaunchCommittedAt = ""
	write()
	valid()
	data, err := os.ReadFile(recordPath)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded["launchCommittedAt"]; ok {
		t.Fatal("missing legacy timestamp should not be invented")
	}
}

func TestMSIAttemptForensicReaderRejectsReplacedPaths(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "receipt.json")
	original := filepath.Join(root, "original.json")
	if err := os.WriteFile(path, []byte(`{"schema":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(original, []byte(`{"schema":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = readStableMSIAttemptReceipt(path, first); err != nil {
		t.Fatalf("ordinary regular receipt refused: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(original, path); err != nil {
		t.Skipf("cannot create symlink fixture: %v", err)
	}
	if _, err = readStableMSIAttemptReceipt(path, first); err == nil {
		t.Fatal("swapped symlink accepted as original receipt")
	}
	current, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = readStableMSIAttemptReceipt(path, current); err == nil {
		t.Fatal("symlink receipt accepted")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schema":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	first, err = os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, 4097), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = readStableMSIAttemptReceipt(path, first); err == nil {
		t.Fatal("expanded receipt accepted on old evidence")
	}
}

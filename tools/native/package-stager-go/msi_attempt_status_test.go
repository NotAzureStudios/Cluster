package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIAttemptInspectionIsReadOnlyAndFailsClosed(t *testing.T) {
	root := t.TempDir()
	key := "studio-tools"
	check := func(state string, receipt, lock, review bool) {
		t.Helper()
		status, err := inspectMSIAttempt(root, key)
		if err != nil {
			t.Fatal(err)
		}
		if status.State != state || status.HasReceipt != receipt || status.LockPresent != lock || status.ManualReviewRequired != review ||
			status.RetryAuthorized || status.OSAttested || !status.ReadOnly {
			t.Fatalf("unsafe/inaccurate inspector: %+v", status)
		}
	}
	check("no_recorded_attempt", false, false, false)
	folder := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(folder, key+".lock")
	if err := os.Mkdir(lockPath, 0700); err != nil {
		t.Fatal(err)
	}
	check("interrupted_or_active_without_receipt", false, true, true)
	if err := os.Remove(lockPath); err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Format(time.RFC3339Nano)
	receipt := msiAttempt{Schema: 1, PackageKey: key, Version: "1.2.3", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", State: "msi_started_outcome_unknown", StartedAt: start, OSAttested: false}
	write := func() {
		t.Helper()
		raw, e := json.Marshal(receipt)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(folder, key+".json"), raw, 0600); e != nil {
			t.Fatal(e)
		}
	}
	write()
	check("msi_started_outcome_unknown", true, false, true)
	receipt.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	receipt.State = "msi_exit_zero_not_os_attested"
	write()
	check("msi_exit_zero_not_os_attested", true, false, true)
	result, _ := inspectMSIAttempt(root, key)
	if len(result.ReceiptSha256) != 64 || result.Attempt.Version != "1.2.3" {
		t.Fatal("missing forensic evidence")
	}
	receipt.OSAttested = true
	write()
	if _, err := inspectMSIAttempt(root, key); err == nil {
		t.Fatal("fabricated OS attestation accepted")
	}
	receipt.OSAttested = false
	write()
	if err := os.Remove(filepath.Join(folder, key+".json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(folder, "untrusted"), filepath.Join(folder, key+".json")); err == nil {
		if _, err := inspectMSIAttempt(root, key); err == nil {
			t.Fatal("symlink evidence accepted")
		}
	}
	if _, err := inspectMSIAttempt(root, "../../escape"); err == nil {
		t.Fatal("traversal accepted")
	}
}

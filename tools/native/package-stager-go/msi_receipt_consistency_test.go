package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIReceiptTimelineExitAndStageEvidence(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	key := "studio-tools"
	now := time.Now().UTC()
	rec := msiAttempt{Schema: 1, PackageKey: key, Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", State: "msi_exit_zero_not_os_attested", StartedAt: now.Format(time.RFC3339Nano), FinishedAt: now.Add(time.Second).Format(time.RFC3339Nano)}
	write := func() {
		t.Helper()
		b, e := json.Marshal(rec)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(dir, key+".json"), b, 0600); e != nil {
			t.Fatal(e)
		}
	}
	assertRejected := func() {
		t.Helper()
		write()
		if _, e := inspectMSIAttempt(root, key); e == nil {
			t.Fatalf("accepted inconsistent receipt: %+v", rec)
		}
	}
	rec.ExitCode = 3010
	assertRejected()
	rec.ExitCode = 0
	rec.FinishedAt = now.Add(-time.Second).Format(time.RFC3339Nano)
	assertRejected()
	rec.FinishedAt = now.Add(time.Second).Format(time.RFC3339Nano)
	rec.State = "msi_restart_required_not_os_attested"
	assertRejected()
	rec.ExitCode = 3010
	write()
	status, e := inspectMSIAttempt(root, key)
	if e != nil || status.StagedArtifactState != "staged_artifact_missing" || !status.RequiresRebootReview || status.RecoveryAssessment != "restart_required_registration_unverified" || status.RetryAuthorized || status.OSAttested {
		t.Fatalf("unexpected stage status: %+v %v", status, e)
	}
	if e := os.Mkdir(filepath.Join(root, "staged"), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.Mkdir(filepath.Join(root, "staged", rec.ArtifactSha256), 0700); e != nil {
		t.Fatal(e)
	}
	status, e = inspectMSIAttempt(root, key)
	if e != nil || status.StagedArtifactState != "release_stage_present_unverified" || status.StagedArtifactVerified {
		t.Fatalf("stage must not be attested: %+v %v", status, e)
	}
}

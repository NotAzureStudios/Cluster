package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sampleRepairReceipt() msiRepairReceipt {
	return msiRepairReceipt{Schema: 1, Operation: "repair", PackageKey: "test-package", Version: "1.2.3", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64),
		ProductCode: "{AABBCCDD-1234-5678-ABCD-1234567890AB}", ProductVersion: "1.2.3", PriorReceiptSha256: strings.Repeat("c", 64),
		State: "repair_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
}
func TestRepairScopeDecisionRefusesMachineAndMixedRegistrations(t *testing.T) {
	if err := classifyCurrentUserMSIRepairScope(0, 1, msiEnumeratedEnd); err != nil {
		t.Fatal(err)
	}
	if err := classifyCurrentUserMSIRepairScope(0, 2, msiEnumeratedEnd); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][3]uint32{{0, 4, msiEnumeratedEnd}, {0, 0, msiEnumeratedEnd}, {0, 3, msiEnumeratedEnd}, {5, 1, msiEnumeratedEnd}, {0, 1, 0}, {0, 2, 2}} {
		if err := classifyCurrentUserMSIRepairScope(pair[0], pair[1], pair[2]); err == nil {
			t.Fatalf("accepted untrusted scope %v", pair)
		}
	}
}
func TestRepairRegistrationDecisionRejectsUnknownOrDifferentVersion(t *testing.T) {
	c := "{AABBCCDD-1234-5678-ABCD-1234567890AB}"
	good := msiProductState{ProductCode: c, ExpectedVersion: "1.2.3", ReportedVersion: "1.2.3", State: "registered_version_match", VersionMatches: true, ReadOnly: true, ProbeScope: "current_user_and_machine", ProbeComplete: true}
	if err := requireExactMSIRepairRegistration(good, nil, c, "1.2.3"); err != nil {
		t.Fatal(err)
	}
	for _, mut := range []func(*msiProductState){
		func(s *msiProductState) { s.State = "not_registered_for_user" },
		func(s *msiProductState) { s.ProbeComplete = false },
		func(s *msiProductState) { s.ProbeScope = "current_user" },
		func(s *msiProductState) { s.ReadOnly = false },
		func(s *msiProductState) { s.OSAttested = true },
		func(s *msiProductState) { s.ReportedVersion = "1.2.4" },
		func(s *msiProductState) { s.VersionMatches = false },
		func(s *msiProductState) { s.ProductCode = "{00000000-1234-5678-ABCD-1234567890AB}" },
	} {
		v := good
		mut(&v)
		if requireExactMSIRepairRegistration(v, nil, c, "1.2.3") == nil {
			t.Fatalf("accepted corrupt registration %+v", v)
		}
	}
	if requireExactMSIRepairRegistration(good, os.ErrPermission, c, "1.2.3") == nil {
		t.Fatal("accepted query failure")
	}
}
func TestRepairJournalExclusiveDurableAndFailClosed(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(dir, "test-package.json")
	sample := sampleRepairReceipt()
	no, e := inspectMSIRepair(root, "test-package")
	if e != nil || no.HasReceipt || no.ManualReviewRequired || no.State != "no_recorded_repair" {
		t.Fatalf("clean %v %+v", e, no)
	}
	if e = writeFirstMSIRepairReceipt(path, sample); e != nil {
		t.Fatal(e)
	}
	if e = writeFirstMSIRepairReceipt(path, sample); e == nil {
		t.Fatal("O_EXCL replay allowed")
	}
	found, e := inspectMSIRepair(root, "test-package")
	if e != nil || !found.HasReceipt || !found.ManualReviewRequired || found.RetryAuthorized || found.OSAttested || found.ReceiptSha256 == "" {
		t.Fatalf("journal %v %+v", e, found)
	}
	sample.State = "repair_started_outcome_unknown"
	sample.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if e = writeRawMSIRepairReceipt(path, sample); e != nil {
		t.Fatal(e)
	}
	if _, e = inspectMSIRepair(root, "test-package"); e != nil {
		t.Fatal(e)
	}
	sample.State = "repair_exit_zero_not_os_attested"
	sample.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if e = writeRawMSIRepairReceipt(path, sample); e != nil {
		t.Fatal(e)
	}
	if _, e = inspectMSIRepair(root, "test-package"); e != nil {
		t.Fatal(e)
	}
	for name, mutate := range map[string]func(*msiRepairReceipt){
		"wrong prior hash":   func(r *msiRepairReceipt) { r.PriorReceiptSha256 = "hi" },
		"forged attestation": func(r *msiRepairReceipt) { r.OSAttested = true },
		"changed package":    func(r *msiRepairReceipt) { r.PackageKey = "foreign" },
		"unknown state":      func(r *msiRepairReceipt) { r.State = "uninstall_done" },
		"contradictory exit": func(r *msiRepairReceipt) { r.ExitCode = 3010 },
		"missing launch":     func(r *msiRepairReceipt) { r.LaunchCommittedAt = "" },
		"invalid version":    func(r *msiRepairReceipt) { r.ProductVersion = "not-a-version" },
		"backdated finish":   func(r *msiRepairReceipt) { r.FinishedAt = "2012-01-01T00:00:00Z" },
	} {
		copy := sample
		mutate(&copy)
		raw, _ := json.Marshal(copy)
		if e := os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
		if _, e := inspectMSIRepair(root, "test-package"); e == nil {
			t.Fatalf("accepted corrupt journal: %s", name)
		}
	}
	if e = os.Remove(path); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(filepath.Join(root, "foreign.json"), path); e != nil {
		t.Fatal(e)
	}
	if _, e := inspectMSIRepair(root, "test-package"); e == nil {
		t.Fatal("accepted symbolic link journal")
	}
}
func TestRepairHelperRefusesUnsupportedHost(t *testing.T) {
	if hostPlatform() == "windows-x64" {
		t.Skip("portable test only")
	}
	if _, err := repairSupervisedMSI(options{}, time.Now()); err == nil {
		t.Fatal("unsupported host accepted repair")
	}
}

func TestSignedMSIRepairGrantRequiresExactPriorReceiptAndDistinctOperation(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "presets/data.txt", []byte("signed repair grant source"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	m, _, keyHash, err := verifyInput(o)
	if err != nil {
		t.Fatal(err)
	}
	missing := grantFixture(t, o, "repair", now)
	if _, err := verifyDeploymentGrant(missing, m, keyHash, "repair", now); err == nil {
		t.Fatal("repair accepted without prior receipt hash")
	}
	digest := strings.Repeat("c", 64)
	valid := grantFixture(t, o, "repair", now, digest)
	signed, err := verifyDeploymentGrant(valid, m, keyHash, "repair", now)
	if err != nil || signed.PriorReceiptSha256 != digest {
		t.Fatalf("correct receipt-bound repair grant refused: %v %+v", err, signed)
	}
	if _, err := verifyDeploymentGrant(valid, m, keyHash, "install", now); err == nil {
		t.Fatal("repair grant authorized fresh install")
	}
	if _, err := verifyDeploymentGrant(valid, m, keyHash, "deploy", now); err == nil {
		t.Fatal("repair grant authorized managed deploy")
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "install", now), m, keyHash, "repair", now); err == nil {
		t.Fatal("install grant authorized repair")
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "repair", now, "different"), m, keyHash, "repair", now); err == nil {
		t.Fatal("repair accepted malformed prior digest")
	}
}

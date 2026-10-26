package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUninstallOperationSpecificSignedGrant(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "presets/data.txt", []byte("signed removal receipt"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	m, _, keyHash, err := verifyInput(o)
	if err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("c", 64)
	valid := grantFixture(t, o, "uninstall", now, sha)
	receipt, err := verifyDeploymentGrant(valid, m, keyHash, "uninstall", now)
	if err != nil || receipt.PriorReceiptSha256 != sha {
		t.Fatalf("receipt-bound uninstall denied: %v", err)
	}
	for _, operation := range []string{"repair", "install", "rollback", "deploy"} {
		if _, err := verifyDeploymentGrant(valid, m, keyHash, operation, now); err == nil {
			t.Fatalf("uninstall grant authorized %s", operation)
		}
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "uninstall", now), m, keyHash, "uninstall", now); err == nil {
		t.Fatal("uninstall allowed missing prior record digest")
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "uninstall", now, "invalid"), m, keyHash, "uninstall", now); err == nil {
		t.Fatal("uninstall accepted invalid digest")
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "repair", now, sha), m, keyHash, "uninstall", now); err == nil {
		t.Fatal("repair grant authorized uninstall")
	}
}
func TestUninstallJournalMutualExclusionAndTamper(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	missing, err := inspectMSIUninstall(root, "test-package")
	if err != nil || missing.HasReceipt || missing.State != "no_recorded_uninstall" {
		t.Fatalf("uninstall missing report: %+v %v", missing, err)
	}
	receipt := sampleRepairReceipt()
	receipt.Operation = "uninstall"
	receipt.State = "uninstall_prepared_not_launched"
	path := filepath.Join(dir, "test-package.json")
	if err = writeFirstMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIRepair(root, "test-package"); err == nil {
		t.Fatal("repair inspector accepted uninstall journal")
	}
	got, err := inspectMSIUninstall(root, "test-package")
	if err != nil || !got.HasReceipt || !got.ManualReviewRequired || got.RetryAuthorized || got.OSAttested {
		t.Fatalf("unsafe uninstall report: %+v %v", got, err)
	}
	if err = writeFirstMSIRepairReceipt(path, receipt); err == nil {
		t.Fatal("second lifecycle operation overwrote uninstall journal")
	}
	receipt.State = "uninstall_started_outcome_unknown"
	receipt.LaunchCommittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIUninstall(root, "test-package"); err != nil {
		t.Fatal(err)
	}
	receipt.State = "uninstall_exit_zero_not_os_attested"
	receipt.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err = writeRawMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIUninstall(root, "test-package"); err != nil {
		t.Fatal(err)
	}
	receipt.Operation = "repair"
	if err = writeRawMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err = inspectMSIUninstall(root, "test-package"); err == nil {
		t.Fatal("uninstall inspector accepted wrong operation")
	}
}
func TestUninstallHelperRefusesUnsupportedHost(t *testing.T) {
	if hostPlatform() == "windows-x64" {
		t.Skip("portable test only")
	}
	if _, err := uninstallSupervisedMSI(options{}, time.Now()); err == nil {
		t.Fatal("unsupported host allowed uninstall")
	}
}

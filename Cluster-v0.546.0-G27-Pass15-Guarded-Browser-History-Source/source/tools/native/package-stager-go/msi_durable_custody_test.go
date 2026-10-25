package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMSIGrantLedgerExclusiveCreateDirectorySyncAndReplay(t *testing.T) {
	root := t.TempDir()
	claim := grantPayload{Nonce: "one-use-manual-token", PackageKey: "studio-core", Operation: "upgrade"}
	if err := consumeGrant(root, claim); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(claim.Nonce))
	path := filepath.Join(root, "grant-consumed", hex.EncodeToString(digest[:]))
	raw, err := os.ReadFile(path)
	if err != nil || string(raw) != "studio-core\nupgrade\n" {
		t.Fatalf("ledger evidence lost: %q %v", raw, err)
	}
	if err := consumeGrant(root, claim); err == nil {
		t.Fatal("same grant nonce replay accepted")
	}
	other := claim
	other.PackageKey = "studio-other"
	other.Operation = "msi-rollback"
	if err := consumeGrant(root, other); err == nil {
		t.Fatal("one-use nonce changed operations")
	}
	raw, _ = os.ReadFile(path)
	if string(raw) != "studio-core\nupgrade\n" {
		t.Fatal("replay replaced original ledger custody")
	}
}
func TestMSIGrantLedgerRejectsUnsafeIdentityAndSymlinks(t *testing.T) {
	root := t.TempDir()
	c := grantPayload{PackageKey: "studio-core", Operation: "uninstall", Nonce: ""}
	if err := consumeGrant(root, c); err == nil {
		t.Fatal("empty nonce accepted")
	}
	c.Nonce = "fresh"
	c.PackageKey = "../illegal"
	if err := consumeGrant(root, c); err == nil {
		t.Fatal("unsafe package key accepted")
	}
	c.PackageKey = "studio-core"
	c.Operation = ""
	if err := consumeGrant(root, c); err == nil {
		t.Fatal("missing operation accepted")
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "grant-consumed")); err != nil {
		t.Skipf("symlink test unavailable: %v", err)
	}
	c.Operation = "uninstall"
	if err := consumeGrant(root, c); err == nil {
		t.Fatal("symlinked replay ledger accepted")
	}
	names, _ := os.ReadDir(outside)
	if len(names) != 0 {
		t.Fatal("grant escaped its managed profile")
	}
}
func TestMSIDurableLifecycleJournalBeforeFirstGrant(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	receipt := msiRepairReceipt{Schema: 1, Operation: "uninstall", PackageKey: "studio-core", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", PriorReceiptSha256: strings.Repeat("c", 64), State: "uninstall_prepared_not_launched", StartedAt: "2026-10-24T12:00:00Z"}
	path := filepath.Join(dir, "studio-core.json")
	if err := writeFirstMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	status, err := inspectMSIUninstall(root, "studio-core")
	if err != nil || !status.HasReceipt || status.State != "uninstall_prepared_not_launched" {
		t.Fatalf("first receipt not inspectable %+v %v", status, err)
	}
	if err := writeFirstMSIRepairReceipt(path, receipt); err == nil {
		t.Fatal("journal O_EXCL replay bypassed")
	}
	receipt.State = "uninstall_started_outcome_unknown"
	receipt.LaunchCommittedAt = "2026-10-24T12:00:01Z"
	if err := writeRawMSIRepairReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	status, err = inspectMSIUninstall(root, "studio-core")
	if err != nil || status.State != "uninstall_started_outcome_unknown" {
		t.Fatalf("replacement journal not inspectable %+v %v", status, err)
	}
}
func TestMSIDurableParentPathGuardAndLock(t *testing.T) {
	root := t.TempDir()
	if err := syncMSICustodyDirectory(root); err != nil {
		t.Fatal(err)
	}
	if err := syncMSICustodyDirectory(filepath.Join(root, "missing")); err == nil {
		t.Fatal("missing parent accepted")
	}
	file := filepath.Join(root, "not-a-directory")
	if err := os.WriteFile(file, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := syncMSICustodyDirectory(file); err == nil {
		t.Fatal("file used as directory")
	}
	unlock, err := acquireMSIInstallLock(root, "studio-core")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "studio-core.lock")); err != nil {
		t.Fatal("lock absent", err)
	}
	if _, err := acquireMSIInstallLock(root, "studio-core"); err == nil {
		t.Fatal("admission lock replay accepted")
	}
	unlock()
	if _, err := os.Lstat(filepath.Join(root, "studio-core.lock")); !os.IsNotExist(err) {
		t.Fatal("owned lock not released", err)
	}
}

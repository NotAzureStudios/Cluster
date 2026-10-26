package main

import (
	"os"
	"testing"
)

// The ordinary pending fence must not deadlock operator-confirmed recovery
// after the committed checkpoint and full archive were already published.
func TestCommittedTransferPendingResidueRequiresExplicitRecovery(t *testing.T) {
	root := t.TempDir()
	payload := []byte("already committed archive with a leftover pending metadata publication")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
	meta, _, archive, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(meta+".pending", []byte(`{"incomplete":"untrusted"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("ordinary inspection bypassed pending checkpoint fence")
	}
	if _, err := commitTransfer(root, digest); err == nil {
		t.Fatal("commit bypassed pending checkpoint fence")
	}
	result, err := recoverTransfer(root, digest)
	if err != nil {
		t.Fatalf("operator-confirmed recovery failed: %v", err)
	}
	if result.RecoveryAction != "already_committed" || result.State != "committed" || result.ReceivedBytes != int64(len(payload)) {
		t.Fatalf("wrong recovery result: %+v", result)
	}
	if _, err := os.Lstat(meta + ".pending"); !os.IsNotExist(err) {
		t.Fatal("verified pending residue not resolved")
	}
	recovered, err := inspectTransfer(root, digest)
	if err != nil || recovered.State != "committed" {
		t.Fatalf("verified inspection still blocked: %+v %v", recovered, err)
	}
	persisted, err := os.ReadFile(archive)
	if err != nil || string(persisted) != string(payload) {
		t.Fatal("recovery altered committed archive")
	}
	again, err := recoverTransfer(root, digest)
	if err != nil || again.RecoveryAction != "already_committed" {
		t.Fatalf("recovery not idempotent: %+v %v", again, err)
	}
}

func TestCommittedTransferPendingResidueCannotConcealCorruptedArchive(t *testing.T) {
	root := t.TempDir()
	payload := []byte("archive payload that must not become trusted when tampered with")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
	meta, _, archive, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(meta+".pending", []byte(`{"incomplete":"untrusted"}`), 0600); err != nil {
		t.Fatal(err)
	}
	tampered := append([]byte(nil), payload...)
	tampered[0] ^= 0x1
	if err := os.WriteFile(archive, tampered, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := recoverTransfer(root, digest); err == nil {
		t.Fatal("accepted tampered committed archive")
	}
	if _, err := os.Lstat(meta + ".pending"); err != nil {
		t.Fatal("removed pending evidence after failed proof")
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("ordinary inspection accepted tampered archive")
	}
}

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTransferInspectUnknownDoesNotCreateAnything(t *testing.T) {
	root := t.TempDir()
	digest := digestForTest([]byte("absent signed archive"))
	before, _ := os.ReadDir(root)
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("absent checkpoint accepted")
	}
	after, _ := os.ReadDir(root)
	if len(after) != len(before) {
		t.Fatal("inspect created an incoming directory")
	}
	if _, err := os.Lstat(filepath.Join(root, "incoming")); !os.IsNotExist(err) {
		t.Fatal("incoming directory created")
	}
	if _, err := inspectTransfer(root, "../escape"); err == nil {
		t.Fatal("invalid digest accepted")
	}
	if _, err := os.Lstat(filepath.Join(root, "escape")); !os.IsNotExist(err) {
		t.Fatal("invalid digest wrote outside root")
	}
}

func TestTransferInspectMissingIdentityLeavesExistingIncomingAlone(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "incoming"), 0700); err != nil {
		t.Fatal(err)
	}
	digest := digestForTest([]byte("unknown id"))
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("missing transfer accepted")
	}
	if _, err := os.Lstat(filepath.Join(root, "incoming", digest)); !os.IsNotExist(err) {
		t.Fatal("inspect created digest directory")
	}
}

func TestTransferInspectRejectsExistingLockWithoutStealingIt(t *testing.T) {
	root := t.TempDir()
	b := []byte("must keep original bytes")
	digest := digestForTest(b)
	if _, err := beginTransfer(root, digest, int64(len(b))); err != nil {
		t.Fatal(err)
	}
	_, _, _, lock, err := transferPaths(root, digest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lock, []byte("active process unknown"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("active writer exposed trusted snapshot")
	}
	contents, err := os.ReadFile(lock)
	if err != nil || string(contents) != "active process unknown" {
		t.Fatalf("inspection changed lock: %s %v", contents, err)
	}
}

func TestTransferInspectRejectsUnexpectedDualPayloads(t *testing.T) {
	root := t.TempDir()
	b := []byte("payload v1")
	digest := digestForTest(b)
	if _, err := beginTransfer(root, digest, int64(len(b))); err != nil {
		t.Fatal(err)
	}
	_, _, archive, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(archive, []byte("uncheckpointed duplicate"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("ambiguous dual payloads accepted")
	}
	if _, err := appendTransfer(root, digest, 0, b); err == nil {
		t.Fatal("writer accepted dual payloads")
	}
}

func TestTransferInspectionRejectsUncheckpointedRename(t *testing.T) {
	root := t.TempDir()
	b := []byte("file complete but interrupted before commit")
	digest := digestForTest(b)
	if _, err := beginTransfer(root, digest, int64(len(b))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, b); err != nil {
		t.Fatal(err)
	}
	_, part, archive, _, _ := transferPaths(root, digest)
	if err := os.Rename(part, archive); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("inspect accepted rename without commit")
	}
	if _, err := appendTransfer(root, digest, int64(len(b)), []byte("x")); err == nil {
		t.Fatal("writer accepted uncheckpointed rename")
	}
	// Explicit operator confirmation and full hash recovery remain separate.
	if result, err := recoverTransfer(root, digest); err != nil || result.State != "committed" {
		t.Fatalf("recovery failed: %+v %v", result, err)
	}
}

func TestTransferLockReleaseCannotDeleteSomeoneElsesLock(t *testing.T) {
	root := t.TempDir()
	lock := filepath.Join(root, "lock")
	unlock, err := transferLock(lock)
	if err != nil {
		t.Fatal(err)
	}
	prior := filepath.Join(root, "old-lock")
	if err := os.Rename(lock, prior); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lock, []byte("another process"), 0600); err != nil {
		t.Fatal(err)
	}
	unlock()
	contents, err := os.ReadFile(lock)
	if err != nil || string(contents) != "another process" {
		t.Fatalf("replaced lock removed: %s %v", contents, err)
	}
	if _, err := os.Stat(prior); err != nil {
		t.Fatalf("original lock disappeared: %v", err)
	}
	os.Remove(lock)
	os.Remove(prior)
	unlock, err = transferLock(lock)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	if _, err := os.Lstat(lock); !os.IsNotExist(err) {
		t.Fatal("owned lock not released")
	}
}

func TestTransferCheckpointRejectsOversizedAndSymlinkedMetadata(t *testing.T) {
	root := t.TempDir()
	b := []byte("a valid original checkpoint")
	digest := digestForTest(b)
	if _, err := beginTransfer(root, digest, int64(len(b))); err != nil {
		t.Fatal(err)
	}
	meta, _, _, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(meta, []byte(strings.Repeat("x", 4097)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("oversized metadata accepted")
	}
	if err := os.Remove(meta); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside")
	os.WriteFile(outside, []byte("untrusted"), 0600)
	if err := os.Symlink(outside, meta); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("symlinked metadata accepted")
	}
}

// A crash can leave the new checkpoint in .pending while the old checkpoint
// still matches the payload. Neither inspection nor commit/bind may publish
// the older generation as current until explicit recovery handles the residue.
func TestTransferPendingCheckpointPublicationBlocksReadersAndCommit(t *testing.T) {
 root := t.TempDir()
 payload := []byte("fully written archive with pending metadata")
 digest := digestForTest(payload)
 if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil { t.Fatal(err) }
 if _, err := appendTransfer(root, digest, 0, payload); err != nil { t.Fatal(err) }
 meta, part, archive, _, _ := transferPaths(root, digest)
 if err := os.WriteFile(meta+".pending", []byte(`{"incomplete":true}`), 0600); err != nil { t.Fatal(err) }
 if _, err := inspectTransfer(root, digest); err == nil { t.Fatal("inspection accepted unpublished checkpoint") }
 if _, err := readTransferCheckpoint(meta, part, archive); err == nil { t.Fatal("verification accepted unpublished checkpoint") }
 if _, err := commitTransfer(root, digest); err == nil { t.Fatal("commit accepted unpublished checkpoint") }
 offer := transferOffer{DeploymentID:"deploy-1", PackageID:"pkg-1", ReleaseID:"rel-1", Channel:"stable", Platform:"windows-x64"}
 if _, err := bindTransferOffer(root, digest, offer); err == nil { t.Fatal("offer binding accepted unpublished checkpoint") }
 if _, err := os.Stat(meta+".pending"); err != nil { t.Fatal("rejected operations removed recovery evidence:",err) }
 if _, err := recoverTransfer(root, digest); err != nil { t.Fatal("explicit recovery should resolve verified pending publication:",err) }
 if _, err := inspectTransfer(root, digest); err != nil { t.Fatal("inspection after explicit recovery:",err) }
}

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTransferRecoveryRehashesUncheckpointedAppendWithoutDeletingBytes(t *testing.T) {
	root := t.TempDir()
	bytes := []byte("crash-safe retained signed ZIP payload")
	digest := digestForTest(bytes)
	if _, err := beginTransfer(root, digest, int64(len(bytes))); err != nil {
		t.Fatal(err)
	}
	offer := transferOffer{DeploymentID: "deployment_1", PackageID: "package_1", ReleaseID: "release_1", Channel: "stable", Platform: "windows-x64"}
	if _, err := bindTransferOffer(root, digest, offer); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, bytes[:9]); err != nil {
		t.Fatal(err)
	}
	meta, part, _, _, _ := transferPaths(root, digest)
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(bytes[9:22]); err != nil {
		t.Fatal(err)
	}
	if err := f.Sync(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	// Simulate a crash after an atomic checkpoint temp was fsynced but before rename.
	if err := os.WriteFile(meta+".pending", []byte(`{"incomplete":"untrusted"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("uncheckpointed bytes were silently considered valid")
	}
	r, err := recoverTransfer(root, digest)
	if err != nil {
		t.Fatal(err)
	}
	if r.RecoveryAction != "restored_uncheckpointed_bytes" || r.RecoveredBytes != 13 || r.ReceivedBytes != 22 || r.Offer == nil || *r.Offer != offer {
		t.Fatalf("unexpected result: %+v", r)
	}
	if _, err := os.Stat(meta + ".pending"); !os.IsNotExist(err) {
		t.Fatal("pending temp remains")
	}
	same, err := recoverTransfer(root, digest)
	if err != nil || same.RecoveryAction != "checkpoint_already_current" || same.RecoveredBytes != 0 {
		t.Fatalf("not idempotent: %+v %v", same, err)
	}
	if _, err := appendTransfer(root, digest, 22, bytes[22:]); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
	after, err := recoverTransfer(root, digest)
	if err != nil || after.RecoveryAction != "already_committed" || after.State != "committed" {
		t.Fatalf("committed recovery: %+v %v", after, err)
	}
	retained, _ := os.ReadFile(filepath.Join(root, "incoming", digest, "artifact.zip"))
	if string(retained) != string(bytes) {
		t.Fatal("recovery changed archive bytes")
	}
}

func TestTransferRecoveryCompletesInterruptedRenameOnlyAfterFullDigest(t *testing.T) {
	root := t.TempDir()
	data := []byte("fully retained archive before checkpoint commit")
	digest := digestForTest(data)
	if _, err := beginTransfer(root, digest, int64(len(data))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, data); err != nil {
		t.Fatal(err)
	}
	meta, part, archive, _, _ := transferPaths(root, digest)
	if err := os.Rename(part, archive); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("crashed commit was silently accepted")
	}
	r, err := recoverTransfer(root, digest)
	if err != nil || r.RecoveryAction != "committed_interrupted_rename" || r.State != "committed" || r.PrefixSha256 != digest || r.RecoveredBytes != 0 {
		t.Fatalf("failed interrupted-rename recovery: %+v %v", r, err)
	}
	if _, err := os.Lstat(meta); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(part); !os.IsNotExist(err) {
		t.Fatal("unexpected re-created part")
	}
}

func TestTransferRecoveryRefusesTamperAmbiguityAndStrandedLock(t *testing.T) {
	t.Run("prefix changed", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("trusted prefix plus suffix")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		appendTransfer(root, id, 0, data[:12])
		_, part, _, _, _ := transferPaths(root, id)
		os.WriteFile(part, []byte("untrustedXXX"+string(data[12:18])), 0600)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("prefix change accepted")
		}
	})
	t.Run("truncated part", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("truncated transfer")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		appendTransfer(root, id, 0, data[:9])
		_, part, _, _, _ := transferPaths(root, id)
		os.WriteFile(part, []byte("short"), 0600)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("truncated bytes accepted")
		}
	})
	t.Run("dual files", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("dual payload")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		appendTransfer(root, id, 0, data)
		_, _, archive, _, _ := transferPaths(root, id)
		os.WriteFile(archive, data, 0600)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("ambiguous duplicate payload accepted")
		}
	})
	t.Run("stranded lock", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("locked payload")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		_, _, _, lock, _ := transferPaths(root, id)
		os.WriteFile(lock, []byte("owner unknown"), 0600)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("stole previous process lock")
		}
	})
	t.Run("checkpoint missing", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("orphan payload")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		meta, _, _, _, _ := transferPaths(root, id)
		os.Remove(meta)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("invented checkpoint")
		}
	})
	t.Run("unsafe pending symlink", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("pending payload")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		meta, _, _, _, _ := transferPaths(root, id)
		outside := filepath.Join(root, "outside")
		os.WriteFile(outside, []byte("protected"), 0600)
		if err := os.Symlink(outside, meta+".pending"); err != nil {
			t.Skip("symlink unavailable", err)
		}
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("accepted symlink")
		}
		still, _ := os.ReadFile(outside)
		if string(still) != "protected" {
			t.Fatal("touched external file")
		}
	})
	t.Run("archive wrong digest", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("good payload")
		id := digestForTest(data)
		beginTransfer(root, id, int64(len(data)))
		appendTransfer(root, id, 0, data)
		_, part, archive, _, _ := transferPaths(root, id)
		os.Rename(part, archive)
		os.WriteFile(archive, []byte(strings.Repeat("x", len(data))), 0600)
		if _, err := recoverTransfer(root, id); err == nil {
			t.Fatal("accepted wrong archive digest")
		}
	})
}

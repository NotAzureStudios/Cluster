package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestTransferDiagnosticNoFilesystemMutation(t *testing.T) {
	root := t.TempDir()
	bytes := []byte("unmodified checkpoint archive")
	digest := digestForTest(bytes)
	before, _ := os.ReadDir(root)
	diagnostic, err := diagnoseTransfer(root, digest)
	if err != nil || diagnostic.State != "missing_checkpoint" || !diagnostic.ReadOnly {
		t.Fatalf("unexpected: %+v %v", diagnostic, err)
	}
	after, _ := os.ReadDir(root)
	if len(before) != len(after) {
		t.Fatal("read-only diagnosis created a directory")
	}
}
func TestTransferDiagnosticClassifiesRecoverableButUnverifiedCrash(t *testing.T) {
	root := t.TempDir()
	bytes := []byte("partial checkpoint append then crash")
	digest := digestForTest(bytes)
	beginTransfer(root, digest, int64(len(bytes)))
	appendTransfer(root, digest, 0, bytes[:6])
	_, part, archive, lock, _ := transferPaths(root, digest)
	f, _ := os.OpenFile(part, os.O_WRONLY|os.O_APPEND, 0600)
	f.Write(bytes[6:14])
	f.Sync()
	f.Close()
	d, err := diagnoseTransfer(root, digest)
	if err != nil || d.State != "append_checkpoint_gap_candidate_unverified" || !d.ManualReviewRequired || d.PublishedBytes != 6 || d.RetainedBytes != 14 {
		t.Fatalf("bad gap: %+v %v", d, err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("inspection incorrectly accepted gap")
	}
	os.WriteFile(lock, []byte("stranded owner unknown"), 0600)
	d, err = diagnoseTransfer(root, digest)
	if err != nil || d.State != "lock_present_manual_review" || !d.LockPresent {
		t.Fatalf("lock diagnosis: %+v %v", d, err)
	}
	if _, err := recoverTransfer(root, digest); err == nil {
		t.Fatal("diagnostic bypassed stranded lock")
	}
	os.Remove(lock)
	// Simulate commit rename after completing an ordinary append.
	if _, err := recoverTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
	appendTransfer(root, digest, 14, bytes[14:])
	os.Rename(part, archive)
	d, err = diagnoseTransfer(root, digest)
	if err != nil || d.State != "renamed_commit_candidate_unverified" || !d.ManualReviewRequired {
		t.Fatalf("rename diagnosis: %+v %v", d, err)
	}
}
func TestTransferDiagnosticSafeCommittedAndCorruption(t *testing.T) {
	root := t.TempDir()
	bytes := []byte("valid committed archive")
	digest := digestForTest(bytes)
	beginTransfer(root, digest, int64(len(bytes)))
	appendTransfer(root, digest, 0, bytes)
	commitTransfer(root, digest)
	d, err := diagnoseTransfer(root, digest)
	if err != nil || d.State != "committed_verified" || d.ManualReviewRequired {
		t.Fatalf("committed diagnosis: %+v %v", d, err)
	}
	meta, _, archive, _, _ := transferPaths(root, digest)
	os.WriteFile(archive, []byte("changed committed payload"), 0600)
	d, err = diagnoseTransfer(root, digest)
	if err != nil || d.State != "committed_payload_invalid" || !d.ManualReviewRequired {
		t.Fatalf("tamper diagnosis: %+v %v", d, err)
	}
	os.Remove(meta)
	d, err = diagnoseTransfer(root, digest)
	if err != nil || d.State != "orphan_without_checkpoint" {
		t.Fatalf("orphan diagnosis: %+v %v", d, err)
	}
}
func TestTransferDiagnosticRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	bytes := []byte("test payload")
	digest := digestForTest(bytes)
	beginTransfer(root, digest, int64(len(bytes)))
	meta, part, _, _, _ := transferPaths(root, digest)
	os.Remove(part)
	outside := filepath.Join(root, "outside")
	os.WriteFile(outside, []byte("external"), 0600)
	if err := os.Symlink(outside, part); err != nil {
		t.Skip("symlink unavailable", err)
	}
	if _, err := diagnoseTransfer(root, digest); err == nil {
		t.Fatal("unsafe symlink inspected")
	}
	if _, err := os.Stat(meta); err != nil {
		t.Fatal("modified checkpoint")
	}
}

func TestTransferDiagnosticDifferentiatesStreamingHashDamage(t *testing.T) {
	root := t.TempDir()
	payload := []byte("persisted SHA state requires confirmed full recovery")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload[:14]); err != nil {
		t.Fatal(err)
	}
	meta, part, _, _, _ := transferPaths(root, digest)
	original, err := os.ReadFile(meta)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint.HashState = "future-unsupported-hash-format"
	corrupt, _ := json.Marshal(checkpoint)
	if err := os.WriteFile(meta, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(part)
	if err != nil {
		t.Fatal(err)
	}
	result, err := diagnoseTransfer(root, digest)
	if err != nil || result.State != "streaming_hash_state_invalid_full_recovery_required" || !result.ReadOnly || !result.ManualReviewRequired || result.PublishedBytes != 14 {
		t.Fatalf("unsafe classification: %+v %v", result, err)
	}
	afterMeta, _ := os.ReadFile(meta)
	afterPart, _ := os.ReadFile(part)
	if !bytes.Equal(corrupt, afterMeta) || !bytes.Equal(before, afterPart) || bytes.Equal(original, afterMeta) {
		t.Fatal("read-only diagnosis modified transfer files")
	}
	// Full recovery can still reject a changed published prefix; diagnosis must
	// not label the candidate as verified or recover it implicitly.
	if err := os.WriteFile(part, []byte("CORRUPTEDPREFIX"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := recoverTransfer(root, digest); err == nil {
		t.Fatal("repair accepted corrupted bytes")
	}
}

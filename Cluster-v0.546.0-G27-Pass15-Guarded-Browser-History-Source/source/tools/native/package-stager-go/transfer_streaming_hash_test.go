package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"
)

// The short-lived helper is restarted for each bounded Qt chunk. Streaming
// state must survive the process boundary without ever becoming install proof.
func TestTransferStreamingHashAcrossChunks(t *testing.T) {
	root := t.TempDir()
	payload := bytes.Repeat([]byte("independently signed archive transport\n"), 5300)
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	var checkpoint transferCheckpoint
	for offset := 0; offset < len(payload); {
		end := offset + 8191
		if end > len(payload) {
			end = len(payload)
		}
		var err error
		checkpoint, err = appendTransfer(root, digest, int64(offset), payload[offset:end])
		if err != nil {
			t.Fatalf("chunk %d: %v", offset, err)
		}
		if checkpoint.Schema != transferCheckpointSchema || checkpoint.ReceivedBytes != int64(end) || checkpoint.HashState == "" || checkpoint.TailSha256 == "" {
			t.Fatal("missing durable hash state")
		}
		sum := sha256.Sum256(payload[:end])
		if checkpoint.PrefixSha256 != hex.EncodeToString(sum[:]) {
			t.Fatal("bad streamed digest")
		}
		offset = end
	}
	if _, err := inspectTransfer(root, digest); err != nil {
		t.Fatal("verified read failed", err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal("full final promotion failed", err)
	}
}

func TestTransferStreamingHashCorruptStateAndUnexpectedTimestamp(t *testing.T) {
	for _, kind := range []string{"hash", "length", "modtime"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			payload := []byte("separate, authenticated chunks of a signed archive")
			digest := digestForTest(payload)
			if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
				t.Fatal(err)
			}
			if _, err := appendTransfer(root, digest, 0, payload[:12]); err != nil {
				t.Fatal(err)
			}
			meta, part, _, _, _ := transferPaths(root, digest)
			checkpoint, err := loadTransferCheckpointMetadata(meta)
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "hash":
				checkpoint.HashState = checkpoint.HashState[:4] + "00" + checkpoint.HashState[6:]
			case "length":
				checkpoint.HashState = checkpoint.HashState[:len(checkpoint.HashState)-2] + "00"
			case "modtime":
				checkpoint.PayloadModTimeNano -= int64(time.Second)
			}
			data, _ := json.Marshal(checkpoint)
			if err := os.WriteFile(meta, data, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := appendTransfer(root, digest, 12, payload[12:]); err == nil {
				t.Fatal("unsafe append accepted")
			}
			if _, err := os.Stat(part); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTransferStreamingTailAndFinalCommitFence(t *testing.T) {
	root := t.TempDir()
	payload := bytes.Repeat([]byte("X"), 180*1024)
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload[:150*1024]); err != nil {
		t.Fatal(err)
	}
	meta, part, _, _, _ := transferPaths(root, digest)
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		t.Fatal(err)
	}
	originalTime := time.Unix(0, state.PayloadModTimeNano)
	f, err := os.OpenFile(part, os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	// Restore timestamp to model an uncooperative local writer that can alter
	// metadata. Bounded tail evidence must still detect this tampering.
	if _, err := f.WriteAt([]byte("changed-tail"), 145*1024); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chtimes(part, originalTime, originalTime); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 150*1024, payload[150*1024:]); err == nil {
		t.Fatal("accepted changed tail with restored timestamp")
	}
	// Now alter only older bytes outside the bounded tail, restore mtime, and
	// demonstrate the critical invariant: final full disk hashing still refuses
	// promotion even if bounded append preflight cannot detect that edit.
	f, err = os.OpenFile(part, os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("XXXXXXXXXXXX"), 145*1024); err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("altered-older"), 0); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chtimes(part, originalTime, originalTime); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 150*1024, payload[150*1024:]); err != nil {
		t.Fatal("append should be bounded", err)
	}
	if _, err := commitTransfer(root, digest); err == nil {
		t.Fatal("staged corrupted bytes without mandatory full checksum")
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("inspection accepted corrupted prefix")
	}
}

func TestTransferStreamingRecoverRebuildsHashState(t *testing.T) {
	root := t.TempDir()
	payload := bytes.Repeat([]byte("recoverable bytes "), 10000)
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload[:10000]); err != nil {
		t.Fatal(err)
	}
	_, part, _, _, _ := transferPaths(root, digest)
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(payload[10000:20000]); err != nil {
		t.Fatal(err)
	}
	f.Sync()
	f.Close()
	if _, err := appendTransfer(root, digest, 10000, payload[10000:20000]); err == nil {
		t.Fatal("silent append after crash gap")
	}
	result, err := recoverTransfer(root, digest)
	if err != nil || result.RecoveryAction != "restored_uncheckpointed_bytes" {
		t.Fatalf("recovery: %+v %v", result, err)
	}
	if result.ReceivedBytes != 20000 || result.HashState == "" {
		t.Fatal("hash state not reconstructed")
	}
	if _, err := appendTransfer(root, digest, 20000, payload[20000:]); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
}

func TestStreamingHasherRepairRequiresFullVerifiedRecovery(t *testing.T) {
	root := t.TempDir()
	payload := []byte("native crash recovery must verify old prefix before rebuilding streaming state")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload[:20]); err != nil {
		t.Fatal(err)
	}
	meta, _, _, _, _ := transferPaths(root, digest)
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		t.Fatal(err)
	}
	state.HashState = "invalid-runtime-version"
	data, _ := json.Marshal(state)
	if err := os.WriteFile(meta, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 20, payload[20:]); err == nil {
		t.Fatal("invalid state auto-resumed")
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("invalid state was trusted")
	}
	repaired, err := recoverTransfer(root, digest)
	if err != nil || repaired.RecoveryAction != "reconstructed_streaming_hash_state" || repaired.ReceivedBytes != 20 {
		t.Fatalf("explicit repair failed: %+v %v", repaired, err)
	}
	if _, err := appendTransfer(root, digest, 20, payload[20:]); err != nil {
		t.Fatal(err)
	}
	if _, err := commitTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
}

func TestStreamingAppendRejectsPendingPublication(t *testing.T) {
	root := t.TempDir()
	payload := []byte("blocked pending checkpoint")
	digest := digestForTest(payload)
	if _, err := beginTransfer(root, digest, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	meta, _, _, _, _ := transferPaths(root, digest)
	if err := os.WriteFile(meta+".pending", []byte(`{"pending":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := appendTransfer(root, digest, 0, payload); err == nil {
		t.Fatal("ignored unfinished checkpoint publication")
	}
	r, err := recoverTransfer(root, digest)
	if err != nil || r.RecoveryAction != "checkpoint_already_current" {
		t.Fatalf("explicit recovery failed: %+v %v", r, err)
	}
	if _, err := appendTransfer(root, digest, 0, payload); err != nil {
		t.Fatal(err)
	}
}

func TestCommittedTransferStreamingStateCanBeExplicitlyRebuilt(t *testing.T) {
	root := t.TempDir()
	payload := []byte("full committed native archive with an invalid persisted hashstate")
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
	meta, _, _, _, _ := transferPaths(root, digest)
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		t.Fatal(err)
	}
	state.HashState = "sha256-v99-not-supported"
	raw, _ := json.Marshal(state)
	if err := os.WriteFile(meta, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectTransfer(root, digest); err == nil {
		t.Fatal("normal read silently repaired state")
	}
	recovered, err := recoverTransfer(root, digest)
	if err != nil || recovered.RecoveryAction != "reconstructed_streaming_hash_state" || recovered.State != "committed" {
		t.Fatalf("manual verified repair failed: %+v %v", recovered, err)
	}
	if _, err := inspectTransfer(root, digest); err != nil {
		t.Fatal(err)
	}
}

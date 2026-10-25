package main

// On-demand forensic classification for a private native Package transport.
// Does not create directories, clear locks, mutate checkpoints or declare a
// new download lease. This is an observation, not permission to recover.
import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
)

type transferDiagnostic struct {
	Schema               int    `json:"schema"`
	Digest               string `json:"digest"`
	State                string `json:"state"`
	LockPresent          bool   `json:"lockPresent"`
	CheckpointPresent    bool   `json:"checkpointPresent"`
	PendingPresent       bool   `json:"pendingPresent"`
	ExpectedBytes        int64  `json:"expectedBytes,omitempty"`
	PublishedBytes       int64  `json:"publishedBytes,omitempty"`
	RetainedBytes        int64  `json:"retainedBytes,omitempty"`
	ManualReviewRequired bool   `json:"manualReviewRequired"`
	ReadOnly             bool   `json:"readOnly"`
}

func observedTransferFile(path string) (os.FileInfo, bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() {
		return nil, false, errors.New("unsafe native transfer evidence")
	}
	return info, true, nil
}

func diagnoseTransfer(root, digest string) (transferDiagnostic, error) {
	out := transferDiagnostic{Schema: 1, Digest: digest, State: "missing_checkpoint", ReadOnly: true}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(digest) {
		return out, errors.New("invalid transfer digest")
	}
	if err := directoryNoLinks(root); err != nil {
		return out, errors.New("unsafe or absent transfer root")
	}
	base := filepath.Join(root, "incoming")
	if err := directoryNoLinks(base); os.IsNotExist(err) {
		return out, nil
	} else if err != nil {
		return out, err
	}
	dir := filepath.Join(base, digest)
	if err := directoryNoLinks(dir); os.IsNotExist(err) {
		return out, nil
	} else if err != nil {
		return out, err
	}
	meta := filepath.Join(dir, "checkpoint.json")
	pending := meta + ".pending"
	part := filepath.Join(dir, "artifact.part")
	archive := filepath.Join(dir, "artifact.zip")
	lock := filepath.Join(dir, "transfer.lock")
	_, locked, err := observedTransferFile(lock)
	if err != nil {
		return out, err
	}
	_, pended, err := observedTransferFile(pending)
	if err != nil {
		return out, err
	}
	partInfo, hasPart, err := observedTransferFile(part)
	if err != nil {
		return out, err
	}
	archiveInfo, hasArchive, err := observedTransferFile(archive)
	if err != nil {
		return out, err
	}
	_, exists, err := observedTransferFile(meta)
	if err != nil {
		return out, err
	}
	out.LockPresent = locked
	out.PendingPresent = pended
	out.CheckpointPresent = exists
	if !exists {
		if locked || pended || hasPart || hasArchive {
			out.State = "orphan_without_checkpoint"
			out.ManualReviewRequired = true
		}
		return out, nil
	}
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		// A streaming-state decoder mismatch does not automatically mean the
		// on-disk transport bytes are corrupt. Check only the strict core
		// metadata shape here, without hashing or changing anything. The
		// independent operator-confirmed recovery is the *only* authority
		// permitted to rebuild the state after full-file verification.
		candidate, coreErr := readTransferMetadata(meta, false)
		if coreErr == nil && candidate.Digest == digest {
			out.State = "streaming_hash_state_invalid_full_recovery_required"
			out.ExpectedBytes = candidate.ExpectedBytes
			out.PublishedBytes = candidate.ReceivedBytes
		} else {
			out.State = "checkpoint_invalid"
		}
		out.ManualReviewRequired = true
		return out, nil
	}
	if state.Digest != digest {
		out.State = "checkpoint_invalid"
		out.ManualReviewRequired = true
		return out, nil
	}
	out.ExpectedBytes = state.ExpectedBytes
	out.PublishedBytes = state.ReceivedBytes
	if hasPart && hasArchive {
		out.State = "ambiguous_payloads"
		out.ManualReviewRequired = true
		return out, nil
	}
	if locked {
		out.State = "lock_present_manual_review"
		out.ManualReviewRequired = true
		return out, nil
	}
	if !hasPart && !hasArchive {
		out.State = "missing_payload"
		out.ManualReviewRequired = true
		return out, nil
	}
	if state.State == "committed" {
		if hasPart || !hasArchive {
			out.State = "committed_payload_conflict"
			out.ManualReviewRequired = true
			return out, nil
		}
		out.RetainedBytes = archiveInfo.Size()
		if _, err := readTransferCheckpoint(meta, part, archive); err != nil {
			out.State = "committed_payload_invalid"
			out.ManualReviewRequired = true
			return out, nil
		}
		out.State = "committed_verified"
		if pended {
			out.ManualReviewRequired = true
		}
		return out, nil
	}
	if hasArchive {
		out.RetainedBytes = archiveInfo.Size()
		out.State = "renamed_commit_candidate_unverified"
		out.ManualReviewRequired = true
		return out, nil
	}
	out.RetainedBytes = partInfo.Size()
	if partInfo.Size() > state.ExpectedBytes || partInfo.Size() < state.ReceivedBytes {
		out.State = "length_conflict"
		out.ManualReviewRequired = true
	} else if partInfo.Size() > state.ReceivedBytes {
		out.State = "append_checkpoint_gap_candidate_unverified"
		out.ManualReviewRequired = true
	} else if _, err := readTransferCheckpoint(meta, part, archive); err != nil {
		out.State = "published_payload_invalid"
		out.ManualReviewRequired = true
	} else {
		out.State = "receiving_checkpoint_verified"
		if pended {
			out.ManualReviewRequired = true
		}
	}
	return out, nil
}

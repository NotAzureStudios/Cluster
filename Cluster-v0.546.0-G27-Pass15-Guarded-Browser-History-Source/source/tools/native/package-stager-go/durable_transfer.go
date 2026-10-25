package main

// Crash-conscious disk staging for transport bytes. This subsystem owns neither
// Package authorization nor installer execution. The server must reauthorize
// every HTTP segment; the signed-package verifier still verifies the COMPLETE
// archive and independent public-key pin before anything can be staged.
import (
	"bytes"
	"crypto/sha256"
	"encoding"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxTransferChunk = 4 * 1024 * 1024
const transferTailWindow int64 = 64 * 1024
const transferCheckpointSchema = 2
const maxTransferSize int64 = 2 * 1024 * 1024 * 1024

// Offer identity is NONSECRET. No bearer challenge, token or local OS path is
// ever stored here. The server authenticates the device and recipient on every
// recovery and byte-range request.
type transferOffer struct {
	DeploymentID string `json:"deploymentId"`
	PackageID    string `json:"packageId"`
	ReleaseID    string `json:"releaseId"`
	Channel      string `json:"channel"`
	Platform     string `json:"platform"`
}

func validTransferOffer(offer transferOffer) bool {
	id := regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
	return id.MatchString(offer.DeploymentID) && id.MatchString(offer.PackageID) && id.MatchString(offer.ReleaseID) &&
		(offer.Channel == "stable" || offer.Channel == "beta" || offer.Channel == "testing") &&
		(offer.Platform == "windows-x64" || offer.Platform == "linux-x64" || offer.Platform == "macos-arm64")
}

type transferCheckpoint struct {
	Schema             int            `json:"schema"`
	Digest             string         `json:"digest"`
	ExpectedBytes      int64          `json:"expectedBytes"`
	ReceivedBytes      int64          `json:"receivedBytes"`
	PrefixSha256       string         `json:"prefixSha256"`
	HashState          string         `json:"hashState"`
	TailSha256         string         `json:"tailSha256"`
	PayloadModTimeNano int64          `json:"payloadModTimeNano"`
	State              string         `json:"state"`
	UpdatedAt          string         `json:"updatedAt"`
	Offer              *transferOffer `json:"offer,omitempty"`
}

// A sha256.HashState is the Go SHA-256 streaming state after ReceivedBytes.
// It is NON-AUTHORITATIVE until the full disk payload is rehashed by inspect,
// explicit recovery, or commit. It permits constant-I/O append checkpoints
// across the short-lived native helper processes used by Qt. Never treat a
// prefix computed from this state as signed Package or installer evidence.
func encodeTransferHasher(h hash.Hash, bytes int64) (string, error) {
	binaryState, ok := h.(encoding.BinaryMarshaler)
	if !ok {
		return "", errors.New("native SHA-256 state not serializable")
	}
	raw, err := binaryState.MarshalBinary()
	if err != nil || len(raw) != 108 || binary.BigEndian.Uint64(raw[len(raw)-8:]) != uint64(bytes) {
		return "", errors.New("invalid native SHA-256 progress state")
	}
	return hex.EncodeToString(raw), nil
}

func decodeTransferHasher(state transferCheckpoint) (hash.Hash, error) {
	if len(state.HashState) != 216 || strings.ToLower(state.HashState) != state.HashState {
		return nil, errors.New("invalid native transfer streaming checkpoint")
	}
	raw, err := hex.DecodeString(state.HashState)
	if err != nil || len(raw) != 108 || binary.BigEndian.Uint64(raw[len(raw)-8:]) != uint64(state.ReceivedBytes) {
		return nil, errors.New("invalid native transfer SHA-256 length")
	}
	hasher := sha256.New()
	reader, ok := hasher.(encoding.BinaryUnmarshaler)
	if !ok || reader.UnmarshalBinary(raw) != nil || hex.EncodeToString(hasher.Sum(nil)) != state.PrefixSha256 {
		return nil, errors.New("native transfer hash progress is inconsistent")
	}
	return hasher, nil
}

// The last 64 KiB are checked at every append, along with the file's length,
// timestamp and identity. This bounds routine disk reads independently of
// archive length. Full-file integrity remains the final commit boundary.
func transferTailDigest(f *os.File, length int64) (string, error) {
	from := length - transferTailWindow
	if from < 0 {
		from = 0
	}
	h := sha256.New()
	read, err := io.Copy(h, io.NewSectionReader(f, from, length-from))
	if err != nil || read != length-from {
		return "", errors.New("transfer tail changed during verification")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Called with the exclusive transfer lock already held. Do not use the full
// disk verifier here; that would make N fixed-sized appends quadratic in N.
func loadFastAppendState(meta, part, archive string) (transferCheckpoint, hash.Hash, *os.File, error) {
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		return state, nil, nil, err
	}
	if state.State != "receiving" {
		return state, nil, nil, errors.New("transfer is not receiving")
	}
	if pending, err := transferRecoveryPending(meta); err != nil || pending {
		return state, nil, nil, errors.New("incomplete checkpoint publication; explicit recovery required")
	}
	if _, err := os.Lstat(archive); err == nil {
		return state, nil, nil, errors.New("ambiguous transfer archive; recovery required")
	} else if !os.IsNotExist(err) {
		return state, nil, nil, err
	}
	hasher, err := decodeTransferHasher(state)
	if err != nil {
		return state, nil, nil, err
	}
	info, err := checkedTransferFile(part)
	if err != nil {
		return state, nil, nil, err
	}
	if info.Size() != state.ReceivedBytes || info.ModTime().UnixNano() != state.PayloadModTimeNano {
		return state, nil, nil, errors.New("transfer append payload evidence changed; inspect or recover required")
	}
	f, err := os.OpenFile(part, os.O_RDWR|os.O_APPEND, 0600)
	if err != nil {
		return state, nil, nil, err
	}
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != info.Size() || !opened.ModTime().Equal(info.ModTime()) {
		f.Close()
		return state, nil, nil, errors.New("transfer append payload identity changed")
	}
	tail, err := transferTailDigest(f, state.ReceivedBytes)
	if err != nil || tail != state.TailSha256 {
		f.Close()
		return state, nil, nil, errors.New("transfer append previous tail mismatch")
	}
	current, err := checkedTransferFile(part)
	if err != nil || !os.SameFile(current, opened) || current.Size() != opened.Size() || !current.ModTime().Equal(opened.ModTime()) {
		f.Close()
		return state, nil, nil, errors.New("transfer file replaced during append preflight")
	}
	return state, hasher, f, nil
}

func transferPaths(root, digest string) (string, string, string, string, error) {
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(digest) {
		return "", "", "", "", errors.New("invalid transfer SHA-256")
	}
	if err := directoryNoLinks(root); err != nil {
		return "", "", "", "", fmt.Errorf("unsafe transfer root: %w", err)
	}
	base := filepath.Join(root, "incoming")
	if err := os.Mkdir(base, 0700); err != nil && !os.IsExist(err) {
		return "", "", "", "", err
	}
	if err := directoryNoLinks(base); err != nil {
		return "", "", "", "", err
	}
	dir := filepath.Join(base, digest)
	if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
		return "", "", "", "", err
	}
	if err := directoryNoLinks(dir); err != nil {
		return "", "", "", "", err
	}
	return filepath.Join(dir, "checkpoint.json"), filepath.Join(dir, "artifact.part"), filepath.Join(dir, "artifact.zip"), filepath.Join(dir, "transfer.lock"), nil
}

// A read operation must not call transferPaths: that writer helper creates
// incoming/<digest> as a side effect.  An inspection of an unknown digest
// leaves the private root byte-for-byte untouched.
func existingTransferPaths(root, digest string) (string, string, string, string, error) {
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(digest) {
		return "", "", "", "", errors.New("invalid transfer SHA-256")
	}
	if err := directoryNoLinks(root); err != nil {
		return "", "", "", "", err
	}
	base := filepath.Join(root, "incoming")
	if err := directoryNoLinks(base); err != nil {
		return "", "", "", "", err
	}
	dir := filepath.Join(base, digest)
	if err := directoryNoLinks(dir); err != nil {
		return "", "", "", "", err
	}
	return filepath.Join(dir, "checkpoint.json"), filepath.Join(dir, "artifact.part"), filepath.Join(dir, "artifact.zip"), filepath.Join(dir, "transfer.lock"), nil
}

func checkedTransferFile(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeType != 0 {
		return nil, errors.New("unsafe transfer file")
	}
	return info, nil
}
func transferLock(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, errors.New("transfer is busy or stranded; manual recovery required")
	}
	created, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if _, err = f.Write([]byte(time.Now().UTC().Format(time.RFC3339Nano))); err != nil {
		f.Close()
		return nil, err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	// Never unlink a replacement lock belonging to another writer. A crash
	// leaves our lock for explicit human-supervised recovery, not PID-age cleanup.
	return func() {
		if current, err := os.Lstat(path); err == nil && current.Mode().IsRegular() && os.SameFile(created, current) {
			_ = os.Remove(path)
		}
	}, nil
}
func writeTransferCheckpoint(path string, state transferCheckpoint) error {
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	tmp := path + ".pending"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		return err
	}
	return nil
}

// Open and validate one stable file identity, never following a replaced
// symlink. A size limit applies to the opened handle as well as the path.
// This is intentionally strict: any concurrent mutation is ambiguous evidence.
func stableTransferRead(path string, maxBytes int64) ([]byte, error) {
	initial, err := checkedTransferFile(path)
	if err != nil {
		return nil, err
	}
	if initial.Size() < 1 || initial.Size() > maxBytes {
		return nil, errors.New("invalid transfer evidence length")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || opened.Size() != initial.Size() || !os.SameFile(initial, opened) {
		return nil, errors.New("transfer evidence changed before read")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
	if err != nil || int64(len(data)) != opened.Size() {
		return nil, errors.New("transfer evidence changed during read")
	}
	after, err := f.Stat()
	if err != nil || after.Size() != opened.Size() || !os.SameFile(after, opened) || !after.ModTime().Equal(opened.ModTime()) {
		return nil, errors.New("transfer evidence changed during read")
	}
	current, err := checkedTransferFile(path)
	if err != nil || !os.SameFile(current, opened) || current.Size() != opened.Size() || !current.ModTime().Equal(opened.ModTime()) {
		return nil, errors.New("transfer evidence replaced during read")
	}
	return data, nil
}

func readTransferMetadata(meta string, requireStreamingState bool) (transferCheckpoint, error) {
	var state transferCheckpoint
	payload, err := stableTransferRead(meta, 4096)
	if err != nil || len(payload) < 10 {
		return state, errors.New("invalid or changing transfer checkpoint")
	}
	if err := strictJSON(payload, &state); err != nil {
		return state, err
	}
	if state.Schema != transferCheckpointSchema || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(state.Digest) ||
		state.ExpectedBytes < 1 || state.ExpectedBytes > maxTransferSize || state.ReceivedBytes < 0 || state.ReceivedBytes > state.ExpectedBytes ||
		!regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(state.PrefixSha256) ||
		!regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(state.TailSha256) || state.PayloadModTimeNano <= 0 ||
		(state.State != "receiving" && state.State != "committed") ||
		(state.Offer != nil && !validTransferOffer(*state.Offer)) {
		return state, errors.New("invalid transfer checkpoint")
	}
	if requireStreamingState {
		if _, err := decodeTransferHasher(state); err != nil {
			return state, err
		}
	}
	return state, nil
}

func loadTransferCheckpointMetadata(meta string) (transferCheckpoint, error) {
	return readTransferMetadata(meta, true)
}

func readTransferCheckpoint(meta, part, archive string) (transferCheckpoint, error) {
	return verifiedTransferCheckpoint(meta, part, archive, false)
}

// Only recoverTransfer may bypass the pending-publication fence, while holding
// the exclusive transfer lock, to perform a FULL independent hash of a
// committed archive. A successful proof permits removal of the leftover
// temporary metadata; every ordinary caller must still reject it.
func verifiedTransferCheckpoint(meta, part, archive string, recoveryProof bool) (transferCheckpoint, error) {
	// A pending checkpoint publication is an uncommitted generation. Readers,
	// installers and commit/bind callers must not treat its older canonical
	// checkpoint as authoritative. Only explicit recovery may resolve it.
	if !recoveryProof {
		if pending, err := transferRecoveryPending(meta); err != nil || pending {
			return transferCheckpoint{}, errors.New("incomplete transfer checkpoint publication; explicit recovery required")
		}
	}
	state, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		return state, err
	}
	// A second physical payload is always ambiguous, even when the expected
	// file hashes correctly. It could be a crashed rename or another writer.
	_, partErr := os.Lstat(part)
	_, archiveErr := os.Lstat(archive)
	if partErr != nil && !os.IsNotExist(partErr) {
		return state, partErr
	}
	if archiveErr != nil && !os.IsNotExist(archiveErr) {
		return state, archiveErr
	}
	if partErr == nil && archiveErr == nil {
		return state, errors.New("ambiguous dual transfer payloads")
	}
	name := part
	if state.State == "committed" {
		name = archive
		if partErr == nil || state.ReceivedBytes != state.ExpectedBytes {
			return state, errors.New("inconsistent committed transfer")
		}
	} else if archiveErr == nil {
		return state, errors.New("uncheckpointed archive rename; explicit recovery required")
	}
	info, err := checkedTransferFile(name)
	if err != nil {
		return state, err
	}
	if info.Size() != state.ReceivedBytes || info.ModTime().UnixNano() != state.PayloadModTimeNano {
		return state, errors.New("inconsistent disk transfer length; manual recovery required")
	}
	f, err := os.Open(name)
	if err != nil {
		return state, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() != info.Size() {
		return state, errors.New("transfer payload replaced before hash")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, state.ReceivedBytes+1))
	if err != nil || n != state.ReceivedBytes {
		return state, errors.New("transfer payload length changed during hash")
	}
	after, err := f.Stat()
	if err != nil || !os.SameFile(opened, after) || after.Size() != opened.Size() || !after.ModTime().Equal(opened.ModTime()) {
		return state, errors.New("transfer payload changed during hash")
	}
	current, err := checkedTransferFile(name)
	if err != nil || !os.SameFile(current, opened) || current.Size() != opened.Size() || !current.ModTime().Equal(opened.ModTime()) {
		return state, errors.New("transfer payload replaced during hash")
	}
	if hex.EncodeToString(hash.Sum(nil)) != state.PrefixSha256 {
		return state, errors.New("disk transfer checkpoint checksum mismatch")
	}
	if state.State == "committed" && state.PrefixSha256 != state.Digest {
		return state, errors.New("completed transfer digest mismatch")
	}
	// Re-read the stable checkpoint: the file could have been updated during
	// the payload hash. Inspection must not combine generations.
	confirmed, err := loadTransferCheckpointMetadata(meta)
	if err != nil {
		return state, errors.New("checkpoint changed during transfer verification")
	}
	a, _ := json.Marshal(state)
	b, _ := json.Marshal(confirmed)
	if !bytes.Equal(a, b) {
		return state, errors.New("checkpoint changed during transfer verification")
	}
	// A new pending generation published while the archive was being hashed
	// invalidates even a correctly hashed OLD generation for ordinary reads.
	if !recoveryProof {
		if pending, err := transferRecoveryPending(meta); err != nil || pending {
			return state, errors.New("checkpoint publication changed during transfer verification")
		}
	}
	return state, nil
}

// transferRecoveryResult is transport evidence, never a Package deployment or
// installer grant. Reconciliation is explicit, and only the checkpoint in the
// caller's private transfer root may be changed. No bytes are deleted.
type transferRecoveryResult struct {
	transferCheckpoint
	RecoveryAction string `json:"recoveryAction"`
	RecoveredBytes int64  `json:"recoveredBytes"`
}

// transferRecoveryPending checks the crash leftover from checkpoint publication.
// Only a *regular* bounded temporary metadata file may be removed after the
// canonical checkpoint and retained bytes have independently been verified.
func transferRecoveryPending(meta string) (bool, error) {
	info, err := os.Lstat(meta + ".pending")
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return false, errors.New("unsafe incomplete transfer checkpoint publication")
	}
	return true, nil
}

// recoverTransfer reconciles a crash at the append/checkpoint or
// rename/checkpoint boundary without trusting a client's claimed offset.
// A lock left by a crashed writer is NOT silently stolen. Operators must first
// establish that the old process has stopped and resolve that lock separately.
// Even a recovered full archive still requires the normal Ed25519/SPKI proof
// before staging, and the server must reauthorize the next HTTP segment.
func recoverTransfer(root, digest string) (transferRecoveryResult, error) {
	var result transferRecoveryResult
	meta, part, archive, lock, err := transferPaths(root, digest)
	if err != nil {
		return result, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return result, err
	}
	defer unlock()
	state, err := readTransferMetadata(meta, false)
	if err != nil || state.Digest != digest {
		return result, errors.New("transfer checkpoint missing or invalid; recovery refused")
	}
	pending, err := transferRecoveryPending(meta)
	if err != nil {
		return result, err
	}
	var pendingInfo os.FileInfo
	if pending {
		pendingInfo, err = checkedTransferFile(meta + ".pending")
		if err != nil || pendingInfo.Size() > 4096 {
			return result, errors.New("pending checkpoint evidence changed during recovery")
		}
	}
	_, hashStateErr := decodeTransferHasher(state)
	// Only explicit recovery, after independently hashing the published
	// prefix, may reconstruct a damaged/version-incompatible SHA state.
	// A normal append must never skip this validation.
	needsHashStateRepair := hashStateErr != nil
	// Explicitly reject dual physical files. Never choose a winner or erase one.
	partInfo, partErr := os.Lstat(part)
	archiveInfo, archiveErr := os.Lstat(archive)
	if partErr != nil && !os.IsNotExist(partErr) {
		return result, partErr
	}
	if archiveErr != nil && !os.IsNotExist(archiveErr) {
		return result, archiveErr
	}
	if partErr == nil && archiveErr == nil {
		return result, errors.New("ambiguous transfer files; manual review required")
	}
	if state.State == "committed" && !needsHashStateRepair {
		// When .pending remains after a committed checkpoint, ordinary
		// readTransferCheckpoint correctly refuses it. Explicit operator-
		// confirmed recovery instead proves the published committed
		// generation from the FULL archive, then clears only the residue.
		// This proof does not use or trust the contents of .pending.
		if _, err := verifiedTransferCheckpoint(meta, part, archive, pending); err != nil || partErr == nil {
			return result, errors.New("committed archive inconsistent; recovery refused")
		}
		result.transferCheckpoint = state
		result.RecoveryAction = "already_committed"
	} else {
		if state.State == "committed" && (partErr == nil || archiveErr != nil) {
			return result, errors.New("inconsistent committed archive; recovery refused")
		}
		if partErr != nil && archiveErr != nil {
			return result, errors.New("transfer payload unavailable; recovery refused")
		}
		path := part
		info := partInfo
		if archiveErr == nil {
			path, info = archive, archiveInfo
		}
		if !info.Mode().IsRegular() || info.Size() < state.ReceivedBytes || info.Size() > state.ExpectedBytes {
			return result, errors.New("unsafe or truncated transfer bytes; recovery refused")
		}
		file, err := os.Open(path)
		if err != nil {
			return result, err
		}
		opened, statErr := file.Stat()
		if statErr != nil || !opened.Mode().IsRegular() || !os.SameFile(opened, info) || opened.Size() != info.Size() {
			file.Close()
			return result, errors.New("transfer file changed before recovery inspection")
		}
		// Hash the last *published* prefix before accepting uncheckpointed
		// bytes. A changed prefix must never be normalized into valid state.
		hash := sha256.New()
		_, err = io.CopyN(hash, file, state.ReceivedBytes)
		if err == nil && hex.EncodeToString(hash.Sum(nil)) != state.PrefixSha256 {
			err = errors.New("published transfer prefix changed; recovery refused")
		}
		if err != nil {
			file.Close()
			return result, err
		}
		if _, err = file.Seek(0, io.SeekStart); err != nil {
			file.Close()
			return result, err
		}
		fullHash := sha256.New()
		count, err := io.Copy(fullHash, io.LimitReader(file, state.ExpectedBytes+1))
		tailHash, tailErr := transferTailDigest(file, count)
		verified, verifyErr := file.Stat()
		closeErr := file.Close()
		current, currentErr := os.Lstat(path)
		if err != nil || tailErr != nil || verifyErr != nil || closeErr != nil || currentErr != nil || count != info.Size() ||
			!os.SameFile(opened, verified) || !os.SameFile(current, opened) ||
			!opened.ModTime().Equal(verified.ModTime()) || !current.ModTime().Equal(opened.ModTime()) ||
			verified.Size() != opened.Size() || current.Size() != opened.Size() {
			return result, errors.New("transfer changed during recovery read")
		}
		fullDigest := hex.EncodeToString(fullHash.Sum(nil))
		if archiveErr == nil {
			// Rename-to-archive proves nothing on its own. Only a full,
			// correctly sized SHA-256 match allows final checkpoint commit.
			if count != state.ExpectedBytes || fullDigest != digest {
				return result, errors.New("renamed transfer archive checksum mismatch")
			}
			if state.State == "committed" {
				result.RecoveryAction = "reconstructed_streaming_hash_state"
			} else {
				result.RecoveryAction = "committed_interrupted_rename"
			}
			state.State = "committed"
		} else if count > state.ReceivedBytes {
			result.RecoveryAction = "restored_uncheckpointed_bytes"
		} else {
			result.RecoveryAction = "checkpoint_already_current"
		}
		result.RecoveredBytes = count - state.ReceivedBytes
		state.ReceivedBytes = count
		state.PrefixSha256 = fullDigest
		state.TailSha256 = tailHash
		state.PayloadModTimeNano = verified.ModTime().UnixNano()
		state.HashState, err = encodeTransferHasher(fullHash, count)
		if err != nil {
			return result, err
		}
		result.transferCheckpoint = state
	}
	if pending {
		// The normal writer uses O_EXCL on the temporary path; only this
		// explicit recovery, under the exclusive lock, may clear its residue.
		// If the temporary file changed while we verified the archive,
		// preserve it for manual review instead of deleting new evidence.
		current, err := checkedTransferFile(meta + ".pending")
		if err != nil || !os.SameFile(pendingInfo, current) || pendingInfo.Size() != current.Size() || !pendingInfo.ModTime().Equal(current.ModTime()) {
			return transferRecoveryResult{}, errors.New("pending checkpoint evidence changed during recovery")
		}
		if err := os.Remove(meta + ".pending"); err != nil {
			return transferRecoveryResult{}, err
		}
	}
	if result.RecoveryAction == "checkpoint_already_current" && needsHashStateRepair {
		result.RecoveryAction = "reconstructed_streaming_hash_state"
	}
	if result.RecoveryAction == "restored_uncheckpointed_bytes" || result.RecoveryAction == "committed_interrupted_rename" || result.RecoveryAction == "reconstructed_streaming_hash_state" {
		if err := writeTransferCheckpoint(meta, result.transferCheckpoint); err != nil {
			return transferRecoveryResult{}, err
		}
	}
	// Final physical-file validation: no success evidence for an unverified
	// or concurrently replaced checkpoint/file pair.
	verified, err := readTransferCheckpoint(meta, part, archive)
	if err != nil {
		return transferRecoveryResult{}, err
	}
	result.transferCheckpoint = verified
	return result, nil
}

func beginTransfer(root, digest string, size int64) (transferCheckpoint, error) {
	var state transferCheckpoint
	if size < 1 || size > maxTransferSize {
		return state, errors.New("invalid or oversized transfer")
	}
	meta, part, archive, lock, err := transferPaths(root, digest)
	if err != nil {
		return state, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return state, err
	}
	defer unlock()
	if _, err = os.Lstat(meta); err == nil {
		return state, errors.New("transfer already exists; inspect instead")
	}
	if !os.IsNotExist(err) {
		return state, err
	}
	if _, err = os.Lstat(archive); err == nil {
		return state, errors.New("completed target already exists")
	}
	if !os.IsNotExist(err) {
		return state, err
	}
	f, err := os.OpenFile(part, os.O_EXCL|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return state, err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return state, err
	}
	if err = f.Close(); err != nil {
		return state, err
	}
	empty := sha256.New()
	created, err := checkedTransferFile(part)
	if err != nil {
		return state, err
	}
	hashState, err := encodeTransferHasher(empty, 0)
	if err != nil {
		return state, err
	}
	state = transferCheckpoint{Schema: transferCheckpointSchema, Digest: digest, ExpectedBytes: size, ReceivedBytes: 0, PrefixSha256: hex.EncodeToString(empty.Sum(nil)), HashState: hashState, TailSha256: hex.EncodeToString(empty.Sum(nil)), PayloadModTimeNano: created.ModTime().UnixNano(), State: "receiving"}
	if err = writeTransferCheckpoint(meta, state); err != nil {
		return state, err
	}
	return state, nil
}
func appendTransfer(root, digest string, offset int64, chunk []byte) (transferCheckpoint, error) {
	var state transferCheckpoint
	if len(chunk) < 1 || len(chunk) > maxTransferChunk {
		return state, errors.New("invalid transfer segment size")
	}
	meta, part, archive, lock, err := transferPaths(root, digest)
	if err != nil {
		return state, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return state, err
	}
	defer unlock()
	state, hasher, f, err := loadFastAppendState(meta, part, archive)
	if err != nil {
		return state, err
	}
	defer f.Close()
	if state.Digest != digest || offset != state.ReceivedBytes || offset+int64(len(chunk)) > state.ExpectedBytes {
		return state, errors.New("transfer offset or state mismatch")
	}
	// OS_APPEND is required even after reading the old tail. The exclusive
	// lock serializes Cluster writers; accidental out-of-band modifications
	// are detected by bounded preflight or by the mandatory full commit hash.
	n, err := f.Write(chunk)
	if err != nil || n != len(chunk) {
		return state, errors.New("incomplete durable transfer write; explicit recovery required")
	}
	if err := f.Sync(); err != nil {
		return state, err
	}
	opened, err := f.Stat()
	expected := offset + int64(len(chunk))
	if err != nil || opened.Size() != expected || !opened.Mode().IsRegular() {
		return state, errors.New("transfer append disk length mismatch")
	}
	if _, err := hasher.Write(chunk); err != nil {
		return state, err
	}
	nextTail, err := transferTailDigest(f, expected)
	if err != nil {
		return state, err
	}
	current, err := checkedTransferFile(part)
	if err != nil || !os.SameFile(current, opened) || current.Size() != opened.Size() || !current.ModTime().Equal(opened.ModTime()) {
		return state, errors.New("transfer file changed during append")
	}
	state.HashState, err = encodeTransferHasher(hasher, expected)
	if err != nil {
		return state, err
	}
	state.ReceivedBytes = expected
	state.PrefixSha256 = hex.EncodeToString(hasher.Sum(nil))
	state.TailSha256 = nextTail
	state.PayloadModTimeNano = opened.ModTime().UnixNano()
	if err := writeTransferCheckpoint(meta, state); err != nil {
		return state, err
	}
	return state, nil
}
func commitTransfer(root, digest string) (transferCheckpoint, error) {
	var state transferCheckpoint
	meta, part, archive, lock, err := transferPaths(root, digest)
	if err != nil {
		return state, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return state, err
	}
	defer unlock()
	state, err = readTransferCheckpoint(meta, part, archive)
	if err != nil {
		return state, err
	}
	if state.State != "receiving" || state.ReceivedBytes != state.ExpectedBytes || state.Digest != digest || state.PrefixSha256 != digest {
		return state, errors.New("transfer is incomplete or checksum mismatched")
	}
	if _, err = os.Lstat(archive); err == nil {
		return state, errors.New("completed transfer target already exists")
	}
	if !os.IsNotExist(err) {
		return state, err
	}
	if err = os.Rename(part, archive); err != nil {
		return state, err
	}
	state.State = "committed"
	if err = writeTransferCheckpoint(meta, state); err != nil {
		return state, err
	}
	return state, nil
}

// Bind at most one immutable offer identity to a local archive. The server
// authorizes and rotates the separate challenge; this metadata grants NOTHING.
func bindTransferOffer(root, digest string, offer transferOffer) (transferCheckpoint, error) {
	var state transferCheckpoint
	if !validTransferOffer(offer) {
		return state, errors.New("invalid nonsecret offer identity")
	}
	meta, part, archive, lock, err := transferPaths(root, digest)
	if err != nil {
		return state, err
	}
	unlock, err := transferLock(lock)
	if err != nil {
		return state, err
	}
	defer unlock()
	state, err = readTransferCheckpoint(meta, part, archive)
	if err != nil {
		return state, err
	}
	if state.Offer != nil {
		if *state.Offer != offer {
			return state, errors.New("checkpoint already bound to another offer")
		}
		return state, nil
	}
	if state.State != "receiving" {
		return state, errors.New("cannot attach offer to committed archive")
	}
	state.Offer = &offer
	if err = writeTransferCheckpoint(meta, state); err != nil {
		return state, err
	}
	return state, nil
}

func inspectTransfer(root, digest string) (transferCheckpoint, error) {
	meta, part, archive, lock, err := existingTransferPaths(root, digest)
	if err != nil {
		return transferCheckpoint{}, err
	}
	if _, err := os.Lstat(lock); err == nil {
		return transferCheckpoint{}, errors.New("transfer lock present; read-only diagnosis required")
	} else if !os.IsNotExist(err) {
		return transferCheckpoint{}, err
	}
	return readTransferCheckpoint(meta, part, archive)
}

package main

// Content activation only: an atomic pointer selects an independently verified,
// already-staged tree. Cluster NEVER executes a package or overwrites its own
// installation here. The consumer must verify a current trust/rollout policy
// independently before using the selected content.
import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type selection struct {
	Version          string `json:"version"`
	ArchiveSha256    string `json:"archiveSha256"`
	SigningKeySha256 string `json:"signingKeySha256"`
}
type activePointer struct {
	Schema     int        `json:"schema"`
	PackageKey string     `json:"packageKey"`
	Generation uint64     `json:"generation"`
	Active     selection  `json:"active"`
	Previous   *selection `json:"previous"`
	SelectedAt string     `json:"selectedAt"`
	State      string     `json:"state"`
}

func directoryNoLinks(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("unsafe directory")
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil || real != abs {
		return errors.New("directory uses symlink")
	}
	return nil
}

func readPointer(path, key string) (activePointer, error) {
	p := activePointer{Schema: 1, PackageKey: key, State: "content_selected_not_installed"}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 {
		return p, errors.New("unsafe pointer file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	if p.Schema != 1 || p.PackageKey != key || p.State != "content_selected_not_installed" || p.Generation == 0 || !validSelection(p.Active) || (p.Previous != nil && !validSelection(*p.Previous)) {
		return p, errors.New("invalid activation pointer")
	}
	return p, nil
}
func validSelection(s selection) bool {
	if len(s.ArchiveSha256) != 64 || len(s.SigningKeySha256) != 64 || s.Version == "" {
		return false
	}
	_, e1 := hex.DecodeString(s.ArchiveSha256)
	_, e2 := hex.DecodeString(s.SigningKeySha256)
	return e1 == nil && e2 == nil
}
func validPackageKey(key string) bool {
	if len(key) < 3 || len(key) > 80 || key[0] < 'a' || key[0] > 'z' {
		return false
	}
	for _, c := range key {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

// Reopen every ZIP member and compare its SHA-256 with the staged regular file.
// A modified, replaced or extra staged file prevents activation.
func verifyStaged(root string, m manifest, archive []byte, pinnedKey string) error {
	stageDir := filepath.Join(root, "staged", m.ArtifactSha256)
	if err := directoryNoLinks(stageDir); err != nil {
		return fmt.Errorf("stage unavailable: %w", err)
	}
	metadataPath := filepath.Join(stageDir, ".cluster-package-stage.json")
	info, err := os.Lstat(metadataPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return errors.New("stage evidence missing or unsafe")
	}
	data, err := os.ReadFile(metadataPath)
	if err != nil {
		return err
	}
	var evidence stageEvidence
	if err := json.Unmarshal(data, &evidence); err != nil {
		return err
	}
	if evidence.Schema != 1 || evidence.State != "verified_staged_not_installed" || evidence.PackageKey != m.PackageKey || evidence.Version != m.Version || evidence.Platform != m.Platform || evidence.ArchiveSha256 != m.ArtifactSha256 || evidence.SigningKeySha256 != pinnedKey {
		return errors.New("stage evidence does not match signed release")
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	expected := map[string]bool{".cluster-package-stage.json": true}
	for _, f := range zr.File {
		if err := secureName(f.Name); err != nil {
			return err
		}
		rel := strings.TrimSuffix(f.Name, "/")
		if rel == "" {
			return errors.New("empty ZIP member")
		}
		path := filepath.Join(stageDir, filepath.FromSlash(rel))
		if f.FileInfo().IsDir() {
			continue
		}
		if expected[filepath.ToSlash(rel)] {
			return errors.New("duplicate ZIP member")
		}
		expected[filepath.ToSlash(rel)] = true
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() != int64(f.UncompressedSize64) {
			return errors.New("staged content missing or replaced")
		}
		staged, err := os.Open(path)
		if err != nil {
			return err
		}
		hStage := sha256.New()
		n, err := io.Copy(hStage, io.LimitReader(staged, int64(maxExpandedSize)+1))
		closeErr := staged.Close()
		if err != nil || closeErr != nil || n != int64(f.UncompressedSize64) {
			return errors.New("staged content changed")
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		hZip := sha256.New()
		zipN, zipErr := io.Copy(hZip, io.LimitReader(src, int64(maxExpandedSize)+1))
		zipCloseErr := src.Close()
		if zipErr != nil || zipCloseErr != nil || zipN != n || !bytes.Equal(hZip.Sum(nil), hStage.Sum(nil)) {
			return errors.New("staged content integrity failed")
		}
	}
	return filepath.WalkDir(stageDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == stageDir {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("stage contains symlink")
		}
		rel, err := filepath.Rel(stageDir, path)
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() || !expected[filepath.ToSlash(rel)] {
			return errors.New("stage contains unexpected file")
		}
		return nil
	})
}

// A single package-scoped lock prevents concurrent pointer updates. A stale
// lock after a crash is fail-closed and requires explicit operator recovery.
func withSelectionLock(root, key string, operation func(string) error) error {
	if !validPackageKey(key) {
		return errors.New("invalid package key")
	}
	if err := directoryNoLinks(root); err != nil {
		return err
	}
	activeDir := filepath.Join(root, "active")
	if err := os.MkdirAll(activeDir, 0700); err != nil {
		return err
	}
	if err := directoryNoLinks(activeDir); err != nil {
		return err
	}
	lockDir := filepath.Join(activeDir, key+".lock")
	if err := os.Mkdir(lockDir, 0700); err != nil {
		return fmt.Errorf("activation lock unavailable: %w", err)
	}
	defer os.Remove(lockDir)
	return operation(filepath.Join(activeDir, key+".json"))
}
func writePointer(path string, p activePointer) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".pointer-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	// fsync directory where supported, to make the rename more durable.
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func selectContent(o options, rollback bool) (activePointer, error) {
	var result activePointer
	m, zipBytes, fingerprint, err := verifyInput(o)
	if err != nil {
		return result, err
	}
	if !validPackageKey(m.PackageKey) {
		return result, errors.New("invalid signed package key")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return result, err
	}
	err = withSelectionLock(root, m.PackageKey, func(path string) error {
		current, err := readPointer(path, m.PackageKey)
		if err != nil {
			return err
		}
		next := selection{Version: m.Version, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: fingerprint}
		if rollback {
			if current.Previous == nil || *current.Previous != next {
				return errors.New("rollback target is not the recorded previous release")
			}
		} else if current.Generation > 0 && current.Active == next {
			return errors.New("release is already selected")
		}
		if err := verifyStaged(root, m, zipBytes, fingerprint); err != nil {
			return err
		}
		prior := current.Active
		if current.Generation > 0 {
			current.Previous = &prior
		} else {
			current.Previous = nil
		}
		current.Active = next
		current.Generation++
		current.SelectedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := writePointer(path, current); err != nil {
			return err
		}
		result = current
		return nil
	})
	return result, err
}

func selectionStatus(root, key string) (activePointer, error) {
	var p activePointer
	if !validPackageKey(key) {
		return p, errors.New("invalid package key")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return p, err
	}
	if err := directoryNoLinks(root); err != nil {
		return p, err
	}
	if err := directoryNoLinks(filepath.Join(root, "active")); err != nil {
		return p, err
	}
	p, err = readPointer(filepath.Join(root, "active", key+".json"), key)
	if err != nil {
		return p, err
	}
	if p.Generation == 0 {
		return p, errors.New("package has no selected content")
	}
	return p, nil
}

// Reopen a previously verified staged tree and re-hash every signed member.
// This is a read-only diagnostic independent of local pointer state and
// does not assert entitlement or OS installation.
type stageAudit struct {
	Schema           int    `json:"schema"`
	PackageKey       string `json:"packageKey"`
	Version          string `json:"version"`
	ArchiveSha256    string `json:"archiveSha256"`
	SigningKeySha256 string `json:"signingKeySha256"`
	State            string `json:"state"`
	OSAttested       bool   `json:"osAttested"`
}

func auditStagedContent(o options) (stageAudit, error) {
	var out stageAudit
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256 ||
		o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey ||
		o.ExpectedVersion != "" && o.ExpectedVersion != m.Version {
		return out, errors.New("stage audit does not match selected Package target")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	err = withSelectionLock(root, m.PackageKey, func(_ string) error {
		if err := verifyStaged(root, m, archive, fingerprint); err != nil {
			return err
		}
		out = stageAudit{Schema: 1, PackageKey: m.PackageKey,
			Version: m.Version, ArchiveSha256: m.ArtifactSha256,
			SigningKeySha256: fingerprint,
			State:            "verified_staged_not_installed", OSAttested: false}
		return nil
	})
	return out, err
}

// Verify that a selected (or the recorded previous) content tree still matches
// the independently pinned, signed ZIP. On-demand diagnostics only: no
// installation, no current-entitlement grant, no OS health attestation.
type selectionAudit struct {
	Schema        int    `json:"schema"`
	PackageKey    string `json:"packageKey"`
	Version       string `json:"version"`
	ArchiveSha256 string `json:"archiveSha256"`
	Generation    uint64 `json:"generation"`
	Slot          string `json:"slot"`
	State         string `json:"state"`
	OSAttested    bool   `json:"osAttested"`
}

func auditSelectedContent(o options) (selectionAudit, error) {
	var out selectionAudit
	m, archive, fingerprint, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	err = withSelectionLock(root, m.PackageKey, func(pointerPath string) error {
		current, err := readPointer(pointerPath, m.PackageKey)
		if err != nil {
			return err
		}
		if current.Generation == 0 {
			return errors.New("no selected Package content")
		}
		candidate := selection{Version: m.Version, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: fingerprint}
		slot := ""
		if current.Active == candidate {
			slot = "active"
		} else if current.Previous != nil && *current.Previous == candidate {
			slot = "previous"
		}
		if slot == "" {
			return errors.New("signed artifact is not recorded in current selection")
		}
		if err := verifyStaged(root, m, archive, fingerprint); err != nil {
			return err
		}
		out = selectionAudit{Schema: 1, PackageKey: m.PackageKey, Version: m.Version, ArchiveSha256: m.ArtifactSha256, Generation: current.Generation, Slot: slot, State: "verified_selected_content_not_installed", OSAttested: false}
		return nil
	})
	return out, err
}

package main

// Read-only destination comparison. The package content must be independently
// verified against the signed release before destination paths are inspected.
// This does not grant permission to replace arbitrary user files.
import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type fileUpdateEntry struct {
	Path              string `json:"path"`
	State             string `json:"state"` // missing, current, different
	SourceSha256      string `json:"sourceSha256"`
	DestinationSha256 string `json:"destinationSha256,omitempty"`
	TrackedSha256     string `json:"trackedSha256,omitempty"`
	Action            string `json:"action"` // add, keep, update_managed, conflict_untracked, conflict_modified
	Bytes             uint64 `json:"bytes"`
}
type fileUpdatePreview struct {
	Schema                    int               `json:"schema"`
	PackageKey                string            `json:"packageKey"`
	Version                   string            `json:"version"`
	ArtifactSha256            string            `json:"artifactSha256"`
	Destination               string            `json:"destination"`
	Missing                   int               `json:"missing"`
	Current                   int               `json:"current"`
	Different                 int               `json:"different"`
	ManagedUpdates            int               `json:"managedUpdates"`
	UntrackedConflicts        int               `json:"untrackedConflicts"`
	ModifiedConflicts         int               `json:"modifiedConflicts"`
	ForeignOwnershipConflicts int               `json:"foreignOwnershipConflicts"`
	OverlappingRoots          int               `json:"overlappingRoots"`
	OverlappingRootExamples   []string          `json:"overlappingRootExamples"`
	ForeignOwnershipExamples  []string          `json:"foreignOwnershipExamples"`
	CanUpdateSafely           bool              `json:"canUpdateSafely"`
	DependenciesReady         bool              `json:"dependenciesReady"`
	DependencyBlocker         string            `json:"dependencyBlocker,omitempty"`
	PreviousArtifactSha256    string            `json:"previousArtifactSha256,omitempty"`
	PendingRecovery           bool              `json:"pendingRecovery"`
	Entries                   []fileUpdateEntry `json:"entries"`
	ReadOnly                  bool              `json:"readOnly"`
}

func compareManagedDestination(o options, destination string) (fileUpdatePreview, error) {
	var out fileUpdatePreview
	if destination == "" || o.Grant != "" || o.TrustedControlKeySha256 != "" {
		return out, errors.New("read-only file preview requires destination and refuses deployment grant")
	}
	m, archive, fp, err := verifyInput(o)
	if err != nil {
		return out, err
	}
	if (o.ExpectedArtifactSha256 != "" && o.ExpectedArtifactSha256 != m.ArtifactSha256) ||
		(o.ExpectedPackageKey != "" && o.ExpectedPackageKey != m.PackageKey) ||
		(o.ExpectedVersion != "" && o.ExpectedVersion != m.Version) {
		return out, errors.New("signed release differs from selected target")
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	if err = directoryNoLinks(root); err != nil {
		return out, err
	}
	current, err := managedStatus(root, m.PackageKey)
	if err != nil {
		return out, err
	}
	chosen := selection{Version: m.Version, ArchiveSha256: m.ArtifactSha256, SigningKeySha256: fp}
	if current.Active != chosen {
		return out, errors.New("release is not current managed content")
	}
	if err = verifyStaged(root, m, archive, fp); err != nil {
		return out, err
	}
	managed := filepath.Join(root, "managed", m.PackageKey, m.ArtifactSha256)
	if err = verifyManagedBytes(managed, archive); err != nil {
		return out, err
	}
	dest, err := filepath.Abs(destination)
	if err != nil {
		return out, err
	}
	if err = validateSafeTargetPath(dest); err != nil {
		return out, err
	}
	if dest == root || strings.HasPrefix(dest, root+string(os.PathSeparator)) ||
		root == dest || strings.HasPrefix(root, dest+string(os.PathSeparator)) {
		return out, errors.New("destination must not overlap Cluster's private root")
	}
	// Require a pre-existing, ordinary directory. Never follow symlinks in any
	// path component, including parent directories or inside the destination.
	if err = directoryNoLinks(dest); err != nil {
		return out, err
	}
	info, err := os.Lstat(dest)
	if err != nil || !info.IsDir() {
		return out, errors.New("destination must exist as a real directory")
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return out, err
	}
	out = fileUpdatePreview{Schema: 1, PackageKey: m.PackageKey, Version: m.Version,
		ArtifactSha256: m.ArtifactSha256, Destination: dest, Entries: []fileUpdateEntry{}, ReadOnly: true}
	for _, file := range zr.File {
		if err = secureName(file.Name); err != nil {
			return fileUpdatePreview{}, err
		}
		if file.FileInfo().IsDir() {
			continue
		}
		relative := filepath.FromSlash(file.Name)
		target := filepath.Join(dest, relative)
		if err = verifyDestinationParents(dest, filepath.Dir(target)); err != nil {
			return fileUpdatePreview{}, err
		}
		src, err := file.Open()
		if err != nil {
			return fileUpdatePreview{}, err
		}
		h := sha256.New()
		n, readErr := io.Copy(h, io.LimitReader(src, maxExpandedSize+1))
		closeErr := src.Close()
		if readErr != nil || closeErr != nil || uint64(n) != file.UncompressedSize64 {
			return fileUpdatePreview{}, errors.New("invalid verified archive member")
		}
		entry := fileUpdateEntry{Path: file.Name, SourceSha256: hex.EncodeToString(h.Sum(nil)), Bytes: file.UncompressedSize64}
		fi, statErr := os.Lstat(target)
		if os.IsNotExist(statErr) {
			entry.State = "missing"
			out.Missing++
		} else if statErr != nil || !fi.Mode().IsRegular() {
			return fileUpdatePreview{}, errors.New("unsafe destination entry at " + file.Name)
		} else {
			f, openErr := os.Open(target)
			if openErr != nil {
				return fileUpdatePreview{}, openErr
			}
			dh := sha256.New()
			// Bound reads for a malformed or unexpectedly huge local file.
			count, copyErr := io.Copy(dh, io.LimitReader(f, maxExpandedSize+1))
			closeErr := f.Close()
			if copyErr != nil || closeErr != nil {
				return fileUpdatePreview{}, errors.New("cannot read destination member")
			}
			entry.DestinationSha256 = hex.EncodeToString(dh.Sum(nil))
			if count == n && entry.DestinationSha256 == entry.SourceSha256 {
				entry.State = "current"
				out.Current++
			} else {
				entry.State = "different"
				out.Different++
			}
		}
		out.Entries = append(out.Entries, entry)
	}
	// Read the existing destination ownership ledger without creating directories,
	// consuming grants, repairing pending transactions or mutating tracked state.
	// A pending journal is not an empty state: preview must warn about recovery.
	privateKey := sha256.Sum256([]byte(out.Destination))
	destinationLedger := filepath.Join(root, "file-updates", hex.EncodeToString(privateKey[:]))
	private := filepath.Join(destinationLedger, m.PackageKey)
	if info, statErr := os.Lstat(private); statErr == nil {
		if !info.IsDir() || directoryNoLinks(private) != nil {
			return fileUpdatePreview{}, errors.New("unsafe destination update ledger")
		}
	} else if !os.IsNotExist(statErr) {
		return fileUpdatePreview{}, statErr
	}
	statePath := filepath.Join(private, "state.json")
	prior, err := readDestinationState(statePath, m.PackageKey, out.Destination)
	if err != nil {
		return fileUpdatePreview{}, err
	}
	out.PreviousArtifactSha256 = prior.ArtifactSha256
	if info, statErr := os.Lstat(filepath.Join(private, "pending.json")); statErr == nil {
		if !info.Mode().IsRegular() {
			return fileUpdatePreview{}, errors.New("unsafe pending destination journal")
		}
		out.PendingRecovery = true
	} else if !os.IsNotExist(statErr) {
		return fileUpdatePreview{}, statErr
	}
	if _, statErr := os.Lstat(filepath.Join(destinationLedger, ".destination.lock")); statErr == nil {
		out.PendingRecovery = true
	} else if !os.IsNotExist(statErr) {
		return fileUpdatePreview{}, statErr
	}
	if _, statErr := os.Lstat(filepath.Join(private, ".lock")); statErr == nil {
		out.PendingRecovery = true
	} else if !os.IsNotExist(statErr) {
		return fileUpdatePreview{}, statErr
	}
	classifyDestinationActions(&out, prior)
	if err := populateForeignOwnership(root, &out); err != nil {
		return fileUpdatePreview{}, err
	}
	if err := inspectOverlappingRoots(root, &out); err != nil {
		return fileUpdatePreview{}, err
	}
	out.DependenciesReady = true
	if err := verifySelectedDependencies(root, m); err != nil {
		out.DependenciesReady = false
		out.DependencyBlocker = err.Error()
		out.CanUpdateSafely = false
	}
	sort.Slice(out.Entries, func(i, j int) bool { return out.Entries[i].Path < out.Entries[j].Path })
	after, err := managedStatus(root, m.PackageKey)
	if err != nil || after.Generation != current.Generation || after.Active != current.Active {
		return fileUpdatePreview{}, errors.New("managed selection changed during preview")
	}
	return out, nil
}

func verifyDestinationParents(root, parent string) error {
	rel, err := filepath.Rel(root, parent)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return errors.New("destination traversal")
	}
	if rel == "." {
		return nil
	}
	cursor := root
	for _, part := range strings.Split(rel, string(os.PathSeparator)) {
		cursor = filepath.Join(cursor, part)
		fi, err := os.Lstat(cursor)
		if os.IsNotExist(err) {
			return nil
		} // Missing children become preview-only missing targets.
		if err != nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe destination parent")
		}
	}
	return nil
}

// Classify the immutable preview against the prior tracked content ledger.
// This is advisory only: the mutating operation rechecks every hash under lock.
func classifyDestinationActions(view *fileUpdatePreview, prior destinationState) {
	view.ManagedUpdates, view.UntrackedConflicts, view.ModifiedConflicts = 0, 0, 0
	for i := range view.Entries {
		entry := &view.Entries[i]
		entry.TrackedSha256 = prior.Files[entry.Path]
		switch entry.State {
		case "missing":
			entry.Action = "add"
		case "current":
			entry.Action = "keep"
		case "different":
			if entry.TrackedSha256 == "" {
				entry.Action = "conflict_untracked"
				view.UntrackedConflicts++
			} else if entry.TrackedSha256 != entry.DestinationSha256 {
				entry.Action = "conflict_modified"
				view.ModifiedConflicts++
			} else {
				entry.Action = "update_managed"
				view.ManagedUpdates++
			}
		}
	}
	view.CanUpdateSafely = !view.PendingRecovery && view.UntrackedConflicts == 0 && view.ModifiedConflicts == 0 && view.ForeignOwnershipConflicts == 0
}

// Foreign ownership is a separate guard from matching file hashes. Two distinct
// Packages must not silently claim the same destination relative path, including
// older tracked/retired members. This is an exact-destination ledger check, NOT
// protection against independently configured overlapping parent/child roots.
const maxDestinationOwners = 256
const maxForeignTrackedFiles = 8192
const maxForeignExamples = 12

func populateForeignOwnership(root string, view *fileUpdatePreview) error {
	view.ForeignOwnershipConflicts = 0
	view.ForeignOwnershipExamples = []string{}
	digest := sha256.Sum256([]byte(view.Destination))
	parent := filepath.Join(root, "file-updates", hex.EncodeToString(digest[:]))
	info, err := os.Lstat(parent)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || directoryNoLinks(parent) != nil {
		return errors.New("unsafe destination ownership directory")
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		return err
	}
	if len(entries) > maxDestinationOwners {
		return errors.New("too many destination ownership records; cannot prove isolation")
	}
	tracked := make(map[string]struct{})
	count := 0
	for _, entry := range entries {
		name := entry.Name()
		if name == ".destination.lock" { // lock is checked independently by preview
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return errors.New("unsafe destination operation lock")
			}
			continue
		}
		if name == view.PackageKey {
			continue
		}
		if !validPackageKey(name) || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return errors.New("unknown or unsafe destination ownership record")
		}
		foreignPath := filepath.Join(parent, name)
		if directoryNoLinks(foreignPath) != nil {
			return errors.New("unsafe foreign ownership directory")
		}
		state, err := readDestinationState(filepath.Join(foreignPath, "state.json"), name, view.Destination)
		if err != nil {
			return fmt.Errorf("foreign Package destination ledger cannot be trusted: %w", err)
		}
		count += len(state.Files)
		if count > maxForeignTrackedFiles {
			return errors.New("foreign Package ownership scan exceeded safety limit")
		}
		for name := range state.Files {
			tracked[strings.ToLower(name)] = struct{}{}
		}
	}
	for _, entry := range view.Entries {
		if _, owns := tracked[strings.ToLower(entry.Path)]; owns {
			view.ForeignOwnershipConflicts++
			if len(view.ForeignOwnershipExamples) < maxForeignExamples {
				view.ForeignOwnershipExamples = append(view.ForeignOwnershipExamples, entry.Path)
			}
		}
	}
	if view.ForeignOwnershipConflicts > 0 {
		view.CanUpdateSafely = false
	}
	return nil
}

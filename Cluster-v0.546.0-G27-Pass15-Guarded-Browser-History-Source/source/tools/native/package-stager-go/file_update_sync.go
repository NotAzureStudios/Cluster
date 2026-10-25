package main

// Destination file synchronization is deliberately distinct from Package deployment:
// no process execution, software installation, elevation, or unrestricted overwrite.
// Existing files may be replaced ONLY when the previous managed hash matches.
// A private, persisted preimage journal makes the most recent update reversible.
import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type destinationState struct {
	Schema         int               `json:"schema"`
	PackageKey     string            `json:"packageKey"`
	Destination    string            `json:"destination"`
	ArtifactSha256 string            `json:"artifactSha256"`
	Files          map[string]string `json:"files"`
	LastUpdate     string            `json:"lastUpdate,omitempty"`
}
type destinationChange struct {
	Path   string `json:"path"`
	Before string `json:"before,omitempty"`
	After  string `json:"after"`
	Backup string `json:"backup,omitempty"`
}
type destinationJournal struct {
	Schema  int                 `json:"schema"`
	ID      string              `json:"id"`
	Before  destinationState    `json:"before"`
	After   destinationState    `json:"after"`
	Changes []destinationChange `json:"changes"`
}
type destinationSyncResult struct {
	Schema         int    `json:"schema"`
	PackageKey     string `json:"packageKey"`
	ArtifactSha256 string `json:"artifactSha256"`
	Destination    string `json:"destination"`
	Version        string `json:"version,omitempty"`
	Added          int    `json:"added"`
	Replaced       int    `json:"replaced"`
	Unchanged      int    `json:"unchanged"`
	Preserved      int    `json:"preserved"`
	State          string `json:"state"`
	Executed       bool   `json:"executed"`
}

func syncFolder(o options, destination string, rollback bool, adoptExisting bool) (destinationSyncResult, error) {
	var result destinationSyncResult
	// This is a native, explicitly selected destination, never a renderer-supplied
	// arbitrary path or an installer activation. Verify signed managed bytes first.
	preview, err := compareManagedDestination(o, destination)
	if err != nil {
		return result, err
	}
	root, _ := filepath.Abs(o.Root)
	if !rollback { // new content needs its signed prerequisites
		m, _, _, err := verifyInput(o)
		if err != nil {
			return result, err
		}
		if err := verifySelectedDependencies(root, m); err != nil {
			return result, err
		}
	}
	// The registry lock serializes ALL destination mutations, including nested
	// roots. Exact-destination locks alone cannot protect C:/Studio and its child.
	// A crash leaves the lock for operator inspection, never automatic stealing.
	registry := filepath.Join(root, "file-updates")
	if err := os.MkdirAll(registry, 0700); err != nil {
		return result, err
	}
	if err := directoryNoLinks(registry); err != nil {
		return result, err
	}
	registryLock := filepath.Join(registry, ".registry.lock")
	if err := os.Mkdir(registryLock, 0700); err != nil {
		return result, errors.New("destination registry is busy or needs recovery inspection")
	}
	defer os.Remove(registryLock)
	// Never act on a preview taken before another Package claimed a parent or
	// child destination. Also recheck after recovering a pending journal.
	preview, err = compareManagedDestination(o, destination)
	if err != nil {
		return result, err
	}
	if preview.OverlappingRoots != 0 {
		return result, errors.New("overlapping managed destination root; no files changed")
	}
	key := sha256.Sum256([]byte(preview.Destination))
	destinationLedger := filepath.Join(registry, hex.EncodeToString(key[:]))
	if err := os.MkdirAll(destinationLedger, 0700); err != nil {
		return result, err
	}
	if err := directoryNoLinks(destinationLedger); err != nil {
		return result, err
	}
	// Serialize *all* Package writers to this exact directory, not just writers
	// sharing one Package ID. Never steal an orphan lock after a crash.
	globalLock := filepath.Join(destinationLedger, ".destination.lock")
	if err := os.Mkdir(globalLock, 0700); err != nil {
		return result, errors.New("another Package is updating this destination or an interrupted lock requires inspection")
	}
	defer os.Remove(globalLock)
	private := filepath.Join(destinationLedger, preview.PackageKey)
	if err := os.MkdirAll(private, 0700); err != nil {
		return result, err
	}
	if err := directoryNoLinks(private); err != nil {
		return result, err
	}
	lock := filepath.Join(private, ".lock")
	if err := os.Mkdir(lock, 0700); err != nil {
		return result, errors.New("destination operation already running or left a lock; inspect it before retrying")
	}
	defer os.Remove(lock)
	statePath := filepath.Join(private, "state.json")
	pendingPath := filepath.Join(private, "pending.json")
	prior, err := readDestinationState(statePath, preview.PackageKey, preview.Destination)
	if err != nil {
		return result, err
	}
	if err := recoverDestinationPending(pendingPath, private, preview.Destination, prior); err != nil {
		return result, err
	}
	// Recovery can change destination bytes: do not rely on the pre-recovery
	// comparison to decide which files are current or require replacement.
	preview, err = compareManagedDestination(o, destination)
	if err != nil {
		return result, err
	}
	prior, err = readDestinationState(statePath, preview.PackageKey, preview.Destination)
	if err != nil {
		return result, err
	}
	// All conflicts must be known before any backup directory is created.
	// compareManagedDestination sees our own held .lock and correctly marks a
	// concurrent preview as requiring recovery; the current operation owns it.
	classifyDestinationActions(&preview, prior)
	// Revalidate under the destination-wide lock. Explicit adoption may never
	// override another Package's tracked member.
	if err := populateForeignOwnership(root, &preview); err != nil {
		return result, err
	}
	if err := inspectOverlappingRoots(root, &preview); err != nil {
		return result, err
	}
	if preview.OverlappingRoots != 0 {
		return result, errors.New("overlapping managed destination root; no files changed")
	}
	if preview.ForeignOwnershipConflicts != 0 {
		return result, fmt.Errorf("destination contains %d files owned by another Package; no changes made", preview.ForeignOwnershipConflicts)
	}
	if !rollback && !adoptExisting && (preview.UntrackedConflicts != 0 || preview.ModifiedConflicts != 0) {
		return result, fmt.Errorf("destination update blocked: %d untracked collisions, %d locally modified files; no update journal created", preview.UntrackedConflicts, preview.ModifiedConflicts)
	}
	result = destinationSyncResult{Schema: 1, PackageKey: preview.PackageKey, ArtifactSha256: preview.ArtifactSha256, Destination: preview.Destination, Version: preview.Version, Executed: false}
	if rollback {
		if prior.ArtifactSha256 != preview.ArtifactSha256 {
			return result, errors.New("tracked destination is not the currently selected managed release")
		}
		if prior.LastUpdate == "" {
			return result, errors.New("no previous tracked destination update to roll back")
		}
		journal, err := readDestinationJournal(filepath.Join(private, "operations", prior.LastUpdate, "journal.json"))
		if err != nil {
			return result, err
		}
		if journal.After.ArtifactSha256 != prior.ArtifactSha256 || journal.After.Destination != preview.Destination || journal.ID != prior.LastUpdate {
			return result, errors.New("rollback journal does not match tracked destination")
		}
		if err := restoreDestinationJournal(preview.Destination, filepath.Join(private, "operations", journal.ID), journal); err != nil {
			return result, err
		}
		if err := writeDestinationState(statePath, journal.Before); err != nil {
			return result, err
		}
		result.Replaced = len(journal.Changes)
		result.State = "destination_rolled_back_files_not_executed"
		return result, nil
	}
	if prior.ArtifactSha256 != "" && prior.ArtifactSha256 == preview.ArtifactSha256 && preview.Different == 0 && preview.Missing == 0 {
		result.Unchanged = preview.Current
		result.State = "destination_current_files_not_executed"
		return result, nil
	}
	next := destinationState{Schema: 1, PackageKey: preview.PackageKey, Destination: preview.Destination, ArtifactSha256: preview.ArtifactSha256, Files: map[string]string{}}
	for name, hash := range prior.Files {
		next.Files[name] = hash
	} // preserve obsolete files; never delete user data implicitly
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		return result, err
	}
	id := hex.EncodeToString(idBytes)
	opDir := filepath.Join(private, "operations", id)
	if err := os.MkdirAll(filepath.Join(opDir, "backups"), 0700); err != nil {
		return result, err
	}
	managed := filepath.Join(root, "managed", preview.PackageKey, preview.ArtifactSha256)
	journal := destinationJournal{Schema: 1, ID: id, Before: prior, Changes: []destinationChange{}}
	for i, entry := range preview.Entries {
		next.Files[entry.Path] = entry.SourceSha256
		if entry.State == "current" {
			result.Unchanged++
			continue
		}
		if entry.State == "different" && !adoptExisting && (prior.Files[entry.Path] == "" || prior.Files[entry.Path] != entry.DestinationSha256) {
			return result, fmt.Errorf("local changes or untracked existing file conflict at %s", entry.Path)
		}
		change := destinationChange{Path: entry.Path, Before: entry.DestinationSha256, After: entry.SourceSha256}
		if entry.State == "different" {
			change.Backup = fmt.Sprintf("backups/%04d", i)
			target := filepath.Join(preview.Destination, filepath.FromSlash(entry.Path))
			if err := copyVerifiedFile(target, filepath.Join(opDir, filepath.FromSlash(change.Backup)), entry.DestinationSha256); err != nil {
				return result, err
			}
			result.Replaced++
		} else {
			result.Added++
		}
		if err := verifyDestinationParents(preview.Destination, filepath.Dir(filepath.Join(preview.Destination, filepath.FromSlash(entry.Path)))); err != nil {
			return result, err
		}
		if err := verifyRegularDigest(filepath.Join(managed, filepath.FromSlash(entry.Path)), entry.SourceSha256); err != nil {
			return result, err
		}
		journal.Changes = append(journal.Changes, change)
	}
	result.Preserved = len(prior.Files)
	if len(journal.Changes) == 0 {
		// Track exact signed content on first adoption without creating a no-op rollback.
		next.LastUpdate = prior.LastUpdate
		if err := writeDestinationState(statePath, next); err != nil {
			return result, err
		}
		result.State = "destination_current_files_not_executed"
		return result, nil
	}
	next.LastUpdate = id
	journal.After = next
	if err := writeAtomicJSON(filepath.Join(opDir, "journal.json"), journal); err != nil {
		return result, err
	}
	if err := writeAtomicJSON(pendingPath, journal); err != nil {
		return result, err
	}
	for _, change := range journal.Changes {
		target := filepath.Join(preview.Destination, filepath.FromSlash(change.Path))
		if err := verifyDestinationParents(preview.Destination, filepath.Dir(target)); err != nil {
			return result, err
		}
		if err := applyDestinationChange(filepath.Join(managed, filepath.FromSlash(change.Path)), target, change); err != nil {
			return result, err
		}
	}
	// Verify the resulting bytes before committing the tracked version.
	after, err := compareManagedDestination(o, preview.Destination)
	if err != nil {
		return result, err
	}
	if after.Different != 0 || after.Missing != 0 {
		return result, errors.New("destination contents changed before commit; recovery journal retained")
	}
	if err := writeDestinationState(statePath, next); err != nil {
		return result, err
	}
	if err := os.Remove(pendingPath); err != nil {
		return result, err
	}
	result.State = "destination_updated_files_not_executed"
	return result, nil
}

func readDestinationState(path, key, dest string) (destinationState, error) {
	empty := destinationState{Schema: 1, PackageKey: key, Destination: dest, Files: map[string]string{}}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	if !info.Mode().IsRegular() || info.Size() > 1024*1024 {
		return empty, errors.New("unsafe destination tracking file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return empty, err
	}
	var s destinationState
	if len(data) > 1024*1024 || json.Unmarshal(data, &s) != nil || s.Schema != 1 || s.PackageKey != key || s.Destination != dest || s.Files == nil {
		return empty, errors.New("invalid destination tracking state")
	}
	for name, hash := range s.Files {
		if secureName(name) != nil || !validDigest(hash) {
			return empty, errors.New("unsafe destination tracking state")
		}
	}
	if s.ArtifactSha256 != "" && !validDigest(s.ArtifactSha256) {
		return empty, errors.New("invalid tracked artifact hash")
	}
	if s.LastUpdate != "" && !validDigest(s.LastUpdate+strings.Repeat("0", 32)) {
		return empty, errors.New("invalid update id")
	}
	return s, nil
}
func validDigest(v string) bool {
	if len(v) != 64 {
		return false
	}
	_, err := hex.DecodeString(v)
	return err == nil && strings.ToLower(v) == v
}
func readDestinationJournal(path string) (destinationJournal, error) {
	var j destinationJournal
	info, err := os.Lstat(path)
	if err != nil {
		return j, err
	}
	if !info.Mode().IsRegular() || info.Size() > 1024*1024 {
		return j, errors.New("unsafe destination journal file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return j, err
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &j) != nil || j.Schema != 1 || len(j.ID) != 32 {
		return j, errors.New("invalid destination journal")
	}
	for _, c := range j.Changes {
		if secureName(c.Path) != nil || !validDigest(c.After) || (c.Before != "" && !validDigest(c.Before)) || (c.Backup != "" && (!strings.HasPrefix(c.Backup, "backups/") || strings.Contains(c.Backup, "..") || strings.Contains(c.Backup, "\\"))) {
			return j, errors.New("unsafe destination journal entry")
		}
	}
	return j, nil
}
func writeAtomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".cluster-state-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
func writeDestinationState(path string, s destinationState) error { return writeAtomicJSON(path, s) }
func verifyRegularDigest(path, digest string) error {
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() || fi.Mode()&os.ModeSymlink != 0 || fi.Size() > maxExpandedSize {
		return errors.New("unsafe or oversized file")
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(f, maxExpandedSize+1))
	cerr := f.Close()
	if err != nil || cerr != nil || n != fi.Size() || hex.EncodeToString(h.Sum(nil)) != digest {
		return errors.New("file changed during verified update")
	}
	return nil
}
func copyVerifiedFile(src, dst, digest string) error {
	if err := verifyRegularDigest(src, digest); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(out, h), io.LimitReader(in, maxExpandedSize+1))
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err != nil || closeErr != nil || hex.EncodeToString(h.Sum(nil)) != digest {
		os.Remove(dst)
		return errors.New("copy verification failed")
	}
	return nil
}
func applyDestinationChange(src, target string, c destinationChange) error {
	fi, err := os.Lstat(target)
	if c.Before == "" {
		if err == nil {
			return errors.New("new destination file appeared during update")
		}
		if !os.IsNotExist(err) {
			return err
		}
	}
	if c.Before != "" {
		if err != nil || !fi.Mode().IsRegular() {
			return errors.New("existing destination changed before replacement")
		}
		if err = verifyRegularDigest(target, c.Before); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	// Recheck the destination tree after creating missing intermediate folders.
	if err := directoryNoLinks(filepath.Dir(target)); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(target), ".cluster-next-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	tmp.Close()
	os.Remove(name)
	if err := copyVerifiedFile(src, name, c.After); err != nil {
		return err
	}
	defer os.Remove(name)
	if c.Before != "" {
		if err := os.Remove(target); err != nil {
			return err
		}
	} // restoration journal is already durable
	if err := os.Rename(name, target); err != nil {
		return err
	}
	return verifyRegularDigest(target, c.After)
}
func restoreDestinationJournal(dest, opDir string, j destinationJournal) error {
	// Validate the *entire* journal, every destination, and every backup before
	// restoring the first byte. Otherwise a conflict in a later entry could
	// leave a partially rolled-back multi-file operation.
	if err := preflightDestinationRestore(dest, opDir, j); err != nil {
		return err
	}
	for i := len(j.Changes) - 1; i >= 0; i-- {
		c := j.Changes[i]
		target := filepath.Join(dest, filepath.FromSlash(c.Path))
		if err := verifyDestinationParents(dest, filepath.Dir(target)); err != nil {
			return err
		}
		fi, err := os.Lstat(target)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && !fi.Mode().IsRegular() {
			return errors.New("unsafe file during rollback")
		}
		if err == nil {
			if verifyRegularDigest(target, c.After) != nil {
				if c.Before != "" && verifyRegularDigest(target, c.Before) == nil {
					continue
				}
				return fmt.Errorf("local edit prevents rollback of %s", c.Path)
			}
		}
		if c.Before == "" {
			if err == nil {
				if err := os.Remove(target); err != nil {
					return err
				}
			}
			continue
		}
		if c.Backup == "" {
			return errors.New("missing rollback backup")
		}
		backup := filepath.Join(opDir, filepath.FromSlash(c.Backup))
		if err := verifyRegularDigest(backup, c.Before); err != nil {
			return err
		}
		tmp, err := os.CreateTemp(filepath.Dir(target), ".cluster-restore-*")
		if err != nil {
			return err
		}
		name := tmp.Name()
		tmp.Close()
		os.Remove(name)
		if err := copyVerifiedFile(backup, name, c.Before); err != nil {
			return err
		}
		if err == nil {
			if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
				os.Remove(name)
				return err
			}
		}
		if err := os.Rename(name, target); err != nil {
			os.Remove(name)
			return err
		}
	}
	return nil
}
func recoverDestinationPending(path, private, dest string, active destinationState) error {
	j, err := readDestinationJournal(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if j.After.Destination != dest || j.After.PackageKey != active.PackageKey {
		return errors.New("pending update belongs to a different destination")
	}
	if active.LastUpdate == j.ID && active.ArtifactSha256 == j.After.ArtifactSha256 {
		return os.Remove(path) // state committed before interrupted cleanup
	}
	if err := restoreDestinationJournal(dest, filepath.Join(private, "operations", j.ID), j); err != nil {
		return err
	}
	return os.Remove(path)
}

func preflightDestinationRestore(dest, opDir string, j destinationJournal) error {
	seen := make(map[string]bool, len(j.Changes))
	if len(j.Changes) > maxFiles {
		return errors.New("rollback journal exceeds signed file limit")
	}
	for _, c := range j.Changes {
		if err := secureName(c.Path); err != nil {
			return err
		}
		name := strings.ToLower(c.Path)
		if seen[name] {
			return errors.New("duplicate path in rollback journal")
		}
		seen[name] = true
		if !validDigest(c.After) || (c.Before != "" && !validDigest(c.Before)) {
			return errors.New("invalid rollback digest")
		}
		target := filepath.Join(dest, filepath.FromSlash(c.Path))
		if err := verifyDestinationParents(dest, filepath.Dir(target)); err != nil {
			return err
		}
		info, err := os.Lstat(target)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("unsafe rollback destination %s", c.Path)
			}
			if verifyRegularDigest(target, c.After) != nil &&
				(c.Before == "" || verifyRegularDigest(target, c.Before) != nil) {
				return fmt.Errorf("local edit prevents rollback of %s", c.Path)
			}
		}
		if c.Before != "" {
			if c.Backup == "" || !strings.HasPrefix(c.Backup, "backups/") ||
				strings.Contains(c.Backup, "..") || strings.Contains(c.Backup, "\\") {
				return errors.New("missing or unsafe rollback backup")
			}
			backup := filepath.Join(opDir, filepath.FromSlash(c.Backup))
			if err := verifyRegularDigest(backup, c.Before); err != nil {
				return fmt.Errorf("rollback backup unverified: %w", err)
			}
		}
	}
	return nil
}

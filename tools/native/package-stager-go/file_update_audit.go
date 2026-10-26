package main

// Destination integrity audit is a read-only observation of locally tracked
// managed files. It is NOT a software installation or machine attestation.
// Every call verifies the signed, currently selected release before examining
// destination state; no repair, authorization grant, or file execution occurs.
import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
)

const maxDestinationAuditTracked = 4096
const maxDestinationAuditIssues = 20
const maxDestinationAuditBytes int64 = 512 * 1024 * 1024

type destinationAuditIssue struct {
	Path  string `json:"path"`
	State string `json:"state"`
}
type destinationAudit struct {
	Schema                int                     `json:"schema"`
	PackageKey            string                  `json:"packageKey"`
	Version               string                  `json:"version"`
	ArtifactSha256        string                  `json:"artifactSha256"`
	TrackedArtifactSha256 string                  `json:"trackedArtifactSha256,omitempty"`
	Destination           string                  `json:"destination"`
	Tracked               int                     `json:"tracked"`
	Verified              int                     `json:"verified"`
	Missing               int                     `json:"missing"`
	Modified              int                     `json:"modified"`
	Retired               int                     `json:"retired"`
	RetiredVerified       int                     `json:"retiredVerified"`
	RetiredMissing        int                     `json:"retiredMissing"`
	RetiredModified       int                     `json:"retiredModified"`
	UntrackedCurrent      int                     `json:"untrackedCurrent"`
	UntrackedMissing      int                     `json:"untrackedMissing"`
	UntrackedCollision    int                     `json:"untrackedCollision"`
	PendingRecovery       bool                    `json:"pendingRecovery"`
	Healthy               bool                    `json:"healthy"`
	Issues                []destinationAuditIssue `json:"issues"`
	ReadOnly              bool                    `json:"readOnly"`
	Executed              bool                    `json:"executed"`
}

// A single observed hash is never an ownership assertion. Only signed releases
// plus the matching private state ledger establish tracked identity.
func auditDestinationFile(dest, rel string, expected string, readBudget *int64) (string, error) {
	if err := secureName(rel); err != nil {
		return "", err
	}
	path := filepath.Join(dest, filepath.FromSlash(rel))
	if err := verifyDestinationParents(dest, filepath.Dir(path)); err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return "missing", nil
	}
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("unsafe audited destination member: " + rel)
	}
	if info.Size() < 0 || info.Size() > maxExpandedSize {
		return "modified", nil
	}
	if info.Size() > *readBudget {
		return "", errors.New("destination audit exceeds bounded byte scan")
	}
	*readBudget -= info.Size()
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	digest := sha256.New()
	count, readErr := io.Copy(digest, io.LimitReader(f, maxExpandedSize+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil {
		return "", errors.New("cannot read audited destination member: " + rel)
	}
	if count > maxExpandedSize || hex.EncodeToString(digest.Sum(nil)) != expected {
		return "modified", nil
	}
	return "verified", nil
}

func auditDestinationFiles(o options, destination string) (destinationAudit, error) {
	var out destinationAudit
	preview, err := compareManagedDestination(o, destination)
	if err != nil {
		return out, err
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return out, err
	}
	initial, err := managedStatus(root, preview.PackageKey)
	if err != nil || initial.Active.ArchiveSha256 != preview.ArtifactSha256 || initial.Active.Version != preview.Version {
		return out, errors.New("managed selection changed before destination audit")
	}
	key := sha256.Sum256([]byte(preview.Destination))
	private := filepath.Join(root, "file-updates", hex.EncodeToString(key[:]), preview.PackageKey)
	statePath := filepath.Join(private, "state.json")
	prior, err := readDestinationState(statePath, preview.PackageKey, preview.Destination)
	if err != nil {
		return out, err
	}
	if len(prior.Files) > maxDestinationAuditTracked {
		return out, errors.New("destination audit exceeds bounded tracked file count")
	}
	out = destinationAudit{Schema: 1, PackageKey: preview.PackageKey, Version: preview.Version,
		ArtifactSha256: preview.ArtifactSha256, TrackedArtifactSha256: prior.ArtifactSha256,
		Destination: preview.Destination, Tracked: len(prior.Files), PendingRecovery: preview.PendingRecovery,
		Issues: []destinationAuditIssue{}, ReadOnly: true, Executed: false}
	selected := make(map[string]bool, len(preview.Entries))
	// Deterministic issue selection, even when the ledger map iteration changes.
	paths := make([]string, 0, len(prior.Files))
	for name := range prior.Files {
		paths = append(paths, name)
	}
	sort.Strings(paths)
	addIssue := func(path, state string) {
		if len(out.Issues) < maxDestinationAuditIssues {
			out.Issues = append(out.Issues, destinationAuditIssue{Path: path, State: state})
		}
	}
	for _, entry := range preview.Entries {
		selected[entry.Path] = true
	}
	remainingBytes := maxDestinationAuditBytes
	for _, name := range paths {
		state, err := auditDestinationFile(preview.Destination, name, prior.Files[name], &remainingBytes)
		if err != nil {
			return destinationAudit{}, err
		}
		if !selected[name] {
			out.Retired++
		}
		switch state {
		case "verified":
			if selected[name] {
				out.Verified++
			} else {
				out.RetiredVerified++
			}
		case "missing":
			if selected[name] {
				out.Missing++
				addIssue(name, "tracked_missing")
			} else {
				out.RetiredMissing++
				addIssue(name, "retired_missing")
			}
		case "modified":
			if selected[name] {
				out.Modified++
				addIssue(name, "tracked_modified")
			} else {
				out.RetiredModified++
				addIssue(name, "retired_modified")
			}
		}
	}
	for _, entry := range preview.Entries {
		if selected[entry.Path] && prior.Files[entry.Path] != "" {
			continue
		}
		switch entry.State {
		case "missing":
			out.UntrackedMissing++
		case "current":
			out.UntrackedCurrent++
		case "different":
			out.UntrackedCollision++
			addIssue(entry.Path, "untracked_collision")
		}
	}
	// There may be more retired tracked files than the currently signed release.
	// The read-only result never deletes, adopts or 'repairs' any of them.
	after, err := readDestinationState(statePath, preview.PackageKey, preview.Destination)
	if err != nil {
		return destinationAudit{}, err
	}
	if !reflect.DeepEqual(after, prior) {
		return destinationAudit{}, errors.New("destination tracking ledger changed during audit")
	}
	final, err := managedStatus(root, preview.PackageKey)
	if err != nil || final.Generation != initial.Generation || final.Active != initial.Active {
		return destinationAudit{}, errors.New("managed selection changed during destination audit")
	}
	out.Healthy = !out.PendingRecovery && out.Tracked > 0 && out.TrackedArtifactSha256 == out.ArtifactSha256 &&
		out.Missing == 0 && out.Modified == 0 && out.UntrackedMissing == 0 && out.UntrackedCollision == 0 && out.UntrackedCurrent == 0
	return out, nil
}

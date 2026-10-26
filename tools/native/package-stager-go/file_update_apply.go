package main

// An opt-in managed FILE copy into an existing user-selected directory. This
// does not install, execute or launch software. Existing differing content is
// never overwritten: conflicts remain for human review. Replacements and
// deletion require a separate, future consent/rollback policy.
import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type fileUpdateApply struct {
	Schema      int    `json:"schema"`
	PackageKey  string `json:"packageKey"`
	Version     string `json:"version"`
	Destination string `json:"destination"`
	Added       int    `json:"added"`
	Unchanged   int    `json:"unchanged"`
	Conflicts   int    `json:"conflicts"`
	State       string `json:"state"`
	Executed    bool   `json:"executed"`
}

func applyMissingManagedFiles(o options, destination string) (fileUpdateApply, error) {
	var result fileUpdateApply
	view, err := compareManagedDestination(o, destination)
	if err != nil {
		return result, err
	}
	// Existing conflicting files are never touched. Preserve each one and
	// make the state explicit rather than misrepresenting partial updates.
	if view.Different != 0 {
		return result, fmt.Errorf("%d locally modified or outdated destination files need review before updating", view.Different)
	}
	root, err := filepath.Abs(o.Root)
	if err != nil {
		return result, err
	}
	m, _, _, err := verifyInput(o)
	if err != nil {
		return result, err
	}
	if err := verifySelectedDependencies(root, m); err != nil {
		return result, err
	}
	if err != nil {
		return result, err
	}
	managed := filepath.Join(root, "managed", view.PackageKey, view.ArtifactSha256)
	result = fileUpdateApply{Schema: 1, PackageKey: view.PackageKey, Version: view.Version, Destination: view.Destination, Unchanged: view.Current, State: "missing_files_copied_not_executed", Executed: false}
	// Reject unexpected content in destination-path parents before starting.
	// Create no more than one file per independently verified signed entry.
	for _, entry := range view.Entries {
		if entry.State != "missing" {
			continue
		}
		source := filepath.Join(managed, filepath.FromSlash(entry.Path))
		target := filepath.Join(view.Destination, filepath.FromSlash(entry.Path))
		if err := verifyDestinationParents(view.Destination, filepath.Dir(target)); err != nil {
			return result, err
		}
		// Preserve existing paths even if they appear after preview.
		if _, err := os.Lstat(target); err == nil {
			return result, errors.New("destination changed during update")
		} else if !os.IsNotExist(err) {
			return result, err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return result, err
		}
		if err := verifyDestinationParents(view.Destination, filepath.Dir(target)); err != nil {
			return result, err
		}
		in, err := os.Open(source)
		if err != nil {
			return result, err
		}
		temp, err := os.CreateTemp(filepath.Dir(target), ".cluster-file-*")
		if err != nil {
			in.Close()
			return result, err
		}
		tempName := temp.Name()
		cleanup := func() { temp.Close(); os.Remove(tempName) }
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(temp, hash), io.LimitReader(in, int64(entry.Bytes)+1))
		closeErr := in.Close()
		if copyErr != nil || closeErr != nil || uint64(n) != entry.Bytes || hex.EncodeToString(hash.Sum(nil)) != entry.SourceSha256 {
			cleanup()
			return result, errors.New("managed source changed during copy")
		}
		if err := temp.Sync(); err != nil {
			cleanup()
			return result, err
		}
		if err := temp.Close(); err != nil {
			os.Remove(tempName)
			return result, err
		}
		// Do not overwrite any file. Use hard link to claim the absent path
		// atomically even on Windows, then remove the temporary staging file.
		if err := os.Link(tempName, target); err != nil {
			os.Remove(tempName)
			return result, fmt.Errorf("cannot safely claim missing destination: %w", err)
		}
		os.Remove(tempName)
		result.Added++
	}
	// A destination may be changed concurrently by other processes. Never
	// claim a fully synchronized state without checking the final projection.
	after, err := compareManagedDestination(o, destination)
	if err != nil {
		return result, err
	}
	if after.Missing != 0 || after.Different != 0 {
		return result, fmt.Errorf("destination changed during update: %d missing, %d different", after.Missing, after.Different)
	}
	result.State = "destination_matches_managed_files_not_executed"
	return result, nil
}

// Refuse accidentally selecting the root filesystem as a destination.
func validateSafeTargetPath(dest string) error {
	abs, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	vol := filepath.VolumeName(abs)
	rest := strings.Trim(abs[len(vol):], string(os.PathSeparator))
	if rest == "" {
		return errors.New("filesystem root is not a package destination")
	}
	return nil
}

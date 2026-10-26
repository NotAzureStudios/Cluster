package main

// The ownership registry is private, bounded and read-only. Native writers
// hold .registry.lock for the whole filesystem operation. A destination whose
// root is an ancestor/descendant of any other tracked root is refused, even
// when the current signed archive happens not to collide. This deliberately
// prefers isolation over silently adopting files after a later Package update.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxRegisteredDestinations = 1024
const maxRegisteredPackages = 4096

func sameOrNestedDestination(a, b string) bool {
	a = strings.ToLower(filepath.Clean(a))
	b = strings.ToLower(filepath.Clean(b))
	return a == b || strings.HasPrefix(a, b+string(os.PathSeparator)) || strings.HasPrefix(b, a+string(os.PathSeparator))
}

func inspectOverlappingRoots(root string, view *fileUpdatePreview) error {
	view.OverlappingRoots = 0
	view.OverlappingRootExamples = []string{}
	registry := filepath.Join(root, "file-updates")
	if info, err := os.Lstat(registry); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	} else if !info.IsDir() || directoryNoLinks(registry) != nil {
		return errors.New("unsafe managed destination registry")
	}
	entries, err := os.ReadDir(registry)
	if err != nil {
		return err
	}
	if len(entries) > maxRegisteredDestinations+1 {
		return errors.New("destination registry exceeds safe inspection limit")
	}
	thisHash := sha256.Sum256([]byte(view.Destination))
	thisID := hex.EncodeToString(thisHash[:])
	count := 0
	for _, entry := range entries {
		id := entry.Name()
		if id == ".registry.lock" {
			if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return errors.New("unsafe destination registry lock")
			}
			view.PendingRecovery = true // An active inspection cannot distinguish a held lock from an orphaned one.
			view.CanUpdateSafely = false
			continue
		}
		if len(id) != 64 || !validDigest(id) || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return errors.New("invalid destination registry entry")
		}
		if id == thisID {
			continue
		} // Same-directory Package claims are checked separately.
		ledger := filepath.Join(registry, id)
		if err := directoryNoLinks(ledger); err != nil {
			return err
		}
		packages, err := os.ReadDir(ledger)
		if err != nil {
			return err
		}
		count += len(packages)
		if count > maxRegisteredPackages {
			return errors.New("destination ownership scan exceeds safe limit")
		}
		for _, item := range packages {
			name := item.Name()
			if name == ".destination.lock" {
				if !item.IsDir() || item.Type()&os.ModeSymlink != 0 {
					return errors.New("invalid destination operation lock")
				}
				view.PendingRecovery = true
				view.CanUpdateSafely = false
				continue
			}
			if !validPackageKey(name) || !item.IsDir() || item.Type()&os.ModeSymlink != 0 {
				return errors.New("invalid destination owner")
			}
			ownerFolder := filepath.Join(ledger, name)
			if err := directoryNoLinks(ownerFolder); err != nil {
				return err
			}
			state, err := readRegisteredDestinationState(filepath.Join(ownerFolder, "state.json"), name, id)
			if err != nil {
				return fmt.Errorf("cannot establish foreign destination ownership: %w", err)
			}
			if state.Destination == "" {
				continue
			} // Empty, never-committed owners cannot grant access.
			if sameOrNestedDestination(view.Destination, state.Destination) {
				view.OverlappingRoots++
				if len(view.OverlappingRootExamples) < maxForeignExamples {
					view.OverlappingRootExamples = append(view.OverlappingRootExamples, state.Destination)
				}
			}
		}
	}
	if view.OverlappingRoots != 0 {
		view.CanUpdateSafely = false
	}
	return nil
}

// Read only the public ownership header first; then use the canonical complete
// state validator with the declared root. Never trust a hash-directory name by
// itself to establish a destination owner.
func readRegisteredDestinationState(path, packageKey, directoryDigest string) (destinationState, error) {
	var header struct {
		Destination string `json:"destination"`
	}
	var zero destinationState
	info, err := os.Lstat(path)
	if err != nil {
		return zero, err
	}
	if !info.Mode().IsRegular() || info.Size() > 1024*1024 {
		return zero, errors.New("unsafe registered state file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return zero, err
	}
	if len(data) > 1024*1024 || json.Unmarshal(data, &header) != nil || header.Destination == "" || !filepath.IsAbs(header.Destination) || filepath.Clean(header.Destination) != header.Destination {
		return zero, errors.New("invalid registered destination header")
	}
	digest := sha256.Sum256([]byte(header.Destination))
	if hex.EncodeToString(digest[:]) != directoryDigest {
		return zero, errors.New("destination digest does not match registry directory")
	}
	return readDestinationState(path, packageKey, header.Destination)
}

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The synthetic other-Package state represents a separately installed and
// tracked product; the scanner must not treat an identical hash as consent.
func foreignDestinationLedger(t *testing.T, root, dest, name, rel, digest string) string {
	t.Helper()
	h := sha256.Sum256([]byte(dest))
	folder := filepath.Join(root, "file-updates", hex.EncodeToString(h[:]), name)
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeDestinationState(filepath.Join(folder, "state.json"), destinationState{
		Schema: 1, PackageKey: name, Destination: dest, Files: map[string]string{rel: digest},
	}); err != nil {
		t.Fatal(err)
	}
	return folder
}

func TestNativeDestinationRejectsForeignOwnershipEvenWithExplicitAdopt(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	rel := "presets/studio.ini"
	path := filepath.Join(dest, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("foreign owned"), 0600); err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256([]byte("foreign owned"))
	foreignDestinationLedger(t, first.Root, dest, "other-package", "PRESETS/STUDIO.INI", hex.EncodeToString(h[:]))
	view, err := compareManagedDestination(first, dest)
	if err != nil || view.ForeignOwnershipConflicts != 1 || view.CanUpdateSafely || len(view.ForeignOwnershipExamples) != 1 {
		t.Fatalf("foreign ownership not visible in read-only plan: %+v %v", view, err)
	}
	if _, err := syncFolder(first, dest, false, true); err == nil || !strings.Contains(err.Error(), "owned by another Package") {
		t.Fatalf("explicit adopt stole other Package's file: %v", err)
	}
	if b, _ := os.ReadFile(path); string(b) != "foreign owned" {
		t.Fatalf("foreign data changed: %q", b)
	}
}

func TestNativeDestinationSharedLockAndReadOnlyPreview(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	digest := sha256.Sum256([]byte(dest))
	ledger := filepath.Join(first.Root, "file-updates", hex.EncodeToString(digest[:]))
	lock := filepath.Join(ledger, ".destination.lock")
	if err := os.MkdirAll(lock, 0700); err != nil {
		t.Fatal(err)
	}
	preview, err := compareManagedDestination(first, dest)
	if err != nil || !preview.PendingRecovery || preview.CanUpdateSafely {
		t.Fatalf("shared lock invisible: %+v %v", preview, err)
	}
	if _, err := syncFolder(first, dest, false, false); err == nil || !strings.Contains(err.Error(), "another Package") {
		t.Fatalf("concurrent destination writer accepted: %v", err)
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatalf("unlocked destination failed: %v", err)
	}
	if _, err := os.Lstat(lock); !os.IsNotExist(err) {
		t.Fatal("completed operation retained shared lock")
	}
}

func TestNativeDestinationRejectsInvalidForeignLedger(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	foreign := foreignDestinationLedger(t, first.Root, dest, "another-package", "other/file.txt", strings.Repeat("c", 64))
	if err := os.WriteFile(filepath.Join(foreign, "state.json"), []byte("{bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := compareManagedDestination(first, dest); err == nil {
		t.Fatal("corrupted other-Package ledger was ignored")
	}
	if _, err := syncFolder(first, dest, false, true); err == nil {
		t.Fatal("corrupted other-Package ledger was adopted")
	}
}

func TestRestorePreflightDoesNotPartiallyRollback(t *testing.T) {
	dest := t.TempDir()
	opDir := t.TempDir()
	old := "original"
	updated := "managed"
	edited := "user edit"
	h := func(data string) string { sum := sha256.Sum256([]byte(data)); return hex.EncodeToString(sum[:]) }
	// The reverse-order restoration would touch second.txt before reaching the
	// edited first.txt. The entire preflight must reject without touching either.
	for _, name := range []string{"first.txt", "second.txt"} {
		if err := os.WriteFile(filepath.Join(dest, name), []byte(updated), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dest, "first.txt"), []byte(edited), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(opDir, "backups"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(opDir, "backups", "0000"), []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(opDir, "backups", "0001"), []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	j := destinationJournal{Schema: 1, Changes: []destinationChange{
		{Path: "first.txt", Before: h(old), After: h(updated), Backup: "backups/0000"},
		{Path: "second.txt", Before: h(old), After: h(updated), Backup: "backups/0001"},
	}}
	if err := restoreDestinationJournal(dest, opDir, j); err == nil {
		t.Fatal("local edit did not abort entire rollback")
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "second.txt")); string(b) != updated {
		t.Fatalf("partial rollback occurred: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "first.txt")); string(b) != edited {
		t.Fatalf("local edit lost: %q", b)
	}
	if err := os.WriteFile(filepath.Join(dest, "first.txt"), []byte(updated), 0600); err != nil {
		t.Fatal(err)
	}
	// Corrupt backup discovered after first entry is now a fail-before-writing error.
	if err := os.WriteFile(filepath.Join(opDir, "backups", "0000"), []byte("bad backup"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := restoreDestinationJournal(dest, opDir, j); err == nil {
		t.Fatal("corrupt backup was accepted")
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "second.txt")); string(b) != updated {
		t.Fatal("partial restore on invalid backup")
	}
}

func TestRestorePreflightRejectsCaseFoldedDuplicateTargets(t *testing.T) {
	j := destinationJournal{Schema: 1, Changes: []destinationChange{
		{Path: "Assets/Title.txt", After: strings.Repeat("a", 64)},
		{Path: "assets/title.TXT", After: strings.Repeat("b", 64)},
	}}
	if err := preflightDestinationRestore(t.TempDir(), t.TempDir(), j); err == nil {
		t.Fatal("duplicate Windows rollback paths allowed")
	}
}

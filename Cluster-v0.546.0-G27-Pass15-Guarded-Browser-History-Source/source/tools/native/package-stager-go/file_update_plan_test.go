package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func planPrivatePath(root, dest, key string) string {
	h := sha256.Sum256([]byte(dest))
	return filepath.Join(root, "file-updates", hex.EncodeToString(h[:]), key)
}

func TestDestinationPlanDistinguishesSafeUpgradeFromUntrackedAndModified(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	view, err := compareManagedDestination(first, dest)
	if err != nil || !view.CanUpdateSafely || view.Missing != 1 || view.Entries[0].Action != "add" {
		t.Fatalf("fresh plan: %+v %v", view, err)
	}
	if _, err := os.Stat(filepath.Join(first.Root, "file-updates")); !os.IsNotExist(err) {
		t.Fatal("read-only preview created a tracking directory")
	}
	// Untracked collisions are never classified as a safe update.
	target := filepath.Join(dest, "presets", "studio.ini")
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("other owner's data"), 0600); err != nil {
		t.Fatal(err)
	}
	view, err = compareManagedDestination(first, dest)
	if err != nil || view.UntrackedConflicts != 1 || view.CanUpdateSafely || view.Entries[0].Action != "conflict_untracked" {
		t.Fatalf("untracked collision plan: %+v %v", view, err)
	}
	if _, err := syncFolder(first, dest, false, false); err == nil || !strings.Contains(err.Error(), "untracked collisions") {
		t.Fatalf("unsafe sync not rejected: %v", err)
	}
	if _, err := os.Stat(filepath.Join(planPrivatePath(first.Root, dest, "test-package"), "operations")); err == nil {
		t.Fatal("collision created operation backups")
	}
	if b, _ := os.ReadFile(target); string(b) != "other owner's data" {
		t.Fatal("modified untracked file")
	}
	// Explicitly start with an empty destination, then a tracked old release.
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	activateSecond(t, second)
	view, err = compareManagedDestination(second, dest)
	if err != nil || view.ManagedUpdates != 1 || !view.CanUpdateSafely || view.Entries[0].Action != "update_managed" || view.PreviousArtifactSha256 == "" {
		t.Fatalf("tracked upgrade plan: %+v %v", view, err)
	}
	// Mutating local bytes invalidates the tracked hash. Show it explicitly.
	if err := os.WriteFile(target, []byte("my local changes"), 0600); err != nil {
		t.Fatal(err)
	}
	view, err = compareManagedDestination(second, dest)
	if err != nil || view.ModifiedConflicts != 1 || view.CanUpdateSafely || view.Entries[0].Action != "conflict_modified" {
		t.Fatalf("modified plan: %+v %v", view, err)
	}
	private := planPrivatePath(second.Root, dest, "test-package")
	entriesBefore, err := os.ReadDir(filepath.Join(private, "operations"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = syncFolder(second, dest, false, false); err == nil {
		t.Fatal("modified local file overwritten")
	}
	entriesAfter, err := os.ReadDir(filepath.Join(private, "operations"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entriesBefore) != len(entriesAfter) {
		t.Fatal("blocked update left orphan operation backup")
	}
	if b, _ := os.ReadFile(target); string(b) != "my local changes" {
		t.Fatal("lost local edits")
	}
}

func TestDestinationPlanPendingRecoveryAndUnsafeLedger(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	private := planPrivatePath(first.Root, dest, "test-package")
	pending := filepath.Join(private, "pending.json")
	if err := os.WriteFile(pending, []byte("interrupted"), 0600); err != nil {
		t.Fatal(err)
	}
	view, err := compareManagedDestination(first, dest)
	if err != nil || !view.PendingRecovery || view.CanUpdateSafely {
		t.Fatalf("pending preflight: %+v %v", view, err)
	}
	if err := os.Remove(pending); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(private, "state.json")
	if err := os.Remove(state); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dest, "presets", "studio.ini"), state); err == nil {
		if _, err := compareManagedDestination(first, dest); err == nil {
			t.Fatal("preview followed a linked tracking file")
		}
	}
}

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func verifiedManagedPair(t *testing.T) (options, options, string) {
	t.Helper()
	first, _ := fixtureVersion(t, "presets/studio.ini", []byte("first"), "1.0.0")
	second, _ := fixtureVersion(t, "presets/studio.ini", []byte("second"), "2.0.0")
	second.Root = first.Root
	for _, o := range []options{first, second} {
		if _, err := stage(o); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := deployManagedContent(grantFixture(t, first, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	return first, second, t.TempDir()
}
func activateSecond(t *testing.T, o options) {
	t.Helper()
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
}
func TestDestinationSyncTrackedUpdatesAndRollback(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	path := filepath.Join(dest, "presets", "studio.ini")
	r, err := syncFolder(first, dest, false, false)
	if err != nil || r.Added != 1 || r.Executed || r.State != "destination_updated_files_not_executed" {
		t.Fatalf("adopt: %+v %v", r, err)
	}
	activateSecond(t, second)
	r, err = syncFolder(second, dest, false, false)
	if err != nil || r.Replaced != 1 || r.Executed {
		t.Fatalf("update: %+v %v", r, err)
	}
	if b, _ := os.ReadFile(path); string(b) != "second" {
		t.Fatalf("not updated: %q", b)
	}
	r, err = syncFolder(second, dest, true, false)
	if err != nil || r.State != "destination_rolled_back_files_not_executed" {
		t.Fatalf("rollback: %+v %v", r, err)
	}
	if b, _ := os.ReadFile(path); string(b) != "first" {
		t.Fatalf("not restored: %q", b)
	}
	if _, err := syncFolder(second, dest, true, false); err == nil {
		t.Fatal("rollback reused")
	}
}
func TestDestinationSyncBlocksLocalEditsAndUntrackedConflict(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	path := filepath.Join(dest, "presets", "studio.ini")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("user-owned"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(first, dest, false, false); err == nil {
		t.Fatal("untracked conflict overwritten")
	}
	os.Remove(path)
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("local edit"), 0600); err != nil {
		t.Fatal(err)
	}
	activateSecond(t, second)
	if _, err := syncFolder(second, dest, false, false); err == nil {
		t.Fatal("locally edited managed file overwritten")
	}
	if b, _ := os.ReadFile(path); string(b) != "local edit" {
		t.Fatal("lost local edit")
	}
}
func TestDestinationSyncRecoveryAndRollbackGuard(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	activateSecond(t, second)
	if _, err := syncFolder(second, dest, false, false); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dest, "presets", "studio.ini")
	os.WriteFile(path, []byte("custom"), 0600)
	if _, err := syncFolder(second, dest, true, false); err == nil {
		t.Fatal("rollback erased later local edit")
	}
	if b, _ := os.ReadFile(path); string(b) != "custom" {
		t.Fatal("rollback altered local edit")
	}
}
func TestDestinationSyncNoSymlinkAndNoRootOverlap(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	if err := os.Symlink(t.TempDir(), filepath.Join(dest, "presets")); err != nil {
		t.Skip("symlink unsupported")
	}
	if _, err := syncFolder(first, dest, false, false); err == nil {
		t.Fatal("accepted linked destination")
	}
	if _, err := syncFolder(first, first.Root, false, false); err == nil {
		t.Fatal("accepted own private root")
	}
}
func TestDestinationSyncNoExecutionAndNoUntrackedOverwrite(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	_, err := syncFolder(first, dest, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	list, _ := os.ReadDir(dest)
	if len(list) != 1 || !strings.HasPrefix(list[0].Name(), "presets") {
		t.Fatal("created unexpected destination content")
	}
}

func TestDestinationInterruptedUpdateRecovery(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	activateSecond(t, second)
	if _, err := syncFolder(second, dest, false, false); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(dest))
	private := filepath.Join(first.Root, "file-updates", hex.EncodeToString(digest[:]), "test-package")
	stateFile := filepath.Join(private, "state.json")
	state, err := readDestinationState(stateFile, "test-package", dest)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := readDestinationJournal(filepath.Join(private, "operations", state.LastUpdate, "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := writeDestinationState(stateFile, journal.Before); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomicJSON(filepath.Join(private, "pending.json"), journal); err != nil {
		t.Fatal(err)
	}
	r, err := syncFolder(second, dest, false, false)
	if err != nil || r.Replaced != 1 {
		t.Fatalf("failed to recover and retry: %+v %v", r, err)
	}
	b, _ := os.ReadFile(filepath.Join(dest, "presets", "studio.ini"))
	if string(b) != "second" {
		t.Fatalf("bad recovery contents %q", b)
	}
	if _, err := os.Stat(filepath.Join(private, "pending.json")); !os.IsNotExist(err) {
		t.Fatal("pending journal not cleared")
	}
}

func TestExplicitUntrackedReplacementBacksUpAndCanRestoreOriginal(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	path := filepath.Join(dest, "presets", "studio.ini")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("user's original"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(first, dest, false, false); err == nil {
		t.Fatal("implicit overwrite accepted")
	}
	r, err := syncFolder(first, dest, false, true)
	if err != nil || r.Replaced != 1 || r.Executed {
		t.Fatalf("explicit backup update: %+v %v", r, err)
	}
	if b, _ := os.ReadFile(path); string(b) != "first" {
		t.Fatalf("update failed %q", b)
	}
	r, err = syncFolder(first, dest, true, false)
	if err != nil || r.State != "destination_rolled_back_files_not_executed" {
		t.Fatalf("original not restored: %+v %v", r, err)
	}
	if b, _ := os.ReadFile(path); string(b) != "user's original" {
		t.Fatalf("lost original %q", b)
	}
}

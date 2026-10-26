package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func registeredRootFixture(t *testing.T, root, dest string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(dest))
	ownerDir := filepath.Join(root, "file-updates", hex.EncodeToString(sum[:]), "different-package")
	if err := os.MkdirAll(ownerDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeDestinationState(filepath.Join(ownerDir, "state.json"), destinationState{
		Schema: 1, PackageKey: "different-package", Destination: dest, Files: map[string]string{"existing/studio.dat": strings.Repeat("a", 64)},
	}); err != nil {
		t.Fatal(err)
	}
	return ownerDir
}

func TestOverlappingDestinationBlocksParentAndChild(t *testing.T) {
	o, _, dest := verifiedManagedPair(t)
	nested := filepath.Join(dest, "child")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	registeredRootFixture(t, o.Root, nested)
	view, err := compareManagedDestination(o, dest)
	if err != nil || view.OverlappingRoots != 1 || view.CanUpdateSafely {
		t.Fatalf("overlapping destination not rejected: %+v %v", view, err)
	}
	if _, err := syncFolder(o, dest, false, true); err == nil || !strings.Contains(err.Error(), "overlapping") {
		t.Fatalf("nested destination allowed: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(dest, "presets", "studio.ini")); !os.IsNotExist(err) {
		t.Fatal("filesystem mutated after cross-root guard")
	}
	// A parent root can also claim the path above a selected child.
	if err := os.RemoveAll(filepath.Join(o.Root, "file-updates")); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Dir(dest)
	registeredRootFixture(t, o.Root, parent)
	view, err = compareManagedDestination(o, dest)
	if err != nil || view.OverlappingRoots != 1 || view.CanUpdateSafely {
		t.Fatalf("parent root not rejected: %+v %v", view, err)
	}
}
func TestDisjointDestinationsRemainUsable(t *testing.T) {
	o, _, dest := verifiedManagedPair(t)
	other := t.TempDir()
	registeredRootFixture(t, o.Root, other)
	view, err := compareManagedDestination(o, dest)
	if err != nil || view.OverlappingRoots != 0 || !view.CanUpdateSafely {
		t.Fatalf("disjoint destination failed: %+v %v", view, err)
	}
	if _, err := syncFolder(o, dest, false, false); err != nil {
		t.Fatal(err)
	}
}
func TestGlobalRegistryLockRefusesConcurrentNestedWrites(t *testing.T) {
	o, _, dest := verifiedManagedPair(t)
	registry := filepath.Join(o.Root, "file-updates")
	if err := os.MkdirAll(filepath.Join(registry, ".registry.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	view, err := compareManagedDestination(o, dest)
	if err != nil || !view.PendingRecovery || view.CanUpdateSafely {
		t.Fatalf("orphaned registry lock ignored: %+v %v", view, err)
	}
	if _, err := syncFolder(o, dest, false, false); err == nil || !strings.Contains(err.Error(), "registry") {
		t.Fatalf("registry lock not enforced: %v", err)
	}
	if err := os.Remove(filepath.Join(registry, ".registry.lock")); err != nil {
		t.Fatal(err)
	}
	if _, err := syncFolder(o, dest, false, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(registry, ".registry.lock")); !os.IsNotExist(err) {
		t.Fatal("completed operation left a registry lock")
	}
}
func TestRegistryRefusesCorruptForeignOwnershipEvidence(t *testing.T) {
	o, _, dest := verifiedManagedPair(t)
	foreign := registeredRootFixture(t, o.Root, filepath.Join(dest, "child"))
	if err := os.WriteFile(filepath.Join(foreign, "state.json"), []byte(`{"schema":1,"destination":"/misrepresented"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := compareManagedDestination(o, dest); err == nil {
		t.Fatal("malformed cross-root owner accepted")
	}
	if _, err := syncFolder(o, dest, false, true); err == nil {
		t.Fatal("malformed cross-root owner mutated destination")
	}
}
func TestRegistryWindowsCaseFoldAndSiblingBoundaries(t *testing.T) {
	base := filepath.Join(t.TempDir(), "Studio")
	if !sameOrNestedDestination(filepath.Join(base, "FOO"), filepath.Join(base, "foo", "sub")) {
		t.Fatal("case-folded nesting bypassed")
	}
	if sameOrNestedDestination(filepath.Join(base, "foo"), filepath.Join(base, "foobar")) {
		t.Fatal("sibling root falsely overlapped")
	}
}

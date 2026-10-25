package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestDestinationAuditMissingHealthyModifiedAndRollback(t *testing.T) {
	first, second, dest := verifiedManagedPair(t)
	path := filepath.Join(dest, "presets", "studio.ini")
	a, err := auditDestinationFiles(first, dest)
	if err != nil || a.Healthy || a.Tracked != 0 || a.UntrackedMissing != 1 || !a.ReadOnly || a.Executed {
		t.Fatalf("empty: %+v %v", a, err)
	}
	if _, err = os.Stat(filepath.Join(first.Root, "file-updates")); !os.IsNotExist(err) {
		t.Fatalf("audit wrote state: %v", err)
	}
	if _, err = syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	a, err = auditDestinationFiles(first, dest)
	if err != nil || !a.Healthy || a.Tracked != 1 || a.Verified != 1 || a.Missing != 0 || a.Modified != 0 {
		t.Fatalf("healthy: %+v %v", a, err)
	}
	if err = os.WriteFile(path, []byte("different"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err = auditDestinationFiles(first, dest)
	if err != nil || a.Healthy || a.Modified != 1 || len(a.Issues) != 1 || a.Issues[0].State != "tracked_modified" {
		t.Fatalf("modified: %+v %v", a, err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	a, err = auditDestinationFiles(first, dest)
	if err != nil || a.Missing != 1 || a.Healthy || a.Issues[0].State != "tracked_missing" {
		t.Fatalf("missing: %+v %v", a, err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	activateSecond(t, second)
	a, err = auditDestinationFiles(second, dest)
	if err != nil || a.Healthy || a.Verified != 1 || a.TrackedArtifactSha256 == "" || a.TrackedArtifactSha256 == a.ArtifactSha256 {
		t.Fatalf("old release: %+v %v", a, err)
	}
	if _, err = syncFolder(second, dest, false, false); err != nil {
		t.Fatal(err)
	}
	a, err = auditDestinationFiles(second, dest)
	if err != nil || !a.Healthy || a.Verified != 1 || a.TrackedArtifactSha256 != a.ArtifactSha256 {
		t.Fatalf("new release: %+v %v", a, err)
	}
}

func TestDestinationAuditUntrackedAndRetiredFiles(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	path := filepath.Join(dest, "presets", "studio.ini")
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, []byte("someone else's file"), 0600)
	a, err := auditDestinationFiles(first, dest)
	if err != nil || a.UntrackedCollision != 1 || a.Issues[0].State != "untracked_collision" || a.Tracked != 0 {
		t.Fatalf("collision: %+v %v", a, err)
	}
	os.Remove(path)
	if _, err = syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	root, _ := filepath.Abs(first.Root)
	destAbs, _ := filepath.Abs(dest)
	key := sha256.Sum256([]byte(destAbs))
	// Resolve the persisted authoritative Package key from the signed release.
	p, err := compareManagedDestination(first, dest)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(root, "file-updates", hex.EncodeToString(key[:]), p.PackageKey, "state.json")
	state, err := readDestinationState(statePath, p.PackageKey, destAbs)
	if err != nil {
		t.Fatal(err)
	}
	obsolete := filepath.Join(dest, "retired.txt")
	if err = os.WriteFile(obsolete, []byte("retained"), 0600); err != nil {
		t.Fatal(err)
	}
	oldHash := sha256.Sum256([]byte("retained"))
	state.Files["retired.txt"] = hex.EncodeToString(oldHash[:])
	if err = writeDestinationState(statePath, state); err != nil {
		t.Fatal(err)
	}
	a, err = auditDestinationFiles(first, dest)
	if err != nil || !a.Healthy || a.Retired != 1 || a.RetiredVerified != 1 || a.Verified != 1 {
		t.Fatalf("retired: %+v %v", a, err)
	}
	os.WriteFile(obsolete, []byte("local edit"), 0600)
	a, err = auditDestinationFiles(first, dest)
	if err != nil || a.RetiredModified != 1 || len(a.Issues) != 1 || a.Issues[0].State != "retired_modified" {
		t.Fatalf("retired edited: %+v %v", a, err)
	}
	if _, err = os.Stat(obsolete); err != nil {
		t.Fatalf("audit deleted retained file: %v", err)
	}
}

func TestDestinationAuditRejectsUnsafeFilesystemAndTracking(t *testing.T) {
	first, _, dest := verifiedManagedPair(t)
	if _, err := syncFolder(first, dest, false, false); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dest, "presets", "studio.ini")
	os.Remove(target)
	if err := os.Symlink(filepath.Join(t.TempDir(), "target"), target); err == nil {
		if _, err = auditDestinationFiles(first, dest); err == nil {
			t.Fatal("followed symlink in audited destination")
		}
		os.Remove(target)
	} else {
		t.Log("symlink unsupported")
	}
	os.WriteFile(target, []byte("first"), 0600)
	root, _ := filepath.Abs(first.Root)
	abs, _ := filepath.Abs(dest)
	key := sha256.Sum256([]byte(abs))
	p, err := compareManagedDestination(first, dest)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(root, "file-updates", hex.EncodeToString(key[:]), p.PackageKey, "state.json")
	os.Remove(statePath)
	os.Symlink(filepath.Join(t.TempDir(), "missing"), statePath)
	if _, err = auditDestinationFiles(first, dest); err == nil {
		t.Fatal("accepted symlinked ownership ledger")
	}
}

func TestDestinationAuditCLIReportsSignedReadOnlyEvidence(t *testing.T) {
	o, _ := fixture(t, "presets/editor.ini", []byte("settings"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	if _, err := syncFolder(o, dest, false, false); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(t.TempDir(), "cluster-package-stager")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", executable, ".")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("native helper build: %s %v", output, err)
	}
	args := []string{"--action", "audit-files", "--archive", o.Archive,
		"--manifest", o.Manifest, "--signature", o.Signature, "--public-key", o.PublicKey,
		"--trusted-key-sha256", o.TrustedKeySha256, "--root", o.Root,
		"--expected-package-key", "test-package", "--expected-version", "1.2.3",
		"--destination", dest}
	output, err := exec.Command(executable, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("audit CLI failure: %s %v", output, err)
	}
	marker := []byte("CLUSTER_FILE_AUDIT_RESULT ")
	pos := bytes.Index(output, marker)
	if pos < 0 {
		t.Fatalf("no audit protocol frame: %s", output)
	}
	var result destinationAudit
	if err := json.Unmarshal(bytes.TrimSpace(output[pos+len(marker):]), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Healthy || result.Verified != 1 || result.Executed || !result.ReadOnly {
		t.Fatalf("invalid native audit frame: %+v", result)
	}
	invalid := append([]string(nil), args...)
	invalid = append(invalid, "--expected-artifact-sha256", strings.Repeat("f", 64))
	output, err = exec.Command(executable, invalid...).CombinedOutput()
	if err == nil || bytes.Contains(output, marker) {
		t.Fatalf("mismatched signed target accepted: %s", output)
	}
}

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This simulates a writer that changes a receipt in place, without changing
// file identity or size, and restores its original modification timestamp.
func rewriteMSIReceiptWithoutMetadataChange(t *testing.T, path, before, after string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	modified := bytes.Replace(raw, []byte(before), []byte(after), 1)
	if bytes.Equal(modified, raw) || len(modified) != len(raw) {
		t.Fatal("invalid fixed-size receipt rewrite fixture")
	}
	if err = os.WriteFile(path, modified, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	now, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(info, now) || info.Size() != now.Size() || !info.ModTime().Equal(now.ModTime()) {
		t.Skip("filesystem cannot preserve receipt identity/size/mtime for deterministic rewrite")
	}
}

func TestMSIProfileRefusesAttemptByteRewriteDespiteUnchangedMetadata(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	receipt := msiAttempt{Schema: 1, PackageKey: "studio-editor", Version: "1.0.0", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0", State: "msi_prepared_not_launched", StartedAt: "2026-10-24T15:00:00Z"}
	path := filepath.Join(dir, "studio-editor.json")
	if err := writeMSIAttemptReceipt(path, receipt); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectMSIProfile(root); err != nil {
		t.Fatalf("valid baseline rejected: %v", err)
	}
	_, err := inspectMSIProfileWithCheckpoint(root, func() {
		rewriteMSIReceiptWithoutMetadataChange(t, path, "2026-10-24T15:00:00Z", "2026-10-24T15:00:01Z")
	})
	if err == nil || !strings.Contains(err.Error(), "receipt bytes changed") {
		t.Fatalf("same-metadata tamper accepted: %v", err)
	}
}

func TestMSIProfileRefusesLifecycleJournalByteRewriteDespiteUnchangedMetadata(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-lifecycle")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	journal := msiRepairReceipt{Schema: 1, Operation: "uninstall", PackageKey: "studio-editor", Version: "1.0.0",
		ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64),
		ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0",
		PriorReceiptSha256: strings.Repeat("c", 64), State: "uninstall_prepared_not_launched", StartedAt: "2026-10-24T15:00:00Z"}
	path := filepath.Join(dir, "studio-editor.json")
	if err := writeFirstMSIRepairReceipt(path, journal); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectMSIProfile(root); err != nil {
		t.Fatalf("valid lifecycle baseline rejected: %v", err)
	}
	_, err := inspectMSIProfileWithCheckpoint(root, func() {
		rewriteMSIReceiptWithoutMetadataChange(t, path, "2026-10-24T15:00:00Z", "2026-10-24T15:00:01Z")
	})
	if err == nil || !strings.Contains(err.Error(), "receipt bytes changed") {
		t.Fatalf("same-metadata lifecycle journal tamper accepted: %v", err)
	}
}

func TestMSIProfileReceiptHashSeparatesNamespacesAndRejectsSourceDrift(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"msi-attempts", "msi-lifecycle"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	// Both directories can contain PackageKey.json. Domain separation prevents
	// duplicate basenames from collapsing into a single hash entry.
	raw := []byte(`{"schema":1,"receipt":"fixed"}`)
	for _, dir := range []string{"msi-attempts", "msi-lifecycle"} {
		if err := os.WriteFile(filepath.Join(root, dir, "studio-editor.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	snap, err := collectMSIProfileSnapshot(root)
	if err != nil {
		t.Fatal(err)
	}
	hashes, err := hashMSIProfileReceiptSnapshot(root, snap)
	if err != nil || len(hashes) != 2 {
		t.Fatalf("namespaces conflated: %+v %v", hashes, err)
	}
	if hashes["attempt:studio-editor.json"] != hashes["lifecycle:studio-editor.json"] {
		t.Fatal("identical bytes must hash identically")
	}
	if !sameMSIProfileReceiptDigests(hashes, hashes) {
		t.Fatal("stable digest map rejected")
	}
	changed := make(map[string][32]byte, len(hashes))
	for key, value := range hashes {
		changed[key] = value
	}
	change := changed["lifecycle:studio-editor.json"]
	change[0] ^= 0xff
	changed["lifecycle:studio-editor.json"] = change
	if sameMSIProfileReceiptDigests(hashes, changed) {
		t.Fatal("changed lifecycle bytes ignored")
	}
	delete(changed, "attempt:studio-editor.json")
	if sameMSIProfileReceiptDigests(hashes, changed) {
		t.Fatal("missing source receipt ignored")
	}
	// Ensure ordinary, unchanged retained bytes are still readable.
	time.Sleep(1 * time.Millisecond)
	stable, err := hashMSIProfileReceiptSnapshot(root, snap)
	if err != nil || !sameMSIProfileReceiptDigests(hashes, stable) {
		t.Fatalf("stable source rejected: %v", err)
	}
}

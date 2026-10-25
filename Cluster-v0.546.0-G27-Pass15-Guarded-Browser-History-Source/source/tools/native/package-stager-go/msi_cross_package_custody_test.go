package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIFreshRegistrationGateRejectsInstalledOrAmbiguousIdentity(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	version := "1.2.3"
	testCases := []struct {
		name       string
		state      string
		errorValue bool
		allow      bool
	}{
		{"fresh", "not_registered_for_user", false, true},
		{"registered same version", "registered_version_match", false, false},
		{"registered other version", "registered_version_mismatch", false, false},
		{"version not readable", "registered_version_unavailable", false, false},
		{"advertised", "advertised_not_verified", false, false},
		{"unavailable", "os_query_unavailable", false, false},
		{"incomplete", "registration_incomplete_or_unknown", false, false},
		{"unexpected failure", "not_registered_for_user", true, false},
	}
	for _, tt := range testCases {
		t.Run(tt.name, func(t *testing.T) {
			record := msiProductState{State: tt.state, ProductCode: code, ExpectedVersion: version, ReadOnly: true, ProbeScope: "current_user_and_machine", ProbeComplete: true}
			var err error
			if tt.errorValue {
				err = os.ErrPermission
			}
			accepted := requireFreshMSIProductRegistration(record, err, code, version) == nil
			if accepted != tt.allow {
				t.Fatalf("gate accepted=%v want %v", accepted, tt.allow)
			}
		})
	}
	good := msiProductState{State: "not_registered_for_user", ProductCode: code, ExpectedVersion: version, ReadOnly: true, ProbeScope: "current_user_and_machine", ProbeComplete: true}
	variants := []msiProductState{good, good, good, good, good}
	variants[0].ProductCode = "{AAAABBBB-1234-ABCD-ABCD-1234567890AB}"
	variants[1].ExpectedVersion = "1.2.4"
	variants[2].ReadOnly = false
	variants[3].OSAttested = true
	variants[4].ReportedVersion = version
	for index, entry := range variants {
		if requireFreshMSIProductRegistration(entry, nil, code, version) == nil {
			t.Fatalf("invalid identity variation %d authorized", index)
		}
	}
}

func TestMSICrossPackageReceiptAndLockFence(t *testing.T) {
	root := t.TempDir()
	attempts := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(attempts, 0700); err != nil {
		t.Fatal(err)
	}
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	foreign := "another-package"
	path := filepath.Join(attempts, foreign+".json")
	rec := msiAttempt{Schema: 1, PackageKey: foreign, Version: "1.2.3", ArtifactSha256: strings.Repeat("a", 64),
		MSISha256: strings.Repeat("b", 64), ProductCode: "{AAAABBBB-1234-ABCD-ABCD-1234567890AB}",
		ProductVersion: "1.2.3", State: "msi_prepared_not_launched", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	write := func() {
		t.Helper()
		payload, err := json.Marshal(rec)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err != nil {
		t.Fatalf("empty custody should permit fresh identity: %v", err)
	}
	write()
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err != nil {
		t.Fatalf("unrelated completed package record must not block: %v", err)
	}
	rec.ProductCode = code
	write()
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
		t.Fatal("foreign MSI ProductCode collision was allowed")
	}
	rec.ProductCode = "{AAAABBBB-1234-ABCD-ABCD-1234567890AB}"
	write()
	lock := filepath.Join(attempts, "other-running.lock")
	if err := os.Mkdir(lock, 0700); err != nil {
		t.Fatal(err)
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
		t.Fatal("foreign installer lock was ignored")
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("not-json"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
		t.Fatal("corrupted foreign receipt was ignored")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "other"), path); err == nil {
		if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
			t.Fatal("foreign receipt symlink was ignored")
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(attempts, "own-package.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err != nil {
		t.Fatalf("own correctly held operation lock should not be classified foreign: %v", err)
	}
}

func TestMSICrossPackageCustodyFailsOnIncompleteDirectoryScan(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= maxMSICustodyEntries; i++ {
		path := filepath.Join(dir, strings.Repeat("x", 3)+"-"+string(rune(0x1000+i)))
		if err := os.WriteFile(path, nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", "{12345678-1234-ABCD-ABCD-1234567890AB}"); err == nil {
		t.Fatal("incomplete custody enumeration permitted execution")
	}
}

func TestMSIForeignCustodyBlocksUnrecognizedAndMalformedEntries(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "msi-attempts")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	for _, name := range []string{"unexpected.tmp", ".pending", "own-package.json.tmp", "../bad"} {
		if strings.Contains(name, "..") && !strings.HasSuffix(name, ".tmp") {
			continue
		}
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("untrusted"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
			t.Fatalf("unknown custody entry %q was ignored", name)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "own-package.lock"), []byte("not-a-directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := requireNoForeignMSIAttemptForProduct(root, "own-package", code); err == nil {
		t.Fatal("tampered own lock was ignored")
	}
}

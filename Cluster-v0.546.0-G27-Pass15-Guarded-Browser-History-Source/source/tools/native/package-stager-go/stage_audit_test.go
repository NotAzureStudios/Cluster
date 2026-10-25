package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadOnlyStageAuditValidAndUnaffected(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("good"))
	stageDir, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(stageDir, "payload", "file.txt"))
	if err != nil {
		t.Fatal(err)
	}
	audit, err := auditStagedContent(a)
	if err != nil {
		t.Fatal(err)
	}
	if audit.State != "verified_staged_not_installed" || audit.OSAttested || audit.ArchiveSha256 == "" || audit.SigningKeySha256 != a.TrustedKeySha256 {
		t.Fatalf("wrong audit evidence: %+v", audit)
	}
	after, err := os.ReadFile(filepath.Join(stageDir, "payload", "file.txt"))
	if err != nil || string(before) != string(after) {
		t.Fatal("audit modified staged content")
	}
	if _, err := os.Stat(filepath.Join(a.Root, "active", "test-package.json")); !os.IsNotExist(err) {
		t.Fatal("audit created active pointer")
	}
}

func TestReadOnlyStageAuditDoesNotTrustAValidButUnstagedSignature(t *testing.T) {
	a, _ := fixture(t, "file.txt", []byte("valid signature without staged bytes"))
	if _, err := auditStagedContent(a); err == nil {
		t.Fatal("unstaged signed release was considered staged")
	}
}

func TestStageAuditRefusesTamperingAndExtraFiles(t *testing.T) {
	a, _ := fixture(t, "data/file.txt", []byte("good"))
	stageDir, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "data", "file.txt"), []byte("evil"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := auditStagedContent(a); err == nil {
		t.Fatal("modified staged bytes verified")
	}
	if err := os.WriteFile(filepath.Join(stageDir, "data", "file.txt"), []byte("good"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "surprise.dll"), []byte("malicious"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := auditStagedContent(a); err == nil {
		t.Fatal("unexpected staged file verified")
	}
}

func TestStageAuditSelectedIdentityAndPinEnforced(t *testing.T) {
	a, _ := fixture(t, "data/file.txt", []byte("ok"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct {
		name string
		edit func(*options)
	}{
		{"digest", func(a *options) { a.ExpectedArtifactSha256 = strings.Repeat("a", 64) }},
		{"key", func(a *options) { a.ExpectedPackageKey = "not-this-package" }},
		{"version", func(a *options) { a.ExpectedVersion = "2.0.0" }},
		{"pin", func(a *options) { a.TrustedKeySha256 = strings.Repeat("f", 64) }},
	} {
		t.Run(change.name, func(t *testing.T) {
			attempt := a
			change.edit(&attempt)
			if _, err := auditStagedContent(attempt); err == nil {
				t.Fatal("mismatched identity accepted")
			}
		})
	}
}

func TestStageAuditDoesNotChangeActivePointer(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("good"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	current, err := selectContent(a, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auditStagedContent(a); err != nil {
		t.Fatal(err)
	}
	after, err := selectionStatus(a.Root, "test-package")
	if err != nil || after != current {
		t.Fatal("stage audit changed active selection")
	}
}

// Exercise the same fixed five-member kit that Qt passes to --verify-stage.
func TestStageAuditImportsSignedKitWithoutExtractingSidecars(t *testing.T) {
	a, _ := fixture(t, "settings/preset.json", []byte(`{"quality":"high"}`))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	kitPath := filepath.Join(t.TempDir(), "handoff.zip")
	if err := writeAuditFixtureKit(kitPath, a); err != nil {
		t.Fatal(err)
	}
	kit := options{Kit: kitPath, Root: a.Root, TrustedKeySha256: a.TrustedKeySha256,
		ExpectedPackageKey: "test-package", ExpectedVersion: "1.2.3"}
	result, err := auditStagedContent(kit)
	if err != nil || result.State != "verified_staged_not_installed" || result.OSAttested {
		t.Fatalf("read-only kit audit failed: %v, %+v", err, result)
	}
	kit.ExpectedVersion = "9.9.9"
	if _, err := auditStagedContent(kit); err == nil {
		t.Fatal("wrong target kit accepted")
	}
}

func writeAuditFixtureKit(path string, a options) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	w := zip.NewWriter(file)
	sources := map[string]string{"release.zip": a.Archive, "manifest.json": a.Manifest,
		"signature.txt": a.Signature, "public-key.pem": a.PublicKey}
	for _, name := range []string{"release.zip", "manifest.json", "signature.txt", "public-key.pem", "README.txt"} {
		body := []byte("Read-only kit audit")
		if original, ok := sources[name]; ok {
			body, err = os.ReadFile(original)
			if err != nil {
				w.Close()
				return err
			}
		}
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		header.SetMode(0600)
		entry, err := w.CreateHeader(header)
		if err != nil {
			w.Close()
			return err
		}
		if _, err := entry.Write(body); err != nil {
			w.Close()
			return err
		}
	}
	return w.Close()
}

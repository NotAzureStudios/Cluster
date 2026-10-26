package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T, entry string, payload []byte) (options, []byte) {
	return fixtureVersion(t, entry, payload, "1.2.3")
}
func fixtureVersion(t *testing.T, entry string, payload []byte, version string) (options, []byte) {
	t.Helper()
	folder := t.TempDir()
	var zipped bytes.Buffer
	w := zip.NewWriter(&zipped)
	f, err := w.Create(entry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(zipped.Bytes())
	keyhash := sha256.Sum256(der)
	m := manifest{Schema: 1, PackageKey: "test-package", Version: version, Platform: hostPlatform(), ArtifactSha256: hex.EncodeToString(digest[:]), ArtifactSize: zipped.Len(), Filename: "signed.zip"}
	content, _ := json.Marshal(m)
	sig := ed25519.Sign(private, append([]byte(signingContext), content...))
	a := options{Archive: filepath.Join(folder, "artifact.zip"), Manifest: filepath.Join(folder, "manifest.json"), Signature: filepath.Join(folder, "sig.txt"), PublicKey: filepath.Join(folder, "pub.pem"), TrustedKeySha256: hex.EncodeToString(keyhash[:]), Root: filepath.Join(folder, "stage-root")}
	for path, data := range map[string][]byte{a.Archive: zipped.Bytes(), a.Manifest: content, a.Signature: []byte(base64.StdEncoding.EncodeToString(sig)), a.PublicKey: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return a, zipped.Bytes()
}
func TestVerifiedStageAndNoExecution(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("valid content"))
	path, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(path, "payload/info.txt"))
	if err != nil || string(data) != "valid content" {
		t.Fatalf("missing staged file: %v", err)
	}
	meta, err := os.ReadFile(filepath.Join(path, ".cluster-package-stage.json"))
	if err != nil || !strings.Contains(string(meta), "verified_staged_not_installed") {
		t.Fatalf("stage metadata missing: %v", err)
	}
	if _, err := stage(a); err == nil {
		t.Fatal("repeated stage unexpectedly overwrote files")
	}
}

func TestSelectedTargetMustMatchSignedReleaseBeforeStaging(t *testing.T) {
	for _, mismatch := range []struct{ name, digest, key, version string }{
		{"digest", strings.Repeat("a", 64), "", ""},
		{"key", "", "other-package", ""},
		{"version", "", "", "2.0.0"},
	} {
		t.Run(mismatch.name, func(t *testing.T) {
			a, raw := fixture(t, "payload/info.txt", []byte("valid content"))
			sha := sha256.Sum256(raw)
			a.ExpectedArtifactSha256 = hex.EncodeToString(sha[:])
			a.ExpectedPackageKey = "test-package"
			a.ExpectedVersion = "1.2.3"
			if mismatch.digest != "" { a.ExpectedArtifactSha256 = mismatch.digest }
			if mismatch.key != "" { a.ExpectedPackageKey = mismatch.key }
			if mismatch.version != "" { a.ExpectedVersion = mismatch.version }
			if _, err := stage(a); err == nil { t.Fatal("wrong selected target was accepted") }
			if _, err := os.Stat(a.Root); !os.IsNotExist(err) { t.Fatal("mismatched target wrote to disk") }
		})
	}
	a, raw := fixture(t, "payload/info.txt", []byte("valid content"))
	sha := sha256.Sum256(raw)
	a.ExpectedArtifactSha256 = hex.EncodeToString(sha[:])
	a.ExpectedPackageKey = "test-package"
	a.ExpectedVersion = "1.2.3"
	if _, err := stage(a); err != nil { t.Fatalf("correct target refused: %v", err) }
}
func TestSigningKeyMismatch(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("ok"))
	a.TrustedKeySha256 = strings.Repeat("f", 64)
	if _, err := stage(a); err == nil {
		t.Fatal("mismatched trust pin accepted")
	}
}
func TestArtifactCorruption(t *testing.T) {
	a, b := fixture(t, "payload/info.txt", []byte("ok"))
	b[len(b)-2] ^= 1
	if err := os.WriteFile(a.Archive, b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(a); err == nil {
		t.Fatal("modified artifact accepted")
	}
}
func TestInvalidSignature(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("ok"))
	if err := os.WriteFile(a.Signature, []byte(base64.StdEncoding.EncodeToString(make([]byte, 64))), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(a); err == nil {
		t.Fatal("forged signature accepted")
	}
}
func TestTraversalRejected(t *testing.T) {
	a, _ := fixture(t, "../outside.txt", []byte("oops"))
	if _, err := stage(a); err == nil {
		t.Fatal("traversal accepted")
	}
	if _, err := os.Stat(filepath.Join(a.Root, "outside.txt")); !os.IsNotExist(err) {
		t.Fatal("traversal wrote outside root")
	}
}
func TestAbsoluteNameRejected(t *testing.T) {
	a, _ := fixture(t, "/absolute.txt", []byte("oops"))
	if _, err := stage(a); err == nil {
		t.Fatal("absolute name accepted")
	}
}
func TestWindowsReservedNamesRejected(t *testing.T) {
	a, _ := fixture(t, "data/CON.txt", []byte("oops"))
	if _, err := stage(a); err == nil {
		t.Fatal("reserved name accepted")
	}
}
func TestDisallowedPlatform(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("ok"))
	data, err := os.ReadFile(a.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	m.Platform = "unsupported"
	other, _ := json.Marshal(m)
	if err := os.WriteFile(a.Manifest, other, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(a); err == nil {
		t.Fatal("different platform accepted")
	}
}
func TestSymlinkRootRejected(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("ok"))
	link := filepath.Join(t.TempDir(), "symlink")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Skip("symlink unsupported")
	}
	a.Root = link
	if _, err := stage(a); err == nil {
		t.Fatal("symlink root accepted")
	}
}
func TestUnsupportedPathRejected(t *testing.T) {
	for _, name := range []string{"dir\\file", "file:stream", "path//file", "trailing. ", "LPT1.log"} {
		if err := secureName(name); err == nil {
			t.Errorf("allowed unsafe %q", name)
		}
	}
}

func TestReservedStageMetadataRejected(t *testing.T) {
	a, _ := fixture(t, ".cluster-package-stage.json", []byte("claimed"))
	if _, err := stage(a); err == nil {
		t.Fatal("user-controlled stage evidence accepted")
	}
}
func TestSymlinkParentRejected(t *testing.T) {
	a, _ := fixture(t, "payload/info.txt", []byte("ok"))
	dir := t.TempDir()
	link := filepath.Join(dir, "link")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Skip("symlink unsupported")
	}
	a.Root = filepath.Join(link, "stage")
	if _, err := stage(a); err == nil {
		t.Fatal("staging through symlinked parent accepted")
	}
}

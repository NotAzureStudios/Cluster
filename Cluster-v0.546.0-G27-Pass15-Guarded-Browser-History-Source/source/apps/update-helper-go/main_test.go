package main

import (
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
	"testing"
)

func TestCanonicalJSONSortsObjectKeys(t *testing.T) {
	value := map[string]any{"z": json.Number("2"), "a": []any{true, "x"}}
	actual, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	if actual != `{"a":[true,"x"],"z":2}` {
		t.Fatalf("unexpected canonical JSON: %s", actual)
	}
}

func writeSigningFixture(t *testing.T, directory string) (string, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicBytes, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(directory, "public.pem")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicBytes}), 0o600); err != nil {
		t.Fatal(err)
	}
	return keyPath, privateKey
}

func validManifest() map[string]any {
	return map[string]any{
		"schemaVersion": json.Number("1"),
		"product":       "cluster-desktop",
		"channel":       "stable",
		"version":       "9.9.9",
		"publishedAt":   "2026-08-11T21:00:00Z",
		"artifacts": []any{
			map[string]any{
				"platform": "windows",
				"arch":     "x64",
				"kind":     "installer",
				"version":  "9.9.9",
				"filename": "Cluster-Desktop-9.9.9.exe",
				"url":      "Cluster-Desktop-9.9.9.exe",
				"sha256":   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				"size":     json.Number("1024"),
			},
		},
	}
}

func signManifest(t *testing.T, manifest map[string]any, privateKey ed25519.PrivateKey) []byte {
	t.Helper()
	canonical, err := canonicalJSON(manifest)
	if err != nil {
		t.Fatal(err)
	}
	copy := make(map[string]any, len(manifest)+1)
	for key, value := range manifest {
		copy[key] = value
	}
	copy["signature"] = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte(canonical)))
	data, err := json.Marshal(copy)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestVerifyManifestAndArtifact(t *testing.T) {
	directory := t.TempDir()
	keyPath, privateKey := writeSigningFixture(t, directory)
	manifestPath := filepath.Join(directory, "manifest.json")
	if err := os.WriteFile(manifestPath, signManifest(t, validManifest(), privateKey), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyManifest(manifestPath, keyPath); err != nil {
		t.Fatalf("manifest should verify: %v", err)
	}

	artifact := []byte("cluster update helper test")
	artifactPath := filepath.Join(directory, "artifact.bin")
	if err := os.WriteFile(artifactPath, artifact, 0o600); err != nil {
		t.Fatal(err)
	}
	checksum := sha256.Sum256(artifact)
	if err := verifyArtifact(artifactPath, hex.EncodeToString(checksum[:])); err != nil {
		t.Fatalf("artifact should verify: %v", err)
	}
	if err := verifyArtifact(artifactPath, string(make([]byte, 64))); err == nil {
		t.Fatal("incorrect checksum should fail")
	}
}

func TestVerifyManifestRejectsSignedInvalidSchema(t *testing.T) {
	directory := t.TempDir()
	keyPath, privateKey := writeSigningFixture(t, directory)
	manifest := validManifest()
	manifest["product"] = "something-else"
	manifestPath := filepath.Join(directory, "manifest.json")
	if err := os.WriteFile(manifestPath, signManifest(t, manifest, privateKey), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyManifest(manifestPath, keyPath); err == nil {
		t.Fatal("signed manifest with wrong product should fail schema validation")
	}
}

func TestValidateManifestRejectsUnsafeArtifactMetadata(t *testing.T) {
	manifest := validManifest()
	artifact := manifest["artifacts"].([]any)[0].(map[string]any)
	artifact["filename"] = `..\\evil.exe`
	if err := validateManifest(manifest); err == nil {
		t.Fatal("unsafe artifact filename should be rejected")
	}

	manifest = validManifest()
	artifact = manifest["artifacts"].([]any)[0].(map[string]any)
	artifact["size"] = json.Number("2147483649")
	if err := validateManifest(manifest); err == nil {
		t.Fatal("oversized artifact should be rejected")
	}
}

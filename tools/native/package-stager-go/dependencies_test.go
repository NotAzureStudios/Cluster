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
	"time"
)

// Sign a distinct release identity with a real Ed25519 key, preserving the
// existing sample ZIP. An unsigned dependency edit must not be accepted.
func signedDependencyFixture(t *testing.T, pkg string, deps []packageDependency) options {
	t.Helper()
	o, _ := fixture(t, "presets/authoring.txt", []byte(pkg))
	raw, err := os.ReadFile(o.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	m.PackageKey = pkg
	m.Dependencies = deps
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	fp := sha256.Sum256(der)
	o.TrustedKeySha256 = hex.EncodeToString(fp[:])
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(priv, append([]byte(signingContext), b...))
	for path, data := range map[string][]byte{
		o.Manifest: b, o.Signature: []byte(base64.StdEncoding.EncodeToString(signature)),
		o.PublicKey: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}),
	} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return o
}
func TestSignedDependencyValidation(t *testing.T) {
	cases := []struct {
		name  string
		deps  []packageDependency
		valid bool
	}{
		{"valid", []packageDependency{{"foundation-pkg", "1.0.0", "content-selected"}}, true},
		{"self", []packageDependency{{"test-package", "1.0.0", "content-selected"}}, false},
		{"duplicate", []packageDependency{{"foundation-pkg", "1.0.0", "content-selected"}, {"foundation-pkg", "2.0.0", "content-selected"}}, false},
		{"unsafe", []packageDependency{{"../escape", "1.0.0", "content-selected"}}, false},
		{"invalid-version", []packageDependency{{"foundation-pkg", "latest", "content-selected"}}, false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			m := manifest{Schema: 1, PackageKey: "test-package", Dependencies: tt.deps}
			err := validateManifestDependencies(m)
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v error=%v", tt.valid, err)
			}
		})
	}
}
func TestSignedManagedDeploymentRequiresLocalDependencies(t *testing.T) {
	now := time.Now()
	base := signedDependencyFixture(t, "foundation-pkg", nil)
	app := signedDependencyFixture(t, "editor-tools", []packageDependency{{"foundation-pkg", "1.2.3", "content-selected"}})
	app.Root = base.Root
	for _, o := range []options{base, app} {
		if _, err := stage(o); err != nil {
			t.Fatal(err)
		}
	}
	grant := grantFixture(t, app, "deploy", now)
	if _, err := deployManagedContent(grant, "deploy", now); err == nil {
		t.Fatal("dependency missing, deployment accepted")
	}
	if _, err := os.Stat(filepath.Join(base.Root, "grant-consumed")); !os.IsNotExist(err) {
		t.Fatal("missing dependency consumed a grant")
	}
	if _, err := deployManagedContent(grantFixture(t, base, "deploy", now), "deploy", now); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grant, "deploy", now); err != nil {
		t.Fatalf("matching dependency refused: %v", err)
	}
	pointer := filepath.Join(base.Root, "managed-active", "foundation-pkg.json")
	data, err := os.ReadFile(pointer)
	if err != nil {
		t.Fatal(err)
	}
	var state managedPointer
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	state.Active.Version = "9.9.9"
	changed, _ := json.Marshal(state)
	if err := os.WriteFile(pointer, changed, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifySelectedDependencies(base.Root, manifest{PackageKey: "editor-tools", Dependencies: []packageDependency{{"foundation-pkg", "1.2.3", "content-selected"}}}); err == nil {
		t.Fatal("wrong prerequisite version accepted")
	}
	// The pointer must also be a regular file, not a redirected filesystem path.
	if err := os.Remove(pointer); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(base.Root, "other"), pointer); err == nil {
		if err := verifySelectedDependencies(base.Root, manifest{PackageKey: "editor-tools", Dependencies: []packageDependency{{"foundation-pkg", "1.2.3", "content-selected"}}}); err == nil {
			t.Fatal("symlinked dependency state accepted")
		}
	}
}

func TestDestinationPreviewWarnsAndMutationsRefuseMissingDependency(t *testing.T) {
	now := time.Now()
	base := signedDependencyFixture(t, "foundation-pkg", nil)
	app := signedDependencyFixture(t, "editor-tools", []packageDependency{{"foundation-pkg", "1.2.3", "content-selected"}})
	app.Root = base.Root
	for _, input := range []options{base, app} {
		if _, err := stage(input); err != nil {
			t.Fatal(err)
		}
		if _, err := deployManagedContent(grantFixture(t, input, "deploy", now), "deploy", now); err != nil {
			t.Fatal(err)
		}
	}
	dest := t.TempDir()
	ready, err := compareManagedDestination(app, dest)
	if err != nil || !ready.DependenciesReady || !ready.CanUpdateSafely {
		t.Fatalf("valid prerequisites should permit preview: %+v %v", ready, err)
	}
	if err := os.Remove(filepath.Join(base.Root, "managed-active", "foundation-pkg.json")); err != nil {
		t.Fatal(err)
	}
	blocked, err := compareManagedDestination(app, dest)
	if err != nil || blocked.DependenciesReady || blocked.CanUpdateSafely || blocked.DependencyBlocker == "" {
		t.Fatalf("blocked prerequisites need visible read-only reason: %+v %v", blocked, err)
	}
	if _, err := syncFolder(app, dest, false, false); err == nil {
		t.Fatal("destination update accepted missing dependency")
	}
	if _, err := applyMissingManagedFiles(app, dest); err == nil {
		t.Fatal("missing-file copy accepted missing dependency")
	}
	entries, err := os.ReadDir(dest)
	if err != nil || len(entries) != 0 {
		t.Fatal("blocked update modified destination")
	}
}

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
	"strings"
	"testing"
	"time"
)

func grantFixture(t *testing.T, o options, op string, issuedAt time.Time, priorReceipt ...string) options {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(der)
	fp := hex.EncodeToString(digest[:])
	if fp == o.TrustedKeySha256 {
		t.Fatal("control and publisher key not distinct")
	}
	o.TrustedControlKeySha256 = fp
	nonce := make([]byte, 24)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	manifestBytes, err := os.ReadFile(o.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	if err := json.Unmarshal(manifestBytes, &m); err != nil {
		t.Fatal(err)
	}
	p := grantPayload{Schema: 1, Operation: op, PackageKey: m.PackageKey, Version: m.Version, Platform: m.Platform,
		ArtifactSha256: m.ArtifactSha256, SigningKeySha256: o.TrustedKeySha256, ReleaseId: "release-123", RegistrationId: "registration-123", UserId: "user-123",
		IssuedAt: issuedAt.Unix(), ExpiresAt: issuedAt.Unix() + 60, Nonce: base64.RawURLEncoding.EncodeToString(nonce)}
	if len(priorReceipt) > 0 {
		p.PriorReceiptSha256 = priorReceipt[0]
	}
	if len(priorReceipt) > 1 {
		p.PriorMSISha256 = priorReceipt[1]
	}
	if len(priorReceipt) > 2 {
		p.UpgradeJournalSha256 = priorReceipt[2]
	}
	if len(priorReceipt) > 3 {
		p.SuccessorMSISha256 = priorReceipt[3]
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, append([]byte(grantContext), raw...))
	envelope := grantEnvelope{Schema: 1, PayloadBase64url: base64.RawURLEncoding.EncodeToString(raw), SignatureBase64url: base64.RawURLEncoding.EncodeToString(sig),
		PublicKeyPem: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), ControlKeyFingerprint: fp, ExpiresAt: p.ExpiresAt}
	bytes, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	o.Grant = filepath.Join(t.TempDir(), "deployment-grant.json")
	if err := os.WriteFile(o.Grant, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	return o
}
func TestServerSignedManagedDeployAndAuthorizedRollback(t *testing.T) {
	now := time.Now()
	a, _ := fixtureVersion(t, "assets/studio.txt", []byte("v1 contents"), "1.0.0")
	b, _ := fixtureVersion(t, "assets/studio.txt", []byte("v2 contents"), "2.0.0")
	b.Root = a.Root
	for _, o := range []options{a, b} {
		if _, err := stage(o); err != nil {
			t.Fatal(err)
		}
	}
	a = grantFixture(t, a, "deploy", now)
	first, err := deployManagedContent(a, "deploy", now)
	if err != nil {
		t.Fatal(err)
	}
	if first.Generation != 1 || first.State != "managed_content_selected_not_executed" || first.Executed || first.OSAttested {
		t.Fatalf("unsafe deployment claim: %+v", first)
	}
	if _, err := deployManagedContent(a, "deploy", now); err == nil {
		t.Fatal("same grant replay accepted")
	}
	b = grantFixture(t, b, "deploy", now)
	second, err := deployManagedContent(b, "deploy", now)
	if err != nil {
		t.Fatal(err)
	}
	if second.Generation != 2 || second.Version != "2.0.0" {
		t.Fatalf("bad pointer: %+v", second)
	}
	state, err := managedStatus(b.Root, "test-package")
	if err != nil || state.Previous == nil || state.Previous.Version != "1.0.0" {
		t.Fatalf("wrong previous: %+v %v", state, err)
	}
	a = grantFixture(t, a, "rollback", now)
	reverted, err := deployManagedContent(a, "rollback", now)
	if err != nil {
		t.Fatal(err)
	}
	if reverted.Generation != 3 || reverted.Version != "1.0.0" {
		t.Fatalf("rollback failed: %+v", reverted)
	}
	b = grantFixture(t, b, "rollback", now)
	if _, err := deployManagedContent(b, "rollback", now); err != nil {
		t.Fatal(err)
	}
}
func TestManagedContentRejectsForgedExpiredAndWrongOperationGrants(t *testing.T) {
	now := time.Now()
	for name, test := range map[string]func(*testing.T, options) options{
		"absent":          func(t *testing.T, o options) options { return o },
		"expired":         func(t *testing.T, o options) options { return grantFixture(t, o, "deploy", now.Add(-2*time.Minute)) },
		"wrong-operation": func(t *testing.T, o options) options { return grantFixture(t, o, "rollback", now) },
		"wrong-pin": func(t *testing.T, o options) options {
			o = grantFixture(t, o, "deploy", now)
			o.TrustedControlKeySha256 = strings.Repeat("e", 64)
			return o
		},
		"publisher-as-control": func(t *testing.T, o options) options {
			o = grantFixture(t, o, "deploy", now)
			o.TrustedControlKeySha256 = o.TrustedKeySha256
			return o
		},
		"tampered-signature": func(t *testing.T, o options) options {
			o = grantFixture(t, o, "deploy", now)
			content, _ := os.ReadFile(o.Grant)
			var v grantEnvelope
			_ = json.Unmarshal(content, &v)
			v.SignatureBase64url = strings.Repeat("A", 86)
			raw, _ := json.Marshal(v)
			if err := os.WriteFile(o.Grant, raw, 0600); err != nil {
				t.Fatal(err)
			}
			return o
		},
	} {
		t.Run(name, func(t *testing.T) {
			o, _ := fixture(t, "bin/data.txt", []byte("stuff"))
			if _, err := stage(o); err != nil {
				t.Fatal(err)
			}
			o = test(t, o)
			if _, err := deployManagedContent(o, "deploy", now); err == nil {
				t.Fatal("invalid grant deployed managed content")
			}
			if _, err := managedStatus(o.Root, "test-package"); err == nil {
				t.Fatal("denied deployment modified active state")
			}
		})
	}
}
func TestManagedContentTamperPreventsRollbackAndPointerChanges(t *testing.T) {
	now := time.Now()
	a, _ := fixtureVersion(t, "assets/one.txt", []byte("one"), "1.0.0")
	b, _ := fixtureVersion(t, "assets/one.txt", []byte("two"), "2.0.0")
	b.Root = a.Root
	for _, o := range []options{a, b} {
		if _, err := stage(o); err != nil {
			t.Fatal(err)
		}
	}
	a = grantFixture(t, a, "deploy", now)
	if _, err := deployManagedContent(a, "deploy", now); err != nil {
		t.Fatal(err)
	}
	b = grantFixture(t, b, "deploy", now)
	if _, err := deployManagedContent(b, "deploy", now); err != nil {
		t.Fatal(err)
	}
	m, _, _, err := verifyInput(a)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(a.Root, "managed", m.PackageKey, m.ArtifactSha256, "assets", "one.txt")
	if err := os.WriteFile(path, []byte("altered"), 0600); err != nil {
		t.Fatal(err)
	}
	a = grantFixture(t, a, "rollback", now)
	if _, err := deployManagedContent(a, "rollback", now); err == nil {
		t.Fatal("tampered managed content passed rollback")
	}
	pointer, err := managedStatus(a.Root, m.PackageKey)
	if err != nil || pointer.Generation != 2 {
		t.Fatalf("failed rollback changed pointer: %+v %v", pointer, err)
	}
}
func TestManagedRootRejectsSymlinkedPackageDirectory(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "assets/data.txt", []byte("hello"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	o = grantFixture(t, o, "deploy", now)
	if err := os.MkdirAll(filepath.Join(o.Root, "managed"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(o.Root, "managed", "test-package")); err != nil {
		t.Skip("symlinks unavailable")
	}
	if _, err := deployManagedContent(o, "deploy", now); err == nil {
		t.Fatal("symlinked managed directory accepted")
	}
}

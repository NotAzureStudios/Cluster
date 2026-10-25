package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWriteEnvFilePreservesValidExtraConfiguration(t *testing.T) {
	file := filepath.Join(t.TempDir(), "server", ".env")
	values := map[string]string{
		"DATABASE_URL":                "postgresql://cluster@example/cluster",
		"SESSION_SECRET":              strings.Repeat("s", 48),
		"CLUSTER_AUTH_SECRET":         strings.Repeat("a", 48),
		"CLUSTER_SECRET_KEY":          strings.Repeat("k", 48),
		"CLUSTER_SECRET_KEY_PREVIOUS": strings.Repeat("p", 48),
		"DISCORD_CLIENT_ID":           "client-id-that-must-survive",
		"CUSTOM_RUNTIME_FLAG":         "enabled",
		"invalid-lowercase":           "must-not-be-written",
	}
	if err := writeEnvFile(file, values); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{
		"CLUSTER_SECRET_KEY_PREVIOUS=" + strings.Repeat("p", 48),
		"DISCORD_CLIENT_ID=client-id-that-must-survive",
		"CUSTOM_RUNTIME_FLAG=enabled",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("managed env omitted %q:\n%s", expected, text)
		}
	}
	if strings.Contains(text, "invalid-lowercase") {
		t.Fatalf("managed env accepted an invalid key:\n%s", text)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(file)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("managed env permissions = %o, want 600", info.Mode().Perm())
		}
	}
}

func TestReadWriteEnvRoundTripKeepsUnknownUppercaseKeys(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(file, []byte("DISCORD_CLIENT_SECRET=keep-me\nCLUSTER_SECRET_KEY_PREVIOUS=old-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	values := readEnvFile(file)
	values["CLUSTER_SECRET_KEY"] = strings.Repeat("n", 48)
	if err := writeEnvFile(file, values); err != nil {
		t.Fatal(err)
	}
	roundTrip := readEnvFile(file)
	if roundTrip["DISCORD_CLIENT_SECRET"] != "keep-me" {
		t.Fatalf("unknown uppercase environment key was lost: %#v", roundTrip)
	}
	if roundTrip["CLUSTER_SECRET_KEY_PREVIOUS"] != "old-key" {
		t.Fatalf("previous key was lost: %#v", roundTrip)
	}
}

func TestDependencyFingerprintIgnoresProductVersion(t *testing.T) {
	root := t.TempDir()
	for _, relative := range dependencyManifestPaths() {
		file := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		contents := `{"name":"fixture","version":"0.470.0","dependencies":{"fixture-dep":"1.2.3"}}`
		if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before, err := dependencyFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, relative := range dependencyManifestPaths() {
		file := filepath.Join(root, relative)
		contents := `{"name":"fixture","version":"0.471.0","dependencies":{"fixture-dep":"1.2.3"}}`
		if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	after, err := dependencyFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("product-only version bump changed dependency fingerprint: %s != %s", before, after)
	}

	manifest := filepath.Join(root, dependencyManifestPaths()[0])
	if err := os.WriteFile(manifest, []byte(`{"name":"fixture","version":"0.471.0","dependencies":{"fixture-dep":"1.2.4"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := dependencyFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	if changed == after {
		t.Fatal("dependency version change did not change dependency fingerprint")
	}
}

func TestInstalledDependencyGraphHealthyValidatesPinnedPackages(t *testing.T) {
	root := t.TempDir()
	for _, relative := range dependencyManifestPaths() {
		file := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		contents := `{"name":"fixture","version":"0.471.0","dependencies":{"fixture-dep":"1.2.3","@cluster/shared":"*"}}`
		if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	installed := filepath.Join(root, "node_modules", "fixture-dep", "package.json")
	if err := os.MkdirAll(filepath.Dir(installed), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, []byte(`{"version":"1.2.3"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if !installedDependencyGraphHealthy(root) {
		t.Fatal("matching pinned dependency graph was rejected")
	}
	if err := os.WriteFile(installed, []byte(`{"version":"1.2.2"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if installedDependencyGraphHealthy(root) {
		t.Fatal("mismatched installed dependency version was accepted")
	}
}

func TestPanelStopGraceExceedsManagedHostDrain(t *testing.T) {
	// Host may wait 135 seconds for the API then perform gateway shutdown.
	const hostAPIGrace = 135 * time.Second
	const hostGatewayGrace = 4 * time.Second
	if managedHostStopGrace <= hostAPIGrace+hostGatewayGrace {
		t.Fatalf("control panel grace %s can kill the Host before its API drains", managedHostStopGrace)
	}
}

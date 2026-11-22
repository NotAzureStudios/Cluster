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

func TestManagedDependencyGraphAcceptsInstalledFontsourceRanges(t *testing.T) {
	root := t.TempDir()
	for _, relative := range dependencyManifestPaths() {
		file := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		contents := `{"name":"fixture","version":"2.0.0","dependencies":{}}`
		if filepath.ToSlash(relative) == "packages/renderer/package.json" {
			contents = `{"name":"@cluster/renderer","version":"2.0.0","dependencies":{"@fontsource/comfortaa":"^5.3.0","@fontsource/inter":"^5.3.0"}}`
		}
		if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, family := range []string{"comfortaa", "inter"} {
		file := filepath.Join(root, "node_modules", "@fontsource", family, "package.json")
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(`{"version":"5.3.0"}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if !installedDependencyGraphHealthy(root) {
		t.Fatal("2.0.0 renderer ranges rejected installed locked font packages")
	}
	file := filepath.Join(root, "node_modules", "@fontsource", "inter", "package.json")
	if err := os.WriteFile(file, []byte(`{"version":"6.0.0"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if installedDependencyGraphHealthy(root) {
		t.Fatal("out-of-range installed font version was accepted")
	}
}

func TestNpmVersionRequirementMatches(t *testing.T) {
	cases := []struct {
		requirement string
		installed string
		want bool
	}{
		{"5.3.0", "5.3.0", true},
		{"5.3.0", "5.3.1", false},
		{"^5.3.0", "5.3.0", true},
		{"^5.3.0", "5.9.7", true},
		{"^5.3.0", "5.2.9", false},
		{"^5.3.0", "6.0.0", false},
		{"^0.4.2", "0.4.8", true},
		{"^0.4.2", "0.5.0", false},
		{"^0.0.7", "0.0.7", true},
		{"^0.0.7", "0.0.8", false},
		{"~5.3.0", "5.3.8", true},
		{"~5.3.0", "5.4.0", false},
		{"^5.3.0", "5.3.0-beta.1", false},
		{">=5.3.0", "5.3.0", false},
		{"^bad", "5.3.0", false},
	}
	for _, tc := range cases {
		if got := npmVersionRequirementMatches(tc.requirement, tc.installed); got != tc.want {
			t.Errorf("requirement %q installed %q: got %t, want %t", tc.requirement, tc.installed, got, tc.want)
		}
	}
}

func TestInstalledPackageVersionPrefersWorkspaceLocalDependency(t *testing.T) {
	root := t.TempDir()
	for _, item := range []struct{ path, version string }{
		{filepath.Join("node_modules", "example", "package.json"), "1.0.0"},
		{filepath.Join("packages", "renderer", "node_modules", "example", "package.json"), "2.0.0"},
	} {
		file := filepath.Join(root, item.path)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(`{"version":"`+item.version+`"}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, ok := installedPackageVersion(root, filepath.Join("packages", "renderer"), "example")
	if !ok || got != "2.0.0" {
		t.Fatalf("workspace dependency resolution = %q (%t), want local 2.0.0", got, ok)
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

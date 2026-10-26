package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func msiSample(t *testing.T, entry string, payload []byte) ([]byte, manifest) {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	file, err := writer.Create(entry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(payload)
	m := manifest{Schema: 1, PackageKey: "studio-tools", Version: "1.0.0", Platform: "windows-x64",
		Installer: &msiInstaller{Kind: "windows-msi", Path: entry, Sha256: hex.EncodeToString(hash[:]), Scope: "user", ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.0.0"}}
	return buf.Bytes(), m
}
func TestSignedMSIRequiresExactBytesAndSafeDeclaration(t *testing.T) {
	payload := append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, []byte("test MSI compound file placeholder")...)
	archive, m := msiSample(t, "install/editor.msi", payload)
	if err := validateMSIInstaller(m, archive); err != nil {
		t.Fatalf("valid declaration refused: %v", err)
	}
	for name, mutate := range map[string]func(*manifest){
		"other-platform":        func(m *manifest) { m.Platform = "linux-x64" },
		"wrong-extension":       func(m *manifest) { m.Installer.Path = "install/editor.exe" },
		"escape":                func(m *manifest) { m.Installer.Path = "../editor.msi" },
		"absolute":              func(m *manifest) { m.Installer.Path = "/editor.msi" },
		"wrong-member":          func(m *manifest) { m.Installer.Path = "install/other.msi" },
		"wrong-hash":            func(m *manifest) { m.Installer.Sha256 = strings.Repeat("a", 64) },
		"machine-scope":         func(m *manifest) { m.Installer.Scope = "machine" },
		"script-type":           func(m *manifest) { m.Installer.Kind = "shell-script" },
		"wrong-product-code":    func(m *manifest) { m.Installer.ProductCode = "{BAD}" },
		"wrong-product-version": func(m *manifest) { m.Installer.ProductVersion = "1.0-beta" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := m
			copyInstaller := *m.Installer
			changed.Installer = &copyInstaller
			mutate(&changed)
			if err := validateMSIInstaller(changed, archive); err == nil {
				t.Fatal("unsafe declaration accepted")
			}
		})
	}
	// A correct sha256 cannot turn an arbitrary script into an MSI member.
	other, wrong := msiSample(t, "install/editor.msi", []byte("not an MSI"))
	if err := validateMSIInstaller(wrong, other); err == nil {
		t.Fatal("fake MSI content accepted")
	}
	if err := validateMSIInstaller(manifest{Platform: "linux-x64"}, archive); err != nil {
		t.Fatal("non-installer releases regressed")
	}
}
func TestUnprivilegedMSICommandCannotRunOnOtherPlatforms(t *testing.T) {
	if hostPlatform() == "windows-x64" {
		t.Skip("Windows-only install command must be tested on a provisioned Windows VM")
	}
	o, _ := fixture(t, "presets/item.txt", []byte("content"))
	o.Grant = ""
	_, err := installSupervisedMSI(o, time.Now())
	if err == nil {
		t.Fatal("non-Windows host allowed MSI")
	}
	if _, statErr := os.Stat(filepath.Join(o.Root, "msi-attempts")); !os.IsNotExist(statErr) {
		t.Fatalf("refused command changed disk: %v", statErr)
	}
}

func TestContentGrantAndInstallGrantCannotCrossAuthorize(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "presets/data.txt", []byte("ordinary signed content"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	installGrant := grantFixture(t, o, "install", now)
	if _, err := deployManagedContent(installGrant, "deploy", now); err == nil {
		t.Fatal("install grant authorized unprivileged content deployment")
	}
	if _, err := os.Stat(filepath.Join(o.Root, "managed-active", "test-package.json")); !os.IsNotExist(err) {
		t.Fatal("cross-purpose grant mutated managed pointer")
	}
	m, _, keyHash, err := verifyInput(o)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyDeploymentGrant(grantFixture(t, o, "deploy", now), m, keyHash, "install", now); err == nil {
		t.Fatal("deploy grant authorized install")
	}
	if _, err := verifyDeploymentGrant(installGrant, m, keyHash, "install", now); err != nil {
		t.Fatalf("correct signed install grant refused: %v", err)
	}
}

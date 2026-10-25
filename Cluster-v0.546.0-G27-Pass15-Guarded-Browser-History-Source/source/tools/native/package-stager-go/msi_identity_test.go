package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStagedMSIPropertyIdentityPolicy(t *testing.T) {
	declaration := msiInstaller{ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "2.3.4"}
	code := declaration.ProductCode
	version := declaration.ProductVersion
	result, err := checkMSIPropertyIdentity(declaration, code, version)
	if err != nil || !result.Verified || result.State != "msi_properties_match_signed_declaration" || !result.ReadOnly || result.OSAttested {
		t.Fatalf("matching properties not accepted as read-only evidence: %+v %v", result, err)
	}
	cases := []struct{ name, actualCode, actualVersion, wantState string }{
		{"different-code", "{87654321-1234-ABCD-ABCD-1234567890AB}", version, "msi_property_mismatch"},
		{"different-version", code, "2.3.5", "msi_property_mismatch"},
		{"empty-version", code, "", "invalid_msi_property_identity"},
		{"noncanonical-guid", strings.ToLower(code), version, "invalid_msi_property_identity"},
		{"oversized-version", code, strings.Repeat("1", 200), "invalid_msi_property_identity"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := checkMSIPropertyIdentity(declaration, tc.actualCode, tc.actualVersion)
			if err == nil || result.Verified || !result.ReadOnly || result.OSAttested || result.State != tc.wantState {
				t.Fatalf("unsafe MSI Property identity accepted: %+v, %v", result, err)
			}
		})
	}
	invalid := declaration
	invalid.ProductCode = "../bad"
	if result, err := checkMSIPropertyIdentity(invalid, code, version); err == nil || result.Verified {
		t.Fatal("invalid signed declaration accepted")
	}
}

func TestMSIPropertyInspectionCannotClaimWindowsOnLinux(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("real MSI database fixture required on Windows")
	}
	path := filepath.Join(t.TempDir(), "fake.msi")
	if err := os.WriteFile(path, []byte("not a valid MSI"), 0600); err != nil {
		t.Fatal(err)
	}
	ins := msiInstaller{ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "2.3.4"}
	result, err := inspectStagedMSIProperties(path, ins)
	if err == nil || result.Verified || result.OSAttested || !result.ReadOnly || result.State != "msi_property_unavailable" {
		t.Fatalf("non-Windows identity lookup claimed success: %+v %v", result, err)
	}
}

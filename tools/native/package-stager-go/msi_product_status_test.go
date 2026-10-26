package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMSIRegistrationEvidenceDoesNotBecomeAuthorization(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	expected := "2.4.1"
	cases := []struct {
		osState                 int32
		reported, expectedState string
		exact                   bool
	}{
		{5, "2.4.1", "registered_version_match", true},
		{5, "2.4.0", "registered_version_mismatch", false},
		{5, "", "registered_version_unavailable", false},
		{5, "2.4.1-beta", "registered_version_unavailable", false},
		{1, "", "advertised_not_verified", false},
		{2, "", "not_registered_for_user", false},
		{-1, "", "not_registered_for_user", false},
		{0, "", "registration_incomplete_or_unknown", false},
	}
	for _, c := range cases {
		r := classifyMSIProductState(code, expected, c.osState, c.reported)
		if r.State != c.expectedState || r.VersionMatches != c.exact || r.OSAttested || !r.ReadOnly {
			t.Fatalf("unsafe state %+v for %+v", r, c)
		}
	}
}

func TestMSIReceiptInventoryIdentityAndCorruption(t *testing.T) {
	root := t.TempDir()
	key := "studio-tools"
	if err := os.Mkdir(filepath.Join(root, "msi-attempts"), 0700); err != nil {
		t.Fatal(err)
	}
	receipt := msiAttempt{Schema: 1, PackageKey: key, Version: "1.2.3", ArtifactSha256: strings.Repeat("a", 64), MSISha256: strings.Repeat("b", 64), ProductCode: "{12345678-1234-ABCD-ABCD-1234567890AB}", ProductVersion: "1.2.3", State: "msi_started_outcome_unknown", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	save := func() {
		t.Helper()
		bytes, err := json.Marshal(receipt)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "msi-attempts", key+".json"), bytes, 0600); err != nil {
			t.Fatal(err)
		}
	}
	save()
	result, err := inspectMSIAttempt(root, key)
	if err != nil || result.Product == nil || !result.Product.ReadOnly || result.Product.OSAttested || result.Product.VersionMatches || result.RetryAuthorized || !result.ManualReviewRequired {
		t.Fatalf("inventory evidence must remain non-authorizing: %+v, %v", result, err)
	}
	receipt.ProductCode = "{spoofed}"
	save()
	if _, err := inspectMSIAttempt(root, key); err == nil {
		t.Fatal("corrupt signed product identity accepted")
	}
	receipt.ProductCode = "{12345678-1234-ABCD-ABCD-1234567890AB}"
	receipt.ProductVersion = "unsafe-version"
	save()
	if _, err := inspectMSIAttempt(root, key); err == nil {
		t.Fatal("corrupt product version accepted")
	}
}

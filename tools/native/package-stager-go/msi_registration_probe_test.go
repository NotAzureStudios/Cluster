package main

import "testing"

func TestMSIContextEnumerationCannotManufactureFreshInstall(t *testing.T) {
	const code = "{12345678-1234-ABCD-ABCD-1234567890AB}"
	const version = "1.2.3"
	cases := []struct {
		name                       string
		first, context, next, info uint32
		found, reported, state     string
		complete, fresh            bool
	}{
		{"complete absence", 259, 0, 0, 0, "", "", "not_registered_for_user", true, true},
		{"current user installed", 0, 2, 259, 0, code, version, "registered_version_match", true, false},
		{"machine installed", 0, 4, 259, 0, code, version, "registered_version_match", true, false},
		{"managed user installed", 0, 1, 259, 0, code, version, "registered_version_match", true, false},
		{"machine other version", 0, 4, 259, 0, code, "1.2.4", "registered_version_mismatch", true, false},
		{"MSI property unreadable", 0, 4, 259, 1608, code, version, "registered_version_unavailable", true, false},
		{"multiple contexts", 0, 4, 0, 0, code, version, "os_query_unavailable", false, false},
		{"enum access denied", 5, 0, 0, 0, "", "", "os_query_unavailable", false, false},
		{"enum unknown product", 1605, 0, 0, 0, "", "", "not_registered_for_user", true, true},
		{"enum bad configuration", 1610, 0, 0, 0, "", "", "os_query_unavailable", false, false},
		{"second enumeration failed", 0, 4, 5, 0, code, version, "os_query_unavailable", false, false},
		{"invalid returned context", 0, 8, 259, 0, code, version, "os_query_unavailable", false, false},
		{"foreign ProductCode", 0, 4, 259, 0, "{AAAABBBB-1234-ABCD-ABCD-1234567890AB}", version, "os_query_unavailable", false, false},
		{"contradictory absent scope", 259, 4, 0, 0, "", "", "os_query_unavailable", false, false},
		{"contradictory absent version", 259, 0, 0, 0, "", version, "os_query_unavailable", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, e := classifyMSIEnumeratedProduct(code, version, tc.first, tc.context, tc.found, tc.next, tc.info, tc.reported)
			if p.State != tc.state || p.ProbeComplete != tc.complete || p.OSAttested || !p.ReadOnly ||
				(e == nil) != tc.complete || (requireFreshMSIProductRegistration(p, e, code, version) == nil) != tc.fresh {
				t.Fatalf("unsafe or inconsistent enumeration %+v (%v)", p, e)
			}
			if tc.complete && p.ProbeScope != msiRegistrationScope {
				t.Fatal("scope not preserved")
			}
		})
	}
}

func TestMSIFreshAdmissionRequiresCompleteCurrentAndMachineProbe(t *testing.T) {
	code := "{12345678-1234-ABCD-ABCD-1234567890AB}"
	p, e := classifyMSIEnumeratedProduct(code, "1.2.3", 259, 0, "", 0, 0, "")
	if e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*msiProductState){
		func(v *msiProductState) { v.ProbeComplete = false },
		func(v *msiProductState) { v.ProbeScope = "current_user_only" },
		func(v *msiProductState) { v.ProbeScope = "" },
		func(v *msiProductState) { v.OSAttested = true },
		func(v *msiProductState) { v.State = "registration_incomplete_or_unknown" },
	} {
		q := p
		change(&q)
		if requireFreshMSIProductRegistration(q, nil, code, "1.2.3") == nil {
			t.Fatalf("forged probe authorized: %+v", q)
		}
	}
}

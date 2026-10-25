package main

import "testing"

func TestRollbackRecoveryNeverAttestsOrAuthorizes(t *testing.T) {
	code := "{AABBCCDD-1234-5678-ABCD-1234567890AB}"
	receipt := msiRepairReceipt{Operation: "msi-rollback", ProductCode: code, ProductVersion: "1.4.2", PriorProductVersion: "1.5.0"}
	base := msiProductState{ProductCode: code, ExpectedVersion: "1.4.2", ReadOnly: true, ProbeScope: "current_user_and_machine", ProbeComplete: true}
	for _, tc := range []struct {
		name, state, reported, result string
		matches, complete             bool
	}{
		{"predecessor", "registered_version_match", "1.4.2", "rollback_predecessor_registered_not_health_attested", true, true},
		{"successor", "registered_version_mismatch", "1.5.0", "rollback_successor_remains_registered", false, true},
		{"other", "registered_version_mismatch", "1.5.7", "rollback_unexpected_version_registered", false, true},
		{"missing", "not_registered_for_user", "", "rollback_product_not_registered", false, true},
		{"advertised", "advertised_not_verified", "", "rollback_registration_ambiguous", false, true},
		{"query_failure", "os_query_unavailable", "", "rollback_registration_unavailable", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			observed := base
			observed.State, observed.ReportedVersion, observed.VersionMatches, observed.ProbeComplete = tc.state, tc.reported, tc.matches, tc.complete
			if !tc.complete {
				observed.ProbeScope = ""
			}
			report, err := classifyMSIRollbackRecovery(receipt, observed, tc.complete)
			if err != nil || report.State != tc.result || !report.ReadOnly || report.OSAttested || report.RollbackConfirmed {
				t.Fatalf("unsafe decision: %+v %v", report, err)
			}
		})
	}
	for _, tc := range []struct {
		name   string
		mutate func(*msiProductState)
	}{
		{"changed_product", func(s *msiProductState) { s.ProductCode = "{FFFFFFFF-1234-5678-ABCD-1234567890AB}" }},
		{"changed_expected_version", func(s *msiProductState) { s.ExpectedVersion = "1.5.0" }},
		{"false_registration_attestation", func(s *msiProductState) { s.OSAttested = true }},
		{"read_only_lost", func(s *msiProductState) { s.ReadOnly = false }},
		{"unscoped_query", func(s *msiProductState) { s.ProbeScope = "current_user" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			s.State = "registered_version_match"
			s.ReportedVersion = "1.4.2"
			s.VersionMatches = true
			tc.mutate(&s)
			if _, err := classifyMSIRollbackRecovery(receipt, s, true); err == nil {
				t.Fatal("tampered OS evidence accepted")
			}
		})
	}
}

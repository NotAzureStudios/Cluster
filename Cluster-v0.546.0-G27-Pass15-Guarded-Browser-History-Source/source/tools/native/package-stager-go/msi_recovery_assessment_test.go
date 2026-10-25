package main

import "testing"

func TestMSIRecoveryAssessmentIsNonAuthorizing(t *testing.T) {
	cases := []struct {
		attempt, registration string
		locked                bool
		want                  string
		reboot                bool
	}{
		{"msi_started_outcome_unknown", "registered_version_match", false, "interrupted_or_active_manual_review", false},
		{"msi_started_outcome_unknown", "registered_version_match", true, "operation_active_or_interrupted_manual_review", false},
		{"msi_failed_or_outcome_unknown", "registered_version_match", false, "failed_or_unknown_manual_review", false},
		{"msi_exit_zero_not_os_attested", "registered_version_match", false, "registered_version_matches_not_health_attested", false},
		{"msi_exit_zero_not_os_attested", "registered_version_mismatch", false, "registered_version_conflicts_with_receipt", false},
		{"msi_exit_zero_not_os_attested", "not_registered_for_user", false, "not_registered_for_current_user", false},
		{"msi_exit_zero_not_os_attested", "os_query_unavailable", false, "os_registration_unverified", false},
		{"msi_restart_required_not_os_attested", "registered_version_match", false, "restart_required_registration_unverified", true},
		{"msi_restart_required_not_os_attested", "registered_version_mismatch", false, "restart_required_registration_unverified", true},
		{"msi_restart_required_not_os_attested", "registered_version_match", true, "operation_active_or_interrupted_manual_review", true},
	}
	for _, tc := range cases {
		got, reboot := classifyMSIRecoveryAssessment(tc.attempt, tc.locked, tc.registration)
		if got != tc.want || reboot != tc.reboot {
			t.Fatalf("%q/%v/%q: got %q (%v), want %q (%v)", tc.attempt, tc.locked, tc.registration, got, reboot, tc.want, tc.reboot)
		}
	}
}

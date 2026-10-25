package main

import "testing"

func TestUpgradeRecoveryReportsRegistrationWithoutGrantingRollback(t *testing.T) {
	receipt := sampleRepairReceipt()
	receipt.Operation = "upgrade"
	receipt.ProductVersion = "1.2.3"
	receipt.PriorProductVersion = "1.2.2"
	sample := msiProductState{State: "registered_version_match", ProductCode: receipt.ProductCode, ExpectedVersion: receipt.ProductVersion,
		ReportedVersion: receipt.ProductVersion, VersionMatches: true, ReadOnly: true, ProbeComplete: true, ProbeScope: "current_user_and_machine"}
	cases := []struct {
		state, expected string
		matches         bool
	}{
		{"registered_version_match", "upgrade_target_registered_not_health_attested", true},
		{"registered_version_mismatch", "upgrade_predecessor_remains_registered", false},
		{"not_registered_for_user", "upgrade_product_not_registered", false},
		{"os_query_unavailable", "upgrade_registration_ambiguous", false},
	}
	for _, c := range cases {
		t.Run(c.state, func(t *testing.T) {
			v := sample
			v.State = c.state
			v.VersionMatches = c.matches
			if c.state == "registered_version_mismatch" {
				v.ReportedVersion = receipt.PriorProductVersion
			}
			if c.state == "not_registered_for_user" || c.state == "os_query_unavailable" {
				v.ReportedVersion = ""
			}
			result, err := classifyMSIUpgradeRecovery(receipt, v, true)
			if err != nil || result.State != c.expected || result.RollbackAuthorized || result.OSAttested || !result.ReadOnly {
				t.Fatalf("unsafe recovery %+v %v", result, err)
			}
		})
	}
	v := sample
	v.State = "os_query_unavailable"
	v.ReportedVersion = ""
	v.ProbeComplete = false
	v.ProbeScope = ""
	result, err := classifyMSIUpgradeRecovery(receipt, v, false)
	if err != nil || result.State != "upgrade_registration_unavailable" {
		t.Fatalf("unavailable evidence %+v %v", result, err)
	}
	v = sample
	v.ProductCode = "{00000000-1234-5678-ABCD-1234567890AB}"
	if _, err := classifyMSIUpgradeRecovery(receipt, v, true); err == nil {
		t.Fatal("foreign product registration misattributed to upgrade")
	}
}

package main

import "errors"

// Windows registration is a bounded, read-only observation. Even registration
// of the predecessor after rollback does NOT prove file health, data
// compatibility, service health, or completed MSI custom actions.
type msiRollbackRecovery struct {
	State             string          `json:"state"`
	ReadOnly          bool            `json:"readOnly"`
	OSAttested        bool            `json:"osAttested"`
	RollbackConfirmed bool            `json:"rollbackConfirmed"`
	Registration      msiProductState `json:"registration"`
}

func classifyMSIRollbackRecovery(receipt msiRepairReceipt, observed msiProductState, complete bool) (msiRollbackRecovery, error) {
	out := msiRollbackRecovery{ReadOnly: true, OSAttested: false, RollbackConfirmed: false, Registration: observed}
	if receipt.Operation != "msi-rollback" || !msiProductCodePattern.MatchString(receipt.ProductCode) ||
		!msiProductVersionPattern.MatchString(receipt.ProductVersion) || !msiProductVersionPattern.MatchString(receipt.PriorProductVersion) ||
		observed.ProductCode != receipt.ProductCode || observed.ExpectedVersion != receipt.ProductVersion ||
		!observed.ReadOnly || observed.OSAttested || (complete && observed.ProbeScope != "current_user_and_machine") {
		return out, errors.New("inconsistent MSI rollback registration evidence")
	}
	switch {
	case !complete || !observed.ProbeComplete:
		out.State = "rollback_registration_unavailable"
	case observed.State == "registered_version_match" && observed.VersionMatches && observed.ReportedVersion == receipt.ProductVersion:
		out.State = "rollback_predecessor_registered_not_health_attested"
	case observed.State == "registered_version_mismatch" && !observed.VersionMatches && observed.ReportedVersion == receipt.PriorProductVersion:
		out.State = "rollback_successor_remains_registered"
	case observed.State == "registered_version_mismatch" && !observed.VersionMatches && msiProductVersionPattern.MatchString(observed.ReportedVersion):
		out.State = "rollback_unexpected_version_registered"
	case observed.State == "not_registered_for_user" && !observed.VersionMatches && observed.ReportedVersion == "":
		out.State = "rollback_product_not_registered"
	default:
		out.State = "rollback_registration_ambiguous"
	}
	return out, nil
}

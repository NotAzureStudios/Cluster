package main

import "errors"

// Observations after an upgrade are not attestation, replay authority or
// proof that MSI custom actions completed correctly. This is a read-only
// description of what Windows Installer reports NOW versus the prior receipt.
type msiUpgradeRecovery struct {
	State              string          `json:"state"`
	ReadOnly           bool            `json:"readOnly"`
	OSAttested         bool            `json:"osAttested"`
	RollbackAuthorized bool            `json:"rollbackAuthorized"`
	Registration       msiProductState `json:"registration"`
}

func classifyMSIUpgradeRecovery(receipt msiRepairReceipt, observed msiProductState, complete bool) (msiUpgradeRecovery, error) {
	result := msiUpgradeRecovery{ReadOnly: true, OSAttested: false, RollbackAuthorized: false, Registration: observed}
	if receipt.Operation != "upgrade" || !msiProductCodePattern.MatchString(receipt.ProductCode) ||
		!msiProductVersionPattern.MatchString(receipt.ProductVersion) ||
		!msiProductVersionPattern.MatchString(receipt.PriorProductVersion) || receipt.ProductVersion == receipt.PriorProductVersion ||
		observed.ProductCode != receipt.ProductCode || observed.ExpectedVersion != receipt.ProductVersion ||
		!observed.ReadOnly || observed.OSAttested || observed.ProbeScope != "current_user_and_machine" && complete {
		return result, errors.New("inconsistent read-only MSI upgrade registration identity")
	}
	switch {
	case !complete || !observed.ProbeComplete:
		result.State = "upgrade_registration_unavailable"
	case observed.State == "registered_version_match" && observed.VersionMatches && observed.ReportedVersion == receipt.ProductVersion:
		result.State = "upgrade_target_registered_not_health_attested"
	case observed.State == "registered_version_mismatch" && !observed.VersionMatches && observed.ReportedVersion == receipt.PriorProductVersion:
		result.State = "upgrade_predecessor_remains_registered"
	case observed.State == "registered_version_mismatch" && !observed.VersionMatches && msiProductVersionPattern.MatchString(observed.ReportedVersion):
		result.State = "upgrade_unexpected_version_registered"
	case observed.State == "not_registered_for_user" && !observed.VersionMatches && observed.ReportedVersion == "":
		result.State = "upgrade_product_not_registered"
	default:
		result.State = "upgrade_registration_ambiguous"
	}
	return result, nil
}

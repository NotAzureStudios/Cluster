package main

import "errors"

// A Windows Installer registration is evidence from the current user context,
// NOT application health, signer authenticity, installed files, or a safe
// authorization to repair/uninstall/retry. Product identity is taken only from
// the previously verified signed MSI declaration recorded before execution.
type msiProductState struct {
	State           string `json:"state"`
	ProductCode     string `json:"productCode"`
	ExpectedVersion string `json:"expectedVersion"`
	ReportedVersion string `json:"reportedVersion,omitempty"`
	VersionMatches  bool   `json:"versionMatches"`
	ReadOnly        bool   `json:"readOnly"`
	OSAttested      bool   `json:"osAttested"`
	ProbeScope      string `json:"probeScope"`
	ProbeComplete   bool   `json:"probeComplete"`
}

// The classification is pure so that Linux source tests also exercise the
// Windows registration-state decision table. Version equality is exact: MSI
// registration for some other revision is not the signed release we expected.
func classifyMSIProductState(code, expected string, installState int32, reportedVersion string) msiProductState {
	out := msiProductState{ProductCode: code, ExpectedVersion: expected,
		ReadOnly: true, OSAttested: false}
	switch installState {
	case 5:
		if !msiProductVersionPattern.MatchString(reportedVersion) {
			out.State = "registered_version_unavailable"
		} else {
			out.ReportedVersion = reportedVersion
			out.VersionMatches = expected == reportedVersion
			if out.VersionMatches {
				out.State = "registered_version_match"
			} else {
				out.State = "registered_version_mismatch"
			}
		}
	case 1:
		out.State = "advertised_not_verified"
	case 2, -1:
		out.State = "not_registered_for_user"
	default:
		out.State = "registration_incomplete_or_unknown"
	}
	return out
}

// Only a completed enumeration of current-user AND per-machine product contexts
// can support a fresh-install admission. The legacy single-user query is
// insufficient because the same ProductCode can exist per-machine.
// Refuse the launch of an already registered, advertised, ambiguous or
// unqueryable ProductCode. This gate is deliberately narrower than an MSI
// health check: a "not registered" response permits only a *new attempt*,
// never a claim that the installer will be safe or successful. Upgrades and
// repair require a separately designed and authorized lifecycle.
func requireFreshMSIProductRegistration(product msiProductState, queryErr error, code, version string) error {
	if queryErr != nil || product.ProductCode != code || product.ExpectedVersion != version ||
		!product.ReadOnly || product.OSAttested || product.VersionMatches ||
		product.State != "not_registered_for_user" || product.ReportedVersion != "" ||
		product.ProbeScope != "current_user_and_machine" || !product.ProbeComplete {
		return errors.New("MSI ProductCode is registered, ambiguous or cannot be verified as fresh; manual review required")
	}
	return nil
}

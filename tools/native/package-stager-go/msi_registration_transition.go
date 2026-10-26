package main

// Durable, read-only correlation of Windows Installer registration observations
// on either side of one supervised msiexec invocation. A registration change is
// not proof that Cluster's installer caused it and NEVER grants repair, retry,
// update, removal or rollback authority.
import "errors"

const (
	msiTransitionHistorical       = "historical_receipt_no_transition_evidence"
	msiTransitionPrelaunchOnly    = "prelaunch_recorded_outcome_unknown"
	msiTransitionMatchObserved    = "matching_registration_observed_after_attempt"
	msiTransitionMissingObserved  = "no_registration_observed_after_attempt"
	msiTransitionConflictObserved = "conflicting_registration_observed_after_attempt"
	msiTransitionQueryUnavailable = "post_exit_registration_unavailable"
)

func unavailableMSIRegistration(code, version string) msiProductState {
	return msiProductState{State: "os_query_unavailable", ProductCode: code,
		ExpectedVersion: version, ReadOnly: true, OSAttested: false}
}

func validMSIRegistrationObservation(value msiProductState, code, version string) bool {
	if value.ProductCode != code || value.ExpectedVersion != version ||
		!msiProductCodePattern.MatchString(code) || !msiProductVersionPattern.MatchString(version) ||
		!value.ReadOnly || value.OSAttested {
		return false
	}
	if value.State == "os_query_unavailable" {
		return !value.ProbeComplete && value.ProbeScope == "" &&
			!value.VersionMatches && value.ReportedVersion == ""
	}
	if !value.ProbeComplete || value.ProbeScope != msiRegistrationScope {
		return false
	}
	switch value.State {
	case "not_registered_for_user", "advertised_not_verified", "registered_version_unavailable", "registration_incomplete_or_unknown":
		return !value.VersionMatches && value.ReportedVersion == ""
	case "registered_version_match":
		return value.VersionMatches && value.ReportedVersion == version
	case "registered_version_mismatch":
		return !value.VersionMatches && msiProductVersionPattern.MatchString(value.ReportedVersion) && value.ReportedVersion != version
	default:
		return false
	}
}

func validateMSIRegistrationTransition(attempt msiAttempt) error {
	before, after := attempt.PreLaunchRegistration, attempt.PostExitRegistration
	if before == nil {
		if after != nil {
			return errors.New("MSI post-exit registration exists without a pre-launch baseline")
		}
		return nil // Backward-readable receipts from before this evidence was recorded.
	}
	if !validMSIRegistrationObservation(*before, attempt.ProductCode, attempt.ProductVersion) ||
		requireFreshMSIProductRegistration(*before, nil, attempt.ProductCode, attempt.ProductVersion) != nil ||
		attempt.LaunchCommittedAt == "" || attempt.State == "msi_prepared_not_launched" {
		return errors.New("MSI pre-launch registration evidence inconsistent with fresh-install admission")
	}
	if attempt.FinishedAt == "" {
		if after != nil {
			return errors.New("MSI post-exit registration recorded before process completion")
		}
		return nil
	}
	if after == nil || !validMSIRegistrationObservation(*after, attempt.ProductCode, attempt.ProductVersion) {
		return errors.New("MSI terminal attempt has missing or malformed post-exit registration evidence")
	}
	return nil
}

func classifyMSIRegistrationTransition(attempt msiAttempt) string {
	if attempt.PreLaunchRegistration == nil {
		return msiTransitionHistorical
	}
	if attempt.PostExitRegistration == nil {
		return msiTransitionPrelaunchOnly
	}
	switch attempt.PostExitRegistration.State {
	case "registered_version_match":
		return msiTransitionMatchObserved
	case "not_registered_for_user":
		return msiTransitionMissingObserved
	case "os_query_unavailable":
		return msiTransitionQueryUnavailable
	default:
		return msiTransitionConflictObserved
	}
}

// Correlate the recorded post-exit observation with a later read-only OS
// registration query. Reboot or late MSI registration can change this value;
// a match is still NOT evidence of healthy software or causal installation.
func classifyMSIRegistrationDrift(attempt msiAttempt, current msiProductState) string {
	if attempt.PostExitRegistration == nil {
		return "no_post_exit_baseline"
	}
	after := *attempt.PostExitRegistration
	if after.State == "os_query_unavailable" || current.State == "os_query_unavailable" {
		return "registration_comparison_unavailable"
	}
	if after == current {
		return "registration_unchanged_since_exit"
	}
	return "registration_changed_since_exit"
}

// Double-sample just after process return. A changing Windows Installer
// database, or an unavailable query, is preserved as explicit uncertainty.
func observeMSIPostExitRegistration(code, version string, query func(string, string) (msiProductState, error)) msiProductState {
	first, firstErr := query(code, version)
	second, secondErr := query(code, version)
	if firstErr != nil || secondErr != nil ||
		!validMSIRegistrationObservation(first, code, version) ||
		!validMSIRegistrationObservation(second, code, version) || first != second {
		return unavailableMSIRegistration(code, version)
	}
	return first
}

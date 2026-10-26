package main

import "errors"

// Fresh-install admission is rechecked after the child has been created
// SUSPENDED but before ResumeThread. A registration that appears during the
// source freeze/process setup must kill the unstarted child, never turn an
// install into a repair or upgrade. Two live OS reads must agree with the
// pre-launch receipt. This is still not an atomic global Windows Installer
// transaction: concurrent external installers remain a Windows release gate.
func verifyMSILaunchAdmission(code, version string, baseline msiProductState,
	query func(string, string) (msiProductState, error)) error {
	if query == nil || requireFreshMSIProductRegistration(baseline, nil, code, version) != nil {
		return errors.New("MSI launch baseline was not a verified fresh ProductCode")
	}
	first, firstErr := query(code, version)
	second, secondErr := query(code, version)
	if firstErr != nil || secondErr != nil || !sameMSIRegistrationObservation(first, second, true, true) ||
		!sameMSIRegistrationObservation(first, baseline, true, true) ||
		requireFreshMSIProductRegistration(first, nil, code, version) != nil {
		return errors.New("MSI ProductCode admission changed immediately before process resume; manual review required")
	}
	return nil
}

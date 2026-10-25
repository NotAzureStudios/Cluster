//go:build !windows

package main

import "errors"

func runWindowsUserMSI(_ *msiFrozenSource, _ msiProductState, _ string, _ manifest, _ []msiDependencyEvidence) (int, error) {
	return -1, errors.New("MSI execution is Windows-only")
}

func acquireMSIFrozenSource(_ string, _ string) (*msiFrozenSource, error) {
	return nil, errors.New("MSI frozen-source acquisition is Windows-only")
}

func runWindowsUserMSIRepair(*msiFrozenSource, msiProductState, string, manifest, []msiDependencyEvidence) (int, error) {
	return -1, errors.New("Windows supervised repair unavailable")
}

func runWindowsUserMSIRollback(_, _ *msiFrozenSource, _ msiProductState, _ string, _ manifest, _ string) (int, error) {
	return -1, errors.New("Windows MSI rollback unavailable on this platform")
}
func runWindowsUserMSIUpgrade(_, _ *msiFrozenSource, _ msiProductState, _ string, _ manifest, _ []msiDependencyEvidence, _ string) (int, error) {
	return -1, errors.New("Windows supervised upgrade unavailable")
}
func runWindowsUserMSIUninstall(source *msiFrozenSource, baseline msiProductState, root string, m manifest, dependencies []msiDependencyEvidence) (int, error) {
	return -1, errors.New("Windows MSI uninstall unavailable on this platform")
}

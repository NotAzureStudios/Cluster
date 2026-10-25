//go:build !windows

package main

import "errors"

// The MSI database's Property table is inspected through native msi.dll on Windows.
// A non-Windows build must not claim to have independently verified it.
func readMSIPropertyIdentity(_ string) (string, string, error) {
	return "", "", errors.New("Windows Installer MSI database reader unavailable on this platform")
}

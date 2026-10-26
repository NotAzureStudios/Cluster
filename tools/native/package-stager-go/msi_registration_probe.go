package main

import (
	"errors"
	"fmt"
	"strings"
)

// The Windows Installer API is invoked in msi_product_windows.go. Keep its
// boundary decision separate and portable so incorrect/incomplete enumeration
// cannot ever provide the one narrow fresh-install admission signal.
const (
	msiRegistrationScope = "current_user_and_machine"
	msiContextAny        = 7
	msiEnumeratedEnd     = 259  // ERROR_NO_MORE_ITEMS
	msiProductUnknown    = 1605 // ERROR_UNKNOWN_PRODUCT for filtered ProductCode
)

func classifyMSIEnumeratedProduct(code, expected string, firstCode uint32, context uint32,
	returnedCode string, nextCode uint32, infoCode uint32, reportedVersion string) (msiProductState, error) {
	unavailable := msiProductState{State: "os_query_unavailable", ProductCode: code,
		ExpectedVersion: expected, ReadOnly: true, OSAttested: false}
	if !msiProductCodePattern.MatchString(code) || !msiProductVersionPattern.MatchString(expected) {
		return unavailable, errors.New("invalid MSI product identity")
	}
	if firstCode == msiEnumeratedEnd || firstCode == msiProductUnknown {
		if context != 0 || returnedCode != "" || nextCode != 0 || infoCode != 0 || reportedVersion != "" {
			return unavailable, errors.New("MSI enumeration absence carried contradictory data")
		}
		fresh := classifyMSIProductState(code, expected, -1, "")
		fresh.ProbeScope, fresh.ProbeComplete = msiRegistrationScope, true
		return fresh, nil
	}
	if firstCode != 0 || !strings.EqualFold(returnedCode, code) ||
		(context != 1 && context != 2 && context != 4) {
		return unavailable, errors.New("MSI enumeration failed or returned inconsistent identity")
	}
	if nextCode != msiEnumeratedEnd {
		return unavailable, fmt.Errorf("MSI enumeration did not terminate unambiguously: %d", nextCode)
	}
	version := reportedVersion
	if infoCode != 0 {
		version = ""
	}
	registered := classifyMSIProductState(code, expected, 5, version)
	registered.ProbeScope, registered.ProbeComplete = msiRegistrationScope, true
	return registered, nil
}

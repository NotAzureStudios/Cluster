//go:build !windows

package main

import "errors"

func queryInstalledMSIProduct(code, expected string) (msiProductState, error) {
	return msiProductState{State: "os_query_unavailable", ProductCode: code,
		ExpectedVersion: expected, ReadOnly: true, OSAttested: false}, errors.New("Windows Installer inventory unavailable on this platform")
}

//go:build !windows

package main

import "errors"

func requireCurrentUserMSIInstallScope(string) error {
	return errors.New("Windows scope verification unavailable")
}

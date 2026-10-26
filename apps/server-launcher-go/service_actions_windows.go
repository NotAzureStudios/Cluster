//go:build windows

package main

import "fmt"

func runPlatformServiceAction(root string, service, install, remove bool) error {
	count := 0
	for _, v := range []bool{service, install, remove} {
		if v {
			count++
		}
	}
	if count != 1 {
		return fmt.Errorf("select exactly one Windows Service mode")
	}
	if service {
		return runWindowsService(root)
	}
	relaunched, err := ensureWindowsAdministrator()
	if err != nil {
		return err
	}
	if relaunched {
		return nil
	}
	if install {
		return installClusterService(root)
	}
	return removeClusterService()
}

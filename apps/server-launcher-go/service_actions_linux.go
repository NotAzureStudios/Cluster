//go:build !windows

package main

import "fmt"

func runPlatformServiceAction(root string, service, install, remove bool) error {
	return fmt.Errorf("Windows Service management is only supported on Windows")
}

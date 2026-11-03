//go:build !windows

package main

import "errors"

// Native self-updates currently require Windows SCM ownership; never attempt
// to execute a Windows PE installer or mutate Linux-managed Postgres.
func runNativeServerUpdateInstall(root,channel string)error{
 return errors.New("native signed Server installer application requires Windows Service ownership")
}

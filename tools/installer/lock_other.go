//go:build !windows
package main
func acquireInstallerLock()(func(),error){return func(){},nil}

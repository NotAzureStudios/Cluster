//go:build linux

package main

func runPlatformLauncher(options launcherOptions) error {
	return runServerHeadless(options)
}

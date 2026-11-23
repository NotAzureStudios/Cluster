//go:build linux

package main

// Linux deployments provide git on PATH.
func gitRuntimeDirectories(root string) []string { return nil }

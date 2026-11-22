//go:build linux

package main

// Linux deployments provide git on PATH.
func gitRuntimeDirectory() string { return "" }

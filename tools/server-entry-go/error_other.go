//go:build !windows
package main
import (
    "fmt"
    "os"
)
func showLaunchError(message string) { fmt.Fprintln(os.Stderr, message) }

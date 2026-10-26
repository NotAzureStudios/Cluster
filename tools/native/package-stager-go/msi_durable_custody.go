package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Sync the containing directory after publishing a receipt, replay ledger
// entry, or lock. A synced file alone does not necessarily durably commit its
// directory entry on POSIX filesystems. On Windows, os.File.Sync for an opened
// directory is not supported consistently; the atomic, file-synced protocol
// remains in place, but power-loss durability requires live Windows testing.
// An unexpected POSIX flush failure is always a fail-closed error.
func syncMSICustodyDirectory(dir string) error {
	if err := directoryNoLinks(dir); err != nil {
		return err
	}
	handle, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer handle.Close()
	if err = handle.Sync(); err != nil && runtime.GOOS != "windows" {
		return fmt.Errorf("MSI custody directory flush failed: %w", err)
	}
	return nil
}
func syncMSICustodyParent(path string) error {
	return syncMSICustodyDirectory(filepath.Dir(path))
}

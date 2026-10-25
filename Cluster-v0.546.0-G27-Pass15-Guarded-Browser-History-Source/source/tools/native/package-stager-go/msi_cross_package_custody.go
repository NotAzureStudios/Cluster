package main

// A per-package lock alone cannot prevent another signed Package key from
// replaying an MSI ProductCode. A bounded, read-only scan fences that class of
// accidental reinstall. Unrecognized or unreadable foreign evidence blocks
// execution instead of being interpreted as a clear installation history.
import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const maxMSICustodyEntries = 256

func requireNoForeignMSIAttemptForProduct(root, ownKey, productCode string) error {
	if !validPackageKey(ownKey) || !msiProductCodePattern.MatchString(productCode) {
		return errors.New("invalid MSI custody inspection identity")
	}
	dir := filepath.Join(root, "msi-attempts")
	if err := directoryNoLinks(dir); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	// Read at most a bounded number of names: an incomplete directory scan
	// cannot ever authorize execution.
	names, err := d.Readdirnames(maxMSICustodyEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	if len(names) > maxMSICustodyEntries {
		return errors.New("MSI custody directory exceeds bounded inspection; manual review required")
	}
	for _, name := range names {
		// This directory is private installer custody. No arbitrary files,
		// nested directories or incomplete atomic-write leftovers are allowed
		// to make a pre-launch scan appear clean.
		if !strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".lock") {
			return errors.New("unrecognized MSI custody evidence; manual review required")
		}
		if strings.HasSuffix(name, ".lock") {
			key := strings.TrimSuffix(name, ".lock")
			if !validPackageKey(key) || key != ownKey {
				return errors.New("another or malformed MSI operation lock exists; manual review required")
			}
			info, e := os.Lstat(filepath.Join(dir, name))
			if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return errors.New("unsafe MSI operation lock; manual review required")
			}
			continue
		}
		key := strings.TrimSuffix(name, ".json")
		if !validPackageKey(key) {
			return errors.New("invalid foreign MSI receipt identity; manual review required")
		}
		if key == ownKey {
			continue
		} // checked by the caller before this scan
		record, readErr := inspectMSIAttempt(root, key)
		if readErr != nil || !record.HasReceipt || record.Attempt == nil {
			return errors.New("foreign MSI receipt unavailable or corrupt; manual review required")
		}
		if record.Attempt.ProductCode == productCode {
			return errors.New("another Package has recorded an attempt for this MSI ProductCode; manual review required")
		}
	}
	return requireNoConflictingMSILifecycle(root, productCode)
}

package main

// A completed OS installer process does not erase a repair or uninstall
// journal. The original successful install receipt may still be readable,
// so dependent admission must consult BOTH stores. No automatic clearance.
import (
	"errors"
	"os"
	"path/filepath"
)

func requireNoPriorMSILifecycle(root, key string) error {
	if !validPackageKey(key) || root == "" {
		return errors.New("invalid lifecycle identity")
	}
	dir := filepath.Join(root, "msi-lifecycle")
	if _, e := os.Lstat(dir); os.IsNotExist(e) {
		return nil
	} else if e != nil {
		return e
	}
	if e := directoryNoLinks(dir); e != nil {
		return e
	}
	// An upgrade record and a rollback record are independent, durable holds.
	// Neither may be bypassed after the original installation receipt survives.
	for _, name := range []string{key + ".json", "rollback_" + key + ".json"} {
		if _, e := os.Lstat(filepath.Join(dir, name)); e == nil {
			return errors.New("Package has a prior MSI lifecycle operation requiring manual review")
		} else if !os.IsNotExist(e) {
			return e
		}
	}
	return nil
}

// A lifecycle journal can survive without its original install receipt. A
// fresh Package using the same ProductCode must not mistake that history for
// an unclaimed product. Any malformed journal blocks the whole admission.
func requireNoConflictingMSILifecycle(root, productCode string) error {
	if !msiProductCodePattern.MatchString(productCode) {
		return errors.New("invalid MSI lifecycle ProductCode")
	}
	_, names, _, err := collectMSILifecycleSnapshot(root)
	if err != nil {
		return err
	}
	records, err := readMSILifecycleInventory(root, names)
	if err != nil {
		return err
	}
	for _, rec := range records {
		if rec.Receipt != nil && rec.Receipt.ProductCode == productCode {
			return errors.New("prior MSI lifecycle journal owns MSI ProductCode; manual review required")
		}
	}
	return nil
}

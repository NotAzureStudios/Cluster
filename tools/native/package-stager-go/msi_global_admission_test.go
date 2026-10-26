package main

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
)

// Two different signed Package keys have one profile-local install admission
// decision. Neither can pass the custody scan concurrently with the other.
func TestMSIGlobalAdmissionLockConcurrentDifferentPackages(t *testing.T) {
	root := t.TempDir()
	const contenders = 24
	start := make(chan struct{})
	release := make(chan struct{})
	var acquired atomic.Int32
	var rejected atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < contenders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			unlock, err := acquireMSIInstallLock(root, "msi-admission")
			if err != nil {
				rejected.Add(1)
				return
			}
			acquired.Add(1)
			<-release
			unlock()
		}()
	}
	close(start)
	// Wait until everyone either wins or receives the lock rejection.
	// Winner is deliberately held for the entire contender phase.
	for rejected.Load()+acquired.Load() < contenders { // bounded by Go test timeout
		// Scheduling is intentionally unrestricted; no clock ordering relied upon.
		runtime.Gosched()
	}
	close(release)
	wg.Wait()
	if acquired.Load() != 1 || rejected.Load() != contenders-1 {
		t.Fatalf("nonexclusive MSI global admission: acquired=%d rejected=%d", acquired.Load(), rejected.Load())
	}
	if _, err := os.Lstat(filepath.Join(root, "msi-admission.lock")); !os.IsNotExist(err) {
		t.Fatalf("global lock not released: %v", err)
	}
}

func TestMSIAdmissionOrphanLockVisibleAcrossPackageKeys(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "msi-admission.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"alpha-package", "beta-package"} {
		record, err := inspectMSIAttempt(root, key)
		if err != nil || !record.LockPresent || record.HasReceipt || !record.ManualReviewRequired ||
			record.State != "interrupted_or_active_without_receipt" || record.RetryAuthorized || !record.ReadOnly {
			t.Fatalf("orphaned admission not visible for %s: %+v %v", key, record, err)
		}
	}
	if _, err := acquireMSIInstallLock(root, "msi-admission"); err == nil {
		t.Fatal("orphaned admission lock was auto-stolen")
	}
	if err := os.Mkdir(filepath.Join(root, "msi-attempts"), 0700); err != nil {
		t.Fatal(err)
	}
	record, err := inspectMSIAttempt(root, "another-package")
	if err != nil || !record.LockPresent || !record.ManualReviewRequired {
		t.Fatalf("missing receipt and orphaned lock: %+v %v", record, err)
	}
}

func TestMSIAdmissionUnsafeLockFailsClosed(t *testing.T) {
	root := t.TempDir()
	lock := filepath.Join(root, "msi-admission.lock")
	if err := os.WriteFile(lock, []byte("tamper"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectMSIAttempt(root, "alpha-package"); err == nil {
		t.Fatal("regular-file admission lock accepted")
	}
	if _, err := acquireMSIInstallLock(root, "msi-admission"); err == nil {
		t.Fatal("tampered admission lock overwritten")
	}
}

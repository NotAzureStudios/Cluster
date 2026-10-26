package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMSILockReleaseKeepsReplacedOperation(t *testing.T) {
	root := t.TempDir()
	key := "release-package"
	unlock, err := acquireMSIInstallLock(root, key)
	if err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, "detached-original")
	lock := filepath.Join(root, key+".lock")
	if err := os.Rename(lock, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(lock, 0700); err != nil {
		t.Fatal(err)
	}
	unlock()
	if _, err := os.Stat(lock); err != nil {
		t.Fatal("lost another operation lock", err)
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("unexpected deletion of detached original", err)
	}
	if _, err := acquireMSIInstallLock(root, key); err == nil {
		t.Fatal("replaced lock bypassed")
	}
}

func TestMSILockReleaseOnlyOwnedEmptyDirectory(t *testing.T) {
	root := t.TempDir()
	key := "package-foo"
	unlock, err := acquireMSIInstallLock(root, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireMSIInstallLock(root, key); err == nil {
		t.Fatal("concurrent lock permitted")
	}
	unlock()
	if _, err := os.Lstat(filepath.Join(root, key+".lock")); !os.IsNotExist(err) {
		t.Fatal("original MSI lock was not released")
	}
	unlock, err = acquireMSIInstallLock(root, key)
	if err != nil {
		t.Fatal(err)
	}
	lock := filepath.Join(root, key+".lock")
	if err := os.WriteFile(filepath.Join(lock, "review.txt"), []byte("review"), 0600); err != nil {
		t.Fatal(err)
	}
	unlock()
	if _, err := os.Lstat(lock); err != nil {
		t.Fatal("non-empty MSI lock should require review")
	}
}

func TestMSILockRejectsUnknownIdentityOrUntrustedParent(t *testing.T) {
	root := t.TempDir()
	if _, err := acquireMSIInstallLock(root, "../escape"); err == nil {
		t.Fatal("unsafe Package key accepted")
	}
	target := filepath.Join(root, "real")
	os.Mkdir(target, 0700)
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(target, alias); err == nil {
		if _, err := acquireMSIInstallLock(alias, "package-foo"); err == nil {
			t.Fatal("MSI lock in symlinked directory accepted")
		}
	}
}

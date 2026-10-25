package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCopyMissingVerifiedFilesAndPreserveConflicts(t *testing.T) {
	o, _ := fixture(t, "presets/studio.ini", []byte("version=2"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	r, err := applyMissingManagedFiles(o, target)
	if err != nil || r.Added != 1 || r.Executed || r.State != "destination_matches_managed_files_not_executed" {
		t.Fatalf("copy: %+v %v", r, err)
	}
	data, err := os.ReadFile(filepath.Join(target, "presets", "studio.ini"))
	if err != nil || string(data) != "version=2" {
		t.Fatalf("wrong copy: %s %v", data, err)
	}
	r, err = applyMissingManagedFiles(o, target)
	if err != nil || r.Added != 0 || r.Unchanged != 1 {
		t.Fatalf("non-idempotent copy: %+v %v", r, err)
	}
	if err := os.WriteFile(filepath.Join(target, "presets", "studio.ini"), []byte("custom"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := applyMissingManagedFiles(o, target); err == nil {
		t.Fatal("overwrote local modification")
	}
	data, _ = os.ReadFile(filepath.Join(target, "presets", "studio.ini"))
	if string(data) != "custom" {
		t.Fatal("lost local content")
	}
}
func TestCopyMissingRefusesUnsafeDestination(t *testing.T) {
	o, _ := fixture(t, "settings/tool.cfg", []byte("safe"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	if _, err := applyMissingManagedFiles(o, filepath.Join(target, "does-not-exist")); err == nil {
		t.Fatal("created unapproved root")
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(target, "settings")); err == nil {
		if _, err := applyMissingManagedFiles(o, target); err == nil {
			t.Fatal("followed symlink")
		}
	}
}

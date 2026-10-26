package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFileUpdatePreviewDistinguishesMissingCurrentAndChanged(t *testing.T) {
	o, _ := fixture(t, "presets/studio.txt", []byte("approved content"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	check := func(expect string) {
		t.Helper()
		view, err := compareManagedDestination(o, dest)
		if err != nil {
			t.Fatal(err)
		}
		if !view.ReadOnly || len(view.Entries) != 1 || view.Entries[0].State != expect {
			t.Fatalf("incorrect preview %+v", view)
		}
	}
	check("missing")
	if _, err := os.Stat(filepath.Join(dest, "presets")); !os.IsNotExist(err) {
		t.Fatal("preview created destination directories")
	}
	if err := os.Mkdir(filepath.Join(dest, "presets"), 0700); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dest, "presets", "studio.txt")
	if err := os.WriteFile(p, []byte("approved content"), 0600); err != nil {
		t.Fatal(err)
	}
	check("current")
	if err := os.WriteFile(p, []byte("locally modified"), 0600); err != nil {
		t.Fatal(err)
	}
	check("different")
	b, err := os.ReadFile(p)
	if err != nil || string(b) != "locally modified" {
		t.Fatal("preview overwrote local edits")
	}
}
func TestFileUpdatePreviewRefusesUnsafeDestinationsAndUnmanagedReleases(t *testing.T) {
	o, _ := fixture(t, "files/asset.txt", []byte("safe"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := compareManagedDestination(o, t.TempDir()); err == nil {
		t.Fatal("unstaged-to-managed release accepted")
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", time.Now()), "deploy", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := compareManagedDestination(o, o.Root); err == nil {
		t.Fatal("private root overlap accepted")
	}
	if _, err := compareManagedDestination(o, filepath.Dir(o.Root)); err == nil {
		t.Fatal("parent overlap accepted")
	}
	dest := t.TempDir()
	if err := os.Symlink(t.TempDir(), filepath.Join(dest, "files")); err == nil {
		if _, err := compareManagedDestination(o, dest); err == nil {
			t.Fatal("symlink parent accepted")
		}
	}
	fresh := t.TempDir()
	o.Grant = "bogus"
	if _, err := compareManagedDestination(o, fresh); err == nil {
		t.Fatal("grant material accepted in preview")
	}
	o.Grant = ""
	o.ExpectedVersion = "999.0.0"
	if _, err := compareManagedDestination(o, fresh); err == nil {
		t.Fatal("wrong target accepted")
	}
	o.ExpectedVersion = ""
	if _, err := compareManagedDestination(o, filepath.Join(fresh, "absent")); err == nil {
		t.Fatal("absent target accepted")
	}
	if _, err := compareManagedDestination(o, strings.TrimSuffix(fresh, "/")+"/../"+filepath.Base(fresh)); err != nil {
		t.Fatal(err)
	}
}

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Runtime contract: signed release, stage and actual managed bytes must agree.
// A JSON pointer alone is not evidence that the copy is healthy.
func TestAuditManagedCurrentAndPreviousWithoutMutations(t *testing.T) {
	now := time.Now()
	old, _ := fixtureVersion(t, "assets/content.txt", []byte("previous"), "1.0.0")
	next, _ := fixtureVersion(t, "assets/content.txt", []byte("current"), "2.0.0")
	next.Root = old.Root
	for _, o := range []options{old, next} {
		if _, err := stage(o); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := auditManagedContent(old); err == nil {
		t.Fatal("unmanaged stage appeared deployed")
	}
	if _, err := deployManagedContent(grantFixture(t, old, "deploy", now), "deploy", now); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, next, "deploy", now), "deploy", now); err != nil {
		t.Fatal(err)
	}
	stateBefore, err := managedStatus(old.Root, "test-package")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		o    options
		slot string
	}{{next, "active"}, {old, "previous"}} {
		audit, err := auditManagedContent(item.o)
		if err != nil {
			t.Fatal(err)
		}
		if audit.Schema != 1 || audit.Slot != item.slot || audit.Generation != 2 || audit.State != "verified_managed_content_not_executed" || audit.OSAttested || audit.Executed {
			t.Fatalf("unsafe audit claim: %+v", audit)
		}
	}
	after, err := managedStatus(old.Root, "test-package")
	if err != nil || after.Generation != stateBefore.Generation || after.Active != stateBefore.Active || *after.Previous != *stateBefore.Previous {
		t.Fatalf("audit changed selected content: %+v %v", after, err)
	}
}

func TestAuditManagedRejectsMissingTamperedOrUnexpectedFiles(t *testing.T) {
	now := time.Now()
	for _, mutation := range []string{"tamper", "missing", "extra", "symlink", "stage-tamper"} {
		t.Run(mutation, func(t *testing.T) {
			o, _ := fixture(t, "assets/content.txt", []byte("original"))
			if _, err := stage(o); err != nil {
				t.Fatal(err)
			}
			if _, err := deployManagedContent(grantFixture(t, o, "deploy", now), "deploy", now); err != nil {
				t.Fatal(err)
			}
			m, _, _, err := verifyInput(o)
			if err != nil {
				t.Fatal(err)
			}
			base := filepath.Join(o.Root, "managed", m.PackageKey, m.ArtifactSha256)
			content := filepath.Join(base, "assets", "content.txt")
			switch mutation {
			case "tamper":
				err = os.WriteFile(content, []byte("changed!"), 0600)
			case "missing":
				err = os.Remove(content)
			case "extra":
				err = os.WriteFile(filepath.Join(base, "unexpected.txt"), []byte("foreign"), 0600)
			case "symlink":
				err = os.Remove(content)
				if err == nil {
					err = os.Symlink(filepath.Join(t.TempDir(), "other"), content)
				}
				if err != nil {
					t.Skip("symlink unavailable")
				}
			case "stage-tamper":
				err = os.WriteFile(filepath.Join(o.Root, "staged", m.ArtifactSha256, "assets", "content.txt"), []byte("modified"), 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := auditManagedContent(o); err == nil {
				t.Fatal("tampered managed content falsely audited")
			}
		})
	}
}

func TestAuditManagedRejectsWrongTargetAndAuthorizationMaterial(t *testing.T) {
	now := time.Now()
	o, _ := fixture(t, "assets/content.txt", []byte("original"))
	if _, err := stage(o); err != nil {
		t.Fatal(err)
	}
	if _, err := deployManagedContent(grantFixture(t, o, "deploy", now), "deploy", now); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		edit func(*options)
	}{
		{"wrong-content-pin", func(o *options) { o.TrustedKeySha256 = strings.Repeat("a", 64) }},
		{"wrong-selected-digest", func(o *options) { o.ExpectedArtifactSha256 = strings.Repeat("b", 64) }},
		{"wrong-selected-package", func(o *options) { o.ExpectedPackageKey = "different-package" }},
		{"wrong-selected-version", func(o *options) { o.ExpectedVersion = "9.9.9" }},
		{"deployment-grant-refused", func(o *options) { o.Grant = "untrusted" }},
		{"control-pin-refused", func(o *options) { o.TrustedControlKeySha256 = strings.Repeat("c", 64) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attempt := o
			tt.edit(&attempt)
			if _, err := auditManagedContent(attempt); err == nil {
				t.Fatal("unauthorized or mismatched audit accepted")
			}
		})
	}
	other, _ := fixtureVersion(t, "assets/other.txt", []byte("not selected"), "3.0.0")
	other.Root = o.Root
	if _, err := stage(other); err != nil {
		t.Fatal(err)
	}
	if _, err := auditManagedContent(other); err == nil {
		t.Fatal("unselected release passed managed audit")
	}
}

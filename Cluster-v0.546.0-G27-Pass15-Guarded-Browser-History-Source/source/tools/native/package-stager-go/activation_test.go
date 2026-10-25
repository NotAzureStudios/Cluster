package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestActivationAndSignedRollback(t *testing.T) {
	a, _ := fixtureVersion(t, "payload/file.txt", []byte("first"), "1.0.0")
	b, _ := fixtureVersion(t, "payload/file.txt", []byte("second"), "2.0.0")
	b.Root = a.Root
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(b); err != nil {
		t.Fatal(err)
	}
	first, err := selectContent(a, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.Generation != 1 || first.Active.Version != "1.0.0" || first.Previous != nil {
		t.Fatalf("wrong first pointer: %+v", first)
	}
	latest, err := selectContent(b, false)
	if err != nil {
		t.Fatal(err)
	}
	if latest.Generation != 2 || latest.Active.Version != "2.0.0" || latest.Previous == nil || *latest.Previous != first.Active {
		t.Fatalf("wrong selection: %+v", latest)
	}
	state, err := selectionStatus(a.Root, "test-package")
	if err != nil {
		t.Fatal(err)
	}
	if state.Generation != 2 || state.Active != latest.Active {
		t.Fatal("status differs from selected pointer")
	}
	if _, err := selectContent(a, false); err != nil {
		t.Fatal("explicit previous selection should work as an activation")
	}
	// The previous selection is now version 2; rollback requires exactly that signed artifact.
	rolled, err := selectContent(b, true)
	if err != nil {
		t.Fatal(err)
	}
	if rolled.Generation != 4 || rolled.Active.Version != "2.0.0" || rolled.Previous == nil || rolled.Previous.Version != "1.0.0" {
		t.Fatalf("rollback failed: %+v", rolled)
	}
	if _, err := selectContent(a, true); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, true); err == nil {
		t.Fatal("rollback without matching previous accepted")
	}
}
func TestActivationRequiresVerifiedStage(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("content"))
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("unstaged signed release selected")
	}
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("same release activated twice")
	}
}
func TestActivationRejectsMutatedStagedBytes(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("original"))
	stageDir, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "payload", "file.txt"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("modified staged bytes accepted")
	}
}
func TestActivationRejectsAdditionalStageFiles(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("original"))
	stageDir, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "payload", "payload.dll"), []byte("unauthorized"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("extra staged file accepted")
	}
}
func TestActivationRejectsStageEvidenceTampering(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("original"))
	stageDir, err := stage(a)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, ".cluster-package-stage.json"), []byte(`{"schema":1,"state":"installed"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("forged evidence accepted")
	}
}
func TestFailedActivationDoesNotOverwriteCurrent(t *testing.T) {
	a, _ := fixtureVersion(t, "payload/file.txt", []byte("good"), "1.0.0")
	b, _ := fixtureVersion(t, "payload/file.txt", []byte("bad"), "2.0.0")
	b.Root = a.Root
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(b); err != nil {
		t.Fatal(err)
	}
	first, err := selectContent(a, false)
	if err != nil {
		t.Fatal(err)
	}
	var m manifest
	data, _ := os.ReadFile(b.Manifest)
	_ = json.Unmarshal(data, &m)
	if err := os.WriteFile(filepath.Join(b.Root, "staged", m.ArtifactSha256, "payload", "file.txt"), []byte("not the signed file"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(b, false); err == nil {
		t.Fatal("tampered activation succeeded")
	}
	after, err := selectionStatus(a.Root, "test-package")
	if err != nil {
		t.Fatal(err)
	}
	if after.Generation != first.Generation || after.Active != first.Active {
		t.Fatal("failed operation changed pointer")
	}
}
func TestActivationLockDeniesConcurrentAndFailsClosed(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("content"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(a.Root, "active", "test-package.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("concurrent lock ignored")
	}
	if err := os.Remove(filepath.Join(a.Root, "active", "test-package.lock")); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err != nil {
		t.Fatal(err)
	}
}
func TestPointerSymlinkRefused(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("content"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(a.Root, "active"), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(a.Root, "active", "test-package.json")
	if err := os.Symlink(filepath.Join(t.TempDir(), "victim.json"), path); err != nil {
		t.Skip("symlinks unavailable")
	}
	if _, err := selectContent(a, false); err == nil {
		t.Fatal("symlink pointer accepted")
	}
}
func TestInvalidStatusAndPackageKey(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("content"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../escape", "ABC", "a", "anything/else", strings.Repeat("a", 81)} {
		if _, err := selectionStatus(a.Root, key); err == nil {
			t.Errorf("unsafe key accepted: %q", key)
		}
	}
}
func TestManifestUnknownFieldsRejected(t *testing.T) {
	a, _ := fixture(t, "payload/file.txt", []byte("content"))
	content, err := os.ReadFile(a.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	trimmed := strings.TrimSuffix(string(content), "}") + `,"injected":true}`
	if err := os.WriteFile(a.Manifest, []byte(trimmed), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(a); err == nil {
		t.Fatal("unknown unsigned manifest fields accepted")
	}
}
func TestUnsignedRollbackImpossible(t *testing.T) {
	a, _ := fixtureVersion(t, "payload/file.txt", []byte("first"), "1.0.0")
	b, _ := fixtureVersion(t, "payload/file.txt", []byte("second"), "2.0.0")
	b.Root = a.Root
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(b); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(a, false); err != nil {
		t.Fatal(err)
	}
	if _, err := selectContent(b, false); err != nil {
		t.Fatal(err)
	}
	b.TrustedKeySha256 = strings.Repeat("0", 64)
	if _, err := selectContent(b, true); err == nil {
		t.Fatal("mismatched key rollback succeeded")
	}
	if _, err := selectContent(a, true); err != nil {
		t.Fatal(err)
	}
}

func TestNoSelectionDoesNotReportActiveStatus(t *testing.T) {
	a, _ := fixture(t, "payload/README.txt", []byte("staged only"))
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(a.Root, "active"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := selectionStatus(a.Root, "test-package"); err == nil {
		t.Fatal("unstaged activation falsely claimed active")
	}
}

func TestAuditSelectedContentFailClosed(t *testing.T) {
	a, _ := fixtureVersion(t, "assets/kit.txt", []byte("original"), "1.0.0")
	b, _ := fixtureVersion(t, "assets/kit.txt", []byte("updated"), "2.0.0")
	b.Root = a.Root
	if _, err := stage(a); err != nil {
		t.Fatal(err)
	}
	if _, err := stage(b); err != nil {
		t.Fatal(err)
	}
	if _, err := auditSelectedContent(a); err == nil {
		t.Fatal("unselected stage reported as selected")
	}
	if _, err := selectContent(a, false); err != nil {
		t.Fatal(err)
	}
	first, err := auditSelectedContent(a)
	if err != nil || first.Slot != "active" || first.State != "verified_selected_content_not_installed" || first.OSAttested {
		t.Fatalf("unsafe audit %+v %v", first, err)
	}
	if _, err := selectContent(b, false); err != nil {
		t.Fatal(err)
	}
	previous, err := auditSelectedContent(a)
	if err != nil || previous.Slot != "previous" || previous.Generation != 2 {
		t.Fatalf("bad previous audit %+v %v", previous, err)
	}
	// Changing file bytes must invalidate diagnostics even when the local pointer
	// and archived evidence still claim the selected release.
	data, _ := os.ReadFile(a.Manifest)
	var signed manifest
	if err := json.Unmarshal(data, &signed); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(a.Root, "staged", signed.ArtifactSha256, "assets", "kit.txt")
	if err := os.WriteFile(target, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := auditSelectedContent(a); err == nil {
		t.Fatal("tampered content passed audit")
	}
	fresh, err := auditSelectedContent(b)
	if err != nil || fresh.Slot != "active" {
		t.Fatalf("active content broken %+v %v", fresh, err)
	}
	b.TrustedKeySha256 = strings.Repeat("0", 64)
	if _, err := auditSelectedContent(b); err == nil {
		t.Fatal("wrong trust pin passed audit")
	}
}

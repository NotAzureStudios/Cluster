package main

import (
	"encoding/hex"
    "encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPortableDirectoryStaysBesideInstallerAndProtectsExistingServer(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "Cluster-Server", "Cluster-Installer.exe")
	got := managedDirectory(exe)
	want := filepath.Join(filepath.Dir(exe), "Cluster")
	if got != want || got == filepath.Dir(exe) {
		t.Fatalf("got %s want %s", got, want)
	}
}
func TestMarkerNeedsOwnership(t *testing.T) {
	p := filepath.Join(t.TempDir(), "marker")
	_ = os.WriteFile(p, []byte(`{"testOnly":true,"archiveSha256":"`+hex.EncodeToString(make([]byte, 32))+`"}`), 0600)
	if _, _, ok := readMarker(p); ok {
		t.Fatal("legacy test marker accepted")
	}
	_ = os.WriteFile(p, []byte(`{"managedBy":"cluster-installer","archiveSha256":"`+hex.EncodeToString(make([]byte, 32))+`","appliedUtc":"2026-10-26T06:00:00Z"}`), 0600)
	if _, _, ok := readMarker(p); !ok {
		t.Fatal("owned installer marker rejected")
	}
}
func TestEmbeddedRevisionSelection(t *testing.T) {
	if !chooseEmbeddedRevision("old", "new", 0, 1) {
		t.Fatal("RC1 must upgrade a legacy managed install without relying on its files")
	}
	if !chooseEmbeddedRevision("rc1", "rc2", 1, 2) {
		t.Fatal("later RC installer must upgrade")
	}
	if chooseEmbeddedRevision("rc2", "rc1", 2, 1) {
		t.Fatal("older installer must not downgrade")
	}
	if chooseEmbeddedRevision("same", "same", 0, 1) {
		t.Fatal("same revision must start rather than rebuild")
	}
}
func TestEmbeddedReleaseIdentity(t *testing.T) {
	data, err := payload.ReadFile("assets/bundled-source.zip")
	if err != nil {
		t.Fatal(err)
	}
	info, err := embeddedReleaseInfo(data)
	if err != nil {
		t.Fatal(err)
	}
	expectedBytes, err := os.ReadFile(filepath.Join("..", "..", "config", "release-candidate.json"))
    if err != nil { t.Fatal(err) }
    var expected releaseIdentity
    if err := json.Unmarshal(expectedBytes, &expected); err != nil { t.Fatal(err) }
    if info != expected {
        t.Fatalf("embedded identity %+v did not match source release metadata %+v", info, expected)
    }
}

func TestLegacyUTF8BOMInstallerMarker(t *testing.T) {
    p := filepath.Join(t.TempDir(), "marker.json")
    marker := []byte(`{"managedBy":"cluster-installer","archiveSha256":"`+hex.EncodeToString(make([]byte,32))+`","releaseSequence":8,"releaseCandidate":"1.0.0-rc.8","appliedUtc":"2026-10-26T06:00:00Z"}`)
    err := os.WriteFile(p, append([]byte{0xef,0xbb,0xbf},marker...),0600)
    if err != nil { t.Fatal(err) }
    if _,_,ok := readMarker(p); !ok { t.Fatal("legacy BOM marker must not force a rebuild") }
    seq, version := readManagedSequence(p)
    if seq != 8 || version != "1.0.0-rc.8" { t.Fatalf("unexpected identity %d %s",seq,version) }
}

func TestSupervisedUpgradeNoLaunchRequiresNewerManagedRelease(t *testing.T) {
 cases:=[]struct{name string;managed bool;old,new string;oldSeq,newSeq int;want bool}{
  {"real in-place upgrade",true,"previous-hash","next-hash",52,53,true},
  {"fresh install",false,"","next-hash",0,53,false},
  {"same version replay",true,"old","next",53,53,false},
  {"older release",true,"old","next",54,53,false},
  {"same payload",true,"same","same",52,53,false},
 }
 for _,test:=range cases{
  t.Run(test.name,func(t *testing.T){
   got:=supervisedInstallerUpgradeAllowed(test.managed,test.old,test.new,test.oldSeq,test.newSeq)
   if got!=test.want{t.Fatalf("supervised update allowed=%v; want %v",got,test.want)}
  })
 }
}

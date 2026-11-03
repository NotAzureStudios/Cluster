package main

import (
 "crypto/sha256"
 "encoding/hex"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestOfflineInstallerHandoffUsesOriginalPortableParent(t *testing.T) {
 fixture:=makeStagedFixture(t)
 candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
 if err!=nil {t.Fatal(err)}
 target,err:=prepareOfflineServerInstaller(fixture.root,candidate)
 if err!=nil {t.Fatal(err)}
 if filepath.Dir(target)!=filepath.Dir(fixture.root) {t.Fatalf("installer would target a nested Cluster: %s",target)}
 if !strings.HasPrefix(filepath.Base(target),"Cluster-Update-53-"){t.Fatalf("unexpected handoff name: %s",target)}
 if _,err:=os.Stat(filepath.Join(filepath.Dir(fixture.root),"Cluster-Installer.exe"));!os.IsNotExist(err){
  t.Fatal("handoff must not replace the operator's existing Cluster-Installer.exe")
 }
 bytes,err:=os.ReadFile(target)
 if err!=nil{t.Fatal(err)}
 digest:=sha256.Sum256(bytes)
 if len(bytes)!=int(candidate.Size) || hex.EncodeToString(digest[:])!=candidate.SHA256{
  t.Fatal("copied installer bytes do not match publisher-signed artifact")
 }
 if _,err:=prepareOfflineServerInstaller(fixture.root,candidate);err==nil{
  t.Fatal("repeat handoff overwrote existing file")
 }
}

func TestOfflineInstallerHandoffFailsClosedOnCorruptionAndUntrustedPaths(t *testing.T){
 t.Run("hash mismatch leaves no copied installer",func(t *testing.T){
  fixture:=makeStagedFixture(t)
  candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
  if err!=nil{t.Fatal(err)}
  file,err:=os.OpenFile(fixture.installer,os.O_WRONLY,0600)
  if err!=nil{t.Fatal(err)}
  if _,err:=file.WriteAt([]byte("XX"),2);err!=nil{t.Fatal(err)}
  file.Close()
  if _,err:=prepareOfflineServerInstaller(fixture.root,candidate);err==nil{t.Fatal("tampered installer was copied")}
  target:=filepath.Join(filepath.Dir(fixture.root),"Cluster-Update-53-"+candidate.SHA256[:12]+".exe")
  if _,err:=os.Stat(target);!os.IsNotExist(err){t.Fatalf("untrusted handoff remains: %v",err)}
 })
 t.Run("source outside staging rejected",func(t *testing.T){
  fixture:=makeStagedFixture(t)
  candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
  if err!=nil{t.Fatal(err)}
  candidate.InstallerPath=filepath.Join(filepath.Dir(fixture.root),"random.exe")
  if _,err:=prepareOfflineServerInstaller(fixture.root,candidate);err==nil{t.Fatal("arbitrary executable path allowed")}
 })
 t.Run("unmanaged installation rejected",func(t *testing.T){
  fixture:=makeStagedFixture(t)
  candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
  if err!=nil{t.Fatal(err)}
  if err:=os.Remove(filepath.Join(fixture.root,".cluster-installer-managed.json"));err!=nil{t.Fatal(err)}
  if _,err:=prepareOfflineServerInstaller(fixture.root,candidate);err==nil{t.Fatal("unmanaged installation accepted")}
 })
 t.Run("existing handoff collision preserved",func(t *testing.T){
  fixture:=makeStagedFixture(t)
  candidate,err:=inspectStagedServerUpdateWithKey(fixture.root,"main",fixture.publisher)
  if err!=nil{t.Fatal(err)}
  target:=filepath.Join(filepath.Dir(fixture.root),"Cluster-Update-53-"+candidate.SHA256[:12]+".exe")
  original:=[]byte("user owned file; do not overwrite")
  if err:=os.WriteFile(target,original,0600);err!=nil{t.Fatal(err)}
  if _,err:=prepareOfflineServerInstaller(fixture.root,candidate);err==nil{t.Fatal("existing file overwritten")}
  actual,err:=os.ReadFile(target)
  if err!=nil || string(actual)!=string(original){t.Fatalf("existing handoff changed: %v",err)}
 })
}

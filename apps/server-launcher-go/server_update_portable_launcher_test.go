package main

import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
)
func writeManagedPortableLauncher(t *testing.T,root string,payload string){
 t.Helper()
 launcher,manifest:=serverPortableLauncherPaths(root)
 if err:=os.WriteFile(launcher,[]byte(payload),0600);err!=nil{t.Fatal(err)}
 sum:=sha256.Sum256([]byte(payload))
 owner:=portableServerLauncherOwner{Schema:1,ManagedBy:"cluster-installer",
  InstallRoot:filepath.Dir(root),LauncherPath:launcher,SHA256:hex.EncodeToString(sum[:])}
 raw,err:=json.Marshal(owner)
 if err!=nil{t.Fatal(err)}
 if err=os.WriteFile(manifest,raw,0600);err!=nil{t.Fatal(err)}
}
func TestRestorePriorPortableServerLauncherAfterFailedCandidate(t *testing.T){
 root,id:=appRollbackFixture(t)
 old:="MZ prior portable Server build"
 newServer:="MZ changed signed candidate Server"
 native:=filepath.Join(root,"bin","Cluster Server.exe")
 if err:=os.WriteFile(native,[]byte(old),0600);err!=nil{t.Fatal(err)}
 writeManagedPortableLauncher(t,root,old)
 if err:=capturePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 snapshot:=filepath.Join(filepath.Dir(root),"UpdateRecovery",id,"previous-root-launcher.manifest.json")
 if _,err:=os.Stat(snapshot);err!=nil{t.Fatalf("portable launcher baseline was not retained: %v",err)}
 if err:=os.WriteFile(native,[]byte(newServer),0600);err!=nil{t.Fatal(err)}
 writeManagedPortableLauncher(t,root,newServer)
 if err:=os.WriteFile(native,[]byte(old),0600);err!=nil{t.Fatal(err)}
 if before,err:=os.ReadFile(native);err!=nil||string(before)!=old{t.Fatalf("source app binary not restored before shortcut restore: %q %v",before,err)}
 if err:=restorePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 launcher,_:=serverPortableLauncherPaths(root)
 got,err:=os.ReadFile(launcher)
 if err!=nil||string(got)!=old{
  qPath:=filepath.Join(filepath.Dir(root),"UpdateRecovery",id,"failed-root-launcher.exe")
  q,qErr:=os.ReadFile(qPath)
  t.Fatalf("prior launcher was not restored: %q %v; quarantine=%q err=%v; snapshot=%s",got,err,q,qErr,snapshot)
 }
 previous,err:=os.ReadFile(filepath.Join(filepath.Dir(root),"UpdateRecovery",id,"failed-root-launcher.exe"))
 if err!=nil||string(previous)!=newServer{t.Fatalf("failed candidate shortcut was lost: %q %v",previous,err)}
 if _,err:=inspectPortableServerLauncher(root);err!=nil{t.Fatalf("restored ownership mismatch: %v",err)}
}
func TestPortableLauncherRecoveryDoesNotReplaceUnmanagedShortcut(t *testing.T){
 root,id:=appRollbackFixture(t)
 old:="MZ safe previous"
 native:=filepath.Join(root,"bin","Cluster Server.exe")
 if err:=os.WriteFile(native,[]byte(old),0600);err!=nil{t.Fatal(err)}
 writeManagedPortableLauncher(t,root,old)
 if err:=capturePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 launcher,manifest:=serverPortableLauncherPaths(root)
 if err:=os.WriteFile(launcher,[]byte("MZ untrusted external edit"),0600);err!=nil{t.Fatal(err)}
 if err:=restorePreviousPortableServerLauncher(root,id);err==nil{t.Fatal("externally changed launcher overwritten")}
 got,err:=os.ReadFile(launcher)
 if err!=nil||!strings.Contains(string(got),"untrusted"){t.Fatal("externally modified portable executable was changed")}
 if err:=os.Remove(manifest);err!=nil{t.Fatal(err)}
 if err:=restorePreviousPortableServerLauncher(root,id);err==nil{t.Fatal("unowned shortcut replaced")}
}
func TestPortableLauncherSnapshotRequiresExactInstalledBinary(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=os.WriteFile(filepath.Join(root,"bin","Cluster Server.exe"),[]byte("MZ native version"),0600);err!=nil{t.Fatal(err)}
 writeManagedPortableLauncher(t,root,"MZ root version differs")
 if err:=capturePreviousPortableServerLauncher(root,id);err==nil{t.Fatal("root/native executable drift was accepted")}
}

func TestRollbackRemovesOnlyInstallerOwnedRootLauncherCreatedDuringUpdate(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=capturePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 recovered:=filepath.Join(filepath.Dir(root),"UpdateRecovery",id)
 absence,err:=os.ReadFile(filepath.Join(recovered,"previous-root-launcher.absent"))
 if err!=nil||!strings.Contains(string(absence),"absent-v1"){t.Fatal("root shortcut absence evidence missing")}
 writeManagedPortableLauncher(t,root,"MZ installer created portable Server")
 if err:=restorePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 launcher,manifest:=serverPortableLauncherPaths(root)
 if _,err:=os.Lstat(launcher);!os.IsNotExist(err){t.Fatalf("newly generated shortcut still published: %v",err)}
 if _,err:=os.Lstat(manifest);!os.IsNotExist(err){t.Fatalf("newly generated manifest still published: %v",err)}
 if _,err:=os.Stat(filepath.Join(recovered,"failed-root-launcher.exe"));err!=nil{t.Fatalf("candidate shortcut was not quarantined: %v",err)}
}
func TestRollbackDoesNotQuarantineExternallyOwnedShortcutWhenOriginalWasAbsent(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=capturePreviousPortableServerLauncher(root,id);err!=nil{t.Fatal(err)}
 launcher,_:=serverPortableLauncherPaths(root)
 if err:=os.WriteFile(launcher,[]byte("MZ manual shortcut"),0600);err!=nil{t.Fatal(err)}
 if err:=restorePreviousPortableServerLauncher(root,id);err==nil{t.Fatal("unowned newly introduced launcher was quarantined")}
 if contents,err:=os.ReadFile(launcher);err!=nil||string(contents)!="MZ manual shortcut"{
  t.Fatal("externally owned shortcut was changed")
 }
}

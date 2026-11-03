package main

import (
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func appRollbackFixture(t *testing.T)(string,string){
 t.Helper()
 root:=testHoldRoot(t)
 id:="dc5140cf-6382-4d16-975e-8d3dcb878241"
 for _,name:=range []string{"bin","data/system/config"}{
  if err:=os.MkdirAll(filepath.Join(root,name),0700);err!=nil{t.Fatal(err)}
 }
 for name,contents:=range map[string]string{
  "CLUSTER_RELEASE.json":`{"schema":1,"managedInstaller":true,"releaseChannel":"stable","releaseCandidate":"1.0.3","releaseSequence":53}`,
  "bin/ClusterServer.exe":"MZ-old-native-Server",
  "bin/previous.txt":"old",
  "data/system/config/preference.json":"persistent settings",
 }{
  if err:=os.WriteFile(filepath.Join(root,filepath.FromSlash(name)),[]byte(contents),0600);err!=nil{t.Fatal(err)}
 }
 recovery:=filepath.Join(filepath.Dir(root),"UpdateRecovery",id)
 if err:=os.MkdirAll(recovery,0700);err!=nil{t.Fatal(err)}
 if err:=preservePreviousServerOwner(root,id);err!=nil{t.Fatal(err)}
 return root,id
}
func TestNativeApplicationRollbackRestoresPreviousRuntimeAndPreservesData(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=captureServerApplicationRollback(root,id);err!=nil{t.Fatal(err)}
 oldMarker,err:=os.ReadFile(filepath.Join(root,"CLUSTER_RELEASE.json"))
 if err!=nil{t.Fatal(err)}
 oldOwner,err:=os.ReadFile(filepath.Join(root,".cluster-installer-managed.json"))
 if err!=nil{t.Fatal(err)}
 rollback:=filepath.Join(filepath.Dir(root),"Rollback","previous-test")
 if err:=os.MkdirAll(filepath.Join(rollback,"bin"),0700);err!=nil{t.Fatal(err)}
 for _,name:=range []string{"CLUSTER_RELEASE.json","bin/ClusterServer.exe","bin/previous.txt"}{
  from,to:=filepath.Join(root,filepath.FromSlash(name)),filepath.Join(rollback,filepath.FromSlash(name))
  if err:=os.Rename(from,to);err!=nil{t.Fatal(err)}
 }
 for name,contents:=range map[string]string{
  "CLUSTER_RELEASE.json":`{"schema":1,"managedInstaller":true,"releaseChannel":"stable","releaseCandidate":"1.0.4","releaseSequence":54}`,
  "bin/ClusterServer.exe":"MZ-new-candidate",
  "bin/new.txt":"new",
 }{
  if err:=os.WriteFile(filepath.Join(root,filepath.FromSlash(name)),[]byte(contents),0600);err!=nil{t.Fatal(err)}
 }
 if err:=restorePreviousServerApplication(root,id);err!=nil{t.Fatal(err)}
 now,err:=os.ReadFile(filepath.Join(root,"CLUSTER_RELEASE.json"))
 if err!=nil||string(now)!=string(oldMarker){t.Fatalf("prior release marker not restored: %s, %v",now,err)}
 owner,err:=os.ReadFile(filepath.Join(root,".cluster-installer-managed.json"))
 if err!=nil||string(owner)!=string(oldOwner){t.Fatal("owner marker changed")}
 if data,err:=os.ReadFile(filepath.Join(root,"data","system","config","preference.json"));err!=nil||string(data)!="persistent settings"{
  t.Fatal("protected settings changed")
 }
 if got,err:=os.ReadFile(filepath.Join(root,"bin","ClusterServer.exe"));err!=nil||string(got)!="MZ-old-native-Server"{t.Fatal("prior launcher was not recovered")}
 if got,err:=os.ReadFile(filepath.Join(filepath.Dir(root),"UpdateRecovery",id,"failed-application","bin","ClusterServer.exe"));err!=nil||string(got)!="MZ-new-candidate"{t.Fatal("failed candidate missing from quarantine")}
}
func TestNativeRollbackRefusesUnselectedAndUnverifiableInstallerSnapshots(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=captureServerApplicationRollback(root,id);err!=nil{t.Fatal(err)}
 if _,_,err:=inspectServerApplicationRollback(root,id);err==nil{t.Fatal("accepted missing installer rollback")}
 for _,name:=range []string{"previous-first","previous-second"}{
  dir:=filepath.Join(filepath.Dir(root),"Rollback",name)
  if err:=os.MkdirAll(filepath.Join(dir,"bin"),0700);err!=nil{t.Fatal(err)}
  if err:=os.WriteFile(filepath.Join(dir,"CLUSTER_RELEASE.json"),[]byte("wrong"),0600);err!=nil{t.Fatal(err)}
 }
 if _,_,err:=inspectServerApplicationRollback(root,id);err==nil||!strings.Contains(err.Error(),"multiple"){
  t.Fatalf("ambiguous rollback was accepted: %v",err)
 }
}
func TestNativeRollbackBaselineIsExclusive(t *testing.T){
 root,id:=appRollbackFixture(t)
 if err:=captureServerApplicationRollback(root,id);err!=nil{t.Fatal(err)}
 if err:=captureServerApplicationRollback(root,id);err==nil{t.Fatal("duplicate application rollback baseline was overwritten")}
}

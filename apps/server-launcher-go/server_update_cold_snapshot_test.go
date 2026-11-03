package main

import (
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

const snapshotFixtureID="17c5909e-bc37-4f04-b1e3-c267af25dc1c"

func snapshotTestRoot(t *testing.T)string{
 t.Helper()
 root:=filepath.Join(t.TempDir(),"Cluster","Server")
 source:=filepath.Join(root,"data","postgresql","base","5")
 if err:=os.MkdirAll(source,0700);err!=nil{t.Fatal(err)}
 owner,_:=json.Marshal(map[string]any{"managedBy":"cluster-installer","installRoot":filepath.Dir(root)})
 if err:=os.WriteFile(filepath.Join(root,".cluster-installer-managed.json"),owner,0600);err!=nil{t.Fatal(err)}
 for _,name:=range []string{"PG_VERSION","base/5/1234"}{
  target:=filepath.Join(root,"data","postgresql",filepath.FromSlash(name))
  body:=[]byte("PostgreSQL cold backup fixture "+name)
  if name=="PG_VERSION" { body=[]byte("18\n") }
  if err:=os.WriteFile(target,body,0600);err!=nil{t.Fatal(err)}
 }
 return root
}
func TestColdPostgresSnapshotVerifiedAndImmutable(t *testing.T){
 root:=snapshotTestRoot(t)
 path,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 if err:=verifyColdPostgresSnapshot(path);err!=nil{t.Fatal(err)}
 if _,err:=copyColdPostgresSnapshot(root,snapshotFixtureID);err==nil{t.Fatal("snapshot reused existing transaction directory")}
 original,err:=os.ReadFile(filepath.Join(root,"data","postgresql","base","5","1234"))
 if err!=nil||!strings.HasPrefix(string(original),"PostgreSQL"){t.Fatal("source data changed by snapshot")}
}
func TestColdPostgresSnapshotRejectsTamperedBackup(t *testing.T){
 root:=snapshotTestRoot(t)
 snapshot,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 f:=filepath.Join(snapshot,"postgresql","PG_VERSION")
 if err:=os.WriteFile(f,[]byte("TAMPERED"),0600);err!=nil{t.Fatal(err)}
 if err:=verifyColdPostgresSnapshot(snapshot);err==nil{t.Fatal("tampered PostgreSQL backup passed integrity")}
}
func TestColdPostgresSnapshotRejectsSymlinks(t *testing.T){
 root:=snapshotTestRoot(t)
 source:=filepath.Join(root,"data","postgresql","linked")
 if err:=os.Symlink(filepath.Join(root,"data","postgresql","PG_VERSION"),source);err!=nil{
  t.Skipf("symlink creation unavailable: %v",err)
 }
 if _,err:=copyColdPostgresSnapshot(root,snapshotFixtureID);err==nil{t.Fatal("linked source accepted")}
}
func TestColdPostgresSnapshotRequiresManagedOwnership(t *testing.T){
 root:=snapshotTestRoot(t)
 os.Remove(filepath.Join(root,".cluster-installer-managed.json"))
 if _,err:=copyColdPostgresSnapshot(root,snapshotFixtureID);err==nil{t.Fatal("unmanaged PostgreSQL snapshot allowed")}
}
func TestColdSnapshotFailsClosedOnUnsafeManifestPath(t *testing.T){
 root:=snapshotTestRoot(t)
 snapshot,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 manifestPath:=filepath.Join(snapshot,"snapshot.json")
 raw,err:=os.ReadFile(manifestPath);if err!=nil{t.Fatal(err)}
 var doc coldDatabaseSnapshot
 if err:=json.Unmarshal(raw,&doc);err!=nil{t.Fatal(err)}
 doc.Files[0].Path="../secrets.env"
 next,_:=json.Marshal(doc)
 if err:=os.WriteFile(manifestPath,next,0600);err!=nil{t.Fatal(err)}
 if err:=verifyColdPostgresSnapshot(snapshot);err==nil{t.Fatal("path traversal accepted in backup manifest")}
}


func TestColdSnapshotRejectsExtraUnmanifestedFile(t *testing.T){
 root:=snapshotTestRoot(t)
 snapshot,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(snapshot,"postgresql","rogue.tmp"),[]byte("unexpected"),0600);err!=nil{t.Fatal(err)}
 if err:=verifyColdPostgresSnapshot(snapshot);err==nil{t.Fatal("unmanifested recovery file accepted")}
}


func TestColdRestoreQuarantinesCandidateAndRestoresVerifiedVersion(t *testing.T){
 root:=snapshotTestRoot(t)
 snapshot,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 current:=filepath.Join(root,"data","postgresql")
 file:=filepath.Join(current,"base","5","1234")
 if err:=os.WriteFile(file,[]byte("new release incompatible database contents"),0600);err!=nil{t.Fatal(err)}
 if err:=restoreColdPostgresSnapshot(root,snapshotFixtureID);err!=nil{t.Fatal(err)}
 old,err:=os.ReadFile(file)
 if err!=nil||!strings.HasPrefix(string(old),"PostgreSQL cold backup fixture"){t.Fatalf("previous DB not restored: %v %s",err,old)}
 quarantined,err:=os.ReadFile(filepath.Join(snapshot,"postgresql-after-failed-update","base","5","1234"))
 if err!=nil||string(quarantined)!="new release incompatible database contents"{t.Fatalf("failed DB not retained: %v %s",err,quarantined)}
}
func TestColdRestoreRefusesCorruptSnapshotWithoutMovingCurrentDatabase(t *testing.T){
 root:=snapshotTestRoot(t)
 snapshot,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 current:=filepath.Join(root,"data","postgresql","PG_VERSION")
 if err:=os.WriteFile(filepath.Join(snapshot,"postgresql","PG_VERSION"),[]byte("19\n"),0600);err!=nil{t.Fatal(err)}
 if err:=restoreColdPostgresSnapshot(root,snapshotFixtureID);err==nil{t.Fatal("corrupt snapshot restored")}
 data,err:=os.ReadFile(current)
 if err!=nil||string(data)!="18\n"{t.Fatalf("current DB modified before verifying snapshot: %v %s",err,data)}
}
func TestColdRestoreAllowsDamagedCandidatePostgresVersion(t *testing.T){
 root:=snapshotTestRoot(t)
 _,err:=copyColdPostgresSnapshot(root,snapshotFixtureID)
 if err!=nil{t.Fatal(err)}
 current:=filepath.Join(root,"data","postgresql","PG_VERSION")
 if err:=os.Remove(current);err!=nil{t.Fatal(err)}
 if err:=restoreColdPostgresSnapshot(root,snapshotFixtureID);err!=nil{t.Fatalf("should recover broken PG_VERSION: %v",err)}
 restored,err:=os.ReadFile(current)
 if err!=nil||string(restored)!="18\n"{t.Fatalf("valid prior version not restored: %v %s",err,restored)}
}


func TestColdSnapshotFailsClosedOnPostmasterPID(t *testing.T){
 root:=snapshotTestRoot(t)
 marker:=filepath.Join(root,"data","postgresql","postmaster.pid")
 if err:=os.WriteFile(marker,[]byte("12345\n"),0600);err!=nil{t.Fatal(err)}
 if _,err:=copyColdPostgresSnapshot(root,snapshotFixtureID);err==nil{
  t.Fatal("copied PostgreSQL data while postmaster PID was present")
 }
 if _,err:=os.Stat(marker);err!=nil{t.Fatal("offline check changed PostgreSQL data")}
}

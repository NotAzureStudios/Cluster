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
  if err:=os.WriteFile(target,[]byte("PostgreSQL cold backup fixture "+name),0600);err!=nil{t.Fatal(err)}
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

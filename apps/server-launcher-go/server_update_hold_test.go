package main

import (
 "encoding/json"
 "os"
 "path/filepath"
 "testing"
)

const holdTestID="7c5e442e-3a6e-4b9d-bdca-b4a99c0e9e82"

func testHoldRoot(t *testing.T)string{
 t.Helper()
 root:=filepath.Join(t.TempDir(),"Cluster","Server")
 if err:=os.MkdirAll(filepath.Join(root,"data","system","runtime"),0700);err!=nil{t.Fatal(err)}
 owner,_:=json.Marshal(map[string]any{"managedBy":"cluster-installer","installRoot":filepath.Dir(root)})
 if err:=os.WriteFile(filepath.Join(root,".cluster-installer-managed.json"),owner,0600);err!=nil{t.Fatal(err)}
 if err:=os.MkdirAll(filepath.Join(root,"data","postgresql"),0700);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(root,"data","postgresql","PG_VERSION"),[]byte("18\n"),0600);err!=nil{t.Fatal(err)}
 return root
}

func TestNativeServerUpdateHoldExclusiveAndOwnerBound(t *testing.T){
 root:=testHoldRoot(t)
 if err:=acquireNativeServerUpdateHold(root,holdTestID);err!=nil{t.Fatal(err)}
 if _,err:=readNativeServerUpdateHold(root);err!=nil{t.Fatal(err)}
 if err:=acquireNativeServerUpdateHold(root,holdTestID);err==nil{t.Fatal("duplicate hold accepted")}
 if err:=releaseNativeServerUpdateHold(root,"a1b2c3d4-5e6f-4111-8999-000000000000");err==nil{t.Fatal("foreign update removed write hold")}
 if _,err:=os.Stat(nativeServerUpdateHoldPath(root));err!=nil{t.Fatal("foreign update cleared hold")}
 if err:=releaseNativeServerUpdateHold(root,holdTestID);err!=nil{t.Fatal(err)}
 if _,err:=os.Stat(nativeServerUpdateHoldPath(root));!os.IsNotExist(err){t.Fatalf("released hold remains: %v",err)}
}

func TestNativeServerUpdateHoldFailsClosedOnCorruption(t *testing.T){
 root:=testHoldRoot(t)
 if err:=os.WriteFile(nativeServerUpdateHoldPath(root),[]byte("{bad json"),0600);err!=nil{t.Fatal(err)}
 if _,err:=readNativeServerUpdateHold(root);err==nil{t.Fatal("corrupted hold treated as absent")}
 if err:=releaseNativeServerUpdateHold(root,holdTestID);err==nil{t.Fatal("corrupted hold removed")}
 if _,err:=os.Stat(nativeServerUpdateHoldPath(root));err!=nil{t.Fatal("corrupted hold unexpectedly removed")}
}

func TestNativeServerUpdateHoldRejectsUnmanagedRoot(t *testing.T){
 root:=testHoldRoot(t)
 if err:=os.Remove(filepath.Join(root,".cluster-installer-managed.json"));err!=nil{t.Fatal(err)}
 if err:=acquireNativeServerUpdateHold(root,holdTestID);err==nil{t.Fatal("unmanaged server allowed maintenance hold")}
}

func TestNativeServerUpdateHoldDoesNotFollowExistingLink(t *testing.T) {
 root:=testHoldRoot(t)
 victim:=filepath.Join(t.TempDir(),"victim.json")
 if err:=os.WriteFile(victim,[]byte("leave me alone"),0600);err!=nil{t.Fatal(err)}
 if err:=os.Symlink(victim,nativeServerUpdateHoldPath(root));err!=nil{t.Skipf("symlink unavailable: %v",err)}
 if err:=acquireNativeServerUpdateHold(root,holdTestID);err==nil{t.Fatal("symlinked hold accepted")}
 if err:=releaseNativeServerUpdateHold(root,holdTestID);err==nil{t.Fatal("symlinked hold deleted")}
 got,err:=os.ReadFile(victim)
 if err!=nil||string(got)!="leave me alone"{t.Fatalf("hold followed link: %v %q",err,got)}
}

//go:build windows

package main

import (
 "os"
 "path/filepath"
 "strings"
 "testing"
)
func TestUpdateDiskReservationIncludesColdBackupAndApplicationRoom(t *testing.T){
 db:=int64(17*1024*1024*1024)
 exe:=int64(300*1024*1024)
 got,err:=requiredNativeServerUpdateBytes(db,exe)
 if err!=nil{t.Fatal(err)}
 if got!=db+2*1024*1024*1024{t.Fatalf("did not reserve DB copy + application unpack: %d",got)}
 grow,err:=requiredNativeServerUpdateBytes(1*1024*1024*1024,1*1024*1024*1024)
 if err!=nil{t.Fatal(err)}
 if grow!=5*1024*1024*1024{t.Fatalf("large installer needs 4x staging reservation: %d",grow)}
 for _,a:=range [][2]int64{{0,1},{1,0},{-1,10},{10,-1},{1<<62,1<<62}}{
  if _,err:=requiredNativeServerUpdateBytes(a[0],a[1]);err==nil{t.Fatalf("unsafe storage requirement accepted: %v",a)}
 }
}
func TestUpdateStorageInspectionRejectsUnsafeDataEntries(t *testing.T){
 root:=testHoldRoot(t)
 db:=filepath.Join(root,"data","postgresql")
 if err:=os.WriteFile(filepath.Join(db,"file"),[]byte(strings.Repeat("x",128)),0600);err!=nil{t.Fatal(err)}
 if got,err:=nativeServerDatabaseBytes(root);err!=nil||got<128{t.Fatalf("database size failed: %d %v",got,err)}
 victim:=filepath.Join(t.TempDir(),"victim")
 if err:=os.WriteFile(victim,[]byte("secret"),0600);err!=nil{t.Fatal(err)}
 if err:=os.Symlink(victim,filepath.Join(db,"untrusted"));err!=nil{t.Skipf("Windows privileges disallow symlink test: %v",err)}
 if _,err:=nativeServerDatabaseBytes(root);err==nil{t.Fatal("linked database entry accepted")}
}

//go:build windows

package main

import (
 "errors"
 "fmt"
 "math"
 "os"
 "path/filepath"
 "syscall"
 "unsafe"
)

var getNativeUpdateFreeSpace = kernel32.NewProc("GetDiskFreeSpaceExW")

func requiredNativeServerUpdateBytes(databaseBytes,installerBytes int64)(int64,error){
 if databaseBytes<=0 || installerBytes<=0{return 0,errors.New("cannot estimate Server update storage for an empty database or missing installer")}
 if installerBytes>math.MaxInt64/4{return 0,errors.New("installer size overflow")}
 applicationSpace:=installerBytes*4
 if applicationSpace<2*1024*1024*1024{applicationSpace=2*1024*1024*1024}
 if databaseBytes>math.MaxInt64-applicationSpace{return 0,errors.New("database storage requirement overflow")}
 // The complete cold PostgreSQL copy is additional to the existing data.
 // Installer unpacking, application rollback, and journals need spare room.
 return databaseBytes+applicationSpace,nil
}
func nativeServerDatabaseBytes(root string)(int64,error){
 db:=filepath.Join(root,"data","postgresql")
 var total int64
 err:=filepath.WalkDir(db,func(path string,entry os.DirEntry,walkErr error)error{
  if walkErr!=nil{return walkErr}
  info,err:=entry.Info()
  if err!=nil{return err}
  if info.Mode()&os.ModeSymlink!=0{return errors.New("linked PostgreSQL data blocks an automatic cold backup")}
  if entry.IsDir(){return nil}
  if !info.Mode().IsRegular()||info.Size()<0||total>math.MaxInt64-info.Size(){return errors.New("invalid PostgreSQL file or size overflow")}
  total+=info.Size()
  return nil
 })
 return total,err
}
func ensureNativeServerUpdateDiskSpace(root string,installerBytes int64)error{
 requiredDatabase,err:=nativeServerDatabaseBytes(root)
 if err!=nil{return err}
 required,err:=requiredNativeServerUpdateBytes(requiredDatabase,installerBytes)
 if err!=nil{return err}
 var available,capacity,totalFree uint64
 parent:=filepath.Dir(root)
 path,err:=syscall.UTF16PtrFromString(parent)
 if err!=nil{return err}
 ok,_,winErr:=getNativeUpdateFreeSpace.Call(
  uintptr(unsafe.Pointer(path)),
  uintptr(unsafe.Pointer(&available)),
  uintptr(unsafe.Pointer(&capacity)),
  uintptr(unsafe.Pointer(&totalFree)),
 )
 if ok==0{return fmt.Errorf("cannot verify update recovery space: %w",winErr)}
 if available<uint64(required){
  return fmt.Errorf("not enough free space for verified native Server recovery: require at least %d MiB, available %d MiB",required/(1024*1024),available/(1024*1024))
 }
 return nil
}

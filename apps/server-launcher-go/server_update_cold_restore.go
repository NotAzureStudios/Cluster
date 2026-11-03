package main

// Recovery of a cold snapshot may only be requested after the independent
// Windows owner has stopped PostgreSQL and blocked new writes. This function
// does not stop any processes or create its own maintenance authorization.
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "strings"
)

func restoreColdPostgresSnapshot(root,id string)error {
 snapshot,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return err}
 if err:=verifyColdPostgresSnapshot(snapshot);err!=nil{return fmt.Errorf("refusing restore from an unverified cold snapshot: %w",err)}
 current:=filepath.Join(root,"data","postgresql")
 info,err:=os.Lstat(current)
 if err!=nil{return err}
 if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return errors.New("current PostgreSQL directory is linked or not a real folder")}
 quarantine:=filepath.Join(snapshot,"postgresql-after-failed-update")
 failedRestore:=filepath.Join(snapshot,"postgresql-failed-restore")
 for _,path:=range []string{quarantine,failedRestore}{
  if _,err:=os.Lstat(path);err==nil{return errors.New("recovery quarantine already exists; manual review is required")}
  if !os.IsNotExist(err){return err}
 }
 // A rename preserves the currently installed database for forensic recovery.
 // It fails safely when Windows still has handles open on the database.
 if err:=os.Rename(current,quarantine);err!=nil{return fmt.Errorf("cannot quarantine the stopped PostgreSQL data: %w",err)}
 restored:=false
 defer func(){
  if restored{return}
  // Do not remove either data tree. Park any incomplete restoration and
  // return the original data folder only if its path can be reclaimed.
  if _,err:=os.Lstat(current);err==nil{_ = os.Rename(current,failedRestore)}
  if _,err:=os.Lstat(current);os.IsNotExist(err){_ = os.Rename(quarantine,current)}
 }()
 if err:=os.Mkdir(current,0700);err!=nil{return err}
 data,err:=os.ReadFile(filepath.Join(snapshot,"snapshot.json"))
 if err!=nil{return err}
 var manifest coldDatabaseSnapshot
 if err=json.Unmarshal(data,&manifest);err!=nil{return err}
 sourceRoot:=filepath.Join(snapshot,"postgresql")
 // Only the validated manifest may select files; arbitrary stored file names
 // or symlinks are not accepted as an executable recovery plan.
 for _,entry:=range manifest.Files {
  relative:=filepath.FromSlash(entry.Path)
  destination:=filepath.Join(current,relative)
  if filepath.IsAbs(relative) || relative==".." || strings.HasPrefix(relative,".."+string(os.PathSeparator)) || strings.Contains(relative,":"){
   return errors.New("unsafe PostgreSQL restore path")
  }
  if err:=os.MkdirAll(filepath.Dir(destination),0700);err!=nil{return err}
  src,err:=os.Open(filepath.Join(sourceRoot,relative))
  if err!=nil{return err}
  target,err:=os.OpenFile(destination,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
  if err!=nil{src.Close();return err}
  digest:=sha256.New()
  written,copyErr:=io.Copy(io.MultiWriter(target,digest),src)
  if copyErr==nil{copyErr=target.Sync()}
  closeErr:=target.Close()
  srcErr:=src.Close()
  if copyErr!=nil{return copyErr}
  if closeErr!=nil{return closeErr}
  if srcErr!=nil{return srcErr}
  if written!=entry.Size || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)),entry.SHA256){
   return errors.New("restored PostgreSQL file differs from verified snapshot")
  }
 }
 // Verify restored file metadata; original checksums were checked during
 // copy. The original snapshot and quarantined candidate remain untouched.
 for _,entry:=range manifest.Files{
  file:=filepath.Join(current,filepath.FromSlash(entry.Path))
  info,err:=os.Lstat(file)
  if err!=nil{return err}
  if !info.Mode().IsRegular()||info.Size()!=entry.Size{return errors.New("restored PostgreSQL file failed post-copy inspection")}
 }
 restored=true
 return nil
}

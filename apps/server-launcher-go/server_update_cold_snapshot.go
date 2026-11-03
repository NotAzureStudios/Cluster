package main

// Update recovery requires a cold, verified PostgreSQL snapshot BEFORE an
// installer can replace application files. This helper has no stop/start side
// effects; the independent native owner must prove the DB is stopped first.
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "regexp"
 "strings"
)

var serverUpdateIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type coldDatabaseFile struct {
 Path string `json:"path"`
 SHA256 string `json:"sha256"`
 Size int64 `json:"size"`
}
type coldDatabaseSnapshot struct {
 Schema int `json:"schema"`
 Kind string `json:"kind"`
 Root string `json:"root"`
 TotalBytes int64 `json:"totalBytes"`
 Files []coldDatabaseFile `json:"files"`
}

// Snapshot directory is outside Server/, which the installer swaps, but
// remains inside this installation's portable parent directory.
func coldServerUpdateSnapshotPath(root,id string) (string,error) {
 if !serverUpdateIDPattern.MatchString(id) {return "",errors.New("invalid native Server update transaction ID")}
 if err:=validateManagedRepairRoot(root);err!=nil{return "",err}
 return filepath.Join(filepath.Dir(root),"UpdateRecovery",id),nil
}

// Recovery cannot require PG_VERSION from the *failed candidate*, which may
// be corrupt. Instead it strictly checks the managed owner and snapshot path.
func coldServerUpdateRecoveryPath(root,id string) (string,error) {
 if !serverUpdateIDPattern.MatchString(id){return "",errors.New("invalid recovery transaction ID")}
 resolved,err:=filepath.Abs(root)
 if err!=nil{return "",err}
 rootInfo,err:=os.Lstat(resolved)
 if err!=nil{return "",err}
 if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink!=0 {return "",errors.New("untrusted managed Server root for restore")}
 ownerFile:=filepath.Join(resolved,".cluster-installer-managed.json")
 info,err:=os.Lstat(ownerFile)
 if err!=nil{return "",err}
 if !info.Mode().IsRegular() || info.Size()>16384 {return "",errors.New("invalid recovery owner marker")}
 raw,err:=os.ReadFile(ownerFile)
 if err!=nil{return "",err}
 var owner struct {ManagedBy string `json:"managedBy"`;InstallRoot string `json:"installRoot"`}
 if err=json.Unmarshal(raw,&owner);err!=nil || owner.ManagedBy!="cluster-installer" ||
  !strings.EqualFold(filepath.Clean(owner.InstallRoot),filepath.Dir(resolved)) {
  return "",errors.New("recovery owner marker does not identify this managed installation")
 }
 for _,part:=range []string{filepath.Join(resolved,"data"),filepath.Join(filepath.Dir(resolved),"UpdateRecovery"),
  filepath.Join(filepath.Dir(resolved),"UpdateRecovery",id)}{
  info,err:=os.Lstat(part)
  if err!=nil{return "",err}
  if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return "",errors.New("recovery path contains a linked or missing directory")}
 }
 return filepath.Join(filepath.Dir(resolved),"UpdateRecovery",id),nil
}

func copyColdPostgresSnapshot(root,id string) (string,error) {
 dest,err:=coldServerUpdateSnapshotPath(root,id)
 if err!=nil{return "",err}
 source:=filepath.Join(root,"data","postgresql")
 info,err:=os.Lstat(source)
 if err!=nil{return "",fmt.Errorf("existing PostgreSQL data is not available for a cold backup: %w",err)}
 if !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return "",errors.New("PostgreSQL data folder is linked or not a real directory")}
 // postmaster.pid is a critical fail-closed marker. A stale PID is a recovery
 // incident to investigate, not permission to copy a potentially live DB.
 // The independent owner must additionally verify shutdown via SCM/processes.
 if _,pidErr:=os.Lstat(filepath.Join(source,"postmaster.pid"));pidErr==nil {
  return "",errors.New("PostgreSQL has a postmaster.pid; cold snapshot refused until independent offline verification")
 } else if !errors.Is(pidErr,os.ErrNotExist) {return "",pidErr}
 backupRoot:=filepath.Dir(dest)
 if info,err:=os.Lstat(backupRoot);err==nil {
  if !info.IsDir() || info.Mode()&os.ModeSymlink!=0 {return "",errors.New("update recovery parent is linked or not a real directory")}
 } else if !os.IsNotExist(err){return "",err}
 if err:=os.MkdirAll(backupRoot,0700);err!=nil{return "",err}
 if err:=os.Mkdir(dest,0700);err!=nil{return "",fmt.Errorf("refusing to overwrite a previous update recovery snapshot: %w",err)}
 rollbackIncomplete:=true
 defer func(){if rollbackIncomplete { _=os.RemoveAll(dest) }}()
 targetDir:=filepath.Join(dest,"postgresql")
 if err:=os.Mkdir(targetDir,0700);err!=nil{return "",err}
 manifest:=coldDatabaseSnapshot{Schema:1,Kind:"cluster-postgres-cold-snapshot",Root:"postgresql",Files:[]coldDatabaseFile{}}
 err=filepath.WalkDir(source,func(path string,entry os.DirEntry,walkErr error)error{
  if walkErr!=nil{return walkErr}
  relative,err:=filepath.Rel(source,path)
  if err!=nil{return err}
  if relative=="."{return nil}
  if filepath.IsAbs(relative) || relative==".." || strings.HasPrefix(relative,".."+string(os.PathSeparator)){
   return errors.New("unsafe relative PostgreSQL snapshot path")
  }
  info,err:=entry.Info()
  if err!=nil{return err}
  if info.Mode()&os.ModeSymlink!=0{return errors.New("linked PostgreSQL data entry blocks automatic snapshot")}
  target:=filepath.Join(targetDir,relative)
  if entry.IsDir(){return os.Mkdir(target,0700)}
  if !info.Mode().IsRegular(){return fmt.Errorf("non-regular PostgreSQL file blocks automatic snapshot: %s",relative)}
  src,err:=os.Open(path)
  if err!=nil{return err}
  defer src.Close()
  out,err:=os.OpenFile(target,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600)
  if err!=nil{return err}
  digest:=sha256.New()
  size,copyErr:=io.Copy(io.MultiWriter(out,digest),src)
  if copyErr==nil{copyErr=out.Sync()}
  closeErr:=out.Close()
  if copyErr!=nil{return copyErr}
  if closeErr!=nil{return closeErr}
  manifest.Files=append(manifest.Files,coldDatabaseFile{Path:filepath.ToSlash(relative),SHA256:hex.EncodeToString(digest.Sum(nil)),Size:size})
  manifest.TotalBytes+=size
  return nil
 })
 if err!=nil{return "",err}
 if len(manifest.Files)==0{return "",errors.New("PostgreSQL cold snapshot contains no files")}
 metadata,err:=json.MarshalIndent(manifest,"","  ")
 if err!=nil{return "",err}
 handle,err:=os.OpenFile(filepath.Join(dest,"snapshot.json"),os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600)
 if err!=nil{return "",err}
 if _,err=handle.Write(metadata);err!=nil {handle.Close();return "",err}
 if err=handle.Sync();err!=nil{handle.Close();return "",err}
 if err=handle.Close();err!=nil{return "",err}
 if err=verifyColdPostgresSnapshot(dest);err!=nil{return "",fmt.Errorf("snapshot verify failed: %w",err)}
 rollbackIncomplete=false
 return dest,nil
}

func verifyColdPostgresSnapshot(snapshotPath string)error {
 file:=filepath.Join(snapshotPath,"snapshot.json")
 manifestInfo,err:=os.Lstat(file)
 if err!=nil{return err}
 if !manifestInfo.Mode().IsRegular() || manifestInfo.Mode()&os.ModeSymlink!=0 {return errors.New("recovery manifest is not a real file")}
 raw,err:=os.ReadFile(file)
 if err!=nil{return err}
 if len(raw)>16*1024*1024 {return errors.New("cold snapshot manifest is too large")}
 var metadata coldDatabaseSnapshot
 if err=json.Unmarshal(raw,&metadata);err!=nil{return err}
 if metadata.Schema!=1 || metadata.Kind!="cluster-postgres-cold-snapshot" || metadata.Root!="postgresql" || len(metadata.Files)==0{
  return errors.New("unrecognized PostgreSQL recovery manifest")
 }
 var total int64
 seen:=map[string]bool{}
 for _,entry:=range metadata.Files{
  rel:=filepath.FromSlash(entry.Path)
  if rel==""||filepath.IsAbs(rel)||rel=="."||rel==".."||strings.HasPrefix(rel,".."+string(os.PathSeparator))||strings.Contains(rel,":")||seen[rel]{
   return errors.New("unsafe or duplicate PostgreSQL recovery file path")
  }
  seen[rel]=true
  path:=filepath.Join(snapshotPath,"postgresql",rel)
  info,err:=os.Lstat(path)
  if err!=nil{return err}
  if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0||info.Size()!=entry.Size{return errors.New("PostgreSQL recovery file size/type differs from snapshot")}
  source,err:=os.Open(path)
  if err!=nil{return err}
  digest:=sha256.New()
  n,hashErr:=io.Copy(digest,source)
  closeErr:=source.Close()
  if hashErr!=nil{return hashErr}
  if closeErr!=nil{return closeErr}
  if n!=entry.Size||!strings.EqualFold(hex.EncodeToString(digest.Sum(nil)),entry.SHA256){return errors.New("PostgreSQL recovery checksum mismatch")}
  total+=n
 }
 if total!=metadata.TotalBytes{return errors.New("PostgreSQL recovery total bytes differ from snapshot manifest")}
 // The manifest must enumerate *every* backed-up file, not merely a valid
 // subset. Unexpected files or junctions would make restore ambiguous.
 found:=0
 err=filepath.WalkDir(filepath.Join(snapshotPath,"postgresql"),func(path string,entry os.DirEntry,walkErr error)error{
  if walkErr!=nil{return walkErr}
  info,err:=entry.Info()
  if err!=nil{return err}
  if info.Mode()&os.ModeSymlink!=0{return errors.New("PostgreSQL snapshot contains a linked entry")}
  if entry.IsDir(){return nil}
  rel,err:=filepath.Rel(filepath.Join(snapshotPath,"postgresql"),path)
  if err!=nil{return err}
  if !info.Mode().IsRegular()||!seen[rel]{return errors.New("PostgreSQL snapshot contains unmanifested file")}
  found++
  return nil
 })
 if err!=nil{return err}
 if found!=len(metadata.Files){return errors.New("PostgreSQL snapshot file count differs from verified manifest")}
 return nil
}

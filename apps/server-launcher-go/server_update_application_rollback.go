package main

// Application rollback is separate from the cold PostgreSQL recovery. The
// packaged installer moves application files (not data/runtime) into a unique
// WorkRoot/Rollback/previous-* directory. This helper binds one transaction to
// the baseline before installation and refuses to guess which snapshot to use.
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "sort"
 "strings"
)

type serverApplicationRollbackBaseline struct {
 Schema int `json:"schema"`
 TransactionID string `json:"transactionId"`
 PreviousReleaseSHA256 string `json:"previousReleaseSha256"`
 PreviousOwnerSHA256 string `json:"previousOwnerSha256"`
 Existing []string `json:"existing"`
}
func serverApplicationRollbackBaselinePath(root,id string)(string,error){
 path,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return "",err}
 return filepath.Join(path,"application-baseline.json"),nil
}
func serverRollbackExisting(root string)([]string,error){
 rollback:=filepath.Join(filepath.Dir(root),"Rollback")
 entries,err:=os.ReadDir(rollback)
 if os.IsNotExist(err){return []string{},nil}
 if err!=nil{return nil,err}
 info,err:=os.Lstat(rollback)
 if err!=nil || !info.IsDir() || info.Mode()&os.ModeSymlink!=0{return nil,errors.New("untrusted Server rollback directory")}
 result:=make([]string,0,len(entries))
 for _,entry:=range entries{
  if !strings.HasPrefix(entry.Name(),"previous-"){continue}
  info,err:=entry.Info()
  if err!=nil{return nil,err}
  if !entry.IsDir() || info.Mode()&os.ModeSymlink!=0{return nil,errors.New("linked Server rollback snapshot blocks native update")}
  result=append(result,entry.Name())
 }
 sort.Strings(result)
 return result,nil
}
func serverMarkerDigest(path string)(string,error){
 stat,err:=os.Lstat(path)
 if err!=nil{return "",err}
 if !stat.Mode().IsRegular() || stat.Mode()&os.ModeSymlink!=0 || stat.Size()<1 || stat.Size()>16384 {
  return "",errors.New("invalid managed application marker")
 }
 data,err:=os.ReadFile(path)
 if err!=nil{return "",err}
 sum:=sha256.Sum256(data)
 return hex.EncodeToString(sum[:]),nil
}
func captureServerApplicationRollback(root,id string)error{
 if err:=validateManagedRepairRoot(root);err!=nil{return err}
 baselinePath,err:=serverApplicationRollbackBaselinePath(root,id)
 if err!=nil{return err}
 existing,err:=serverRollbackExisting(root)
 if err!=nil{return err}
 releaseHash,err:=serverMarkerDigest(filepath.Join(root,"CLUSTER_RELEASE.json"))
 if err!=nil{return err}
 ownerHash,err:=serverMarkerDigest(filepath.Join(root,".cluster-installer-managed.json"))
 if err!=nil{return err}
 baseline:=serverApplicationRollbackBaseline{Schema:1,TransactionID:id,Existing:existing,PreviousReleaseSHA256:releaseHash,PreviousOwnerSHA256:ownerHash}
 bytes,err:=json.MarshalIndent(baseline,"","  ")
 if err!=nil{return err}
 file,err:=os.OpenFile(baselinePath,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return fmt.Errorf("application rollback baseline already exists or cannot be written: %w",err)}
 if _,err=file.Write(bytes);err!=nil{file.Close();return err}
 if err=file.Sync();err!=nil{file.Close();return err}
 return file.Close()
}
func inspectServerApplicationRollback(root,id string)(string,serverApplicationRollbackBaseline,error){
 var baseline serverApplicationRollbackBaseline
 baselinePath,err:=serverApplicationRollbackBaselinePath(root,id)
 if err!=nil{return "",baseline,err}
 fi,err:=os.Lstat(baselinePath)
 if err!=nil{return "",baseline,err}
 if !fi.Mode().IsRegular() || fi.Size()<1 || fi.Size()>16384{return "",baseline,errors.New("invalid application rollback baseline")}
 data,err:=os.ReadFile(baselinePath)
 if err!=nil{return "",baseline,err}
 if err=json.Unmarshal(data,&baseline);err!=nil{return "",baseline,err}
 if baseline.Schema!=1 || baseline.TransactionID!=id || len(baseline.PreviousReleaseSHA256)!=64 || len(baseline.PreviousOwnerSHA256)!=64 {
  return "",baseline,errors.New("application rollback baseline identity mismatch")
 }
 current,err:=serverRollbackExisting(root)
 if err!=nil{return "",baseline,err}
 seen:=make(map[string]bool,len(baseline.Existing))
 for _,name:=range baseline.Existing{
  if !strings.HasPrefix(name,"previous-") || filepath.Base(name)!=name || seen[name]{return "",baseline,errors.New("invalid recorded rollback baseline")}
  seen[name]=true
 }
 var candidate string
 for _,name:=range current {
  if seen[name]{continue}
  if candidate!=""{return "",baseline,errors.New("multiple new installer snapshots; cannot select recovery application")}
  candidate=filepath.Join(filepath.Dir(root),"Rollback",name)
 }
 if candidate==""{return "",baseline,errors.New("installer did not publish a new rollback snapshot")}
 oldReleaseHash,err:=serverMarkerDigest(filepath.Join(candidate,"CLUSTER_RELEASE.json"))
 if err!=nil || !strings.EqualFold(oldReleaseHash,baseline.PreviousReleaseSHA256){
  return "",baseline,errors.New("rollback snapshot is not the prior installed application release")
 }
 if _,err=os.Lstat(filepath.Join(candidate,"bin","ClusterServer.exe"));err!=nil{
  return "",baseline,errors.New("prior native Windows Server launcher missing from rollback snapshot")
 }
 return candidate,baseline,nil
}
// Restore application files only while the independent updater has stopped
// the candidate and retained the native write hold. No PostgreSQL/Library,
// data/runtime or owner marker may be selected from the candidate.
func restorePreviousServerApplication(root,id string)error{
 previous,baseline,err:=inspectServerApplicationRollback(root,id)
 if err!=nil{return err}
 recovery,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return err}
 quarantine:=filepath.Join(recovery,"failed-application")
 if err=os.Mkdir(quarantine,0700);err!=nil{return fmt.Errorf("candidate quarantine exists or cannot be created: %w",err)}
 preserved:=map[string]bool{"data":true,"runtime":true,".cluster-installer-managed.json":true}
 children,err:=os.ReadDir(root)
 if err!=nil{return err}
 for _,entry:=range children{
  if preserved[entry.Name()]{continue}
  if err=os.Rename(filepath.Join(root,entry.Name()),filepath.Join(quarantine,entry.Name()));err!=nil{
   return fmt.Errorf("candidate application quarantine incomplete; intervention required: %w",err)
  }
 }
 saved,err:=os.ReadDir(previous)
 if err!=nil{return err}
 for _,entry:=range saved{
  if preserved[entry.Name()]{return errors.New("rollback application contains a protected data/runtime item")}
  if err=os.Rename(filepath.Join(previous,entry.Name()),filepath.Join(root,entry.Name()));err!=nil{
   return fmt.Errorf("prior application restore incomplete; intervention required: %w",err)
  }
 }
 verified,err:=serverMarkerDigest(filepath.Join(root,"CLUSTER_RELEASE.json"))
 if err!=nil||!strings.EqualFold(verified,baseline.PreviousReleaseSHA256){
  return errors.New("restored application release marker differs from pre-update state")
 }
 // The installer intentionally preserves and rewrites the managed owner
 // marker. Put the ORIGINAL one back from a verified copy rather than trying
 // to infer or recompute protected installation identity.
 ownerBackup:=filepath.Join(recovery,"previous-owner-marker.json")
 previousOwnerHash,err:=serverMarkerDigest(ownerBackup)
 if err!=nil||!strings.EqualFold(previousOwnerHash,baseline.PreviousOwnerSHA256){
  return errors.New("prior installer owner marker is missing or corrupted")
 }
 owner,err:=os.ReadFile(ownerBackup)
 if err!=nil{return err}
 ownerPath:=filepath.Join(root,".cluster-installer-managed.json")
 tmp:=ownerPath+".native-rollback"
 if err=os.WriteFile(tmp,owner,0600);err!=nil{return err}
 if err=os.Rename(tmp,ownerPath);err!=nil{
  // Windows cannot replace existing files via os.Rename. Never leave the
  // candidate root without any owner marker on a failed rename.
  if err2:=os.Remove(ownerPath);err2!=nil{return err}
  if err2:=os.Rename(tmp,ownerPath);err2!=nil{return err2}
 }
 return validateManagedRepairRoot(root)
}
func preservePreviousServerOwner(root,id string)error{
 recovery,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return err}
 src:=filepath.Join(root,".cluster-installer-managed.json")
 content,err:=os.ReadFile(src)
 if err!=nil{return err}
 originalHash,err:=serverMarkerDigest(src)
 if err!=nil{return err}
 dest:=filepath.Join(recovery,"previous-owner-marker.json")
 file,err:=os.OpenFile(dest,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return err}
 if _,err=file.Write(content);err!=nil{file.Close();return err}
 if err=file.Sync();err!=nil{file.Close();return err}
 if err=file.Close();err!=nil{return err}
 savedHash,err:=serverMarkerDigest(dest)
 if err!=nil||!strings.EqualFold(savedHash,originalHash){return errors.New("owner marker backup verification failed")}
 return nil
}

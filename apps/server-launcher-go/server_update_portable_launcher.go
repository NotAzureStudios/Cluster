package main

// Restore the optional portable-root "Cluster Server.exe" after a failed
// update. The installer manages this file independently of Server/ and updates
// its ownership manifest. Reverting just Server/bin would leave a mismatched,
// newer root launcher bound to an older application.
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

type portableServerLauncherOwner struct{
 Schema int `json:"schema"`
 ManagedBy string `json:"managedBy"`
 InstallRoot string `json:"installRoot"`
 LauncherPath string `json:"launcherPath"`
 SHA256 string `json:"sha256"`
}
func serverPortableLauncherPaths(root string)(string,string){
 workRoot:=filepath.Dir(root)
 return filepath.Join(filepath.Dir(workRoot),"Cluster Server.exe"),filepath.Join(workRoot,"root-launcher.manifest.json")
}
func inspectPortableServerLauncher(root string)(portableServerLauncherOwner,error){
 var record portableServerLauncherOwner
 launcher,manifest:=serverPortableLauncherPaths(root)
 info,err:=os.Lstat(manifest)
 if err!=nil{return record,err}
 if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0||info.Size()<1||info.Size()>16384{
  return record,errors.New("portable Server launcher manifest is not a trusted regular file")
 }
 data,err:=os.ReadFile(manifest)
 if err!=nil{return record,err}
 if err:=json.Unmarshal(data,&record);err!=nil{return record,err}
 if record.Schema!=1||record.ManagedBy!="cluster-installer"||
  !strings.EqualFold(filepath.Clean(record.InstallRoot),filepath.Dir(root))||
  !strings.EqualFold(filepath.Clean(record.LauncherPath),launcher)||
  len(record.SHA256)!=64{return record,errors.New("portable Server launcher ownership identity mismatch")}
 digest,err:=serverFileSHA256(launcher)
 if err!=nil{return record,err}
 if !strings.EqualFold(digest,record.SHA256){return record,errors.New("portable Server launcher differs from its ownership manifest")}
 return record,nil
}
func serverFileSHA256(path string)(string,error){
 info,err:=os.Lstat(path)
 if err!=nil{return "",err}
 if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0||info.Size()<2||info.Size()>250*1024*1024{
  return "",errors.New("Server executable is not a bounded regular file")
 }
 f,err:=os.Open(path)
 if err!=nil{return "",err}
 defer f.Close()
 digest:=sha256.New()
 if _,err:=io.Copy(digest,f);err!=nil{return "",err}
 return hex.EncodeToString(digest.Sum(nil)),nil
}
func capturePreviousPortableServerLauncher(root,id string)error{
 if err:=validateManagedRepairRoot(root);err!=nil{return err}
 launcher,manifest:=serverPortableLauncherPaths(root)
 _,exeErr:=os.Lstat(launcher)
 _,manifestErr:=os.Lstat(manifest)
 if os.IsNotExist(exeErr)&&os.IsNotExist(manifestErr){return nil}
 if exeErr!=nil||manifestErr!=nil{return errors.New("portable Server launcher/ownership pair is incomplete")}
 record,err:=inspectPortableServerLauncher(root)
 if err!=nil{return err}
 oldBin:=filepath.Join(root,"bin","Cluster Server.exe")
 binHash,err:=serverFileSHA256(oldBin)
 if err!=nil{return fmt.Errorf("managed native launcher for portable recovery is missing: %w",err)}
 if !strings.EqualFold(binHash,record.SHA256){
  return errors.New("portable root launcher and managed native Server binary differ before update")
 }
 recovery,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return err}
 data,err:=os.ReadFile(manifest)
 if err!=nil{return err}
 target:=filepath.Join(recovery,"previous-root-launcher.manifest.json")
 f,err:=os.OpenFile(target,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return err}
 if _,err=f.Write(data);err!=nil{f.Close();return err}
 if err=f.Sync();err!=nil{f.Close();return err}
 return f.Close()
}
func restorePreviousPortableServerLauncher(root,id string)error{
 recovery,err:=coldServerUpdateRecoveryPath(root,id)
 if err!=nil{return err}
 previous:=filepath.Join(recovery,"previous-root-launcher.manifest.json")
 data,err:=os.ReadFile(previous)
 if os.IsNotExist(err){return nil}
 if err!=nil{return err}
 var prior portableServerLauncherOwner
 if err=json.Unmarshal(data,&prior);err!=nil{return err}
 launcher,manifest:=serverPortableLauncherPaths(root)
 if prior.Schema!=1||prior.ManagedBy!="cluster-installer"||
  !strings.EqualFold(filepath.Clean(prior.InstallRoot),filepath.Dir(root))||
  !strings.EqualFold(filepath.Clean(prior.LauncherPath),launcher)||len(prior.SHA256)!=64{
  return errors.New("prior portable launcher record is not owned by this installation")
 }
 previousExe:=filepath.Join(root,"bin","Cluster Server.exe")
 priorHash,err:=serverFileSHA256(previousExe)
 if err!=nil{return err}
 if !strings.EqualFold(priorHash,prior.SHA256){return errors.New("restored native Server executable differs from original portable launcher")}
 // Any candidate root launcher must still match its OWN manifest. Do not
 // replace a user-owned or externally changed EXE.
 if _,err:=inspectPortableServerLauncher(root);err!=nil{return fmt.Errorf("candidate portable launcher no longer matches its managed identity: %w",err)}
 staged:=launcher+".native-rollback-staging"
 quarantined:=filepath.Join(recovery,"failed-root-launcher.exe")
 quarantinedManifest:=filepath.Join(recovery,"failed-root-launcher.manifest.json")
 for _,path:=range []string{staged,quarantined,quarantinedManifest}{
  _,probeErr:=os.Lstat(path)
  if probeErr==nil{return errors.New("portable launcher recovery already exists; manual intervention required")}
  if !errors.Is(probeErr,os.ErrNotExist){return probeErr}
 }
 in,err:=os.Open(previousExe)
 if err!=nil{return err}
 defer in.Close()
 out,err:=os.OpenFile(staged,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return err}
 _,copyErr:=io.Copy(out,in)
 if copyErr==nil{copyErr=out.Sync()}
 closeErr:=out.Close()
 if copyErr!=nil{return copyErr}
 if closeErr!=nil{return closeErr}
 hash,err:=serverFileSHA256(staged)
 if err!=nil||!strings.EqualFold(hash,prior.SHA256){return errors.New("prior portable launcher staging failed SHA-256 verification")}
 if err:=os.Rename(launcher,quarantined);err!=nil{return err}
 if err:=os.Rename(staged,launcher);err!=nil{return fmt.Errorf("portable root launcher restore incomplete: %w",err)}
 if err:=os.Rename(manifest,quarantinedManifest);err!=nil{return fmt.Errorf("portable launcher manifest quarantine failed: %w",err)}
 // Old manifest is preserved for crash recovery as well as published back to
 // WorkRoot. Do not consume or truncate the evidence copy.
 tmp:=manifest+".native-rollback"
 f,err:=os.OpenFile(tmp,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return err}
 if _,err=f.Write(data);err!=nil{f.Close();return err}
 if err=f.Sync();err!=nil{f.Close();return err}
 if err=f.Close();err!=nil{return err}
 if err=os.Rename(tmp,manifest);err!=nil{return err}
 _,err=inspectPortableServerLauncher(root)
 return err
}

package main

// The signed installer is downloaded under Server/data/system/updates; executing
// it there would install ANOTHER Cluster under that directory because the
// portable installer resolves its target relative to its own executable path.
// Prepare an immutable, hashed copy beside the existing managed Cluster folder
// for an independent, stopped-server Windows update owner to launch later.
// This function never executes installers, stops services, or releases writes.
import (
 "crypto/sha256"
 "encoding/hex"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "strings"
)

func prepareOfflineServerInstaller(root string, candidate inspectedStagedServerUpdate) (string,error) {
 if err:=validateManagedRepairRoot(root);err!=nil{return "",err}
 if candidate.Sequence<=0 || candidate.Release=="" || candidate.Size<=0 ||
  len(candidate.SHA256)!=64 {
  return "",errors.New("invalid signed update admission")
 }
 hashBytes,err:=hex.DecodeString(candidate.SHA256)
 if err!=nil || len(hashBytes)!=sha256.Size{return "",errors.New("invalid signed installer checksum")}
 if candidate.Channel!="main" && candidate.Channel!="development"{return "",errors.New("invalid signed update channel")}
 staging,err:=stagedServerUpdateDirectory(root,candidate.Channel)
 if err!=nil{return "",err}
 parent,err:=filepath.Abs(filepath.Dir(root))
 if err!=nil{return "",err}
 parentInfo,err:=os.Lstat(parent)
 if err!=nil{return "",err}
 if !parentInfo.IsDir() || parentInfo.Mode()&os.ModeSymlink!=0 {
  return "",errors.New("managed installer parent is not a real directory")
 }
 // The caller cannot select an arbitrary executable: only a previously
 // authenticated, bounded staged update in this exact installation is accepted.
 source,err:=filepath.Abs(candidate.InstallerPath)
 if err!=nil{return "",err}
 if filepath.Dir(source)!=staging || !strings.EqualFold(filepath.Ext(source),".exe"){
  return "",errors.New("signed installer must be in the authenticated staging directory")
 }
 sourceInfo,err:=os.Lstat(source)
 if err!=nil{return "",err}
 if !sourceInfo.Mode().IsRegular() || sourceInfo.Mode()&os.ModeSymlink!=0 || sourceInfo.Size()!=candidate.Size {
  return "",errors.New("signed staged installer is not a matching regular file")
 }
 // Do not overwrite a normal Cluster-Installer.exe or any previous handoff.
 // O_EXCL turns a colliding or previously abandoned update into a review
 // requirement instead of silently replacing an arbitrary executable.
 target:=filepath.Join(parent,fmt.Sprintf("Cluster-Update-%d-%s.exe",candidate.Sequence,strings.ToLower(candidate.SHA256[:12])))
 if _,err:=os.Lstat(target);err==nil{return "",errors.New("offline update installer already exists; inspect the previous handoff before repeating")}
 if err!=nil && !os.IsNotExist(err){return "",err}
 input,err:=os.Open(source)
 if err!=nil{return "",err}
 defer input.Close()
 output,err:=os.OpenFile(target,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return "",err}
 success:=false
 defer func(){if !success {_=os.Remove(target)}}()
 digest:=sha256.New()
 count,copyErr:=io.Copy(io.MultiWriter(output,digest),io.LimitReader(input,candidate.Size+1))
 if copyErr==nil{copyErr=output.Sync()}
 closeErr:=output.Close()
 if copyErr!=nil{return "",copyErr}
 if closeErr!=nil{return "",closeErr}
 if count!=candidate.Size || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)),candidate.SHA256){
  return "",errors.New("copied installer does not match the signed size and checksum")
 }
 // Verify the finished artifact, not only the streaming copy.
 check,err:=os.Open(target)
 if err!=nil{return "",err}
 defer check.Close()
 finalDigest:=sha256.New()
 finalCount,err:=io.Copy(finalDigest,io.LimitReader(check,candidate.Size+1))
 if err!=nil{return "",err}
 if finalCount!=candidate.Size || !strings.EqualFold(hex.EncodeToString(finalDigest.Sum(nil)),candidate.SHA256){
  return "",errors.New("offline installer failed post-copy verification")
 }
 success=true
 return target,nil
}

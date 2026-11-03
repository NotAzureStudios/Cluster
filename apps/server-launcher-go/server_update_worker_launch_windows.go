//go:build windows

package main

// The normal control panel creates a one-shot request tied to the installed
// configuration and a signed, hash-verified Server release. The independent
// process requests Windows UAC, then claims the request and performs the
// transaction outside the replaceable Server tree.
import (
 "crypto/rand"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"
 "path/filepath"
 "strings"
 "syscall"
 "time"
 "unsafe"
)

func newNativeServerUpdateID()(string,error){
 bytes:=make([]byte,16)
 if _,err:=rand.Read(bytes);err!=nil{return "",err}
 bytes[6]=(bytes[6]&0x0f)|0x40
 bytes[8]=(bytes[8]&0x3f)|0x80
 id:=fmt.Sprintf("%x-%x-%x-%x-%x",bytes[:4],bytes[4:6],bytes[6:8],bytes[8:10],bytes[10:16])
 if !serverUpdateIDPattern.MatchString(id){return "",errors.New("secure update transaction ID could not be generated")}
 return id,nil
}
func stageNativeServerUpdateIntent(root,channel string)(string,string,error){
 if err:=validateManagedRepairRoot(root);err!=nil{return "","",err}
 if err:=requireOwnedClusterUpdateService(root);err!=nil{return "","",err}
 candidate,err:=inspectStagedServerUpdate(root,channel)
 if err!=nil{return "","",err}
 id,err:=newNativeServerUpdateID()
 if err!=nil{return "","",err}
 binary,err:=os.Executable()
 if err!=nil{return "","",err}
 source,err:=os.Open(binary)
 if err!=nil{return "","",err}
 defer source.Close()
 sourceInfo,err:=source.Stat()
 if err!=nil{return "","",err}
 if !sourceInfo.Mode().IsRegular() || sourceInfo.Size()<128*1024 || sourceInfo.Size()>200*1024*1024 {
  return "","",errors.New("Cluster control panel executable is not a bounded regular binary")
 }
 parent:=filepath.Dir(root)
 dest:=filepath.Join(parent,"Cluster-Update-Worker-"+id+".exe")
 target,err:=os.OpenFile(dest,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0700)
 if err!=nil{return "","",fmt.Errorf("cannot create isolated native update worker: %w",err)}
 success:=false
 defer func(){if !success{_ = os.Remove(dest)}}()
 hash:=sha256.New()
 bytes,copyErr:=io.Copy(io.MultiWriter(target,hash),io.LimitReader(source,sourceInfo.Size()+1))
 if copyErr==nil{copyErr=target.Sync()}
 closeErr:=target.Close()
 if copyErr!=nil{return "","",copyErr}
 if closeErr!=nil{return "","",closeErr}
 if bytes!=sourceInfo.Size(){return "","",errors.New("native update worker copy had unexpected size")}
 copied,err:=os.Open(dest)
 if err!=nil{return "","",err}
 checkHash:=sha256.New()
 n,err:=io.Copy(checkHash,copied)
 closeErr=copied.Close()
 if err!=nil{return "","",err}
 if closeErr!=nil{return "","",closeErr}
 if n!=bytes || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)),hex.EncodeToString(checkHash.Sum(nil))){
  return "","",errors.New("isolated native update worker executable failed integrity verification")
 }
 config,err:=os.ReadFile(filepath.Join(root,"data","system","config","cluster.config.json"))
 if err!=nil{return "","",fmt.Errorf("cannot bind update to current Server configuration: %w",err)}
 sum:=sha256.Sum256(config)
 request:=authorizedServerUpdateRequest{
  Schema:1,Action:"install-signed-server-update",TransactionID:id,
  CreatedAt:time.Now().UTC().Format(time.RFC3339Nano),
  Channel:channel,Release:candidate.Release,Sequence:candidate.Sequence,
  InstallerSHA256:candidate.SHA256,ConfigSHA256:hex.EncodeToString(sum[:]),
 }
 raw,err:=json.Marshal(request)
 if err!=nil{return "","",err}
 path:=nativeServerUpdateRequestPath(root)
 intent,err:=os.OpenFile(path,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
 if err!=nil{return "","",fmt.Errorf("another installer request exists or cannot be created: %w",err)}
 if _,err=intent.Write(raw);err!=nil{intent.Close();_ = os.Remove(path);return "","",err}
 if err=intent.Sync();err!=nil{intent.Close();_ = os.Remove(path);return "","",err}
 if err=intent.Close();err!=nil{_ = os.Remove(path);return "","",err}
 success=true
 return dest,path,nil
}
func launchNativeServerUpdate(root,channel string)error{
 worker,intent,err:=stageNativeServerUpdateIntent(root,channel)
 if err!=nil{return err}
 args:=[]string{"--native-update-apply","--root",root,"--update-channel",channel}
 escaped:=make([]string,0,len(args))
 for _,arg:=range args{escaped=append(escaped,syscall.EscapeArg(arg))}
 parameters:=strings.Join(escaped," ")
 p,_,callErr:=procShellExecuteW.Call(0,
  uintptr(unsafe.Pointer(utf16("runas"))),
  uintptr(unsafe.Pointer(utf16(worker))),
  uintptr(unsafe.Pointer(utf16(parameters))),
  uintptr(unsafe.Pointer(utf16(filepath.Dir(root)))),
  swShowNormal,
 )
 if p<=shellExecuteSuccessBase{
  _=os.Remove(intent)
  _=os.Remove(worker)
  return fmt.Errorf("Windows administrator approval was not granted; Server remains unchanged (ShellExecute %d: %v)",p,callErr)
 }
 return nil
}

package main

// A future independent Windows update owner claims a PIN-authorized request
// for ONE publisher-signed Server release. This never executes the installer.
// The API producer and the native worker must be wired and tested together
// before auto-install can be enabled in the UI.
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
)

type authorizedServerUpdateRequest struct {
 Schema int `json:"schema"`
 Action string `json:"action"`
 TransactionID string `json:"transactionId"`
 CreatedAt string `json:"createdAt"`
 Channel string `json:"channel"`
 Release string `json:"release"`
 Sequence int `json:"sequence"`
 InstallerSHA256 string `json:"installerSha256"`
 ConfigSHA256 string `json:"configSha256"`
}
type claimedServerUpdateRequest struct {
 Request authorizedServerUpdateRequest
 Candidate inspectedStagedServerUpdate
 ClaimPath string
}

func nativeServerUpdateRequestPath(root string)string{
 return filepath.Join(root,"data","system","runtime","cluster-update-request.json")
}
func claimAuthorizedServerUpdate(root string,now time.Time,inspect func(string,string)(inspectedStagedServerUpdate,error))(claimedServerUpdateRequest,error){
 var result claimedServerUpdateRequest
 if err:=validateManagedRepairRoot(root);err!=nil{return result,err}
 source:=nativeServerUpdateRequestPath(root)
 info,err:=os.Lstat(source)
 if err!=nil{return result,err}
 if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink!=0 || info.Size()<1 || info.Size()>4096{
  return result,errors.New("update authorization is not a bounded regular file")
 }
 claim:=source+".claimed"
 if _,err:=os.Lstat(claim);err==nil{
  return result,errors.New("previous update authorization is already claimed; recovery required")
 }else if !errors.Is(err,os.ErrNotExist){return result,err}
 if err:=os.Rename(source,claim);err!=nil{return result,err}
 // No deferred deletion: a crashed worker must leave an unambiguous claim.
 // Only the owner may clear the claim after committed or verified recovery.
 data,err:=os.ReadFile(claim)
 if err!=nil{return result,err}
 var req authorizedServerUpdateRequest
 if err:=json.Unmarshal(data,&req);err!=nil{return result,errors.New("malformed update authorization")}
 if req.Schema!=1 || req.Action!="install-signed-server-update" ||
  !serverUpdateIDPattern.MatchString(req.TransactionID) ||
  (req.Channel!="main" && req.Channel!="development") || req.Sequence<=0 ||
  req.Release=="" || len(req.InstallerSHA256)!=64 || len(req.ConfigSHA256)!=64 {
  return result,errors.New("invalid update authorization identity")
 }
 issued,err:=time.Parse(time.RFC3339Nano,req.CreatedAt)
 if err!=nil || issued.After(now.Add(15*time.Second)) || now.Sub(issued)>2*time.Minute{
  return result,errors.New("update authorization expired or is in the future")
 }
 for _,digest:=range []string{req.InstallerSHA256,req.ConfigSHA256}{
  decoded,err:=hex.DecodeString(digest)
  if err!=nil || len(decoded)!=sha256.Size{return result,errors.New("invalid update authorization digest")}
 }
 configPath:=filepath.Join(root,"data","system","config","cluster.config.json")
 config,err:=os.ReadFile(configPath)
 if err!=nil{return result,fmt.Errorf("cannot verify current Server configuration: %w",err)}
 fingerprint:=sha256.Sum256(config)
 if !strings.EqualFold(hex.EncodeToString(fingerprint[:]),req.ConfigSHA256){
  return result,errors.New("Server configuration changed since update authorization")
 }
 for _,path:=range []string{nativeServerUpdateHoldPath(root),
  filepath.Join(root,"data","system","runtime","cluster-restart-request.json")} {
  if _,err:=os.Lstat(path);err==nil{
   return result,errors.New("another native update or restart is pending")
  }else if !errors.Is(err,os.ErrNotExist){return result,err}
 }
 candidate,err:=inspect(root,req.Channel)
 if err!=nil{return result,fmt.Errorf("signed Server update is no longer valid: %w",err)}
 if candidate.Release!=req.Release || candidate.Sequence!=req.Sequence ||
  !strings.EqualFold(candidate.SHA256,req.InstallerSHA256){
  return result,errors.New("staged installer no longer matches authorized release")
 }
 result=claimedServerUpdateRequest{Request:req,Candidate:candidate,ClaimPath:claim}
 return result,nil
}

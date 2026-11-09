//go:build windows

package main

// Narrow, signed-only bridge for the authenticated Web maintenance UI.
// This utility never launches installers, stops services, creates an update
// authorization claim or bypasses Windows elevation.
import (
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"
)
type webServerUpdateStatus struct {
 OK bool `json:"ok"`
 State string `json:"state"`
 Available bool `json:"available"`
 Message string `json:"message"`
 Release string `json:"release,omitempty"`
 Sequence int `json:"sequence,omitempty"`
 SHA256 string `json:"sha256,omitempty"`
 ManualReleaseURL string `json:"manualReleaseUrl,omitempty"`
 InstallSupported bool `json:"installSupported"`
 UpdatedAt string `json:"updatedAt"`
}
func webUpdateRuntimeFile(root,name string)string{
 return filepath.Join(root,"data","system","runtime",name)
}
func publishWebUpdateStatus(root string, state webServerUpdateStatus) error {
 dir:=filepath.Dir(webUpdateRuntimeFile(root,"cluster-web-update-stage.json"))
 if err:=os.MkdirAll(dir,0700);err!=nil{return err}
 state.UpdatedAt=time.Now().UTC().Format(time.RFC3339Nano)
 bytes,err:=json.Marshal(state)
 if err!=nil{return err}
 tmp,err:=os.CreateTemp(dir,".cluster-web-update-state-*")
 if err!=nil{return err}
 defer os.Remove(tmp.Name())
 defer tmp.Close()
 if err=tmp.Chmod(0600);err!=nil{return err}
 if _,err=tmp.Write(bytes);err!=nil{return err}
 if err=tmp.Sync();err!=nil{return err}
 if err=tmp.Close();err!=nil{return err}
 dest:=webUpdateRuntimeFile(root,"cluster-web-update-stage.json")
 // Advisory state only, never an executable authorization record.
 if err=os.Remove(dest);err!=nil && !errors.Is(err,os.ErrNotExist){return err}
 return os.Rename(tmp.Name(),dest)
}
func printWebUpdateStatus(status webServerUpdateStatus)error{
 if status.UpdatedAt==""{status.UpdatedAt=time.Now().UTC().Format(time.RFC3339Nano)}
 return json.NewEncoder(os.Stdout).Encode(status)
}
func readWebUpdateStatus(root string)webServerUpdateStatus{
 raw,err:=os.ReadFile(webUpdateRuntimeFile(root,"cluster-web-update-stage.json"))
 if err!=nil || len(raw)>4096{return webServerUpdateStatus{OK:true,State:"idle",Message:"No Web-initiated signed download has been staged."}}
 var state webServerUpdateStatus
 if json.Unmarshal(raw,&state)!=nil{return webServerUpdateStatus{OK:true,State:"unknown",Message:"Download status is invalid; inspect the Server Manager."}}
 return state
}
func runWebServerUpdateAction(root,action string)error{
 if action!="check" && action!="stage" && action!="status"{return fmt.Errorf("unsupported Web Server update action")}
 if err:=validateManagedRepairRoot(root);err!=nil{return err}
 prefs:=loadNativePanelPreferences(root)
 if prefs.UpdateChannel=="development"{return errors.New("Web updates permit only the signed main release channel")}
 switch action{
 case "check":
  result:=checkUpdateManifest(root)
  return printWebUpdateStatus(webServerUpdateStatus{
   OK:true,State:"checked",Available:result.Available,Message:result.Message,
   ManualReleaseURL:result.ManualReleaseURL,
  })
 case "status":
  state:=readWebUpdateStatus(root)
  if candidate,err:=inspectStagedServerUpdate(root,"main");err==nil{
   state.OK=true
   state.State="verified"
   state.Available=true
   state.Release=candidate.Release
   state.Sequence=candidate.Sequence
   state.SHA256=candidate.SHA256
   state.Message="Signed Server installer staged and independently verified. Remote installation requires a separately provisioned privileged updater broker."
  }
  // Display must never label the existing LocalService supervisor privileged.
  state.InstallSupported=false
  return printWebUpdateStatus(state)
 case "stage":
  lockFile:=webUpdateRuntimeFile(root,"cluster-web-update-stage.lock")
  if err:=os.MkdirAll(filepath.Dir(lockFile),0700);err!=nil{return err}
  lock,err:=os.OpenFile(lockFile,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600)
  if err!=nil{return fmt.Errorf("another Web Server update stage is active or recovery is required: %w",err)}
  lock.Close()
  defer os.Remove(lockFile)
  _=publishWebUpdateStatus(root,webServerUpdateStatus{OK:true,State:"staging",Message:"Downloading and verifying the publisher-signed Server installer."})
  if candidate,err:=inspectStagedServerUpdate(root,"main");err==nil{
   return publishWebUpdateStatus(root,webServerUpdateStatus{OK:true,State:"verified",Available:true,Release:candidate.Release,Sequence:candidate.Sequence,SHA256:candidate.SHA256,Message:"Previously staged signed Server installer verified."})
  }
  result:=checkUpdateManifest(root)
  if !result.Available {
   _=publishWebUpdateStatus(root,webServerUpdateStatus{OK:false,State:"failed",Message:"No newer verified signed Server installer: "+result.Message})
   return errors.New("signed Server update unavailable")
  }
  feed:=strings.TrimSpace(configuredUpdateManifestURL(root))
  if feed=="" {return errors.New("signed Server update feed missing")}
  if _,err:=stageServerUpdate(root,feed,"main");err!=nil{
   _=publishWebUpdateStatus(root,webServerUpdateStatus{OK:false,State:"failed",Message:"Signed Server download or verification failed. Review native Server logs."})
   return err
  }
  candidate,err:=inspectStagedServerUpdate(root,"main")
  if err!=nil{return err}
  return publishWebUpdateStatus(root,webServerUpdateStatus{OK:true,State:"verified",Available:true,Release:candidate.Release,Sequence:candidate.Sequence,SHA256:candidate.SHA256,Message:"Signed Server installer verified and staged. No installation or restart was performed."})
 }
 return errors.New("invalid Web update action")
}

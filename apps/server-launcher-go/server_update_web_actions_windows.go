//go:build windows

package main

// Narrow, signed-only bridge for the authenticated Web maintenance UI.
// This utility never launches installers, stops services, creates an update
// authorization claim or bypasses Windows elevation.
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
// The native producer is invoked only by the Owner/PIN-authorized fixed API
// route. It binds one transaction to the current config and a publisher-signed
// staged release. Only the separately provisioned broker can execute it.
func queueBrokerSignedServerUpdate(root string) (webServerUpdateStatus,error) {
	var result webServerUpdateStatus
	if err:=requireOwnedUpdateBroker(root);err!=nil{return result,err}
	if err:=requireOwnedClusterUpdateService(root);err!=nil{return result,err}
	candidate,err:=inspectStagedServerUpdate(root,"main")
	if err!=nil{return result,err}
	if candidate.Sequence<=installedServerReleaseSequence(root){
		return result,errors.New("broker will not install a replayed or older release")
	}
	if err:=ensureNativeServerUpdateDiskSpace(root,candidate.Size);err!=nil{return result,err}
	for _,candidatePath:=range []string{
		nativeServerUpdateRequestPath(root)+".claimed",
		updateBrokerDispatchPath(root),
		nativeServerUpdateHoldPath(root),
		webUpdateRuntimeFile(root,"cluster-restart-request.json"),
	} {
		if _,e:=os.Lstat(candidatePath);e==nil {
			return result,errors.New("previous update or restart must be reviewed before another install")
		} else if !errors.Is(e,os.ErrNotExist) {return result,e}
	}
	config,err:=os.ReadFile(filepath.Join(root,"data","system","config","cluster.config.json"))
	if err!=nil{return result,err}
	configHash:=sha256.Sum256(config)
	id,err:=newNativeServerUpdateID()
	if err!=nil{return result,err}
	request:=authorizedServerUpdateRequest{
		Schema:1,Action:"install-signed-server-update",TransactionID:id,
		CreatedAt:time.Now().UTC().Format(time.RFC3339Nano),
		Channel:"main",Release:candidate.Release,Sequence:candidate.Sequence,
		InstallerSHA256:candidate.SHA256,ConfigSHA256:hex.EncodeToString(configHash[:]),
	}
	raw,err:=json.Marshal(request)
	if err!=nil{return result,err}
	path:=nativeServerUpdateRequestPath(root)
	file,err:=os.OpenFile(path,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
	if err!=nil{return result,fmt.Errorf("another Server update request already exists: %w",err)}
	if _,err=file.Write(raw);err==nil{err=file.Sync()}
	closeErr:=file.Close()
	if err!=nil{return result,fmt.Errorf("cannot persist signed update request; inspect request file before retry: %w",err)}
	if closeErr!=nil{return result,closeErr}
	status:=webServerUpdateStatus{OK:true,State:"queued",Available:true,
		Release:candidate.Release,Sequence:candidate.Sequence,SHA256:candidate.SHA256,
		InstallSupported:true,
		Message:"One-time signed installation accepted. The protected Windows broker will stop, back up, install, verify and restart Cluster."}
	if err:=publishWebUpdateStatus(root,status);err!=nil{
		return result,fmt.Errorf("update request recorded but status publication failed; do not retry: %w",err)
	}
	return status,nil
}

func runWebServerUpdateAction(root,action string)error{
 if action!="check" && action!="stage" && action!="status" && action!="install"{return fmt.Errorf("unsupported Web Server update action")}
 if err:=validateManagedRepairRoot(root);err!=nil{return err}
 prefs:=loadNativePanelPreferences(root)
 if prefs.UpdateChannel=="development"{return errors.New("Web updates permit only the signed main release channel")}
 switch action{
 case "install":
  status,err:=queueBrokerSignedServerUpdate(root)
  if err!=nil{return err}
  return printWebUpdateStatus(status)
 case "check":
  result:=checkUpdateManifest(root)
  return printWebUpdateStatus(webServerUpdateStatus{
   OK:true,State:"checked",Available:result.Available,Message:result.Message,
   ManualReleaseURL:result.ManualReleaseURL,
  })
 case "status":
  state:=readWebUpdateStatus(root)
  pending:=false
  for _,candidatePath:=range []string{nativeServerUpdateRequestPath(root),
    nativeServerUpdateRequestPath(root)+".claimed"}{
    if _,err:=os.Lstat(candidatePath);err==nil{pending=true;break}
  }
  // Do not repaint a queued, installed, failed-recovery or active
  // transaction as "verified" merely because the staged installer remains.
  if !pending && state.State!="installed" && state.State!="blocked" &&
    state.State!="recovered" && state.State!="installing" {
    if candidate,err:=inspectStagedServerUpdate(root,"main");err==nil{
      state.OK=true
      state.State="verified"
      state.Available=true
      state.Release=candidate.Release
      state.Sequence=candidate.Sequence
      state.SHA256=candidate.SHA256
      state.Message="Signed Server installer verified and staged."
    }else if state.State=="verified" {
      state.State="unavailable"
      state.Available=false
      state.Release=""
      state.Sequence=0
      state.SHA256=""
      state.Message="The staged signed installer is missing or no longer verified."
    }else if state.State=="staging" {
      if _,lockErr:=os.Lstat(webUpdateRuntimeFile(root,"cluster-web-update-stage.lock"));errors.Is(lockErr,os.ErrNotExist){
        state.State="failed"
        state.OK=false
        state.Available=false
        state.Message="Signed download stopped before verification."
      }
    }
  }
  if pending && state.State!="installing" {state.State="queued";state.Message="Signed update awaits native broker claim or is being applied."}
  state.InstallSupported=false
  if !pending && state.State=="verified" {
    if err:=requireOwnedUpdateBroker(root);err==nil {
      if err:=requireOwnedClusterUpdateService(root);err==nil{
        state.InstallSupported=true
      }
    } else {
      state.Message+=" Protected Update Broker is not provisioned or running."
    }
  }
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
  if err!=nil{
   _=publishWebUpdateStatus(root,webServerUpdateStatus{OK:false,State:"failed",Message:"Downloaded installer failed independent verification; no installation was performed."})
   return err
  }
  return publishWebUpdateStatus(root,webServerUpdateStatus{OK:true,State:"verified",Available:true,Release:candidate.Release,Sequence:candidate.Sequence,SHA256:candidate.SHA256,Message:"Signed Server installer verified and staged. No installation or restart was performed."})
 }
 return errors.New("invalid Web update action")
}

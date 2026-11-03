package main

// Purely observational update admission. "Verified staged" only means the
// signed installer is eligible for a future native update transaction; it
// NEVER means that the existing updater can execute or roll it back.
import (
 "errors"
 "os"
 "path/filepath"
)

type serverUpdateReadiness struct {
 Schema int `json:"schema"`
 Channel string `json:"channel"`
 StageVerified bool `json:"stageVerified"`
 Release string `json:"release,omitempty"`
 Sequence int `json:"sequence,omitempty"`
 InstallerSHA256 string `json:"installerSha256,omitempty"`
 NativeInstallationSupported bool `json:"nativeInstallationSupported"`
 Reasons []string `json:"reasons"`
 RequiredSteps []string `json:"requiredSteps"`
}

func inspectServerUpdateReadiness(root,channel string,inspect func(string,string)(inspectedStagedServerUpdate,error)) serverUpdateReadiness {
 result:=serverUpdateReadiness{
  Schema:1,Channel:channel,NativeInstallationSupported:false,
  Reasons:[]string{},
  RequiredSteps:[]string{
   "Authorize the exact signed update from the native Windows owner",
   "Hold writes and stop only Cluster-owned processes",
   "Take and verify a cold PostgreSQL snapshot before executing the installer",
   "Run the verified installer beside the original managed Cluster folder",
   "Start the candidate and prove API, Web and network readiness before reopening access",
   "Keep the previous release and snapshot for independent rollback",
  },
 }
 if channel!="main" && channel!="development" {
  result.Reasons=append(result.Reasons,"Invalid server update channel")
  return result
 }
 candidate,err:=inspect(root,channel)
 if err!=nil {
  result.Reasons=append(result.Reasons,"Signed staging is not ready: "+err.Error())
  return result
 }
 result.StageVerified=true
 result.Release=candidate.Release
 result.Sequence=candidate.Sequence
 result.InstallerSHA256=candidate.SHA256
 if err:=validateManagedRepairRoot(root);err!=nil{
  result.Reasons=append(result.Reasons,"Managed server installation is not valid")
  return result
 }
 // A missing hold is fine. An existing or malformed hold is NOT an
 // invitation to discard it: an interrupted installation may own it.
 hold:=nativeServerUpdateHoldPath(root)
 if _,err:=os.Lstat(hold);err==nil {
  result.Reasons=append(result.Reasons,"A prior native update write hold already exists; inspect or recover that transaction")
 } else if !errors.Is(err,os.ErrNotExist) {
  result.Reasons=append(result.Reasons,"Cannot inspect existing native update hold")
 }
 restart:=filepath.Join(root,"data","system","runtime","cluster-restart-request.json")
 if _,err:=os.Lstat(restart);err==nil {
  result.Reasons=append(result.Reasons,"A managed restart request is pending; finish it before updating")
 } else if !errors.Is(err,os.ErrNotExist) {
  result.Reasons=append(result.Reasons,"Cannot inspect pending restart request")
 }
 db:=filepath.Join(root,"data","postgresql")
 if fi,err:=os.Lstat(db);err!=nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink!=0 {
  result.Reasons=append(result.Reasons,"Managed PostgreSQL data folder is missing or unsafe for a cold snapshot")
 }
 // False until the separate, independently supervised native application +
 // authenticated authorization and recovery owner are actually implemented.
 result.Reasons=append(result.Reasons,"Automatic installer execution and rollback are not yet implemented")
 return result
}

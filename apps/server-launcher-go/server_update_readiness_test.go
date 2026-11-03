package main

import (
 "errors"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestServerUpdateReadinessNeverPromisesUnimplementedAutoInstall(t *testing.T) {
 fixture:=makeStagedFixture(t)
 checker:=func(root,channel string)(inspectedStagedServerUpdate,error){
  return inspectStagedServerUpdateWithKey(root,channel,fixture.publisher)
 }
 result:=inspectServerUpdateReadiness(fixture.root,"main",checker)
 if !result.StageVerified || result.Release!="1.0.3" || result.Sequence!=53 {
  t.Fatalf("valid staged signature not reported: %+v",result)
 }
 if result.NativeInstallationSupported || len(result.Reasons)==0 ||
  !strings.Contains(strings.Join(result.Reasons," "),"not yet implemented"){
  t.Fatalf("staging was advertised as installable: %+v",result)
 }
}
func TestServerUpdateReadinessBlocksExistingWriteHoldAndRestart(t *testing.T){
 fixture:=makeStagedFixture(t)
 checker:=func(root,channel string)(inspectedStagedServerUpdate,error){
  return inspectStagedServerUpdateWithKey(root,channel,fixture.publisher)
 }
 holdPath:=nativeServerUpdateHoldPath(fixture.root)
 if err:=os.MkdirAll(filepath.Dir(holdPath),0700);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(holdPath,[]byte("interrupted update: do not remove"),0600);err!=nil{t.Fatal(err)}
 restartPath:=filepath.Join(fixture.root,"data","system","runtime","cluster-restart-request.json")
 if err:=os.WriteFile(restartPath,[]byte("pending"),0600);err!=nil{t.Fatal(err)}
 got:=inspectServerUpdateReadiness(fixture.root,"main",checker)
 reasons:=strings.Join(got.Reasons,"; ")
 if !strings.Contains(reasons,"prior native update write hold") ||
  !strings.Contains(reasons,"managed restart request is pending"){
  t.Fatalf("interrupted update/restart safety not surfaced: %s",reasons)
 }
}
func TestServerUpdateReadinessRejectsUnverifiedCandidateAndInvalidChannel(t *testing.T){
 fixture:=makeStagedFixture(t)
 checker:=func(root,channel string)(inspectedStagedServerUpdate,error){
  return inspectedStagedServerUpdate{},errors.New("signature mismatch")
 }
 result:=inspectServerUpdateReadiness(fixture.root,"main",checker)
 if result.StageVerified || result.NativeInstallationSupported || result.Release!=""{
  t.Fatalf("unverified installer advertised: %+v",result)
 }
 bad:=inspectServerUpdateReadiness(fixture.root,"desktop",checker)
 if bad.StageVerified || len(bad.Reasons)==0 || !strings.Contains(bad.Reasons[0],"Invalid"){
  t.Fatalf("desktop channel accepted: %+v",bad)
 }
}

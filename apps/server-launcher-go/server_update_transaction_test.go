package main

import (
 "context"
 "errors"
 "reflect"
 "testing"
)

func updateHookFixture() (serverUpdateTransactionHooks,*[]string) {
 calls:=[]string{}
 run:=func(label string)func(context.Context)error{
  return func(context.Context)error{calls=append(calls,label);return nil}
 }
 hooks:=serverUpdateTransactionHooks{
  ConfirmAuthorization:run("authorize"),
  AcquireWriteHold:run("hold writes"),
  StopOwnedServer:run("stop"),
  SnapshotAndVerify:run("verified backup"),
  ApplySignedInstaller:run("apply"),
  StartCandidate:run("start candidate"),
  ProbeCandidate:run("probe candidate"),
  CommitAndReleaseHold:run("commit"),
  StopCandidate:run("stop candidate"),
  RestoreSnapshot:run("restore"),
  StartPrevious:run("start previous"),
  ProbePrevious:run("probe previous"),
  ReleasePreviousHold:run("release old hold"),
  Record:func(phase serverUpdatePhase, status string) {calls=append(calls,"record "+string(phase)+" "+status)},
 }
 return hooks,&calls
}
func TestManagedServerUpdateRequiresCompleteSafetyContract(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.SnapshotAndVerify=nil
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseBlocked || result.Err==nil || len(*calls)!=0 {
  t.Fatalf("missing critical hook triggered side effects: %#v %#v",result,*calls)
 }
}
func TestManagedUpdateCommitsAfterBackupAndProbe(t *testing.T) {
 hooks,calls:=updateHookFixture()
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Err!=nil || result.Phase!=updatePhaseCommitted || result.Recovered {
  t.Fatalf("valid transaction failed: %#v",result)
 }
 expected:=[]string{"authorize","hold writes","stop","verified backup","apply","start candidate","probe candidate","commit"}
 actual:=[]string{}
 for _,item:=range *calls {if len(item)>=7 && item[:7]=="record " {continue};actual=append(actual,item)}
 if !reflect.DeepEqual(actual,expected) {t.Fatalf("wrong sequence: %v",actual)}
}
func TestManagedUpdateNeverAppliesIfBackupFails(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.SnapshotAndVerify=func(context.Context)error{*calls=append(*calls,"backup failed");return errors.New("backup integrity failed")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseRecovered || !result.Recovered || result.Err==nil {t.Fatalf("previous server was not recovered after failed backup: %#v",result)}
 expected:=[]string{"authorize","hold writes","stop","backup failed","stop candidate","start previous","probe previous","release old hold"}
 actual:=[]string{}
 for _,item:=range *calls {if len(item)>=7 && item[:7]=="record " {continue};actual=append(actual,item)}
 if !reflect.DeepEqual(actual,expected) {t.Fatalf("pre-install recovery sequence wrong: %v",actual)}
 for _,item:=range *calls {if item=="apply" || item=="restore" {t.Fatal("installer or DB restore ran despite no verified backup")}}
}
func TestManagedUpdateFailureRestoresPriorVersionBeforeReopeningWrites(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.ProbeCandidate=func(context.Context)error{*calls=append(*calls,"probe candidate failed");return errors.New("API readiness timeout")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseRecovered || !result.Recovered || result.Err==nil {t.Fatalf("expected failure recovery: %#v",result)}
 expected:=[]string{"authorize","hold writes","stop","verified backup","apply","start candidate","probe candidate failed","stop candidate","restore","start previous","probe previous","release old hold"}
 actual:=[]string{}
 for _,item:=range *calls {if len(item)>=7 && item[:7]=="record " {continue};actual=append(actual,item)}
 if !reflect.DeepEqual(actual,expected) {t.Fatalf("unsafe rollback sequence: %v",actual)}
}
func TestManagedUpdateDoesNotClaimRecoveryWhenRestoreFails(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.ProbeCandidate=func(context.Context)error{return errors.New("new release unhealthy")}
 hooks.RestoreSnapshot=func(context.Context)error{return errors.New("backup verification mismatch")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseBlocked || result.Recovered || result.Err==nil {t.Fatalf("false recovery: %#v",result)}
 for _,item:=range *calls {if item=="release old hold" || item=="probe previous" {t.Fatal("unsafe access restoration after failed restore")}}
}
func TestManagedUpdateCanceledRequestStillAttemptsRecovery(t *testing.T) {
 ctx,cancel:=context.WithCancel(context.Background())
 hooks,_:=updateHookFixture()
 hooks.ProbeCandidate=func(context.Context)error{cancel();return errors.New("browser disconnected")}
 hooks.RestoreSnapshot=func(recovery context.Context)error{
  if recovery.Err()!=nil {t.Fatal("recovery was canceled with UI request")}
  return nil
 }
 result:=runServerUpdateTransaction(ctx,hooks)
 if !result.Recovered || result.Phase!=updatePhaseRecovered {t.Fatalf("request cancellation broke recovery: %#v",result)}
}

func TestManagedUpdateStopFailureDoesNotLeavePriorServiceHeld(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.StopOwnedServer=func(context.Context)error{return errors.New("Windows SCM did not stop")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseRecovered || !result.Recovered {t.Fatalf("stop failure did not recover: %#v",result)}
 for _,call:=range *calls {if call=="apply" || call=="restore" {t.Fatalf("unsafe install/restore after stop failure: %s",call)}}
}
func TestManagedUpdatePreInstallRecoveryFailureRemainsBlocked(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.SnapshotAndVerify=func(context.Context)error{return errors.New("no backup capacity")}
 hooks.ProbePrevious=func(context.Context)error{return errors.New("previous API unavailable")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseBlocked || result.Recovered || result.Err==nil {t.Fatalf("incorrectly claimed recovery: %#v",result)}
 for _,call:=range *calls {if call=="release old hold" || call=="apply" {t.Fatalf("unsafe release/installer after failed pre-install recovery: %s",call)}}
}
func TestManagedUpdateAuthorizationFailureDoesNotApplyOrCreateHold(t *testing.T) {
 hooks,calls:=updateHookFixture()
 hooks.ConfirmAuthorization=func(context.Context)error{return errors.New("authorization denied")}
 result:=runServerUpdateTransaction(context.Background(),hooks)
 if result.Phase!=updatePhaseBlocked || result.Err==nil || result.Recovered {t.Fatalf("bad authorization accepted: %#v",result)}
 for _,call:=range *calls {if call=="hold writes" || call=="stop" || call=="apply" {t.Fatalf("executed after denied authorization: %s",call)}}
}

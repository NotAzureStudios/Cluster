package main

// The independent Windows update owner supplies these operations. Keeping the
// transaction ordering testable outside Windows prevents accidental rewrites
// of a live database or execution of an installer before backup verification.
import (
 "context"
 "errors"
 "fmt"
 "time"
)

type serverUpdatePhase string
const (
 updatePhaseAuthorized serverUpdatePhase = "authorized"
 updatePhaseWriteHold serverUpdatePhase = "write_hold"
 updatePhaseStopped serverUpdatePhase = "server_stopped"
 updatePhaseBackupVerified serverUpdatePhase = "backup_verified"
 updatePhaseApplying serverUpdatePhase = "applying"
 updatePhaseStarting serverUpdatePhase = "starting"
 updatePhaseProbing serverUpdatePhase = "health_verification"
 updatePhaseCommitted serverUpdatePhase = "committed"
 updatePhaseRollingBack serverUpdatePhase = "rolling_back"
 updatePhaseRecovered serverUpdatePhase = "previous_release_recovered"
 updatePhaseBlocked serverUpdatePhase = "blocked"
)

// Every hook is mandatory. A future Windows worker should never treat an
// absent backup or write barrier as a successful no-op.
type serverUpdateTransactionHooks struct {
 ConfirmAuthorization func(context.Context) error
 AcquireWriteHold func(context.Context) error
 StopOwnedServer func(context.Context) error
 SnapshotAndVerify func(context.Context) error
 ApplySignedInstaller func(context.Context) error
 StartCandidate func(context.Context) error
 ProbeCandidate func(context.Context) error
 CommitAndReleaseHold func(context.Context) error
 StopCandidate func(context.Context) error
 RestoreSnapshot func(context.Context) error
 StartPrevious func(context.Context) error
 ProbePrevious func(context.Context) error
 ReleasePreviousHold func(context.Context) error
 Record func(serverUpdatePhase,string)
}

type serverUpdateTransactionResult struct {
 Phase serverUpdatePhase
 Err error
 Recovered bool
}

func runServerUpdateTransaction(ctx context.Context, hooks serverUpdateTransactionHooks) serverUpdateTransactionResult {
 required:=[]func(context.Context)error{
  hooks.ConfirmAuthorization, hooks.AcquireWriteHold, hooks.StopOwnedServer,
  hooks.SnapshotAndVerify, hooks.ApplySignedInstaller, hooks.StartCandidate,
  hooks.ProbeCandidate, hooks.CommitAndReleaseHold, hooks.StopCandidate,
  hooks.RestoreSnapshot, hooks.StartPrevious, hooks.ProbePrevious,
  hooks.ReleasePreviousHold,
 }
 for _,action:=range required {
  if action==nil {return serverUpdateTransactionResult{Phase:updatePhaseBlocked,Err:errors.New("Server update transaction has an unimplemented safety step")}}
 }
 if hooks.Record==nil {return serverUpdateTransactionResult{Phase:updatePhaseBlocked,Err:errors.New("Server update transaction requires durable progress recording")}}
 record:=hooks.Record
 stages:=[]struct{phase serverUpdatePhase;run func(context.Context)error}{
  {updatePhaseAuthorized,hooks.ConfirmAuthorization},
  {updatePhaseWriteHold,hooks.AcquireWriteHold},
  {updatePhaseStopped,hooks.StopOwnedServer},
  {updatePhaseBackupVerified,hooks.SnapshotAndVerify},
 }
 for _,step:=range stages {
  record(step.phase,"started")
  if err:=step.run(ctx);err!=nil {
   record(updatePhaseBlocked,step.phase+": "+err.Error())
   return serverUpdateTransactionResult{Phase:updatePhaseBlocked,Err:fmt.Errorf("%s: %w",step.phase,err)}
  }
  record(step.phase,"completed")
 }
 // Do not run the installer before an authenticated intent, write barrier,
 // full managed shutdown, and a successful verified backup.
 var cause error
 for _,step:=range []struct{phase serverUpdatePhase;run func(context.Context)error}{
  {updatePhaseApplying,hooks.ApplySignedInstaller},
  {updatePhaseStarting,hooks.StartCandidate},
  {updatePhaseProbing,hooks.ProbeCandidate},
  {updatePhaseCommitted,hooks.CommitAndReleaseHold},
 }{
  record(step.phase,"started")
  if err:=step.run(ctx);err!=nil {
   cause=fmt.Errorf("%s: %w",step.phase,err)
   record(step.phase,"failed: "+err.Error())
   break
  }
  record(step.phase,"completed")
 }
 if cause==nil {return serverUpdateTransactionResult{Phase:updatePhaseCommitted}}
 // Recovery deliberately uses a new bounded context, because the initiating
 // browser could disconnect or cancel while system recovery is required.
 recoveryCtx,cancelRecovery:=context.WithTimeout(context.WithoutCancel(ctx),10*time.Minute)
 defer cancelRecovery()
 record(updatePhaseRollingBack,"started")
 for _,step:=range []struct{name string;run func(context.Context)error}{
  {"stop candidate",hooks.StopCandidate},
  {"restore application and cold database snapshot",hooks.RestoreSnapshot},
  {"start previous version",hooks.StartPrevious},
  {"verify previous version",hooks.ProbePrevious},
  {"release previous write hold",hooks.ReleasePreviousHold},
 }{
  if err:=step.run(recoveryCtx);err!=nil {
   record(updatePhaseBlocked,"rollback "+step.name+" failed: "+err.Error())
   return serverUpdateTransactionResult{Phase:updatePhaseBlocked,Err:errors.Join(cause,fmt.Errorf("recovery %s: %w",step.name,err))}
  }
 }
 record(updatePhaseRecovered,"completed")
 return serverUpdateTransactionResult{Phase:updatePhaseRecovered,Err:cause,Recovered:true}
}

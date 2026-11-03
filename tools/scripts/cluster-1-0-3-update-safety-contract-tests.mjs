import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(p)=>readFileSync(p,"utf8");
const stage=read("apps/server-launcher-go/server_update_stage.go");
const verify=read("apps/server-launcher-go/server_update_apply_preflight.go");
const snapshot=read("apps/server-launcher-go/server_update_cold_snapshot.go");
const restore=read("apps/server-launcher-go/server_update_cold_restore.go");
const txn=read("apps/server-launcher-go/server_update_transaction.go");
const host=read("apps/host-go/gateway.go");
const api=read("apps/server/src/app/server-request-infrastructure.ts");
const admission=read("apps/server/src/core/server-update-maintenance.ts");
const app=read("apps/server/src/app/cluster-server.ts");
const installer=read("tools/installer/main.go");
const handoff=read("apps/server-launcher-go/server_update_installer_handoff.go");
const readiness=read("apps/server-launcher-go/server_update_readiness.go");
const launcher=read("apps/server-launcher-go/main.go");
const journal=read("apps/server-launcher-go/server_update_journal.go");
const authorization=read("apps/server-launcher-go/server_update_authorization.go");
const worker=read("apps/server-launcher-go/server_update_worker_windows.go");
const independent=read("apps/server-launcher-go/server_update_worker_launch_windows.go");
const applicationRollback=read("apps/server-launcher-go/server_update_application_rollback.go");

const cases=[
 ["publisher-signed manifest retained at staging",stage.includes('manifestPath:=target+".manifest.json"')&&stage.includes('ManifestSHA256 string')&&stage.includes('FeedURL string')],
 ["no auto-execution in stage",!stage.includes('exec.Command')&&!stage.includes('cmd.Run()')],
 ["staged installer rechecked before application",verify.includes("verifyServerUpdateManifestWithKey")&&verify.includes("io.Copy")&&verify.includes("installedServerReleaseSequence(root)")],
 ["staged receipt not accepted alone",verify.includes("saved signed manifest differs from staged receipt")&&verify.includes("staged update signature rejected")],
 ["managed installation ownership enforced",verify.includes("validateManagedRepairRoot")],
 ["cold backup checks ownership and prevents overwrite",snapshot.includes("validateManagedRepairRoot")&&snapshot.includes("refusing to overwrite a previous update recovery snapshot")],
 ["cold backup SHA-256 and completeness checks",snapshot.includes("verifyColdPostgresSnapshot")&&snapshot.includes("PostgreSQL snapshot contains unmanifested file")],
 ["cold restore quarantines failed candidate data",restore.includes("postgresql-after-failed-update")&&restore.includes("postgresql-failed-restore")],
 ["damaged candidate can restore verified prior DB",restore.includes("coldServerUpdateRecoveryPath")&&!restore.includes("validateManagedRepairRoot")],
 ["mandatory write hold, stop, backup before install",txn.includes("AcquireWriteHold")&&txn.includes("StopOwnedServer")&&txn.includes("SnapshotAndVerify")],
 ["recovery does not claim success before probe",txn.includes("ProbePrevious")&&txn.includes("ReleasePreviousHold")&&txn.includes("updatePhaseRecovered")],
 ["gateway holds all routes except health",host.includes('request.URL.Path != "/host/health" && hostServerUpdateHold(h.root)')&&host.includes('"code":"SERVER_UPDATE_HOLD"')],
 ["direct API holds requests too",api.includes("serverUpdateMaintenanceHeld(dataRoot)")&&api.includes('"SERVER_UPDATE_HOLD"')&&app.includes("dataRoot: DATA_ROOT")],
 ["maintenance file read fails closed",admission.includes('code !== "ENOENT"')],
 ["installer execution is not falsely exposed",!installer.includes("--apply-staged-update")],
 ["copy targets actual portable installer parent and prevents nesting",handoff.includes('parent:=filepath.Dir(workRoot)') && handoff.includes('expected InstallParent/Cluster/Server') && handoff.includes('Cluster-Update-%d-%s.exe')],
 ["production handoff rechecks pinned publisher signature",handoff.includes('candidate,err:=inspectStagedServerUpdate(root,channel)')],
 ["handoff is no-execute, exclusive and hash-verified",handoff.includes('os.O_CREATE|os.O_EXCL|os.O_WRONLY')&&handoff.includes('finalDigest:=sha256.New()')&&!handoff.includes('exec.Command')],
 ["native update readiness is gated by SCM ownership, recovery disk and unblocked staging",readiness.includes('NativeInstallationSupported:false')&&readiness.includes('nativeServerUpdateExecutorSupport(root,candidate.Size)')&&readiness.includes('result.NativeInstallationSupported=true')],
 ["update readiness exposed read only",launcher.includes('updateReadiness := flag.Bool("--update-readiness"'.replace('--update-readiness','update-readiness'))&&launcher.includes('inspectServerUpdateReadiness(root,*updateChannel,inspectStagedServerUpdate)')],
 ["update installer supports guarded, no-auto-launch application",installer.includes('supervisedInstallerUpgradeAllowed(')&&installer.includes('if ciInstallOnly || skipLaunchAfterUpgrade {')],
 ["main auto-apply remains blocked until independent owner is certified",!launcher.includes('apply-staged-update')&&!installer.includes('--apply-staged-update')],
 ["independent update journal survives Server folder replacement",journal.includes('filepath.Join(parent,"UpdateProgress")')&&journal.includes('os.O_CREATE|os.O_EXCL')],
 ["journal phases are enumerated and fsynced",journal.includes('case updatePhaseAuthorized,updatePhaseWriteHold')&&journal.includes('return j.file.Sync()')],
 ["journal records no arbitrary operator-supplied error text",journal.includes('type nativeServerUpdateJournalEvent struct')&&!journal.includes('json:"message"')],
 ["native update intent is strict and one shot",authorization.includes('os.Rename(source,claim)')&&authorization.includes('decoder.DisallowUnknownFields()')],
 ["authorization is bound to config and exact signed artifact",authorization.includes('ConfigSHA256')&&authorization.includes('InstallerSHA256')&&authorization.includes('candidate.Release!=req.Release')],
 ["no update while restart or another hold exists",authorization.includes('nativeServerUpdateHoldPath(root)')&&authorization.includes('cluster-restart-request.json')],
 ["unclaimed authority cannot perform process actions",!authorization.includes('exec.Command')&&!authorization.includes('stopClusterService')],
 ["native updater executes only from a one-shot independent binary outside Server",worker.includes("nativeUpdateWorkerExecutableID")&&worker.includes("filepath.Dir(executable),parent")],
 ["native updater requires Windows UAC and signed one-time authorization",worker.includes("windowsProcessElevated")&&worker.includes("claimAuthorizedServerUpdate")],
 ["native updater verifies owned SCM service before stopping it",worker.includes("requireOwnedClusterUpdateService")&&worker.includes("stopClusterService")],
 ["native updater checks recovery disk room before shutdown",worker.includes("ensureNativeServerUpdateDiskSpace")],
 ["native updater takes and verifies cold PostgreSQL backup before installer",worker.includes("copyColdPostgresSnapshot")&&worker.includes("verifyColdPostgresSnapshot")],
 ["native updater uses only signed installer through portable parent",worker.includes("prepareSignedServerInstaller")&&worker.includes('exec.CommandContext(installCtx,installer,"--skip-launch")')],
 ["native updater restores prior app and cold PostgreSQL before reopening writes",worker.includes("restorePreviousServerApplication")&&worker.includes("restoreColdPostgresSnapshot")&&worker.includes("ReleasePreviousHold")],
 ["application rollback retains the previous owner marker and protects data/runtime",applicationRollback.includes("previous-owner-marker.json")&&applicationRollback.includes('"data":true,"runtime":true')],
 ["unprivileged UI never runs installer itself",independent.includes('procShellExecuteW.Call')&&independent.includes('utf16("runas")')&&!independent.includes("exec.CommandContext")],




];
for(const [label,ok]of cases)assert.ok(ok,label);
console.log(`Cluster 1.0.3 signed update safety contracts: ${cases.length} passed.`);

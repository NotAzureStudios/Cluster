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
];
for(const [label,ok]of cases)assert.ok(ok,label);
console.log(`Cluster 1.0.3 signed update safety contracts: ${cases.length} passed.`);

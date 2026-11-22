import assert from "node:assert/strict";
import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
const meta=JSON.parse(read("config/release-candidate.json"));
// The one-time 1.2.0 publisher is retired now that v1.2.0 is out; the current
// manual publisher keeps the same refusals.
const manualPublisher=read(".github/workflows/publish-cluster-2-0-0-manual.yml");
assert.match(manualPublisher,/sequence.*200000000|200000000/);
assert.match(manualPublisher,/Release CI timed out; refusing to publish/);
assert.match(manualPublisher,/Immutable v2\.0\.0 is already published/);
assert.match(manualPublisher,/gh release create v2\.0\.0/);
assert.match(manualPublisher,/digest==entries\[0\]\['sha256'\]/);
const server=read("apps/server/src/app/server-routes-configuration-integrations.ts");
const native=read("apps/server-launcher-go/launcher_ui_windows.go");
const api=read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const update=read("packages/renderer/src/features/settings/ServerUpdateControls.tsx");
const admin=read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const jobs=read("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx");
const studio=read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
if(meta.release==="1.2.0"){
 assert.equal(meta.sequence,200000);
 assert.equal(meta.sourceVersion,"1.2.0");
}
assert.match(native,/ui\.gpuSampler\.usageSnapshot\(\)/);
assert.match(native,/perfGPUBar/);
assert.match(server,/\/api\/admin\/server-updates\/check/);
assert.match(server,/\/api\/admin\/server-updates\/status/);
assert.match(server,/\/api\/admin\/server-updates\/stage/);
assert.match(api,/import \{ ServerUpdateControls \}/);
assert.match(api,/<ServerUpdateControls owner=\{currentUser\.workspaceRole === "owner"\}/);
assert.match(server,/\/api\/admin\/server-updates\/install/);
assert.match(server,/INSTALL SIGNED SERVER UPDATE/);
assert.match(server,/verifyUserPin\(user, parsed\.data\.securityPin/);
assert.match(update,/Install verified update/);
assert.match(update,/!status\?\.installSupported/);
assert.match(update,/\/api\/admin\/server-updates\/install/);
const broker = read("apps/server-launcher-go/server_update_broker_windows.go");
const webNative = read("apps/server-launcher-go/server_update_web_actions_windows.go");
assert.match(broker,/ClusterStudioUpdateBroker/);
assert.match(broker,/requireOwnedClusterUpdateService\(root\)/);
assert.match(broker,/inspectStagedServerUpdate\(root,\s*"main"\)/);
assert.match(broker,/updateBrokerDispatchPath/);
assert.match(webNative,/queueBrokerSignedServerUpdate/);
assert.match(webNative,/os\.O_CREATE\|os\.O_EXCL/);
assert.match(admin,/canonicalAdminOperationsSection\(adminSection\) === "jobs"/);
assert.match(jobs,/JOB_FILTERS\.map/);
assert.match(jobs,/window\.setTimeout\(\(\) => setDebouncedSearch\(search\.trim\(\)\), 300\)/);
assert.match(studio,/navTop=\{<ClusterSettingsSearch/);
console.log("PASS: 1.2 integrated GPU, native signed update discovery, signed broker admission, Jobs and admin Settings are included.");

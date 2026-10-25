import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
const read=(p)=>fs.readFileSync(p,"utf8");
test("v0.404 performance baseline contract",()=>{
 const pkg=JSON.parse(read("package.json")); const contracts=read("packages/shared/src/api-contracts.ts"); const perf=read("packages/renderer/src/core/performance.ts"); const app=read("packages/renderer/src/features/application/ClusterApplication.tsx");
 assert.equal(pkg.version,"0.422.0"); assert.ok(contracts.includes('version: "2026-08-02.62"')); assert.ok(contracts.includes('"renderer-performance-baseline-v2"'));
 assert.ok(perf.includes("WARM_START_WINDOW_MS")); assert.ok(perf.includes("renderHealth")); assert.ok(app.includes("getOfflineConnectivitySnapshot"));
});

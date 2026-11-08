import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeTelemetry } from "../../apps/server/src/core/runtime-telemetry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const telemetry = new RuntimeTelemetry({ maxSamples: 32, maxRoutes: 8 });
try {
  let checks = 0;
  const check = (condition, message) => { assert.ok(condition, message); checks++; };
  const first = telemetry.admissionSnapshot(1_000);
  check(!Object.prototype.hasOwnProperty.call(first, "routes"), "admission never computes route summaries");
  check(first.requests.total === 0, "initial admission sample preserves request count");
  const originalSnapshot = telemetry.snapshot.bind(telemetry);
  telemetry.snapshot = () => { throw Error("Full diagnostic snapshot must not run on request admission"); };
  check(telemetry.admissionSnapshot(1_249) === first, "repeated requests reuse the same admission snapshot");

  telemetry.complete(telemetry.begin(), "/api/test/123", 200);
  const after = telemetry.admissionSnapshot(1_250);
  check(after !== first, "admission cache expires after a bounded 250 ms");
  check(after.requests.total === 1, "new admission sample sees completed requests");
  check(after.requests.p95Ms >= 0 && after.requests.p99Ms >= 0, "latency percentiles remain available");
  check(typeof after.eventLoop.p95Ms === "number" && typeof after.eventLoop.p99Ms === "number", "event-loop overload metrics remain available");
  check(typeof after.gc.p99PauseMs === "number", "GC overload metric remains available");
  check(typeof after.memory.heapLimitMiB === "number" && typeof after.memory.heapUsedMiB === "number", "heap pressure remains available");
  check(typeof after.database.waitingConnections === "number", "DB waiting pressure remains available");
  for (let i = 0; i < 1_000; i++) {
    assert.strictEqual(telemetry.admissionSnapshot(1_251), after);
  }
  checks += 1;
  telemetry.snapshot = originalSnapshot;
  check(Array.isArray(telemetry.snapshot().routes), "full diagnostic route report remains available on demand");

  const requestSource = read("apps/server/src/app/server-request-infrastructure.ts");
  const governorSource = read("apps/server/src/core/resource-governor.ts");
  const healthSource = read("apps/server/src/core/operational-health.ts");
  check(requestSource.includes("assessRuntimeSaturation(runtimeTelemetry.admissionSnapshot())"), "request hook uses lightweight overload signals");
  check(!requestSource.includes("assessRuntimeSaturation(runtimeTelemetry.snapshot())"), "request hook no longer sorts all route histories");
  check(requestSource.includes("const governorMode = resourceGovernor.currentMode()"), "request hook avoids full governor snapshot");
  check(governorSource.includes("currentMode(): ResourceGovernorMode"), "governor provides cheap mode read");
  check(healthSource.includes("runtime: RuntimeSaturationSignals"), "overload semantics consume only required signals");
  console.log(checks + "/" + checks + " runtime admission hot-path regression tests passed");
} finally {
  telemetry.stop();
}

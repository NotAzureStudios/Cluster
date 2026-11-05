import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeGovernedJobConcurrency,
  normalizeServerResourceProfile,
} from "../../apps/server/src/core/server-resource-policy.ts";

const concurrency = (mode, profile, base = 8, scale = 1, queued = null, cap = 128) =>
  computeGovernedJobConcurrency({ mode, profile, base, policyScale: scale, queued, workerCap: cap });

assert.equal(normalizeServerResourceProfile("bogus"), "automatic");
assert.equal(normalizeServerResourceProfile(undefined), "automatic");
assert.equal(normalizeServerResourceProfile("interactive-first"), "interactive-first");
assert.equal(concurrency("normal", "automatic"), 8);
assert.equal(concurrency("normal", "interactive-first"), 4);
assert.equal(concurrency("normal", "background-throughput"), 10);
assert.equal(concurrency("normal", "automatic", 8, 1, 64), 10);
assert.equal(concurrency("normal", "interactive-first", 8, 1, 64), 4);
assert.equal(concurrency("normal", "background-throughput", 8, 1, 64, 6), 6);
assert.equal(concurrency("busy", "automatic", 8, 0.7), 5);
assert.equal(concurrency("busy", "interactive-first", 8, 0.7), 3);
assert.equal(concurrency("busy", "background-throughput", 8, 0.7), 5);
assert.equal(concurrency("saturated", "automatic", 8, 0.25), 2);
assert.equal(concurrency("saturated", "background-throughput", 8, 0.25), 2);
assert.equal(concurrency("critical", "background-throughput", 128, 0), 0);
assert.equal(concurrency("normal", "background-throughput", 8, 1, 128, 1), 1);
assert.equal(concurrency("normal", "automatic", 0), 1);

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const governor = read("apps/server/src/core/resource-governor.ts");
const server = read("apps/server/src/app/cluster-server.ts");
const routes = read("apps/server/src/app/server-routes-configuration-integrations.ts");
const diagnostics = read("apps/server/src/app/server-routes-health-operations.ts");
const keys = read("apps/server/src/app/server-services-request-domain.ts");
const model = read("apps/server/src/app/server-composition-types.ts");
const uiModel = read("packages/renderer/src/features/application/application-models/settings-server.ts");
const ui = read("packages/renderer/src/features/settings/ServerConfigPage.tsx");
const routeModels = read("packages/renderer/src/features/application/application-models/custom-admin-automation.ts");
const routing = read("packages/renderer/src/features/application/application-runtime-ux.tsx");

for (const name of ["serverResourceProfile", "serverResourceWorkerCap", "serverResourceRecoveryHoldMs"]) {
  assert.ok(keys.includes('"' + name + '"'), "server-managed persistence must include " + name);
  assert.ok(routes.includes(name + ":"), "protected Zod route schema must validate " + name);
  assert.ok(model.includes(name + "?:"), "server contract must include " + name);
  assert.ok(uiModel.includes(name + "?:"), "client contract must include " + name);
  assert.ok(ui.includes('key: "' + name + '"'), "editor must expose " + name);
}
assert.match(routes, /serverResourceWorkerCap: z\.number\(\)\.int\(\)\.min\(1\)\.max\(128\)/);
assert.match(routes, /serverResourceRecoveryHoldMs: z\.number\(\)\.int\(\)\.min\(1_000\)\.max\(120_000\)/);
assert.match(governor, /computeGovernedJobConcurrency\(/);
assert.match(governor, /allowsTask\(workloadClass/);
assert.match(server, /profile: BOOT_SETTINGS\.serverResourceProfile/);
assert.match(server, /maximumJobConcurrency: BOOT_SETTINGS\.serverResourceWorkerCap/);
assert.match(server, /recoveryHoldMs: BOOT_SETTINGS\.serverResourceRecoveryHoldMs/);
assert.match(ui, /section === "performance"/);
assert.match(ui, /renderSectionFields\("performance"\)/);
assert.match(routeModels, /"performance"/);
assert.match(routing, /"overview", "performance"/);
assert.match(ui, /restart: true/);
assert.match(diagnostics, /"\/api\/server-config\/performance\/runtime"/);
assert.match(diagnostics, /"serverConfig", "manage"/);
assert.match(diagnostics, /Cache-Control", "private, no-store"/);
assert.match(ui, /refreshGovernorRuntime\(\)/);
assert.match(ui, /Active resource governor/);

console.log("Cluster server resource performance: profile policy, overload safety and secure configuration assertions passed.");

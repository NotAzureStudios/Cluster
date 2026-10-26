import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); }
catch {
  const binary = fs.realpathSync(execFileSync("which", ["tsc"], { encoding: "utf8" }).trim());
  ts = require(path.resolve(path.dirname(binary), "../lib/typescript.js"));
}
const read = (name) => fs.readFileSync(name, "utf8");
const js = ts.transpileModule(read("apps/server/src/core/setup-configuration.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("exports", "module", js)(mod.exports, mod);
const { parseClusterConfigBundle, planSafeStudioConfiguration } = mod.exports;
const bundle = (settings) => ({ format: "clusterconfig", schemaVersion: 1, settings });
const hash = (plan) => createHash("sha256").update(JSON.stringify({ schemaVersion: 1, comparisonState: plan.comparisonState })).digest("hex");
const checks = [
  ["review only requested settings, never all stored settings", () => {
    const plan = planSafeStudioConfiguration(bundle({ studioName: "New" }), { studioName: "Old", serverPort: 9999, discordBotToken: "SECRET" });
    assert.deepEqual(plan.changes, [{ key: "studioName", before: "Old", after: "New" }]);
    assert.ok(!JSON.stringify(plan).includes("SECRET"));
  }],
  ["boolean false remains an intentional change", () => {
    const plan = planSafeStudioConfiguration(bundle({ defaultCreateStarterBoard: false }), { defaultCreateStarterBoard: true });
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].after, false);
  }],
  ["missing current defaults render as unconfigured", () => {
    const plan = planSafeStudioConfiguration(bundle({ defaultCreateStarterWhiteboard: false }), {});
    assert.deepEqual(plan.changes[0], { key: "defaultCreateStarterWhiteboard", before: null, after: false });
  }],
  ["unchanged settings are not mistakenly applied", () => {
    const plan = planSafeStudioConfiguration(bundle({ studioName: "Studio", studioTimezone: "UTC" }), { studioName: "Studio", studioTimezone: "UTC" });
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.comparisonState.length, 2);
  }],
  ["comparison state includes unchanged requested keys to detect stale previews", () => {
    const b = bundle({ studioName: "New", studioTimezone: "UTC" });
    assert.notEqual(hash(planSafeStudioConfiguration(b, { studioName: "Old", studioTimezone: "UTC" })),
      hash(planSafeStudioConfiguration(b, { studioName: "Old", studioTimezone: "America/New_York" })));
  }],
  ["changing requested input invalidates preview", () => {
    assert.notEqual(hash(planSafeStudioConfiguration(bundle({ studioName: "New" }), { studioName: "Old" })),
      hash(planSafeStudioConfiguration(bundle({ studioName: "Other" }), { studioName: "Old" })));
  }],
  ["plan validates even if callers bypass bundle parser", () => {
    assert.throws(() => planSafeStudioConfiguration(bundle({ serverHost: "0.0.0.0" }), {}), /not allowed/);
    assert.throws(() => planSafeStudioConfiguration({ ...bundle({}), credentials: "secret" }, {}), /Unexpected/);
  }],
  ["adversarial configuration types are rejected", () => {
    for (const settings of [{ studioName: ["Studio"] }, { defaultCreateStarterLibrary: "false" }, { securityMfaRequirement: "optional" }, { studioTimezone: "Invalid/Zone" }]) {
      assert.throws(() => parseClusterConfigBundle(bundle(settings)));
    }
  }],
  ["admin preview and apply are separate authenticated routes", () => {
    const routes = read("apps/server/src/app/server-routes-setup.ts");
    assert.match(routes, /app\.post\("\/api\/admin\/setup\/configuration\/preview"/);
    assert.match(routes, /app\.post\("\/api\/admin\/setup\/configuration\/apply"/);
    assert.match(routes, /requireAdminUserForRequest\(request, reply\)/);
    assert.match(routes, /configurationApplyBody/);
    assert.match(routes, /configurationPlan\(payload\.configuration, await readDatabaseConfigurationFor\(payload\.configuration\)\)/);
    assert.match(routes, /configurationPlan\(payload\.configuration, await readDatabaseConfigurationFor\(payload\.configuration\)\)/);
    assert.match(routes, /prisma\.\$transaction/);
  }],
  ["apply rejects stale preview before saving", () => {
    const routes = read("apps/server/src/app/server-routes-setup.ts");
    const transaction = routes.indexOf("prisma.$transaction(async (tx) => {");
    const guard = routes.indexOf("prepared.previewId !== payload.previewId", transaction);
    const save = routes.indexOf("await tx.appSetting.upsert", transaction);
    assert.ok(transaction > 0 && guard > transaction && save > guard);
    assert.match(routes, /CONFIGURATION_PREVIEW_STALE/);
  }],
  ["server logs only changed safe field names", () => {
    const routes = read("apps/server/src/app/server-routes-setup.ts");
    assert.match(routes, /event: "instance\.configuration_imported"/);
    assert.match(routes, /changedFields: prepared\.plan\.changes\.map/);
  }],
  ["import UI derives preview from backend, and invalidates rejected applies", () => {
    const page = read("packages/renderer/src/features/admin/AdminSetupChecklist.tsx");
    assert.match(page, /api\/admin\/setup\/configuration\/preview/);
    assert.match(page, /api\/admin\/setup\/configuration\/apply/);
    assert.match(page, /setPreview\(null\); \/\/ A rejected or stale preview/);
    assert.match(page, /file\.size > 16_384/);
    assert.match(page, /<AdminConfigurationImport/);
  }],
];
let passed = 0;
for (const [label, check] of checks) {
  try { check(); passed++; console.log(`PASS ${label}`); }
  catch (error) { console.error(`FAIL ${label}`, error); process.exitCode = 1; }
}
console.log(`${passed}/${checks.length} configuration-review assertions passed.`);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); }
catch {
  // Full dependency installs use the workspace TypeScript. Source-only toolchains may
  // provide tsc globally, as long as the executable resolves to its install root.
  const binary = fs.realpathSync(execFileSync("which", ["tsc"], { encoding: "utf8" }).trim());
  ts = require(path.resolve(path.dirname(binary), "../lib/typescript.js"));
}
const read = (p) => fs.readFileSync(p, "utf8");
const modulePath = "apps/server/src/core/setup-configuration.ts";
const transpiled = ts.transpileModule(read(modulePath), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("exports", "module", transpiled)(mod.exports, mod);
const { parseClusterConfigBundle, exportSafeStudioConfiguration, sanitizeSkippedSetupItems, SETUP_CHECKLIST_IDS } = mod.exports;
const checks = [
  ["safe first-run configuration imports only allowlisted settings", () => {
    const bundle = parseClusterConfigBundle({ format: "clusterconfig", schemaVersion: 1,
      settings: { studioName: "Studio", studioTimezone: "America/New_York", defaultCreateStarterBoard: false } });
    assert.deepEqual(bundle.settings, { studioName: "Studio", studioTimezone: "America/New_York", defaultCreateStarterBoard: false });
  }],
  ["reject imported secrets, security, and runtime overrides", () => {
    for (const field of ["password", "discordBotToken", "databaseUrlOverride", "serverHost", "sessionDays", "securityMfaRequirement", "__proto__", "constructor"]) {
      assert.throws(() => parseClusterConfigBundle({ format: "clusterconfig", schemaVersion: 1,
        settings: { [field]: "surprise" } }), /not allowed/);
    }
  }],
  ["reject malformed envelopes and unsupported schemas", () => {
    for (const bundle of [null, [], { format: "clusterconfig", schemaVersion: 2, settings: {} },
      { format: "clusterconfig", schemaVersion: 1, settings: {}, credentials: "secret" },
      { format: "clusterconfig", schemaVersion: 1, settings: [] }]) {
      assert.throws(() => parseClusterConfigBundle(bundle));
    }
  }],
  ["reject invalid timezone, oversized names, and nonboolean defaults", () => {
    for (const settings of [{ studioTimezone: "Nowhere/Atlantis" }, { studioName: "x".repeat(121) },
      { defaultCreateStarterLibrary: "false" }, { studioName: "" }]) {
      assert.throws(() => parseClusterConfigBundle({ format: "clusterconfig", schemaVersion: 1, settings }));
    }
  }],
  ["export emits no secrets even if server settings contain them", () => {
    const exported = exportSafeStudioConfiguration({ studioName: "Example", defaultCreateStarterLibrary: true,
      discordBotToken: "SECRET", databaseUrlOverride: "postgres://super-secret", ownerRecoveryPassword: "BAD", studioTimezone: "" });
    assert.deepEqual(exported.settings, { studioName: "Example", defaultCreateStarterLibrary: true });
    assert.ok(!JSON.stringify(exported).includes("SECRET"));
    assert.deepEqual(parseClusterConfigBundle(exported), exported);
  }],
  ["mandatory owner security items can never be skipped", () => {
    assert.ok(SETUP_CHECKLIST_IDS.includes("owner-passkey"));
    assert.ok(SETUP_CHECKLIST_IDS.includes("recovery-codes"));
    assert.deepEqual(sanitizeSkippedSetupItems(["owner-passkey", "recovery-codes", "backups", "backups", "unknown"]), ["backups"]);
  }],
  ["only admin endpoints disclose live setup posture", () => {
    const routes = read("apps/server/src/app/server-routes-setup.ts");
    assert.match(routes, /app\.get\("\/api\/admin\/setup\/checklist"/);
    assert.match(routes, /app\.patch\("\/api\/admin\/setup\/checklist"/);
    assert.match(routes, /app\.get\("\/api\/admin\/setup\/configuration\/export"/);
    assert.equal((routes.match(/requireAdminUserForRequest\(request, reply\)/g) || []).length >= 4, true);
    assert.match(routes, /const ownerMembershipIds/);
    assert.match(routes, /"owner-passkey": security.passkeysReady/);
  }],
  ["first-run import is server-validated and mutually exclusive", () => {
    const routes = read("apps/server/src/app/server-routes-setup.ts");
    assert.match(routes, /parseClusterConfigBundle\(body\.configuration\)/);
    assert.match(routes, /Configuration uploads require Import mode/);
    assert.match(routes, /16_384/);
    assert.match(routes, /!isLoopbackAddress\(request\.ip\)/);
    assert.match(routes, /SETUP_ALREADY_COMPLETE/);
  }],
  ["renderer has real four setup paths and import preview", () => {
    const source = read("packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx");
    for (const mode of ['id: "guided"', 'id: "quick"', 'id: "import"', 'id: "skip"']) assert.ok(source.includes(mode));
    assert.match(source, /inspectImportedBundle\(JSON\.parse\(await file\.text\(\)\)\)/);
    assert.match(source, /MFA setup after sign-in/);
  }],
  ["admin Command Center projects the real checklist and exports safe config", () => {
    const page = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
    const panel = read("packages/renderer/src/features/admin/AdminSetupChecklist.tsx");
    assert.match(page, /<AdminSetupChecklist/);
    assert.match(panel, /api\/admin\/setup\/checklist/);
    assert.match(panel, /api\/admin\/setup\/configuration\/export/);
    assert.match(panel, /item\.status === "complete"/);
  }],
];
let count = 0;
for (const [name, check] of checks) {
  try { check(); count++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; }
}
console.log(`${count}/${checks.length} v0.506 setup assertions passed.`);

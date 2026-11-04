import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function compile(file, tsx = false) {
  const result = ts.transpileModule(source(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      ...(tsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const errors = (result.diagnostics || []).filter((error) => error.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, file + " failed transpilation: " + errors.map((error) => error.messageText).join("; "));
  return result.outputText;
}

const mod = { exports: {} };
const component = "packages/renderer/src/components/ClusterEffectiveAccessInspector.tsx";
const localRequire = (id) => {
  if (id === "react" || id === "react/jsx-runtime") return require(id);
  if (id.endsWith(".css")) return {};
  throw new Error("Unexpected test import: " + id);
};
new Function("exports", "module", "require", compile(component, true))(mod.exports, mod, localRequire);
const { projectEffectiveAccessPreview, ClusterEffectiveAccessInspector } = mod.exports;
const sample = {
  ok: true, roleId: "producer", departmentId: "studio",
  matrix: {
    boards: { level: "edit", provenance: { effective: { label: "Role Producer overrides", sourceId: "role:producer" } } },
    vault: { level: "none", provenance: { effective: { label: "Studio member default", sourceId: "workspace-role:producer" } } },
  },
  changes: [{ tool: "boards", current: { level: "view" }, proposed: { level: "edit", provenance: { effective: { label: "Role Producer overrides" } } } }],
};
const tools = [{ key: "boards", label: "Boards" }, { key: "vault", label: "Vault" }, { key: "inventory", label: "Inventory" }];
let passed = 0;
const test = (name, callback) => { callback(); passed++; console.log("PASS", name); };

test("Projection distinguishes changed and unchanged effective access", () => {
  const rows = projectEffectiveAccessPreview(sample, tools);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].current, rows[0].proposed, rows[0].changed], ["view", "edit", true]);
  assert.deepEqual([rows[1].current, rows[1].proposed, rows[1].changed], ["none", "none", false]);
  assert.equal(rows[0].source, "Role Producer overrides");
});

test("Missing server permission is Unknown, never an invented none or manage level", () => {
  const rows = projectEffectiveAccessPreview(sample, tools);
  assert.equal(rows[2].current, "Unknown");
  assert.equal(rows[2].proposed, "Unknown");
  assert.equal(rows[2].source, "Source not reported");
});

test("Server-driven provenance and readable tool labels reach the render output", () => {
  const html = renderToStaticMarkup(React.createElement(ClusterEffectiveAccessInspector, { preview: sample, tools }));
  assert.match(html, /Server-evaluated role policy/);
  assert.match(html, /1 change across 3 tools/);
  assert.match(html, /<th scope="row">Boards<\/th>/);
  assert.match(html, /Role Producer overrides/);
  assert.match(html, /<td>view<\/td>/);
  assert.match(html, /<strong>edit<\/strong>/);
  assert.doesNotMatch(html, /<th scope="row">Vault<\/th>/);
});

test("Role preview explicitly does not claim per-user or resource permissions", () => {
  const html = renderToStaticMarkup(React.createElement(ClusterEffectiveAccessInspector, { preview: sample, tools }));
  assert.match(html, /not an account-specific access decision/);
  assert.match(html, /User overrides, account state, and resource restrictions/);
  assert.match(html, /Changed only/);
  assert.match(html, /role="region"/);
  assert.match(html, /scope="col"/);
});

test("No-difference preview remains honest rather than showing fake deltas", () => {
  const html = renderToStaticMarkup(React.createElement(ClusterEffectiveAccessInspector, {
    preview: { ...sample, changes: [] }, tools,
  }));
  assert.match(html, /No effective level or source changes/);
  assert.doesNotMatch(html, /<tbody>/);
});

test("Studio editor binds preview result to the exact request and selected role", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /requestKey = JSON\.stringify\(requestBody\)/);
  assert.match(page, /bundlePreview\.requestKey === JSON\.stringify\(selectedRolePreviewRequest\)/);
  assert.match(page, /bundlePreview\.roleId === selectedRole\.id/);
  assert.match(page, /result\.roleId !== roleId \|\| result\.departmentId !== departmentId/);
  assert.match(page, /if \(permissionPreviewSequence\.current === sequence\) setBundlePreview\(\{ \.\.\.result, requestKey \}\)/);
  assert.match(page, /activeRolePreview && \(/);
  assert.match(page, /<ClusterEffectiveAccessInspector/);
  assert.doesNotMatch(page, /bundlePreview\.changes\.map\(\(change\)/);
  compile("packages/renderer/src/features/settings/StudioSettingsPage.tsx", true);
});

test("Policy mutation invalidates previous preview and in-flight request", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /studioPermissionBundles", "studioRoleDefinitions", "studioDepartmentDefinitions"\]\.includes\(String\(key\)\)/);
  assert.match(page, /permissionPreviewSequence\.current \+= 1/);
  assert.match(page, /setBundlePreview\(null\)/);
  assert.match(page, /setBundlePreviewLoading\(false\); setSelectedRoleId\(role\.id\)/);
});

test("Inspector styles preserve keyboard, scrolling, and touch affordances", () => {
  const css = source("packages/renderer/src/components/cluster-effective-access-inspector.css");
  for (const matcher of [/overflow-x:auto/, /position:sticky/, /:focus-visible/, /min-height:44px/, /@media\(max-width:620px\)/]) assert.match(css, matcher);
});
console.log(passed + "/" + passed + " effective access inspector regressions passed");

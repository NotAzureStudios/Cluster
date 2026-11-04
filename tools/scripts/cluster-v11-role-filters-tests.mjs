import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const require = createRequire(import.meta.url);
const ts = require("typescript");
function compiled(file, tsx = false) {
  const result = ts.transpileModule(source(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      ...(tsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, file + ": " + errors.map((error) => error.messageText).join("; "));
  return result.outputText;
}
const mod = { exports: {} };
new Function("exports", "module", compiled("packages/renderer/src/features/settings/role-directory-filter.ts"))(mod.exports, mod);
const { filterRoleDirectory } = mod.exports;
const roles = [
  { id: "producer", label: "Producer", departmentId: "studio", enabled: true },
  { id: "qa_lead", label: "QA Lead", departmentId: "qa", enabled: true },
  { id: "retired", label: "Retired", departmentId: "studio", enabled: false },
  { id: "unknown", label: "Unknown", departmentId: "qa", enabled: true },
];
const counts = { producer: 3, qa_lead: 0, retired: 0 };
const options = { search: "", filter: "all", departmentLabels: { studio: "Production", qa: "Quality Assurance" }, memberCounts: counts };
const ids = (result) => result.map((role) => role.id);
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS", name); }

test("Search matches role name, immutable ID, or authorized department name", () => {
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, search: "quality" })), ["qa_lead", "unknown"]);
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, search: "QA_LEAD" })), ["qa_lead"]);
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, search: "  producer  " })), ["producer"]);
});
test("Active and disabled filters retain source order", () => {
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, filter: "enabled" })), ["producer", "qa_lead", "unknown"]);
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, filter: "disabled" })), ["retired"]);
  assert.deepEqual(ids(roles), ["producer", "qa_lead", "retired", "unknown"]);
});
test("Assigned includes only positive authoritative counts; unused means actual zero", () => {
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, filter: "assigned" })), ["producer"]);
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, filter: "unassigned" })), ["qa_lead", "retired"]);
});
test("Missing or invalid counts never masquerade as zero memberships", () => {
  assert.deepEqual(filterRoleDirectory(roles, { ...options, filter: "unassigned", memberCounts: null }), []);
  assert.deepEqual(filterRoleDirectory(roles, { ...options, filter: "assigned", memberCounts: { producer: -1, qa_lead: 0.5 } }), []);
  assert.deepEqual(ids(filterRoleDirectory(roles, { ...options, filter: "all", memberCounts: null })), ids(roles));
});
test("Studio UI exposes controlled filters and can restore a hidden selection", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  const begin = page.indexOf('{section === "roles" && (');
  const end = page.indexOf('{section === "defaults" && (', begin);
  assert.ok(begin > 0 && end > begin);
  const ui = page.slice(begin, end);
  assert.match(ui, /ROLE_DIRECTORY_FILTER_OPTIONS\.map/);
  assert.match(ui, /aria-pressed=\{roleDirectoryFilter === option.value\}/);
  assert.match(ui, /option\.needsCounts && !roleMemberCounts/);
  assert.match(ui, /visibleStudioRoles\.map/);
  assert.match(ui, /Clear filters/);
  assert.match(page, /filterRoleDirectory\(studioRoles/);
  assert.match(page, /memberCounts: roleMemberCounts/);
});
test("Role changes preserve server-authoritative assignment and policy checks", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /async function roleHasAssignments/);
  assert.match(page, /includeArchived=true/);
  assert.match(page, /force: true, staleMs: 0/);
  assert.match(page, /if \(await roleHasAssignments\(id\)\)/);
  assert.match(page, /Changing it clears role-specific overrides/);
});
test("Role department pickers reuse the shared searchable selector, not raw options", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /ariaLabel="New role department"/);
  assert.match(page, /onChange=\{setNewRoleDepartmentId\} allowClear=\{false\}/);
  assert.match(page, /ariaLabel="Role department"/);
  assert.match(page, /label: "Existing department unavailable", disabled: true/);
  assert.match(page, /disabled: department\.enabled === false/);
  assert.match(page, /onChange=\{\(departmentId\) => updateStudioRole\(selectedRole\.id, \{ departmentId, toolPermissions: \{\} \}\)\}/);
  compiled("packages/renderer/src/features/settings/StudioSettingsPage.tsx", true);
});
test("Responsive and keyboard-accessible directory controls keep focus visible", () => {
  const css = source("packages/renderer/src/features/settings/people-management-layout-v11.css");
  for (const matcher of [/studio-role-directory-filters-v11/, /aria-pressed/, /:focus-visible/, /pointer:coarse/, /min-height:44px/, /studio-role-entity-field-v11/]) assert.match(css, matcher);
});
console.log(passed + "/" + passed + " role directory continuation tests passed");

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
const file = "packages/renderer/src/features/settings/RoleMembershipReviewPanel.tsx";
const compiled = ts.transpileModule(source(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
const component = { exports: {} };
const localRequire = (id) => {
  if (id === "react" || id === "react/jsx-runtime") return require(id);
  if (id.endsWith(".css")) return {};
  if (id.endsWith("/ClusterButton")) return { ClusterButton: ({ children, disabled, ...props }) =>
    React.createElement("button", { disabled, type: props.type }, children) };
  throw new Error("Unexpected import " + id);
};
new Function("exports", "module", "require", compiled.outputText)(component.exports, component, localRequire);
const { RoleMembershipReviewPanel } = component.exports;
const snapshot = {
  ownerId: "adminA", roleId: "qa", hasMore: true,
  items: [{ id: "1", displayName: "Test Member", username: "member1" }, { id: "2", username: "member2", archived: true }],
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(RoleMembershipReviewPanel, {
  roleId: "qa", snapshot, error: "", loading: false, onRefresh: () => {}, ...props,
}));
let passed = 0;
const test = (name, callback) => { callback(); passed++; console.log("PASS", name); };
test("On-demand review shows only returned workspace members and archived flags", () => {
  const html = render();
  assert.match(html, /Test Member/);
  assert.match(html, /@member1/);
  assert.match(html, /Archived/);
  assert.match(html, /additional assignments exist/);
  assert.doesNotMatch(html, /25 assigned members from this workspace/);
});
test("A role mismatch cannot render members from an earlier selection", () => {
  const html = render({ roleId: "producer" });
  assert.doesNotMatch(html, /Test Member/);
  assert.doesNotMatch(html, /@member1/);
  assert.match(html, /Review members/);
});
test("Errors are explicit and do not masquerade as an empty directory", () => {
  const html = render({ snapshot: null, error: "People access denied" });
  assert.match(html, /role="alert"/);
  assert.match(html, /People access denied/);
  assert.doesNotMatch(html, /No matching members/);
});
test("Zero member case states scope and time of the check", () => {
  const html = render({ snapshot: { roleId: "qa", ownerId: "adminA", items: [], hasMore: false } });
  assert.match(html, /No matching members in this workspace at the time of this check/);
  assert.match(html, /Showing 0 assigned members from this workspace/);
});
test("The review explains no ability to directly mutate assignments", () => {
  const html = render();
  assert.match(html, /Read-only, on-demand review/);
  assert.match(html, /made in People Management/);
  assert.match(html, /separate fresh server validation/);
  assert.match(html, /aria-label="Role assignment review"/);
});
test("Studio requests are bounded, fresh, and not persisted to local caches", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /async function loadRoleMembers\(roleId: string\)/);
  assert.match(page, /if \(!currentUser\.isAdmin \|\| section !== "roles"\) return/);
  assert.match(page, /limit=25&includeArchived=true/);
  assert.match(page, /force: true, staleMs: 0, persist: false/);
  assert.match(page, /Array\.isArray\(page\.items\)/);
  assert.match(page, /typeof page\.hasMore !== "boolean"/);
});
test("Account/role scope and request generations prevent stale private list disclosure", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /roleMemberReviewSequence\.current \+= 1/);
  assert.match(page, /\[currentUser\.id, selectedRoleId, section\]/);
  assert.match(page, /roleMemberReviewSequence\.current === sequence/);
  assert.match(page, /roleMemberSnapshot\?\.ownerId === currentUser\.id && roleMemberSnapshot\?\.roleId === selectedRole\.id/);
  assert.match(page, /setRoleMemberSnapshot\(null\)/);
});
test("Disable/remove always perform an independent fresh role-in-use check", () => {
  const page = source("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(page, /async function roleHasAssignments/);
  assert.match(page, /limit=1&includeArchived=true/);
  assert.equal((page.match(/await roleHasAssignments\(id\)/g) || []).length, 2);
  assert.match(page, /securityPin: pin/);
  assert.match(page, /expectedSettings/);
});
test("Member review styling remains compact and touch friendly", () => {
  const css = source("packages/renderer/src/features/settings/role-membership-review.css");
  for (const r of [/max-height:300px/, /overflow-y:auto/, /min-height:44px/, /@media\(pointer:coarse\)/, /@media\(max-width:620px\)/]) assert.match(css, r);
});
console.log(passed + "/" + passed + " role member review checks passed");

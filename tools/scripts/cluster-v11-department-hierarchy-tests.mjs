import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperPath = "packages/renderer/src/features/settings/department-hierarchy.ts";
const compiled = ts.transpileModule(read(helperPath), {
  fileName: helperPath, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { exports: mod.exports, module: mod }, { filename: helperPath });
const { projectDepartmentHierarchy, departmentAncestorIds } = mod.exports;

const departments = [
  { id: "frontend", name: "Frontend", parentId: "engineering", members: 2, teams: 1 },
  { id: "design", name: "Design", parentId: "studio", description: "Brand and visual art", members: 1, teams: 1 },
  { id: "studio", name: "Studio", members: 7, teams: 4 },
  { id: "engineering", name: "Engineering", parentId: "studio", members: 4, teams: 2 },
  { id: "backend", name: "Backend", parentId: "engineering", members: 2, teams: 1 },
];
let passed = 0;
function test(name, fn) { fn(); ++passed; console.log("PASS", name); }
const ids = (result) => Array.from(result.entries, (entry) => entry.row.id);

test("Tree sorts siblings by name and preserves parent-first order", () => {
  const projected = projectDepartmentHierarchy(departments, "", new Set());
  assert.deepEqual(ids(projected), ["studio", "design", "engineering", "backend", "frontend"]);
  assert.deepEqual(Array.from(projected.entries, (entry) => entry.depth), [0, 1, 1, 2, 2]);
  assert.equal(projected.total, 5);
  assert.equal(projected.rootCount, 1);
  assert.equal(projected.entries[0].hasChildren, true);
  assert.equal(projected.entries[1].hasChildren, false);
  assert.deepEqual(Array.from(projected.entries[3].ancestorNames), ["Studio", "Engineering"]);
});

test("Collapsed parent keeps its own row but hides all descendants", () => {
  const projected = projectDepartmentHierarchy(departments, "", new Set(["engineering"]));
  assert.deepEqual(ids(projected), ["studio", "design", "engineering"]);
  assert.equal(projected.entries.find((entry) => entry.row.id === "engineering").expanded, false);
  assert.equal(projected.matches, 5);
});

test("Search shows matching leaf and its ancestors regardless of collapsed state", () => {
  const projected = projectDepartmentHierarchy(departments, "backend", new Set(["studio", "engineering"]));
  assert.deepEqual(ids(projected), ["studio", "engineering", "backend"]);
  assert.deepEqual(Array.from(projected.entries, (entry) => entry.matchesSearch), [false, false, true]);
  assert.equal(projected.matches, 1);
  assert.equal(projected.entries[0].expanded, true);
});

test("Description search is scoped to already authorized rows", () => {
  const projected = projectDepartmentHierarchy(departments, "visual art", new Set());
  assert.deepEqual(ids(projected), ["studio", "design"]);
  assert.equal(projected.matches, 1);
});

test("Missing parent stays visible with a warning, not silently dropped", () => {
  const projected = projectDepartmentHierarchy([
    { id: "one", name: "Orphan", parentId: "gone" },
    { id: "two", name: "Real root" },
  ], "", new Set());
  assert.deepEqual(ids(projected), ["one", "two"]);
  assert.equal(projected.rootCount, 2);
  assert.equal(projected.entries[0].orphanedParent, true);
});

test("Self-parenting and multi-node cycles are broken in the display projection", () => {
  const projected = projectDepartmentHierarchy([
    { id: "A", name: "A", parentId: "B" },
    { id: "B", name: "B", parentId: "A" },
    { id: "C", name: "C", parentId: "C" },
    { id: "D", name: "D", parentId: "A" },
  ], "", new Set());
  assert.deepEqual(ids(projected), ["A", "B", "C", "D"]);
  assert.equal(projected.entries.length, 4);
  assert.ok(projected.entries.every((entry) => entry.orphanedParent));
  assert.deepEqual(Array.from(departmentAncestorIds([{ id: "A", name: "A", parentId: "B" }, { id: "B", name: "B", parentId: "A" }], "A")), []);
});

test("Ancestor navigation for Reveal selected is stable and ordered", () => {
  assert.deepEqual(Array.from(departmentAncestorIds(departments, "frontend")), ["engineering", "studio"]);
  assert.deepEqual(Array.from(departmentAncestorIds(departments, "studio")), []);
});

test("Projection never mutates the source records or collapse state", () => {
  const before = JSON.stringify(departments);
  const collapsed = new Set(["studio"]);
  projectDepartmentHierarchy(departments, "frontend", collapsed);
  assert.equal(JSON.stringify(departments), before);
  assert.deepEqual(Array.from(collapsed), ["studio"]);
});

test("Manager renders a semantic list of disclosure and selection controls", () => {
  const source = read("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx");
  assert.match(source, /projectDepartmentHierarchy\(rows, search, collapsedDepartmentIds\)/);
  assert.match(source, /<ul className="studio-workforce-department-list-rows-v11" aria-label="Department hierarchy">/);
  assert.match(source, /aria-expanded=\{entry.expanded\}/);
  assert.match(source, /aria-label=\{\x60\$\{entry.expanded \? "Collapse" : "Expand"\}/);
  assert.match(source, /aria-current=\{!creating && selectedId === row.id/);
  assert.match(source, /Reveal selected/);
  assert.match(source, /aria-label="Saved department location"/);
  assert.match(source, /disabled=\{Boolean\(search.trim\(\)\) \|\| saving\}/);
  const compiledManager = ts.transpileModule(source, {
    fileName: "WorkforceDepartmentManager.tsx",
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((compiledManager.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0);
});

test("Hierarchy is not a second authority for server mutations", () => {
  const manager = read("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx");
  assert.match(manager, /entities=\{departmentParentChoices\(rows, invalidParents, draft.parentId\)\}/);
  assert.match(manager, /expectedRevision: selected!\.revision/);
  assert.match(manager, /confirmDiscard\(\)/);
  assert.match(manager, /if \(!canEdit \|\| saving\) return/);
  assert.match(manager, /onClick=\{\(\) => void choose\(row.id\)\}/);
  assert.doesNotMatch(read(helperPath), /\bfetch\(|\bqueryApi\(|\bapi\(/);
});

test("Hierarchy controls retain focus and mobile-sized touch targets", () => {
  const css = read("packages/renderer/src/features/settings/workforce-department-manager.css");
  for (const regex of [/:focus-visible/, /min-height:44px/, /overflow:auto/, /@media\(pointer:coarse\)/, /@media\(max-width:620px\)/]) assert.match(css, regex);
});
console.log(`${passed}/${passed} department hierarchy UI checks passed`);

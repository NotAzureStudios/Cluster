import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const postcss = require("postcss");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperFile = "packages/renderer/src/features/projects/project-inspector-focus.ts";
const loaded = { exports: {} };
const compiled = ts.transpileModule(read(helperFile), {
  fileName: helperFile, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
vm.runInNewContext(compiled.outputText, { exports: loaded.exports, module: loaded });
const { projectInspectorReturnFocus } = loaded.exports;

let count = 0;
function test(name, fn) { fn(); ++count; console.log("PASS", name); }
const trigger = { id: "floating-menu-item" };
const rowA = { id: "row-a" }, rowB = { id: "row-b" };
const fakeRoot = {
  querySelectorAll(selector) {
    assert.equal(selector, "[data-project-id]");
    return [
      { dataset: { projectId: "p1" }, querySelector: (selector) => selector === ".project-row-select-v370" ? rowA : null },
      { dataset: { projectId: "p2" }, querySelector: (selector) => selector === ".project-row-select-v370" ? rowB : null },
    ];
  },
};
test("Return focus resolves the exact Project card, not the next visible card", () => {
  assert.equal(projectInspectorReturnFocus("p1", trigger, fakeRoot), rowA);
  assert.equal(projectInspectorReturnFocus("p2", trigger, fakeRoot), rowB);
});
test("A virtualized/filtered card safely falls back to the original trigger", () => {
  assert.equal(projectInspectorReturnFocus("missing", trigger, fakeRoot), trigger);
  assert.equal(projectInspectorReturnFocus("p1", trigger, { querySelectorAll: () => [{ dataset: { projectId: "p1" }, querySelector: () => null }] }), trigger);
});
test("Arbitrary Project identifiers are compared literally, not injected into a selector", () => {
  const unsafe = `a"] [data-admin="true`;
  assert.equal(projectInspectorReturnFocus(unsafe, trigger, fakeRoot), trigger);
  const contract = read(helperFile);
  assert.match(contract, /card\.dataset\.projectId !== projectId/);
  assert.doesNotMatch(contract, /CSS\.escape|\+ projectId|\$\{projectId\}/);
});
test("Project tile offers a stable identity for restoring list focus", () => {
  const item = read("packages/renderer/src/features/projects/ProjectPortfolioItem.tsx");
  assert.match(item, /data-project-id=\{project\.id\}/);
  assert.match(item, /onClick=\{onInspect\}/);
  assert.match(item, /onInspect: \(event: MouseEvent<HTMLButtonElement>\)/);
  assert.match(item, /className="project-row-select-v370"/);
});
test("Inspector is explicitly nonmodal, announced, keyboard-dismissible and labeled", () => {
  const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  assert.match(page, /ref=\{inspectorPanelRef\} role="dialog" aria-modal="false"/);
  assert.match(page, /aria-labelledby="projects-browser-inspector-heading-rc25"/);
  assert.match(page, /aria-describedby="projects-browser-inspector-help-v11"/);
  assert.match(page, /tabIndex=\{-1\} className="projects-browser-inspector-shell-rc25"/);
  assert.match(page, /event\.key !== "Escape" \|\| event\.defaultPrevented/);
  assert.match(page, /event\.stopPropagation\(\);[\s\S]*?dismissInspector\(\)/);
  assert.match(page, /onClick=\{dismissInspector\} aria-label="Close project details"/);
  assert.match(page, /Press Escape to close and return to the project list/);
});
test("Opening focuses only once and closing returns to the tile or search", () => {
  const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  assert.match(page, /\[inspectorOpen\]\);/);
  assert.match(page, /if \(inspectorOpen\) inspectorPanelRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /projectInspectorReturnFocus\(projectId, trigger, document\)/);
  assert.match(page, /onInspect=\{\(event\) => openInspector\(fact\.project\.id, event\.currentTarget\)\}/);
  assert.match(page, /if \(returnTo\?\.isConnected\) returnTo\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /else searchRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(page, /document\.addEventListener\("keydown", .+inspector/);
});
test("Styles preserve overflow, short displays, mobile bottom sheet and focus indicator", () => {
  const css = read("packages/renderer/src/features/projects/projects.css");
  assert.ok(postcss.parse(css).nodes.length);
  for (const exp of [/:focus-visible/, /@media\(pointer:coarse\)/, /@media\(max-width:680px\)/, /@media\(max-height:520px\)/, /82dvh/, /safe-area-inset-bottom/, /min-height:44px/]) assert.match(css, exp);
});
test("Project portfolio remains permission-scoped and query behavior is unchanged", () => {
  const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  assert.match(page, /project={selectedProject}/);
  assert.match(page, /onOpenProject=\{onOpenProject\}/);
  assert.match(page, /onOpenBoard=\{onOpenBoard\}/);
  assert.match(page, /onOpenReports=\{onOpenReports\}/);
  assert.doesNotMatch(read(helperFile), /\bapi\(|\bqueryApi\(|\bfetch\(/);
});
for (const file of ["packages/renderer/src/features/projects/ProjectsPage.tsx", "packages/renderer/src/features/projects/ProjectPortfolioItem.tsx"]) {
  assert.equal(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0, file);
}
console.log(`${count}/${count} Project inspector accessibility tests passed`);

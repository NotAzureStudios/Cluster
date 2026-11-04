import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function compile(file, tsx) {
  const out = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      ...(tsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  });
  const errors = (out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, file + " TypeScript errors: " + errors.map(x => x.messageText).join("; "));
  return out.outputText;
}
function loadComponent(file) {
  const mod = { exports: {} };
  const js = compile(file, true);
  // Restrict the test harness to the local component's declared imports.
  const imports = id => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return require(id);
    if (id.endsWith(".css")) return {};
    throw new Error("Unexpected component dependency: " + id);
  };
  new Function("exports", "module", "require", js)(mod.exports, mod, imports);
  return mod.exports;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS", name); }
const { ClusterPermissionMatrix } = loadComponent("packages/renderer/src/components/ClusterPermissionMatrix.tsx");
const base = {
  label: "Studio permissions",
  groups: [{ id: "production", label: "Production", description: "Project tools", rows: [
    { key: "boards", label: "Boards", description: "Manage board cards" },
    { key: "vault", label: "Vault", description: "Secrets" },
  ] }],
  choices: ["inherit", "none", "view", "edit", "manage"].map(value => ({ value, label: value })),
  inherited: { boards: "view", vault: "none" },
  fallbackEffective: "none",
  inheritValue: "inherit",
  onChange: () => {},
};
const render = props => renderToStaticMarkup(React.createElement(ClusterPermissionMatrix, { ...base, ...props }));

test("Every permission renders a native radio group with correct five-level states", () => {
  const html = render({ value: { boards: "edit" } });
  assert.equal((html.match(/type="radio"/g) || []).length, 10);
  assert.equal((html.match(/checked=""/g) || []).length, 2);
  assert.match(html, /aria-label="Boards: edit"/);
  assert.match(html, /aria-label="Vault: inherit"/);
  assert.match(html, /role="region"/);
  assert.match(html, /scope="row"/);
  assert.match(html, /scope="col"/);
});
test("Overrides and effective access distinguish explicit None from inherited None", () => {
  const html = render({ value: { boards: "none" } });
  assert.match(html, /1 \/ 2 overrides/);
  assert.match(html, /Explicit none/);
  assert.match(html, /Inherited none/);
  assert.match(html, /data-override="explicit"/);
  assert.match(html, /data-override="inherited"/);
});
test("Unknown baseline has a conservative no-access fallback", () => {
  const html = render({ inherited: {}, value: {} });
  assert.match(html, /Inherited none/);
  assert.doesNotMatch(html, /Inherited manage/);
});
test("Read-only mode disables all choices and displays state", () => {
  const html = render({ readOnly: true });
  assert.equal((html.match(/disabled=""/g) || []).length, 10);
  assert.match(html, /Read only/);
});
test("Descriptive metadata is available to screen readers but not a wall of text", () => {
  const html = render({ value: { boards: "view" } });
  assert.match(html, /aria-describedby="/);
  assert.match(html, /Manage board cards/);
  assert.match(html, /Baseline: view/);
  assert.match(html, /Effective/);
});
test("Studio permission editor preserves domain-owned writes and readonly guards", () => {
  const src = read("packages/renderer/src/features/application/modules/application-automation-settings.tsx");
  assert.match(src, /<ClusterPermissionMatrix<ToolPermissionKey, ToolPermissionLevel \| "inherit">/);
  assert.match(src, /onChange=\{onChange\}/);
  assert.match(src, /readOnly=\{readOnly\}/);
  assert.match(src, /inheritValue="inherit"/);
  assert.match(src, /fallbackEffective="none"/);
  assert.match(src, /permissions\?: ToolPermissions/);
  assert.match(src, /inherited: ToolPermissions/);
  assert.doesNotMatch(src.slice(src.indexOf("export function StudioPermissionEditor")), /<ClusterNativeSelect/);
});
test("All existing tool domains appear in exactly one visible access group", () => {
  const src = read("packages/renderer/src/features/application/modules/application-automation-settings.tsx");
  const start = src.indexOf("export const STUDIO_PERMISSION_GROUPS:");
  const end = src.indexOf("/** Inherit is a real draft choice", start);
  assert.ok(start > 0 && end > start);
  const block = src.slice(start, end);
  const found = [...block.matchAll(/tools:\s*\[([^\]]+)\]/g)]
    .flatMap(match => [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]));
  const expected = [
    "mywork","inbox","projects","boards","whiteboards","viewer","timeline","builds","qa",
    "tickets","calendar","scheduler","library","packets","inventory","vault","sourceControl",
    "integrations","people","activity","settings","serverConfig",
  ];
  assert.deepEqual([...found].sort(), expected.sort());
  assert.equal(new Set(found).size, found.length);
});
test("Matrix remains navigable on narrow displays with adequate touch targets", () => {
  const css = read("packages/renderer/src/components/cluster-permission-matrix.css");
  for (const matcher of [/overflow-x: auto/, /position: sticky/, /:focus-visible/, /pointer: coarse/, /min-height: 48px/, /--accent/]) assert.match(css, matcher);
});
console.log(passed + "/" + passed + " permission matrix regressions passed");

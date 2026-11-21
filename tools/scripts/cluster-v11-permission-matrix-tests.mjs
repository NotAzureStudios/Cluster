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
    if (id === "./ClusterIcon") return { ClusterIcon: () => null };
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

// One line per tool: a radiogroup of the four levels; the effective level is
// the checked one, marked as inherited or override.
test("Every permission renders a radiogroup whose checked level is the effective level", () => {
  const html = render({ value: { boards: "edit" } });
  assert.equal((html.match(/role="radio"/g) || []).length, 8);
  assert.equal((html.match(/role="radiogroup"/g) || []).length, 2);
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 2);
  assert.match(html, /aria-label="Boards access"/);
  assert.match(html, /aria-checked="true" data-lit="override"[^>]*>edit</);
  assert.match(html, /aria-checked="true" data-lit="inherited"[^>]*>none</);
});
test("Overrides and effective access distinguish explicit None from inherited None", () => {
  const html = render({ value: { boards: "none" } });
  assert.match(html, /Overrides<b>1<\/b>/);
  assert.equal((html.match(/data-lit="override"/g) || []).length, 1);
  assert.equal((html.match(/data-lit="inherited"/g) || []).length, 1);
  assert.equal((html.match(/data-override="true"/g) || []).length, 1);
  assert.match(html, /aria-label="Reset Boards to inherited view"/);
});
test("Unknown baseline has a conservative no-access fallback", () => {
  const html = render({ inherited: {}, value: {} });
  assert.equal((html.match(/data-lit="inherited"[^>]*>none</g) || []).length, 2);
  assert.doesNotMatch(html, /data-lit="[a-z]+"[^>]*>manage</);
});
test("Read-only mode disables all choices and displays state", () => {
  const html = render({ readOnly: true });
  assert.equal((html.match(/role="radio"[^>]*disabled=""/g) || []).length, 8);
  assert.match(html, /Read only/);
  assert.doesNotMatch(html, /Reset /);
});
test("Descriptions are available on hover, not as a wall of text", () => {
  const html = render({ value: { boards: "view" } });
  assert.match(html, /title="Manage board cards"/);
  assert.doesNotMatch(html, /Choose a level per tool/);
});
test("Choosing the inherited level returns the tool to inherit", () => {
  const source = read("packages/renderer/src/components/ClusterPermissionMatrix.tsx");
  assert.match(source, /onChange\(row\.key, level\.value === baseline \? inheritValue : level\.value\)/);
  assert.match(source, /onChange\(row\.key, inheritValue\)/);
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
test("Permission search and overrides filter are local controlled inputs", () => {
  const source = read("packages/renderer/src/components/ClusterPermissionMatrix.tsx");
  assert.match(source, /const \[search, setSearch\] = useState\(""/);
  assert.match(source, /const \[overridesOnly, setOverridesOnly\] = useState\(false\)/);
  assert.match(source, /const isOverride = \(key: Key\) => value\?\.\[key\] !== undefined && value\?\.\[key\] !== inheritValue/);
  assert.match(source, /overridesOnly && !isOverride\(row\.key\)/);
  assert.match(source, /type="search" value=\{search\}/);
  assert.match(source, /aria-pressed=\{overridesOnly\}/);
  assert.match(source, /No tools match/);
  assert.doesNotMatch(source, /fetch\(|queryApi\(|setInterval/);
});
test("Design system gallery exercises inheritance without persisting a fake explicit override", () => {
  const preview = read("packages/renderer/src/components/DesignSystemPreview.tsx");
  assert.match(preview, /Interactive permission matrix/);
  assert.match(preview, /<ClusterPermissionMatrix<"boards" \| "vault"/);
  assert.match(preview, /if \(level === "inherit"\) delete next\[tool\]/);
  compile("packages/renderer/src/components/DesignSystemPreview.tsx", true);
});
test("Matrix remains navigable on narrow displays with adequate touch targets", () => {
  const css = read("packages/renderer/src/components/cluster-permission-matrix.css");
  // Fixed-width level columns keep every row aligned; focus is visible; narrow screens shrink columns.
  for (const matcher of [/grid-auto-columns: 64px/, /grid-template-columns: minmax\(120px, 1fr\) auto 26px/, /:focus-visible/, /@media \(max-width: 640px\)/, /--accent/]) assert.match(css, matcher);
});
console.log(passed + "/" + passed + " permission matrix regressions passed");

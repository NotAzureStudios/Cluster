import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const file = "packages/renderer/src/features/projects/ProjectPortfolioItem.tsx";
const compiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const diagnosticErrors = (compiled.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error);
assert.equal(diagnosticErrors.length, 0, diagnosticErrors.map((x) => String(x.messageText)).join(", "));

const mod = { exports: {} };
const Button = ({ children, unstyled: _unstyled, variant: _variant, selected: _selected, size: _size, ...props }) =>
  React.createElement("button", { ...props, type: "button" }, children);
function stubRequire(request) {
  if (request === "react" || request === "react/jsx-runtime") return require(request);
  if (request.includes("project-portfolio-model")) return {
    projectScheduleMeta: () => ({ label: "Due in 9d", tone: "good", detail: "On schedule" }),
  };
  if (request.includes("runtime-style")) return { runtimeStyle: () => ({}) };
  if (request.includes("ClusterButton")) return { ClusterButton: Button, ClusterIconButton: Button };
  if (request.includes("ClusterIcon")) return { ClusterIcon: ({ name }) => React.createElement("span", { "data-icon": name }) };
  if (request.includes("ResourceIdentityMark")) return { ResourceIdentityMark: ({ label }) => React.createElement("span", { "data-project-mark": label }) };
  if (request.includes("ClusterVisualMetrics")) return { ClusterMiniRing: ({ label, percent }) => React.createElement("span", { "data-ring": label }, percent, "%") };
  if (request.includes("ClusterContextActions")) return {
    ClusterRowActions: ({ children, label }) => React.createElement("div", { "aria-label": label }, children),
  };
  throw new Error("Unexpected dependency: " + request);
}
new Function("exports", "module", "require", compiled.outputText)(mod.exports, mod, stubRequire);
const { ProjectPortfolioItem } = mod.exports;
const project = {
  id: "test-project", name: "Wildlife Simulator", objective: "Create a responsive and accessible ecosystem simulation",
  description: "Alternate project description", projectType: "unreal", status: "active",
  color: "#57c1ff", priority: "medium", boards: [], tags: [],
};
const baseline = {
  project, selected: false, pinned: false, density: "comfortable",
  health: { label: "On track", tone: "good" },
  completeness: 68, stageLabel: "Planning", statusLabel: "Active",
  typeLabel: "Unreal Engine", gaps: ["Add team members", "Set target date"],
  memberCount: 3, onSelect: () => {}, onInspect: () => {}, onTogglePin: () => {},
};
const render = (changes = {}) => renderToStaticMarkup(React.createElement(ProjectPortfolioItem, { ...baseline, ...changes }));
let count = 0;
function test(label, check) { check(); count++; console.log("PASS", label); }

test("Comfortable project card shows type, objective and indicators", () => {
  const html = render();
  assert.match(html, /Unreal Engine/);
  assert.match(html, /Create a responsive and accessible ecosystem simulation/);
  assert.doesNotMatch(html, /Alternate project description/);
  // Gaps are an indicator (count) with the gap names in the tooltip.
  assert.match(html, /title="Add team members · Set target date"/);
  assert.match(html, /data-icon="warning"[^>]*><\/span>2</);
  assert.match(html, /Planning/);
  assert.match(html, /9d/);
  assert.match(html, /title="3 people"/);
  assert.match(html, /data-ring="Ready">68/);
});

test("Compact density keeps identity and drops the objective", () => {
  const html = render({ density: "compact" });
  assert.match(html, /Unreal Engine/);
  assert.doesNotMatch(html, /pl-card__summary/);
  assert.doesNotMatch(html, /aria-describedby=/);
});

test("Description is shown only when an objective is absent", () => {
  const html = render({ project: { ...project, objective: "", description: "An archived game trailer" } });
  assert.match(html, /An archived game trailer/);
  assert.doesNotMatch(html, /responsive and accessible/);
});

test("Missing descriptions remain empty, not invented", () => {
  const html = render({ project: { ...project, objective: null, description: null }, gaps: [] });
  assert.doesNotMatch(html, /pl-card__summary/);
  assert.doesNotMatch(html, /data-icon="warning"/);
  assert.doesNotMatch(html, /aria-describedby=/);
});

test("Keyboard selection includes project type and the visible objective", () => {
  const html = render();
  assert.match(html, /aria-labelledby="project-portfolio-title-test-project project-portfolio-type-test-project"/);
  assert.match(html, /aria-describedby="project-portfolio-summary-test-project"/);
  assert.match(html, /id="project-portfolio-type-test-project"/);
  assert.match(html, /id="project-portfolio-summary-test-project"/);
});

test("Portfolio selection, inspection and pin actions are preserved", () => {
  const html = render({ selected: true, pinned: true });
  assert.match(html, /class="pl-card__hit"/);
  assert.match(html, /data-selected="true"/);
  assert.match(html, /data-pinned="true"/);
  assert.match(html, /Unstar Wildlife Simulator/);
  assert.match(html, /Details for Wildlife Simulator/);
});

test("Source reuses already-supplied portfolio information without fetching or mutation", () => {
  const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  const item = read(file);
  for (const prop of ["typeLabel={projectTypeBadge(fact.project)}", "gaps={fact.gaps}", "stageLabel={fact.stage.label}", "density={density}"]) assert.ok(page.includes(prop), prop);
  assert.doesNotMatch(item, /\bfetch\(|\bapi\(|\bqueryApi\(/);
});

test("Styles clamp long text and keep the list layout to one line", () => {
  const css = read("packages/renderer/src/features/projects/projects-list.css");
  assert.match(css, /\.pl-card__summary \{[^}]*-webkit-line-clamp: 2/);
  assert.match(css, /\.pl-card__id strong \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.pl-list--list \.pl-card__summary \{ display: none; \}/);
});
console.log(`${count}/${count} project portfolio context tests passed`);

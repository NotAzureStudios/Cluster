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
  if (request.includes("ClusterVisualMetrics")) return { ClusterVisualRing: ({ label, percent }) => React.createElement("span", null, label, " ", percent, "%") };
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

test("Comfortable project card visibly exposes type, objective and gaps", () => {
  const html = render();
  assert.match(html, /Unreal Engine/);
  assert.match(html, /Create a responsive and accessible ecosystem simulation/);
  assert.doesNotMatch(html, /Alternate project description/);
  assert.match(html, /2 setup gaps/);
  assert.match(html, /Planning/);
  assert.match(html, /Due in 9d/);
  assert.match(html, /3<\/span>/);
});

test("Compact density retains identity but avoids a wall of detail", () => {
  const html = render({ density: "compact" });
  assert.match(html, /Unreal Engine/);
  assert.doesNotMatch(html, /project-tile-summary-rc25/);
  assert.doesNotMatch(html, /setup gaps/);
  assert.doesNotMatch(html, /<footer/);
});

test("Description is shown only when an objective is absent", () => {
  const html = render({ project: { ...project, objective: "", description: "An archived game trailer" } });
  assert.match(html, /An archived game trailer/);
  assert.doesNotMatch(html, /responsive and accessible/);
});

test("Missing descriptions remain empty, not invented", () => {
  const html = render({ project: { ...project, objective: null, description: null }, gaps: [] });
  assert.doesNotMatch(html, /project-tile-summary-rc25/);
  assert.doesNotMatch(html, /setup gap/);
  assert.doesNotMatch(html, /aria-describedby=/);
});

test("Keyboard selection includes project type and actual visible brief", () => {
  const html = render();
  assert.match(html, /aria-labelledby="project-portfolio-title-test-project project-portfolio-type-test-project"/);
  assert.match(html, /aria-describedby="project-portfolio-summary-test-project"/);
  assert.match(html, /id="project-portfolio-type-test-project"/);
  assert.match(html, /id="project-portfolio-summary-test-project"/);
  const compact = render({ density: "compact" });
  assert.doesNotMatch(compact, /aria-describedby=/);
});

test("Portfolio selection, inspection and pin actions are preserved", () => {
  const html = render({ selected: true, pinned: true });
  assert.match(html, /project-row-select-v370/);
  assert.match(html, /project-tile-identity-rc25/);
  assert.match(html, /Unstar Wildlife Simulator/);
  assert.match(html, /Details/);
  assert.match(html, /project-tile-rc25 selected pinned/);
});

test("Source reuses already-supplied portfolio information without fetching or mutation", () => {
  const page = read("packages/renderer/src/features/projects/ProjectsPage.tsx");
  const item = read(file);
  for (const prop of ["typeLabel={projectTypeBadge(fact.project)}", "gaps={fact.gaps}", "stageLabel={fact.stage.label}", "density={density}"]) assert.ok(page.includes(prop), prop);
  assert.doesNotMatch(item, /\bfetch\(|\bapi\(|\bqueryApi\(/);
  assert.match(item, /density === "comfortable" && summary/);
  assert.match(item, /gaps.length > 0/);
});

test("Styles clamp long summaries and prevent type overflow", () => {
  const css = read("packages/renderer/src/features/projects/projects.css");
  assert.match(css, /\.project-tile-summary-rc25\{[^}]*-webkit-line-clamp:2/);
  assert.match(css, /\.project-tile-identity-rc25 \.project-tile-type-rc25/);
  assert.match(css, /\.project-tile-tags-rc25 \.project-tile-gaps-rc25/);
  assert.match(css, /\.project-list-list-v307 \.project-tile-summary-rc25/);
});
console.log(`${count}/${count} project portfolio context tests passed`);

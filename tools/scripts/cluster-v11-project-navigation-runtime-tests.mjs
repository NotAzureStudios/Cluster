import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const src = (name) => "packages/renderer/src/features/projects/" + name;
function load(file) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const errors = (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, file + ": " + errors.map((e) => String(e.messageText)).join(", "));
  vm.runInNewContext(compiled.outputText, { exports: mod.exports, module: mod, URL }, { filename: file });
  return mod.exports;
}
const location = load(src("project-tab-location.ts"));
const primary = load(src("project-primary-tabs.ts"));
const allowed = new Set(["overview", "plan", "control", "intelligence", "qa", "viewer", "boards", "people", "builds", "tickets"]);
const { projectTabFromUrl, projectTabForWorkspace, projectTabLocation, needsProjectTabLocation } = location;
const { projectPrimaryTabIds } = primary;
let checks = 0;
function test(name, callback) { callback(); checks++; console.log("PASS " + name); }

test("A Project A link never selects the same tab on Project B", () => {
  const url = "https://cluster.local/app?projectTab=intelligence&projectTabProject=project-a#project";
  assert.equal(projectTabFromUrl(url, "project-a", allowed), "intelligence");
  assert.equal(projectTabFromUrl(url, "project-b", allowed), null);
  assert.equal(projectTabForWorkspace(url, "project-b", "plan", allowed), "plan");
  assert.equal(projectTabForWorkspace(url, "project-b", "not-a-tool", allowed), "overview");
});
test("Missing and malformed tab ownership fail closed", () => {
  for (const url of [
    "https://cluster.local/app?projectTab=qa#project",
    "https://cluster.local/app?projectTab=qa&projectTabProject=project-b#project",
    "https://cluster.local/app?projectTab=undefined&projectTabProject=project-a#project",
  ]) assert.equal(projectTabFromUrl(url, "project-a", allowed), null);
  assert.equal(projectTabFromUrl("not a url", "project-a", allowed), null);
  assert.equal(projectTabFromUrl(null, "project-a", allowed), null);
  assert.equal(projectTabFromUrl("https://cluster.local/app", null, allowed), null);
});
test("Project tab changes preserve unrelated filters and route hash", () => {
  const oldUrl = "https://cluster.local/app?inspect=pinned&status=active#project=project-a";
  const next = projectTabLocation(oldUrl, "project-a", "viewer");
  assert.match(next, /inspect=pinned/);
  assert.match(next, /status=active/);
  assert.match(next, /projectTab=viewer/);
  assert.match(next, /projectTabProject=project-a/);
  assert.match(next, /#project=project-a$/);
  assert.equal(projectTabFromUrl("https://cluster.local" + next, "project-a", allowed), "viewer");
  assert.equal(needsProjectTabLocation("https://cluster.local" + next, "project-a", "viewer", allowed), false);
  assert.equal(needsProjectTabLocation("https://cluster.local" + next, "project-a", "qa", allowed), true);
});
test("Per-project stored choice and default Overview are validated", () => {
  assert.equal(projectTabForWorkspace("https://cluster.local/", "project-a", "qa", allowed), "qa");
  assert.equal(projectTabForWorkspace("https://cluster.local/", "project-a", "removed-tool", allowed), "overview");
  assert.equal(projectTabForWorkspace(null, null, null, allowed), "overview");
});
test("Primary navigation promotes an active More tool while preserving first-priority choices", () => {
  const items = ["overview", "plan", "tickets", "builds", "boards", "people", "qa", "intelligence"].map((id) => ({ id }));
  const requested = ["overview", "plan", "tickets", "builds", "boards", "people"];
  assert.deepEqual(Array.from(projectPrimaryTabIds(items, requested, "qa")), ["overview", "plan", "tickets", "builds", "boards", "qa"]);
  assert.deepEqual(Array.from(projectPrimaryTabIds(items, requested, "overview")), requested);
  assert.deepEqual(Array.from(projectPrimaryTabIds(items, requested, "not-allowed")), requested);
  assert.deepEqual(Array.from(projectPrimaryTabIds(items, requested, "intelligence", 3)), ["overview", "plan", "intelligence"]);
});
test("Primary selection remains unique, bounded and handles empty or disabled choices", () => {
  assert.deepEqual(Array.from(projectPrimaryTabIds([{ id: "overview" }, { id: "qa" }], ["overview", "overview", "absent"], "qa")), ["overview", "qa"]);
  assert.deepEqual(Array.from(projectPrimaryTabIds([{ id: "qa" }], [], "qa")), ["qa"]);
  assert.deepEqual(Array.from(projectPrimaryTabIds([], [], "qa")), []);
  assert.deepEqual(Array.from(projectPrimaryTabIds([{ id: "qa" }], [], "qa", 0)), []);
});
test("Hook never writes browser history from a React updater", () => {
  const hook = read(src("useProjectDetailWorkspace.ts"));
  const writer = hook.slice(hook.indexOf("const setTab = useCallback"), hook.indexOf("const [storedTabs,"));
  assert.match(writer, /const current = tabRef\.current/);
  assert.match(writer, /setTabState\(resolved\)/);
  assert.match(writer, /writeProjectTabToLocation\(projectId, resolved, "push"\)/);
  assert.doesNotMatch(writer, /setTabState\(\(current\) =>/);
  assert.doesNotMatch(hook, /historyRestoreRef/);
  assert.doesNotMatch(hook, /window\.setTimeout\(\(\) => \{ historyRestoreRef/);
});
test("Hook gates per-project history, stored tabs, and stale responses", () => {
  const hook = read(src("useProjectDetailWorkspace.ts"));
  assert.match(hook, /projectTabForWorkspace\(/);
  assert.match(hook, /projectTabFromUrl\(window\.location\.href, projectId, PROJECT_WORKSPACE_TABS\)/);
  assert.match(hook, /tabOwner !== projectId/);
  assert.match(hook, /activeProjectRef\.current === projectId/);
  assert.match(hook, /window\.addEventListener\("popstate", restore\)/);
  assert.match(hook, /if \(!PROJECT_WORKSPACE_TABS\.has\(resolved\) \|\| resolved === current\) return/);
  assert.match(hook, /clusterProjectTabProject: projectId/);
});
test("Intelligence is deferred to its visible tool section, not fetched on initial project open", () => {
  const hook = read(src("useProjectDetailWorkspace.ts"));
  const initial = hook.slice(hook.indexOf("  useEffect(() => {\n    if (!storedTabsState.hydrated)"), hook.indexOf("  useEffect(() => {\n    if (!projectId || !storedTabsState.hydrated || tabOwner"));
  assert.doesNotMatch(initial, /loadProjectIntelligence\(/);
  assert.match(hook, /tabOwner !== projectId \|\| tab !== "intelligence"/);
  assert.match(hook, /loadProjectIntelligence\(\)\.catch/);
});
test("Project nav and breadcrumb use the same visible authorized tool inventory", () => {
  const nav = read(src("ProjectWorkspaceNav.tsx"));
  const header = read(src("ProjectDetailHeader.tsx"));
  const detail = read(src("ProjectDetailPage.tsx"));
  const shared = read("packages/renderer/src/components/CompactSectionNav.tsx");
  assert.match(nav, /projectPrimaryTabIds\(items, requestedPrimaryIds\?\.length \? requestedPrimaryIds : PRIMARY_PROJECT_SECTIONS, activeId\)/);
  assert.match(header, /activeSectionLabel = tabs\.find/);
  assert.match(header, /aria-current="page" className="project-breadcrumb-current-v11"/);
  assert.match(detail, /\.filter\(\(item\) => !hiddenToolIds\.has/);
  assert.match(shared, /pendingPromotedFocusRef\.current === activeId/);
  assert.match(shared, /focus\(\{ preventScroll: true \}\)/);
});
test("Styles do not rely only on color and preserve touch and reduced-motion behavior", () => {
  const css = read(src("project-detail-workspace.css"));
  for (const exp of [/project-breadcrumb-current-v11/, /min-height:44px/, /@media\(pointer:coarse\)/, /@media\(prefers-reduced-motion:reduce\)/]) assert.match(css, exp);
});
for (const file of ["project-tab-location.ts", "project-primary-tabs.ts", "useProjectDetailWorkspace.ts", "ProjectWorkspaceNav.tsx", "ProjectDetailHeader.tsx"]) {
  const source = read(src(file));
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length, 0, file + ": parse diagnostics");
}
console.log(`${checks}/${checks} Project navigation and request tests passed.`);

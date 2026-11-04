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
const board = (name) => "packages/renderer/src/features/boards/" + name;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const file = board("board-dependency-graph-projection.ts");
const compiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
vm.runInNewContext(compiled.outputText, { exports: module.exports, module, Set, Math, Number });
const { projectBoardDependencyGraph } = module.exports;
const edge = (i, sourceCardId, targetCardId, relationship = "blocks") => ({
  id: "r" + i, sourceCardId, targetCardId, relationship, blocking: relationship === "blocks", critical: false,
});
let count = 0;
const test = (label, fn) => { fn(); count++; console.log("PASS " + label); };

test("Project-heavy edges cannot consume the 24 local node slots", () => {
  const deps = [
    ...Array.from({ length: 70 }, (_, i) => edge(i, "projected" + i, "external" + i)),
    edge(100, "local-a", "local-b"),
    edge(101, "projected-p", "local-c"),
  ];
  const graph = projectBoardDependencyGraph(deps, new Set(["local-a", "local-b", "local-c"]), new Set());
  assert.deepEqual(Array.from(graph.visibleIds), ["local-a", "local-b", "local-c"]);
  assert.equal(graph.localNodeCount, 3);
  assert.equal(graph.localEdgeCount, 1);
  assert.equal(graph.crossBoardEdgeCount, 1);
  assert.equal(graph.visibleEdges.length, 1);
  assert.equal(graph.visibleEdges[0].id, "r100");
});

test("Actionable blocked local Cards are prioritized before graph capacity is exhausted", () => {
  const deps = Array.from({ length: 40 }, (_, i) => edge(i, "l" + i, "l" + (i + 1)));
  const localIds = new Set(Array.from({ length: 41 }, (_, i) => "l" + i));
  const graph = projectBoardDependencyGraph(deps, localIds, new Set(["l39", "l40", "l7"]));
  assert.deepEqual(Array.from(graph.visibleIds.slice(0, 3)), ["l7", "l39", "l40"]);
  assert.equal(graph.visibleIds.length, 24);
  assert.equal(graph.localNodeCount, 41);
  assert.equal(graph.hiddenLocalNodeCount, 17);
  assert.equal(graph.visibleEdges.length <= 36, true);
});

test("All graph edge counts remain truthful even when visual edges are capped", () => {
  const deps = Array.from({ length: 90 }, (_, i) => edge(i, "a", "b"));
  const graph = projectBoardDependencyGraph(deps, new Set(["a", "b"]), new Set(), 24, 36);
  assert.equal(graph.localNodeCount, 2);
  assert.equal(graph.localEdgeCount, 90);
  assert.equal(graph.visibleEdges.length, 36);
  assert.equal(graph.hiddenLocalEdgeCount, 54);
  assert.equal(graph.crossBoardEdgeCount, 0);
});

test("Cross-Board dependency edges never create fake graph nodes or disclose invisible titles", () => {
  const deps = [edge(1, "projected-1", "visible"), edge(2, "projected-2", "projected-3")];
  const graph = projectBoardDependencyGraph(deps, new Set(["visible"]), new Set());
  assert.deepEqual(Array.from(graph.visibleIds), ["visible"]);
  assert.equal(graph.localNodeCount, 1);
  assert.equal(graph.crossBoardEdgeCount, 1);
  assert.equal(graph.visibleEdges.length, 0);
});

test("Visual cap arguments fail closed and do not create phantom negative counts", () => {
  const deps = [edge(1, "a", "b")];
  const graph = projectBoardDependencyGraph(deps, new Set(["a", "b"]), new Set(), NaN, -10);
  assert.equal(graph.visibleIds.length, 0);
  assert.equal(graph.visibleEdges.length, 0);
  assert.equal(graph.hiddenLocalNodeCount, 2);
  assert.equal(graph.hiddenLocalEdgeCount, 1);
});

test("The UI derives graph only from visible local Card identities and explicitly discloses limits", () => {
  const page = read(board("BoardPlanningInsights.tsx"));
  assert.match(page, /projectBoardDependencyGraph\(dependencies, localCardIds, blocked\)/);
  assert.match(page, /graphProjection\.visibleIds\.flatMap\(/);
  assert.match(page, /graphProjection\.visibleEdges\.map\(/);
  assert.match(page, /hiddenLocalNodeCount > 0 \|\| model\.graphProjection\.hiddenLocalEdgeCount > 0/);
  assert.match(page, /cross-Board relationship/);
  assert.match(page, /No local Card nodes can be shown in this graph/);
  assert.match(page, /see Blocked work for active prerequisites/);
  assert.doesNotMatch(page, /Array\.from\(edgeCards\)\.slice\(0, 24\)/);
});

test("Projection is read-only and responsive visual explanation remains styled", () => {
  assert.doesNotMatch(read(file), /\bapi\(|\bqueryApi\(|\bfetch\(|\bprisma\./);
  const css = read(board("board-workspace.css"));
  assert.ok(postcss.parse(css).nodes.length);
  assert.match(css, /board-dependency-coverage-v11/);
  for (const p of [file, board("BoardPlanningInsights.tsx")]) {
    assert.equal(ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true,
      p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length, 0, p);
  }
});
console.log(`${count}/${count} dependency graph coverage regressions passed`);

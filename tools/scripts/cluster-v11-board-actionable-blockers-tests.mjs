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
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const helper = board("board-planning-intelligence.ts");
const compiled = ts.transpileModule(read(helper), {
  fileName: helper, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, Map, Set, Math, Date }, { filename: helper });
const { boardActiveBlockerRows, boardBlockedCardIds } = mod.exports;
const edge = (id, source, target, relationship, critical = false, blocking = true) => ({
  id, sourceCardId: source, targetCardId: target, relationship, critical, blocking,
});
const local = new Set(["c1", "c2", "c3", "done-local"]);
const result = (deps, done = new Set(), locals = local) =>
  Array.from(boardActiveBlockerRows(deps, done, locals))
    .map((row) => ({ card: row.blockedCardId, pre: Array.from(row.prerequisites).map((p) => ({ id: p.cardId, critical: p.critical })) }));
let count = 0;
const test = (name, fn) => { fn(); ++count; console.log("PASS " + name); };

test("Canonical relationship direction distinguishes blocks, blocked_by and depends_on", () => {
  const rows = result([
    edge("d1", "projected-p1", "c1", "blocks"),
    edge("d2", "c2", "projected-p2", "blocked_by", true),
    edge("d3", "c3", "projected-p3", "depends_on"),
  ]);
  assert.deepEqual(rows.map((r) => r.card), ["c1", "c2", "c3"]);
  assert.deepEqual(rows.map((r) => r.pre[0].id), ["projected-p1", "projected-p2", "projected-p3"]);
});

test("Completed projected Cards do not keep local work falsely blocked", () => {
  const deps = [
    edge("d1", "projected-complete", "c1", "blocks"),
    edge("d2", "c2", "projected-active", "depends_on"),
    edge("d3", "done-local", "projected-active", "depends_on"),
  ];
  const rows = result(deps, new Set(["projected-complete", "done-local"]));
  assert.deepEqual(rows.map((r) => r.card), ["c2"]);
  assert.equal(rows[0].pre[0].id, "projected-active");
});

test("Projected blocked Cards never inflate the open Board's health counts", () => {
  const deps = [edge("p1", "projected-a", "projected-b", "blocks"), edge("p2", "c1", "c2", "blocks")];
  assert.deepEqual(result(deps).map((r) => r.card), ["c2"]);
  // The old global helper is still available for other compatibility-free
  // projections, but its unscoped count is inappropriate for this Board.
  assert.equal(boardBlockedCardIds(deps, new Set()).size, 2);
});

test("Non-blocking relationships and server nonblocking metadata are never blockers", () => {
  const deps = [
    edge("d1", "c1", "c2", "relates_to", true, false),
    edge("d2", "c2", "c3", "parent_of", false, false),
    edge("d3", "c1", "c2", "blocks", true, false),
  ];
  assert.deepEqual(result(deps), []);
});

test("Multiple relationship edges to one prerequisite are deduplicated, retaining criticality", () => {
  const deps = [edge("d1", "c1", "c2", "blocks"), edge("d2", "c2", "c1", "blocked_by", true)];
  const rows = result(deps);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pre.length, 1);
  assert.equal(rows[0].pre[0].id, "c1");
  assert.equal(rows[0].pre[0].critical, true);
});

test("Large dependency sets are linear by Board Card ID and never invent unapproved Card data", () => {
  const localCards = new Set(Array.from({ length: 300 }, (_, i) => "b" + i));
  const edges = Array.from({ length: 600 }, (_, i) => edge("e" + i, "projection" + i, "b" + (i % 300), "blocks"));
  const rows = result(edges, new Set(), localCards);
  assert.equal(rows.length, 300);
  assert.equal(rows.reduce((total, row) => total + row.pre.length, 0), 600);
  assert.equal(rows.some((row) => row.card.startsWith("projection")), false);
});

test("Board page gates stale planning responses by Board identity and projected Done state", () => {
  const page = read(board("BoardWorkspacePage.tsx"));
  assert.match(page, /planningPayload\?\.boardId === board\?\.id \? planningPayload : null/);
  assert.match(page, /if \(projection\.owningListDone\) ids\.add\(projection\.cardId\)/);
  assert.match(page, /boardActiveBlockerRows\(activePlanningPayload\?\.dependencies \|\| \[\], doneCardIds, localCardIds\)/);
  assert.match(page, /<BoardPlanningInsights board=\{board\} cards=\{cards\} users=\{users\} payload=\{activePlanningPayload\}/);
  assert.doesNotMatch(page, /boardBlockedCardIds\(planningPayload\?\.dependencies \|\| \[\], doneCardIds\)/);
});

test("Planning UI explains blockers using only canonical authorized Cards and projected titles", () => {
  const page = read(board("BoardPlanningInsights.tsx"));
  assert.match(page, /const blockerRows = boardActiveBlockerRows\(dependencies, doneCardIds, localCardIds\)/);
  assert.match(page, /\[board\.lists, cards, payload\?\.dependencies, payload\?\.projections, users\]/);
  assert.match(page, /if \(projection\.owningListDone\) doneCardIds\.add\(projection\.cardId\)/);
  assert.match(page, /<h3>Blocked work<\/h3>/);
  assert.match(page, /<details className="board-blocker-dependencies-v11">/);
  assert.match(page, /<summary>View blocking Cards<\/summary>/);
  assert.match(page, /model\.projectionByCardId\.get\(prerequisite\.cardId\)/);
  assert.match(page, /setBlockedLimit\(\(current\) => current \+ 8\)/);
  assert.match(page, /clusterResourceNavigation\(\{ kind: "card", id: prerequisite\.cardId, projectId: board\.project\.id \}\)/);
});

test("Blocker inspector remains responsive, keyboard readable and read-only", () => {
  const css = read(board("board-workspace.css"));
  assert.ok(postcss.parse(css).nodes.length);
  for (const regex of [/board-active-blockers-v11/, /board-blocker-dependencies-v11/, /:focus-visible/, /@media\(pointer:coarse\)/, /min-height:44px/]) assert.match(css, regex);
  assert.doesNotMatch(read(helper), /\bapi\(|\bqueryApi\(|\bfetch\(|\bprisma\./);
  for (const p of [helper,board("BoardWorkspacePage.tsx"),board("BoardPlanningInsights.tsx")]) {
    const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length, 0, p);
  }
});
console.log(`${count}/${count} Board blocker inspector checks passed`);

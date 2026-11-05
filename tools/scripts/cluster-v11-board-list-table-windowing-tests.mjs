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
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const directory = "packages/renderer/src/features/boards/";
const pagerFile = directory + "board-visible-page.ts";
const compiled = ts.transpileModule(read(pagerFile), {
  fileName: pagerFile, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, Number });
const { boardVisiblePage } = mod.exports;
let count = 0;
function test(label, fn) { fn(); count++; console.log("PASS " + label); }

test("Bounded List/Table/Calendar windows preserve the original Card order", () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ({ card: { id: "c" + i } }));
  assert.deepEqual(Array.from(boardVisiblePage(rows, 40)).map((r) => r.card.id), rows.slice(0, 40).map((r) => r.card.id));
  assert.equal(boardVisiblePage(rows, 80).length, 80);
  assert.equal(boardVisiblePage(rows, 120).length, 120);
  assert.equal(boardVisiblePage(rows, 20001).length, rows.length);
});
test("Invalid, negative and fractional render limits fail closed", () => {
  const rows = [1, 2, 3];
  for (const limit of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(Array.from(boardVisiblePage(rows, limit)), [], String(limit));
  }
  assert.deepEqual(Array.from(boardVisiblePage(rows, 0)), []);
  assert.deepEqual(Array.from(boardVisiblePage(rows, 2)), [1, 2]);
});
test("Board List groups and expands locally by their canonical list IDs", () => {
  const source = read(directory + "BoardAlternativeViews.tsx");
  assert.match(source, /const \[visibleByList, setVisibleByList\] = useState<Record<string, number>>\(\{\}\)/);
  assert.match(source, /boardVisiblePage\(listRows, visibleByList\[list\.id\] \|\| 40\)/);
  assert.match(source, /listRows\.length > \(visibleByList\[list\.id\] \|\| 40\)/);
  assert.match(source, /\[list\.id\]: \(current\[list\.id\] \|\| 40\) \+ 40/);
  assert.match(source, /aria-label=\{\`Show next \$\{Math\.min\(40, listRows\.length/);
  assert.match(source, /<ContextualCardOpenButton card=\{card\}/);
});
test("Table rows are bounded and keep the full accessible row count", () => {
  const source = read(directory + "BoardAlternativeViews.tsx");
  assert.match(source, /const \[renderLimit, setRenderLimit\] = useState\(80\)/);
  assert.match(source, /const visibleRows = boardVisiblePage\(rows, renderLimit\)/);
  assert.match(source, /aria-rowcount=\{rows\.length \+ 1\}/);
  assert.match(source, /role="row" aria-rowindex=\{1\}/);
  assert.match(source, /visibleRows\.map\(\(\{ card, list \}, index\) =>/);
  assert.match(source, /role="row" aria-rowindex=\{index \+ 2\}/);
  assert.match(source, /setRenderLimit\(\(current\) => current \+ 80\)/);
  assert.match(source, /aria-label=\{\`Show next \$\{Math\.min\(80, rows\.length/);
});
test("Calendar still paginates day details and invalid due dates through the same helper", () => {
  const source = read(directory + "BoardAlternativeViews.tsx");
  assert.match(source, /boardVisiblePage\(selectedDayRows, selectedDayLimit\)/);
  assert.match(source, /boardVisiblePage\(undated, undatedLimit\)/);
  assert.match(source, /projectBoardCalendarRows\(rows\)/);
  assert.doesNotMatch(read(directory + "board-calendar-projection.ts"), /function boardCalendarPage/);
});
test("Selection, open-card, view filtering and list Done state remain server-authoritative", () => {
  const source = read(directory + "BoardAlternativeViews.tsx");
  const board = read(directory + "BoardWorkspacePage.tsx");
  assert.match(source, /onToggleSelected\(card\.id\)/);
  assert.match(source, /onOpen=\{onOpen\}/);
  assert.match(source, /boardCardDeadlineNeedsAttention\(card\.dueDate, Boolean\(list\.isDone\)\)/);
  assert.match(board, /<BoardListView rows=\{visibleRows\}/);
  assert.match(board, /<BoardTableView rows=\{visibleRows\}/);
  const helper = read(pagerFile);
  assert.doesNotMatch(helper, /\bapi\(|\bqueryApi\(|\bfetch\(|\bprisma\./);
});
test("Paging layout works with touch, mobile and minimal focus decoration", () => {
  const css = read(directory + "board-workspace.css");
  assert.ok(postcss.parse(css).nodes.length);
  for (const expr of [/board-view-load-more-v11/, /board-table-load-more-v11/, /@media\(pointer:coarse\)/, /min-height:44px/, /@media\(max-width:580px\)/]) assert.match(css, expr);
});
for (const p of [pagerFile, directory + "BoardAlternativeViews.tsx"]) {
  const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true,
    p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length, 0, p);
}
console.log(`${count}/${count} Board list/table windowing regressions passed`);

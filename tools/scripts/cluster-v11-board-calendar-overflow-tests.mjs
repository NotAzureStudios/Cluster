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
const boardFile = (p) => "packages/renderer/src/features/boards/" + p;
function compile(file, resolve = () => { throw new Error("Unexpected import in " + file); }) {
  const source = read(file);
  const compiled = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  const mod = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, require: resolve, Date, Map, Number }, { filename: file });
  return mod.exports;
}
const civil = compile(boardFile("board-civil-date.ts"));
const projection = compile(boardFile("board-calendar-projection.ts"), (id) => {
  assert.equal(id, "./board-civil-date");
  return civil;
});
const { projectBoardCalendarRows, boardCalendarPage } = projection;
const row = (id, dueDate) => ({ card: { id, dueDate }, list: { id: "list-1" } });
let count = 0;
function test(label, fn) { fn(); count++; console.log("PASS " + label); }

test("All due cards are retained per civil day, with stable source ordering", () => {
  const values = Array.from({ length: 127 }, (_, i) => row(String(i), "2026-11-04T00:00:00.000Z"));
  const result = projectBoardCalendarRows(values);
  assert.equal(result.dueByDay.size, 1);
  assert.equal(result.dueByDay.get("2026-11-04").length, 127);
  assert.equal(result.dueByDay.get("2026-11-04")[0].card.id, "0");
  assert.equal(result.dueByDay.get("2026-11-04")[126].card.id, "126");
  assert.equal(result.undated.length, 0);
});
test("Missing and invalid dates stay in the unscheduled bucket instead of disappearing", () => {
  const values = [row("none", null), row("bad", "2026-02-30"), row("empty", ""), row("good", "2028-02-29")];
  const result = projectBoardCalendarRows(values);
  assert.deepEqual(Array.from(result.undated.map((item) => item.card.id)), ["none", "bad", "empty"]);
  assert.equal(result.invalidDueCount, 1);
  assert.equal(result.dueByDay.get("2028-02-29")[0].card.id, "good");
});
test("Invalid and missing calendar input cannot invent a due date", () => {
  const result = projectBoardCalendarRows([row("invalid", "not-a-date"), row("unknown", undefined), row("a", "2026-11-01")]);
  assert.equal(result.dueByDay.size, 1);
  assert.equal(result.invalidDueCount, 1);
  assert.equal(result.undated.length, 2);
});
test("Opening a day or unscheduled section is bounded, deterministic and local", () => {
  const values = Array.from({ length: 1000 }, (_, i) => i);
  assert.deepEqual(Array.from(boardCalendarPage(values, 25)), values.slice(0, 25));
  assert.deepEqual(Array.from(boardCalendarPage(values, 50)), values.slice(0, 50));
  assert.deepEqual(Array.from(boardCalendarPage(values, 20)), values.slice(0, 20));
  assert.deepEqual(Array.from(boardCalendarPage(values, -1)), []);
  assert.deepEqual(Array.from(boardCalendarPage(values, NaN)), []);
  assert.equal(boardCalendarPage(values, 1025).length, 1000);
});
test("Day overflow is a keyboard-reachable button that opens a labeled day panel", () => {
  const view = read(boardFile("BoardAlternativeViews.tsx"));
  assert.match(view, /dayRows\.length > 5 \? <ClusterButton/);
  assert.match(view, /onClick=\{\(event\) => openDayDetails\(key, event\.currentTarget\)\}/);
  assert.match(view, /aria-label=\{\`Show all \$\{dayRows\.length\} cards due/);
  assert.match(view, /ref=\{dayPanelRef\} tabIndex=\{-1\}/);
  assert.match(view, /aria-labelledby="board-calendar-day-detail-heading-v11"/);
  assert.match(view, /event\.key !== "Escape" \|\| event\.defaultPrevented/);
  assert.match(view, /trigger\?\.isConnected\) trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(view, /closeDayDetails\(\)/);
});
test("Day detail is bounded and paginates without additional requests", () => {
  const view = read(boardFile("BoardAlternativeViews.tsx"));
  assert.match(view, /selectedDayRows = selectedDay \? dueByDay\.get\(selectedDay\) \|\| \[\] : \[\]/);
  assert.match(view, /boardCalendarPage\(selectedDayRows, selectedDayLimit\)/);
  assert.match(view, /setSelectedDayLimit\(\(limit\) => limit \+ 25\)/);
  assert.match(view, /selectedDayRows\.length > selectedDayLimit/);
  assert.match(view, /setSelectedDay\(null\)/);
});
test("Unscheduled section exposes invalid data and paginates all remaining cards", () => {
  const view = read(boardFile("BoardAlternativeViews.tsx"));
  assert.match(view, /projectBoardCalendarRows\(rows\)/);
  assert.match(view, /{invalidDueCount} card/);
  assert.match(view, /boardCalendarPage\(undated, undatedLimit\)/);
  assert.match(view, /undated\.length > undatedLimit/);
  assert.match(view, /setUndatedLimit\(\(limit\) => limit \+ 20\)/);
  assert.doesNotMatch(view, /undated\.slice\(0, 20\)/);
  assert.doesNotMatch(view, /<span className="board-calendar-more-v489"/);
});
test("Read-only calendar does not create shadow Cards, make requests or mutate due dates", () => {
  const helper = read(boardFile("board-calendar-projection.ts"));
  assert.doesNotMatch(helper, /\bapi\(|\bfetch\(|\bqueryApi\(|\bprisma\./);
  const view = read(boardFile("BoardAlternativeViews.tsx"));
  assert.match(view, /<ContextualCardOpenButton card=\{card\} selected=\{selectedIds\.has\(card\.id\)\}/);
  assert.match(view, /<CardSelectButton selected=\{selectedIds\.has\(card\.id\)\}/);
  assert.match(view, /const \{ dueByDay, undated, invalidDueCount \}/);
});
test("Responsive visible controls retain touch targets and no focus animation", () => {
  const css = read(boardFile("board-workspace.css"));
  assert.ok(postcss.parse(css).nodes.length);
  for (const pattern of [/board-calendar-day-detail-v11/, /board-calendar-invalid-due-v11/, /board-calendar-show-more-v11/, /@media\(pointer:coarse\)/, /min-height:44px/, /@media\(prefers-reduced-motion:reduce\)/]) assert.match(css, pattern);
});
for (const file of ["BoardAlternativeViews.tsx", "board-calendar-projection.ts"]) {
  const p = boardFile(file), source = read(p);
  const parsed = ts.createSourceFile(p, source, ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, p);
}
console.log(`${count}/${count} Board Calendar overflow checks passed`);

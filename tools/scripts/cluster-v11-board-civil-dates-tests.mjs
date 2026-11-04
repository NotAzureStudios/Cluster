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
const file = "packages/renderer/src/features/boards/board-civil-date.ts";
const transpiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(transpiled.outputText, { module: mod, exports: mod.exports, Date });
const { boardCivilDate, boardCivilDateKey, boardCardOverdue, formatBoardCivilDate } = mod.exports;
let count = 0;
function test(label, fn) { fn(); count++; console.log("PASS", label); }

test("UTC-midnight ISO Card dates remain the same civil day west of UTC", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(boardCivilDateKey("2026-11-04T00:00:00.000Z"), "2026-11-04");
    assert.equal(boardCivilDateKey("2026-11-04"), "2026-11-04");
    assert.equal(boardCivilDateKey(new Date(2026, 10, 4)), "2026-11-04");
    assert.equal(formatBoardCivilDate("2026-11-04T00:00:00.000Z"), new Date(2026, 10, 4).toLocaleDateString());
  } finally {
    if (previous == null) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("Due today stays due until tomorrow, even at local 11:59 pm", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(boardCardOverdue("2026-11-04T00:00:00Z", new Date(2026, 10, 4, 23, 59, 59)), false);
    assert.equal(boardCardOverdue("2026-11-04", new Date(2026, 10, 5, 0, 0, 0)), true);
    assert.equal(boardCardOverdue("2026-11-05", new Date(2026, 10, 4, 23, 59)), false);
  } finally {
    if (previous == null) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("DST spring/fall and leap day do not shift a card deadline", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(boardCivilDateKey("2026-03-08T00:00:00Z"), "2026-03-08");
    assert.equal(boardCardOverdue("2026-03-08T00:00:00Z", new Date(2026, 2, 8, 23, 30)), false);
    assert.equal(boardCardOverdue("2026-03-08T00:00:00Z", new Date(2026, 2, 9, 0, 0)), true);
    assert.equal(boardCivilDateKey("2028-02-29T00:00:00.000Z"), "2028-02-29");
    assert.equal(boardCivilDateKey("2026-11-01T00:00:00Z"), "2026-11-01");
  } finally {
    if (previous == null) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("Unknown, invalid and malformed dates cannot be rendered or called overdue", () => {
  for (const raw of ["", "garbage", "2026-02-30", "2026-13-01", "2026-00-00", "2026-11-31"]) {
    assert.equal(boardCivilDate(raw), null, raw);
    assert.equal(boardCivilDateKey(raw), "", raw);
    assert.equal(formatBoardCivilDate(raw), "", raw);
    assert.equal(boardCardOverdue(raw), false, raw);
  }
  assert.equal(boardCardOverdue(null), false);
});

test("Board Timeline, Calendar, list, table and Kanban reuse the same date authority", () => {
  const timeline = read("packages/renderer/src/features/boards/board-timeline-projection.ts");
  const alt = read("packages/renderer/src/features/boards/BoardAlternativeViews.tsx");
  const tile = read("packages/renderer/src/features/boards/BoardCardTile.tsx");
  assert.match(timeline, /import \{ boardCivilDate \} from "\.\/board-civil-date"/);
  assert.match(timeline, /const start = boardCivilDate\(row\.card\.startDate\)/);
  assert.match(timeline, /const end = boardCivilDate\(row\.card\.dueDate\)/);
  assert.match(alt, /import \{ boardCivilDateKey, formatBoardCivilDate \}/);
  assert.match(alt, /boardCivilDateKey\(row\.card\.dueDate\)/);
  assert.match(alt, /formatBoardCivilDate\(card\.dueDate\)/);
  assert.match(tile, /return boardCardOverdue\(value\)/);
  assert.match(tile, /formatBoardCivilDate\(card\.startDate\)/);
  assert.match(tile, /formatBoardCivilDate\(card\.dueDate\)/);
  assert.match(tile, /formatBoardCivilDate\(card\.deferredUntil\)/);
  assert.doesNotMatch(alt, /function dateKey\(/);
  assert.doesNotMatch(timeline, /function timelineDate\(/);
});

test("Calendar is still a read-only lens over canonical cards", () => {
  const alt = read("packages/renderer/src/features/boards/BoardAlternativeViews.tsx");
  assert.match(alt, /const dueByDay = useMemo/);
  assert.match(alt, /if \(!row\.card\.dueDate\) return/);
  assert.match(alt, /onOpen=\{onOpen\}/);
  assert.doesNotMatch(read(file), /\bapi\(|\bfetch\(|\bqueryApi\(/);
});

test("No data migrations or extra API reads and all changed TSX/TS files parse", () => {
  const paths = [
    file,
    "packages/renderer/src/features/boards/BoardAlternativeViews.tsx",
    "packages/renderer/src/features/boards/BoardCardTile.tsx",
    "packages/renderer/src/features/boards/board-timeline-projection.ts",
  ];
  for (const name of paths) {
    const sf = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true,
      name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length, 0, name);
  }
});

console.log(`${count}/${count} Board civil date UI regressions passed`);

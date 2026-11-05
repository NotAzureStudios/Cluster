import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const civil = "packages/renderer/src/features/boards/board-civil-date.ts";
const m = { exports: {} };
const transpiled = ts.transpileModule(read(civil), {
  fileName: civil, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
vm.runInNewContext(transpiled.outputText, { module: m, exports: m.exports, Date });
const { boardCardDeadlineNeedsAttention, boardCardOverdue } = m.exports;
let count = 0;
const test = (label, fn) => { fn(); count++; console.log("PASS " + label); };

test("Old due date is overdue for active work but not completed work", () => {
  const now = new Date(2026, 10, 4, 12, 0);
  assert.equal(boardCardOverdue("2026-11-01T00:00:00.000Z", now), true);
  assert.equal(boardCardDeadlineNeedsAttention("2026-11-01T00:00:00.000Z", false, now), true);
  assert.equal(boardCardDeadlineNeedsAttention("2026-11-01T00:00:00.000Z", true, now), false);
});

test("An active card due today is not prematurely overdue", () => {
  const now = new Date(2026, 10, 4, 23, 59);
  assert.equal(boardCardDeadlineNeedsAttention("2026-11-04T00:00:00.000Z", false, now), false);
  assert.equal(boardCardDeadlineNeedsAttention("2026-11-05", false, now), false);
});

test("Unknown/invalid deadlines are never treated as overdue", () => {
  for (const raw of [null, undefined, "", "invalid", "2026-02-30"]) {
    assert.equal(boardCardDeadlineNeedsAttention(raw, false, new Date(2026, 10, 4)), false);
    assert.equal(boardCardDeadlineNeedsAttention(raw, true, new Date(2026, 10, 4)), false);
  }
});

test("Kanban reads canonical listDone and updates memoized card state", () => {
  const tile = read("packages/renderer/src/features/boards/BoardCardTile.tsx");
  const board = read("packages/renderer/src/features/boards/BoardWorkspacePage.tsx");
  assert.match(tile, /const overdue = boardCardDeadlineNeedsAttention\(card\.dueDate, listDone\)/);
  assert.match(tile, /previous\.listDone === next\.listDone/);
  assert.match(board, /listDone=\{Boolean\(list\.isDone\)\}/);
  assert.match(tile, /formatBoardCivilDate\(card\.dueDate\)/);
});

test("List and table read the authoritative Board List's Done status", () => {
  const views = read("packages/renderer/src/features/boards/BoardAlternativeViews.tsx");
  assert.match(views, /function CardFacts\(\{ card, users, listDone \}/);
  assert.match(views, /<CardFacts card=\{card\} users=\{users\} listDone=\{Boolean\(list\.isDone\)\} \/>/);
  assert.match(views, /boardCardDeadlineNeedsAttention\(card\.dueDate, listDone\)/);
  assert.match(views, /boardCardDeadlineNeedsAttention\(card\.dueDate, Boolean\(list\.isDone\)\)/);
  assert.match(views, /formatBoardCivilDate\(card\.dueDate\)/);
  assert.doesNotMatch(views, /isCardOverdue\(card\.dueDate\)/);
});

test("Data and permissions remain unchanged; this is display-only", () => {
  const helper = read(civil);
  assert.match(helper, /return !listDone && boardCardOverdue\(dueDate, now\)/);
  for (const regex of [/\bapi\(/, /\bfetch\(/, /\bqueryApi\(/, /\bprisma\./]) assert.doesNotMatch(helper, regex);
  const paths = [civil,
    "packages/renderer/src/features/boards/BoardCardTile.tsx",
    "packages/renderer/src/features/boards/BoardAlternativeViews.tsx",
  ];
  for (const p of paths) {
    const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true,
      p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length, 0, p);
  }
});
console.log(`${count}/${count} completed Board Card deadline regressions passed`);

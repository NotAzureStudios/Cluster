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
const file = "packages/renderer/src/features/calendar/calendar-conflict-projection.ts";
const transpiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((transpiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(transpiled.outputText, { module: mod, exports: mod.exports, Date, Map, Set, Math, Number }, { filename: file });
const { visibleCalendarConflictIds } = mod.exports;

function naive(events) {
  const spans = events
    .filter((e) => !e.allDay && !e.overlay)
    .map((event) => ({
      key: event.occurrenceKey || event.id,
      owner: event.ownerId || null,
      start: Date.parse(event.startsAt),
      end: event.endsAt ? Date.parse(event.endsAt) : Date.parse(event.startsAt) + 60 * 60 * 1000,
    }))
    .filter((e) => e.key && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start);
  const set = new Set();
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i], b = spans[j];
      if (a.owner && b.owner && a.owner !== b.owner) continue;
      if (a.start < b.end && b.start < a.end) {
        set.add(a.key);
        set.add(b.key);
      }
    }
  }
  return [...set].sort();
}
const actual = (events) => Array.from(visibleCalendarConflictIds(events)).sort();
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("PASS " + name); }
const event = (id, start, end = null, ownerId = null, extras = {}) => ({
  id, startsAt: new Date(start).toISOString(), endsAt: end == null ? null : new Date(end).toISOString(), ownerId, ...extras,
});

test("Partially overlapping same-owner events flag both, adjacent intervals do not", () => {
  const baseline = Date.UTC(2026, 10, 4, 14);
  const items = [
    event("a", baseline, baseline + 2 * 3600000, "person1"),
    event("b", baseline + 3600000, baseline + 3 * 3600000, "person1"),
    event("c", baseline + 3 * 3600000, baseline + 4 * 3600000, "person1"),
  ];
  assert.deepEqual(actual(items), ["a", "b"]);
});

test("Different assigned owners do not conflict; unassigned overlaps all", () => {
  const base = Date.UTC(2026, 10, 4, 14);
  const assigned = [event("a", base, base + 3600000, "alice"), event("b", base, base + 3600000, "bob")];
  assert.deepEqual(actual(assigned), []);
  assert.deepEqual(actual([...assigned, event("u", base + 1800000, base + 3600000)]), ["a", "b", "u"]);
});

test("An early event overlapping many later events is also marked", () => {
  const base = Date.UTC(2026, 10, 4, 14);
  const events = [event("long", base, base + 20 * 3600000, "alice")];
  for (let i = 1; i <= 12; i++) events.push(event("short" + i, base + i * 3600000, base + i * 3600000 + 1800000, "alice"));
  assert.deepEqual(actual(events), naive(events));
  assert.equal(actual(events).length, 13);
});

test("Cancelled-overlap UI sources (all-day and canonical overlays) are excluded", () => {
  const t = Date.UTC(2026, 10, 4, 14);
  const items = [
    event("a", t, t + 3600000),
    event("all-day", t, t + 3600000, null, { allDay: true }),
    event("overlay", t, t + 3600000, null, { overlay: { readOnly: true } }),
  ];
  assert.deepEqual(actual(items), []);
});

test("Recurrence occurrences use occurrenceKey rather than collapsing to their series ID", () => {
  const t = Date.UTC(2026, 10, 4, 14);
  const items = [
    event("series", t, t + 3600000, "alice", { occurrenceKey: "occ-1" }),
    event("series", t, t + 3600000, "alice", { occurrenceKey: "occ-2" }),
  ];
  assert.deepEqual(actual(items), ["occ-1", "occ-2"]);
});

test("Invalid, zero-duration and backwards timestamps do not fabricate conflicts", () => {
  const t = Date.UTC(2026, 10, 4, 14);
  const items = [
    event("valid", t, t + 3600000),
    { id: "broken", startsAt: "invalid", endsAt: "invalid" },
    event("zero", t + 1000, t + 1000),
    event("reversed", t + 4000, t + 2000),
  ];
  assert.deepEqual(actual(items), []);
});

test("Default one-hour duration and cross-midnight intervals preserve true overlaps", () => {
  const t = Date.UTC(2026, 10, 4, 23, 30);
  const items = [
    event("default", t),
    event("next-day", t + 1800000, t + 5400000),
  ];
  assert.deepEqual(actual(items), ["default", "next-day"]);
});

test("Deterministic randomized owner-aware interval sweeps match quadratic reference", () => {
  let seed = 0x4f8aac31;
  const rng = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let iteration = 0; iteration < 1200; iteration += 1) {
    const base = Date.UTC(2026, 0, 1);
    const size = Math.floor(rng() * 44);
    const items = Array.from({ length: size }, (_, i) => {
      const start = base + Math.floor(rng() * 240) * 15 * 60000;
      const end = start + (Math.floor(rng() * 12) + 1) * 15 * 60000;
      return event(`item-${i}`, start, end, [null, "alice", "bob", "carol", "dave"][Math.floor(rng() * 5)],
        { allDay: rng() < 0.08, overlay: rng() < 0.06 ? { readOnly: true } : null });
    });
    assert.deepEqual(actual(items), naive(items), "Case " + iteration);
  }
});

test("Large nonoverlapping schedules remain practical without pairwise comparisons", () => {
  const start = Date.UTC(2026, 0, 1);
  const items = Array.from({ length: 24000 }, (_, i) => ({
    id: "event-" + i,
    startsAt: new Date(start + i * 2 * 3600000).toISOString(),
    endsAt: new Date(start + i * 2 * 3600000 + 1800000).toISOString(),
    ownerId: i % 3 ? "a" : null,
  }));
  assert.deepEqual(actual(items), []);
});

test("Visible Calendar only; no new server conflict or permission authority", () => {
  const page = read("packages/renderer/src/features/calendar/CalendarPage.tsx");
  assert.match(page, /import \{ visibleCalendarConflictIds \} from "\.\/calendar-conflict-projection"/);
  assert.match(page, /useMemo\(\(\) => visibleCalendarConflictIds\(filteredEvents\), \[filteredEvents\]\)/);
  assert.match(page, /conflictIds\.has\(event\.occurrenceKey \|\| event\.id\)/);
  assert.doesNotMatch(page, /for \(let i = 0; i < timed\.length/);
  const helper = read(file);
  assert.doesNotMatch(helper, /\bapi\(|\bqueryApi\(|\bfetch\(|\bprisma\./);
  assert.doesNotMatch(helper, /for \(let j = i \+ 1/);
  for (const p of [file, "packages/renderer/src/features/calendar/CalendarPage.tsx"]) {
    const sf = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length, 0, p);
  }
});
console.log(`${checks}/${checks} Calendar conflict projection regressions passed`);

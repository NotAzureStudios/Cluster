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
const cal = (p) => "packages/renderer/src/features/calendar/" + p;
const source = cal("calendar-display-filters.ts");
const compiled = ts.transpileModule(read(source), { fileName: source, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, "valid TypeScript");
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, Date, Number });
const { calendarItemLayer, filterCalendarDisplayItems, DEFAULT_CALENDAR_LAYER_VISIBILITY } = mod.exports;
const ev = (id, startsAt, extras = {}) => ({ id, title: id, startsAt, projectId: null, ownerId: null, eventType: "meeting", ...extras });
const overlay = (id, source, extras = {}) => ev(id, "2026-11-04T12:00:00Z", {
  eventType: source === "card" ? "deadline" : "milestone",
  overlay: { source },
  ...extras,
});
const base = { project: "all", type: "all", owner: "all", search: "",
  layers: { ...DEFAULT_CALENDAR_LAYER_VISIBILITY } };
const ids = (items) => Array.from(items.map((item) => item.id));
let count = 0;
function test(name, run) { run(); count++; console.log("PASS " + name); }

test("All authorized event/Timeline/Card layers are on by default", () => {
  assert.deepEqual([DEFAULT_CALENDAR_LAYER_VISIBILITY.events, DEFAULT_CALENDAR_LAYER_VISIBILITY.timeline, DEFAULT_CALENDAR_LAYER_VISIBILITY.cards], [true,true,true]);
  assert.equal(calendarItemLayer(ev("e", "2026-11-04T12:00:00Z")), "events");
  assert.equal(calendarItemLayer(overlay("t", "timeline")), "timeline");
  assert.equal(calendarItemLayer(overlay("c", "card")), "cards");
});
test("Every layer can be independently hidden without changing canonical input data", () => {
  const events = [ev("event", "2026-11-04T09:00:00Z")];
  const overlays = [overlay("timeline", "timeline"), overlay("card", "card")];
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, base)), ["event", "timeline", "card"]);
  for (const [layer, expected] of [["events", ["timeline", "card"]], ["timeline", ["event", "card"]], ["cards", ["event", "timeline"]]]) {
    const filtered = filterCalendarDisplayItems(events, overlays, { ...base, layers: { ...base.layers, [layer]: false } });
    assert.deepEqual(ids(filtered), expected, layer);
  }
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays,
    { ...base, layers: { events: false, timeline: false, cards: false } })), []);
  assert.equal(events.length, 1);
  assert.equal(overlays.length, 2);
});
test("Owner filtering correctly retains same-owner overlays and excludes other owners", () => {
  const events = [ev("alice-event", "2026-11-04T11:00:00Z", { ownerId: "alice" }),
    ev("bob-event", "2026-11-04T12:00:00Z", { ownerId: "bob" })];
  const overlays = [
    overlay("alice-card", "card", { ownerId: "alice" }),
    overlay("alice-timeline", "timeline", { ownerId: "alice" }),
    overlay("bob-timeline", "timeline", { ownerId: "bob" }),
    overlay("no-owner-card", "card"),
  ];
  const alice = filterCalendarDisplayItems(events, overlays, { ...base, owner: "alice" });
  assert.deepEqual(ids(alice), ["alice-event", "alice-card", "alice-timeline"]);
  const unassigned = filterCalendarDisplayItems(events, overlays, { ...base, owner: "unassigned" });
  assert.deepEqual(ids(unassigned), ["no-owner-card"]);
});
test("Project and Studio filters apply consistently to all three layers", () => {
  const events = [ev("studio-event", "2026-11-04T09:00:00Z"),
    ev("project-event", "2026-11-04T10:00:00Z", { projectId: "project-a" })];
  const overlays = [overlay("studio-overlay", "timeline"),
    overlay("project-card", "card", { projectId: "project-a" }),
    overlay("other-card", "card", { projectId: "project-b" })];
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, { ...base, project: "studio" })),
    ["studio-event", "studio-overlay"]);
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, { ...base, project: "project-a" })),
    ["project-event", "project-card"]);
});
test("Type and search filters preserve Timeline/Card semantics without duplicate events", () => {
  const events = [ev("Sprint review", "2026-11-04T08:00:00Z", { description: "Build readiness" })];
  const overlays = [overlay("Asset deadline", "card", { project: { id: "p", name: "Studio Game" } }),
    overlay("Milestone review", "timeline")];
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, { ...base, type: "deadline" })), ["Asset deadline"]);
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, { ...base, search: "studio GAME" })), ["Asset deadline"]);
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, { ...base, search: "BUILD readiness" })), ["Sprint review"]);
});
test("Filtered output maintains calendar time and stable same-time order", () => {
  const events = [ev("e2", "2026-11-04T12:00:00Z"), ev("e1", "2026-11-04T09:00:00Z")];
  const overlays = [overlay("c1", "card"), overlay("t1", "timeline")];
  assert.deepEqual(ids(filterCalendarDisplayItems(events, overlays, base)), ["e1","e2","c1","t1"]);
});
test("Large authorized schedules project without extra requests", () => {
  const events = Array.from({length: 15000}, (_, i) => ev("e"+i, "2026-11-04T08:00:00Z", {ownerId: i % 2 ? "bob" : "alice"}));
  const overlays = Array.from({length: 15000}, (_, i) => overlay("c"+i,"card", { ownerId: i % 2 ? "bob" : "alice" }));
  assert.equal(filterCalendarDisplayItems(events, overlays, {...base, owner:"alice"}).length,15000);
  for (const expression of ["api(", "queryApi(", "fetch(", "prisma."]) assert.equal(read(source).includes(expression), false, expression);
});
test("Every workspace view, planning panel and agenda uses the same visible result", () => {
  const page = read(cal("CalendarPage.tsx"));
  assert.match(page, /filterCalendarDisplayItems\(\s*visibleEvents, overlayItems/);
  assert.match(page, /const eventsByDay = useMemo\(\(\) => indexCalendarEventsByLocalDay\(filteredEvents\)/);
  assert.match(page, /const agendaEvents = calendarEventPage\(filteredEvents, agendaLimit\)/);
  assert.match(page, /visibleCalendarConflictIds\(filteredEvents\)/);
  assert.match(page, /<CalendarTimelineOverlayPanel items=\{filteredEvents\}/);
  assert.match(page, /layers\.events, layers\.timeline, layers\.cards/);
});
test("Layer switches are keyboard buttons and expose pressed state", () => {
  const page = read(cal("CalendarPage.tsx"));
  assert.match(page, /role="group" aria-label="Calendar visibility layers"/);
  assert.match(page, /aria-pressed=\{layers\[layer\]\}/);
  assert.match(page, /onClick=\{\(\) => toggleCalendarLayer\(layer\)\}/);
  assert.match(page, /All Calendar layers are hidden/);
  assert.match(page, /view !== "year" \? <div className="calendar-layer-controls-v11"/);
  const css = read(cal("calendar.css"));
  assert.ok(postcss.parse(css).nodes.length);
  for(const pat of [/calendar-layer-controls-v11/,/calendar-layer-toggle-v11/,/aria-pressed="true"/,/:focus-visible/,/@media\(pointer:coarse\)/,/min-height:44px/]) assert.match(css,pat);
});
for (const p of [cal("CalendarPage.tsx"), source]) {
  assert.equal(ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,p.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0,p);
}
console.log(`${count}/${count} Calendar layer regressions passed`);

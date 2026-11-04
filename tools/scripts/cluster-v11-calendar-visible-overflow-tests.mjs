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
const calendarFile = (name) => "packages/renderer/src/features/calendar/" + name;
function compile(file, resolve = () => { throw new Error("Unexpected import: " + file); }) {
  const script = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal((script.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  const module = { exports: {} };
  vm.runInNewContext(script.outputText, { module, exports: module.exports, require: resolve, Date, Map, Number }, { filename: file });
  return module.exports;
}
const year = compile(calendarFile("calendar-year-projection.ts"));
const dates = compile(calendarFile("calendar-date-navigation.ts"), (target) => {
  assert.equal(target, "./calendar-year-projection");
  return year;
});
const { indexCalendarEventsByLocalDay, calendarEventPage } = compile(
  calendarFile("calendar-event-visibility.ts"),
  (target) => { assert.equal(target, "./calendar-date-navigation"); return dates; },
);
let count = 0;
const test = (name, body) => { body(); count++; console.log("PASS " + name); };

test("A busy selected day retains all event/occurrence identities in sorted input order", () => {
  const entries = Array.from({ length: 1500 }, (_, i) => ({
    id: "event-" + i, startsAt: "2026-11-04T12:00:00Z", occurrenceKey: "occurrence-" + i,
  }));
  const days = indexCalendarEventsByLocalDay(entries);
  const bucket = days.get(dates.calendarDateInputValue(new Date("2026-11-04T12:00:00Z")));
  assert.equal(bucket.length, 1500);
  assert.equal(bucket[0].id, "event-0");
  assert.equal(bucket[1499].occurrenceKey, "occurrence-1499");
});

test("Local civil selected keys are stable across UTC-positive and UTC-negative zones", () => {
  const old = process.env.TZ;
  try {
    for (const zone of ["Asia/Tokyo", "America/New_York"]) {
      process.env.TZ = zone;
      const day = new Date(2026, 10, 4);
      assert.equal(dates.calendarDateInputValue(day), "2026-11-04");
      const startsAt = new Date(2026, 10, 4, 9, 0).toISOString();
      assert.equal(indexCalendarEventsByLocalDay([{ startsAt }]).has("2026-11-04"), true);
    }
  } finally {
    if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  }
});

test("Invalid event timestamps are not grouped into invented date buckets", () => {
  const days = indexCalendarEventsByLocalDay([{ startsAt: "invalid", id: "broken" }, { startsAt: "2026-11-04T10:00:00Z", id: "valid" }]);
  assert.equal(days.size, 1);
  assert.equal(Array.from(days.values())[0].length, 1);
});

test("Local paging is bounded and expands without losing source order", () => {
  const items = Array.from({ length: 333 }, (_, i) => ({ id: i }));
  assert.deepEqual(Array.from(calendarEventPage(items, 20)).map((item) => item.id), Array.from({ length: 20 }, (_, i) => i));
  assert.equal(calendarEventPage(items, 45).length, 45);
  assert.equal(calendarEventPage(items, 1000).length, 333);
  assert.equal(calendarEventPage(items, -20).length, 0);
  assert.equal(calendarEventPage(items, NaN).length, 0);
});

test("Month and Week cells use real local day keys instead of UTC round trips", () => {
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.match(page, /const selectedKey = calendarDateInputValue\(selectedDate\)/);
  assert.equal((page.match(/const key = calendarDateInputValue\(day\);/g) || []).length, 2);
  assert.doesNotMatch(page, /toDateInputValue\(day\.toISOString\(\)\)/);
  assert.doesNotMatch(page, /toDateInputValue\(selectedDate\.toISOString\(\)\)/);
  assert.match(page, /indexCalendarEventsByLocalDay\(filteredEvents\)/);
});

test("Month +N more is a clickable control that focuses only the matching selected day", () => {
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.match(page, /dayEvents.length > 3 \? <ClusterButton/);
  assert.match(page, /openCalendarDayOverflow\(day, event\.currentTarget\)/);
  assert.match(page, /aria-controls="calendar-selected-day-inspector-v11"/);
  assert.match(page, /aria-labelledby="calendar-selected-day-heading-v11"/);
  assert.match(page, /ref=\{selectedDayInspectorRef\} id="calendar-selected-day-inspector-v11"/);
  assert.match(page, /selectedDayInspectorRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /trigger\.isConnected\) trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /event\.key !== "Escape" \|\| event\.defaultPrevented/);
});

test("Week has a bounded local list and a keyboard path to the day inspector", () => {
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.match(page, /calendarEventPage\(dayEvents, 25\)/);
  assert.match(page, /dayEvents.length > 25 \? <ClusterButton/);
  assert.match(page, /className="calendar-week-more-v11"/);
});

test("Day and selected-date inspector can reveal every loaded event in bounded chunks", () => {
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.equal((page.match(/visibleSelectedEvents\.map\(/g) || []).length, 2);
  assert.equal((page.match(/setSelectedDayLimit\(\(limit\) => limit \+ 25\)/g) || []).length, 2);
  assert.match(page, /selectedEvents.length > selectedDayLimit/);
  assert.match(page, /<strong>\{selectedEvents.length\}<\/strong> Selected/);
  assert.doesNotMatch(page, /selectedEvents\.length \? selectedEvents\.map/);
});

test("Agenda shows a truthful count and has on-demand paging tied to current filters", () => {
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.match(page, /const agendaEvents = calendarEventPage\(filteredEvents, agendaLimit\)/);
  assert.match(page, /Showing \{agendaEvents.length\} of \{filteredEvents.length\} authorized events/);
  assert.match(page, /filteredEvents.length > agendaLimit/);
  assert.match(page, /setAgendaLimit\(\(limit\) => limit \+ 20\)/);
  assert.match(page, /setAgendaLimit\(20\); \}, \[agendaScopeKey\]/);
});

test("No new request, permission or mutation authority; responsive focus stays visible", () => {
  const helper = read(calendarFile("calendar-event-visibility.ts"));
  assert.doesNotMatch(helper, /\bapi\(|\bqueryApi\(|\bfetch\(|\bprisma\./);
  assert.doesNotMatch(helper, /\.\.\.\(byDay\.get/);
  const page = read(calendarFile("CalendarPage.tsx"));
  assert.match(page, /queryApi<CalendarEvent\[]>\(eventsPath/);
  assert.match(page, /queryApi<TimelinePayload>\(timelinePath/);
  assert.match(page, /createCalendarMutationGate/);
  const css = read(calendarFile("calendar.css"));
  assert.ok(postcss.parse(css).nodes.length);
  for (const expression of [/calendar-more-action-v11/, /calendar-week-more-v11/, /calendar-event-next-v11/, /:focus-visible/, /@media\(pointer:coarse\)/, /min-height:44px/, /@media\(prefers-reduced-motion:reduce\)/]) assert.match(css, expression);
});
for (const file of ["CalendarPage.tsx", "calendar-event-visibility.ts"]) {
  const full = calendarFile(file);
  const sf = ts.createSourceFile(full, read(full), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length, 0, full);
}
console.log(`${count}/${count} Calendar visible-overflow regression checks passed`);

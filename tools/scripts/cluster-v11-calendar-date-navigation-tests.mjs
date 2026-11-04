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
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pathOf = (name) => "packages/renderer/src/features/calendar/" + name;
const compiled = ts.transpileModule(read(pathOf("calendar-date-navigation.ts")), {
  fileName: "calendar-date-navigation.ts",
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, Date });
const { addCalendarMonths, calendarDateInputValue, parseCalendarLocalDate, shiftCalendarWindow } = mod.exports;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS", name); };

test("Month navigation from the 31st never jumps over a short month", () => {
  const jan = new Date(2026, 0, 31, 9, 45);
  const feb = addCalendarMonths(jan, 1, 31);
  const mar = addCalendarMonths(feb, 1, 31);
  assert.deepEqual([feb.getFullYear(), feb.getMonth(), feb.getDate()], [2026, 1, 28]);
  assert.deepEqual([mar.getFullYear(), mar.getMonth(), mar.getDate()], [2026, 2, 31]);
  assert.deepEqual([mar.getHours(), mar.getMinutes()], [9, 45]);
});

test("Leap day and year-end transitions are clamped correctly", () => {
  const jan2028 = new Date(2028, 0, 31, 10);
  const leapDay = addCalendarMonths(jan2028, 1, 31);
  assert.deepEqual([leapDay.getMonth(), leapDay.getDate()], [1, 29]);
  assert.equal(addCalendarMonths(leapDay, 1, 31).getDate(), 31);
  const december = addCalendarMonths(new Date(2026, 11, 31), 1, 31);
  assert.deepEqual([december.getFullYear(), december.getMonth(), december.getDate()], [2027, 0, 31]);
});

test("Back navigation keeps the preferred month day when possible", () => {
  const mar = new Date(2026, 2, 31);
  const feb = shiftCalendarWindow(mar, mar, "month", -1, 31);
  const jan = shiftCalendarWindow(feb.anchor, feb.selected, "month", -1, 31);
  assert.deepEqual([feb.anchor.getMonth(), feb.anchor.getDate()], [1, 28]);
  assert.deepEqual([jan.anchor.getMonth(), jan.anchor.getDate()], [0, 31]);
  assert.equal(feb.selected.getTime(), feb.anchor.getTime());
});

test("Day view advances both the fetched date and inspector-selected day", () => {
  const first = new Date(2026, 10, 4);
  const next = shiftCalendarWindow(first, first, "day", 1);
  assert.equal(calendarDateInputValue(next.anchor), "2026-11-05");
  assert.equal(next.selected.getTime(), next.anchor.getTime());
});

test("Week view keeps a selected weekday while shifting by a week", () => {
  const anchor = new Date(2026, 10, 1);
  const selected = new Date(2026, 10, 4);
  const next = shiftCalendarWindow(anchor, selected, "week", 1);
  assert.equal(calendarDateInputValue(next.anchor), "2026-11-08");
  assert.equal(calendarDateInputValue(next.selected), "2026-11-11");
});

test("DST boundary movement uses calendar dates, not 24-hour milliseconds", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const beforeSpring = new Date(2026, 2, 7, 9, 20);
    const next = shiftCalendarWindow(beforeSpring, beforeSpring, "day", 1);
    assert.equal(calendarDateInputValue(next.anchor), "2026-03-08");
    assert.equal(next.anchor.getHours(), 9);
    const after = shiftCalendarWindow(next.anchor, next.selected, "day", 1);
    assert.equal(calendarDateInputValue(after.anchor), "2026-03-09");
    assert.equal(after.anchor.getHours(), 9);
    assert.equal(calendarDateInputValue(addCalendarMonths(beforeSpring, 1)), "2026-04-07");
  } finally {
    if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  }
});

test("Direct date navigation rejects impossible and malformed dates", () => {
  for (const value of ["", "2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "not-a-date", "26-11-04"]) {
    assert.equal(parseCalendarLocalDate(value), null, value);
  }
  const date = parseCalendarLocalDate("2028-02-29");
  assert.ok(date);
  assert.equal(calendarDateInputValue(date), "2028-02-29");
  assert.equal(date.getHours(), 0);
});

test("Native jump and view changes keep the selected date aligned with query range", () => {
  const page = read(pathOf("CalendarPage.tsx"));
  assert.match(page, /function jumpToCalendarDate\(value: string\)/);
  assert.match(page, /parseCalendarLocalDate\(value\)/);
  assert.match(page, /setAnchorDate\(date\);\s*setSelectedDate\(date\)/);
  assert.match(page, /value=\{calendarDateInputValue\(anchorDate\)\}/);
  assert.match(page, /type="date" aria-label="Jump to calendar date"/);
  assert.match(page, /if \(next === "day" \|\| next === "week"\)/);
  assert.match(page, /onChange=\{changeCalendarView\}/);
});

test("Calendar month/window buttons are driven by one pure shift function", () => {
  const page = read(pathOf("CalendarPage.tsx"));
  assert.match(page, /shiftCalendarWindow\(anchorDate, selectedDate, view, amount, preferredMonthDayRef.current\)/);
  assert.match(page, /setAnchorDate\(next.anchor\);\s*setSelectedDate\(next.selected\)/);
  assert.match(page, /preferredMonthDayRef.current = now.getDate\(\)/);
  assert.match(page, /onClick=\{\(\) => selectCalendarDate\(day\)\}/);
  assert.doesNotMatch(page, /function addMonths\(value: Date/);
});

test("Agenda navigates the loaded date window instead of filtering everything before now", () => {
  const page = read(pathOf("CalendarPage.tsx"));
  assert.match(page, /const agendaEvents = filteredEvents.slice\(0, 20\)/);
  assert.match(page, /filteredEvents.length > agendaEvents.length/);
  assert.match(page, /Showing the first 20 of \{filteredEvents.length\}/);
  assert.match(page, /addDays\(range.end, -1\).toLocaleDateString/);
  assert.match(page, /No events match this agenda range/);
  assert.doesNotMatch(page, /const upcomingEvents = filteredEvents.filter/);
});

test("Calendar still relies on the same authorized event and timeline endpoints", () => {
  const page = read(pathOf("CalendarPage.tsx"));
  assert.match(page, /queryApi<CalendarEvent\[]>\(eventsPath/);
  assert.match(page, /queryApi<TimelinePayload>\(timelinePath/);
  assert.match(page, /const range = useMemo/);
  assert.match(page, /setApiQueryData\(eventsPath, next/);
  assert.match(page, /createCalendarMutationGate/);
});

test("Date toolbar remains keyboard accessible and mobile-coherent", () => {
  const css = read(pathOf("calendar.css"));
  assert.ok(postcss.parse(css).nodes.length > 0);
  for (const regex of [/\.calendar-date-jump-v11/, /:focus-visible/, /@media\(pointer:coarse\)/, /@media\(max-width:620px\)/, /min-height:44px/, /calendar-agenda-limit-v11/]) assert.match(css, regex);
});
const page = read(pathOf("CalendarPage.tsx"));
assert.equal(ts.createSourceFile("CalendarPage.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
console.log(`${passed}/${passed} Calendar date navigation checks passed`);

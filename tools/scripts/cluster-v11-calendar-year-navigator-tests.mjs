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
const file = (name) => "packages/renderer/src/features/calendar/" + name;
const compiled = ts.transpileModule(read(file("calendar-year-projection.ts")), {
  fileName: file("calendar-year-projection.ts"), reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, Date, Number });
const { calendarYearMonths, calendarYearNextDate } = mod.exports;
let count = 0;
const test = (name, fn) => { fn(); count++; console.log("PASS " + name); };
const key = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

test("Year projection creates exactly twelve real month cards and 365 distinct local days", () => {
  const months = calendarYearMonths(2026);
  assert.equal(months.length, 12);
  assert.deepEqual(Array.from(months.map((m) => m.month)), Array.from({ length: 12 }, (_, i) => i));
  const days = months.flatMap((month) => month.days.filter(Boolean));
  assert.equal(days.length, 365);
  assert.equal(new Set(days.map(key)).size, 365);
  assert.equal(key(days[0]), "2026-01-01");
  assert.equal(key(days[364]), "2026-12-31");
});

test("Each mini-month follows weekday columns and does not generate adjacent-month buttons", () => {
  for (const month of calendarYearMonths(2026)) {
    assert.equal(month.days.length % 7, 0);
    const first = month.days.find(Boolean);
    const last = [...month.days].reverse().find(Boolean);
    assert.equal(first.getDate(), 1);
    assert.equal(last.getMonth(), month.month);
    assert.equal(month.days.slice(0, first.getDay()).every((d) => d === null), true);
    for (const day of month.days.filter(Boolean)) {
      assert.equal(day.getMonth(), month.month);
      assert.equal(day.getFullYear(), 2026);
    }
  }
});

test("Leap-year February has 29 buttons and normal February has 28", () => {
  const leap = calendarYearMonths(2028)[1].days.filter(Boolean);
  const normal = calendarYearMonths(2027)[1].days.filter(Boolean);
  assert.equal(leap.length, 29);
  assert.equal(normal.length, 28);
  assert.equal(key(leap[28]), "2028-02-29");
});

test("Year offset preserves month, local time and clamps leap dates without DST arithmetic", () => {
  const leap = new Date(2028, 1, 29, 9, 15);
  const earlier = calendarYearNextDate(leap, -1, 29);
  assert.equal(key(earlier), "2027-02-28");
  assert.equal(earlier.getHours(), 9);
  assert.equal(earlier.getMinutes(), 15);
  assert.equal(key(calendarYearNextDate(earlier, 1, 29)), "2028-02-29");
  assert.equal(key(calendarYearNextDate(new Date(2026, 11, 31), 1)), "2027-12-31");
});

test("Invalid, unsafe and out-of-range years never silently roll into another calendar", () => {
  for (const value of [NaN, Infinity, -1, 0, 999, 10000, 2026.5]) {
    assert.equal(calendarYearMonths(value).length, 0);
  }
  assert.equal(Number.isNaN(calendarYearNextDate(new Date(2026, 0, 1), Infinity).getTime()), true);
  assert.equal(Number.isNaN(calendarYearNextDate(new Date(9999, 0, 1), 1).getTime()), true);
});

test("Year is a local navigator, not a fabricated annual data/permissions authority", () => {
  const page = read(file("CalendarPage.tsx"));
  assert.match(page, /useState<"year" \| "month" \| "week" \| "day" \| "agenda">\("month"\)/);
  assert.match(page, /if \(view === "month" \|\| view === "year"\) return \{ start: monthDays\[0\], end: addDays\(monthDays\[41\], 1\) \}/);
  assert.match(page, /\["year", "month", "week", "day", "agenda"\]/);
  assert.match(page, /view === "year" && <CalendarYearNavigator/);
  assert.match(page, /onOpenMonth=\{openYearMonth\}/);
  assert.match(page, /onOpenDay=\{openYearDay\}/);
  assert.match(page, /metrics=\{view === "year" \? \[\] : \[/);
  assert.match(page, /showPlanningTools && view !== "year"/);
  assert.match(page, /view !== "year" && <aside/);
  assert.match(page, /setView\("month"\)/);
  assert.match(page, /setView\("day"\)/);
  const year = read(file("calendar-year-projection.ts"));
  assert.doesNotMatch(year, /\bapi\(|\bfetch\(|\bqueryApi\(|\bprisma\./);
});

test("Month/day controls are semantic buttons with true labels and no fake year occupancy", () => {
  const view = read(file("CalendarYearNavigator.tsx"));
  assert.match(view, /role="group" aria-label=\{/);
  assert.match(view, /aria-label=\{\`Open \$\{month\.title\} \$\{year\} monthly schedule\`\}/);
  assert.match(view, /onClick=\{\(\) => onOpenMonth\(month\.month\)\}/);
  assert.match(view, /onClick=\{\(\) => onOpenDay\(day\)\}/);
  assert.match(view, /aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(view, /Event counts are not shown for dates outside the currently loaded window/);
  assert.doesNotMatch(view, /eventCount|loadedYearEvents|yearEvents\.length/);
});

test("Keyboard navigation supports arrows, Home/End, PageUp/PageDown with one day tab-stop per month", () => {
  const view = read(file("CalendarYearNavigator.tsx"));
  for (const action of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
    assert.match(view, new RegExp(`event\\.key === "${action}"`));
  }
  assert.match(view, /tabIndex=\{tabbable \? 0 : -1\}/);
  assert.match(view, /onFocus=\{\(\) => setFocusDayKey\(key\)\}/);
  assert.match(view, /next\.getFullYear\(\) !== year/);
  assert.match(view, /\.focus\(\{ preventScroll: false \}\)/);
});

test("Responsive styles preserve coarse-pointer, keyboard and reduced-motion handling", () => {
  const css = read(file("calendar.css"));
  assert.ok(postcss.parse(css).nodes.length);
  for (const pat of [/calendar-year-months-v11/, /calendar-year-day-v11/, /calendar-workspace-year-v11/, /:focus-visible/, /@media\(pointer:coarse\)/, /min-height:44px/, /@media\(prefers-reduced-motion:reduce\)/]) assert.match(css, pat);
});

for (const name of ["CalendarPage.tsx", "CalendarYearNavigator.tsx", "calendar-year-projection.ts", "calendar-date-navigation.ts"]) {
  const p = file(name);
  assert.equal(ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length, 0, p);
}
console.log(`${count}/${count} Calendar Year navigator checks passed`);

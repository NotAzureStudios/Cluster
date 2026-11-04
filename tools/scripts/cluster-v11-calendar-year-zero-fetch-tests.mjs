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
const calendar = (name) => "packages/renderer/src/features/calendar/" + name;
const compiled = ts.transpileModule(read(calendar("calendar-view-data-policy.ts")), {
  fileName: calendar("calendar-view-data-policy.ts"), reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports });
const { calendarViewNeedsRangeData } = mod.exports;
let count = 0;
const test = (label, fn) => { fn(); count++; console.log("PASS " + label); };

test("Year data request budget is zero; all actual schedule views are supported", () => {
  assert.equal(calendarViewNeedsRangeData("year"), false);
  for (const view of ["month", "week", "day", "agenda"]) assert.equal(calendarViewNeedsRangeData(view), true, view);
});

test("Central loaders guard both normal refresh and mutation-triggered Calendar calls", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /const calendarViewRef = useRef\(view\)/);
  assert.match(page, /calendarViewRef\.current = view/);
  const eventLoader = page.slice(page.indexOf("async function loadEvents("), page.indexOf("async function loadTimeline("));
  const timelineLoader = page.slice(page.indexOf("async function loadTimeline("), page.indexOf("async function loadUsers("));
  for (const loader of [eventLoader, timelineLoader]) assert.match(loader, /if \(!calendarViewNeedsRangeData\(calendarViewRef\.current\)\) return/);
  assert.match(eventLoader, /queryApi<CalendarEvent\[]>\(eventsPath/);
  assert.match(timelineLoader, /queryApi<TimelinePayload>\(timelinePath/);
});

test("Switching to Year cancels pending events/overlays and clears stale snapshots", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /if \(!calendarViewNeedsRangeData\(view\)\) \{\s*eventsRequestSequence\.current \+= 1;\s*setEventsSnapshotPath\(""\)/);
  assert.match(page, /if \(!calendarViewNeedsRangeData\(view\)\) \{\s*timelineRequestSequence\.current \+= 1;\s*setTimelineSnapshotPath\(""\)/);
  assert.match(page, /return \(\) => \{ eventsRequestSequence\.current \+= 1; \};\s*\}, \[eventsPath, view\]\)/);
  assert.match(page, /return \(\) => \{ timelineRequestSequence\.current \+= 1; \};\s*\}, \[timelinePath, view\]\)/);
});

test("Returning from Year to same Month window triggers both loaders again", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /void loadEvents\(\);\s*return \(\) => \{ eventsRequestSequence/);
  assert.match(page, /void loadTimeline\(\);\s*return \(\) => \{ timelineRequestSequence/);
  assert.match(page, /\[eventsPath, view\]/);
  assert.match(page, /\[timelinePath, view\]/);
});

test("Year snapshots never render even if a stale callback or event edit completed", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /visibleTimelineEntries = calendarViewNeedsRangeData\(view\) && timelineSnapshotPath === timelinePath \? timelineEntries : \[\]/);
  assert.match(page, /visibleEvents = calendarViewNeedsRangeData\(view\) && eventsSnapshotPath === eventsPath \? events : \[\]/);
  assert.match(page, /calendarViewNeedsRangeData\(calendarViewRef\.current\)\) void loadEvents\(true\)/);
  assert.match(page, /\[range\.start\.getTime\(\), range\.end\.getTime\(\), view\]/);
});

test("Resource changes and background refresh respect the central guarded loaders", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /useResourceChangeRefresh\(async \(\) => \{\s*await Promise\.all\(\[loadEvents\(true\), loadTimeline\(true\)\]\)/);
  assert.match(page, /onSaved=\{\(change\) =>/);
  assert.match(page, /void loadEvents\(true\)/);
});

test("The Year navigator still declares no fake year-wide event totals", () => {
  const page = read(calendar("CalendarPage.tsx"));
  assert.match(page, /if \(view === "month" \|\| view === "year"\) return/);
  assert.match(page, /metrics=\{view === "year" \? \[\] : \[/);
  assert.match(page, /view === "year" && <CalendarYearNavigator/);
  const helper = read(calendar("calendar-view-data-policy.ts"));
  assert.doesNotMatch(helper, /\bapi\(|\bfetch\(|\bqueryApi\(|\bprisma\./);
});

for (const p of [calendar("calendar-view-data-policy.ts"), calendar("CalendarPage.tsx")]) {
  assert.equal(ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true,
    p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length, 0, p);
}
console.log(`${count}/${count} Calendar Year zero-fetch checks passed`);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (p) => fs.readFileSync(path.join(root,p),"utf8");
const cal = (p) => "packages/renderer/src/features/calendar/"+p;
const policyFile=cal("calendar-view-data-policy.ts");
const compiled=ts.transpileModule(read(policyFile),{
 fileName:policyFile,reportDiagnostics:true,
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports});
const {calendarViewNeedsRangeData,calendarViewNeedsEvents,calendarViewNeedsTimeline}=mod.exports;
let count=0;
function test(label,fn){fn();count++;console.log("PASS "+label);}

test("Year requests zero Events or Timeline data for every layer combination",()=>{
 for(const events of [false,true])
 for(const timeline of [false,true])
 for(const cards of [false,true]){
  const layers={events,timeline,cards};
  assert.equal(calendarViewNeedsRangeData("year"),false);
  assert.equal(calendarViewNeedsEvents("year",layers),false);
  assert.equal(calendarViewNeedsTimeline("year",layers),false);
 }
});
test("Month/Week/Day/Agenda fetch each needed source exactly when visible",()=>{
 for(const view of ["month","week","day","agenda"])
 for(const events of [false,true])
 for(const timeline of [false,true])
 for(const cards of [false,true]){
  const layers={events,timeline,cards};
  assert.equal(calendarViewNeedsEvents(view,layers),events,view);
  assert.equal(calendarViewNeedsTimeline(view,layers),timeline||cards,view);
 }
});
test("Disabling Timeline while Card deadlines remain enabled still keeps shared endpoint",()=>{
 const view="month";
 assert.equal(calendarViewNeedsTimeline(view,{events:false,timeline:false,cards:true}),true);
 assert.equal(calendarViewNeedsTimeline(view,{events:true,timeline:false,cards:false}),false);
 assert.equal(calendarViewNeedsTimeline(view,{events:false,timeline:false,cards:false}),false);
});
test("Central loaders are source-aware, including manual and automatic refresh",()=>{
 const page=read(cal("CalendarPage.tsx"));
 const a=page.slice(page.indexOf("async function loadEvents("),page.indexOf("async function loadTimeline("));
 const b=page.slice(page.indexOf("async function loadTimeline("),page.indexOf("async function loadUsers("));
 assert.ok(a.includes("calendarViewNeedsEvents(calendarViewRef.current, calendarLayerRef.current)"));
 assert.ok(b.includes("calendarViewNeedsTimeline(calendarViewRef.current, calendarLayerRef.current)"));
 assert.ok(a.includes("queryApi<CalendarEvent[]>(eventsPath"));
 assert.ok(b.includes("queryApi<TimelinePayload>(timelinePath"));
 assert.ok(page.includes("useResourceChangeRefresh(async () =>"));
});
test("Turning off a layer invalidates late responses and clears matching snapshot path",()=>{
 const page=read(cal("CalendarPage.tsx"));
 assert.ok(page.includes("if (!calendarViewNeedsEvents(view, layers)) {"));
 assert.ok(page.includes("if (!calendarViewNeedsTimeline(view, layers)) {"));
 assert.ok(page.includes('setEventsSnapshotPath("");'));
 assert.ok(page.includes('setTimelineSnapshotPath("");'));
 assert.ok(page.includes("[eventsPath, view, layers.events]"));
 assert.ok(page.includes("[timelinePath, view, layers.timeline, layers.cards]"));
 assert.ok(page.includes("eventsRequestSequence.current += 1"));
 assert.ok(page.includes("timelineRequestSequence.current += 1"));
});
test("Reenabling a layer on same path triggers load effects, not extra permanent polling",()=>{
 const page=read(cal("CalendarPage.tsx"));
 assert.ok(page.includes("void loadEvents();"));
 assert.ok(page.includes("void loadTimeline();"));
 assert.ok(page.includes("[eventsPath, view, layers.events]"));
 assert.ok(page.includes("[timelinePath, view, layers.timeline, layers.cards]"));
 assert.ok(page.includes("calendarViewNeedsEvents(calendarViewRef.current, calendarLayerRef.current)) void loadEvents(true)"));
});
test("Previously received Calendar data never renders when its layer becomes hidden",()=>{
 const page=read(cal("CalendarPage.tsx"));
 assert.ok(page.includes("calendarViewNeedsEvents(view, layers) && eventsSnapshotPath === eventsPath"));
 assert.ok(page.includes("calendarViewNeedsTimeline(view, layers) && timelineSnapshotPath === timelinePath"));
 assert.ok(page.includes("calendarLayerRef.current = layers"));
 assert.ok(page.includes("filterCalendarDisplayItems("));
});
test("Request budgeting is pure and does not create permission or caching fallbacks",()=>{
 const source=read(policyFile);
 for(const forbidden of ["api(","queryApi(","fetch(","prisma.","localStorage","sessionStorage"])assert.equal(source.includes(forbidden),false,forbidden);
 assert.ok(!source.includes("setInterval"));
 for(const filename of [policyFile,cal("CalendarPage.tsx")]){
  const sf=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,filename.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(sf.parseDiagnostics.length,0,filename);
 }
});
console.log(count+"/"+count+" Calendar source request budget checks passed");

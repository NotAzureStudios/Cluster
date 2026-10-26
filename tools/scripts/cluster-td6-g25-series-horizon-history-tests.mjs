/** Source integration tests for bounded recurring reservations and safe Whiteboard conflicts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url),ts=require('typescript');
const read=p=>readFileSync(join(root,p),'utf8');
function load(name,imports={}) {
 const code=ts.transpileModule(read(name),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:key=>{if(key in imports) return imports[key]; throw Error('Unexpected import '+key)},Date,Intl,Map,Set,Number,Math,String,Array,JSON,Promise,Error}, {filename:name});
 return module.exports;
}
const occ=load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const policy=load('apps/server/src/domains/planning/calendar-series-horizon.ts',{'./calendar-reminder-occurrences.js':occ});
const at=x=>new Date(x);
const monday=at('2026-10-26T09:00:00Z');
const base=(overrides={})=>({startsAt:monday,endsAt:at('2026-10-26T10:00:00Z'),timezone:'UTC',recurrenceRule:'FREQ=WEEKLY',recurrenceEndDate:'2026-12-07',userIds:['owner'],resources:[{resourceId:'room',quantity:1}],...overrides});
let count=0;
async function test(name, fn){await fn();count++;console.log('PASS G25 horizon/history '+name)}
await test('missing final meeting date cannot authorize an indefinite reservation',()=>{
 const r=policy.validateCalendarSeriesHorizon(base({recurrenceEndDate:null}));assert.equal(r.valid,false);assert.equal(r.code,'CALENDAR_SERIES_END_REQUIRED');
});
await test('full weekly series spans seven occurrences across the chosen end date',()=>{
 const r=policy.validateCalendarSeriesHorizon(base());assert.equal(r.valid,true);assert.equal(r.occurrences.length,7);assert.equal(r.occurrences.at(-1).toISOString(),'2026-12-07T09:00:00.000Z');
});
await test('client cannot select an invalid or excessively distant end date',()=>{
 for(const day of ['2026-02-30','2026-10-25','2028-01-01','nonsense']){const result=policy.validateCalendarSeriesHorizon(base({recurrenceEndDate:day}));assert.equal(result.valid,false,day)}
});
await test('daily/weekday limit is bounded while annual monthly is supported',()=>{
 assert.equal(policy.validateCalendarSeriesHorizon(base({recurrenceRule:'FREQ=DAILY',recurrenceEndDate:'2027-03-20'})).code,'CALENDAR_SERIES_TOO_LARGE');
 const monthly=policy.validateCalendarSeriesHorizon(base({recurrenceRule:'FREQ=MONTHLY',recurrenceEndDate:'2027-10-26'}));assert.equal(monthly.valid,true);assert.equal(monthly.occurrences.length,13);
});
await test('DST-aware recurrence end checks use local date rather than UTC date',()=>{
 const event={startsAt:at('2026-03-07T14:00:00Z'),endsAt:at('2026-03-07T15:00:00Z'),timezone:'America/New_York',recurrenceRule:'FREQ=DAILY',recurrenceEndDate:'2026-03-09',status:'scheduled',ownerId:'owner',reminderMinutes:30};
 const window=occ.calendarOccurrencesInWindow(event,at('2026-03-07T00:00:00Z'),at('2026-03-12T00:00:00Z'));
 assert.deepEqual(Array.from(window,x=>x.toISOString()),['2026-03-07T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-09T13:00:00.000Z']);
 assert.equal(occ.calendarOccurrenceIsValid(event,at('2026-03-10T13:00:00Z')),false);
 assert.equal(occ.dueCalendarReminderOccurrence(event,at('2026-03-10T12:30:00Z')),null);
});
await test('every occurrence receives a collision check, not only the first',async()=>{
 let calls=0;const result=await policy.checkCalendarSeriesConflicts({},base(),async(_,candidate)=>{
  calls++;return candidate.startsAt.toISOString().startsWith('2026-11-16')?[{kind:'resource',blockId:'busy',title:'Busy',severity:'high'}]:[];
 });
 assert.equal(calls,7);assert.equal(result.occurrenceStartsAt,'2026-11-16T09:00:00.000Z');assert.equal(result.conflicts.length,1);
});
await test('later incomplete checks defeat earlier ordinary conflicts, even if user requested override',async()=>{
 let calls=0;const result=await policy.checkCalendarSeriesConflicts({},base(),async()=>{calls++;return calls===2?[{blockId:'busy'}]:calls===5?[{blockId:'calendar-virtual:incomplete'}]:[]});
 assert.equal(calls,5);assert.equal(result.error.code,'CALENDAR_AVAILABILITY_INCOMPLETE');assert.equal(result.conflicts.length,0);
});
await test('edit series uses the old anchor exclusion throughout all checked windows',async()=>{
 const seen=[];const result=await policy.checkCalendarSeriesConflicts({},base({excludeBlockId:'anchor',excludeCalendarEventId:'same'}),async(_,q)=>{seen.push(q);return[]});
 assert.equal(result.conflicts.length,0);assert.equal(seen.length,7);assert.ok(seen.every(x=>x.excludeCalendarEventId==='same'&&x.excludeBlockId==='anchor'));
});
await test('unbounded old records remain unchanged until explicitly edited',()=>{
 const migration=read('apps/server/prisma/migrations/20261024200000_td6_g25_recurring_series_horizon/migration.sql');
 assert.match(migration,/ADD COLUMN "recurrenceEndDate" TEXT/);assert.doesNotMatch(migration,/UPDATE "CalendarEvent"/);
 assert.match(read('apps/server/src/domains/planning/calendar-routes.ts'),/CALENDAR_SERIES_END_REQUIRED|validateCalendarSeriesHorizon/);
});
await test('visual recurrence control and server contract agree on explicit end date',()=>{
 const ui=read('packages/renderer/src/features/calendar/CalendarPage.tsx');const route=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.match(ui,/Final occurrence date/);assert.match(ui,/recurrenceRule && !recurrenceEndDate/);
 assert.match(route,/checkCalendarSeriesConflicts/);assert.match(read('packages/shared/src/scheduling-contracts.ts'),/recurrenceEndDate/);
});
await test('Whiteboard conflict retains a local recovery copy without releasing server conflict barrier',()=>{
 const page=read('packages/renderer/src/features/whiteboards/WhiteboardWorkspacePage.tsx');
 assert.match(page,/Preserve local recovery copy/);assert.match(page,/if \(pendingRemote\) \{/);
 const surface=page.slice(page.indexOf('Review concurrent Whiteboard changes'),page.indexOf('<WhiteboardRecoveryBanner'));
 assert.match(surface,/persistWhiteboardRecovery\(activeWhiteboard\.id, draft\)/);assert.doesNotMatch(surface,/setPendingRemote\(null\)/);
});
await test('expired series are pruned from virtual candidate query without hiding legacy unbounded meetings',async()=>{
 const virtual=load('apps/server/src/domains/time/scheduler-calendar-availability.ts',{'@cluster/shared':{},'../planning/calendar-reminder-occurrences.js':occ});
 let captured;const db={calendarEvent:{findMany:async arg=>{captured=arg;return[];}}};
 await virtual.findCalendarVirtualOccupancy(db,{startsAt:at('2026-12-08T09:00:00Z'),endsAt:at('2026-12-08T10:00:00Z'),userIds:['owner'],resources:[]},[],new Map());
 const guard=captured.where.AND[0].OR;assert.ok(guard.some(x=>x.recurrenceEndDate===null));assert.ok(guard.some(x=>x.recurrenceEndDate?.gte==='2026-12-07'));
});
await test('Calendar list handles moved exceptions after their series expires',()=>{
 const route=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.match(route,/occurrenceExceptions: \{ some: \{ status: "rescheduled", movedStartsAt:/);
 assert.match(route,/recurrenceEndDate: \{ gte:/);
});
await test('reminder poller keeps moved exceptions while filtering expired series',()=>{
 for (const file of ['apps/server/src/app/server-job-runtime.ts','apps/server/src/domains/planning/calendar-reminder-lifecycle.ts']) {
  const src=read(file);assert.match(src,/recurrenceEndDate: \{ gte:/);assert.match(src,/occurrenceExceptions: \{ some: \{ status: "rescheduled", movedStartsAt:/);
 }
});
await test('source Calendar mutation checks entire series before insert or update under locks',()=>{
 const route=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.equal((route.match(/await checkCalendarSeriesConflicts\(/g)||[]).length,2);
 const beforeCreate=route.slice(route.indexOf('app.post("/api/calendar/events"'),route.indexOf('app.put("/api/calendar/events/:eventId"'));
 assert.ok(beforeCreate.indexOf('checkCalendarSeriesConflicts')<beforeCreate.indexOf('tx.calendarEvent.create'));
 const beforeUpdate=route.slice(route.indexOf('app.put("/api/calendar/events/:eventId"'),route.indexOf('app.patch("/api/calendar/events/:eventId/occurrence"'));
 assert.ok(beforeUpdate.indexOf('checkCalendarSeriesConflicts')<beforeUpdate.indexOf('tx.calendarEvent.update'));
});
console.log(`G25 horizon & conflict recovery source checks: ${count}/${count} passed`);

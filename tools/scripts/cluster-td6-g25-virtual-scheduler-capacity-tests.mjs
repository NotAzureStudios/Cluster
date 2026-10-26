/** G25 bounded recurrence capacity, privacy and Scheduler integration. Source-level harness. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url),ts=require('typescript');
const read=path=>readFileSync(join(root,path),'utf8');
function load(file,imports={}) {
 const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:key=>{if(key in imports)return imports[key];throw Error('Missing fixture '+key)},Date,Set,Map,JSON,Intl,Math,Number,String,Array,Promise,Error}, {filename:file});
 return mod.exports;
}
const occ=load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const virtual=load('apps/server/src/domains/time/scheduler-calendar-availability.ts',{
 '@cluster/shared':{},'../planning/calendar-reminder-occurrences.js':occ,
});
const at=s=>new Date(s);
const monday=at('2026-10-26T09:00:00Z'), end=at('2026-10-26T10:00:00Z');
function series(id,opts={}) { return {id,startsAt:at('2026-10-19T09:00:00Z'),endsAt:at('2026-10-19T10:00:00Z'),
  timezone:'UTC',recurrenceRule:'FREQ=WEEKLY',status:'scheduled',ownerId:'staff-'+id,attendeeIds:'[]',
  meeting:{id:'meeting-'+id},occurrenceExceptions:[], scheduleBlocks:[{placementAuthority:'calendar',occurrenceStartsAt:null, resourceReservations:[{resourceId:'room',quantity:1}]}],...opts}; }
function physical(id,qty,start=monday,finish=end,other={}) {return {id,startsAt:start,endsAt:finish,status:'confirmed',resourceReservations:[{resourceId:'room',quantity:qty}],...other};}
function checkSeries({resources=[{resourceId:'room',quantity:1}],userIds=[],startsAt=monday,endsAt=end,excludeOccurrence}={}, candidates=[series('other')], blocks=[],capacity=2) {
 return virtual.evaluateCalendarVirtualOccupancy({startsAt,endsAt,userIds,resources,excludeOccurrence},candidates,blocks,new Map([['room',capacity]]));
}
let count=0;
async function test(label,run) {await run();count++;console.log('PASS G25 virtual capacity '+label)}
await test('one virtual seat plus one requested seat fits a two-seat resource',()=>{
 const r=checkSeries();assert.equal(r.incomplete,false);assert.equal(r.conflicts.length,0);
});
await test('requested quantity over capacity rejects with precise quantities',()=>{
 const r=checkSeries({resources:[{resourceId:'room',quantity:2}]});const conflict=r.conflicts.find(x=>x.kind==='resource');
 assert.ok(conflict);assert.equal(conflict.capacity,2);assert.equal(conflict.reservedQuantity,1);assert.equal(conflict.requestedQuantity,2);
});
await test('two recurring series add capacity rather than overwriting each other',()=>{
 const r=checkSeries({},[series('a'),series('b')]);assert.equal(r.conflicts.filter(x=>x.kind==='resource').length,1);
});
await test('physical plus virtual commitments have a combined capacity peak',()=>{
 const r=checkSeries({},[series('a')],[physical('scheduler-1',1)]);
 assert.equal(r.conflicts.filter(x=>x.kind==='resource').length,1);
});
await test('non-overlapping physical window does not consume capacity',()=>{
 const r=checkSeries({},[series('a')],[physical('other-hour',1,at('2026-10-26T10:00:00Z'),at('2026-10-26T11:00:00Z'))]);
 assert.equal(r.conflicts.length,0);
});
await test('two recurring instances in one instant produce hard attendee conflicts',()=>{
 const candidate=series('a',{attendeeIds:'["shared"]'});const r=checkSeries({userIds:['shared'],resources:[]},[candidate]);
 assert.equal(r.conflicts.length,1);assert.equal(r.conflicts[0].kind,'person');assert.equal(r.conflicts[0].severity,'high');
});
await test('another participant or another resource does not create a false conflict',()=>{
 const candidate=series('a',{ownerId:'unrelated',attendeeIds:'["elsewhere"]'});
 const r=checkSeries({userIds:['requested'],resources:[{resourceId:'other-room',quantity:1}]},[candidate],[],2);
 assert.equal(r.incomplete,false);assert.equal(r.conflicts.length,0);
});
await test('cancellation removes only the cancelled recurring instance',()=>{
 const candidate=series('a',{occurrenceExceptions:[{status:'cancelled',occurrenceStartsAt:monday}]});
 assert.equal(checkSeries({},[candidate]).conflicts.length,0);
 const following=checkSeries({startsAt:at('2026-11-02T09:00:00Z'),endsAt:at('2026-11-02T10:00:00Z'),resources:[{resourceId:'room',quantity:2}]},[candidate]);
 assert.equal(following.conflicts.filter(x=>x.kind==='resource').length,1);
});
await test('moved instance is not projected twice into original slot',()=>{
 const candidate=series('a',{occurrenceExceptions:[{status:'rescheduled',occurrenceStartsAt:monday,movedStartsAt:at('2026-10-27T09:00:00Z'),movedEndsAt:at('2026-10-27T10:00:00Z')}]});
 assert.equal(checkSeries({resources:[{resourceId:'room',quantity:2}]},[candidate]).conflicts.length,0);
});
await test('physical first-instance anchor is counted once rather than twice',()=>{
 const candidate=series('a');const anchor=physical('anchor',1,at('2026-10-19T09:00:00Z'),at('2026-10-19T10:00:00Z'),{calendarEventId:'a',placementAuthority:'calendar',occurrenceStartsAt:null});
 const r=checkSeries({startsAt:anchor.startsAt,endsAt:anchor.endsAt},[candidate],[anchor]);
 assert.equal(r.incomplete,false);assert.equal(r.conflicts.length,0);
});
await test('self occurrence exclusion cannot hide another meeting',()=>{
 const input={excludeOccurrence:{calendarEventId:'a',occurrenceStartsAt:monday},resources:[{resourceId:'room',quantity:2}]};
 assert.equal(checkSeries(input,[series('a')]).conflicts.length,0);
 assert.equal(checkSeries(input,[series('a'),series('b')]).conflicts.filter(x=>x.kind==='resource').length,1);
});
await test('returned conflicts never expose private meeting titles or notes',()=>{
 const candidate=series('private',{title:'classified prototype',notes:'secret',attendeeIds:'["shared"]'});
 const value=JSON.stringify(checkSeries({userIds:['shared'],resources:[{resourceId:'room',quantity:2}]},[candidate]));
 assert.ok(!value.includes('classified prototype')&&!value.includes('secret'));
});
await test('unsupported RRULE is not silently treated as vacant',()=>{
 assert.equal(checkSeries({},[series('a',{recurrenceRule:'FREQ=YEARLY'})]).incomplete,true);
});
await test('invalid recurrence timezone cannot masquerade as no occupancy',()=>{
 const result=checkSeries({},[series('bad',{timezone:'Invalid/Hidden'})]);
 assert.equal(result.incomplete,true);
});
await test('too many matching recurring candidates are not silently truncated',()=>{
 assert.equal(checkSeries({},Array.from({length:501},(_,i)=>series(String(i)))).incomplete,true);
});
await test('invalid or missing occupancy capacity cannot prove availability',()=>{
 const r=virtual.evaluateCalendarVirtualOccupancy({startsAt:monday,endsAt:end,userIds:[],resources:[{resourceId:'room',quantity:1}]},[series('a')],[],new Map());
 assert.equal(r.incomplete,true);
});
await test('longer-than-supported recurrence window fails closed',()=>{
 const r=checkSeries({endsAt:at('2027-11-02T10:00:00Z')});assert.equal(r.incomplete,true);
});
await test('actual candidate query restricts to relevant users and resources',async()=>{
 let query;
 const db={calendarEvent:{findMany:async arg=>{query=arg;return [series('a')];}}};
 const r=await virtual.findCalendarVirtualOccupancy(db,{startsAt:monday,endsAt:end,userIds:['shared'],resources:[{resourceId:'room',quantity:1}]},[],new Map([['room',2]]));
 assert.equal(r.incomplete,false);assert.ok(query.where.OR.some(x=>x.ownerId));
 assert.ok(query.where.OR.some(x=>x.scheduleBlocks));assert.equal(query.take,501);
});
await test('shared Scheduler planner detects virtual capacity in actual conflict path',async()=>{
 const scheduler=load('apps/server/src/domains/time/scheduler-planning.ts',{
   '@cluster/shared':{SCHEDULING_CONTRACT:{scheduler:{maximumBlocksPerRange:500,maximumParticipantsPerBlock:200,maximumResourceQuantity:100,maximumResourcesPerBlock:100}}},
   '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
   './scheduler-calendar-availability.js':virtual,
 });
 const db={scheduleBlock:{findMany:async()=>[]},scheduleResource:{findMany:async()=>[{id:'room',name:'Room',quantityTotal:2,status:'active'}]},
   calendarEvent:{findMany:async()=>[series('a')]}, availabilityException:{findMany:async()=>[]}, user:{findMany:async()=>[]}};
 const common={startsAt:monday,endsAt:end,userIds:[],resources:[{resourceId:'room',quantity:2}]};
 const conflicts=await scheduler.findSchedulePlacementConflicts(db,common);
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].kind,'resource');assert.equal(conflicts[0].reservedQuantity,1);
 const valid=await scheduler.findSchedulePlacementConflicts(db,{...common,resources:[{resourceId:'room',quantity:1}]});
 assert.equal(valid.length,0);
});
await test('shared planner combines physical and virtual resource pressure in actual conflict path',async()=>{
 const scheduler=load('apps/server/src/domains/time/scheduler-planning.ts',{
   '@cluster/shared':{SCHEDULING_CONTRACT:{scheduler:{maximumBlocksPerRange:500,maximumParticipantsPerBlock:200,maximumResourceQuantity:100,maximumResourcesPerBlock:100}}},
   '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
   './scheduler-calendar-availability.js':virtual,
 });
 const db={scheduleBlock:{findMany:async()=>[physical('physical',1)]},scheduleResource:{findMany:async()=>[{id:'room',name:'Room',quantityTotal:2,status:'active'}]},
   calendarEvent:{findMany:async()=>[series('a')]}, availabilityException:{findMany:async()=>[]}, user:{findMany:async()=>[]}};
 const conflicts=await scheduler.findSchedulePlacementConflicts(db,{startsAt:monday,endsAt:end,userIds:[],resources:[{resourceId:'room',quantity:1}]});
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].reservedQuantity,2);
});
await test('shared planner fails closed rather than inventing availability on recurrence truncation',async()=>{
 const scheduler=load('apps/server/src/domains/time/scheduler-planning.ts',{
   '@cluster/shared':{SCHEDULING_CONTRACT:{scheduler:{maximumBlocksPerRange:500,maximumParticipantsPerBlock:200,maximumResourceQuantity:100,maximumResourcesPerBlock:100}}},
   '../../core/postgres-advisory-lock.js':{acquireTransactionAdvisoryLock:async()=>{}},
   './scheduler-calendar-availability.js':virtual,
 });
 const db={scheduleBlock:{findMany:async()=>[]},scheduleResource:{findMany:async()=>[{id:'room',name:'Room',quantityTotal:2,status:'active'}]},
   calendarEvent:{findMany:async()=>[series('a',{recurrenceRule:'FREQ=YEARLY'})]}, availabilityException:{findMany:async()=>[]}, user:{findMany:async()=>[]}};
 const conflicts=await scheduler.findSchedulePlacementConflicts(db,{startsAt:monday,endsAt:end,userIds:[],resources:[{resourceId:'room',quantity:1}]});
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].blockId,'calendar-virtual:incomplete');
});
await test('pure recurrence exclusion is scoped to the edited series, not a resource',()=>{
 const r=checkSeries({resources:[{resourceId:'room',quantity:2}],excludeCalendarEventId:'a'},[series('a'),series('b')]);
 assert.equal(r.conflicts.filter(x=>x.kind==='resource').length,1);
});
await test('planner UI prevents override when the server cannot verify occupancy',()=>{
 const dialog=read('packages/renderer/src/features/time/SchedulePlanningDialog.tsx');
 assert.match(dialog,/!availabilityIncomplete \?/);assert.match(dialog,/busy \|\| availabilityIncomplete/);assert.match(dialog,/Availability not verified/);
 const workspace=read('packages/renderer/src/features/time/TimeWorkspacePage.tsx');
 assert.match(workspace,/CALENDAR_AVAILABILITY_INCOMPLETE/);
});
await test('Scheduler physical planner uses shared virtual check and explicit fail-closed signal',()=>{
 const planner=read('apps/server/src/domains/time/scheduler-planning.ts');
 assert.match(planner,/findCalendarVirtualOccupancy\(prisma/);assert.match(planner,/calendar-virtual:incomplete/);
 const routes=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.match(routes,/excludeCalendarOccurrence: \{ calendarEventId: eventId/);
 assert.doesNotMatch(routes,/async function recurringCalendarConflicts/);
 assert.match(read('apps/server/src/domains/time/time-routes.ts'),/CALENDAR_AVAILABILITY_INCOMPLETE/);
 assert.match(read('apps/server/src/domains/time/scheduler-resource-routes.ts'),/findSchedulePlacementConflicts/);
});
console.log(`G25 virtual Scheduler capacity checks: ${count}/${count} passed`);

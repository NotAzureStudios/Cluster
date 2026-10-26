import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const text = (name) => readFileSync(join(root, name), 'utf8');
function load(name, imports={}) {
  const transpiled = ts.transpileModule(text(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, { module, exports: module.exports, require: (name) => {if(name in imports) return imports[name]; throw Error('Unexpected import: '+name)}, Date, Promise, JSON, Map, Set, Math, Intl, Error, Number, Array, String, Boolean }, { filename: name });
  return module.exports;
}
const occ=load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const access=load('apps/server/src/domains/planning/calendar-access.ts');
let checks=0;
async function test(label,run){await run();checks++;console.log('PASS',label)}
const template=(more={})=>({id:'calendar1',ownerId:'owner',delegateIds:'["delegate"]',projectId:null,visibility:'private',attendeeIds:'[]',title:'Studio sync',startsAt:new Date('2026-03-07T14:00:00Z'),endsAt:new Date('2026-03-07T15:00:00Z'),timezone:'America/New_York',recurrenceRule:'FREQ=DAILY',status:'scheduled',reminderMinutes:30,revision:1,occurrenceExceptions:[],scheduleBlocks:[],meeting:null,project:null,...more});
const at=(value)=>new Date(value);
await test('daily projection maintains wall-clock time through spring DST',()=>{
 const rows=occ.calendarOccurrencesInWindow(template(), at('2026-03-07T00:00:00Z'),at('2026-03-10T00:00:00Z'));
 assert.deepEqual(Array.from(rows,x=>x.toISOString()),['2026-03-07T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-09T13:00:00.000Z']);
});
await test('recurrence membership rejects made-up timestamps and invalid RRULEs',()=>{
 const event=template();assert.equal(occ.calendarOccurrenceIsValid(event,at('2026-03-08T13:00:00Z')),true);
 assert.equal(occ.calendarOccurrenceIsValid(event,at('2026-03-08T14:00:00Z')),false);
 assert.equal(occ.calendarOccurrenceIsValid({...event,recurrenceRule:'FREQ=YEARLY'},at('2026-03-08T13:00:00Z')),false);
});
await test('weekday and monthly occurrence projection has correct exclusions',()=>{
 const weekday=template({timezone:'UTC',startsAt:at('2026-10-19T09:00:00Z'),recurrenceRule:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'});
 const rows=occ.calendarOccurrencesInWindow(weekday,at('2026-10-19T00:00:00Z'),at('2026-10-27T00:00:00Z'));
 assert.equal(rows.length,6);assert.ok(rows.every(x=>x.getUTCDay() !== 0 && x.getUTCDay() !== 6));
 const monthly=template({timezone:'UTC',startsAt:at('2026-01-31T09:00:00Z'),recurrenceRule:'FREQ=MONTHLY'});
 assert.deepEqual(Array.from(occ.calendarOccurrencesInWindow(monthly,at('2026-02-01T00:00:00Z'),at('2026-04-02T00:00:00Z')), x=>x.toISOString()),['2026-03-31T09:00:00.000Z']);
});
await test('millisecond precision is stable across recurrence projection',()=>{
 const recurring=template({timezone:'UTC',startsAt:at('2026-01-01T09:00:00.341Z')});
 const next=at('2026-01-02T09:00:00.341Z');
 assert.equal(occ.calendarOccurrenceIsValid(recurring,next),true);
 assert.equal(occ.calendarOccurrencesInWindow(recurring,at('2026-01-02T00:00:00Z'),at('2026-01-03T00:00:00Z'))[0]?.toISOString(),next.toISOString());
});
await test('cancelled occurrence is omitted from reminder but not neighboring occurrences',()=>{
 const event=template({occurrenceExceptions:[{status:'cancelled',occurrenceStartsAt:at('2026-03-08T13:00:00Z')}]});
 assert.equal(occ.dueCalendarReminderOccurrence(event,at('2026-03-08T12:30:00Z')),null);
 assert.equal(occ.dueCalendarReminderOccurrence(event,at('2026-03-09T12:30:00Z'))?.toISOString(),'2026-03-09T13:00:00.000Z');
});
const policy={
  identityForRequest:async(req)=>({user:{id:req.id},role:'member',decorated:{}}),
  hasToolPermission:(user,role,tool,min)=>user.id!=='no-tool',
  requestCanTarget:async(req,tool,target,project,min)=>req.id!=='denied',
  requestCanUserScope:async(req,{ownerUserId})=>req.id === ownerUserId,
  requireUserScope:async(req,reply,{ownerUserId})=>req.id===ownerUserId,
  requireTarget:async()=>true,
};
await test('explicit editor may access private unscoped event but not delete it by delegation alone',async()=>{
 const event=template();assert.equal(await access.canAccessCalendarEvent(policy,{id:'delegate'},event,'view'),true);
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'delegate'},event,'edit'),true);
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'outsider'},event,'view'),false);
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'no-tool'},event,'edit'),false);
});
await test('private Project delegation respects explicit target denial',async()=>{
 const project={id:'p1'};const event=template({projectId:'p1',project});
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'delegate'},event,'edit'),true);
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'denied'}, {...event, delegateIds:'["denied"]'},'view'),false);
 assert.equal(await access.canAccessCalendarEvent(policy,{id:'denied'}, {...event, delegateIds:'["denied"]'},'edit'),false);
});
// Execute actual registered Fastify handlers through lightweight contract stubs.
const chain=new Proxy(function(){},{get:(_target,prop)=>prop==='parse'?(value)=>value:()=>chain,apply:()=>chain});
const z=new Proxy({coerce:{number:()=>chain}},{get:(target,prop)=>target[prop]??(()=>chain)});
const handlers=new Map();
const events=new Map([['calendar1',template()]]);const exceptions=[];const activity=[];const blocks=[];const reservations=[];let scheduleConflicts=[];let blockCreateError=false;let externalCalendars=[];
const include=()=>({ ...events.get('calendar1'),occurrenceExceptions:exceptions.slice() });
const db={user:{count:async({where})=>where.id.in.length},meeting:{deleteMany:async()=>{}},calendarEvent:{findUnique:async()=>include(),findMany:async()=>[include(),...externalCalendars],update:async({data})=>{const event=events.get('calendar1'); const oldRevision=event.revision;Object.assign(event,data);event.revision=oldRevision+(data.revision?.increment || 0);return event},updateMany:async({where})=>{
 const event=events.get('calendar1');if(event.revision!==where.revision)return {count:0};event.revision++;return {count:1};
 }},calendarMeetingOccurrenceResponse:{deleteMany:async()=>({count:0}),findFirst:async()=>null,findMany:async()=>[]},
 calendarEventOccurrenceException:{create:async({data})=>{exceptions.push(data)},update:async({where,data})=>{const row=exceptions.find(r=>r.occurrenceStartsAt.getTime()===where.calendarEventId_occurrenceStartsAt.occurrenceStartsAt.getTime());Object.assign(row,data)},delete:async({where})=>{const date=where.calendarEventId_occurrenceStartsAt.occurrenceStartsAt.getTime(); const index=exceptions.findIndex(x=>x.occurrenceStartsAt.getTime()===date);if(index<0)throw Error('missing exception');exceptions.splice(index,1)}},
 scheduleResource:{findMany:async({where})=>[{id:'room',status:'active',quantityTotal:1}].filter(r=>where.id.in.includes(r.id))},
 scheduleBlock:{create:async({data})=>{if(blockCreateError)throw Error('BOOKING_FAILURE');const row={id:'block'+(blocks.length+1),...data,resourceReservations:[]};blocks.push(row);return row},update:async({where,data})=>{const row=blocks.find(b=>b.id===where.id);Object.assign(row,data);return row},delete:async({where})=>{const index=blocks.findIndex(b=>b.id===where.id);if(index>=0)blocks.splice(index,1)},updateMany:async()=>({count:0})},
 scheduleBlockResource:{createMany:async({data})=>{reservations.push(...data);return {count:data.length}},deleteMany:async({where})=>{reservations.splice(0,reservations.length,...reservations.filter(r=>r.blockId!==where.blockId));return {count:1}}},
 $transaction:async(fn)=>{const revision=events.get('calendar1').revision;const old=structuredClone(exceptions);const oldBlocks=structuredClone(blocks);const oldReservations=structuredClone(reservations);try{return await fn(db)}catch(e){events.get('calendar1').revision=revision;exceptions.splice(0,exceptions.length,...old);blocks.splice(0,blocks.length,...oldBlocks);reservations.splice(0,reservations.length,...oldReservations);throw e}}
};
const route=load('apps/server/src/domains/planning/calendar-routes.ts',{
 'zod':{z},'@cluster/shared':{SCHEDULING_CONTRACT:{calendar:{},scheduler:{}},clusterResolveEffectiveCalendarView:()=>({})},
 '../admin/project-tool-settings.js':{projectCalendarViewSnapshot:async()=>({})},
 '../work/work-assignment.js':{workAssignmentActivity:()=>null},
 '../../core/http-cache.js':{sendPrivateRevalidated:()=>null},
 '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
 './calendar-access.js':{canAccessCalendarEvent:access.canAccessCalendarEvent},
 './calendar-intervals.js':{calendarRangeWhere:()=>({}),isCalendarInstant:()=>true,isCalendarTimezone:()=>true,isCalendarWindowValid:()=>true},
 './calendar-reminder-occurrences.js':occ,
 './calendar-series-horizon.js':load('apps/server/src/domains/planning/calendar-series-horizon.ts', { './calendar-reminder-occurrences.js':occ }),
 '../time/scheduler-planning.js':{acquireSchedulePlacementLocks:async()=>{},findSchedulePlacementConflicts:async(_,input)=>{
    // The production Scheduler checks both physical blocks and virtual
    // recurring Calendar occupancy under its shared availability contract.
    const virtual=load('apps/server/src/domains/time/scheduler-calendar-availability.ts',{'@cluster/shared':{},'../planning/calendar-reminder-occurrences.js':occ});
    const projection=virtual.evaluateCalendarVirtualOccupancy({startsAt:input.startsAt,endsAt:input.endsAt,userIds:input.userIds||[],resources:input.resources||[],excludeOccurrence:input.excludeCalendarOccurrence},externalCalendars,[],new Map([['room',1]]));
    return [...scheduleConflicts,...projection.conflicts,...(projection.incomplete?[{kind:'resource',blockId:'calendar-virtual:incomplete'}]:[])];
  },normalizeScheduleResourceRequests:(rows)=>rows||[],normalizeScheduleTimezone:x=>x,replaceScheduleReservations:async(_,blockId,req)=>{reservations.splice(0,reservations.length,...reservations.filter(x=>x.blockId!==blockId));reservations.push(...req.map(r=>({blockId,...r}))) }},
});
route.registerCalendarRoutes({app:{get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),put:(path,fn)=>handlers.set('PUT '+path,fn),patch:(path,fn)=>handlers.set('PATCH '+path,fn),delete:(path,fn)=>handlers.set('DELETE '+path,fn)},prisma:db,getCurrentUser:async(req)=>({id:req.id}),logActivity:async(d)=>{activity.push(d)},readSettings:async()=>({}),serializeCalendarEvent:(e)=>e,authorization:policy});
const handler=handlers.get('PATCH /api/calendar/events/:eventId/occurrence');
const request=(id,action,instant,revision)=>({id,params:{eventId:'calendar1'},body:{occurrenceStartsAt:instant,action,expectedRevision:revision}});
async function call(req){const reply={status:200,code(value){this.status=value;return this},send(value){return value}};const body=await handler(req,reply);return {body,status:reply.status}}
await test('cancel occurrence through actual handler with CAS revision and persisted evidence',async()=>{
 const response=await call(request('delegate','cancel','2026-03-08T13:00:00.000Z',1));
 assert.equal(response.status,200);assert.equal(exceptions.length,1);assert.equal(events.get('calendar1').revision,2);
 assert.equal(activity.length,1);
});
await test('stale revision and duplicate cancellation fail closed without another record',async()=>{
 const stale=await call(request('delegate','cancel','2026-03-09T13:00:00.000Z',1));assert.equal(stale.status,409);
 const duplicate=await call(request('delegate','cancel','2026-03-08T13:00:00.000Z',2));assert.equal(duplicate.status,409);
 assert.equal(exceptions.length,1);assert.equal(events.get('calendar1').revision,2);
});
await test('restore exactly one cancelled occurrence and update series revision',async()=>{
 const response=await call(request('delegate','restore','2026-03-08T13:00:00.000Z',2));
 assert.equal(response.status,200);assert.equal(exceptions.length,0);assert.equal(events.get('calendar1').revision,3);
});
await test('invalid occurrence and unauthorized editor cannot mutate series',async()=>{
 assert.equal((await call(request('delegate','cancel','2026-03-08T14:00:00.000Z',3))).status,400);
 assert.equal((await call(request('outsider','cancel','2026-03-08T13:00:00.000Z',3))).status,403);
 assert.equal(events.get('calendar1').revision,3);
});
await test('list Calendar route materializes subsequent recurring occurrences by authorized request',async()=>{
 const list=handlers.get('GET /api/calendar/events');
 const reply={status:200,code(value){this.status=value;return this},send(value){return value}};
 const result=await list({id:'delegate',query:{start:'2026-03-07T00:00:00.000Z',end:'2026-03-10T00:00:00.000Z'}},reply);
 assert.equal(result.length,3);assert.equal(new Set(result.map(x=>x.occurrenceKey)).size,3);
 assert.equal(result[1].startsAt,'2026-03-08T13:00:00.000Z');
});
const update=handlers.get('PUT /api/calendar/events/:eventId');
const updateBody=(changes={})=>({ expectedRevision:events.get('calendar1').revision, ownerId:'owner',projectId:null,title:'Edited by delegate',startsAt:'2026-03-07T14:00:00Z',endsAt:'2026-03-07T15:00:00Z',attendeeIds:[],delegateIds:['delegate'],visibility:'private',timezone:'America/New_York',status:'scheduled',eventType:'focus',recurrenceRule:'FREQ=DAILY',...changes});
async function callUpdate(id,body){const reply={status:200,code(value){this.status=value;return this},send(value){return value}};const result=await update({id,params:{eventId:'calendar1'},body},reply);return {result,status:reply.status}}
await test('delegate edits existing event content without gaining owner, scope, or admin authority',async()=>{
 const result=await callUpdate('delegate',updateBody());assert.equal(result.status,200);
 assert.equal(events.get('calendar1').title,'Edited by delegate');assert.equal(events.get('calendar1').revision,4);
 assert.equal(events.get('calendar1').ownerId,'owner');
});
await test('delegate cannot change owner, Project, audience, or grant additional delegates',async()=>{
 for(const change of [{ownerId:'delegate'},{projectId:'new-project'},{attendeeIds:['outsider']},{delegateIds:['delegate','outsider']},{visibility:'studio'}]) {
  const status=(await callUpdate('delegate',updateBody(change))).status;
  assert.equal(status,403,'must reject '+JSON.stringify(change));
 }
 assert.equal(events.get('calendar1').revision,4);
});
await test('delegation is edit-only, not series deletion',async()=>{
 const handler=handlers.get('DELETE /api/calendar/events/:eventId');
 const reply={status:200,code(value){this.status=value;return this},send(value){return value}};
 await handler({id:'delegate',params:{eventId:'calendar1'},query:{expectedRevision:4}},reply);
 assert.equal(reply.status,403);assert.equal(events.get('calendar1').revision,4);
});
await test('series anchor is locked until skipped occurrences have been restored',async()=>{
 exceptions.push({status:'cancelled',occurrenceStartsAt:at('2026-03-08T13:00:00Z')});
 const response=await callUpdate('delegate',updateBody({startsAt:'2026-03-07T16:00:00Z'}));
 assert.equal(response.status,409);assert.equal(events.get('calendar1').revision,4);
 exceptions.length=0;
});
console.log(`G20 calendar delegation and occurrence scenarios: ${checks}/${checks} passed`);

export { handlers, events, exceptions, db, blocks, reservations, activity, template, at, occ, call, request };
export function setCalendarTestConflicts(value){scheduleConflicts=value} 
export function setCalendarBookingFailure(value){blockCreateError=value} 
export function setExternalCalendarTestEvents(value){externalCalendars=value}

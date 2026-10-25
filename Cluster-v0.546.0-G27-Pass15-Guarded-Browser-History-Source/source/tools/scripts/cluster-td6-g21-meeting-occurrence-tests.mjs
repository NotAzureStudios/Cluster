import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = (file) => readFileSync(join(root, file), 'utf8');
function load(file, imports = {}) {
  const output = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: (id) => {if (id in imports) return imports[id];throw Error('Unexpected import '+id)}, Date, Promise, JSON, Map, Set, Math, Intl, Error, Number, Array, String, Boolean }, { filename: file });
  return module.exports;
}
const calendar = load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const schema = source('apps/server/prisma/schema.prisma');
const migration = source('apps/server/prisma/migrations/20261021230000_td6_g21_calendar_meeting_occurrence_responses/migration.sql');
const ready = new Date('2026-03-08T13:00:00Z');
const event = {id:'calendar1', ownerId:'owner', attendeeIds:'["member"]', delegateIds:'[]', projectId:null, visibility:'participants', title:'Team Sync', startsAt:new Date('2026-03-07T14:00:00Z'), endsAt:new Date('2026-03-07T15:00:00Z'), timezone:'America/New_York', recurrenceRule:'FREQ=DAILY', status:'scheduled', reminderMinutes:30, reminderAudience:'participants', revision:1, occurrenceExceptions:[], scheduleBlocks:[], meeting:{organizerId:'owner',rsvpState:'{"owner":"accepted","member":"pending"}',attendanceState:'{"owner":"unknown","member":"unknown"}'}, project:null};
let responses = [];
let history = [];
let revision = 1;
let exceptions = [];
const snapshot = () => ({...event, revision, occurrenceExceptions: exceptions, meetingOccurrenceResponses: responses.map((row)=>({...row}))});
const db = {
  calendarEvent: { findUnique:async()=>snapshot(), findMany:async()=>[snapshot()] },
  calendarMeetingOccurrenceResponse: {
    findMany:async({where})=>responses.filter(row => (!where.calendarEventId?.in || where.calendarEventId.in.includes('calendar1')) && (!where.occurrenceStartsAt?.gte || row.occurrenceStartsAt >= where.occurrenceStartsAt.gte) && (!where.occurrenceStartsAt?.lt || row.occurrenceStartsAt < where.occurrenceStartsAt.lt) && (! (where.occurrenceStartsAt instanceof Date) || row.occurrenceStartsAt.getTime() === where.occurrenceStartsAt.getTime())),
    findFirst:async()=>responses.length?responses[0]:null,
    findUnique:async({where})=>responses.find((row)=>row.userId===where.calendarEventId_occurrenceStartsAt_userId.userId && row.occurrenceStartsAt.getTime()===where.calendarEventId_occurrenceStartsAt_userId.occurrenceStartsAt.getTime()) || null,
    create:async({data})=>{const row={id:`r${responses.length+1}`,...data,revision:1};if (responses.some(x=>x.userId===data.userId && x.occurrenceStartsAt.getTime()===data.occurrenceStartsAt.getTime())) throw Error('duplicate');responses.push(row);return row},
    updateMany:async({where,data})=>{const old=responses.find(row=>row.id===where.id && row.revision===where.revision);if(!old)return {count:0};Object.assign(old,data);old.revision=where.revision+(data.revision?.increment||0);return {count:1}},
  },
  $transaction: async(fn)=>{const snapshotOld=responses.map(row=>({...row}));try{const value=await fn(db);if(value?.error)responses=snapshotOld;return value}catch(e){responses=snapshotOld;throw e}},
};
const policy={
 identityForRequest:async(req)=>({user:{id:req.id},role:'member',decorated:{}}),
 hasToolPermission:()=>true,
 requestCanTarget:async()=>true,
 requestCanUserScope:async()=>false,
};
const access=load('apps/server/src/domains/planning/calendar-access.ts');
const chain=new Proxy(function(){},{get:(_target,prop)=>prop==='parse'?(value)=>value:()=>chain,apply:()=>chain});
const z=new Proxy({coerce:{number:()=>chain}},{get:(target,prop)=>target[prop]??(()=>chain)});
const handlers=new Map();
const route=load('apps/server/src/domains/planning/calendar-routes.ts',{
 'zod':{z},'@cluster/shared':{SCHEDULING_CONTRACT:{calendar:{meetingRsvpStates:['accepted','tentative','declined'],meetingAttendanceStates:['unknown','present','remote','absent','excused']},scheduler:{maximumParticipantsPerBlock:200}},clusterResolveEffectiveCalendarView:()=>({})},
 '../admin/project-tool-settings.js':{projectCalendarViewSnapshot:async()=>({})},
 '../work/work-assignment.js':{workAssignmentActivity:()=>null},
 '../../core/http-cache.js':{sendPrivateRevalidated:()=>null},
 '../access/authorization.js':{AUTHORIZATION_RULE_SELECT:{}},
 './calendar-access.js':{canAccessCalendarEvent:access.canAccessCalendarEvent},
 './calendar-intervals.js':{calendarRangeWhere:()=>({}),isCalendarInstant:()=>true,isCalendarTimezone:()=>true,isCalendarWindowValid:()=>true},
 './calendar-reminder-occurrences.js':calendar,
 './calendar-series-horizon.js':load('apps/server/src/domains/planning/calendar-series-horizon.ts', { './calendar-reminder-occurrences.js':calendar }),
 '../time/scheduler-planning.js':{acquireSchedulePlacementLocks:async()=>{},findSchedulePlacementConflicts:async()=>[],normalizeScheduleResourceRequests:()=>[],normalizeScheduleTimezone:x=>x,replaceScheduleReservations:async()=>{}},
});
route.registerCalendarRoutes({app:{get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),put:(path,fn)=>handlers.set('PUT '+path,fn),patch:(path,fn)=>handlers.set('PATCH '+path,fn),delete:(path,fn)=>handlers.set('DELETE '+path,fn)},prisma:db,getCurrentUser:async(req)=>({id:req.id}),logActivity:async(a)=>history.push(a),readSettings:async()=>({}),serializeCalendarEvent:(e)=>({...e,meeting:e.meeting?{...e.meeting,rsvp:JSON.parse(e.meeting.rsvpState),attendance:JSON.parse(e.meeting.attendanceState)}:null}),authorization:policy});
const update=handlers.get('PATCH /api/calendar/events/:eventId/occurrence-response');
const getCalendar=handlers.get('GET /api/calendar/events');
const req = (id, date, response, rev = 0) => ({id,params:{eventId:'calendar1'},body:{occurrenceStartsAt:date,expectedRevision:revision,responses:[{...response,expectedResponseRevision:rev}]}});
const call=async(handler, request)=>{const reply={status:200,code(n){this.status=n;return this},send(value){return value}};return {status:reply.status,...await (async()=>{const body=await handler(request,reply);return {body,status:reply.status}})()}};
let n=0;
async function test(name, fn) {await fn();n++;console.log('PASS '+name)}
await test('new normalized response model and FK cascade have uniquely scoped occurrence identity',()=>{assert.match(schema,/model CalendarMeetingOccurrenceResponse/);assert.match(migration,/CREATE UNIQUE INDEX.*CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceStartsAt_userId_key/);assert.match(migration,/ON DELETE CASCADE/)});
await test('participant sets private per-occurrence RSVP with one persisted row',async()=>{const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'declined'}));assert.equal(result.status,200);assert.equal(responses.length,1);assert.equal(responses[0].rsvpStatus,'declined');assert.equal(revision,1);assert.equal(event.meeting.rsvpState,'{"owner":"accepted","member":"pending"}')});
await test('reject stale concurrent occurrence version',async()=>{const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'accepted'}));assert.equal(result.status,409);assert.equal(result.body.code,'OCCURRENCE_RESPONSE_CONFLICT');assert.equal(responses[0].rsvpStatus,'declined')});
await test('allow CAS update without touching series',async()=>{const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'tentative'},1));assert.equal(result.status,200);assert.equal(responses[0].revision,2);assert.equal(responses[0].rsvpStatus,'tentative');assert.equal(revision,1)});
await test('reject overwriting another participant RSVP',async()=>{const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'owner',rsvp:'declined'}));assert.equal(result.status,403);assert.equal(responses.length,1)});
await test('reject attendance by non-organizer',async()=>{const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',attendance:'present'},2));assert.equal(result.status,403);assert.equal(responses[0].attendanceStatus,undefined)});
await test('organizer records per-occurrence attendance independently',async()=>{const result=await call(update,req('owner','2026-03-08T13:00:00Z',{userId:'member',attendance:'present'},2));assert.equal(result.status,200);assert.equal(responses[0].rsvpStatus,'tentative');assert.equal(responses[0].attendanceStatus,'present');assert.equal(responses[0].revision,3)});
await test('deny invalid local instant and unrelated attendee',async()=>{let result=await call(update,req('member','2026-03-08T14:00:00Z',{userId:'member',rsvp:'accepted'}));assert.equal(result.status,400);result=await call(update,req('outsider','2026-03-08T13:00:00Z',{userId:'outsider',rsvp:'accepted'}));assert.equal(result.status,403)});
await test('cancelled occurrence cannot receive RSVP/attendance',async()=>{exceptions.push({occurrenceStartsAt:ready,status:'cancelled'});const result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'accepted'},3));assert.equal(result.status,409);assert.equal(result.body.code,'CALENDAR_OCCURRENCE_CANCELLED');exceptions=[]});
await test('reject stale series revision and non-recurring meetings',async()=>{const old=revision;revision=3;let result=await call(update,{...req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'accepted'},3),body:{...req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'accepted'},3).body,expectedRevision:old}});assert.equal(result.status,409);revision=old;const prior=event.recurrenceRule;event.recurrenceRule=null;result=await call(update,req('member','2026-03-08T13:00:00Z',{userId:'member',rsvp:'accepted'},3));assert.equal(result.status,400);event.recurrenceRule=prior});
await test('recurrence projection merges only selected occurrence RSVP and attendance',async()=>{const result=await call(getCalendar,{id:'member',query:{start:'2026-03-07T00:00:00Z',end:'2026-03-10T00:00:00Z'}});assert.equal(result.status,200);const rows=result.body;assert.equal(rows.length,3);assert.equal(rows[1].meeting.rsvp.member,'tentative');assert.equal(rows[1].meeting.attendance.member,'present');assert.equal(rows[0].meeting.rsvp.member,'pending');assert.equal(rows[2].meeting.rsvp.member,'pending')});
await test('recorded changes are audited by actor and occurrence',async()=>{assert.equal(history.length,3);assert.ok(history.every(row=>row.message.includes('2026-03-08T13:00:00.000Z')))});
// Ensure reminders inherit the per-occurrence override, but not other days.
const reminder=load('apps/server/src/domains/planning/calendar-reminder-lifecycle.ts',{
 '@cluster/shared':{CLUSTER_DOMAIN_EVENTS:{activityRecorded:'activityRecorded'}},'../../core/domain-events.js':{createClusterDomainEvent:(_type,detail)=>detail},'./calendar-reminder-occurrences.js':calendar,
});
await test('due attendee reminder respects selected occurrence decline without changing other dates',async()=>{
 const recipients=[];let seq=0;let mockedResponses=[{userId:'member',occurrenceStartsAt:ready,rsvpStatus:'declined'}];
 const tx={calendarMeetingOccurrenceResponse:{findMany:async()=>mockedResponses},calendarEvent:{findUnique:async()=>snapshot()},user:{findMany:async()=>[{id:'owner',accountState:'ACTIVE'},{id:'member',accountState:'ACTIVE'}]},calendarEventReminderDispatch:{findMany:async()=>[],create:async({data})=>recipients.push(data.recipientUserId)},activityEvent:{create:async()=>({id:String(++seq),createdAt:new Date()})}};
 const lifecycle=reminder.createCalendarReminderLifecycle({prisma:{$transaction:async(fn)=>fn(tx)},events:{appendInTransaction:async()=>{},wake:()=>{}},canViewRecipient:async()=>true});
 let outcome=await lifecycle.deliver('calendar1',new Date('2026-03-08T12:30:00Z'));assert.equal(outcome.delivered,1);assert.deepEqual(recipients,['owner']);
 const today=ready;mockedResponses=[{userId:'member',occurrenceStartsAt:today,rsvpStatus:'accepted'}];recipients.length=0;
 outcome=await lifecycle.deliver('calendar1',new Date('2026-03-08T12:30:00Z'));assert.equal(outcome.delivered,2);assert.deepEqual(recipients,['owner','member']);
});
assert.match(source('packages/renderer/src/features/calendar/CalendarPage.tsx'), /expectedResponseRevision: responseFor\(currentUserId\)/);
assert.match(source('apps/server/src/app/server-services-request-domain.ts'), /meetingOccurrenceResponses: Array\.isArray/);
console.log(`TD6 G21 meeting occurrence checks: ${n}/${n} passed`);

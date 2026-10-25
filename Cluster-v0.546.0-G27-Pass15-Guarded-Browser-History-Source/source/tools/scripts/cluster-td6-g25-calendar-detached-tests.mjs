/** G25: real registered route handlers under controlled Prisma fixtures. No live DB. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {handlers,events,exceptions,blocks,reservations,activity,at,occ,setCalendarTestConflicts,setCalendarBookingFailure,setExternalCalendarTestEvents} from './cluster-td6-g20-calendar-series-tests.mjs';
const root=resolve(import.meta.dirname,'../..');
const read=f=>readFileSync(resolve(root,f),'utf8');
const series=events.get('calendar1');
const original='2026-03-08T13:00:00.000Z';
const movedStart='2026-03-08T16:00:00.000Z';
const movedEnd='2026-03-08T17:00:00.000Z';
series.reminderMinutes=30;
series.meeting={id:'meeting-1',organizerId:'owner',rsvpState:'{}',attendanceState:'{}'};
blocks.push({id:'series-base',calendarEventId:'calendar1',occurrenceStartsAt:null,placementAuthority:'calendar',startsAt:series.startsAt,endsAt:series.endsAt,
  resourceReservations:[{resourceId:'room',quantity:1}],userId:'owner',participantIds:'[]'});
series.scheduleBlocks=blocks;
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS G25 calendar '+name)}
const patch=handlers.get('PATCH /api/calendar/events/:eventId/occurrence');
const list=handlers.get('GET /api/calendar/events');
async function call(action,extra={},identity='delegate'){
 const reply={status:200,code(value){this.status=value;return this},send(body){return body}};
 const body=await patch({id:identity,params:{eventId:'calendar1'},body:{action,occurrenceStartsAt:original,expectedRevision:series.revision,...extra}},reply);
 return {status:reply.status,body};
}
await check('resource authority migration and projection identity are wired',()=>{
 const sql=read('apps/server/prisma/migrations/20261022110000_td6_g25_calendar_detached_occurrences/migration.sql');
 assert.match(sql,/ScheduleBlock_calendar_occurrence_key/);assert.match(sql,/calendar_occurrence_move_shape/);
 const routes=read('apps/server/src/domains/planning/calendar-routes.ts');
 assert.match(routes,/isolationLevel: "Serializable"/);assert.match(routes,/excludeCalendarOccurrence/);assert.match(read('apps/server/src/domains/time/scheduler-planning.ts'),/findCalendarVirtualOccupancy/);assert.match(routes,/replaceScheduleReservations\(tx, booked.id/);
 assert.match(read('apps/server/src/app/server-job-runtime.ts'),/movedStartsAt: true/);
});
await check('move one meeting instance and persist a distinct Scheduler block',async()=>{
 const initial=series.revision;
 const result=await call('reschedule',{startsAt:movedStart,endsAt:movedEnd,reason:'Team changed availability'});
 assert.equal(result.status,200);assert.equal(series.revision,initial+1);
 assert.equal(exceptions.length,1);assert.equal(exceptions[0].status,'rescheduled');
 assert.equal(exceptions[0].movedStartsAt.toISOString(),movedStart);
 assert.equal(blocks.filter(b=>b.occurrenceStartsAt?.toISOString?.()===original).length,1);
 assert.equal(reservations.length,1);assert.equal(reservations[0].resourceId,'room');
 assert.ok(activity.some(row=>row.title==='Calendar occurrence moved'));
});
await check('calendar projection moves display time but retains original response identity',async()=>{
 const reply={status:200,code(value){this.status=value;return this},send(body){return body}};
 const rows=await list({id:'delegate',query:{start:'2026-03-08T00:00:00.000Z',end:'2026-03-10T00:00:00.000Z'}},reply);
 assert.equal(reply.status,200);
 assert.equal(rows.length,2);
 const moved=rows.find(row=>row.occurrenceStartsAt===original);assert.ok(moved);
 assert.equal(moved.startsAt,movedStart);assert.equal(moved.endsAt,movedEnd);
 assert.equal(moved.occurrenceKey,`calendar1:${original}`);
 assert.equal(rows.some(row=>row.startsAt===original),false);
});
await check('reminder dispatch resolves moved time and retains original dedupe key',()=>{
 assert.equal(occ.dueCalendarReminderOccurrence({...series,occurrenceExceptions:exceptions},at('2026-03-08T15:30:00.000Z'))?.toISOString(),original);
 assert.equal(occ.dueCalendarReminderOccurrence({...series,occurrenceExceptions:exceptions},at('2026-03-08T12:30:00.000Z')),null);
 assert.equal(occ.movedCalendarOccurrence({...series,occurrenceExceptions:exceptions},at(original))?.startsAt.toISOString(),movedStart);
});
await check('same-series stale revision and unauthorized move fail without mutation',async()=>{
 assert.equal((await call('reschedule',{startsAt:movedStart,endsAt:movedEnd,expectedRevision:1})).status,409);
 assert.equal((await call('reschedule',{startsAt:movedStart,endsAt:movedEnd},'outsider')).status,403);
 assert.equal(exceptions.length,1);
});
await check('Scheduler collision blocks a move before state changes',async()=>{
 const current=series.revision,oldStart=exceptions[0].movedStartsAt;
 setCalendarTestConflicts([{kind:'resource',resourceId:'room',severity:'high',blockId:'reserved',title:'Booked'}]);
 const result=await call('reschedule',{startsAt:'2026-03-08T18:00:00Z',endsAt:'2026-03-08T19:00:00Z'});
 assert.equal(result.status,409);assert.equal(result.body.code,'MEETING_SCHEDULER_CONFLICT');
 assert.equal(series.revision,current);assert.equal(exceptions[0].movedStartsAt.getTime(),oldStart.getTime());
 setCalendarTestConflicts([]);
});
await check('virtual recurring reservation collision blocks moving into a future meeting',async()=>{
 const before=series.revision;
 const other={id:'private-busy-series',projectId:null,ownerId:'someone-else',attendeeIds:'[]',title:'Sensitive meeting title',
   startsAt:at('2026-03-07T16:00:00Z'),endsAt:at('2026-03-07T17:00:00Z'),timezone:'UTC',recurrenceRule:'FREQ=DAILY',
   status:'scheduled',meeting:{id:'private-meeting'},occurrenceExceptions:[],scheduleBlocks:[{placementAuthority:'calendar',resourceReservations:[{resourceId:'room',quantity:1}]}]};
 setExternalCalendarTestEvents([other]);
 const result=await call('reschedule',{startsAt:movedStart,endsAt:movedEnd});
 assert.equal(result.status,409);assert.equal(result.body.code,'MEETING_SCHEDULER_CONFLICT');
 assert.equal(series.revision,before);assert.ok(!JSON.stringify(result.body).includes(other.title));
 setExternalCalendarTestEvents([]);
});
await check('transaction rollback on booking failure leaves no half-move',async()=>{
 const current=series.revision;const oldStart=exceptions[0].movedStartsAt;
 // Force a fresh booking path after cancelled state and verify rollback.
 assert.equal((await call('cancel')).status,200);
 const cancelledRevision=series.revision;
 setCalendarBookingFailure(true);
 await assert.rejects(()=>call('reschedule',{startsAt:movedStart,endsAt:movedEnd}),/BOOKING_FAILURE/);
 setCalendarBookingFailure(false);
 assert.equal(series.revision,cancelledRevision);
 assert.equal(exceptions[0].status,'cancelled');
 assert.equal(blocks.length,1);
 assert.ok(current<cancelledRevision&&oldStart);
});
await check('restore removes an exception without rewriting unrelated series instances',async()=>{
 const result=await call('restore');assert.equal(result.status,200);
 assert.equal(exceptions.length,0);assert.equal(blocks.length,1);
 assert.equal(occ.dueCalendarReminderOccurrence({...series,occurrenceExceptions:exceptions},at('2026-03-08T12:30:00Z'))?.toISOString(),original);
});
await check('anchor and bad time ranges explicitly fail closed',async()=>{
 const reject=await call('reschedule',{occurrenceStartsAt:series.startsAt.toISOString(),startsAt:movedStart,endsAt:movedEnd});
 assert.equal(reject.status,409);assert.equal(reject.body.code,'CALENDAR_ANCHOR_MOVE_UNSUPPORTED');
 assert.equal((await call('reschedule',{startsAt:movedEnd,endsAt:movedStart})).status,400);
});
console.log(`TD6 G25 detached occurrence/scheduler cases: ${count}/${count} passed`);

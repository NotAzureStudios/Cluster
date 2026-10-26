import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..'), require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch {return require(join(spawnSync('npm',['root','-g'],{encoding:'utf8'}).stdout.trim(),'typescript'))}})();
const text=(file)=>readFileSync(join(root,file),'utf8');
function load(file,imports={}) {
  const compiled=ts.transpileModule(text(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(compiled,{module,exports:module.exports,require:(name)=>imports[name]??require(name),Date,Promise,JSON,Math,Map,Set,Error,String,Number,Array,Object,Boolean,Intl},{filename:file});
  return module.exports;
}
const access=load('apps/server/src/domains/planning/calendar-access.ts').canAccessCalendarEventAsActor;
const recurrence=load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const dueCalendarReminderOccurrence=recurrence.dueCalendarReminderOccurrence;
const lifecycle=load('apps/server/src/domains/planning/calendar-reminder-lifecycle.ts',{
  '@cluster/shared':{CLUSTER_DOMAIN_EVENTS:{activityRecorded:{type:'activity.recorded',schemaVersion:1}}},
  '../../core/domain-events.js':{createClusterDomainEvent:(_type,props)=>props},
  './calendar-reminder-occurrences.js':recurrence,
}).createCalendarReminderLifecycle;
let checks=0;async function check(name,fn){await fn();checks++;console.log(`PASS ${name}`)}
const now=new Date('2026-10-18T20:00:00Z');
const event=(id,changes={})=>({id,revision:1,status:'scheduled',reminderAudience:'participants',ownerId:'owner',attendeeIds:JSON.stringify(['allowed','denied','declined']),visibility:'project',projectId:'p1',project:{id:'p1',archived:false,memberships:[]},reminderMinutes:30,recurrenceRule:null,startsAt:new Date('2026-10-18T20:20:00Z'),title:'Private roadmap session',location:'Studio',meeting:{rsvpState:'{"declined":"declined"}'},...changes});
const active=(id)=>({id,archived:false,accountState:'ACTIVE',accessExpiresAt:null});
const users=new Map(['owner','allowed','denied','declined'].map(id=>[id,active(id)]));
let deniedIds=new Set(['denied']), failOutbox=false;
const authorization={hasToolPermission:(user)=>user.id!=='no-tool',authorize:async(actor,_action,_resource)=>({allowed:!deniedIds.has(actor.user.id)})};
const canView=(user,item)=>access(authorization,{user,role:'member'},item,'view');
function fixture(initial,options={}) {
  const rows=new Map(initial.map(x=>[x.id,x]));
  let receipts=[],activities=[],wake=0,events=[];
  let lock=Promise.resolve();
  const publisher={appendInTransaction:async(_tx,e)=>{if(failOutbox)throw Error('outbox down');events.push(e)},wake:()=>wake++};
  const db={calendarEvent:{findMany:async({where,take})=>[...rows.values()].filter(row=>row.ownerId&&row.status==='scheduled'&&row.reminderMinutes!==null&&row.startsAt<=where.startsAt.lte&&(row.recurrenceRule||row.startsAt>=where.OR[1].startsAt.gte)).slice(0,take)},
    $transaction:async(fn)=>{let unlock;const future=new Promise(r=>unlock=r),prior=lock;lock=future;await prior;
      const oldR=receipts.slice(),oldA=activities.slice(),oldE=events.slice();
      const tx={calendarMeetingOccurrenceResponse:{findMany:async()=>[...rows.values()].flatMap(row=>row.meetingOccurrenceResponses||[])},calendarEvent:{findUnique:async({where})=>rows.get(where.id)||null},
        user:{findMany:async({where})=>where.id.in.filter(id=>users.has(id)).map(id=>users.get(id))},
        calendarEventReminderDispatch:{findMany:async({where})=>receipts.filter(row=>row.calendarEventId===where.calendarEventId&&row.eventRevision===where.eventRevision&&new Date(row.occurrenceStartsAt).getTime()===new Date(where.occurrenceStartsAt).getTime()),create:async({data})=>{if(receipts.some(r=>r.calendarEventId===data.calendarEventId&&r.eventRevision===data.eventRevision&&new Date(r.occurrenceStartsAt).getTime()===new Date(data.occurrenceStartsAt).getTime()&&r.recipientUserId===data.recipientUserId))throw Object.assign(Error('unique'),{code:'P2002'});receipts.push(data);return data}},
        activityEvent:{create:async({data})=>{const item={...data,id:'activity'+(activities.length+1),createdAt:now};activities.push(item);return item}},
      };
      try {return await fn(tx);}catch(err){receipts=oldR;activities=oldA;events=oldE;throw err;}finally{unlock();}
    }};
  const api=lifecycle({prisma:db,events:publisher,canViewRecipient:options.canView===undefined?canView:options.canView});
  return {api,rows,receipts:()=>receipts,activities:()=>activities,events:()=>events,wakes:()=>wake};
}
await check('project target denies and RSVP decline never appear in audience',async()=>{
 const f=fixture([event('e1')]);const result=await f.api.deliver('e1',now);
 assert.equal(result.delivered,2);assert.deepEqual(f.receipts().map(x=>x.recipientUserId).sort(),['allowed','owner']);
 assert.equal(f.activities().length,2);assert.ok(f.activities().every(x=>JSON.parse(x.metadata).userIds.length===1));
 assert.equal(f.wakes(),1);
});
await check('recipient-specific notification dispatches only once per revision',async()=>{
 const f=fixture([event('e2')]); const results=await Promise.all([f.api.deliver('e2',now),f.api.deliver('e2',now)]);
 assert.equal(results.reduce((sum,x)=>sum+x.delivered,0),2);assert.equal(f.receipts().length,2);
 assert.equal((await f.api.deliver('e2',now)).delivered,0);
 f.rows.set('e2',event('e2',{revision:2}));assert.equal((await f.api.deliver('e2',now)).delivered,2);assert.equal(f.receipts().length,4);
});
await check('owner-only defaults retain historical behavior',async()=>{
 const f=fixture([event('e3',{reminderAudience:'owner'})]);assert.equal((await f.api.runDue({now})).delivered,1);
 assert.deepEqual(f.receipts().map(x=>x.recipientUserId),['owner']);
});
await check('private event never leaks to invited attendee',async()=>{
 const f=fixture([event('e4',{visibility:'private'})]);await f.api.deliver('e4',now);
 assert.deepEqual(f.receipts().map(x=>x.recipientUserId),['owner']);
});
await check('revoked, disabled, archived and expired recipients are skipped',async()=>{
 const orig=users.get('allowed');for(const change of [{archived:true},{accountState:'SUSPENDED'},{accessExpiresAt:new Date('2026-01-01')}]){
  users.set('allowed',{...orig,...change});const f=fixture([event('revoked')]);assert.equal((await f.api.deliver('revoked',now)).delivered,1);
 }users.set('allowed',orig);
});
await check('permission lookup failure rolls back event and receipt evidence',async()=>{
 const f=fixture([event('fail')],{canView:async()=>{throw Error('permission DB unavailable')}});
 await assert.rejects(f.api.deliver('fail',now),/permission DB unavailable/);assert.equal(f.receipts().length,0);assert.equal(f.activities().length,0);
});
await check('outbox failure fails closed and retries on next worker tick',async()=>{
 const f=fixture([event('outbox')]);failOutbox=true;await assert.rejects(f.api.deliver('outbox',now),/outbox down/);failOutbox=false;
 assert.equal(f.receipts().length,0);assert.equal(f.activities().length,0);
 assert.equal((await f.api.deliver('outbox',now)).delivered,2);
});
await check('missing authorizer cannot send participant notifications',async()=>{
 const f=fixture([event('noauth')],{canView:null});await f.api.deliver('noauth',now);
 assert.equal(f.receipts().length,0);
});
await check('a corrupted attendee list fails closed before publication',async()=>{
 const f=fixture([event('corrupt',{attendeeIds:'not json'})]);await assert.rejects(f.api.deliver('corrupt',now));
 assert.equal(f.receipts().length,0);
});
await check('cancelled and unsupported recurrent events never enter reminder delivery',async()=>{
 const f=fixture([event('cancel',{status:'cancelled'}),event('repeat',{recurrenceRule:'FREQ=YEARLY'})]);
 assert.equal((await f.api.runDue({now})).delivered,0);
});
await check('one recurring event sends one receipt per local occurrence',async()=>{
 const f=fixture([event('daily',{startsAt:new Date('2026-10-16T20:20:00Z'),recurrenceRule:'FREQ=DAILY'})]);
 assert.equal((await f.api.deliver('daily',now)).delivered,2);
 assert.equal((await f.api.deliver('daily',new Date('2026-10-19T20:00:00Z'))).delivered,2);
 assert.equal(f.receipts().length,4);
 assert.equal(new Date(f.receipts()[0].occurrenceStartsAt).toISOString(),'2026-10-18T20:20:00.000Z');
 assert.equal(new Date(f.receipts()[2].occurrenceStartsAt).toISOString(),'2026-10-19T20:20:00.000Z');
});
await check('DST-adjusted daily reminders preserve local wall time',()=>{
 const rec=event('dst',{startsAt:new Date('2026-03-07T14:00:00Z'),timezone:'America/New_York',recurrenceRule:'FREQ=DAILY',reminderMinutes:60});
 assert.equal(dueCalendarReminderOccurrence(rec,new Date('2026-03-08T12:00:00Z'))?.toISOString(),'2026-03-08T13:00:00.000Z');
 const fall=event('fall',{startsAt:new Date('2026-10-31T13:00:00Z'),timezone:'America/New_York',recurrenceRule:'FREQ=DAILY',reminderMinutes:60});
 assert.equal(dueCalendarReminderOccurrence(fall,new Date('2026-11-01T13:00:00Z'))?.toISOString(),'2026-11-01T14:00:00.000Z');
 const gap=event('gap',{startsAt:new Date('2026-03-07T07:30:00Z'),timezone:'America/New_York',recurrenceRule:'FREQ=DAILY',reminderMinutes:60});
 assert.equal(dueCalendarReminderOccurrence(gap,new Date('2026-03-08T06:30:00Z')),null);
});
await check('weekday and monthly repeats skip unintended dates',()=>{
 const weekdays=event('weekdays',{startsAt:new Date('2026-10-16T20:20:00Z'),recurrenceRule:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'});
 assert.equal(dueCalendarReminderOccurrence(weekdays,new Date('2026-10-18T20:00:00Z')),null);
 assert.equal(dueCalendarReminderOccurrence(weekdays,new Date('2026-10-19T20:00:00Z'))?.toISOString(),'2026-10-19T20:20:00.000Z');
 const weekly=event('weekly',{startsAt:new Date('2026-10-12T20:20:00Z'),recurrenceRule:'FREQ=WEEKLY'});
 assert.equal(dueCalendarReminderOccurrence(weekly,new Date('2026-10-18T20:00:00Z')),null);
 assert.equal(dueCalendarReminderOccurrence(weekly,new Date('2026-10-19T20:00:00Z'))?.toISOString(),'2026-10-19T20:20:00.000Z');
 const monthly=event('monthly',{startsAt:new Date('2026-01-31T20:20:00Z'),recurrenceRule:'FREQ=MONTHLY'});
 assert.equal(dueCalendarReminderOccurrence(monthly,new Date('2026-02-28T20:00:00Z')),null);
 assert.equal(dueCalendarReminderOccurrence(monthly,new Date('2026-03-31T20:00:00Z'))?.toISOString(),'2026-03-31T20:20:00.000Z');
});
await check('bounded worker scans refuse truncated results',async()=>{
 const f=fixture([event('e1'),event('e2')]);await assert.rejects(f.api.runDue({now,limit:1}),/CALENDAR_REMINDER_SCAN_INCOMPLETE/);
});
await check('background access checks Project policy and Calendar permission',async()=>{
 assert.equal(await access({...authorization,hasToolPermission:()=>false},{user:active('allowed'),role:'member'},event('dummy')),false);
 const allowed=active('allowed');assert.equal(await canView(allowed,event('target')),true);
 assert.equal(await canView(allowed,event('target',{visibility:'private'})),false);
});
await check('new settings wired through schema, editor, routes, and lifecycle',()=>{
 for(const file of ['apps/server/prisma/schema.prisma','apps/server/src/domains/planning/calendar-routes.ts','packages/renderer/src/features/calendar/CalendarPage.tsx','packages/shared/src/scheduling-contracts.ts'])assert.match(text(file),/reminderAudience/);
 assert.match(text('apps/server/src/app/cluster-server.ts'),/canAccessCalendarEventAsActor/);
 assert.match(text('apps/server/src/app/server-automation-job-runtime.ts'),/canViewCalendarReminderRecipient/);
 assert.match(text('apps/server/src/domains/studio-systems/studio-systems-routes.ts'),/dispatchedLast24Hours/);
 assert.match(text('packages/renderer/src/features/operations/StudioKnowledgeOperationsPanel.tsx'),/calendarReminders/);
 assert.match(text('apps/server/prisma/migrations/20261021000000_td6_g08_calendar_participant_reminders/migration.sql'),/occurrenceStartsAt/);
});
console.log(`G08 participant-safe Calendar reminders: ${checks}/${checks} passed`);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const base=resolve(import.meta.dirname,'../..'), require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(join(spawnSync('npm',['root','-g'],{encoding:'utf8'}).stdout.trim(),'typescript'))}})();
const text=file=>readFileSync(join(base,file),'utf8');
function load(file,imports){const compiled=ts.transpileModule(text(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};vm.runInNewContext(compiled,{module:m,exports:m.exports,require:name=>imports[name]??require(name),Date,Promise,JSON,Math,Set,Error,String,Number,Array},{filename:file});return m.exports}
const recurrence=load('apps/server/src/domains/planning/calendar-reminder-occurrences.ts');
const dueCalendarReminderOccurrence=recurrence.dueCalendarReminderOccurrence;
const lifecycle=load('apps/server/src/domains/planning/calendar-reminder-lifecycle.ts',{
 '@cluster/shared':{CLUSTER_DOMAIN_EVENTS:{activityRecorded:{type:'activity.recorded',schemaVersion:1}}},
 '../../core/domain-events.js':{createClusterDomainEvent:(_type,props)=>props},
 './calendar-reminder-occurrences.js':recurrence,
}).createCalendarReminderLifecycle;
const now=new Date('2026-10-18T20:00:00Z');
const event=(id,changes={})=>({id,revision:1,status:'scheduled',ownerId:'u1',reminderMinutes:30,recurrenceRule:null,startsAt:new Date('2026-10-18T20:20:00Z'),title:'Studio meeting',location:'Conference',...changes});
let sinkFail=false, events=[], wakes=0;
const publisher={appendInTransaction:async(_tx,row)=>{if(sinkFail)throw Error('outbox unavailable');events.push(row)},wake:()=>wakes++};
function dbFactory(initial){let rows=new Map(initial.map(x=>[x.id,x]));let receipts=[], activities=[];let chain=Promise.resolve();let users=new Map([['u1',{id:'u1',archived:false,accountState:'ACTIVE',accessExpiresAt:null}]]);
 const db={calendarEvent:{findMany:async({where,take})=>[...rows.values()].filter(e=>e.startsAt<=where.startsAt.lte&&(e.recurrenceRule||e.startsAt>=where.OR[1].startsAt.gte)&&e.ownerId&&e.reminderMinutes!=null&&e.status==='scheduled').slice(0,take)},
  $transaction:async(fn)=>{let unlock;const next=new Promise(resolve=>unlock=resolve),old=chain;chain=next;await old;
   const original=receipts.slice(), originalActivity=activities.slice();const tx={
    calendarMeetingOccurrenceResponse:{findMany:async()=>[]},
    calendarEvent:{findUnique:async({where})=>rows.get(where.id)||null},
    user:{findMany:async({where})=>where.id.in.filter(id=>users.has(id)).map(id=>users.get(id))},
    activityEvent:{create:async({data})=>{const a={id:'a'+(activities.length+1),createdAt:now,...data};activities.push(a);return a}},
    calendarEventReminderDispatch:{findMany:async({where})=>receipts.filter(r=>r.calendarEventId===where.calendarEventId&&r.eventRevision===where.eventRevision&&new Date(r.occurrenceStartsAt).getTime()===new Date(where.occurrenceStartsAt).getTime()),create:async({data})=>{if(receipts.some(r=>r.calendarEventId===data.calendarEventId&&r.eventRevision===data.eventRevision&&r.recipientUserId===data.recipientUserId&&new Date(r.occurrenceStartsAt).getTime()===new Date(data.occurrenceStartsAt).getTime()))throw Object.assign(Error('duplicate'),{code:'P2002'});receipts.push(data);return data}},
   };try{return await fn(tx)}catch(err){receipts=original;activities=originalActivity;throw err}finally{unlock()}
  }};
 return {db,rows,users,receipts:()=>receipts,activities:()=>activities};
}
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name)}
await check('owner receives exactly one durable event on scheduled reminder',async()=>{
 const x=dbFactory([event('cal1')]);events=[];wakes=0;const api=lifecycle({prisma:x.db,events:publisher});const a=await api.runDue({now});
 assert.equal(a.delivered,1);assert.equal(x.receipts().length,1);assert.equal(x.activities().length,1);assert.equal(events.length,1);assert.equal(wakes,1);
 assert.deepEqual([...JSON.parse(x.activities()[0].metadata).userIds],['u1']);
 assert.equal((await api.runDue({now})).delivered,0);
});
await check('concurrent reminder workers cannot double-deliver',async()=>{
 const x=dbFactory([event('race')]);const api=lifecycle({prisma:x.db,events:publisher});const results=await Promise.all([api.deliver('race',now),api.deliver('race',now)]);
 assert.equal(results.filter(r=>r.outcome==='delivered').length,1);assert.equal(x.receipts().length,1);
});
await check('updating a scheduled event revision allows a fresh reminder',async()=>{
 const x=dbFactory([event('moved')]);const api=lifecycle({prisma:x.db,events:publisher});assert.equal((await api.deliver('moved',now)).outcome,'delivered');
 x.rows.set('moved',event('moved',{revision:2}));assert.equal((await api.deliver('moved',now)).outcome,'delivered');assert.equal(x.receipts().length,2);
});
await check('cancellation, past events, unsupported recurrence and no-reminder events do not send',async()=>{
 const x=dbFactory([event('cancel',{status:'cancelled'}),event('old',{startsAt:new Date('2026-10-17T00:00:00Z')}),event('repeat',{recurrenceRule:'FREQ=YEARLY'}),event('silent',{reminderMinutes:null})]);const api=lifecycle({prisma:x.db,events:publisher});
 assert.equal((await api.runDue({now})).delivered,0);assert.equal(x.activities().length,0);
});
await check('archived, suspended and expired owners do not receive event contents',async()=>{
 for(const change of [{archived:true},{accountState:'SUSPENDED'},{accessExpiresAt:new Date('2025-01-01')}]){
  const x=dbFactory([event('private')]);x.users.set('u1',{...x.users.get('u1'),...change});const api=lifecycle({prisma:x.db,events:publisher});
  assert.equal((await api.deliver('private',now)).outcome,'no_eligible_recipients');assert.equal(x.activities().length,0);
 }
});
await check('outbox failure rolls back the unique dispatch and activity',async()=>{
 const x=dbFactory([event('rollback')]);const api=lifecycle({prisma:x.db,events:publisher});sinkFail=true;
 await assert.rejects(api.deliver('rollback',now),/outbox unavailable/);sinkFail=false;
 assert.equal(x.receipts().length,0);assert.equal(x.activities().length,0);assert.equal((await api.deliver('rollback',now)).outcome,'delivered');
});
await check('large ambiguous calendar scan fails explicitly',async()=>{
 const x=dbFactory([event('1'),event('2')]);const api=lifecycle({prisma:x.db,events:publisher});
 await assert.rejects(api.runDue({now,limit:1}),/CALENDAR_REMINDER_SCAN_INCOMPLETE/);
});
await check('calendar tool lifecycle disables reminder ownership along with automation',()=>{
 const ownership=text('apps/server/src/domains/jobs/job-tool-ownership.ts');const runtime=text('apps/server/src/app/server-job-runtime.ts');
 assert.match(ownership,/calendar: \["automation.calendar-scan", "studio.calendar-owner-reminders"\]/);
 assert.match(runtime,/isOwnerEnabled\("calendar"\)/);assert.match(runtime,/studio-calendar-owner-reminders-enqueue/);
});
await check('Calendar labels reminder time and Operations exposes schedule',()=>{
 assert.match(text('packages/renderer/src/features/calendar/CalendarPage.tsx'),/Reminder time/);
 assert.match(text('apps/server/src/domains/studio-systems/studio-systems-routes.ts'),/scheduledAnnouncements/);
});
console.log(`G06 Calendar owner reminders: ${count}/${count} checks passed`);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const cwd = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = (() => {try {return require('typescript')} catch {const root=spawnSync('npm',['root','-g'],{encoding:'utf8'}).stdout.trim();return require(join(root,'typescript'))}})();
function source(path){return readFileSync(join(cwd,path),'utf8')}
function load(path, imports){const compiled=ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};vm.runInNewContext(compiled,{module:mod,exports:mod.exports,Date,Promise,JSON,Map,Set,Number,String,Array,Error,Math,require:(id)=>{if(id in imports)return imports[id]; throw Error('Unexpected import: '+id)}},{filename:path});return mod.exports}
let count=0;
async function test(name, callback){await callback();count++;console.log('PASS',name)}
const users=[{id:'u1',archived:false,accountState:'ACTIVE',accessExpiresAt:null},{id:'u2',archived:false,accountState:'ACTIVE',accessExpiresAt:null},{id:'u3',archived:false,accountState:'DISABLED',accessExpiresAt:null},{id:'u4',archived:false,accountState:'ACTIVE',accessExpiresAt:new Date('2025-01-01')},{id:'u5',archived:true,accountState:'ACTIVE',accessExpiresAt:null}];
const audience=load('apps/server/src/domains/access/studio-audience.ts',{'@cluster/shared':{studioAudienceSchema:{parse:(value)=>value}}});
const service=load('apps/server/src/domains/studio-systems/studio-announcement-delivery.ts',{
 '@cluster/shared':{CLUSTER_DOMAIN_EVENTS:{activityRecorded:{type:'activity.recorded',schemaVersion:1}},clusterResourceAddressFromEntity:(input)=>({kind:input.entityType,id:input.entityId})},
 '../../core/domain-events.js':{createClusterDomainEvent:(_kind,input)=>input},
 '../access/studio-audience.js':{resolveStudioAudienceUserIds:audience.resolveStudioAudienceUserIds},
});
const now=new Date('2026-10-19T18:00:00Z');
let events=[], failOutbox=false, wakes=0, failAudience=false;
const incoming=(id,status,scheduledAt=null)=>({id,status,scheduledAt,revision:1,title:'Release notes',body:'Studio update',audienceJson:JSON.stringify({mode:'all',targets:[]}),priority:'normal',requiresAcknowledgement:true,discordDeliveryRequested:false,createdById:'owner',deliveryCount:0,publishedAt:null});
function database(initial){let rows=new Map(initial.map(x=>[x.id,x]));let activity=[];let chain=Promise.resolve();let writeCount=0;
 const db={
  studioAnnouncement:{findMany:async({where,take})=>[...rows.values()].filter(r=>r.status===where.status && r.scheduledAt && r.scheduledAt<=where.scheduledAt.lte).slice(0,take).map(({id})=>({id}))},
  $transaction:async(run)=>{let done; const slot=new Promise(resolve=>done=resolve);const previous=chain;chain=slot;await previous;
   const snapshot=new Map([...rows.entries()].map(([k,v])=>[k,structuredClone(v)])); const recorded=[...activity];
   const tx={
    user:{findMany:async({where})=>{const clock=new Date();return users.filter(u=>!u.archived && !where.accountState.notIn.includes(u.accountState) && (!u.accessExpiresAt || u.accessExpiresAt>clock)).map(u=>({id:u.id}))}},
    studioAnnouncement:{findUnique:async({where})=>rows.get(where.id)??null,updateMany:async({where,data})=>{const r=rows.get(where.id);if(!r||r.status!==where.status||r.revision!==where.revision||where.scheduledAt && r.scheduledAt>where.scheduledAt.lte)return {count:0}; rows.set(r.id,{...r,...data,revision:r.revision+1});writeCount++;return {count:1};}},
    activityEvent:{create:async({data})=>{const r={id:'a'+(activity.length+1),createdAt:now,...data};activity.push(r);return r;}},
    employment:{findMany:async()=>{if(failAudience)throw Error('audience DB unavailable');return []}},
    studioTeamMember:{findMany:async()=>[]},projectMembership:{findMany:async()=>[]},
   };
   try{return await run(tx)} catch(error){rows=snapshot;activity=recorded;throw error}finally{done()}
  },
 };
 return {db,read:()=>rows,activity:()=>activity,writeCount:()=>writeCount};
}
const eventSink={appendInTransaction:async(_tx,event)=>{if(failOutbox)throw Error('outbox fail');events.push(event)},wake:()=>{wakes++}};
await test('scheduled publication writes one activity and one durable outbox notification',async()=>{
 const db=database([incoming('a','scheduled',new Date('2026-10-19T17:00:00Z'))]);events=[];wakes=0;
 const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});const r=await api.runDue({now});
 assert.equal(r.published,1);assert.equal(db.read().get('a').status,'published');assert.equal(db.read().get('a').deliveryCount,2);assert.equal(db.activity().length,1);assert.equal(events.length,1);assert.equal(wakes,1);
 const meta=JSON.parse(db.activity()[0].metadata); assert.deepEqual([...meta.userIds],['u1','u2']);assert.equal(meta.notificationGroupKey,'announcement:a');
 assert.equal((await api.runDue({now})).published,0);
});
await test('future publication is not claimed ahead of schedule',async()=>{
 const db=database([incoming('future','scheduled',new Date('2026-10-19T20:00:00Z'))]);const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});
 assert.equal((await api.runDue({now})).published,0);assert.equal(db.activity().length,0);
});
await test('manual publication only accepts drafts',async()=>{
 const db=database([incoming('draft','draft'),incoming('scheduled','scheduled',new Date('2026-10-19T17:00:00Z'))]);const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});
 assert.equal((await api.publish('scheduled',{scheduled:false,now})).outcome,'not_ready');
 assert.equal((await api.publish('draft',{scheduled:false,now,actorUserId:'admin'})).outcome,'published');
 assert.equal(db.activity()[0].userId,'admin');
});
await test('two scheduled publisher workers do not double-publish',async()=>{
 const db=database([incoming('race','scheduled',new Date('2026-10-19T17:00:00Z'))]);const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});
 const result=await Promise.all([api.publish('race',{scheduled:true,now}),api.publish('race',{scheduled:true,now})]);
 assert.equal(result.filter(x=>x.outcome==='published').length,1);assert.equal(db.activity().length,1);
});
await test('outbox failure rolls back publication and retry succeeds',async()=>{
 const db=database([incoming('rollback','scheduled',new Date('2026-10-19T17:00:00Z'))]);const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});
 failOutbox=true;await assert.rejects(api.publish('rollback',{scheduled:true,now}),/outbox fail/);failOutbox=false;
 assert.equal(db.read().get('rollback').status,'scheduled');assert.equal(db.activity().length,0);
 assert.equal((await api.publish('rollback',{scheduled:true,now})).outcome,'published');
});
await test('failed targeted audience query cannot publish partial recipients',async()=>{
 const entry=incoming('targeted','draft');entry.audienceJson=JSON.stringify({mode:'include',targets:[{kind:'department',id:'engineering'}]});
 const db=database([entry]);const api=service.createStudioAnnouncementDelivery({prisma:db.db,events:eventSink});
 failAudience=true;await assert.rejects(api.publish('targeted',{scheduled:false,now}),/audience DB unavailable/);failAudience=false;
 assert.equal(db.read().get('targeted').status,'draft');assert.equal(db.activity().length,0);
});
await test('scheduled cancellation and edits use revision compare-and-swap',()=>{
 const s=source('apps/server/src/domains/studio-systems/studio-workflow-routes.ts');
 assert.match(s,/\/api\/studio-systems\/announcements\/:announcementId\/schedule/);
 assert.match(s,/revision, status: \{ in: \["draft", "scheduled"\] \}/);
 assert.match(s,/ANNOUNCEMENT_SCHEDULE_STALE/);
 assert.match(s,/Only an unpublished draft/);
});
await test('user-facing schedule and published report retain existing configuration',()=>{
 const view=source('packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx');
 assert.match(view,/datetime-local/);assert.match(view,/Cancel schedule/);assert.match(view,/Refresh report/);assert.match(view,/StudioAudiencePicker/);
});
await test('scheduler is connected to durable job lifecycle',()=>{
 const job=source('apps/server/src/app/server-job-runtime.ts'), wiring=source('apps/server/src/app/server-automation-job-runtime.ts');
 assert.match(job,/studio\.announcement-publish-due/);assert.match(job,/studio-announcement-schedule-enqueue/);assert.match(wiring,/createStudioAnnouncementDelivery/);
});

await test('actual announcement routes create scheduled item and reject premature publish',async()=>{
 const handlers=new Map(),records=new Map();let next=0;
 const dates=value=>value ? new Date(value) : null;
 const workflow=load('apps/server/src/domains/studio-systems/studio-workflow-routes.ts',{
  '@cluster/shared':{
   studioAnnouncementCreateSchema:{parse:body=>({...body,scheduledAt:dates(body.scheduledAt)})},
   studioAnnouncementScheduleSchema:{parse:body=>({...body,scheduledAt:dates(body.scheduledAt)})},
   publicApplicationSubmissionSchema:{parse:x=>x},studioApplicationConversionSchema:{parse:x=>x},studioApplicationListQuerySchema:{parse:x=>x},studioApplicationReviewSchema:{parse:x=>x},
   projectVisibleStudioFormAnswers:()=>({}),
  },
  'zod':{z:{object:()=>({parse:input=>input}),string:()=>({min(){return this},max(){return this}})}},
  '../../core/cursor-pagination.js':{buildCursorPage:()=>({}),cursorWhere:()=>null,decodeCursor:()=>null},
  '../access/studio-audience.js':{parseStudioAudience:value=>typeof value==='string'?JSON.parse(value):value,parseStudioJson:()=>({}),resolveStudioAudienceUserIds:async()=>[],studioAudienceMatchesUser:async()=>true,loadStudioAudienceUserContext:async()=>({}),studioAudienceMatchesContext:()=>true},
  './studio-form-runtime.js':{applicationRespondentMetadata:()=>({}),serializeStudioForm:()=>({}),serializeStudioFormVersion:()=>({}),validateStudioFormAnswers:()=>({ok:true})},
  './studio-onboarding-runtime.js':{createStudioOnboardingAssignment:async()=>({})},
  '../workforce/workforce-normalization.js':{syncUserWorkforceAuthorities:async()=>({})},
    '../../core/security-audit-store.js': { appendSecurityAuditEvent: async () => ({}) },
  './studio-application-profile.js': { buildApplicationProfile: () => ({}), ApplicationMappingError: class extends Error {} },
'./studio-application-revisions.js':{applicationReviewWhere:()=>({}),applicationConversionWhere:()=>({})},
  './studio-announcement-create-intents.js':{announcementCreateDigest:()=> 'test-digest',isAnnouncementCreateUniqueConflict:(e)=>e?.code==='P2002'},
  './studio-announcement-delivery.js':{createStudioAnnouncementDelivery:()=>({publish:async()=>({outcome:'not_ready'})})},
 });
 const app={get:(path,cb)=>handlers.set('GET '+path,cb),post:(path,cb)=>handlers.set('POST '+path,cb),put:(path,cb)=>handlers.set('PUT '+path,cb),patch:(path,cb)=>handlers.set('PATCH '+path,cb),delete:(path,cb)=>handlers.set('DELETE '+path,cb)};
 const prisma={studioAnnouncement:{
  create:async({data})=>{const row={id:'r'+(++next),revision:1,publishedAt:null,deliveryCount:0,...data};records.set(row.id,row);return row},
  findUnique:async({where})=>records.get(where.id)||null,
  updateMany:async({where,data})=>{const r=records.get(where.id);if(!r||r.revision!==where.revision||!where.status.in.includes(r.status))return {count:0};records.set(r.id,{...r,...data,revision:r.revision+1});return {count:1}}
 }};
 workflow.registerStudioWorkflowRoutes({app,prisma,authorization:{requireTool:async()=>true},getCurrentUser:async()=>({id:'admin'}),events:{}});
 const reply=()=>({code(status){this.status=status;return this},header(){return this},send(input){return input}});
 const create=handlers.get('POST /api/studio-systems/announcements');
 const scheduledAt=new Date(Date.now()+2*60*60*1000).toISOString();
 const row=await create({body:{title:'Future notes',body:'Scheduled content',priority:'normal',requiresAcknowledgement:false,discordDeliveryRequested:false,audience:{mode:'all',targets:[]},scheduledAt}},reply());
 assert.equal(row.status,'scheduled');assert.equal(row.revision,1);
 const publish=handlers.get('POST /api/studio-systems/announcements/:announcementId/publish');
 const blocked=await publish({params:{announcementId:row.id}},reply());assert.equal(blocked.code,'ANNOUNCEMENT_NOT_DRAFT');
 const change=handlers.get('PUT /api/studio-systems/announcements/:announcementId/schedule');
 const cancelled=await change({params:{announcementId:row.id},body:{revision:1,scheduledAt:null}},reply());assert.equal(cancelled.announcement.status,'draft');
 const conflict=await change({params:{announcementId:row.id},body:{revision:1,scheduledAt:null}},reply());assert.equal(conflict.code,'ANNOUNCEMENT_SCHEDULE_STALE');
});

console.log(`G06 announcement schedule: ${count}/${count} checks passed`);

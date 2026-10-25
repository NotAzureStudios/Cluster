#!/usr/bin/env node
// G27 Batch 5: executable completion-aware admin projection with an isolated
// read-snapshot fixture; source contracts for renderer navigation and provenance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, imports={}) {
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(name=>{
    if(Object.hasOwn(imports,name))return imports[name];
    throw Error(`Unexpected import: ${name}`);
  },module,module.exports);
  return module.exports;
}
const schema={parse:x=>x,min(){return this},max(){return this}};
const runtime=load('apps/server/src/domains/studio-systems/studio-onboarding-runtime.ts');
const original=load('apps/server/src/domains/studio-systems/studio-onboarding-routes.ts',{
  '@cluster/shared':Object.fromEntries(['studioAudienceSchema','studioOnboardingAssignmentLifecycleSchema','studioOnboardingPlanCreateSchema','studioOnboardingPlanVersionCreateSchema'].map(x=>[x,schema])),
  'zod':{z:{object:()=>schema,string:()=>schema}},
  '../access/studio-audience.js':{parseStudioJson:()=>({}),resolveStudioAudienceUserIds:async()=>[],studioAudienceMatchesUser:async()=>true},
  './studio-form-runtime.js':{serializeStudioForm:row=>row,serializeStudioFormVersion:row=>row},
  './studio-onboarding-runtime.js':runtime,
  './studio-onboarding-publication.js':{commitStudioOnboardingPublication:async()=>({})},
});
const {summarizeStudioOnboardingAttention}=load('apps/server/src/domains/studio-systems/studio-onboarding-attention.ts',{
  './studio-onboarding-routes.js':original,
  './studio-onboarding-runtime.js':runtime,
});
const now=new Date('2026-10-22T12:00:00Z');
const step=(id,kind,resourceId,required=true)=>({id,kind,resourceId,required});
const plan=(id,steps,status='published',planStatus='active')=>({id,status,plan:{title:id,status:planStatus},steps});
const assignment=(id,userId,version,dueAt)=>({id,userId,planVersionId:version,status:'active',dueAt:dueAt===undefined?null:new Date(dueAt)});
function fixture({versions=[],rows=[],packet=[],policies=[],accept=[],forms=[],broken=false,snapshotInsert=false}={}) {
 const lookup=new Map(versions.map(v=>[v.id,v]));const calls={pages:0,tx:0,versions:0,packet:0};
 const sourceRows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 const tx={
   studioOnboardingAssignment:{findMany:async({cursor,take})=>{calls.pages++; if(broken)throw Error('database offline');const offset=cursor?sourceRows.findIndex(r=>r.id===cursor.id)+1:0;return sourceRows.slice(offset,offset+take)}},
   studioOnboardingPlanVersion:{findUnique:async({where})=>{calls.versions++;return lookup.get(where.id)||null}},
   packetCompletion:{findMany:async({where})=>{calls.packet++;return packet.filter(row=>where.userId.in.includes(row.userId)&&where.packetDefinitionId.in.includes(row.packetDefinitionId))}},
   studioPolicyVersion:{findMany:async({where})=>policies.filter(row=>where.id.in.includes(row.id))},
   studioPolicyAcceptance:{findMany:async({where})=>accept.filter(row=>where.userId.in.includes(row.userId)&&where.policyVersionId.in.includes(row.policyVersionId))},
   studioFormSubmission:{findMany:async({where})=>forms.filter(row=>where.userId.in.includes(row.userId)&&where.formVersionId.in.includes(row.formVersionId))},
 };
 const db={$transaction:async(fn,opts)=>{calls.tx++;assert.equal(opts.isolationLevel,'RepeatableRead');if(snapshotInsert)rows.push(assignment('zz','late','v1'));return await fn(tx);}};
 return {db,calls};
}
let n=0;
async function check(name,fn){await fn();n++;console.log('PASS G27 attention '+name);}
await check('no open assignments is an actual empty summary',async()=>{const f=fixture();const r=await summarizeStudioOnboardingAttention(f.db,now);assert.deepEqual({assigned:r.assigned,active:r.active,completed:r.completed,overdue:r.overdue,dueSoon:r.dueSoon}, {assigned:0,active:0,completed:0,overdue:0,dueSoon:0});assert.equal(f.calls.tx,1)});
await check('required Packet completion clears overdue flag',async()=>{const f=fixture({versions:[plan('v1',[step('s1','packet','pk1')])],rows:[assignment('01','u1','v1','2026-10-20')],packet:[{userId:'u1',packetDefinitionId:'pk1',completedAt:now}]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.completed,1);assert.equal(r.overdue,0);assert.equal(r.active,0)});
await check('incomplete required Packet is counted as overdue',async()=>{const f=fixture({versions:[plan('v1',[step('s1','packet','pk1')])],rows:[assignment('01','u1','v1','2026-10-20')]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.overdue,1);assert.equal(r.overdueItems[0].assignmentId,'01');assert.equal(r.active,1)});
await check('optional steps do not prevent checklist completion',async()=>{const f=fixture({versions:[plan('v1',[step('a','packet','pk1',false)])],rows:[assignment('01','u1','v1','2026-10-20')]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.completed,1)});
await check('unaccepted policy and outstanding form remain required',async()=>{const f=fixture({versions:[plan('v1',[step('p','policy','pv1'),step('f','form','fv1')])],rows:[assignment('01','u1','v1','2026-10-21')],policies:[{id:'pv1',acceptanceMode:'signature',contentHash:'hash'}]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.overdue,1)});
await check('matching policy hash and submitted Form satisfy requirements',async()=>{const f=fixture({versions:[plan('v1',[step('p','policy','pv1'),step('f','form','fv1')])],rows:[assignment('01','u1','v1','2026-10-21')],policies:[{id:'pv1',acceptanceMode:'signature',contentHash:'hash'}],accept:[{userId:'u1',policyVersionId:'pv1',policyContentHash:'hash',acceptedAt:now}],forms:[{userId:'u1',formVersionId:'fv1',submittedAt:now}]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.completed,1)});
await check('stale policy content hash leaves checklist outstanding',async()=>{const f=fixture({versions:[plan('v1',[step('p','policy','pv1')])],rows:[assignment('01','u1','v1','2026-10-21')],policies:[{id:'pv1',acceptanceMode:'signature',contentHash:'new'}],accept:[{userId:'u1',policyVersionId:'pv1',policyContentHash:'old'}]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.overdue,1)});
await check('inactive or unpublished plans are not counted as actionable',async()=>{const f=fixture({versions:[plan('v1',[],'draft'),plan('v2',[],'published','archived')],rows:[assignment('01','u1','v1'),assignment('02','u2','v2')]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.assigned,0)});
await check('due-soon and no-deadline items remain separate',async()=>{const f=fixture({versions:[plan('v1',[step('s','packet','pk1')])],rows:[assignment('01','u1','v1','2026-10-25'),assignment('02','u2','v1')]});const r=await summarizeStudioOnboardingAttention(f.db,now);assert.equal(r.active,2);assert.equal(r.dueSoon,1);assert.equal(r.overdue,0)});
await check('multiple cursor pages count every assignment exactly once',async()=>{const rows=Array.from({length:11},(_,i)=>assignment(String(i).padStart(2,'0'),'u'+i,'v1','2026-10-20'));const f=fixture({versions:[plan('v1',[step('s','packet','pk1')])],rows});const r=await summarizeStudioOnboardingAttention(f.db,now,{pageSize:3});assert.equal(r.overdue,11);assert.equal(r.overdueItems.length,11);assert.ok(f.calls.pages>=4)});
await check('overdue preview selects oldest 12 across all pages',async()=>{
 const rows=Array.from({length:19},(_,i)=>assignment(String(i).padStart(2,'0'),'u'+i,'v1',new Date(now.getTime()-(i+1)*86400000)));
 const f=fixture({versions:[plan('v1',[step('s','packet','pk1')])],rows});
 const r=await summarizeStudioOnboardingAttention(f.db,now,{pageSize:4});
 assert.equal(r.overdue,19);assert.equal(r.overdueItems.length,12);
 assert.equal(r.overdueItems[0].assignmentId,'18');
 assert.equal(r.overdueItems.at(-1).assignmentId,'07');
});
await check('population beyond scan limit refuses partial summary',async()=>{const rows=Array.from({length:8},(_,i)=>assignment(String(i).padStart(2,'0'),'u'+i,'v1'));const f=fixture({versions:[plan('v1',[])],rows});await assert.rejects(summarizeStudioOnboardingAttention(f.db,now,{pageSize:3,maxAssignments:6}),e=>e.code==='ONBOARDING_SUMMARY_LIMIT')});
await check('broken database never returns fake zero work',async()=>{const f=fixture({broken:true});await assert.rejects(summarizeStudioOnboardingAttention(f.db,now),/database offline/)});
await check('missing version fails rather than dropping responsibilities',async()=>{const f=fixture({rows:[assignment('01','u1','missing')]});await assert.rejects(summarizeStudioOnboardingAttention(f.db,now),e=>e.code==='ONBOARDING_VERSION_MISSING')});
await check('admin summary uses canonical completion-aware projection',async()=>{const s=readFileSync('apps/server/src/domains/studio-systems/studio-systems-routes.ts','utf8');assert.match(s,/summarizeStudioOnboardingAttention\(prisma, now\)/);assert.doesNotMatch(s,/activeOnboarding|overdueOnboarding/)});
await check('People access UI uses server explanation, not local effective levels',async()=>{const s=readFileSync('packages/renderer/src/features/people/PersonEffectiveAccessPanel.tsx','utf8');assert.match(s,/api\/access\/explain/);assert.match(s,/userId: personId/);assert.match(s,/sequence\.current/);assert.doesNotMatch(s,/getToolLevel/)});
await check('Operations overdue action opens the exact authorized person',async()=>{const s=readFileSync('packages/renderer/src/features/operations/StudioKnowledgeOperationsPanel.tsx','utf8');assert.match(s,/openClusterWorkNavigation\(\{ screen: "people", inspectScope: "person", inspectId: item.userId \}\)/);assert.match(s,/onboarding\.completed/)});
const {summarizeStudioKnowledgeAttention}=load('apps/server/src/domains/studio-systems/studio-knowledge-attention.ts');
function knowledgeFixture({ counts=[], overdueCounts=[], overdueItems=[], fail=false }={}) {
  const calls=[];
  const tx={studioKnowledgeAssignment:{
    groupBy: async(query)=>{calls.push(query);if(fail)throw Error('coverage db unavailable');return query.by.includes('state')?counts:overdueCounts},
    findMany: async(query)=>{calls.push(query);return overdueItems.slice(0,query.take)},
  }};
  return {calls, db:{$transaction:async(fn,opts)=>{assert.equal(opts.isolationLevel,'RepeatableRead');return await fn(tx);}}};
}
await check('knowledge compliance counts use all rows, never first 5,000',async()=>{
  const f=knowledgeFixture({counts:[
    {resourceKind:'packet',state:'active',_count:{_all:9999}},
    {resourceKind:'packet',state:'completed',_count:{_all:125}},
    {resourceKind:'policy',state:'active',_count:{_all:250}},
    {resourceKind:'policy',state:'completed',_count:{_all:10000}},
  ], overdueCounts:[{resourceKind:'packet',_count:{_all:770}},{resourceKind:'policy',_count:{_all:51}}], overdueItems:[{id:'a',resourceKind:'packet',resourceId:'pk',dueAt:now}]});
  const r=await summarizeStudioKnowledgeAttention(f.db,now);
  assert.equal(r.total,20374);assert.equal(r.active,10249);assert.equal(r.completed,10125);assert.equal(r.overdue,821);
  assert.equal(r.overdueItems.length,1);assert.equal(f.calls.length,3);assert.equal(f.calls[2].take,12);
});
await check('knowledge compliance empty aggregates remain explicit zeros',async()=>{
  const r=await summarizeStudioKnowledgeAttention(knowledgeFixture().db,now);
  assert.equal(r.total,0);assert.equal(r.packets.overdue,0);assert.equal(r.policies.completed,0);
});
await check('knowledge database failure is not misreported as zero',async()=>{
  await assert.rejects(summarizeStudioKnowledgeAttention(knowledgeFixture({fail:true}).db,now),/coverage db unavailable/);
});
await check('Operations route uses bounded overdue details and aggregate counts',async()=>{
  const s=readFileSync('apps/server/src/domains/studio-systems/studio-systems-routes.ts','utf8');
  assert.match(s,/summarizeStudioKnowledgeAttention\(prisma, now\)/);
  const section=s.split('app.get("/api/studio-systems/knowledge/operations-summary"')[1].split('app.post(')[0];
  assert.doesNotMatch(section,/take: 5000|studioKnowledgeAssignment\.findMany/);
  assert.match(section,/overdueItems/);
});
console.log(`G27 Batch 5 attention and access: ${n}/${n} passed`);

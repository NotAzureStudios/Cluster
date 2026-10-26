import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let ts;
try { ts=require('typescript'); } catch { ts=require(process.env.CLUSTER_TYPESCRIPT_PATH || '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); }
import { nextCloseoutStatus, closeoutShareLinkProjection, closeoutShareLinkActive, updateCloseoutAtRevision, CloseoutConcurrentWrite } from '../../apps/server/src/domains/projects/project-closeout-policy.ts';
import { calendarRangeWhere, isCalendarInstant, isCalendarTimezone, isCalendarWindowValid } from '../../apps/server/src/domains/planning/calendar-intervals.ts';
import { prepareLibraryDestruction } from '../../apps/server/src/domains/library/library-destruction.ts';
import { libraryRetentionDecision } from '../../apps/server/src/domains/library/library-governance.ts';
let passed=0;
async function check(description, fn){await fn();++passed;console.log(`PASS ${description}`);}
const source=(path)=>fs.readFileSync(path,'utf8');
await check('Project closeout follows an explicit lifecycle and rejects skips',()=>{
  assert.equal(nextCloseoutStatus('draft','verify'),null);
  assert.equal(nextCloseoutStatus('draft','submit'),'submitted');
  assert.equal(nextCloseoutStatus('rejected','submit'),'submitted');
  assert.equal(nextCloseoutStatus('submitted','verify'),'verified');
  assert.equal(nextCloseoutStatus('submitted','reject'),'rejected');
  assert.equal(nextCloseoutStatus('verified','archive'),'archived');
  assert.equal(nextCloseoutStatus('archived','verify'),null);
  assert.equal(nextCloseoutStatus('archived','reopen'),'draft');
});
await check('Partner link projection never exposes raw token or stored hash',()=>{
  const result=closeoutShareLinkProjection({id:'a',projectId:'p',tokenHash:'SECRET_HASH',token:'SECRET',tokenPreview:'xxxx…',allowedSections:'["overview"]',accessLevel:'viewer',status:'active',useCount:0,maxUses:1});
  assert.deepEqual(result.allowedSections,['overview']);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
  assert.equal('tokenHash' in result,false);
});
await check('Expired and exhausted share links do not count as active',()=>{
  assert.equal(closeoutShareLinkActive({status:'active',expiresAt:new Date(Date.now()-1000)}),false);
  assert.equal(closeoutShareLinkActive({status:'active',maxUses:1,useCount:1}),false);
  assert.equal(closeoutShareLinkActive({status:'active',maxUses:2,useCount:1}),true);
});
await check('Closeout compare-and-swap only allows one of two writers',async()=>{
  let record={id:'c1',revision:2,status:'draft',kind:'closeout',archived:false,category:'project-closeout'};
  const db={projectControlRecord:{
    async updateMany({where,data}){if(Object.entries(where).some(([k,v])=>record[k]!==v))return {count:0};record={...record,...data,revision:record.revision+1};return {count:1};},
    async findUnique(){return {...record}}}};
  const results=await Promise.allSettled([updateCloseoutAtRevision(db,'c1',2,'draft',{description:'A'}),updateCloseoutAtRevision(db,'c1',2,'draft',{description:'B'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason instanceof CloseoutConcurrentWrite).length,1);
});
await check('Closeout refuses stale or wrong-state writes',async()=>{
  const tx={projectControlRecord:{async updateMany(){return {count:0}}}};
  await assert.rejects(updateCloseoutAtRevision(tx,'c',3,'draft',{}),CloseoutConcurrentWrite);
});
await check('Closeout routes require observed revisions and read-side authorization',()=>{
  const text=source('apps/server/src/domains/projects/project-closeout-routes.ts');
  assert.match(text,/expectedRevision: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(text,/requestCanTarget\(request, "project", project\.id, project, "manage"\)/);
  assert.match(text,/closeoutShareLinkProjection/);
  assert.match(text,/isolationLevel: "Serializable"/);
  assert.match(text,/\.strict\(\)/);
  assert.match(text,/Cache-Control", "no-store"/);
  assert.doesNotMatch(text,/projectShareLink\.findMany\(\{ where: \{ projectId: project\.id, status: "active" \} \}\)/);
});
await check('Renderer submits revision with closeout actions',()=>{
  assert.match(source('packages/renderer/src/features/projects/CloseoutPortalPanel.tsx'),/action, expectedRevision: state\.record\.revision/);
});
await check('Calendar validation rejects invalid offsets and impossible datetimes',()=>{
  assert.equal(isCalendarInstant('2026-10-08T19:30:00.000Z'),true);
  assert.equal(isCalendarInstant('2026-10-08T15:30:00-04:00'),true);
  assert.equal(isCalendarInstant('tomorrow'),false);
  assert.equal(isCalendarInstant('2026-14-08T20:00:00Z'),false);
  assert.equal(isCalendarInstant('2026-02-30T20:00:00Z'),false);
  assert.equal(isCalendarInstant('2026-10-08T19:30:00'),false);
  assert.equal(isCalendarTimezone('America/New_York'),true);
  assert.equal(isCalendarTimezone('Mars/Colony'),false);
});
await check('Calendar windows require increasing bounded times',()=>{
  assert.equal(isCalendarWindowValid('2026-10-08T00:00:00Z','2026-10-09T00:00:00Z'),true);
  assert.equal(isCalendarWindowValid('2026-10-09T00:00:00Z','2026-10-08T00:00:00Z'),false);
  assert.equal(isCalendarWindowValid('2025-01-01T00:00:00Z','2026-10-09T00:00:00Z'),false);
});
await check('Calendar overlap query includes events started before viewport',()=>{
  const where=calendarRangeWhere('2026-10-08T00:00:00Z','2026-10-09T00:00:00Z');
  assert.equal(where.AND[0].startsAt.lt.toISOString(),'2026-10-09T00:00:00.000Z');
  assert.equal(where.AND[1].OR[0].endsAt.gt.toISOString(),'2026-10-08T00:00:00.000Z');
  assert.deepEqual(calendarRangeWhere(),{});
});
function transpiledModule(file, stubs={}) {
  const js=ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(js,{exports,require:(name)=>stubs[name]||{},Intl,Date,Math,Set,Map,Array,Number,Boolean,Object,String,JSON,console,RangeError}, {filename:file});return exports;
}
const schedule=transpiledModule('apps/server/src/domains/time/scheduler-planning.ts');
await check('Daily recurrence preserves local wall time across spring DST',()=>{
  const start=new Date('2026-03-07T14:00:00Z'), end=new Date('2026-03-07T15:00:00Z');
  const seq=schedule.buildScheduleOccurrences(start,end,{frequency:'daily',occurrences:3},'America/New_York');
  assert.equal(seq.map(r=>r.startsAt.toISOString()).join(','), ['2026-03-07T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-09T13:00:00.000Z'].join(','));
});
await check('Nonexistent spring DST hour shifts forward, not oscillates',()=>{
  const seq=schedule.buildScheduleOccurrences(new Date('2026-03-07T07:30:00Z'),new Date('2026-03-07T08:30:00Z'),{frequency:'daily',occurrences:3},'America/New_York');
  assert.equal(seq[1].startsAt.toISOString(),'2026-03-08T07:30:00.000Z');
});
await check('Ambiguous fall DST hour chooses first occurrence',()=>{
  const seq=schedule.buildScheduleOccurrences(new Date('2026-10-31T05:30:00Z'),new Date('2026-10-31T06:30:00Z'),{frequency:'daily',occurrences:3},'America/New_York');
  assert.equal(seq[1].startsAt.toISOString(),'2026-11-01T05:30:00.000Z');
});
function db(item,opts={}) {
  let current={...item};let deleted=false;const refs=opts.refs||{};
  return {activityEvent:{async create(){return {id:"evidence"};}},get deleted(){return deleted},get current(){return current},libraryItem:{
    async findUnique(){return deleted?null:{...current}},
    async count({where}){return where.parentId?opts.children||0:refs[where.fileName]||0},
    async deleteMany({where}){if(deleted||current.revision!==where.revision||current.legalHold||current.lifecycleState!=='trashed'||(current.retentionUntil&&new Date(current.retentionUntil)>new Date()))return {count:0};deleted=true;return {count:1}}
  },libraryBacklink:{async count({where}={}){return where?.sourceResourceKind === 'packet_release' ? 0 : opts.backlinks||0}},libraryVersion:{async findMany(){return (opts.versions||[]).map(fileName=>({fileName}))},async count({where}){return refs[where.fileName]||0}}};
}
const trash={id:'f',title:'Alpha',revision:2,lifecycleState:'trashed',legalHold:false,fileName:'alpha.bin',retentionUntil:null};
await check('Immediate Library destruction primitive is disabled',async()=>{
 const store=db(trash);
 const result=await prepareLibraryDestruction(store,'f',2,'Alpha',true,'owner',libraryRetentionDecision);
 assert.equal(result.error.code,'LIBRARY_DISPOSITION_REVIEW_REQUIRED');assert.equal(store.deleted,false);
});
await check('Governed disposition uses revision, reason, and request identity',()=>{
 const backend=source('apps/server/src/domains/library/library-routes.ts');
 const client=source('packages/renderer/src/features/library/LibraryGovernancePanel.tsx');
 assert.match(backend,/requestLibraryDisposition\(tx/);
 assert.match(client,/expectedRevision: preview.revision/);
 assert.match(client,/requestKey: crypto.randomUUID\(\)/);
 assert.doesNotMatch(backend,/app.delete\("\/api\/library\/:itemId\/permanent"/);
});
console.log(`${passed}/${passed} v0.510 planning hardening assertions passed`);

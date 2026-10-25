/** Executable disposition logic with an in-memory transaction harness.
 * This is source-level evidence, NOT live PostgreSQL / filesystem acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
function load(file){
 const code=fs.readFileSync(file,'utf8');
 const tr=ts.transpileModule(code,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(tr.diagnostics?.length||0,0);
 const mod={exports:{}};
 vm.runInNewContext(tr.outputText,{module:mod,exports:mod.exports,require:id=>{
  if(id==='./library-governance.js')return{libraryRetentionDecision:item=>item.legalHold?{eligible:false,code:'LEGAL_HOLD'}:item.retentionUntil&&new Date(item.retentionUntil)>new Date()?{eligible:false,code:'RETENTION_ACTIVE'}:item.status!=='trashed'?{eligible:false,code:'NOT_TRASHED'}:{eligible:true,code:'ELIGIBLE'}};
  if(id==='./library-effective-retention.js')return{resolveLibraryEffectiveRetention:async(_tx,item)=>({legalHold:!!item.legalHold,retentionUntil:item.retentionUntil?new Date(item.retentionUntil):null,governingIds:[],lineage:[{id:item.id,revision:item.revision||0,parentId:null,legalHold:!!item.legalHold,retentionUntil:item.retentionUntil||null}]})};
  if(id.startsWith('node:'))return require(id);
  throw Error(`Unmocked ${id}`);
 },Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,console,Buffer},{filename:file});
 return mod.exports;
}
const {inspectLibraryDisposition,libraryDispositionReviewAfter,requestLibraryDisposition,cancelLibraryDisposition,reviewLibraryDisposition}=load('apps/server/src/domains/library/library-disposition.ts');
const NOW=new Date('2026-10-15T19:00:00Z');
function fixture(extra={}){
 const state={item:{id:'item',revision:8,title:'Asset A',projectId:'p',status:'trashed',lifecycleState:'trashed',retentionPolicyKey:'standard',retentionUntil:null,legalHold:false,fileName:'a.bin',...extra},requests:[],events:[],activity:[],children:0,backlinks:0,versions:2,derivatives:1,hierarchy:0,locks:null,protectedRecords:0,releases:0};
 const tx={
  libraryItem:{findUnique:async()=>state.item,count:async()=>state.children},
  libraryBacklink:{count:async()=>state.backlinks}, libraryVersion:{count:async()=>state.versions}, libraryDerivative:{count:async()=>state.derivatives},
  libraryHierarchyLifecycleEntry:{count:async()=>state.hierarchy},libraryAssetLock:{findUnique:async()=>state.locks},
  personnelRecordAttachment:{count:async()=>state.protectedRecords},packetRelease:{count:async()=>state.releases},
  libraryDispositionRequest:{
   findFirst:async({where})=>state.requests.find(r=>r.itemId===where.itemId&&r.status===where.status)||null,
   create:async({data})=>{if(state.requests.some(r=>r.status==='PENDING_REVIEW'))throw Error('UNIQUE_PENDING');state.requests.push({...data});return data},
   updateMany:async({where,data})=>{const r=state.requests.find(x=>x.id===where.id&&x.status===where.status);if(!r)return{count:0};Object.assign(r,data);return{count:1}},
  },
  libraryDispositionEvidence:{create:async({data})=>{state.events.push(data);return data}},
  activityEvent:{create:async({data})=>{state.activity.push(data);return data}},
 };
 return {state,tx,request:(patch={})=>requestLibraryDisposition(tx,{itemId:'item',actorId:'admin',expectedRevision:8,confirmTitle:'Asset A',reason:'Completed production retention review',requestKey:'00000000-0000-4000-8000-000000000001',now:NOW,...patch})};
}
let passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS',label)}
await check('minimum thirty-day restore window',()=>assert.equal(libraryDispositionReviewAfter(NOW).toISOString(),'2026-11-14T19:00:00.000Z'));
await check('retention date extends but cannot shorten restore window',()=>assert.equal(libraryDispositionReviewAfter(NOW,'2026-12-22T00:00:00Z').toISOString(),'2026-12-22T00:00:00.000Z'));
await check('item authority includes all versions and derivatives',async()=>{const f=fixture();const r=await inspectLibraryDisposition(f.tx,'item',NOW);assert.equal(r.evidence.fileReferenceCount,4);assert.equal(r.blockers.length,0);});
await check('legal hold prohibits request',async()=>{const f=fixture({legalHold:true});await assert.rejects(f.request(),/LEGAL_HOLD/);});
await check('retention prohibits request',async()=>{const f=fixture({retentionUntil:'2099-01-01T00:00:00Z'});await assert.rejects(f.request(),/RETENTION_ACTIVE/);});
await check('must be trashed',async()=>{const f=fixture({status:'active'});await assert.rejects(f.request(),/NOT_TRASHED/);});
for(const [field,expected] of [['children','CHILDREN_PRESENT'],['backlinks','BACKLINKS_PRESENT'],['releases','PUBLISHED_RELEASE_REFERENCE'],['hierarchy','HIERARCHY_PROVENANCE_ACTIVE'],['protectedRecords','PERSONNEL_RECORD_REFERENCE']]){
 await check(`${field} protects disposition`,async()=>{const f=fixture();f.state[field]=1;await assert.rejects(f.request(),new RegExp(expected));});
}
await check('active edit lock protects disposition',async()=>{const f=fixture();f.state.locks={state:'active'};await assert.rejects(f.request(),/ACTIVE_EDIT_LOCK/);});
await check('version conflict cannot stage stale request',async()=>{const f=fixture();await assert.rejects(f.request({expectedRevision:7}),/changed/);});
await check('exact title required',async()=>{const f=fixture();await assert.rejects(f.request({confirmTitle:'Asset B'}),/changed/);});
await check('reason is mandatory',async()=>{const f=fixture();await assert.rejects(f.request({reason:'x'}),/reason/);});
await check('pending request preserves item and creates audit evidence',async()=>{const f=fixture();const a=await f.request();assert.equal(a.replay,false);assert.equal(f.state.item.fileName,'a.bin');assert.equal(f.state.events[0].eventType,'REQUESTED');assert.equal(f.state.activity.length,1);assert.equal(f.state.requests[0].status,'PENDING_REVIEW');});
await check('replay of same actor and key is idempotent',async()=>{const f=fixture();await f.request();const second=await f.request();assert.equal(second.replay,true);assert.equal(f.state.events.length,1);});
await check('different key cannot overwrite active request',async()=>{const f=fixture();await f.request();await assert.rejects(f.request({requestKey:'00000000-0000-4000-8000-000000000002'}),/already has/);});
await check('too-early request never becomes review-ready',async()=>{const f=fixture();await f.request();const r=await reviewLibraryDisposition(f.tx,'item',new Date('2026-11-01'));assert.equal(r.readyForHumanReview,false);assert.ok(r.blockers.includes('RESTORE_WINDOW_ACTIVE'));assert.equal(r.physicalDisposalAllowed,false);});
await check('hold after submission invalidates review',async()=>{const f=fixture();await f.request();f.state.item.legalHold=true;const r=await reviewLibraryDisposition(f.tx,'item',new Date('2026-12-20'));assert.ok(r.blockers.includes('LEGAL_HOLD'));assert.ok(r.blockers.includes('DISPOSITION_SNAPSHOT_STALE'));});
await check('new published reference invalidates request',async()=>{const f=fixture();await f.request();f.state.releases=1;const r=await reviewLibraryDisposition(f.tx,'item',new Date('2026-12-20'));assert.ok(r.blockers.includes('PUBLISHED_RELEASE_REFERENCE'));});
await check('unchanged evidence after window is human-review only',async()=>{const f=fixture();await f.request();const r=await reviewLibraryDisposition(f.tx,'item',new Date('2026-12-20'));assert.equal(r.readyForHumanReview,true);assert.equal(r.physicalDisposalAllowed,false);});
await check('cancellation writes evidence and new requests remain possible',async()=>{const f=fixture();await f.request();const c=await cancelLibraryDisposition(f.tx,{itemId:'item',actorId:'admin',reason:'Approved restoration',now:NOW});assert.equal(c.cancelled,true);assert.equal(f.state.requests[0].status,'CANCELLED');assert.equal(f.state.events.length,2);await f.request({requestKey:'00000000-0000-4000-8000-000000000002'});assert.equal(f.state.requests.length,2);});
await check('cancellation of absent pending request does nothing',async()=>{const f=fixture();const c=await cancelLibraryDisposition(f.tx,{itemId:'item',actorId:'admin',reason:'Case closed'});assert.equal(c.cancelled,false);assert.equal(f.state.events.length,0);});
console.log(`R63 disposition executable checks ${passed}/${passed}`);

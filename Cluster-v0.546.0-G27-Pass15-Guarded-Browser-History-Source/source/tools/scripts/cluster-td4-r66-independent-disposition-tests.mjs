/** TD4 R66 source-level executable governance tests. No DB/provider certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file='apps/server/src/domains/library/library-disposition.ts';
const trans=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(trans.diagnostics?.length||0,0);
const mod={exports:{}};
vm.runInNewContext(trans.outputText,{module:mod,exports:mod.exports,require:id=>{
 if(id==='./library-governance.js')return{libraryRetentionDecision:item=>item.legalHold?{eligible:false,code:'LEGAL_HOLD'}:item.retentionUntil&&new Date(item.retentionUntil)>new Date('2026-12-20')?{eligible:false,code:'RETENTION_ACTIVE'}:item.status!=='trashed'?{eligible:false,code:'NOT_TRASHED'}:{eligible:true,code:'ELIGIBLE'}};
  if(id==='./library-effective-retention.js')return{resolveLibraryEffectiveRetention:async(_tx,item)=>({legalHold:!!item.legalHold,retentionUntil:item.retentionUntil?new Date(item.retentionUntil):null,governingIds:[],lineage:[{id:item.id,revision:item.revision||0,parentId:null,legalHold:!!item.legalHold,retentionUntil:item.retentionUntil||null}]})};
 if(id.startsWith('node:'))return require(id);throw Error(`Missing mock ${id}`);
},Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,console,Buffer},{filename:file});
const {requestLibraryDisposition,reviewLibraryDisposition,decideLibraryDisposition,cancelLibraryDisposition,projectLibraryDispositionApprovals}=mod.exports;
const START=new Date('2026-10-15T00:00:00Z');const LATER=new Date('2026-12-20T00:00:00Z');
function fixture(){
 const state={item:{id:'asset',revision:5,title:'Audio Sample',projectId:'p1',status:'trashed',lifecycleState:'trashed',retentionPolicyKey:'default',retentionUntil:null,legalHold:false,fileName:'asset.wav'},requests:[],decisions:[],events:[],activity:[],children:0,backlinks:0,releases:0,versions:2,derivatives:1};
 const tx={
  libraryItem:{findUnique:async()=>state.item,count:async()=>state.children},libraryBacklink:{count:async()=>state.backlinks},
  libraryVersion:{count:async()=>state.versions},libraryDerivative:{count:async()=>state.derivatives},
  libraryHierarchyLifecycleEntry:{count:async()=>0},libraryAssetLock:{findUnique:async()=>null},
  personnelRecordAttachment:{count:async()=>0},packetRelease:{count:async()=>state.releases},
  libraryDispositionRequest:{
   findFirst:async({where})=>state.requests.find(r=>r.itemId===where.itemId&&r.status===where.status)||null,
   create:async({data})=>{if(state.requests.some(r=>r.itemId===data.itemId&&['PENDING_REVIEW','REVIEW_APPROVED'].includes(r.status)))throw Error('ACTIVE_UNIQUE_CONFLICT');state.requests.push({...data});return data},
   updateMany:async({where,data})=>{const r=state.requests.find(x=>x.id===where.id&&x.status===where.status&&(where.decisionRevision===undefined||x.decisionRevision===where.decisionRevision));if(!r)return{count:0};for(const[k,v]of Object.entries(data))r[k]=v&&typeof v==='object'&&'increment'in v?(r[k]||0)+v.increment:v;return{count:1}},
  },
  libraryDispositionDecision:{findMany:async({where})=>state.decisions.filter(d=>d.requestId===where.requestId).sort((a,b)=>a.requestDecisionRevision-b.requestDecisionRevision),create:async({data})=>{if(state.decisions.some(d=>d.requestId===data.requestId&&d.requestDecisionRevision===data.requestDecisionRevision))throw Error('DECISION_UNIQUE_CONFLICT');state.decisions.push({...data});return data}},
  libraryDispositionEvidence:{create:async({data})=>{state.events.push(data);return data}},
  activityEvent:{create:async({data})=>{state.activity.push(data);return data}},
 };
 const submit=(input={})=>requestLibraryDisposition(tx,{itemId:'asset',actorId:'requester',expectedRevision:5,confirmTitle:'Audio Sample',reason:'Documented expiration of studio content',requestKey:'00000000-0000-4000-8000-000000000001',now:START,...input});
 const decide=(actorId,action,extra={})=>decideLibraryDisposition(tx,{itemId:'asset',actorId,action,reason:'Independent compliance decision with evidence reviewed',expectedDecisionRevision:state.requests.at(-1)?.decisionRevision??0,now:LATER,...extra});
 return {state,tx,submit,decide};
}
let count=0;async function test(name,fn){await fn();++count;console.log('PASS',name)}
await test('projection handles approvals revocations and rejection',()=>{
 assert.deepEqual(Array.from(projectLibraryDispositionApprovals([{action:'APPROVE',actorId:'A'},{action:'APPROVE',actorId:'B'},{action:'REVOKE',actorId:'A'}])),['B']);
 assert.deepEqual(Array.from(projectLibraryDispositionApprovals([{action:'APPROVE',actorId:'A'},{action:'REJECT',actorId:'B'}])),[]);
});
await test('request snapshot format and revision are explicit',async()=>{const f=fixture();await f.submit();assert.equal(f.state.requests[0].snapshotVersion,1);assert.equal(f.state.requests[0].decisionRevision,0)});
await test('requester cannot approve own disposition',async()=>{const f=fixture();await f.submit();await assert.rejects(f.decide('requester','APPROVE'),/requester cannot review/i)});
await test('approval blocked until restore window expires',async()=>{const f=fixture();await f.submit();await assert.rejects(f.decide('reviewer-a','APPROVE',{now:START}),/restoration window/);assert.equal(f.state.decisions.length,0)});
await test('one independent approval does not complete review',async()=>{const f=fixture();await f.submit();const a=await f.decide('reviewer-a','APPROVE');assert.equal(a.approvalCount,1);assert.equal(a.status,'PENDING_REVIEW');assert.equal(a.physicalDisposalAllowed,false)});
await test('two unique administrators can complete governance review only',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');const b=await f.decide('reviewer-b','APPROVE');assert.equal(b.status,'REVIEW_APPROVED');assert.equal(b.approvalCount,2);assert.equal(b.physicalDisposalAllowed,false);const review=await reviewLibraryDisposition(f.tx,'asset',LATER);assert.equal(review.approvalValidNow,true);assert.equal(review.physicalDisposalAllowed,false);assert.deepEqual(Array.from(review.approverIds),['reviewer-a','reviewer-b'])});
await test('same administrator cannot provide quorum twice',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await assert.rejects(f.decide('reviewer-a','APPROVE'),/already approved/);assert.equal(f.state.decisions.length,1)});
await test('optimistic review revision detects stale concurrent decision',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await assert.rejects(f.decide('reviewer-b','APPROVE',{expectedDecisionRevision:0}),/changed the decision/);assert.equal(f.state.decisions.length,1)});
await test('legal hold added after request blocks approval',async()=>{const f=fixture();await f.submit();f.state.item.legalHold=true;await assert.rejects(f.decide('reviewer-a','APPROVE'),/review is required/i)});
await test('retention extended after request blocks approval',async()=>{const f=fixture();await f.submit();f.state.item.retentionUntil='2099-01-01';await assert.rejects(f.decide('reviewer-a','APPROVE'),/review is required/i)});
await test('new reference blocks approval',async()=>{const f=fixture();await f.submit();f.state.releases=1;await assert.rejects(f.decide('reviewer-a','APPROVE'),/review is required/i)});
await test('record revision changed blocks approval',async()=>{const f=fixture();await f.submit();f.state.item.revision++;await assert.rejects(f.decide('reviewer-a','APPROVE'),/review is required/i)});
await test('snapshot version mismatch blocks approval',async()=>{const f=fixture();await f.submit();f.state.requests[0].snapshotVersion=999;await assert.rejects(f.decide('reviewer-a','APPROVE'),/supported evidence/)});
await test('only approving administrator can revoke own approval',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await assert.rejects(f.decide('reviewer-b','REVOKE'),/only the administrator/i);const r=await f.decide('reviewer-a','REVOKE');assert.equal(r.approvalCount,0);assert.equal(f.state.decisions.length,2)});
await test('revoking one of two approved votes reverses governance approval',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await f.decide('reviewer-b','APPROVE');const r=await f.decide('reviewer-a','REVOKE');assert.equal(r.status,'PENDING_REVIEW');assert.equal(r.approvalCount,1);assert.equal(r.physicalDisposalAllowed,false)});
await test('revocation remains possible after legal hold',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');f.state.item.legalHold=true;const r=await f.decide('reviewer-a','REVOKE');assert.equal(r.approvalCount,0)});
await test('reject closes request and frees new request slot',async()=>{const f=fixture();await f.submit();const r=await f.decide('reviewer-a','REJECT');assert.equal(r.status,'REVIEW_REJECTED');assert.equal(r.physicalDisposalAllowed,false);await f.submit({requestKey:'00000000-0000-4000-8000-000000000002'});assert.equal(f.state.requests.length,2)});
await test('cancellation also reverses fully approved governance state',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await f.decide('reviewer-b','APPROVE');const c=await cancelLibraryDisposition(f.tx,{itemId:'asset',actorId:'requester',reason:'Cancel approved review',now:LATER});assert.equal(c.cancelled,true);assert.equal(f.state.requests[0].status,'CANCELLED')});
await test('final approval validity is revoked by later hold even without mutation route',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await f.decide('reviewer-b','APPROVE');f.state.item.legalHold=true;const r=await reviewLibraryDisposition(f.tx,'asset',LATER);assert.equal(r.approvalValidNow,false);assert.ok(r.blockers.includes('LEGAL_HOLD'));assert.equal(r.physicalDisposalAllowed,false)});
await test('append-only decisions retain versioned immutable evidence',async()=>{const f=fixture();await f.submit();await f.decide('reviewer-a','APPROVE');await f.decide('reviewer-b','APPROVE');assert.deepEqual(f.state.decisions.map(d=>d.requestDecisionRevision),[1,2]);assert.ok(f.state.decisions.every(d=>d.snapshotVersion===1&&d.snapshotSha256));assert.equal(f.state.events.filter(e=>e.eventType==='REVIEW_APPROVE').length,2)});
await test('invalid or missing review justification is rejected',async()=>{const f=fixture();await f.submit();await assert.rejects(f.decide('reviewer-a','APPROVE',{reason:'too short'}),/reason/);assert.equal(f.state.decisions.length,0)});
console.log(`R66 independent disposition governance ${count}/${count}`);

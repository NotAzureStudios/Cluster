/** TD4 R67 focused executable tests, not PostgreSQL or NAS certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const filename='apps/server/src/domains/library/library-quarantine-simulation.ts';
const transpiled=ts.transpileModule(fs.readFileSync(filename,'utf8'), {fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(transpiled.diagnostics?.length||0,0);
class DispositionError extends Error {constructor(code,message){super(message);this.code=code}}
const state={review:null,ownership:null,plans:[],journal:[]};
const mod={exports:{}};
vm.runInNewContext(transpiled.outputText,{module:mod,exports:mod.exports,require(id){
 if(id==='./library-disposition-ownership.js')return{inspectLibraryStorageOwnership:async()=>state.ownership};
 if(id==='./library-disposition.js')return{LibraryDispositionError:DispositionError,reviewLibraryDisposition:async()=>state.review};
 if(id.startsWith('node:'))return require(id);throw Error('unknown mock '+id);
},Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,console,Buffer},{filename});
const {libraryQuarantineSimulation, inspectLibraryQuarantineSimulation,recordLibraryQuarantineSimulation,withdrawLibraryQuarantineSimulation}=mod.exports;
const NOW=new Date('2026-12-31T00:00:00.000Z');
let checks=0;
async function test(name,fn){await fn();console.log('PASS',name);checks++}
function fixture(){
 state.review={request:{id:'request1',status:'REVIEW_APPROVED',snapshotSha256:'a'.repeat(64),decisionRevision:2},approvalValidNow:true};
 state.ownership={itemId:'item1',databaseInventoryComplete:true,providerInventoryComplete:false,
  fingerprint:'b'.repeat(64),relatedAuthority:{fingerprint:'c'.repeat(64)},objects:[{}],ownerRecordsScanned:12,
  blockers:['PROVIDER_GENERATION_UNVERIFIED','BACKUP_RETENTION_UNVERIFIED']};
 state.plans=[];state.journal=[];
 const tx={
  libraryQuarantinePlan:{findUnique:async({where})=>state.plans.find(x=>x.planKey===where.planKey||x.id===where.id)||null,
   create:async({data})=>{state.plans.push(data);return data}},
  libraryQuarantineJournal:{findFirst:async({where})=>state.journal.find(x=>x.planId===where.planId&&x.eventType===where.eventType)||null,
   create:async({data})=>{state.journal.push(data);return data}},
 };
 const sim=()=>libraryQuarantineSimulation({review:state.review,ownership:state.ownership,now:NOW});
 const capture=(extra={})=>recordLibraryQuarantineSimulation(tx,{itemId:'item1',actorId:'admin-operator',
  planKey:'00000000-0000-4000-8000-000000000001',reason:'Operator archive proof is incomplete',
  expectedDecisionRevision:2,simulation:sim(),now:NOW,...extra});
 return {tx,sim,capture};
}
await test('quarantine preview is categorically non-executable',()=>{const f=fixture();const r=f.sim();assert.equal(r.quarantineAllowed,false);assert.equal(r.physicalDisposalAllowed,false);assert.equal(r.mode,'SIMULATION_ONLY');assert.ok(r.blockers.includes('NO_ATOMIC_PROVIDER_QUARANTINE_ADAPTER'))});
await test('provider and backup safety blockers stay visible',()=>{const f=fixture();const r=f.sim();assert.ok(r.blockers.includes('BACKUP_AND_ACTIVE_WRITER_FENCES_UNCERTIFIED'));assert.ok(r.blockers.includes('PROVIDER_GENERATION_UNVERIFIED'))});
await test('incomplete approval is blocked even in a simulation',()=>{const f=fixture();state.review.approvalValidNow=false;assert.ok(f.sim().blockers.includes('GOVERNANCE_EVIDENCE_NOT_CURRENT'))});
await test('missing request is visible and not permission to mutate',()=>{const f=fixture();state.review={request:null,approvalValidNow:false};assert.ok(f.sim().blockers.includes('NO_ACTIVE_DISPOSITION_REQUEST'))});
await test('changed ownership produces a different snapshot fingerprint',()=>{const f=fixture();const before=f.sim();state.ownership.fingerprint='d'.repeat(64);assert.notEqual(f.sim().fingerprint,before.fingerprint)});
await test('simulation has short informational expiry',()=>{const f=fixture();assert.equal(f.sim().expiresAt.getTime()-NOW.getTime(),15*60_000)});
await test('API inspector consumes latest review and ownership',async()=>{fixture();const x=await inspectLibraryQuarantineSimulation({prisma:{},itemId:'item1',libraryRoot:'/fake',now:NOW});assert.equal(x.requestId,'request1')});
await test('recorded simulation retains immutable evidence and one journal entry',async()=>{const f=fixture();const result=await f.capture();assert.equal(result.replay,false);assert.equal(state.plans.length,1);assert.equal(state.journal.length,1);assert.equal(state.journal[0].eventType,'SIMULATED');assert.equal(JSON.parse(state.plans[0].snapshotJson).quarantineAllowed,false)});
await test('same intent key returns existing snapshot without duplicate insert',async()=>{const f=fixture();await f.capture();const replay=await f.capture();assert.equal(replay.replay,true);assert.equal(state.journal.length,1)});
await test('idempotency key cannot be reused by another operator',async()=>{const f=fixture();await f.capture();await assert.rejects(f.capture({actorId:'bad-operator'}),/belongs to another request/)});
await test('quorum revoked while scanning blocks recording',async()=>{const f=fixture();const scan=f.sim();state.review.approvalValidNow=false;await assert.rejects(f.capture({simulation:scan}),/independent approvals/);assert.equal(state.plans.length,0)});
await test('decision revision changes block recording',async()=>{const f=fixture();const scan=f.sim();state.review.request.decisionRevision=3;await assert.rejects(f.capture({simulation:scan}),/changed during inspection/)});
await test('retention/governance snapshot changes block recording',async()=>{const f=fixture();const scan=f.sim();state.review.request.snapshotSha256='d'.repeat(64);await assert.rejects(f.capture({simulation:scan}),/changed during inspection/)});
await test('cross-item report reuse is rejected',async()=>{const f=fixture();await assert.rejects(f.capture({itemId:'other'}),/does not match the Library item/)});
await test('expired report is rejected',async()=>{const f=fixture();const scan=f.sim();await assert.rejects(f.capture({simulation:scan,now:new Date(NOW.getTime()+16*60_000)}),/expired/)});
await test('withdrawal keeps the original plan and appends an event',async()=>{const f=fixture();const {plan}=await f.capture();const result=await withdrawLibraryQuarantineSimulation(f.tx,{itemId:'item1',planId:plan.id,actorId:'admin-operator',reason:'Backup lifecycle is still uncertain',now:NOW});assert.equal(result.withdrawn,true);assert.equal(state.plans.length,1);assert.equal(state.journal.length,2);assert.equal(state.journal[1].eventType,'WITHDRAWN')});
await test('repeated withdrawal is idempotent',async()=>{const f=fixture();const {plan}=await f.capture();const input={itemId:'item1',planId:plan.id,actorId:'admin-operator',reason:'Backup lifecycle is still uncertain',now:NOW};await withdrawLibraryQuarantineSimulation(f.tx,input);const result=await withdrawLibraryQuarantineSimulation(f.tx,input);assert.equal(result.replay,true);assert.equal(state.journal.length,2)});
await test('wrong-item withdrawal fails closed',async()=>{const f=fixture();const {plan}=await f.capture();await assert.rejects(withdrawLibraryQuarantineSimulation(f.tx,{itemId:'other',planId:plan.id,actorId:'admin',reason:'Different item was selected'}),/No matching simulation/)});
await test('blank reason cannot create a plan',async()=>{const f=fixture();await assert.rejects(f.capture({reason:'x'}),/reason between 12/)});
await test('blank reason cannot withdraw a plan',async()=>{const f=fixture();const {plan}=await f.capture();await assert.rejects(withdrawLibraryQuarantineSimulation(f.tx,{itemId:'item1',planId:plan.id,actorId:'admin',reason:'x'}),/withdrawal reason/)});
console.log(`R67 executable quarantine simulations ${checks}/${checks}`);

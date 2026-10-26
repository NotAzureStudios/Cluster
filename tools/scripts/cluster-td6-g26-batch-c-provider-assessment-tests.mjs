#!/usr/bin/env node
/** G26 Batch C: on-demand provider evidence must never become write authority. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const path='apps/server/src/domains/uploads/upload-session-runtime.ts';
const transpiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const mod={exports:{}};
vm.runInNewContext(transpiled,{module:mod,exports:mod.exports,process,Buffer,Date,Number,String,Math,JSON,Promise,Map,Set,Object,Error,BigInt,URL,URLSearchParams,require(name){if(name.startsWith('node:'))return require(name);return new Proxy({}, {get(){return()=>({})}})}},{filename:path});
const inspect=mod.exports.inspectUploadRecovery;
const id='f2d91a6b-1234-4abc-9123-a12b34c56def';
const original=()=>({id,ownerId:'p1',workspaceId:'project',fileName:'blob.zip',mode:'direct',status:'FINALIZING',updatedAt:new Date('2026-10-20T04:00:00Z'),totalBytes:100n,receivedBytes:80n,storageProvider:'s3',storageTier:'temporary',storageKey:`uploads/project/${id}/blob.zip`,multipartUploadId:'secret-upload-id',checksumSha256:'f'.repeat(64)});
function fixture({head={size:100,checksumSha256:'f'.repeat(64)},parts={state:'active',observedParts:2,observedBytes:80,truncated:false},jobs=[]}={}){
 let before=original(),after={...before},mutations=0;
 const deps={prisma:{uploadSession:{findUnique:async({select})=>{const value=++reads===1?before:after;return Object.fromEntries(Object.keys(select).map(k=>[k,value[k]]))}},backgroundJob:{findMany:async()=>jobs}},storageRuntime:{provider:()=>({capabilities:{objectStorage:true,multipartUploads:true}}),stat:async()=>head,inspectMultipartUpload:async()=>parts,delete:()=>{mutations++;throw Error('forbidden')},abortMultipartUpload:()=>{mutations++;throw Error('forbidden')}},dataLayout:{root:'/unavailable'}};
 let reads=0;
 return {deps,setAfter:changes=>after={...after,...changes},inspect:()=>inspect(deps,id),mutations:()=>mutations};
}
let checks=0;async function check(label,fn){await fn();checks++;console.log('PASS G26 Batch C provider '+label)}
await check('apparently matching object is still only an advisory observation',async()=>{const f=fixture();const result=await f.inspect();assert.equal(result.unchangedDuringInspection,true);assert.equal(result.assessment.state,'requires_review');assert.equal(result.assessment.automaticallyActionable,false);assert.ok(result.assessment.reasons.includes('remote_presence_not_checksum_or_generation_proof'));assert.equal(result.recoveryAuthorized,false);assert.equal(f.mutations(),0)});
await check('HEAD checksum disagreement is conflicting but never repair permission',async()=>{const result=await fixture({head:{size:100,checksumSha256:'a'.repeat(64)}}).inspect();assert.equal(result.assessment.state,'conflicting');assert.ok(result.assessment.reasons.includes('checksum_metadata_mismatch'));assert.equal(result.dispositionAuthorized,false)});
await check('remote byte-count mismatch is actionable only by independent review',async()=>{const result=await fixture({head:{size:99}}).inspect();assert.equal(result.assessment.state,'conflicting');assert.ok(result.assessment.reasons.includes('remote_size_mismatch'))});
await check('provider missing parts cannot be treated as proven abort',async()=>{const result=await fixture({parts:{state:'not_found',observedParts:0,observedBytes:0,truncated:false}}).inspect();assert.equal(result.assessment.state,'requires_review');assert.ok(result.assessment.reasons.includes('provider_absence_is_not_finalization_proof'))});
await check('active background job remains visible as a blocker',async()=>{const result=await fixture({jobs:[{status:'RUNNING'}]}).inspect();assert.ok(result.assessment.reasons.includes('active_transfer_job'));assert.equal(result.assessment.automaticallyActionable,false)});
await check('changing storage provider while timestamp stays constant stales result',async()=>{const f=fixture();f.setAfter({storageProvider:'other'});const result=await f.inspect();assert.equal(result.assessment.state,'stale');assert.equal(result.unchangedDuringInspection,false)});
await check('changing expected checksum while timestamp stays constant stales result',async()=>{const f=fixture();f.setAfter({checksumSha256:'a'.repeat(64)});assert.equal((await f.inspect()).assessment.state,'stale')});
await check('changing total byte count stales result',async()=>{const f=fixture();f.setAfter({totalBytes:200n});assert.equal((await f.inspect()).assessment.state,'stale')});
await check('changing received byte count stales result',async()=>{const f=fixture();f.setAfter({receivedBytes:100n});assert.equal((await f.inspect()).assessment.state,'stale')});
await check('changing workspace identity stales result',async()=>{const f=fixture();f.setAfter({workspaceId:'different'});assert.equal((await f.inspect()).assessment.state,'stale')});
await check('changing ownership stales result without leaking owner',async()=>{const f=fixture();f.setAfter({ownerId:'private'});const result=await f.inspect();assert.equal(result.assessment.state,'stale');assert.ok(!JSON.stringify(result).includes('private'))});
await check('read-only UI displays assessment and no mutation button',async()=>{const ui=readFileSync('packages/renderer/src/features/library/LibraryUploadRecoveryPanel.tsx','utf8');assert.match(ui,/inspection\.assessment\.state/);assert.match(ui,/automaticallyActionable: false/);assert.doesNotMatch(ui,/method:\s*["'](?:POST|DELETE)/)});
console.log(`Cluster G26 Batch C provider assessment: ${checks}/${checks} checks passed`);

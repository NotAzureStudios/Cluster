/** G26 WS5: controlled transactional/provider races; real runtime source execution. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Readable } from 'node:stream';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const root=path.resolve(import.meta.dirname,'../..');
const file=path.join(root,'apps/server/src/domains/uploads/upload-session-runtime.ts');
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const evidence=[];
function loadRuntime(){const mod={exports:{}};vm.runInNewContext(compiled,{module:mod,exports:mod.exports,process,Buffer,Promise,Date,Error,Number,BigInt,Set,Math,
 require(id){if(id==='../../core/uploads.js')return {safeFileName:s=>s};if(id==='../../core/efficiency-metrics.js')return {recordEfficiencyMetric:async()=>{}};
 if(id==='./deferred-direct-upload-journal.js')return {recordDeferredDirectUpload:async({session,reason})=>{evidence.push({id:session.id,reason});}};
 if(id.startsWith('node:'))return require(id);throw Error('unexpected '+id);}}, {filename:file});return mod.exports;}
const runtime=loadRuntime();
const id='9983d3ca-7ca3-4c40-93f5-7e600a5f37be', bytes=Buffer.from('verified-part');
const digest=createHash('sha256').update(bytes).digest('hex');
const expired=()=>new Date(Date.now()-60000);
const tomorrow=()=>new Date(Date.now()+60000);
const base=()=>({id,ownerId:'actor',status:'OPEN',mode:'direct',fileName:'content.bin',totalBytes:BigInt(bytes.length),receivedBytes:0n,
 partSize:bytes.length,multipartUploadId:'provider-upload',storageProvider:'s3',storageTier:'temporary',storageKey:`uploads/test/${id}/content.bin`,parts:[],expiresAt:tomorrow()});
const stage=()=>({partNumber:1,sizeBytes:bytes.length,etag:'"etag1"',authorizedAt:new Date(),completedAt:new Date()});
function barrier(){let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};}
function fixture({session=base(), provider={},job=false,journalFail=false}={}){
 evidence.length=0;let state={...session,parts:(session.parts||[]).map(x=>({...x}))};let deleted=false,aborts=0,completions=0,reads=0,updates=0,claims=0,providerDeletes=0;
 // A controlled transaction mutex models SELECT FOR UPDATE while no network
 // I/O occurs inside the lock. In live Postgres, the row lock is database-owned.
 let tail=Promise.resolve();
 const transaction=async callback=>{const previous=tail;let unlock;tail=new Promise(resolve=>unlock=resolve);await previous;try{return await callback(db);}finally{unlock();}};
 const equal=(where,row)=>Object.entries(where||{}).every(([key,value])=>{
  if(key==='expiresAt'&&value?.lt)return new Date(row.expiresAt)<new Date(value.lt);
  return row[key]===value;
 });
 const db={
  $transaction:transaction,
  $queryRaw:async()=>{if(!state||deleted)throw Error('row absent');return [{id}];},
  uploadSession:{
   findUnique:async()=>deleted?null:state,
   findMany:async()=>!deleted&&state.expiresAt<Date.now()?[state]:!deleted&&state.expiresAt<new Date()?[state]:[],
   update:async({where,data})=>{if(deleted||!equal(where,state))throw Object.assign(Error('lost update'),{code:'P2025'});state={...state,...data};updates++;return state;},
   updateMany:async({where,data})=>{if(deleted||!equal(where,state))return {count:0};state={...state,...data};claims++;return {count:1};},
   deleteMany:async({where})=>{if(deleted||!equal(where,state))return {count:0};deleted=true;return {count:1};},
  },
  uploadSessionPart:{
   upsert:async({where,create,update})=>{const index=state.parts.findIndex(p=>p.partNumber===where.uploadSessionId_partNumber.partNumber);
    if(index>=0)state.parts[index]={...state.parts[index],...update};else state.parts.push({...create});return state.parts[index]||state.parts.at(-1);},
   update:async({where,data})=>{const p=state.parts.find(row=>row.partNumber===where.uploadSessionId_partNumber.partNumber);if(!p)throw Error('missing part');Object.assign(p,data);return p;},
   aggregate:async()=>({_sum:{sizeBytes:state.parts.filter(part=>part.completedAt&&part.etag).reduce((sum,part)=>sum+part.sizeBytes,0)}}),
  },
  backgroundJob:{findMany:async()=>job?[{dedupeKey:`library-transfer:${id}`}]:[]},
 };
 const storageRuntime={
  createMultipartPartUploadUrl:async()=>({url:'https://object.invalid/part',expiresAt:tomorrow()}),
  completeMultipartUpload:async(...args)=>{completions++;return provider.completeMultipartUpload?provider.completeMultipartUpload(...args):{size:bytes.length}},
  openRead:async()=>{reads++;return provider.openRead?provider.openRead():Readable.from([bytes])},
  abortMultipartUpload:async(...args)=>{aborts++;if(provider.abortMultipartUpload)return provider.abortMultipartUpload(...args)},
  delete:async()=>{providerDeletes++;},
 };
 const deps={prisma:db,storageRuntime,dataLayout:{root:'/tmp/not-for-object',runtimeRoot:'/tmp/not-for-object'}};
 return {deps,get state(){return state},set state(v){state=v},get deleted(){return deleted},get claims(){return claims},get updates(){return updates},get completions(){return completions},get aborts(){return aborts},get reads(){return reads},get providerDeletes(){return providerDeletes}};
}
test('authorization records permission before creating presigned URL',async()=>{const f=fixture();const result=await runtime.authorizeDirectPart(f.deps,f.state,1);assert.equal(result.completed,false);assert.ok(f.state.parts[0].authorizedAt);assert.ok(result.expiresAt);});
test('unknown part may not be acknowledged without recorded authorization',async()=>{const f=fixture();await assert.rejects(runtime.acknowledgeDirectPart(f.deps,f.state,{partNumber:1,sizeBytes:bytes.length,etag:'etag1'}),error=>error.code==='UPLOAD_PART_NOT_AUTHORIZED');assert.equal(f.state.receivedBytes,0n);});
test('ETag acknowledgment is committed once and idempotent on retry',async()=>{const f=fixture();await runtime.authorizeDirectPart(f.deps,f.state,1);
 const args={partNumber:1,sizeBytes:bytes.length,etag:'etag1'};
 assert.equal((await runtime.acknowledgeDirectPart(f.deps,f.state,args)).receivedBytes,bytes.length);
 assert.equal((await runtime.acknowledgeDirectPart(f.deps,f.state,args)).receivedBytes,bytes.length);
 assert.equal(f.state.parts.length,1);assert.equal(f.state.receivedBytes,BigInt(bytes.length));});
test('conflicting ETag refuses replacement of acknowledged part',async()=>{const f=fixture();await runtime.authorizeDirectPart(f.deps,f.state,1);await runtime.acknowledgeDirectPart(f.deps,f.state,{partNumber:1,sizeBytes:bytes.length,etag:'etag1'});
 await assert.rejects(runtime.acknowledgeDirectPart(f.deps,f.state,{partNumber:1,sizeBytes:bytes.length,etag:'etag2'}),e=>e.code==='UPLOAD_PART_CONFLICT');assert.equal(f.state.parts[0].etag,'etag1');});
test('paused session cannot authorize or acknowledge a part with stale supplied session',async()=>{const f=fixture();await runtime.authorizeDirectPart(f.deps,f.state,1);const stale={...f.state};await runtime.pauseUploadSession(f.deps,id,'actor');
 await assert.rejects(runtime.authorizeDirectPart(f.deps,stale,1),e=>e.code==='UPLOAD_STATE_INVALID');
 await assert.rejects(runtime.acknowledgeDirectPart(f.deps,stale,{partNumber:1,sizeBytes:bytes.length,etag:'etag1'}),e=>e.code==='UPLOAD_STATE_INVALID');});
test('whole multipart completion verifies provider bytes, commits exact checksum and idempotently retries',async()=>{const f=fixture({session:{...base(),parts:[stage()],receivedBytes:BigInt(bytes.length)}});
 const response=await runtime.completeUploadSession(f.deps,f.state,digest);assert.equal(response.checksumSha256,digest);assert.equal(f.state.status,'COMPLETED');
 assert.equal((await runtime.completeUploadSession(f.deps,f.state,digest)).checksumSha256,digest);assert.equal(f.completions,1);assert.equal(f.reads,1);});
test('finalization claim fences pause, cancellation, part acknowledgment and expiry cleanup',async()=>{const hold=barrier(),started=barrier();const f=fixture({session:{...base(),parts:[stage()],receivedBytes:BigInt(bytes.length),expiresAt:expired()},provider:{completeMultipartUpload:async()=>{started.release();await hold.promise;return {size:bytes.length}}}});
 const promise=runtime.completeUploadSession(f.deps,f.state,digest);await started.promise;assert.equal(f.state.status,'FINALIZING');
 await assert.rejects(runtime.pauseUploadSession(f.deps,id,'actor'),e=>e.code==='UPLOAD_STATE_INVALID');
 await assert.rejects(runtime.acknowledgeDirectPart(f.deps,f.state,{partNumber:1,sizeBytes:bytes.length,etag:'etag1'}),e=>e.code==='UPLOAD_STATE_INVALID');
 await assert.rejects(runtime.abortUploadSession(f.deps,id,'actor'),e=>e.code==='UPLOAD_STATE_INVALID');
 const scan=await runtime.pruneExpiredUploads(f.deps,1);assert.equal(scan.removed,0);assert.equal(f.deleted,false);
 hold.release();await promise;assert.equal(f.state.status,'COMPLETED');});
test('two concurrent completion requests permit only one external provider call',async()=>{const hold=barrier(),started=barrier();const f=fixture({session:{...base(),parts:[stage()]},provider:{completeMultipartUpload:async()=>{started.release();await hold.promise;return {size:bytes.length}}}});
 const first=runtime.completeUploadSession(f.deps,f.state,digest);await started.promise;
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state,digest),e=>e.code==='UPLOAD_STATE_INVALID');
 hold.release();await first;assert.equal(f.completions,1);});
test('provider response loss leaves FINALIZING without retrying external call',async()=>{const f=fixture({session:{...base(),parts:[stage()]},provider:{completeMultipartUpload:async()=>{throw Error('timeout after provider may have committed')}}});
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state),/timeout after provider/);
 assert.equal(f.state.status,'FINALIZING');assert.equal(f.completions,1);
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state),e=>e.code==='UPLOAD_STATE_INVALID');assert.equal(f.completions,1);});
test('missing contiguous part returns OPEN without touching provider',async()=>{const f=fixture({session:{...base(),parts:[]}});
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state),e=>e.code==='UPLOAD_PART_INVALID');assert.equal(f.completions,0);assert.equal(f.state.status,'OPEN');});
test('remote checksum mismatch journals and isolates REVIEW_REQUIRED bytes',async()=>{const f=fixture({session:{...base(),parts:[stage()]}});
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state,'0'.repeat(64)),e=>e.code==='UPLOAD_CHECKSUM_MISMATCH');
 assert.equal(f.state.status,'REVIEW_REQUIRED');assert.equal(f.deleted,false);assert.equal(evidence[0].reason,'checksum-mismatch');});
test('remote size mismatch journals and isolates REVIEW_REQUIRED bytes',async()=>{const f=fixture({session:{...base(),parts:[stage()]},provider:{completeMultipartUpload:async()=>({size:bytes.length-1})}});
 await assert.rejects(runtime.completeUploadSession(f.deps,f.state),e=>e.code==='UPLOAD_SIZE_MISMATCH');assert.equal(f.state.status,'REVIEW_REQUIRED');assert.equal(evidence[0].reason,'size-mismatch');});
test('expired multipart cleanup claims before provider abort and retains session if provider refuses',async()=>{const f=fixture({session:{...base(),expiresAt:expired()},provider:{abortMultipartUpload:async()=>{throw Error('provider offline')}}});
 await assert.rejects(runtime.pruneExpiredUploads(f.deps,1),/provider offline/);assert.equal(f.state.status,'CLEANING');assert.equal(f.deleted,false);
 assert.deepEqual(evidence,[]);assert.equal((await runtime.pruneExpiredUploads(f.deps,1)).removed,0);});
test('expired direct upload is not deleted when latest database record is no longer expired',async()=>{const f=fixture({session:{...base(),expiresAt:expired()}});
 // A findMany row can be stale; the authoritative reread must reject a new TTL.
 const original=f.deps.prisma.uploadSession.findMany;f.deps.prisma.uploadSession.findMany=async()=>[{...f.state,expiresAt:expired()}];
 f.state.expiresAt=tomorrow();assert.equal((await runtime.pruneExpiredUploads(f.deps,1)).removed,0);assert.equal(f.state.status,'OPEN');f.deps.prisma.uploadSession.findMany=original;});
test('expired multipart session cannot be deleted if Library transfer job still holds it',async()=>{const f=fixture({session:{...base(),status:'COMPLETED',expiresAt:expired()},job:true});
 const result=await runtime.pruneExpiredUploads(f.deps,1);assert.equal(result.protectedByJob,1);assert.equal(result.removed,0);});
test('successful expiry cleanup journals evidence and deletes only after provider abort',async()=>{const f=fixture({session:{...base(),expiresAt:expired()}});const result=await runtime.pruneExpiredUploads(f.deps,1);
 assert.equal(result.removed,1);assert.equal(f.deleted,true);assert.equal(f.aborts,1);assert.equal(evidence[0].reason,'expired');assert.equal(f.providerDeletes,0);});
test('explicit abort refuses finalization state and never aborts remote provider',async()=>{const f=fixture({session:{...base(),status:'FINALIZING'}});
 await assert.rejects(runtime.abortUploadSession(f.deps,id,'actor'),e=>e.code==='UPLOAD_STATE_INVALID');assert.equal(f.aborts,0);assert.equal(f.deleted,false);});
test('completed direct object consumption retains provider bytes and records evidence',async()=>{const f=fixture({session:{...base(),status:'COMPLETED',checksumSha256:digest}});
 await runtime.consumeCompletedUpload(f.deps,id);assert.equal(f.deleted,true);assert.equal(evidence[0].reason,'consumed');assert.equal(f.providerDeletes,0);assert.equal(f.aborts,0);});
test('non-completed direct session cannot be consumed',async()=>{const f=fixture();await assert.rejects(runtime.consumeCompletedUpload(f.deps,id),e=>e.code==='UPLOAD_STATE_INVALID');assert.equal(f.deleted,false);});
test('stale cleanup claim is rejected without provider side effects',async()=>{const f=fixture({session:{...base(),status:'PAUSED',expiresAt:expired()}});let swapped=false;
 const original=f.deps.prisma.uploadSession.updateMany;f.deps.prisma.uploadSession.updateMany=async args=>{
  if(!swapped){swapped=true;f.state.status='OPEN';return {count:0};}return original(args);
 };
 const r=await runtime.pruneExpiredUploads(f.deps,1);assert.equal(r.removed,0);assert.equal(f.aborts,0);assert.equal(f.deleted,false);});
test('client idempotency key cannot replace paused or quarantined content',async()=>{
 const f=fixture({session:{...base(),clientKey:'important-key',status:'REVIEW_REQUIRED'}});
 await assert.rejects(runtime.createUploadSession(f.deps,{ownerId:'actor',workspaceId:null,fileName:'content.bin',totalBytes:bytes.length,clientKey:'important-key'}),e=>e.code==='UPLOAD_SESSION_RECOVERY_REQUIRED');
 assert.equal(f.deleted,false);
});

test('completed upload cannot be cancelled while durable Library finalize owns it',async()=>{const f=fixture({session:{...base(),status:'COMPLETED',checksumSha256:digest},job:true});
 await assert.rejects(runtime.abortUploadSession(f.deps,id,'actor'),e=>e.code==='UPLOAD_TRANSFER_HELD');
 assert.equal(f.state.status,'COMPLETED');assert.equal(f.deleted,false);assert.equal(f.aborts,0);});
test('recovery sessions remain visible in capacity diagnostics after expiration',async()=>{
 const whereQueries=[];
 const count=async({where})=>{whereQueries.push(where);return where.status?.in?.includes('FINALIZING')?2:5};
 const deps={prisma:{uploadSession:{count,aggregate:async({where})=>{whereQueries.push(where);return {_sum:{totalBytes:32n,receivedBytes:12n}}},groupBy:async({where})=>{whereQueries.push(where);return []}}},
  storageRuntime:{directUploadTarget:()=>({provider:'s3'})},dataLayout:{runtimeRoot:'/tmp',root:'/tmp'}};
 const stats=await runtime.uploadPressureSnapshot(deps);
 assert.equal(stats.recoveryRequiredSessions,2);assert.equal(stats.sessions,5);assert.equal(stats.outstandingBytes,20);
 assert.ok(whereQueries[0].OR.some(block=>block.status?.in?.includes('REVIEW_REQUIRED')&&!block.expiresAt));
 assert.ok(whereQueries.at(-1).status.in.includes('CLEANING'));
});
test('quota admission counts expired provider reconciliation holds instead of admitting unlimited new bytes',async()=>{
 const quotaQueries=[];
 const tx={uploadCapacityLock:{upsert:async()=>({})},uploadSession:{
  count:async({where})=>{quotaQueries.push(where);return 8},
  aggregate:async()=>({_sum:{totalBytes:0n}}),
 }};
 const deps={prisma:{$transaction:async cb=>cb(tx),uploadSession:{findMany:async()=>[]}},
  storageRuntime:{directUploadTargetForBrowser:async()=>({target:{provider:'s3',tier:'temporary',key:'x'},capability:{state:'ready'}})},
  dataLayout:{runtimeRoot:'/tmp',root:'/tmp'}};
 await assert.rejects(runtime.createUploadSession(deps,{ownerId:'actor',workspaceId:null,fileName:'sample.bin',totalBytes:123}),e=>e.code==='RATE_LIMITED');
 assert.ok(quotaQueries[0].OR.some(block=>block.status?.in?.includes('FINALIZING')&&!block.expiresAt));
});

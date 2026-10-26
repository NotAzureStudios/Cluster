/** TD5 P5: real filesystem journal and actual upload-runtime function tests. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, link, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const root=path.resolve(import.meta.dirname,'../..');
const journalSource=path.join(root,'apps/server/src/domains/uploads/deferred-direct-upload-journal.ts');
const runtimeSource=path.join(root,'apps/server/src/domains/uploads/upload-session-runtime.ts');
const compile=(src,file)=>ts.transpileModule(src,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
function guards(){
 const file=path.join(root,'apps/server/src/core/storage/local-storage-provider.ts');const mod={exports:{}};
 vm.runInNewContext(compile(readFileSync(file,'utf8'),file),{
  module:mod,exports:mod.exports,process,Buffer,Promise,Error,
  require(id){if(id==='../operation-cancellation.js')return {throwIfAborted(){}};if(id.startsWith('node:'))return require(id);throw Error(`Unexpected guard import: ${id}`)},
 },{filename:file});return mod.exports;
}
const directoryGuards=guards();
function journal(overrides={}){
 const mod={exports:{}};
 vm.runInNewContext(compile(readFileSync(journalSource,'utf8'),journalSource),{
  module:mod,exports:mod.exports,process,Buffer,Promise,Date,Error,
  require(id){if(id==='../../core/storage/local-storage-provider.js')return directoryGuards;
   if(id==='node:fs/promises')return {...require(id),...overrides};if(id.startsWith('node:'))return require(id);
   throw Error(`Unexpected journal import: ${id}`);
  },
 },{filename:journalSource});return mod.exports;
}
const realJournal=journal();
const UPLOAD_ID='a3c1c9ae-53f4-4f74-8f6a-33210200beef';
const sample=(patch={})=>({id:UPLOAD_ID,mode:'direct',status:'COMPLETED',storageProvider:'object',storageTier:'temporary',
 storageKey:`uploads/unscoped/${UPLOAD_ID}/file.bin`,checksumSha256:'a'.repeat(64),totalBytes:12n,...patch});
const fixture=async()=>{const dir=await mkdtemp(path.join(tmpdir(),'cluster-td5-p5-'));return {dir,cleanup:()=>rm(dir,{recursive:true,force:true})}};
const lines=async dir=>(await readFile(path.join(dir,realJournal.DEFERRED_DIRECT_UPLOAD_JOURNAL),'utf8')).trim().split('\n').map(JSON.parse);
const record=(dir,session=sample(),reason='consumed',impl=realJournal)=>impl.recordDeferredDirectUpload({dataRoot:dir,session,reason});
test('consumed direct upload records durable evidence without remote deletion authority',async()=>{
 const {dir,cleanup}=await fixture();try{assert.equal(await record(dir),true);const [entry]=await lines(dir);
 assert.equal(entry.uploadId,UPLOAD_ID);assert.equal(entry.reason,'consumed');assert.equal(entry.provider,'object');
 assert.equal(entry.outcome,'remote-bytes-retained; deletion-not-authorized');assert.equal(entry.sizeBytes,12);
 }finally{await cleanup()}
});
test('independent journal append retains both cleanup reasons',async()=>{
 const {dir,cleanup}=await fixture();try{await record(dir);await record(dir,sample(),'expired');assert.deepEqual((await lines(dir)).map(v=>v.reason),['consumed','expired'])}finally{await cleanup()}
});
test('Cluster-proxied staging does not produce remote cleanup evidence',async()=>{
 const {dir,cleanup}=await fixture();try{assert.equal(await record(dir,sample({mode:'cluster'})),false);assert.deepEqual(await readdir(dir),[])}finally{await cleanup()}
});
test('unsafe or cross-session keys block retirement before journal publication',async()=>{
 const {dir,cleanup}=await fixture();try{
  for(const key of [`uploads/unscoped/${UPLOAD_ID}/../../secret`, `uploads/unscoped/00000000-0000-0000-0000-000000000000/file.bin`, `../uploads/${UPLOAD_ID}/x`, `uploads/unscoped/${UPLOAD_ID}/x\\test`]){
   await assert.rejects(record(dir,sample({storageKey:key})),/ownership pointer/);
  }
  await assert.rejects(record(dir,sample({storageTier:'standard'})),/ownership pointer/);
  await assert.rejects(record(dir,sample({storageProvider:'../remote'})),/ownership pointer/);
  assert.deepEqual(await readdir(dir),[]);
 }finally{await cleanup()}
});
test('symlinked journal and hardlinked journal cannot be written',async()=>{
 const {dir,cleanup}=await fixture();try{
  const target=path.join(dir,'outside');await writeFile(target,'preserve');const jp=path.join(dir,realJournal.DEFERRED_DIRECT_UPLOAD_JOURNAL);
  await symlink(target,jp);await assert.rejects(record(dir));assert.equal(await readFile(target,'utf8'),'preserve');await rm(jp);
  await link(target,jp);await assert.rejects(record(dir),/exclusive regular file/);assert.equal(await readFile(target,'utf8'),'preserve');
 }finally{await cleanup()}
});
test('symlinked parent and broken journal writer fail closed',async()=>{
 const {dir,cleanup}=await fixture();try{
  const target=path.join(dir,'storage');await mkdir(target);const alias=path.join(dir,'alias');await symlink(target,alias);
  await assert.rejects(record(alias),/symbolic-link|junction/);
  const bad=journal({open:async(file,...args)=>String(file).endsWith(realJournal.DEFERRED_DIRECT_UPLOAD_JOURNAL)
   ? {stat:async()=>({isFile:()=>true,nlink:1}),write:async()=>{throw Error('EIO on append')},close:async()=>{}}
   : require('node:fs/promises').open(file,...args)});
  await assert.rejects(record(dir,sample(),'consumed',bad),/EIO on append/);
 }finally{await cleanup()}
});
function loadRuntime(depsJournal=realJournal){
 const mod={exports:{}};
 vm.runInNewContext(compile(readFileSync(runtimeSource,'utf8'),runtimeSource),{
  module:mod,exports:mod.exports,process,Buffer,Promise,Date,Error,Number,BigInt,Set,Math,setTimeout,clearTimeout,
  require(id){if(id==='./deferred-direct-upload-journal.js')return depsJournal;
   if(id==='../../core/uploads.js')return {safeFileName:v=>v};
   if(id==='../../core/efficiency-metrics.js')return {recordEfficiencyMetric:async()=>{}};
   if(id.startsWith('node:'))return require(id);throw Error(`Unexpected upload runtime import ${id}`);
  }
 },{filename:runtimeSource});return mod.exports;
}
const runtime=loadRuntime();
function db(session){const state={session,deleted:0,updates:[]};return {state,client:{uploadSession:{findUnique:async()=>state.session,
 delete:async()=>{state.deleted++;return state.session},update:async({data})=>{state.updates.push(data);state.session={...state.session,...data};return state.session},
 findMany:async()=>[state.session],
 updateMany:async({where,data})=>{if(!state.session||Object.entries(where).some(([k,v])=>k!=='id'&&k!=='expiresAt'&&state.session[k]!==v))return {count:0};state.session={...state.session,...data};return {count:1}},
 deleteMany:async({where})=>{if(!state.session||where.status!==state.session.status)return {count:0};state.deleted++;state.session=null;return {count:1}},
 }, backgroundJob:{findMany:async()=>[]}}}}
test('consuming completed direct upload preserves provider bytes and journals before DB delete',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample());let remoteDeletes=0;
 await runtime.consumeCompletedUpload({dataLayout:{root:dir},prisma:client,storageRuntime:{delete:async()=>{remoteDeletes++}}},UPLOAD_ID);
 assert.equal(remoteDeletes,0);assert.equal(state.deleted,1);assert.equal((await lines(dir))[0].reason,'consumed');
 }finally{await cleanup()}
});
test('failed cleanup journal preserves session and prevents false-success consumption',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample());const bad=loadRuntime({recordDeferredDirectUpload:async()=>{throw Error('journal full')}});
 await assert.rejects(bad.consumeCompletedUpload({dataLayout:{root:dir},prisma:client,storageRuntime:{}},UPLOAD_ID),/journal full/);
 assert.equal(state.deleted,0);
 }finally{await cleanup()}
});
test('abort of completed direct upload keeps provider object and journals evidence',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample());let deletes=0;
 assert.equal(await runtime.abortUploadSession({dataLayout:{root:dir},prisma:client,storageRuntime:{delete:async()=>{deletes++}}},UPLOAD_ID,'actor',true),true);
 assert.equal(state.deleted,1);assert.equal(deletes,0);assert.equal((await lines(dir))[0].reason,'aborted');
 }finally{await cleanup()}
});
test('expired completed direct upload journals before deleting database session',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample({expiresAt:new Date(Date.now()-360000)}));let deletes=0;
 const result=await runtime.pruneExpiredUploads({dataLayout:{root:dir},prisma:client,storageRuntime:{delete:async()=>{deletes++}}},1);
 assert.equal(result.removed,1);assert.equal(state.deleted,1);assert.equal(deletes,0);assert.equal((await lines(dir))[0].reason,'expired');
 }finally{await cleanup()}
});
test('direct upload checksum mismatch is non-destructive and retained for governance',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db({...sample({status:'OPEN',checksumSha256:null}),totalBytes:12n,
 multipartUploadId:'upload',partSize:12,parts:[{partNumber:1,etag:'part',sizeBytes:12,completedAt:new Date()}]});let deletes=0;
 const deps={dataLayout:{root:dir},prisma:client,storageRuntime:{completeMultipartUpload:async()=>({size:12}),openRead:async()=>require('node:stream').Readable.from(['remote bytes!']),delete:async()=>{deletes++}}};
 await assert.rejects(runtime.completeUploadSession(deps,state.session,'0'.repeat(64)),/checksum mismatch/i);
 assert.equal(deletes,0);assert.equal((await lines(dir))[0].reason,'checksum-mismatch');assert.equal(state.session.status,'REVIEW_REQUIRED');
 }finally{await cleanup()}
});
test('direct upload size mismatch does not remove the completed multipart object',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db({...sample({status:'OPEN'}),multipartUploadId:'upload',partSize:12,
 parts:[{partNumber:1,etag:'part',sizeBytes:12,completedAt:new Date()}]});let deletes=0;
 await assert.rejects(runtime.completeUploadSession({dataLayout:{root:dir},prisma:client,storageRuntime:{completeMultipartUpload:async()=>({size:11}),delete:async()=>{deletes++}}},state.session),/size is wrong/);
 assert.equal(deletes,0);assert.equal((await lines(dir))[0].reason,'size-mismatch');
 }finally{await cleanup()}
});
test('runtime has no completed direct-object deletion calls',()=>{
 const source=readFileSync(runtimeSource,'utf8');assert.doesNotMatch(source,/storageRuntime\.delete\(/);
 assert.match(source,/disposeClaimedUpload\(deps, fresh, "expired"\)/);
 assert.match(source,/disposeClaimedUpload\(deps, fresh, "consumed"\)/);
});
test('failed journal prevents direct-upload abort from deleting the session',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample());let deleted=0;
 const blocked=loadRuntime({recordDeferredDirectUpload:async()=>{throw Error('evidence disk unavailable')}});
 await assert.rejects(blocked.abortUploadSession({dataLayout:{root:dir},prisma:client,storageRuntime:{delete:async()=>{deleted++}}},UPLOAD_ID,'actor',true),/evidence disk unavailable/);
 assert.equal(state.deleted,0);assert.equal(deleted,0);
 }finally{await cleanup()}
});
test('failed journal prevents expired direct-upload pruning',async()=>{
 const {dir,cleanup}=await fixture();try{const {state,client}=db(sample({expiresAt:new Date(Date.now()-360000)}));
 const blocked=loadRuntime({recordDeferredDirectUpload:async()=>{throw Error('evidence disk unavailable')}});
 await assert.rejects(blocked.pruneExpiredUploads({dataLayout:{root:dir},prisma:client,storageRuntime:{}},1),/evidence disk unavailable/);
 assert.equal(state.deleted,0);
 }finally{await cleanup()}
});
test('idempotency key cannot replace retained/recovery session evidence',()=>{
 const source=readFileSync(runtimeSource,'utf8');
 const replaced=source.slice(source.indexOf('if (clientKey) {'),source.indexOf('  const id = randomUUID();'));
 assert.match(replaced,/UPLOAD_SESSION_RECOVERY_REQUIRED/);assert.doesNotMatch(replaced,/uploadSession\.delete/);
});

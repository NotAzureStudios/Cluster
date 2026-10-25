/** R68 executable source-level tests; no live NAS/S3 or PostgreSQL certification. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const root=path.resolve(import.meta.dirname,'../..');
function load(relative, dependencies={}) {
 const name=path.join(root,relative);
 const compiled=ts.transpileModule(readFileSync(name,'utf8'),{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 const mod={exports:{}};
 vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require:(id)=>{
   if(Object.hasOwn(dependencies,id))return dependencies[id];
   if(id.startsWith('node:'))return require(id);
   throw Error(`Undeclared module ${id} in ${relative}`);
 },Promise,Set,Map,Date,Number,String,Boolean,Object,Error,RegExp,Math,Buffer,console,process,AbortController},{filename:name});
 return mod.exports;
}
const {inspectProviderDispositionSafety}=load('apps/server/src/core/storage/storage-disposition-safety.ts');
const {requireS3WriteSuccess}=load('apps/server/src/core/storage/s3-write-response.ts');
let count=0;
async function test(name,fn){await fn(); count++; console.log('PASS',name)}
const capabilities={objectStorage:false};
await test('local provider never claims a physical disposal capability',()=>{
 const x=inspectProviderDispositionSafety({id:'local',kind:'filesystem',capabilities});
 assert.equal(x.mode,'INSPECTION_ONLY');assert.equal(x.safePhysicalDelete,false);
 for(const key of ['generationIdentity','compareAndSwapMutation','atomicQuarantine','verifiedRestore','backupRetention','digestVerification'])assert.notEqual(x[key].state,'verified');
});
await test('SMB/shared-file providers are not inferred as atomic safe',()=>{
 const x=inspectProviderDispositionSafety({id:'shared',kind:'shared-filesystem',capabilities});
 assert.equal(x.compareAndSwapMutation.state,'unsupported');assert.equal(x.atomicQuarantine.state,'unsupported');
});
await test('S3 multipart support is not a generation-fenced deletion permit',()=>{
 const x=inspectProviderDispositionSafety({id:'object',kind:'s3-compatible',capabilities:{objectStorage:true,multipartUploads:true}});
 assert.equal(x.backupRetention.state,'unverified');assert.equal(x.generationIdentity.state,'unverified');assert.equal(x.safePhysicalDelete,false);
});
const xml=(text)=>Readable.from([Buffer.from(text)]);
for(const operation of ['CopyObject','CompleteMultipartUpload']){
 const success=operation==='CopyObject'?'CopyObjectResult':'CompleteMultipartUploadResult';
 await test(`${operation} accepts explicit success XML and ETag`,async()=>{
  await requireS3WriteSuccess(xml(`<${success}><ETag>abc</ETag></${success}>`),operation);
 });
 await test(`${operation} rejects HTTP-200 embedded errors`,async()=>{
  await assert.rejects(requireS3WriteSuccess(xml('<Error><Code>InternalError</Code></Error>'),operation),/embedded error/);
 });
 await test(`${operation} rejects empty or truncated success bodies`,async()=>{
  await assert.rejects(requireS3WriteSuccess(xml('<html>unexpected response</html>'),operation),/verified success/);
 });
 await test(`${operation} rejects response without ETag`,async()=>{
  await assert.rejects(requireS3WriteSuccess(xml(`<${success}><VersionId>some-id</VersionId></${success}>`),operation),/verified success/);
 });
 await test(`${operation} rejects oversized responses`,async()=>{
  await assert.rejects(requireS3WriteSuccess(xml('x'.repeat(70_000)),operation),/safety limit/);
 });
}
await test('S3 parser does not confuse copy response with multipart success',async()=>{
 await assert.rejects(requireS3WriteSuccess(xml('<CopyObjectResult><ETag>abc</ETag></CopyObjectResult>'),'CompleteMultipartUpload'),/verified success/);
});
class LocalMock {
 constructor(_root,options){this.id=options.id;this.kind=options.kind;this.durable=true;this.sharedAcrossNodes=!!options.sharedAcrossNodes;this.capabilities={objectStorage:false};}
 async health(){return{ok:true}}
}
const {ClusterStorageRuntime}=load('apps/server/src/core/storage/storage-runtime.ts',{
 './local-storage-provider.js':{LocalStorageProvider:LocalMock},
 './s3-storage-provider.js':{S3StorageProvider:class{}},
 './storage-policy.js':{chooseStorageTier:()=> 'hot'},
 './storage-disposition-safety.js':{inspectProviderDispositionSafety},
});
const storage=new ClusterStorageRuntime({dataRoot:'/temp/fake-r68'});
const source={provider:'src',tier:'temporary',key:'key'},destination={provider:'dst',tier:'hot',key:'key'};
const events={deletes:0,puts:0};
storage.providers.set('src',{id:'src',stat:async()=>({size:3}),openRead:async()=>Readable.from(['abc'])});
storage.providers.set('dst',{id:'dst',putStream:async()=>{events.puts++;throw Error('network aborted')},delete:async()=>{events.deletes++}});
await test('failed cross-provider copy never deletes ambiguous target',async()=>{
 await assert.rejects(storage.copy(source,destination),/network aborted/);
 assert.equal(events.puts,1);assert.equal(events.deletes,0);
});
await test('direct tier promotion is explicitly disabled',async()=>{
 await assert.rejects(storage.copyToTier(source,'archive'),/disabled pending provider generation fencing/);
 assert.equal(events.deletes,0);
});
await test('storage health snapshot exposes gates and provider-specific risk',async()=>{
 const snapshot=await new ClusterStorageRuntime({dataRoot:'/temp/fake-r68'}).snapshot();
 assert.equal(snapshot.automaticTierMigration,false);
 assert.equal(snapshot.physicalManagedBlobGC,false);
 assert.equal(snapshot.physicalLibraryDisposal,false);
 assert.equal(snapshot.providers[0].dispositionSafety.safePhysicalDelete,false);
});
await test('managed-blob preparation and failed-create cleanup never unlink shared bytes',()=>{
 const content=readFileSync(path.join(root,'apps/server/src/app/server-services-request-domain.ts'),'utf8');
 const functions=content.slice(content.indexOf('  async function discardStoredProjectFile('),content.indexOf('  async function resolveAvatarStoredFile('));
 assert.ok(!functions.includes('storageRuntime.delete('));
 const repair=content.slice(content.indexOf('      if (existingBlob) {'),content.indexOf('      } else {\n        const copied',content.indexOf('      if (existingBlob) {')));
 assert.ok(repair.includes('gcState: "CORRUPT"'));
 assert.ok(!repair.includes('storageRuntime.delete('));
 assert.ok(!repair.includes('storageRuntime.copy('));
});
await test('upload staging cleanup remains separate from unfenced completed-object deletion',()=>{
 const content=readFileSync(path.join(root,'apps/server/src/domains/uploads/upload-session-runtime.ts'),'utf8');
 assert.ok(content.includes('deps.storageRuntime.abortMultipartUpload(storage, session.multipartUploadId)'));
 assert.ok(content.includes('rm(localSessionDirectory(deps.dataLayout, session.id), { recursive: true, force: true })'));
 assert.ok(content.includes('deferDirectUpload(deps, session, "expired")'));
 assert.ok(!content.includes('deps.storageRuntime.delete(storage)'));
});
await test('S3 copy and multipart completion validate XML before stat success',()=>{
 const content=readFileSync(path.join(root,'apps/server/src/core/storage/s3-storage-provider.ts'),'utf8');
 assert.ok(content.includes('requireS3WriteSuccess(response, "CopyObject")'));
 assert.ok(content.includes('requireS3WriteSuccess(response, "CompleteMultipartUpload")'));
});
console.log(`R68 provider and storage safety ${count}/${count}`);

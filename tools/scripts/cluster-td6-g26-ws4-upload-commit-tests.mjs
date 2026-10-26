/** G26 WS4: controlled Prisma-shaped state with real staged filesystem bytes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, open, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const root=path.resolve(import.meta.dirname,'../..');
const sourceFile=path.join(root,'apps/server/src/domains/uploads/upload-session-runtime.ts');
const source=readFileSync(sourceFile,'utf8');
const compile=(file)=>ts.transpileModule(file,{fileName:sourceFile,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
function loadRuntime(fsOverrides={}){
 const mod={exports:{}};
 vm.runInNewContext(compile(source),{module:mod,exports:mod.exports,process,Buffer,Promise,Date,Error,Number,BigInt,Set,Math,
  require(id){if(id==='../../core/uploads.js')return {safeFileName:x=>x};
   if(id==='../../core/efficiency-metrics.js')return {recordEfficiencyMetric:async()=>{}};
   if(id==='./deferred-direct-upload-journal.js')return {recordDeferredDirectUpload:async()=>true};
   if(id==='node:fs/promises')return {...require(id),...fsOverrides};
   if(id.startsWith('node:'))return require(id);
   throw new Error('unexpected import '+id);
  }
 },{filename:sourceFile});return mod.exports;
}
const runtime=loadRuntime();
const id='c65c26ca-4681-4e44-98b3-9922c46c8dde';
const digest=data=>createHash('sha256').update(data).digest('hex');
async function fixture({bytes='',offset=null,state='OPEN',dbFail=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'cluster-g26-ws4-'));
 const staging=path.join(directory,'uploads',id);
 await mkdir(staging,{recursive:true});
 const file=path.join(staging,'payload.cluster-part');
 await writeFile(file,bytes);
 const total=Buffer.byteLength(bytes)>20?Buffer.byteLength(bytes):24;
 let session={id,ownerId:'actor',status:state,mode:'cluster',fileName:'sample.bin',totalBytes:BigInt(total),receivedBytes:BigInt(offset??Buffer.byteLength(bytes)),createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+86400000)};
 let updates=0,fail=dbFail,deleted=0;
 const db={uploadSession:{
  findUnique:async()=>deleted?null:session,
  updateMany:async({where,data})=>{
   updates++;
   if(fail){fail=false;throw Error('simulated database outage');}
   if(deleted||Object.entries(where).some(([key,value])=>key!=='id'&&session[key]!==value))return {count:0};
   session={...session,...data};return {count:1};
  },
  update:async({where,data})=>{
   if(deleted||where.status&&where.status!==session.status){const e=Error('missing');e.code='P2025';throw e;}
   session={...session,...data};return session;
  },
  delete:async({where})=>{if(deleted||where.status&&where.status!==session.status){const e=Error('missing');e.code='P2025';throw e;}deleted++;return session;},
  deleteMany:async({where})=>{if(deleted||where.status!==session.status)return {count:0};deleted++;return {count:1};},
 }};
 const deps={prisma:db,storageRuntime:{},dataLayout:{runtimeRoot:directory,root:directory}};
 return {deps,file,staging,directory,get session(){return session},get updates(){return updates},get deleted(){return deleted},cleanup:()=>rm(directory,{force:true,recursive:true})};
}
async function use(input,fn){const f=await fixture(input);try{await fn(f);}finally{await f.cleanup()}}
const payload=Buffer.from('12345');
test('success: durable chunk advances only committed offset',async()=>use({bytes:'',offset:0},async f=>{
 const result=await runtime.appendClusterChunk(f.deps,f.session,{start:0,end:4,total:24,body:payload});
 assert.equal(result.receivedBytes,5);assert.equal(Number(f.session.receivedBytes),5);assert.equal(await readFile(f.file,'utf8'),'12345');
 assert.equal(f.updates,1);assert.deepEqual(await readdir(f.staging),['payload.cluster-part']);
}));
test('crash tail is removed before next chunk and committed bytes remain intact',async()=>use({bytes:'abcdefOLD',offset:6},async f=>{
 const result=await runtime.appendClusterChunk(f.deps,f.session,{start:6,end:10,total:24,body:payload});
 assert.equal(result.receivedBytes,11);assert.equal(await readFile(f.file,'utf8'),'abcdef12345');
}));
test('staged bytes shorter than durable cursor cannot be silently advanced',async()=>use({bytes:'xyz',offset:6},async f=>{
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:6,end:10,total:24,body:payload}),/shorter than its committed offset/);
 assert.equal(f.updates,0);assert.equal(await readFile(f.file,'utf8'),'xyz');
}));
test('failed cursor commit rolls speculative bytes back',async()=>use({bytes:'abcd',offset:4,dbFail:true},async f=>{
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:4,end:8,total:24,body:payload}),/database outage/);
 assert.equal(await readFile(f.file,'utf8'),'abcd');assert.equal(f.session.receivedBytes,4n);
}));
test('stale cursor is a conflict and never writes bytes',async()=>use({bytes:'abcd',offset:4},async f=>{
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:3,end:7,total:24,body:payload}),error=>error.code==='UPLOAD_OFFSET_CONFLICT'&&error.receivedBytes===4);
 assert.equal(await readFile(f.file,'utf8'),'abcd');
}));
test('gaps, imprecise ranges and oversized chunks fail before mutation',async()=>use({bytes:'abcd',offset:4},async f=>{
 for(const request of [{start:4,end:20,total:24,body:payload},{start:4,end:8,total:25,body:payload},{start:4.5,end:8.5,total:24,body:payload},{start:4,end:8,total:24,body:Buffer.alloc(8*1024*1024+1)}]){
  await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,request),error=>error.code==='UPLOAD_RANGE_INVALID');
 }
 assert.equal(await readFile(f.file,'utf8'),'abcd');
}));
test('partial FileHandle.write is retried until all bytes have reached staging',async()=>{
 let writes=0,syncs=0;
 const wrapped=loadRuntime({open:async(...args)=>{
  const handle=await open(...args);
  if(args[1]==='r+')return new Proxy(handle,{get(target,prop){
   if(prop==='write')return async(buffer,offset,length,position)=>{writes++;return target.write(buffer,offset,Math.max(1,Math.floor(length/2)),position)};
   if(prop==='sync')return async()=>{syncs++;return target.sync()};
   const value=target[prop];return typeof value==='function'?value.bind(target):value;
  }});
  return handle;
 }});
 await use({bytes:'',offset:0},async f=>{
  await wrapped.appendClusterChunk(f.deps,f.session,{start:0,end:4,total:24,body:payload});
  assert.equal(await readFile(f.file,'utf8'),'12345');assert.ok(writes>1);assert.ok(syncs>=1);
 });
});
test('completion rejects incomplete transfer, does not rename staging',async()=>use({bytes:'abcd',offset:4},async f=>{
 await assert.rejects(runtime.completeUploadSession(f.deps,f.session),error=>error.code==='UPLOAD_INCOMPLETE');
 assert.equal(await readFile(f.file,'utf8'),'abcd');assert.equal(f.updates,0);
}));
test('completion verifies checksum, persists status, then exposes finished file',async()=>use({bytes:'abcdefghijklmnopqrstuvwx',offset:24},async f=>{
 const result=await runtime.completeUploadSession(f.deps,f.session,digest('abcdefghijklmnopqrstuvwx'));
 assert.equal(result.checksumSha256,digest('abcdefghijklmnopqrstuvwx'));assert.equal(f.session.status,'COMPLETED');
 assert.equal(await readFile(path.join(f.staging,'sample.bin'),'utf8'),'abcdefghijklmnopqrstuvwx');
 await assert.rejects(stat(f.file),error=>error.code==='ENOENT');
 const retry=await runtime.completeUploadSession(f.deps,f.session,digest('abcdefghijklmnopqrstuvwx'));
 assert.equal(retry.checksumSha256,result.checksumSha256);assert.equal(f.updates,1);
}));
test('checksum mismatch never commits or renames',async()=>use({bytes:'abcdefghijklmnopqrstuvwx',offset:24},async f=>{
 await assert.rejects(runtime.completeUploadSession(f.deps,f.session,'f'.repeat(64)),error=>error.code==='UPLOAD_CHECKSUM_MISMATCH');
 assert.equal(f.session.status,'OPEN');assert.equal(await readFile(f.file,'utf8'),'abcdefghijklmnopqrstuvwx');
}));
test('failed database finalization restores source staging and leaves OPEN',async()=>use({bytes:'abcdefghijklmnopqrstuvwx',offset:24,dbFail:true},async f=>{
 await assert.rejects(runtime.completeUploadSession(f.deps,f.session),/database outage/);
 assert.equal(f.session.status,'OPEN');assert.equal(await readFile(f.file,'utf8'),'abcdefghijklmnopqrstuvwx');
 await assert.rejects(stat(path.join(f.staging,'sample.bin')),error=>error.code==='ENOENT');
}));
test('pause, resume and cancel do not proceed while a local mutation owns lock',async()=>use({bytes:'abcd',offset:4},async f=>{
 await mkdir(path.join(f.staging,'.mutation-lock'));
 await assert.rejects(runtime.pauseUploadSession(f.deps,id,'actor'),error=>error.code==='UPLOAD_BUSY');
 await assert.rejects(runtime.resumeUploadSession(f.deps,id,'actor'),error=>error.code==='UPLOAD_BUSY');
 await assert.rejects(runtime.completeUploadSession(f.deps,f.session),error=>error.code==='UPLOAD_BUSY');
 await assert.rejects(runtime.abortUploadSession(f.deps,id,'actor'),error=>error.code==='UPLOAD_BUSY');
 assert.equal(f.deleted,0);assert.equal(await readFile(f.file,'utf8'),'abcd');
}));
test('stale filesystem lock is never stolen just because a checksum is slow',async()=>use({bytes:'abcd',offset:4},async f=>{
 const lock=path.join(f.staging,'.mutation-lock');await mkdir(lock);
 const old=new Date(Date.now()-900000);const handle=await open(lock,'r');await handle.close();
 const fs=await import('node:fs/promises');await fs.utimes(lock,old,old);
 await assert.rejects(runtime.pauseUploadSession(f.deps,id,'actor'),error=>error.code==='UPLOAD_LOCK_RECOVERY_REQUIRED');
 assert.equal(f.session.status,'OPEN');
}));
test('pause and resume update state only under owned lock',async()=>use({bytes:'abcd',offset:4},async f=>{
 const paused=await runtime.pauseUploadSession(f.deps,id,'actor');assert.equal(paused.status,'PAUSED');
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:4,end:8,total:24,body:payload}),error=>error.code==='UPLOAD_STATE_INVALID');
 const resumed=await runtime.resumeUploadSession(f.deps,id,'actor');assert.equal(resumed.status,'OPEN');
 assert.equal((await readdir(f.staging)).includes('.mutation-lock'),false);
}));
test('unauthorized account cannot pause or delete a transfer',async()=>use({bytes:'abcd',offset:4},async f=>{
 assert.equal(await runtime.pauseUploadSession(f.deps,id,'other'),null);
 assert.equal(await runtime.abortUploadSession(f.deps,id,'other'),false);
 assert.equal(f.deleted,0);
}));
test('cancel deletes row then local bytes, only with valid ownership',async()=>use({bytes:'abcd',offset:4},async f=>{
 assert.equal(await runtime.abortUploadSession(f.deps,id,'actor'),true);
 assert.equal(f.deleted,1);await assert.rejects(stat(f.staging),e=>e.code==='ENOENT');
}));
test('direct already-complete retry rejects different asserted digest',async()=>{
 const direct=loadRuntime();const session={id,status:'COMPLETED',mode:'direct',checksumSha256:'a'.repeat(64),fileName:'sample.bin',totalBytes:10n};
 await assert.rejects(direct.completeUploadSession({prisma:{uploadSession:{findUnique:async()=>session}}},session,'b'.repeat(64)),e=>e.code==='UPLOAD_CHECKSUM_MISMATCH');
});
test('direct multipart missing index is rejected even when parts and byte totals seem complete',async()=>{
 const direct=loadRuntime();
 const session={id,status:'OPEN',mode:'direct',fileName:'s.bin',totalBytes:12n,partSize:6,multipartUploadId:'remote',storageProvider:'object',storageTier:'temporary',storageKey:'s',parts:[{partNumber:1,etag:'x',sizeBytes:6,completedAt:new Date()},{partNumber:3,etag:'y',sizeBytes:6,completedAt:new Date()}]};
 const deps={prisma:{uploadSession:{findUnique:async()=>session,updateMany:async({where,data})=>{if(session.status!==where.status)return {count:0};Object.assign(session,data);return {count:1}}}},storageRuntime:{completeMultipartUpload:async()=>{throw Error('must not complete')}}};
 await assert.rejects(direct.completeUploadSession(deps,session),e=>e.code==='UPLOAD_PART_INVALID');
});

test('local staging refuses symlinked payload even when byte lengths match',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const outside=path.join(f.directory,'outside');await writeFile(outside,'abcdefgh');await rm(f.file);await symlink(outside,f.file);
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:8,end:12,total:24,body:payload}),error=>error.code==='UPLOAD_STAGING_UNSAFE');
 assert.equal(await readFile(outside,'utf8'),'abcdefgh');
}));
test('local staging refuses hardlink alias and leaves external file intact',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const outside=path.join(f.directory,'outside');await writeFile(outside,'abcdefgh');await rm(f.file);await link(outside,f.file);
 await assert.rejects(runtime.appendClusterChunk(f.deps,f.session,{start:8,end:12,total:24,body:payload}),error=>error.code==='UPLOAD_STAGING_UNSAFE');
 assert.equal(await readFile(outside,'utf8'),'abcdefgh');
}));
test('verified local staging copy streams bytes into Library destination',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const destination=path.join(f.directory,'library','stored.bin');
 const upload={metadata:{id,totalBytes:8,checksumSha256:digest('abcdefgh')},filePath:f.file,storage:null};
 await runtime.copyCompletedUploadToFile(f.deps,upload,destination);
 assert.equal(await readFile(destination,'utf8'),'abcdefgh');
}));
test('same-size source corruption is not accepted by Library storage copy',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const destination=path.join(f.directory,'library','stored.bin');
 const upload={metadata:{id,totalBytes:8,checksumSha256:digest('abcdwxyz')},filePath:f.file,storage:null};
 await assert.rejects(runtime.copyCompletedUploadToFile(f.deps,upload,destination),error=>error.code==='UPLOAD_COPY_INVALID');
 await assert.rejects(stat(destination),e=>e.code==='ENOENT');
}));
test('failure before creating a destination never destroys preexisting Library bytes',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const destination=path.join(f.directory,'library','existing.bin');
 await mkdir(path.dirname(destination));await writeFile(destination,'KEEP ME');
 const upload={metadata:{id,totalBytes:8,checksumSha256:digest('abcdefgh')},filePath:f.file,storage:null};
 await assert.rejects(runtime.copyCompletedUploadToFile(f.deps,upload,destination),error=>error.code==='EEXIST');
 assert.equal(await readFile(destination,'utf8'),'KEEP ME');
}));
test('remote streaming error cleans up partial staged Library destination',async()=>use({bytes:'',offset:0},async f=>{
 const destination=path.join(f.directory,'library','remote.bin');
 const {Readable}=await import('node:stream');
 async function* stream(){yield Buffer.from('half');throw Error('remote stream dropped');}
 const deps={...f.deps,storageRuntime:{openRead:async()=>Readable.from(stream())}};
 const upload={metadata:{id,totalBytes:8,checksumSha256:digest('abcdefgh')},filePath:null,storage:{provider:'remote',key:'obj',tier:'temporary'}};
 await assert.rejects(runtime.copyCompletedUploadToFile(deps,upload,destination),/remote stream dropped/);
 await assert.rejects(stat(destination),e=>e.code==='ENOENT');
}));
test('completed upload lookup rejects unsafe symlinked local source',async()=>use({bytes:'abcdefgh',offset:8},async f=>{
 const completed=path.join(f.staging,'sample.bin');
 await rm(f.file);const outside=path.join(f.directory,'external');await writeFile(outside,'abcdefgh');await symlink(outside,completed);
 f.session.status='COMPLETED';f.session.checksumSha256=digest('abcdefgh');f.session.totalBytes=8n;
 assert.equal(await runtime.resolveCompletedUpload(f.deps,id,'actor'),null);
 assert.equal(await readFile(outside,'utf8'),'abcdefgh');
}));

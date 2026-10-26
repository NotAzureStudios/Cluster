/** G26 WS4: execute the renderer's upload transport using controlled HTTP responses. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript/lib/typescript.js`)}})();
const root=path.resolve(import.meta.dirname,'../..');
const sourceFile=path.join(root,'packages/renderer/src/core/api/upload-session-transport.ts');
const code=readFileSync(sourceFile,'utf8');
const queueCode=readFileSync(path.join(root,'packages/renderer/src/core/api/uploads.ts'),'utf8');
const compile=ts.transpileModule(code,{fileName:sourceFile,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
class ApiError extends Error {constructor(message,status,payload,requestId,code){super(message);Object.assign(this,{status,payload,requestId,code});}}
const file=new Blob([Buffer.from('sample upload bytes')]);
function load(transport){
 const calls=[];const mod={exports:{}};
 const api=async(path,opts)=>{calls.push({path,method:opts.method||'GET'});return transport(path,opts)};
 vm.runInNewContext(compile,{module:mod,exports:mod.exports,Headers,Blob,console,Date,Math,Number,
  require(id){if(id==='./transport')return {api};if(id==='./errors')return {ApiError};
   if(id==='./mutation-cache')return {invalidateMutationCache(){}};
   if(id==='./mutation-support')return {invalidateMutationQueries(){}};
   throw Error('Unexpected dependency: '+id);
  }
 },{filename:sourceFile});return {api:mod.exports,calls};
}
const upload={ok:true,upload:{id:'previous',fileName:'file.bin',totalBytes:file.size,receivedBytes:0,mode:'cluster',status:'OPEN'},transferMode:'cluster',chunkSize:256*1024};
const opts={method:'POST',file,fileName:'file.bin',body:{},headers:new Headers()};
test('mismatched resumable session is not destroyed or silently replaced',async()=>{
 const client=load(async path=>{if(path==='/api/uploads/previous')return {...upload,upload:{...upload.upload,fileName:'DIFFERENT.bin'}};throw Error('unexpected network path '+path)});
 await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',{...opts,uploadSessionId:'previous'}),e=>e.code==='UPLOAD_SESSION_CONTENT_CONFLICT');
 assert.deepEqual(client.calls.map(c=>c.method),['GET']);
});
test('paused server upload requires review without deleting staged bytes',async()=>{
 const client=load(async path=>{if(path==='/api/uploads/previous')return {...upload,upload:{...upload.upload,status:'PAUSED'}};throw Error('Unexpected '+path)});
 await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',{...opts,uploadSessionId:'previous'}),e=>e.code==='UPLOAD_STATE_INVALID');
 assert.equal(client.calls.filter(x=>x.method==='DELETE').length,0);
});
test('409 during chunk commit retains server session instead of deleting it',async()=>{
 const client=load(async path=>{
  if(path==='/api/uploads')return {ok:true,uploadId:'new-session',receivedBytes:0,chunkSize:4096,transferMode:'cluster'};
  if(path.endsWith('/chunks'))throw new ApiError('write race',409,null,null,'UPLOAD_OFFSET_CONFLICT');
  throw Error('Unexpected '+path);
 });
 const ids=[];
 await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',{...opts,onUploadSession:value=>ids.push(value.id)}),e=>e.code==='UPLOAD_OFFSET_CONFLICT');
 assert.deepEqual(ids,['new-session']);assert.equal(client.calls.filter(x=>x.method==='DELETE').length,0);
});
test('lost finalization acknowledgment retains staged content and ID',async()=>{
 const client=load(async path=>{
  if(path==='/api/uploads')return {ok:true,uploadId:'new-session',receivedBytes:0,chunkSize:4096,transferMode:'cluster'};
  if(path.endsWith('/chunks'))return {ok:true,receivedBytes:file.size};
  if(path.endsWith('/complete'))throw new ApiError('unavailable',503,null,null,'SERVICE_UNAVAILABLE');
  throw Error('Unexpected '+path);
 });
 const ids=[];
 await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',{...opts,onUploadSession:v=>ids.push(v.id)}),e=>e.status===503);
 assert.deepEqual(ids,['new-session']);assert.equal(client.calls.filter(x=>x.method==='DELETE').length,0);
});
test('downstream Library validation failure preserves completed upload for review',async()=>{
 const client=load(async path=>{
  if(path==='/api/uploads')return {ok:true,uploadId:'new-session',receivedBytes:0,chunkSize:4096,transferMode:'cluster'};
  if(path.endsWith('/chunks'))return {ok:true,receivedBytes:file.size};
  if(path.endsWith('/complete'))return {ok:true,uploadId:'new-session',sizeBytes:file.size,checksumSha256:'a'.repeat(64)};
  if(path==='/api/library/files')throw new ApiError('destination busy',409,null,null,'REVISION_CONFLICT');
  throw Error('Unexpected '+path);
 });
 await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',opts),e=>e.code==='REVISION_CONFLICT');
 assert.equal(client.calls.filter(x=>x.method==='DELETE').length,0);
});
test('explicit discard requires server acknowledgment; failures propagate',async()=>{
 const client=load(async(path,opts)=>{if(opts.method==='DELETE')throw new ApiError('server unreachable',503,null,null,'SERVICE_UNAVAILABLE');throw Error('Unexpected '+path)});
 await assert.rejects(client.api.discardUploadSession('previous'),e=>e.status===503);
 assert.deepEqual(client.calls.map(c=>c.method),['DELETE']);
});
test('success path still stages verified data and submits destination',async()=>{
 const client=load(async path=>{
  if(path==='/api/uploads')return {ok:true,uploadId:'new-session',receivedBytes:0,chunkSize:4096,transferMode:'cluster'};
  if(path.endsWith('/chunks'))return {ok:true,receivedBytes:file.size};
  if(path.endsWith('/complete'))return {ok:true,uploadId:'new-session',sizeBytes:file.size,checksumSha256:'a'.repeat(64)};
  if(path==='/api/library/files')return {ok:true,recordId:'asset'};
  throw Error('Unexpected '+path);
 });
 const result=await client.api.finalizeStagedUpload('/api/library/files',opts);
 assert.equal(result.recordId,'asset');assert.deepEqual(client.calls.map(c=>c.method),['POST','PUT','POST','POST']);
});
test('durable queue retains local Blob for failed and 409-paused work; never silently dequeues on rejection',()=>{
 assert.match(queueCode,/status: error instanceof ApiError && \[401, 409\]\.includes\(error\.status\) \? "paused" : "failed"/);
 assert.match(queueCode,/const reviewPaused = status === 409/);
 assert.match(queueCode,/status: authPaused \|\| reviewPaused \? "paused"/);
 const rejected=queueCode.slice(queueCode.indexOf('  } catch (error) {\n    if (isApiNetworkFailure(error))'),queueCode.indexOf('const OFFLINE_UPLOADS_PER_FLUSH'));
 assert.doesNotMatch(rejected,/removeOfflineUpload\(durable\.id\)/);
});
test('ambiguous object-store completion never resumes or deletes staged server work',async()=>{
 for(const status of ['FINALIZING','REVIEW_REQUIRED','ABORTING','CLEANING']){
  const client=load(async route=>{if(route==='/api/uploads/previous')return {...upload,upload:{...upload.upload,status}};throw Error('Unexpected '+route)});
  await assert.rejects(client.api.finalizeStagedUpload('/api/library/files',{...opts,uploadSessionId:'previous'}),error=>error.code==='UPLOAD_RECONCILIATION_REQUIRED'&&/retained/i.test(error.message));
  assert.deepEqual(client.calls.map(c=>c.method),['GET']);
 }
});

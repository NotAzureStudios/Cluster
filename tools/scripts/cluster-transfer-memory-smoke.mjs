import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = p => readFileSync(p, 'utf8');
const downloaded = read('packages/renderer/src/core/browser-download-transfers.ts');
const replaced = downloaded.replace('import { clusterApiFetch } from "@cluster/api-client";', 'const clusterApiFetch = (...args) => globalThis.__mockDownload(...args);')
  .replace('import { API_URL } from "./api/config";', 'const API_URL = "http://localhost:4000";')
  .replace('import { getOfflineScopeIdentity } from "./offline-storage";', 'const getOfflineScopeIdentity=()=>({scope:"test"});')
  .replace('import { sameOfflineRequestContext } from "./user-state-ownership";', 'const sameOfflineRequestContext=()=>true;')
  .replace('import { streamDownloadToSink, type ClusterDownloadSink } from "./browser-download-stream";', 'const streamDownloadToSink=()=>{throw Error("Not used in legacy fallback test");};');
assert.notEqual(replaced, downloaded);
const code = stripTypeScriptTypes(replaced, { mode:'strip' });
const original = { window: globalThis.window, document: globalThis.document, create:URL.createObjectURL, revoke:URL.revokeObjectURL };
let response, cancelled=0, released=0, clicks=0, revokes=0, timers=[];
globalThis.__mockDownload = async()=>response;
globalThis.document = { body:{ append(x){ x.mounted=true; }}, createElement(){return {mounted:false, click(){assert.equal(this.mounted,true);clicks++;}, remove(){this.mounted=false;}};} };
globalThis.window = { location:{origin:'http://localhost:3000'}, setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){} };
URL.createObjectURL = ()=> 'blob:local-'+Math.random();
URL.revokeObjectURL = ()=> {revokes++;};
try {
 const m=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 response=new Response('abc',{headers:{'content-type':'application/octet-stream','content-length':'3'}});
 assert.equal((await m.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/a',fileName:'a.txt'})).state,'saved');
 response=new Response('abc',{headers:{'content-length':String(40*1024*1024)}});
 assert.equal((await m.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/b',fileName:'b.txt'})).state,'handed-off');
 response={ok:true,status:200,headers:new Headers(),url:'',body:{getReader(){return {async read(){return {done:false,value:new Uint8Array(20*1024*1024)};},async cancel(){cancelled++;},releaseLock(){released++;}};}}};
 assert.equal((await m.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/c',fileName:'c.bin'})).state,'handed-off');
 assert.equal(cancelled,1);assert.equal(released,1);
 response=new Response('<html>Login</html>',{headers:{'content-type':'text/html'}});
 await assert.rejects(m.downloadAuthenticatedClusterFile({url:'http://localhost:4000/api/d',fileName:'d.bin'}),/HTML page/);
 await assert.rejects(m.downloadAuthenticatedClusterFile({url:'https://example.invalid/api/f',fileName:'f.bin'}),/authenticated Cluster API/);
 for (const timer of timers) timer();
 assert.equal(revokes,1);
 assert.equal(clicks,3);
 console.log('PASS download buffer cap, streaming handoff, unknown size, response validation and URL cleanup');
} finally {globalThis.window=original.window;globalThis.document=original.document;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;delete globalThis.__mockDownload;}

const uploader = read('packages/renderer/src/core/api/upload-session-transport.ts');
const isolated = stripTypeScriptTypes(uploader.replace(/^import .*?;\r?\n/gm,''),{mode:'strip'});
const mock = 'const api=(...args)=>globalThis.__mockStage(...args); const invalidateMutationCache=()=>{};const invalidateMutationQueries=()=>{}; class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }\n';
const upload = await import('data:text/javascript;base64,'+Buffer.from(mock+isolated).toString('base64'));
let active=true,chunkCalls=0,commits=0;
globalThis.__mockStage = async (path)=>{
 if(path==='/api/uploads')return {ok:true,uploadId:'a',receivedBytes:0,chunkSize:262144,transferMode:'cluster'};
 if(path.endsWith('/chunks')){chunkCalls++; active=false;return {ok:true,receivedBytes:262144};}
 commits++;return {ok:true};
};
try {
 await assert.rejects(upload.finalizeStagedUpload('/api/library/items',{method:'POST',file:new Blob([new Uint8Array(524288)]),fileName:'upload.bin',body:{},headers:new Headers(),ensureCurrent(){if(!active)throw Error('Account changed');}}),/Account changed/);
 assert.equal(chunkCalls,1);assert.equal(commits,0);
 const queue=read('packages/renderer/src/core/api/uploads.ts');
 assert.equal((queue.match(/onProgress: progress,\s+ensureCurrent,/g)||[]).length,4);
 assert.match(queue,/isUploadBackpressure/);
 console.log('PASS staged upload stops across account changes; retry backpressure guarded');
} finally {delete globalThis.__mockStage;}

const transport=read('packages/renderer/src/core/api/transport.ts');
const at=transport.indexOf('function combineSignals('),end=transport.indexOf('async function parseResponse(',at);
assert.ok(at>=0&&end>at);
const combine=new Function(stripTypeScriptTypes(transport.slice(at,end),{mode:'strip'})+'\nreturn combineSignals;')();
const originalAny=AbortSignal.any;
try {
 AbortSignal.any=undefined;
 const a=new AbortController(),b=new AbortController();
 let registered=0,removed=0;
 const add=b.signal.addEventListener.bind(b.signal),remove=b.signal.removeEventListener.bind(b.signal);
 b.signal.addEventListener=(...args)=>{registered++;return add(...args);};
 b.signal.removeEventListener=(...args)=>{removed++;return remove(...args);};
 const combined=combine(a.signal,b.signal);
 combined.cleanup();b.abort();
 assert.equal(registered,1);assert.equal(removed,1);assert.equal(combined.signal.aborted,false);
 console.log('PASS fallback AbortSignal listeners deregistered');
} finally {AbortSignal.any=originalAny;}

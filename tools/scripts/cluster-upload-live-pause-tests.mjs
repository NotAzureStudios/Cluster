import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const code = readFileSync("packages/renderer/src/core/api/uploads.ts", "utf8")
  .replace(/^import .*?;\r?\n/gm, "")
  .replace(/^export \{ discardUploadSession \} from ".*?";\r?\n/gm, "");
let records = [{
  id:"upload-1", scope:"user-A",status:"pending",nextAttemptAt:0,attempts:0,
  sizeBytes:6,file:new Blob([new Uint8Array([1,2,3,4,5,6])]),
  headers:{},idempotencyKey:"fixed-key",method:"POST",fileName:"file.bin",
  path:"/api/library/items",body:{title:"demo"},invalidatePaths:[],uploadSessionId:"saved-upload-session",
}];
let finalizeCalls=0, cancelled=0, successful=0;
let resolveStaging;
const getRecord = (id) => records.find(x=>x.id===id);
globalThis.__uploadHarness = {
  scope:()=>({scope:"user-A",generation:1}),
  list: async()=>records.map(x=>({...x})),
  update: async(id,patch)=>{
    const row=getRecord(id); assert.ok(row,"Never update deleted upload");
    Object.assign(row,patch);return {...row};
  },
  remove:async(id)=>{records=records.filter(x=>x.id!==id);},
  stage:async (_path,options)=>{
    finalizeCalls++;
    assert.equal(options.uploadSessionId,"saved-upload-session");
    assert.equal(options.signal instanceof AbortSignal,true);
    assert.equal(options.headers.get("X-Cluster-Idempotency-Key"),"fixed-key");
    if(finalizeCalls===1) {
      return new Promise((resolve,reject)=>{
        const onAbort=()=>{cancelled++;reject(new DOMException("Upload paused","AbortError"));};
        options.signal.addEventListener("abort",onAbort,{once:true});
        resolveStaging=resolve;
      });
    }
    successful++;
    return {ok:true};
  },
};
const prefix=[
'const getOfflineScopeIdentity=globalThis.__uploadHarness.scope;',
'const listOfflineUploads=globalThis.__uploadHarness.list;',
'const updateOfflineUpload=globalThis.__uploadHarness.update;',
'const removeOfflineUpload=globalThis.__uploadHarness.remove;',
'const finalizeStagedUpload=globalThis.__uploadHarness.stage;',
'const sameOfflineRequestContext=(a,b)=>a.scope===b.scope&&a.generation===b.generation;',
'const queuedWorkMatchesServerBinding=()=>({ok:true});',
'const readOfflineServerBinding=()=>({serverInstanceId:"server-1",serverDataEpoch:"data-1",contractVersion:"1",mutationSchemaVersion:1});',
'const isOnline=()=>true;',
'const recordPerformanceMetric=()=>{};',
'const retryDelay=()=>500;',
'const ApiError=class extends Error{constructor(message,status=500){super(message);this.status=status;}};',
'const isApiNetworkFailure=()=>false;',
'const mutationIdempotencyKey=()=>{};',
'const persistentMutationHeaders=()=>{};',
].join("\n");
const m=await import("data:text/javascript;base64,"+Buffer.from(prefix+"\n"+stripTypeScriptTypes(code,{mode:"strip"})).toString("base64"));
try {
 const flushing=m.flushApiUploads();
 for(let i=0;i<30 && !resolveStaging;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof resolveStaging,"function","Upload did not reach staging");
 assert.equal(getRecord("upload-1").status,"uploading");
 assert.equal(m.requestPauseActiveOfflineUpload("upload-1"),true,"Must abort active network request");
 await flushing;
 assert.equal(cancelled,1,"Current network request must be aborted exactly once");
 assert.equal(getRecord("upload-1").status,"paused");
 assert.equal(getRecord("upload-1").pauseReason,"manual");
 assert.equal(getRecord("upload-1").uploadSessionId,"saved-upload-session");
 assert.equal(getRecord("upload-1").file.size,6,"Original IndexedDB Blob must remain");
 assert.equal(m.requestPauseActiveOfflineUpload("upload-1"),false,"Release control after worker exits");
 assert.equal(finalizeCalls,1);
 console.log("PASS: mid-chunk upload pause aborts request and preserves durable staged session and Blob");

 Object.assign(getRecord("upload-1"),{status:"pending",pauseReason:null,pausedAt:null,nextAttemptAt:0});
 await m.flushApiUploads();
 assert.equal(finalizeCalls,2);
 assert.equal(successful,1);
 assert.equal(records.length,0,"Completed resumed transfer removes durable upload");
 console.log("PASS: resume reuses the same server upload ID and idempotency key");
} finally { delete globalThis.__uploadHarness; }

const runtime=readFileSync("packages/renderer/src/core/offline-runtime.ts","utf8");
const ui=readFileSync("packages/renderer/src/features/shell/TaskbarTransferCenter.tsx","utf8");
assert.match(runtime,/Pause the active upload and wait for acknowledgement/);
assert.match(runtime,/upload\.status === "uploading" && !requestPauseActiveOfflineUpload/);
assert.match(ui,/upload\.status === "pending" \|\| upload\.status === "uploading"/);
console.log("PASS: Transfer Center offers live Pause and protects in-flight disposal");

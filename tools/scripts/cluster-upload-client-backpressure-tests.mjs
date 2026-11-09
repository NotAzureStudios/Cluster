import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const code = fs.readFileSync(path.join(root,"packages/renderer/src/core/api/uploads.ts"),"utf8");
const transpiled = ts.transpileModule(code, {
  fileName: "uploads.ts",
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((transpiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
class ApiError extends Error {
  constructor(code,status,retryAfterSeconds=1) {
    super(code);
    Object.assign(this,{code,status,retryAfterSeconds});
  }
}
function loadUploadApi(error) {
  let queueWrites = 0, persistentSession = null;
  const persisted = [];
  const blob = new Blob([Buffer.from("non-empty upload bytes")],{type:"application/octet-stream"});
  const mods = {
    "../offline-storage": {
      getOfflineScopeIdentity: () => ({scope:"account-a",generation:1}),
      listOfflineUploads: async () => persisted,
      queueOfflineUpload: async (record) => {
        queueWrites++;
        assert.equal(record.file,blob,"never lose the original retry Blob");
        const row = {...record,id:"queued-upload",status:"pending"};
        persisted.push(row);
        return row;
      },
      updateOfflineUpload: async (id,patch) => {
        assert.equal(id,"queued-upload");
        Object.assign(persisted[0],patch);
        persistentSession = persisted[0].uploadSessionId;
        return persisted[0];
      },
      removeOfflineUpload: async () => {throw Error("no deletion during backpressure");},
    },
    "../user-state-ownership": {sameOfflineRequestContext:(a,b)=>a.scope===b.scope&&a.generation===b.generation},
    "../offline-server-binding": {readOfflineServerBinding:()=>({
      serverInstanceId:"server-1",serverDataEpoch:"data-1",serverVersion:"1.1.2",
      contractVersion:"1",mutationSchemaVersion:1,
    }),queuedWorkMatchesServerBinding:()=>({ok:true})},
    "../performance": {recordPerformanceMetric:()=>{}},
    "./errors": {ApiError,isApiNetworkFailure:()=>false,isOnline:()=>true},
    "./config": {mutationIdempotencyKey:()=>"once"},
    "./offline-replay": {retryDelay:()=>500},
    "./mutation-support": {persistentMutationHeaders:()=>({})},
    "./upload-session-transport": {
      discardUploadSession:async()=>{throw Error("no disposal");},
      finalizeStagedUpload:async(_path,opts)=>{
        await opts.onUploadSession({id:"staged-session",transferMode:"cluster"});
        throw error;
      },
    },
  };
  const module={exports:{}};
  new Function("require","module","exports",transpiled.outputText)(
    name=>{ assert.ok(Object.hasOwn(mods,name),"Unexpected upload import: "+name);return mods[name]; },
    module,module.exports,
  );
  return {
    uploadApi:module.exports.uploadApi,blob,persisted,
    get queueWrites(){return queueWrites;},
    get persistentSession(){return persistentSession;},
  };
}
let checks=0;
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
async function run(h,extra={}){
  return h.uploadApi("/api/library/files",{
    file:h.blob,fileName:"studio.bin",body:{projectId:"p1"},label:"Studio upload",
    persistBeforeTransfer:false,...extra,
  });
}
await check("503 buffer backpressure preserves resumable session and file in durable browser queue",async()=>{
  const h=loadUploadApi(new ApiError("UPLOAD_CHUNK_ADMISSION_BUSY",503,3));
  const started=Date.now();
  const result=await run(h);
  assert.equal(result.queued,true);
  assert.equal(h.queueWrites,1);
  assert.equal(h.persistentSession,"staged-session");
  assert.equal(h.persisted[0].uploadSessionId,"staged-session");
  assert.equal(h.persisted[0].file,h.blob);
  assert.equal(h.persisted[0].status,"pending");
  assert.ok(h.persisted[0].nextAttemptAt>=started+3_000,"honor Retry-After");
  assert.equal(h.persisted[0].idempotencyKey,"once");
});
await check("existing 429 and SERVER_SATURATED still queue rather than discard",async()=>{
  for (const [code,status] of [["UPLOAD_BYTE_RATE_LIMITED",429],["SERVER_SATURATED",503]]){
    const h=loadUploadApi(new ApiError(code,status,2));
    assert.equal((await run(h)).queued,true);
    assert.equal(h.persisted[0].uploadSessionId,"staged-session");
  }
});
await check("unrelated 503 does not silently loop a failed direct upload",async()=>{
  const h=loadUploadApi(new ApiError("UPLOAD_DIRECT_URL_MISSING",503,1));
  await assert.rejects(run(h),error=>error.code==="UPLOAD_DIRECT_URL_MISSING");
  assert.equal(h.queueWrites,0);
});
await check("explicit no-offline-queue setting still surfaces the admission error",async()=>{
  const h=loadUploadApi(new ApiError("UPLOAD_CHUNK_ADMISSION_BUSY",503,1));
  await assert.rejects(run(h,{queueWhenOffline:false}),error=>error.code==="UPLOAD_CHUNK_ADMISSION_BUSY");
  assert.equal(h.queueWrites,0);
});
console.log(checks+"/"+checks+" browser upload backpressure recovery tests passed");

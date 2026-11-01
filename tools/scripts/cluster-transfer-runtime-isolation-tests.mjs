import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = (path) => readFileSync(path, "utf8");
async function evaluate(source) {
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source, {mode:"strip"})).toString("base64"));
}
let owner = {scope:"studio-A",generation:1};
const policy = await evaluate(read("packages/renderer/src/core/transfer-policy.ts")
  .replace('import { getOfflineScopeIdentity } from "./offline-storage";',
    'const getOfflineScopeIdentity = () => globalThis.__transferOwner;'));
globalThis.__transferOwner = owner;
assert.equal(policy.getTransferPolicy().concurrentDiskDownloads,2);
policy.setTransferPolicy({concurrentDiskDownloads:1,maxRetries:4});
assert.equal(policy.browserDiskTransferQueue.getSnapshot().limit,1);
owner={scope:"studio-B",generation:2};globalThis.__transferOwner=owner;
assert.equal(policy.getTransferPolicy().maxRetries,3,"New account must not inherit previous owner's settings");
assert.equal(policy.browserDiskTransferQueue.getSnapshot().limit,2,"New account policy must update the admission limit");
assert.equal(policy.setTransferPolicy({concurrentDiskDownloads:100,maxRetries:-3}).concurrentDiskDownloads,3);
assert.equal(policy.getTransferPolicy().maxRetries,0);
console.log("PASS: account-scoped policy and concurrency refresh");

const limiter = new policy.SharedTransferByteLimiter();
const abortActive = new AbortController();
const first = limiter.wait(50 * 1024 * 1024,250,abortActive.signal);
const abortQueued = new AbortController();
const queued = limiter.wait(1,250,abortQueued.signal);
assert.equal(limiter.getSnapshot().waiting,2);
abortQueued.abort();
await assert.rejects(queued,/cancelled/);
assert.equal(limiter.getSnapshot().waiting,1);
const after = limiter.wait(1,250);
abortActive.abort();
await assert.rejects(first,/cancelled/);
await after;
assert.deepEqual(limiter.getSnapshot(),{waiting:0,running:false});
for(let i=0;i<100;i++) {
  const control = new AbortController();
  const promise=limiter.wait(2*1024*1024,250,control.signal);
  control.abort();
  await assert.rejects(promise,/cancelled/);
}
assert.deepEqual(limiter.getSnapshot(),{waiting:0,running:false});
console.log("PASS: shared rate-limit reservations release on active and queued cancellation (100 cycles)");

const source = read("packages/renderer/src/core/browser-download-transfers.ts").replace(/^import .*?;\r?\n/gm,"");
const injected = [
'const clusterApiFetch=()=>{throw Error("Not used");};',
'const API_URL="https://cluster.example";',
'const getOfflineScopeIdentity=()=>globalThis.__transferOwner;',
'const subscribeOfflineStorage=(listener)=>{globalThis.__scopeListener=listener;return ()=>{if(globalThis.__scopeListener===listener)delete globalThis.__scopeListener;};};',
'const sameOfflineRequestContext=(start,current)=>start.scope===current.scope&&start.generation===current.generation;',
'const browserDiskTransferQueue={setLimit(){},async acquire(){return ()=>{};}};',
'const browserDownloadByteLimiter={async wait(){}};',
'const getTransferPolicy=()=>({concurrentDiskDownloads:2,priority:"normal",maxRetries:1,maxDownloadMiBPerSecond:0});',
'const downloadWithVerifiedResume=globalThis.__mockResumableDownload;',
].join("\n")+"\n"+stripTypeScriptTypes(source,{mode:"strip"});
const original = {window:globalThis.window,document:globalThis.document,owner:globalThis.__transferOwner};
let active = [];
globalThis.window={location:{origin:"https://cluster.example"},showSaveFilePicker(){
  return Promise.resolve({async createWritable(){return {async write(){},async close(){},async abort(){}};}});
}};
globalThis.document={createElement(){return {click(){},remove(){}};},body:{append(){}}};
globalThis.__mockResumableDownload=(_fetcher,_sink,{signal})=>new Promise((resolve,reject)=>{
  const pending={resolve,reject};
  active.push(pending);
  signal?.addEventListener("abort",()=>reject(new DOMException("Cancelled","AbortError")),{once:true});
});
try {
  owner={scope:"studio-A",generation:3};globalThis.__transferOwner=owner;
  const transfers=await evaluate(injected);
  for(let i=0;i<20;i++)transfers.recordBrowserDownloadHandoff({fileName:"finished-"+i,url:"/api/d",state:"completed"});
  assert.equal(transfers.getBrowserDownloadSnapshot().length,12,"Keep bounded finished history");

  const tasks=Array.from({length:15},(_,i)=>transfers.downloadAuthenticatedClusterFile({
    url:"https://cluster.example/api/library/"+i+"/file",fileName:"active-"+i,
    preferDiskStreaming:true,sizeBytes:1,
  }));
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(active.length,15,"All mocked transfers must reach their writer");
  const displayed=transfers.getBrowserDownloadSnapshot();
  assert.equal(displayed.filter((item)=>item.state==="saving").length,15,"Active downloads must never be evicted");
  assert.ok(displayed.length<=27,"Finished history must remain bounded even with active jobs");
  owner={scope:"studio-B",generation:1};globalThis.__transferOwner=owner;
  assert.equal(typeof globalThis.__scopeListener,"function");
  globalThis.__scopeListener("scope");
  const invisible=transfers.getBrowserDownloadSnapshot();
  assert.deepEqual(invisible,[],"Old account filenames must not remain visible");
  assert.equal(transfers.cancelBrowserDownload(displayed[0].id),false,"New account must not operate the previous session's job");
  transfers.recordBrowserDownloadHandoff({fileName:"new-account",url:"/api/y",state:"completed"});
  assert.deepEqual(transfers.getBrowserDownloadSnapshot().map((x)=>x.fileName),["new-account"]);
  assert.equal((await Promise.allSettled(tasks)).filter((x)=>x.status==="rejected").length,15);
  console.log("PASS: 15 concurrent jobs stay visible and become inaccessible after owner change");
} finally {
  globalThis.window=original.window;globalThis.document=original.document;
  globalThis.__transferOwner=original.owner;delete globalThis.__mockResumableDownload;delete globalThis.__scopeListener;
}

const shaModule=await evaluate(read("packages/renderer/src/core/transfer-sha256.ts"));
globalThis.__shaTransfer=shaModule;
const resumed=await evaluate(read("packages/renderer/src/core/transfer-resume.ts")
 .replace('import { TransferSha256, verifiedSha256Etag } from "./transfer-sha256";',
   'const { TransferSha256, verifiedSha256Etag } = globalThis.__shaTransfer;'));
const content=Buffer.alloc(4096,42);
const etag='"sha256-'+(await import("node:crypto")).createHash("sha256").update(content).digest("hex")+'"';
for(const callback of ["onProgress","onRateLimit"]) {
  let requests=0, aborted=0;
  const sink={async write(){},async close(){throw Error("Must not close");},async abort(){aborted++;}};
  await assert.rejects(resumed.downloadWithVerifiedResume(
    async()=>{requests++;return new Response(content,{headers:{"content-length":String(content.length),etag}});},
    sink,{maxRetries:3,[callback]:()=>{throw new TypeError("UI callback crashed");}}),
    /callback failed|scheduler failed/);
  assert.equal(requests,1,"Local callback errors must not trigger network resume");
  assert.equal(aborted,1);
}
delete globalThis.__shaTransfer;
console.log("PASS: local callback errors never retry or finalize partial downloads");

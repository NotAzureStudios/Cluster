import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function source(path) { return readFileSync(path, "utf8"); }
async function load(code) {
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(code, { mode: "strip" })).toString("base64"));
}
const sha = await load(source("packages/renderer/src/core/transfer-sha256.ts"));
for (const count of [0,1,3,55,56,63,64,65,1024,65537]) {
  const bytes = Buffer.alloc(count, 0x61);
  const hasher = new sha.TransferSha256();
  for (let i=0;i<count;i+=17) hasher.update(bytes.subarray(i,i+17));
  const expected=createHash("sha256").update(bytes).digest("hex");
  assert.equal(hasher.digestHex(), expected, "hash mismatch with " + count + " bytes");
}
assert.equal(sha.verifiedSha256Etag('"sha256-'+"a".repeat(64)+'"'),"a".repeat(64));
assert.equal(sha.verifiedSha256Etag('W/"sha256-'+"a".repeat(64)+'"'),null);
console.log("PASS: incremental SHA-256 vectors and strong ETag parsing");

const resumeCode=source("packages/renderer/src/core/transfer-resume.ts")
  .replace('import { TransferSha256, verifiedSha256Etag } from "./transfer-sha256";',
  "const { TransferSha256, verifiedSha256Etag } = globalThis.__transferSha;");
globalThis.__transferSha=sha;
const { downloadWithVerifiedResume }=await load(resumeCode);
function sink() {
  const chunks=[];let closed=0,aborted=0;
  return {chunks,get closed(){return closed;},get aborted(){return aborted;},
    async write(x){chunks.push(Buffer.from(x));}, async close(){closed++;}, async abort(){aborted++;}};
}
const payload=Buffer.from("Cluster-resumable-transfer-verified-payload".repeat(40));
const digest=createHash("sha256").update(payload).digest("hex");
const etag='"sha256-'+digest+'"';
function fullHeaders(length=payload.length) {return {"content-type":"application/octet-stream", "content-length":String(length),etag};}
function interruptedStream() {
 let step=0;
 return new ReadableStream({pull(c){
   if(step++===0)c.enqueue(payload.subarray(0,73));
   else c.error(new TypeError("connection reset"));
 }});
}
{
 const w=sink(), requests=[];
 const result=await downloadWithVerifiedResume(async (range) => {
   requests.push(range);
   if(!range) return new Response(interruptedStream(),{headers:fullHeaders()});
   assert.equal(range.start,73);assert.equal(range.etag,etag);
   return new Response(payload.subarray(73),{status:206,headers:{"content-range":`bytes 73-${payload.length-1}/${payload.length}`,"content-length":String(payload.length-73),etag}});
 },w,{maxRetries:2});
 assert.equal(result.verified,true);
 assert.equal(result.sha256,digest);
 assert.deepEqual(Buffer.concat(w.chunks),payload);
 assert.equal(requests.length,2);
 assert.equal(w.closed,1);assert.equal(w.aborted,0);
}
{
 const w=sink();
 await assert.rejects(downloadWithVerifiedResume(async (range)=>{
  if(!range) return new Response(interruptedStream(),{headers:fullHeaders()});
  return new Response(payload.subarray(73),{status:206,headers:{"content-range":`bytes 0-${payload.length-74}/${payload.length}`,"content-length":String(payload.length-73),etag}});
 },w,{maxRetries:1}),/Resume response does not match/);
 assert.equal(w.closed,0);assert.equal(w.aborted,1);
}
{
 const w=sink();
 await assert.rejects(downloadWithVerifiedResume(async()=>new Response(Buffer.from("tampered"),{headers:{"content-type":"application/octet-stream","content-length":"8",etag}}),w),/SHA-256 mismatch/);
 assert.equal(w.closed,0);assert.equal(w.aborted,1);
}
{
 const w=sink();
 const controller=new AbortController();controller.abort();
 await assert.rejects(downloadWithVerifiedResume(async()=>{throw Error("must not fetch");},w,{signal:controller.signal}),/cancelled/);
 assert.equal(w.aborted,1);
}
{
 const w=sink();
 let checks=0;
 await assert.rejects(downloadWithVerifiedResume(async()=>new Response(payload,{headers:fullHeaders()}),w,{ensureCurrent(){if(++checks>1) throw Error("Account changed");}}),/Account changed/);
 assert.equal(w.aborted,1);
}
console.log("PASS: resumed exact ranges, hash mismatch, rejection, cancellation, account ownership");

const policyCode=source("packages/renderer/src/core/transfer-policy.ts")
  .replace('import { getOfflineScopeIdentity } from "./offline-storage";','const getOfflineScopeIdentity=()=>({scope:"test-account"});');
const policy=await load(policyCode);
const queue=new policy.TransferAdmissionQueue();
queue.setLimit(1);
const order=[];
const first=await queue.acquire("background");
const normal=queue.acquire("normal").then((release)=>{order.push("normal");return release;});
const high=queue.acquire("interactive").then((release)=>{order.push("interactive");return release;});
assert.equal(queue.getSnapshot().waiting,2);
first();
const highRelease=await high;
assert.equal(order[0],"interactive");
highRelease();
const normalRelease=await normal;
normalRelease();
assert.equal(queue.getSnapshot().running,0);
assert.equal(queue.getSnapshot().waiting,0);
const firstAgain=await queue.acquire("normal");
const ctrl=new AbortController();
const waiting=queue.acquire("background",ctrl.signal);
ctrl.abort();
await assert.rejects(waiting,/cancelled/);
firstAgain();
assert.equal(queue.getSnapshot().waiting,0);
console.log("PASS: priority admission, limits, cancellation and listener release");

const progressCode=source("packages/renderer/src/features/shell/transfer-progress-summary.ts");
const {transferProgressSummary}=await load(progressCode);
const summary=transferProgressSummary([{status:"uploading"}],
  [{state:"running",direction:"download",totalBytes:100,transferredBytes:50}],
  [{state:"saving",receivedBytes:20,totalBytes:40},{state:"paused"},{state:"failed"}]);
assert.equal(summary.activeCount,3);
assert.equal(summary.failedCount,1);
assert.equal(summary.pausedCount,1);
assert.equal(summary.downloadingCount,2);
assert.equal(summary.percentage,null,"Unknown browser-upload progress cannot appear as full transfer percentage");
console.log("PASS: unified browser, native and offline-upload status summary");
delete globalThis.__transferSha;

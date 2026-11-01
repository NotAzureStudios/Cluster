import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const file = (path) => readFileSync(path, "utf8");
const source = stripTypeScriptTypes(file("packages/renderer/src/core/browser-download-stream.ts"), { mode: "strip" });
const { streamDownloadToSink } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
function sink() {
  const received = []; let closed = 0, aborted = 0;
  return { received, get closed() {return closed;}, get aborted() {return aborted;},
    async write(bytes) {received.push([...bytes]);}, async close() {closed++;}, async abort() {aborted++;} };
}
{
  const writer = sink();
  const progress = [];
  const result = await streamDownloadToSink(new Response(new Uint8Array([1,2,3]), {headers:{"content-length":"3","content-type":"application/octet-stream"}}), writer,
    {onProgress: (done,total) => progress.push([done,total])});
  assert.deepEqual(result,{bytesWritten:3,totalBytes:3});
  assert.equal(writer.closed,1);assert.equal(writer.aborted,0);
  assert.equal(writer.received.flat().length,3);
  assert.deepEqual(progress.at(-1),[3,3]);
}
{
  const writer = sink();
  await assert.rejects(streamDownloadToSink(new Response(new Uint8Array([1,2,3]), {headers:{"content-length":"4"}}),writer),/declared file size/);
  assert.equal(writer.closed,0);assert.equal(writer.aborted,1);
}
{
  const writer = sink();
  await assert.rejects(streamDownloadToSink(new Response("<html>login</html>", {headers:{"content-type":"text/html"}}),writer),/page or API response/);
  assert.equal(writer.aborted,1);
}
{
  const writer = sink();
  const ctrl = new AbortController();ctrl.abort();
  await assert.rejects(streamDownloadToSink(new Response(new Uint8Array([1,2,3])),writer,{signal:ctrl.signal}),/cancel/);
  assert.equal(writer.aborted,1);
}
{
  const writer=sink();
  let changed=false;
  await assert.rejects(streamDownloadToSink(new Response(new Uint8Array([1,2,3])),writer,{ensureCurrent(){if(changed)throw Error("Account changed");changed=true;}}),/Account changed/);
  assert.equal(writer.aborted,1);
}
console.log("PASS: disk sink checks length, errors, ownership and cancellation");

const hashSource = stripTypeScriptTypes(file("packages/renderer/src/core/transfer-sha256.ts"), { mode: "strip" });
globalThis.__streamSha = await import("data:text/javascript;base64," + Buffer.from(hashSource).toString("base64"));
const resumeSource = file("packages/renderer/src/core/transfer-resume.ts").replace(
  'import { TransferSha256, verifiedSha256Etag } from "./transfer-sha256";',
  "const { TransferSha256, verifiedSha256Etag } = globalThis.__streamSha;"
);
const resume = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(resumeSource, {mode:"strip"})).toString("base64"));
const input=file("packages/renderer/src/core/browser-download-transfers.ts");
const replaced=input.replaceAll(/import .*?;\r?\n/g,"");
const prefixed=`const clusterApiFetch=(...a)=>globalThis.__fetchDownload(...a);
const API_URL="http://localhost:4000";
const getOfflineScopeIdentity=()=>({scope:"user1"});
const sameOfflineRequestContext=()=>true;
const downloadWithVerifiedResume=globalThis.__streamResume;
const browserDiskTransferQueue={setLimit(){},async acquire(){return ()=>{};}};
const browserDownloadByteLimiter={async wait(){}};
const getTransferPolicy=()=>({concurrentDiskDownloads:2,priority:"normal",maxRetries:2,maxDownloadMiBPerSecond:0});
`+stripTypeScriptTypes(replaced,{mode:"strip"});
const original={window:globalThis.window,document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
const transfers=[];
let requests=0,clicks=0,picked=0,closed=0,aborted=0;
globalThis.__streamResume=resume.downloadWithVerifiedResume;
globalThis.__fetchDownload=async()=>{requests++;return new Response(new Uint8Array([4,5,6]),{headers:{"content-length":"3","content-type":"application/octet-stream"}});};
globalThis.document={body:{append(node){node.mounted=true;}},createElement(){return {mounted:false,click(){assert.ok(this.mounted);clicks++;},remove(){this.mounted=false;}};}};
globalThis.window={location:{origin:"http://localhost:4000"},setTimeout(fn){transfers.push(fn);return transfers.length;},clearTimeout(){},
  showSaveFilePicker({suggestedName}){picked++;assert.ok(suggestedName);return Promise.resolve({async createWritable(){return {async write(){},async close(){closed++;},async abort(){aborted++;}};}});}};
URL.createObjectURL=()=> "blob:stub";
URL.revokeObjectURL=()=> {};
try{
  const {downloadAuthenticatedClusterFile,getBrowserDownloadSnapshot}=await import("data:text/javascript;base64,"+Buffer.from(prefixed).toString("base64"));
  const one=await downloadAuthenticatedClusterFile({url:"http://localhost:4000/api/library/demo/file",fileName:"demo.bin",sizeBytes:3,preferDiskStreaming:true});
  assert.equal(one.state,"completed");assert.equal(picked,1);assert.equal(requests,1);assert.equal(closed,1);assert.equal(aborted,0);assert.equal(clicks,0);
  assert.equal(getBrowserDownloadSnapshot().find(x=>x.id===one.transferId)?.receivedBytes,3);
  const big=await downloadAuthenticatedClusterFile({url:"http://localhost:4000/api/library/big/file",fileName:"large.zip",sizeBytes:128*1024*1024});
  assert.equal(big.state,"handed-off");assert.equal(requests,1,"large file must not initiate a redundant GET");assert.equal(clicks,1);
  console.log("PASS: native file picker streams in one request; known-large browser handoff avoids redundant GET");
} finally {
  globalThis.window=original.window;globalThis.document=original.document;
  URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;
  delete globalThis.__fetchDownload;delete globalThis.__streamResume;delete globalThis.__streamSha;
}

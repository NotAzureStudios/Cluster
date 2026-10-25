#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const ts=createRequire(import.meta.url)('typescript');
function load(file) {
  const source=readFileSync(join(root,file),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(js,{module:mod,exports:mod.exports,Buffer,URL,Headers,Response,Uint8Array,Promise,Number,JSON,Math,Error,Set,Map,Array,String,Date,require:createRequire(import.meta.url)},{filename:file});
  return mod.exports;
}
const server=load('apps/server/src/domains/inventory/managed-package-segments.ts');
const client=load('packages/renderer/src/features/settings/package-segment-download.ts');
const route=readFileSync(join(root,'apps/server/src/domains/inventory/managed-package-routes.ts'),'utf8');
const ui=readFileSync(join(root,'packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),'utf8');
const hash='a'.repeat(64), challenge='c'.repeat(43), deployment='deployment123';
let checked=0;
function test(name,fn){fn();checked++;console.log('PASS',name)}
async function asyncTest(name,fn){await fn();checked++;console.log('PASS',name)}
test('server first segment bound to zero and a 4 MiB maximum',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(server.initialPackageRange('bytes=0-31',100))),{start:0,end:31,total:100});
 for(const value of ['bytes=1-20','bytes=0-4194304','bytes=-20','bytes=0-','bytes=0-4,8-9','bytes=0-99\nRange: bytes=3-4'])
  assert.throws(()=>server.initialPackageRange(value,2000000),/PACKAGE_SEGMENT_INVALID/);
});
test('server resume ranges reject overflow, oversized or out-of-bound offsets',()=>{
 for(const args of [[-1,5,100],[20,19,100],[50,100,100],[1,4194305,3000000],[1,2,0],[1.5,2,100],[Number.MAX_SAFE_INTEGER+1,9,100]])
  assert.throws(()=>server.packageSegment(...args),/PACKAGE_SEGMENT_INVALID/);
 assert.equal(server.packageSegment(1,2,100).end,2);
});
test('exact Content-Range and length are returned for a resume segment',()=>{
 const headers=server.packageSegmentHeaders(server.packageSegment(1024,2047,4096));
 assert.equal(headers['Content-Range'],'bytes 1024-2047/4096');
 assert.equal(headers['Content-Length'],'1024');
 assert.equal(headers['X-Cluster-Package-Segment-Bytes'],'4194304');
});
const bytes=Uint8Array.from({length: 8*1024*1024+17},(_,i)=>i%251);
function mockFetch({denyAt=-1, failOnceAt=-1, corruptAt=-1, badHeaderAt=-1, extraAt=-1}={}) {
 let calls=0, offers=0, retries=0;
 const fetcher=async (url,init)=>{
  calls++;
  const body=JSON.parse(init.body);
  const first=!url.endsWith('/resume');
  const start=first?0:body.start;
  if(first) {offers++;assert.equal(init.headers.Range,'bytes=0-4194303');}
  else {
   assert.equal(body.deploymentId,deployment);assert.equal(body.challenge,challenge);
   assert.equal(body.channel,'stable');assert.equal(body.platform,'windows-x64');
  }
  if(start===failOnceAt && retries++===0) throw new Error('disconnected');
  if(start===denyAt) return new Response(JSON.stringify({code:'PACKAGE_RELEASE_NOT_ENTITLED'}),{status:404,headers:{'Content-Type':'application/json'}});
  const end=first?4194303:body.end;
  const responseBytes=bytes.slice(start,end+1);
  if(start===corruptAt) responseBytes[0] ^= 255;
  const content=start===extraAt?new Uint8Array([...responseBytes,9]):responseBytes;
  const headers={'Content-Type':'application/zip','Content-Range':`bytes ${start}-${end}/${bytes.length}`,
   'X-Cluster-Package-SHA256':hash,'X-Cluster-Package-Segment-Bytes':'4194304',
   'X-Cluster-Package-Deployment-ID':deployment,'X-Cluster-Package-Receipt-Challenge':challenge};
  if(start===badHeaderAt) headers['Content-Range']='bytes 1-2/3';
  return new Response(content,{status:206,headers});
 };
 return {fetcher,stats:()=>({calls,offers})};
}
function options(fetcher,progress){return {endpoint:'/api/me/packages/pkg/releases/r/download',channel:'stable',platform:'windows-x64',deviceId:'device',artifactSize:bytes.length,artifactSha256:hash,fetcher,onProgress:progress,onLease:(h)=>({deploymentId:h.get('x-cluster-package-deployment-id'),receiptChallenge:h.get('x-cluster-package-receipt-challenge')})}}
await asyncTest('client assembles exact ordered segments and reports bounded progress',async()=>{
 const m=mockFetch(),percent=[];const result=await client.downloadPackageSegments(options(m.fetcher,(n)=>percent.push(n)));
 assert.deepEqual(Buffer.from(result.bytes),Buffer.from(bytes));
 assert.deepEqual(percent,[4194304,8388608,bytes.length]);
 assert.deepEqual(m.stats(),{calls:3,offers:1});
});
await asyncTest('lost transport response retries only its single segment, not the offer',async()=>{
 const m=mockFetch({failOnceAt:4194304}); const result=await client.downloadPackageSegments(options(m.fetcher));
 assert.deepEqual(Buffer.from(result.bytes),Buffer.from(bytes)); assert.deepEqual(m.stats(),{calls:4,offers:1});
});
await asyncTest('permission revocation immediately stops the next segment',async()=>{
 const m=mockFetch({denyAt:4194304});
 await assert.rejects(()=>client.downloadPackageSegments(options(m.fetcher)),/PACKAGE_RELEASE_NOT_ENTITLED/);
 assert.deepEqual(m.stats(),{calls:2,offers:1});
});
await asyncTest('mismatched range and excessive bytes fail closed',async()=>{
 for(const settings of [{badHeaderAt:4194304},{extraAt:4194304}]) {
  const m=mockFetch(settings);await assert.rejects(()=>client.downloadPackageSegments(options(m.fetcher)),/PACKAGE_SEGMENT_RESPONSE_INVALID|PACKAGE_SEGMENT_TOO_LARGE/);
 }
});
await asyncTest('missing lease prevents second-segment download',async()=>{
 const m=mockFetch();await assert.rejects(()=>client.downloadPackageSegments({...options(m.fetcher),onLease:()=>null}),/PACKAGE_SEGMENT_LEASE_MISSING/);
 assert.deepEqual(m.stats(),{calls:1,offers:1});
});
test('resume route verifies device, current entitlements and signed bytes without creating another offer',()=>{
 const body=route.slice(route.indexOf('app.post("/api/me/packages/:id/releases/:releaseId/download/resume"'),route.indexOf('app.post("/api/me/packages/:id/releases/:releaseId/download/recover"'));
 assert.match(body,/await authorizedDevice\(request, reply\)/);
 assert.match(body,/packageReceiptChallengeValid/);
 assert.match(body,/readDevicePackageTargets\(tx/);
 assert.match(body,/readVerifiedPackageArtifact\(/);
 assert.match(body,/offer\.artifactSha256/);
 assert.doesNotMatch(body,/managedPackageDeviceDeployment\.create|newPackageReceiptChallenge/);
 assert.match(ui,/downloadPackageSegments\(/);
 assert.match(ui,/crypto\.subtle\.digest\("SHA-256", bytes\)/);
});
console.log(`${checked}/${checked} TD6 G15 segmented Package checks passed`);

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const ts = createRequire(import.meta.url)('typescript');
const rel = p => readFileSync(join(root,p),'utf8');
const source=rel('packages/renderer/src/features/settings/package-segment-download.ts');
const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(transpiled,{module:mod,exports:mod.exports,Uint8Array,Headers,Response,AbortController,Number,Error,Promise,JSON,String,Math},{filename:'package-segment-download.ts'});
const {downloadPackageSegmentsToSink}=mod.exports;
const data=Uint8Array.from({length:8*1024*1024+19},(_,i)=>(i*17)%251), hash='a'.repeat(64);
const endpoint='/api/me/packages/p/releases/r/download';
let count=0;
async function check(name,fn){await fn();console.log('PASS',name);count++}
const options=(fetcher,onSegment,extra={})=>({endpoint,channel:'stable',platform:'windows-x64',deviceId:'device',artifactSize:data.length,
 artifactSha256:hash,fetcher,onSegment,onLease:()=>{throw Error('recovery must not issue a new offer')},...extra});
const makeMock=(denial='',invalid=false)=>{
 const requests=[];
 const fetcher=async(path,init)=>{
  const body=JSON.parse(init.body);requests.push({path,body,signal:init.signal});
  if(path.endsWith('/recover')) return new Response(denial?JSON.stringify({code:denial}):JSON.stringify({ok:true,deploymentId:'original_offer',receiptChallenge:'d'.repeat(43)}),{status:denial?403:200});
  if(!path.endsWith('/resume')) throw Error('recovery issued new deployment offer');
  if(body.deploymentId!=='original_offer'||body.challenge!=='d'.repeat(43)) throw Error('wrong rotated lease');
  return new Response(data.slice(body.start,body.end+1),{status:206,headers:{'content-range':invalid?'bytes 1-2/3':`bytes ${body.start}-${body.end}/${data.length}`,
   'content-type':'application/zip','x-cluster-package-sha256':hash,'x-cluster-package-segment-bytes':'4194304'}});
 };
 return {requests,fetcher};
};
await check('restart recovery resumes the ORIGINAL offer from native byte offset, without creating a new offer',async()=>{
 const mock=makeMock(),got=[],saved=data.slice();
 await downloadPackageSegmentsToSink(options(mock.fetcher,async(pos,chunk)=>{got.push(pos);saved.set(chunk,pos)},
   {resumeFrom:4194304+311,recovery:{deploymentId:'original_offer'}}));
 assert.deepEqual(got,[4194304+311]);
 assert.equal(mock.requests[0].path,endpoint+'/recover');
 assert.equal(mock.requests[1].path,endpoint+'/resume');
 assert.equal(mock.requests[0].body.deploymentId,'original_offer');
 assert.equal(mock.requests[1].body.start,4194304+311);
 assert.deepEqual(Buffer.from(saved),Buffer.from(data));
});
await check('zero-byte saved checkpoint recovers using authorized range zero',async()=>{
 const mock=makeMock();let written=0;
 await downloadPackageSegmentsToSink(options(mock.fetcher,async(_,chunk)=>{written+=chunk.length},
  {resumeFrom:0,recovery:{deploymentId:'original_offer'}}));
 assert.equal(mock.requests[1].body.start,0);assert.equal(written,data.length);
});
await check('revoked original offer fails without fallback or writes',async()=>{
 const mock=makeMock('PACKAGE_DOWNLOAD_RECOVERY_DENIED');let writes=0;
 await assert.rejects(()=>downloadPackageSegmentsToSink(options(mock.fetcher,async()=>{writes++},{resumeFrom:300,recovery:{deploymentId:'original_offer'}})),/PACKAGE_DOWNLOAD_RECOVERY_DENIED/);
 assert.equal(mock.requests.length,1);assert.equal(writes,0);
});
await check('malformed offer and forged recovery response fail closed',async()=>{
 const mock=makeMock();
 await assert.rejects(()=>downloadPackageSegmentsToSink(options(mock.fetcher,async()=>{}, {recovery:{deploymentId:'invalid/offer'}})),/PACKAGE_RECOVERY_ID_INVALID/);
 assert.equal(mock.requests.length,0);
 const bad=async()=>new Response(JSON.stringify({ok:true,deploymentId:'different_offer',receiptChallenge:'d'.repeat(43)}));
 await assert.rejects(()=>downloadPackageSegmentsToSink(options(bad,async()=>{}, {recovery:{deploymentId:'original_offer'}})),/PACKAGE_RECOVERY_RESPONSE_INVALID/);
});
await check('wrong recovered segment metadata cannot reach native spool',async()=>{
 const mock=makeMock('',true);let writes=0;
 await assert.rejects(()=>downloadPackageSegmentsToSink(options(mock.fetcher,async()=>{writes++}, {resumeFrom:1024,recovery:{deploymentId:'original_offer'}})),/PACKAGE_SEGMENT_RESPONSE_INVALID/);
 assert.equal(writes,0);
});
await check('manual pause aborts with verified prior segments retained',async()=>{
 const mock=makeMock();const controller=new AbortController();let writes=0;
 await assert.rejects(()=>downloadPackageSegmentsToSink(options(mock.fetcher,async()=>{writes++;controller.abort()},{recovery:{deploymentId:'original_offer'},signal:controller.signal})),/PACKAGE_TRANSFER_PAUSED/);
 assert.equal(writes,1);assert.equal(mock.requests.length,2);
});
await check('Qt native binding uses scoped digest and no auth bearer',async()=>{
 const qt=rel('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
 const bridge=rel('packages/renderer/src/core/desktop.ts');
 const panel=rel('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
 const server=rel('apps/server/src/domains/inventory/managed-package-routes.ts');
 const cli=rel('tools/native/package-stager-go/main.go');
 const file=rel('tools/native/package-stager-go/durable_transfer.go');
 for(const src of [qt,bridge])assert.match(src,/package\.transfer\.bindOffer/);
 assert.match(qt,/--transfer-offer-id/);assert.match(qt,/activeProfileId\(\)/);
 assert.match(file,/Offer\s+\*transferOffer/);assert.match(file,/checkpoint already bound to another offer/);
 assert.match(cli,/case "transfer-bind"/);
 assert.match(panel,/bindNativePackageArchiveOffer/);
 assert.match(panel,/checkpoint\.offer\.deploymentId/);
 assert.match(server,/download\/recover/);
 assert.match(server,/challengeHash: renewed\.challengeHash/);
 assert.match(server,/userId: device\.userId/);
 assert.doesNotMatch(file,/receiptChallenge|BearerToken|challengeHash/);
});
console.log(`${count}/${count} G18 recovered-offer assertions passed`);

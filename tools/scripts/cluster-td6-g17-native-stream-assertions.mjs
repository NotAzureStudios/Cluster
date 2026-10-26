#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(join(root,'packages/renderer/src/features/settings/package-segment-download.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(compiled,{module:mod,exports:mod.exports,Uint8Array,Response,Headers,Number,Error,Promise,JSON,String,Set,Array,Map,Math},{filename:'package-segment-download.ts'});
const {downloadPackageSegmentsToSink}=mod.exports;
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS',name)}
const content=Uint8Array.from({length:8*1024*1024+17},(_,i)=>i%251);
const hash='a'.repeat(64);
function mockFetch({revokeAt=-1,failOnceAt=-1,invalidHeaderAt=-1}={}){
 const calls=[],attempts=new Map();
 return {calls,fetcher:async(path,request)=>{
  const first=!path.endsWith('/resume');const body=JSON.parse(request.body);
  const start=first?0:body.start;const end=first?4194303:body.end;
  calls.push(start);
  if(start===failOnceAt){const n=attempts.get(start)||0;attempts.set(start,n+1);if(n===0)throw Error('network disconnected')}
  if(start===revokeAt)return new Response(JSON.stringify({code:'PACKAGE_RELEASE_NOT_ENTITLED'}),{status:403});
  const range=start===invalidHeaderAt?'bytes 0-1/2':`bytes ${start}-${end}/${content.length}`;
  return new Response(content.slice(start,end+1),{status:206,headers:{'content-range':range,'content-type':'application/zip',
   'x-cluster-package-sha256':hash,'x-cluster-package-segment-bytes':'4194304',
   'x-cluster-package-deployment-id':'deployment123','x-cluster-package-receipt-challenge':'c'.repeat(43)}});
 }};
}
const opts=(fetcher,onSegment,extra={})=>({endpoint:'/api/me/packages/pkg/releases/r/download',channel:'stable',platform:'windows-x64',deviceId:'device',artifactSize:content.length,
 artifactSha256:hash,fetcher,onSegment,onLease:()=>({deploymentId:'deployment123',receiptChallenge:'c'.repeat(43)}),...extra});
await check('native stream sink handles byte-exact contiguous segments without assembling result',async()=>{
 const m=mockFetch(),saved=new Uint8Array(content.length),offsets=[];
 const result=await downloadPackageSegmentsToSink(opts(m.fetcher,async(offset,chunk)=>{offsets.push(offset);saved.set(chunk,offset)}));
 assert.equal(Object.hasOwn(result,'bytes'),false);
 assert.deepEqual(Buffer.from(saved),Buffer.from(content));assert.deepEqual(offsets,[0,4194304,8388608]);
});
await check('native checkpoint after first segment resumes from exact local offset',async()=>{
 const m=mockFetch(),saved=content.slice(),offsets=[];
 await downloadPackageSegmentsToSink(opts(m.fetcher,async(offset,chunk)=>{offsets.push(offset);saved.set(chunk,offset)},{resumeFrom:4194304+91}));
 assert.deepEqual(m.calls,[0,4194304+91]);assert.deepEqual(offsets,[4194304+91]);
});
await check('partially received first range appends only missing suffix',async()=>{
 const m=mockFetch(),offsets=[];
 await downloadPackageSegmentsToSink(opts(m.fetcher,async(offset,chunk)=>offsets.push([offset,chunk.length]),{resumeFrom:167}));
 assert.deepEqual(offsets[0],[167,4194304-167]);
});
await check('transport retry preserves native checkpoint offset',async()=>{
 const m=mockFetch({failOnceAt:4194304}),offsets=[];
 await downloadPackageSegmentsToSink(opts(m.fetcher,async(offset)=>offsets.push(offset)));
 assert.deepEqual(offsets,[0,4194304,8388608]);assert.deepEqual(m.calls,[0,4194304,4194304,8388608]);
});
await check('revoked entitlement blocks all later native writes',async()=>{
 const m=mockFetch({revokeAt:4194304}),offsets=[];
 await assert.rejects(()=>downloadPackageSegmentsToSink(opts(m.fetcher,async(offset)=>offsets.push(offset))),/PACKAGE_RELEASE_NOT_ENTITLED/);
 assert.deepEqual(offsets,[0]);
});
await check('invalid ranges and offsets fail closed before writing resumed content',async()=>{
 const m=mockFetch({invalidHeaderAt:4194304}),offsets=[];
 await assert.rejects(()=>downloadPackageSegmentsToSink(opts(m.fetcher,async(offset)=>offsets.push(offset))),/PACKAGE_SEGMENT_RESPONSE_INVALID/);
 assert.deepEqual(offsets,[0]);
 for(const value of [-1,content.length+1,0.5,NaN])
  await assert.rejects(()=>downloadPackageSegmentsToSink(opts(m.fetcher,async()=>{}, {resumeFrom:value})),/PACKAGE_SEGMENT_RESUME_OFFSET_INVALID/);
});
await check('WebChannel only exposes four bounded transport verbs and no filesystem path',async()=>{
 const qt=readFileSync(join(root,'apps/desktop-qt/src/NativeCapabilityBroker.cpp'),'utf8');
 const tsBridge=readFileSync(join(root,'packages/renderer/src/core/desktop.ts'),'utf8');
 const ui=readFileSync(join(root,'packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx'),'utf8');
 for(const name of ['begin','inspect','append','commit']) {
  assert.match(qt,new RegExp(`package\\.transfer\\.${name}`));assert.match(tsBridge,new RegExp(`package\\.transfer\\.${name}`));
 }
 assert.match(qt,/MaxArchiveChunkRequestBytes/);assert.match(qt,/m_controller->nativeSessionReady\(\)/);
 assert.match(qt,/activeProfileId\(\)/);assert.match(qt,/QStandardPaths::AppLocalDataLocation/);
 assert.match(qt,/PACKAGE_TRANSFER_NOT_FOUND/);assert.match(ui,/downloadPackageSegmentsToSink\(/);
 assert.match(ui,/commitNativePackageArchive\(/);assert.match(ui,/locally retained archive is no longer an authorized device target/);assert.doesNotMatch(tsBridge.slice(tsBridge.indexOf('export async function prepareNativePackageArchive'),tsBridge.indexOf('export async function transferDownloadedPackageKitToNative')),/receiptChallenge|deploymentGrant|localPath:/);
});
console.log(`${checks}/${checks} G17 native stream assertions passed`);

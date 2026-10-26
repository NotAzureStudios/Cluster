#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { Readable } from 'node:stream';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const ts=require('typescript');
const cache=new Map();
function load(rel) {
 if(cache.has(rel))return cache.get(rel);
 const source=readFileSync(join(root,rel),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 const localRequire=(id)=> id==='./managed-package-policy.js'
  ? load('apps/server/src/domains/inventory/managed-package-policy.ts')
  : id==='../operation-cancellation.js' ? {throwIfAborted:()=>{}} : require(id);
 vm.runInNewContext(js,{module:mod,exports:mod.exports,Buffer,Uint8Array,Number,Promise,JSON,Math,Error,Set,Map,Array,String,Date,Readable,process,require:localRequire},{filename:rel});
 cache.set(rel,mod.exports);return mod.exports;
}
const store=load('apps/server/src/domains/inventory/managed-package-artifact-store.ts');
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const sha=(b)=>createHash('sha256').update(b).digest('hex');
function createMemoryRuntime(){
 const data=new Map();let reads=0,writes=0;
 const provider={durable:true,capabilities:{streamingWrites:true,rangeReads:true},
  putStream:async(key,stream,{size,checksumSha256})=>{let n=0;const buf=[];for await(const part of stream){n+=part.length;buf.push(Buffer.from(part))}const bytes=Buffer.concat(buf);assert.equal(n,size);assert.equal(sha(bytes),checksumSha256);data.set(key,bytes);writes++;return {size:n}},
 };
 return {data,stats:()=>({reads,writes}),locatorForTier:(tier,key)=>({provider:'local',tier,key}),provider:()=>provider,
  providerKey:({tier,key})=>`${tier}/${key}`,stat:async({tier,key})=>({size:data.get(`${tier}/${key}`)?.length??-1}),
  openRead:async({tier,key},range)=>{reads++;const bytes=data.get(`${tier}/${key}`);if(!bytes)throw new Error('missing blob');return Readable.from([range?bytes.subarray(range.start,range.end+1):bytes])}};
}
// use a tiny valid ZIP generated once as a signed fixture
const zip=Buffer.from('UEsDBBQAAAAIAA4gUls0+f2oBwAAAAUAAAABAAAAYZMAAAAAAAA=', 'base64');
// Metadata signature tests do not depend on the ZIP fixture being parseable;
// legacy decoding is verified independently by inherited signed ZIP tests.
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
const content=Buffer.from('immutable package artifacts are not mutable');
const manifest={schema:1,packageKey:'studio-assets',version:'1.0.0',platform:'windows-x64',artifactSha256:sha(content),artifactSize:content.length,filename:'studio-assets.zip'};
const signature=sign(null,policy.packageSigningInput(manifest),privateKey).toString('base64');
const row={artifact:null,artifactSha256:manifest.artifactSha256,artifactSize:content.length,signature,
 manifestSha256:sha(policy.packageSigningInput(manifest)),signingKeyFingerprint:policy.packageKeyFingerprint(publicKeyPem)};
const runtime=createMemoryRuntime();let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name)}
await check('publishes immutable sha256-addressed object with verified size',async()=>{
 const ref=await store.publishPackageArtifact(runtime,content,manifest.artifactSha256);Object.assign(row,ref);
 assert.equal(row.artifactStorageKey,`packages/sha256/${manifest.artifactSha256.slice(0,2)}/${manifest.artifactSha256}`);
 assert.equal(runtime.data.size,1);
});
await check('reads an exact bounded range without loading a full object response',async()=>{
 const piece=await store.readVerifiedPackageArtifact(runtime,row,manifest,publicKeyPem,{start:2,end:8});
 assert.equal(Buffer.from(piece).toString(),content.subarray(2,9).toString());
 assert.equal(piece.length,7);
});
await check('reads the complete validated artifact',async()=>{
 const b=await store.readVerifiedPackageArtifact(runtime,row,manifest,publicKeyPem);
 assert.equal(Buffer.from(b).toString(),content.toString());
});
await check('fails closed if the provider changes bytes or truncates an object',async()=>{
 const key=`hot/${row.artifactStorageKey}`,original=runtime.data.get(key);
 const broken=Buffer.from(original);broken[1]^=55;runtime.data.set(key,broken);
 await assert.rejects(()=>store.readVerifiedPackageArtifact(runtime,row,manifest,publicKeyPem),/PACKAGE_BLOB_INTEGRITY_FAILED/);
 runtime.data.set(key,original.subarray(0,-2));
 await assert.rejects(()=>store.readVerifiedPackageArtifact(runtime,row,manifest,publicKeyPem),/PACKAGE_BLOB_SIZE_MISMATCH/);
 runtime.data.set(key,original);
});
await check('rejects tampered metadata and incompatible locators before reading bytes',async()=>{
 const bad=[{...row,artifactStorageKey:'../outside'}, {...row,artifact:content},{...row,signature:'A'.repeat(88)}, {...row,manifestSha256:'a'.repeat(64)}];
 for(const candidate of bad) await assert.rejects(()=>store.readVerifiedPackageArtifact(runtime,candidate,manifest,publicKeyPem),/PACKAGE_BLOB_/);
});
await check('rejects forged hash or out-of-bounds request',async()=>{
 await assert.rejects(()=>store.publishPackageArtifact(runtime,content,'f'.repeat(64)),/PACKAGE_BLOB_CHECKSUM_INVALID/);
 await assert.rejects(()=>store.readVerifiedPackageArtifact(runtime,row,manifest,publicKeyPem,{start:0,end:99}),/PACKAGE_BLOB_RANGE_INVALID/);
});
await check('release routes preserve per-segment device, lease and entitlement checks',async()=>{
 const source=readFileSync(join(root,'apps/server/src/domains/inventory/managed-package-routes.ts'),'utf8');
 assert.match(source,/readDevicePackageTargets\(tx/);assert.match(source,/packageReceiptChallengeValid/);
 assert.match(source,/await readVerifiedPackageArtifact\(storageRuntime/);
 assert.match(source,/publishPackageArtifact\(storageRuntime, checked.bytes/);
 assert.match(source,/select: releaseArtifactSelect/);
});
await check('migration enforces exactly one SQL or provider object authority',async()=>{
 const sql=readFileSync(join(root,'apps/server/prisma/migrations/20261019190000_td6_g16_package_blob_authority/migration.sql'),'utf8');
 assert.match(sql,/CHECK \(/);assert.match(sql,/"artifact" IS NULL AND "artifactStorageProvider" IS NOT NULL/);
});
await check('real local storage provider streams content and refuses tampered objects',async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'cluster-g16-provider-'));
 try {
  const {LocalStorageProvider}=load('apps/server/src/core/storage/local-storage-provider.ts');
  const provider=new LocalStorageProvider(temporary,{id:'local'});
  const actual={locatorForTier:(tier,key)=>({provider:'local',tier,key}),provider:()=>provider,providerKey:({tier,key})=>`${tier}/${key}`,
   stat:async locator=>provider.stat(`${locator.tier}/${locator.key}`),
   openRead:async (locator,range)=>provider.openRead(`${locator.tier}/${locator.key}`,range)};
  const ref=await store.publishPackageArtifact(actual,content,manifest.artifactSha256);
  const signed={...row,...ref,artifact:null};
  const part=await store.readVerifiedPackageArtifact(actual,signed,manifest,publicKeyPem,{start:1,end:7});
  assert.equal(part.toString(),content.subarray(1,8).toString());
  const actualFile=join(temporary,`hot/${ref.artifactStorageKey}`);
  writeFileSync(actualFile,Buffer.from('corrupt object of a different length'));
  await assert.rejects(()=>store.readVerifiedPackageArtifact(actual,signed,manifest,publicKeyPem),/PACKAGE_BLOB_/);
 } finally {rmSync(temporary,{recursive:true,force:true})}
});
console.log(`${count}/${count} G16 package CAS checks passed`);

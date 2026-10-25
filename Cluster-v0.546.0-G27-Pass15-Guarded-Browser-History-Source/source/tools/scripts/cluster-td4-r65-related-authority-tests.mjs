/** R65 execution: correlated SQL ownership evidence, never a storage permit. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file='apps/server/src/domains/library/library-disposition-related-authority.ts';
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length||0,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require,process,Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,Buffer},{filename:file});
const {inspectRelatedLibraryStorageAuthority:inspect,LIBRARY_RELATED_AUTHORITY_LIMITS:limits}=mod.exports;
const digest='a'.repeat(64);
let count=0;
async function test(label,fn){await fn();console.log('PASS',label);count++;}
function db(overrides={}){
 const log=[];
 const models={
 managedBlob:{findMany:async args=>{log.push(['managedBlob',args]);return []; }},
 uploadSession:{findMany:async args=>{log.push(['uploadSession',args]);return []; }},
 packetRelease:{findMany:async args=>{log.push(['packetRelease',args]);return []; }},
 packetReleaseDerivative:{count:async args=>{log.push(['packetReleaseDerivative',args]);return 0; }},
 ...overrides};
 return {models,log};
}
const scan=(prisma,content=[{source:'libraryItem',id:'item',checksum:digest}],check=async()=>{})=>inspect({prisma,itemId:'item',content,check});
await test('no external storage claims and no quarantining in empty match',async()=>{
 const {models,log}=db(); const r=await scan(models);
 assert.equal(r.quarantineAllowed,false);assert.equal(r.physicalDisposalAllowed,false);
 assert.equal(r.providerGenerationVerified,false);assert.equal(r.uploadAdmissionFenced,false);
 assert.equal(r.backupRetentionVerified,false);assert.equal(r.knownDigests,1);
 assert.equal(log[0][1].take,limits.matchesPerModel+1);
 assert.deepEqual(Array.from(log[0][1].where.checksumSha256.in),[digest]);
});
await test('managed blob and upload candidates reported without locator/secret keys',async()=>{
 const {models}=db({
 managedBlob:{findMany:async()=>[{id:'blob1',checksumSha256:digest,storageProvider:'local',storageTier:'hot',referenceCount:2,gcState:'ACTIVE',storageKey:'SECRET-KEY'}]},
 uploadSession:{findMany:async()=>[{id:'upload1',checksumSha256:digest,status:'OPEN',storageProvider:'object',storageTier:'temporary',storageKey:'PRIVATE-UPLOAD-KEY'}]},
 });
 const r=await scan(models);
 assert.equal(r.managedBlobs.length,1);assert.equal(r.uploadSessions.length,1);
 assert.ok(r.blockers.includes('CORRELATED_MANAGED_BLOB_CONTENT'));
 assert.ok(r.blockers.includes('CORRELATED_UPLOAD_SESSION_CONTENT'));
 assert.equal(JSON.stringify(r).includes('SECRET-KEY'),false);
 assert.equal(JSON.stringify(r).includes('PRIVATE-UPLOAD-KEY'),false);
 assert.equal(r.quarantineAllowed,false);
});
await test('published release, including revoked, retained as source authority',async()=>{
 const {models,log}=db({
 packetRelease:{findMany:async()=>[{id:'rel1',versionLabel:'1.0',revokedAt:new Date('2025-01-01'),manifestSha256:digest}]},
 packetReleaseDerivative:{count:async args=>{log.push(['count',args]);return 3;}}
 });
 const r=await scan(models);
 assert.equal(r.publishedReleases.length,1);assert.equal(r.publishedDerivativeRows,3);
 assert.ok(r.blockers.includes('IMMUTABLE_PACKET_SOURCE_REFERENCE'));
 assert.deepEqual(Array.from(log.at(-1)[1].where.releaseId.in),['rel1']);
});
await test('missing and malformed digests do not silently become complete correlation',async()=>{
 const {models,log}=db();const r=await scan(models,[{id:'item',source:'libraryItem',checksum:null},{id:'v1',source:'libraryVersion',checksum:'oops'}]);
 assert.equal(r.knownDigests,0);assert.equal(r.contentPointersWithoutVerifiedDigest,2);
 assert.ok(r.blockers.includes('CONTENT_CHECKSUM_INCOMPLETE'));
 assert.deepEqual(log.map(x=>x[0]),['packetRelease']);
});
await test('case normalized and duplicate digests deduplicated',async()=>{
 const {models,log}=db();const r=await scan(models,[{source:'item',id:'1',checksum:'AB'.repeat(32)},{source:'version',id:'2',checksum:'ab'.repeat(32)}]);
 assert.equal(r.knownDigests,1);assert.deepEqual(Array.from(log[0][1].where.checksumSha256.in),['ab'.repeat(32)]);
});
await test('content pointer cap fails closed',async()=>{
 const {models}=db();await assert.rejects(scan(models,Array.from({length:limits.contentDigests+1},(_,i)=>({source:'version',id:String(i),checksum:digest}))),/LIBRARY_RELATED_DIGEST_LIMIT/);
});
await test('managed matches cap fails without a partial report',async()=>{
 const {models}=db({managedBlob:{findMany:async()=>Array.from({length:limits.matchesPerModel+1},(_,i)=>({id:String(i),checksumSha256:digest}))}});
 await assert.rejects(scan(models),/LIBRARY_RELATED_MATCH_LIMIT/);
});
await test('upload matches cap fails without a partial report',async()=>{
 const {models}=db({uploadSession:{findMany:async()=>Array.from({length:limits.matchesPerModel+1},(_,i)=>({id:String(i),checksumSha256:digest}))}});
 await assert.rejects(scan(models),/LIBRARY_RELATED_MATCH_LIMIT/);
});
await test('published release cap fails closed',async()=>{
 const {models}=db({packetRelease:{findMany:async()=>Array.from({length:limits.publishedReleases+1},(_,i)=>({id:String(i)}))}});
 await assert.rejects(scan(models),/LIBRARY_RELATED_RELEASE_LIMIT/);
});
await test('query failure never becomes an empty ownership report',async()=>{
 const {models}=db({managedBlob:{findMany:async()=>{throw new Error('database unavailable');}}});
 await assert.rejects(scan(models),/database unavailable/);
});
await test('expired scan is interrupted before later provider queries',async()=>{
 const {models,log}=db();await assert.rejects(scan(models,undefined,async()=>{throw new Error('deadline');}),/deadline/);
 assert.equal(log.length,0);
});
await test('fingerprint remains deterministic and changes with related evidence',async()=>{
 const {models}=db();const a=await scan(models),b=await scan(models);
 assert.equal(a.fingerprint,b.fingerprint);
 const variant=db({packetRelease:{findMany:async()=>[{id:'r1',versionLabel:'2',revokedAt:null,manifestSha256:digest}]}});
 const c=await scan(variant.models);assert.notEqual(a.fingerprint,c.fingerprint);
});
console.log(`R65 correlated ownership executable checks ${count}/${count}`);

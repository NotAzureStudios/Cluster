/** Mocked runtime safety tests for managed-blob GC and tier transitions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const filename='apps/server/src/core/storage/storage-lifecycle-runtime.ts';
const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const exports={};let targetTier='archive';
vm.runInNewContext(compiled.outputText,{module:{exports},exports,require:id=>{
 if(id==='./storage-policy.js')return{chooseStorageTier:()=>targetTier};
 if(id.startsWith('node:'))return require(id);throw Error('Unknown mock '+id);
},Date,Math,JSON,Object,Number,Boolean,String,Promise,Set,Map,Error,console,process,Buffer},{filename});
let n=0;async function test(name,fn){await fn();n++;console.log('PASS',name)}
function fixture({active=[] ,garbage=[] ,copyFails=false,casCount=1}={}) {
 const counters={delete:0,copy:0,claims:0,retiredRows:0};
 const prisma={managedBlob:{
  findMany:async({where})=>where.referenceCount && Object.hasOwn(where.referenceCount, "gt") ? active:garbage,
  count:async()=>garbage.length,
  updateMany:async()=>{counters.claims++;return{count:casCount}},
  deleteMany:async()=>{counters.retiredRows++;return{count:1}},
 },projectFile:{findMany:async()=>active.map(a=>({managedBlobId:a.id,archived:true,project:{archived:true,status:'archived',updatedAt:new Date(0)}}))}};
 const storage={
  provider:()=>({id:'local'}),providerForTier:()=>({id:'archive'}),
  copyToTier:async(locator,tier)=>{counters.copy++;if(copyFails)throw Error('copy failed');return{provider:'archive',tier,key:locator.key}},
  delete:async()=>{counters.delete++;throw Error('The provider delete must never run');},
 };
 return {runtime:new exports.StorageLifecycleRuntime(prisma,storage,{scanLimit:25}),counters};
}
await test('stale zero-reference blobs are observed but never reclaimed',async()=>{const f=fixture({garbage:[{id:'orphan1',referenceCount:0,storageKey:'file1',sizeBytes:200}]});const r=await f.runtime.run();assert.equal(r.gcEligible,1);assert.equal(r.gcDeferred,1);assert.equal(r.gcDeleted,0);assert.equal(f.counters.delete,0);assert.equal(f.counters.claims,0);assert.equal(f.counters.retiredRows,0)});
await test('automatic tier migration is deferred and measured, not copied',async()=>{const f=fixture({active:[{id:'active1',referenceCount:1,storageKey:'key1',storageProvider:'local',storageTier:'hot',sizeBytes:333}]});const r=await f.runtime.run();assert.equal(r.managedBlobsEligible,1);assert.equal(r.tierMigrationDeferred,1);assert.equal(r.tierMigrationDeferredBytes,333);assert.equal(r.migrated,0);assert.equal(f.counters.copy,0);assert.equal(f.counters.delete,0)});
await test('conflicting writers cannot trigger an unfenced migration',async()=>{const f=fixture({active:[{id:'active1',referenceCount:1,storageKey:'key1',storageProvider:'local',storageTier:'hot',sizeBytes:333}],casCount:0});const r=await f.runtime.run();assert.equal(r.tierMigrationDeferred,1);assert.equal(r.conflicts,0);assert.equal(f.counters.copy,0);assert.equal(f.counters.claims,0)});
await test('failed-copy fixture is not invoked by the deferred runtime',async()=>{const f=fixture({active:[{id:'active1',referenceCount:1,storageKey:'key1',storageProvider:'local',storageTier:'hot',sizeBytes:333}],copyFails:true});const r=await f.runtime.run();assert.equal(r.failures,0);assert.equal(r.migrated,0);assert.equal(f.counters.copy,0);assert.equal(f.counters.delete,0)});
console.log(`R68/R67 managed storage lifecycle ${n}/${n}`);

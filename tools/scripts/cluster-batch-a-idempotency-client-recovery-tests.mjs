#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync('packages/renderer/src/core/api/outbox.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
class ApiError extends Error { constructor(code,status){super(code);this.status=status;this.code=code;this.payload={code};} }
const changes=[];
const modules={
 '../offline-policy':{shouldQuarantineMutation:()=>false},
 '../offline-storage':{getOfflineScopeIdentity:()=>({scope:'a'}),listOfflineMutations:async()=>[],removeOfflineMutation:async(id)=>changes.push(['removed',id]),updateOfflineMutation:async(id,info)=>changes.push(['updated',id,info])},
 '../user-state-ownership':{sameOfflineRequestContext:()=>true},
 '../offline-server-binding':{queuedWorkMatchesServerBinding:()=>({ok:true}),readOfflineServerBinding:()=>null},
 '../performance':{recordPerformanceMetric:()=>{}},
 '../version':{APP_VERSION:'0.546.0'},
 './errors':{ApiError,isOnline:()=>true},
 './transport':{rawApi:async()=>({ok:true,results:[]}),api:async()=>{throw new Error('override required')}},
 './config':{syncDeviceId:()=>''},
 './mutation-cache':{invalidateMutationCache:path=>changes.push(['invalidate',path])},
 './mutation-support':{invalidateMutationQueries:paths=>changes.push(['queries',paths])},
 './offline-replay':{retryDelay:()=>1000},
};
const module={exports:{}};
vm.runInNewContext(`${code}\nmodule.exports.__applyReplayResult=applyReplayResult;module.exports.__replaySequentially=replaySequentially;`,{
 module,exports:module.exports,require:name=>modules[name]||require(name),console,Headers,Map,Set,Promise,Date,Math,JSON,Object,String,performance
},{filename:'outbox.ts'});
const {__applyReplayResult:apply,__replaySequentially:seq}=module.exports;
const item={id:'m1',idempotencyKey:'same-valid-key',path:'/api/packets/abc/releases',method:'POST',headers:{},body:{version:'1'},invalidatePaths:['/api/packets'],attempts:0};
let total=0;
async function check(label,fn){changes.length=0;await fn();total++;console.log('PASS '+label);}
await check('successful sync batch result clears queue and invalidates projections',async()=>{
 assert.equal(await apply(item,{id:item.id,ok:true,status:204},()=>true),'ok');
 assert.deepEqual(changes.map(row=>row[0]),['removed','invalidate','queries']);
});
await check('old batch transports confirmed committed 409 without creating a conflict',async()=>{
 const result=await apply(item,{id:item.id,ok:false,status:409,payload:{code:'IDEMPOTENCY_ALREADY_COMMITTED'}},()=>true);
 assert.equal(result,'ok');assert.deepEqual(changes.map(row=>row[0]),['removed','invalidate','queries']);
});
await check('ordinary revision 409 is still a conflict and remains in queue',async()=>{
 assert.equal(await apply(item,{id:item.id,ok:false,status:409,payload:{code:'REVISION_CONFLICT'}},()=>true),'conflict');
 assert.equal(changes.length,1);assert.equal(changes[0][2].status,'conflict');
});
await check('uncertain idempotency cannot be passed off as committed',async()=>{
 assert.equal(await apply(item,{id:item.id,ok:false,status:409,payload:{code:'IDEMPOTENCY_RESULT_UNKNOWN'}},()=>true),'conflict');
 assert.equal(changes[0][2].status,'conflict');
});
await check('wrong status with copied committed code never clears mutation',async()=>{
 assert.equal(await apply(item,{id:item.id,ok:false,status:403,payload:{code:'IDEMPOTENCY_ALREADY_COMMITTED'}},()=>true),'stop');
 assert.equal(changes[0][2].status,'failed');
});
await check('after account switch no old response can touch queue',async()=>{
 assert.equal(await apply(item,{id:item.id,ok:false,status:409,payload:{code:'IDEMPOTENCY_ALREADY_COMMITTED'}},()=>false),'stop');
 assert.equal(changes.length,0);
});
await check('sequential replay clears a proven-committed retry without recording conflict',async()=>{
 modules['./transport'].api=async()=>{throw new ApiError('IDEMPOTENCY_ALREADY_COMMITTED',409)};
 await seq([item],()=>true);
 assert.deepEqual(changes.map(row=>row[0]),['removed','invalidate','queries']);
});
await check('sequential replay still flags unrelated 409 as a revision conflict',async()=>{
 modules['./transport'].api=async()=>{throw new ApiError('REVISION_CONFLICT',409)};
 await seq([item],()=>true);
 assert.equal(changes.length,1);assert.equal(changes[0][2].status,'conflict');
});
const sync=readFileSync('apps/server/src/domains/sync/sync-routes.ts','utf8');
const contract=readFileSync('packages/shared/src/api-contracts.ts','utf8');
const registry=readFileSync('packages/shared/src/error-codes.ts','utf8');
const presentation=readFileSync('packages/renderer/src/core/api/errors.ts','utf8');
await check('sync adapter maps only committed receipt into 204 success and no conflict',async()=>{
 assert.match(sync,/alreadyCommitted = response\.statusCode === 409 && \(payload as any\)\?\.code === "IDEMPOTENCY_ALREADY_COMMITTED"/);
 assert.match(sync,/alreadyDeleted \|\| alreadyCommitted \? 204/);
 assert.match(sync,/!alreadyDeleted && !alreadyCommitted && \[404, 409, 412\]/);
});
await check('error contract, UI recovery and registry explain committed private response',async()=>{
 for(const s of [contract,registry,presentation])assert.match(s,/IDEMPOTENCY_ALREADY_COMMITTED/);
 assert.match(registry,/Refresh the affected workspace/);
});
console.log(`Batch A committed retry & client-outbox recovery ${total}/${total} passed`);

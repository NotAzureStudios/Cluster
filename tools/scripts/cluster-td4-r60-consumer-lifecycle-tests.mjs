/** TD4 R60: durable registration ownership + server shutdown subscriber barrier. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/core/domain-events.ts';
const output = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }, reportDiagnostics:true });
assert.equal(output.diagnostics?.length || 0,0);
const mod = {exports:{}};
const mocks = {
  '@cluster/shared': { clusterDomainEventDescriptor:()=>null, clusterResourceAddressSchema:{parse:value=>value} },
  'node:crypto': { randomUUID:()=> 'event-generated-id' },
  './reliability-context.js': {currentReliabilityContext:()=>null,runWithReliabilityContext:(_ctx,fn)=>fn()},
};
vm.runInNewContext(output.outputText, {module:mod,exports:mod.exports,require:id=>{if(!(id in mocks)) throw Error('unexpected runtime import '+id);return mocks[id];},Buffer,Date,JSON,String,Number,Math,Set,Map,Error,Promise,process,queueMicrotask,setTimeout,clearTimeout,console}, {filename:file});
const { DurableDomainEventRuntime } = mod.exports;
let checks = 0;
async function test(label,fn){await fn();checks++;console.log('PASS',label);}
function createRuntime() {
 const writes = [];
 const db = { $executeRawUnsafe:async (sql,...params)=>{writes.push({sql,params}); return 1;}, $transaction:async fn=>fn(db),$queryRawUnsafe:async()=>[] };
 const runtime = new DurableDomainEventRuntime(db);
 runtime.pump = async()=>{}; // deterministic worker; delivery exercised directly below
 return {runtime,writes};
}
await test('required consumer ownership blocks unsafe start before any claims', async()=>{
 const {runtime} = createRuntime();
 assert.throws(()=>runtime.start([{key:'integrations.webhooks',type:'*'},{key:'notifications.materialize-activity',type:'activity.recorded'}]), /missing required consumers/);
 assert.equal(runtime.snapshot().running,false);
 assert.equal(runtime.snapshot().consumers,0);
});
await test('startup checks all required consumer keys, with a frozen delivery registry', async()=>{
 const {runtime} = createRuntime();
 runtime.subscribe('*','integrations.webhooks',()=>{});
 assert.throws(()=>runtime.start([{key:'integrations.webhooks',type:'*'},{key:'notifications.materialize-activity',type:'activity.recorded'}]), /notifications.materialize-activity/);
 runtime.subscribe('activity.recorded','notifications.materialize-activity',()=>{});
 runtime.start([{key:'integrations.webhooks',type:'*'},{key:'notifications.materialize-activity',type:'activity.recorded'}]);
 assert.equal(runtime.snapshot().running,true);
 assert.throws(()=>runtime.subscribe('activity.recorded','late.consumer',()=>{}),/while delivery is active/);
 assert.throws(()=>runtime.subscribe('*','integrations.webhooks',()=>{}),/already registered/);
 assert.equal(runtime.snapshot().consumers,2);
 await runtime.drain();
});
await test('an active consumer cannot be unregistered; draining releases its exact subscription',async()=>{
 const {runtime} = createRuntime();
 const remove = runtime.subscribe('*','integrations.webhooks',()=>{});
 runtime.start([{key:'integrations.webhooks',type:'*'}]);
 assert.throws(remove,/while delivery is active/);
 assert.equal(runtime.snapshot().consumers,1);
 await runtime.drain();
 remove();
 assert.equal(runtime.snapshot().consumers,0);
});
await test('stale unsubscribe cannot remove the next generation of the same consumer key',async()=>{
 const {runtime} = createRuntime();
 const old = runtime.subscribe('*','integrations.webhooks',()=>{});
 old();
 const current = runtime.subscribe('*','integrations.webhooks',()=>{});
 old();
 assert.deepEqual([...runtime.consumers.keys()], ['integrations.webhooks']);
 current();
 assert.equal(runtime.snapshot().consumers,0);
});
await test('drain with an executing delivery prevents deregistration and preserves completion',async()=>{
 const {runtime,writes} = createRuntime();
 let handlerStarted;
 const started = new Promise(resolve=>{handlerStarted=resolve;});
 let releaseHandler;
 const hold = new Promise(resolve=>{releaseHandler=resolve;});
 const remove = runtime.subscribe('*','integrations.webhooks',async()=>{handlerStarted(); await hold;});
 runtime.start([{key:'integrations.webhooks',type:'*'}]);
 const row={id:'evt-1',type:'activity.recorded',schemaVersion:1,payload:'{"foo":"bar"}',resourceKind:null,resourceId:null,resourceProjectId:null,
  completedConsumers:'[]',occurredAt:new Date(),workspaceId:null,actorUserId:null,projectId:null,resourceRevision:null,correlationId:null,causationId:null};
 runtime.processing = true; // pump holds this flag until delivery resolves
 const delivering=runtime.deliver(row);
 await started;
 const draining=runtime.drain();
 assert.throws(remove,/while delivery is active/);
 assert.equal(writes.length,0);
 releaseHandler();
 await delivering;
 runtime.processing = false;
 await draining;
 assert.equal(writes.length,2);
 assert.match(writes[0].sql,/completedConsumers/);
 assert.match(writes[1].sql,/processedAt/);
 remove();
 assert.equal(runtime.snapshot().consumers,0);
});
await test('a processing worker cannot restart or change registrations between drain and completion',async()=>{
 const {runtime} = createRuntime();
 runtime.processing=true;
 assert.throws(()=>runtime.start(),/previous worker has drained/);
 assert.throws(()=>runtime.subscribe('*','new.consumer',()=>{}),/while delivery is active/);
 runtime.processing=false;
 runtime.subscribe('*','integrations.webhooks',()=>{});
 runtime.start([{key:'integrations.webhooks',type:'*'}]);
 await runtime.drain();
});
const app=fs.readFileSync('apps/server/src/app/cluster-server.ts','utf8');
await test('production startup declares finite mandatory outbox consumer owners',async()=>{
 const start=app.match(/eventRuntime\.start\(\[([\s\S]*?)\]\);/);
 assert.ok(start,'required consumer list must be passed at runtime start');
 const names=[...start[1].matchAll(/key: "([a-z0-9.:-]+)"/g)].map(m=>m[1]);
 assert.deepEqual(names.slice().sort(), [
  'resource-change-runtime-wake','projects.read-model-invalidation','integrations.webhooks',
  'notifications.materialize-activity','automation.studio-activity','projects.automation-activity','search.activity-changes'
 ].sort());
 assert.equal((start[1].match(/type: CLUSTER_DOMAIN_EVENTS.activityRecorded.type/g)||[]).length,4);
 assert.equal((start[1].match(/type: "\*"/g)||[]).length,3);
 assert.ok(app.indexOf('webhooks.startEventSubscription();')<app.indexOf('eventRuntime.start(['));
});
await test('server drains the outbox before removing the webhook fanout owner',async()=>{
 const block=app.match(/onDraining:\s*async \(\) => \{([\s\S]*?)\n  \},\n  onClose:/)?.[1];
 assert.ok(block);
 assert.ok(block.indexOf('await eventRuntime.drain()')>=0);
 assert.ok(block.indexOf('await eventRuntime.drain()')<block.indexOf('webhooks.stopEventSubscription()'));
 assert.ok(block.indexOf('webhooks.stopEventSubscription()')<block.indexOf('await jobRuntime.drain()'));
});
console.log(`R60 durable-consumer lifecycle: ${checks}/${checks} checks passed`);

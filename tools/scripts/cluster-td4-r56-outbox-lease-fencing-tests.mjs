/** R56: executable lease renewal/fencing tests against the actual outbox runtime. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/core/domain-events.ts';
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022} });
assert.equal(compiled.diagnostics?.length || 0, 0);
const module = {exports:{}};
let uuid = 0;
const mocks = {
  '@cluster/shared': {clusterDomainEventDescriptor:()=>null, clusterResourceAddressSchema:{parse:v=>v}},
  'node:crypto': {randomUUID:()=>`uuid-${++uuid}`},
  './reliability-context.js': {currentReliabilityContext:()=>null,runWithReliabilityContext:(_ctx,callback)=>callback()},
};
vm.runInNewContext(compiled.outputText, {
  module, exports:module.exports, require:id=>{if (!(id in mocks)) throw Error(`Unexpected import: ${id}`);return mocks[id];},
  Buffer, Date, JSON, String, Number, Math, Set, Map, Error, Promise, process,
  queueMicrotask, setTimeout, clearTimeout, console,
}, {filename:file});
const {DurableDomainEventRuntime}=module.exports;
const sampleRow = (id='e1')=>({id, type:'activity.recorded', schemaVersion:1, payload:JSON.stringify({id:'a1'}), completedConsumers:'[]', workspaceId:'w1', actorUserId:'u1', projectId:'p1', resourceKind:'project', resourceId:'p1', resourceProjectId:'p1', resourceRevision:null, correlationId:null, causationId:null, occurredAt:new Date(), attempts:1, maxAttempts:3});
function fakeDb(){
 const records=[];
 let owns=true;
 const db={
  setOwned:value=>{owns=value;}, records,
  $executeRawUnsafe: async(sql,...params)=>{
    records.push({sql,params});
    assert.match(sql,/"leaseOwner" = \$2/);
    assert.match(sql,/"leaseExpiresAt" > NOW\(\)/);
    return owns ? 1 : 0;
  },
 };
 return db;
}
let pass=0;
async function test(name,fn){await fn();pass++;console.log('PASS',name);}
await test('every lease mutation uses owner and nonexpired fencing',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db);
 await runtime.renewLease(sampleRow());
 await runtime.markConsumerComplete(sampleRow(), new Set(), 'a');
 await runtime.succeed(sampleRow());
 await runtime.fail(sampleRow(), new Error('retry'));
 assert.equal(db.records.length,4);
});
await test('no phantom completed consumer after stolen lease',async()=>{
 const db=fakeDb();db.setOwned(false);const runtime=new DurableDomainEventRuntime(db);
 const completed=new Set();
 await assert.rejects(runtime.markConsumerComplete(sampleRow(),completed,'consumer-a'),/lease expired or was claimed/);
 assert.deepEqual([...completed],[]);
});
await test('expired owner never increments success counters',async()=>{
 const db=fakeDb();db.setOwned(false);const runtime=new DurableDomainEventRuntime(db);
 await assert.rejects(runtime.succeed(sampleRow()),/lease expired or was claimed/);
 assert.equal(runtime.snapshot().processed,0);
});
await test('expired owner cannot retry or dead-letter another worker’s claim',async()=>{
 const db=fakeDb();db.setOwned(false);const runtime=new DurableDomainEventRuntime(db);
 const row=sampleRow();row.attempts=row.maxAttempts;
 await assert.rejects(runtime.fail(row,Error('downstream')),/lease expired or was claimed/);
 assert.equal(runtime.snapshot().deadLettered,0);
 assert.equal(runtime.snapshot().consumerFailures,0);
});
await test('heartbeat renews a live slow consumer beyond one timer interval',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db,{}, {leaseMs:5000});
 await runtime.withLeaseHeartbeat(sampleRow(),async(checkLease)=>{
   await new Promise(resolve=>setTimeout(resolve,1800));checkLease();
 });
 assert.ok(db.records.length>=2,`Expected initial and background renewal, got ${db.records.length}`);
});
await test('heartbeat renewal failure fences the slow consumer outcome',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db,{}, {leaseMs:5000});
 await assert.rejects(runtime.withLeaseHeartbeat(sampleRow(),async()=>{
   // The initial lease is healthy; the heartbeat discovers a lost claim.
   db.setOwned(false);
   await new Promise(resolve=>setTimeout(resolve,1750));
 }),/lease expired or was claimed/);
});
await test('lost ownership after first handler prevents the next consumer',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db);
 let second=0;
 runtime.subscribe('activity.recorded','a', async()=>{db.setOwned(false);});
 runtime.subscribe('activity.recorded','b', async()=>{second++;});
 await assert.rejects(runtime.deliver(sampleRow(),()=>{}),/lease expired or was claimed/);
 assert.equal(second,0);
 assert.equal(runtime.snapshot().processed,0);
});
await test('normal consumer delivery checkpoints and completes only while owned',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db);
 const actions=[];
 runtime.subscribe('activity.recorded','a',async()=>actions.push('a'));
 runtime.subscribe('activity.recorded','b',async()=>actions.push('b'));
 await runtime.deliver(sampleRow(),()=>{});
 assert.deepEqual(actions,['a','b']);
 assert.equal(runtime.snapshot().processed,1);
 const checkpoints=db.records.filter(x=>x.sql.includes('"completedConsumers" = $3'));
 assert.deepEqual(JSON.parse(checkpoints[1].params[2]),['a','b']);
});
await test('actual pump abandons a stolen claim without acknowledging or retrying',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db,{}, {batchSize:2});
 let next=0;
 runtime.claim=async()=>next++===0?sampleRow('pumped'):null;
 // Durable subscribers must be composed before the worker enters its active state.
 runtime.subscribe('activity.recorded','a-owner',async()=>{db.setOwned(false);});
 runtime.subscribe('activity.recorded','b-follower',async()=>{throw Error('must not run');});
 runtime.started=true;
 await runtime.pump();
 assert.equal(runtime.snapshot().processed,0);
 assert.equal(runtime.snapshot().consumerFailures,0);
 assert.equal(db.records.filter(r=>r.sql.includes('"lastError" = $3')).length,0);
 await runtime.drain();
});
await test('actual pump reports an owned consumer error through durable retry',async()=>{
 const db=fakeDb();const runtime=new DurableDomainEventRuntime(db,{}, {batchSize:2});
 let next=0;
 runtime.claim=async()=>next++===0?sampleRow('failed'):null;
 // R60 startup freezes the durable consumer registry.
 runtime.subscribe('activity.recorded','failing',async()=>{throw Error('temporary outage');});
 runtime.started=true;
 await runtime.pump();
 assert.equal(runtime.snapshot().consumerFailures,1);
 assert.equal(runtime.snapshot().processed,0);
 assert.equal(db.records.filter(r=>r.sql.includes('"lastError" = $3')).length,1);
 await runtime.drain();
});
console.log(`R56 outbox lease fencing: ${pass}/${pass} checks passed`);

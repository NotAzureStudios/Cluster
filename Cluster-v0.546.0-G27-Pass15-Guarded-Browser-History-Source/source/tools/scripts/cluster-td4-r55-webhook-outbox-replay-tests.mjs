/** TD4 R55: executable webhook outbox subscriber retry, dedupe and fanout checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/domains/integrations/webhook-service.ts';
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let nextId = 0;
const crypto = { randomUUID: () => `delivery-${++nextId}`, createHash: () => ({ update: () => ({ digest: () => 'hash' }) }) };
const callbacks = [];
const endpoint = (id, projectId = null, eventTypes = '["activity.recorded"]') => ({ id, enabled: true, workspaceId: 'W1', projectId, eventTypes, createdById: 'U1' });
const endpoints = [endpoint('a'), endpoint('b'), endpoint('c')];
const deliveries = new Map();
const calls = [];
let failCreate = null;
let failEnqueue = null;
let endpointReadsFail = false;
const prisma = {
  integrationWebhookEndpoint: {
    findMany: async ({ where, cursor }) => {
      if (endpointReadsFail) throw Error('endpoint query outage');
      const start = cursor ? endpoints.findIndex(e => e.id === cursor.id) + 1 : 0;
      return endpoints.slice(start).filter(e => e.workspaceId === where.workspaceId && e.enabled &&
        (where.projectId === null ? e.projectId === null : !e.projectId || e.projectId === where.OR?.[1]?.projectId));
    },
  },
  integrationWebhookDelivery: {
    create: async ({data}) => {
      calls.push(`create:${data.endpointId}`);
      if (failCreate === data.endpointId) throw Error('temporary database error');
      const key = `${data.endpointId}:${data.eventId}`;
      if (deliveries.has(key)) throw Object.assign(Error('unique'), {code:'P2002'});
      const row = {...data, status:'PENDING', attempts:0};
      deliveries.set(key, row);
      return row;
    },
    findUnique: async ({where}) => {
      const composite = where.endpointId_eventId;
      return composite ? deliveries.get(`${composite.endpointId}:${composite.eventId}`) || null : null;
    },
  },
};
const queue = { enqueue: async job => {
  calls.push(`queue:${job.payload.deliveryId}`);
  if (failEnqueue === job.payload.deliveryId) throw Error('temporary queue failure');
  return {id:'job'};
}};
const mocks = {
  'node:crypto': {default:crypto,randomUUID:crypto.randomUUID},
  '../../core/circuit-breaker.js': {CircuitBreaker: class {} , CircuitOpenError: class extends Error {}},
  '../../core/reliability-context.js': {currentReliabilityContext:()=>({workspaceId:'W1'})},
  '../../core/outbound-http.js': {secureOutboundFetch:()=>{}, validateOutboundUrl:()=>new URL('https://example.com')},
  '../../core/setting-crypto.js': {encryptSecuritySecret:(_purpose,value)=>value, decryptSecuritySecret:(_purpose,value)=>value},
};
const mod = {exports:{}};
vm.runInNewContext(output, {module:mod,exports:mod.exports,require:id=>{if(!(id in mocks)) throw Error('unexpected import '+id);return mocks[id];}, Buffer, Date, JSON, String, Number, Math, Set, Map, Error, Array, Promise, console, performance, URL}, {filename:file});
const events = {subscribe: (type, key, handler)=> { callbacks.push({type,key,handler}); return ()=>callbacks.pop(); }};
const service = mod.exports.createWebhookIntegrationService({prisma,queue,events,credentials:{}});
const activity = {id:'event-1',type:'activity.recorded',schemaVersion:1,workspaceId:'W1',projectId:'P1',occurredAt:new Date('2026-10-15T12:00:00Z'),payload:{id:'activity-1'}};
let passed = 0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
await test('webhook outbox subscribes only once and unsubscribes cleanly',async()=>{
  service.startEventSubscription();service.startEventSubscription();
  assert.equal(callbacks.length,1);assert.equal(callbacks[0].type,'*');
});
await test('one endpoint failure does not prevent healthy siblings from materializing',async()=>{
  failCreate='b';
  await assert.rejects(callbacks[0].handler(activity), /durable replay required/);
  assert.ok(deliveries.has('a:event-1'));assert.ok(deliveries.has('c:event-1'));
  assert.ok(!deliveries.has('b:event-1'));
});
await test('replay only creates missing recipient and requeues pending existing deliveries',async()=>{
  failCreate=null; calls.length=0;
  await callbacks[0].handler(activity);
  assert.equal(deliveries.size,3);
  assert.equal(calls.filter(x=>x==='create:b').length,1);
  assert.equal(calls.filter(x=>x.startsWith('queue:')).length,3);
});
await test('second replay remains idempotent on delivery row identities',async()=>{
  await callbacks[0].handler(activity);
  assert.equal(deliveries.size,3);
});
await test('created delivery with queue failure is recovered on next outbox replay',async()=>{
  const changed={...activity,id:'event-2'};
  failEnqueue=`delivery-${nextId+1}`;
  await assert.rejects(callbacks[0].handler(changed),/durable replay required/);
  assert.equal(deliveries.size,6);
  failEnqueue=null;
  calls.length=0;
  await callbacks[0].handler(changed);
  assert.equal(deliveries.size,6);
  assert.equal(calls.filter(x=>x.startsWith('queue:')).length,3);
});
await test('already delivered recipients are never re-enqueued on replay',async()=>{
  const row=deliveries.get('a:event-2');row.status='SUCCEEDED';
  calls.length=0;
  await callbacks[0].handler({...activity,id:'event-2'});
  assert.ok(!calls.includes(`queue:${row.id}`));
});
await test('failed endpoint query fails subscriber instead of acknowledging event',async()=>{
  endpointReadsFail=true;
  await assert.rejects(callbacks[0].handler(activity),/endpoint query outage/);
  endpointReadsFail=false;
});
await test('a project-specific webhook does not receive unrelated project events',async()=>{
  endpoints.push(endpoint('z','P2'));
  await callbacks[0].handler({...activity,id:'event-3'});
  assert.ok(!deliveries.has('z:event-3'));
});
await test('stopping integration subscription leaves no active outbox consumer',async()=>{
  service.stopEventSubscription();
  assert.equal(callbacks.length,0);
});
console.log(`R55 webhook outbox replay: ${passed}/${passed} checks passed`);

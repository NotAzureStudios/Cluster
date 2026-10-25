/** TD4 R76: fail-closed outbox drain and signed-off signal-only assignment contract. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const sourceFile = 'apps/server/src/core/domain-events.ts';
const code = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(code.diagnostics?.length || 0, 0);
const module = { exports: {} };
const mocks = {
  '@cluster/shared': { clusterDomainEventDescriptor: () => null, clusterResourceAddressSchema: { parse: value => value } },
  'node:crypto': { randomUUID: () => 'generated-event-id' },
  './reliability-context.js': { currentReliabilityContext: () => null, runWithReliabilityContext: (_ctx, run) => run() },
};
vm.runInNewContext(code.outputText, {
  module, exports: module.exports,
  require: id => { if (!(id in mocks)) throw new Error(`Unexpected import ${id}`); return mocks[id]; },
  Buffer, Date, JSON, String, Number, Math, Set, Map, Error, Promise, process, queueMicrotask, setTimeout, clearTimeout, console,
}, { filename: sourceFile });
const { DurableDomainEventRuntime } = module.exports;
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('PASS', label); }
function createRuntime(options = {}) {
  const writes = [];
  const db = { $executeRawUnsafe: async (sql, ...args) => { writes.push([sql, args]); return 1; }, $transaction: async f => f(db), $queryRawUnsafe: async () => [] };
  const events = new DurableDomainEventRuntime(db, {}, options);
  events.pump = async () => {};
  return { events, writes };
}
function row(type = 'activity.recorded') { return {
  id: `evt-${type}`, type, schemaVersion: 1, payload: '{"resource":{"kind":"project","id":"P1"},"kind":"owner"}',
  resourceKind: type === 'work.assignment.changed' ? 'project' : null,
  resourceId: type === 'work.assignment.changed' ? 'P1' : null,
  resourceProjectId: null, completedConsumers: '[]', occurredAt: new Date(), workspaceId: null,
  actorUserId: null, projectId: null, resourceRevision: null, correlationId: null, causationId: null,
}; }
await check('timeout is a rejected shutdown barrier, not a success result', async () => {
  const { events } = createRuntime({ drainTimeoutMs: 25 });
  events.processing = true;
  await assert.rejects(events.drain(), /drain timed out/);
  assert.equal(events.snapshot().running, false);
  assert.equal(events.snapshot().processing, true);
});
await check('a timeout cannot permit subscriber disposal while a handler remains active', async () => {
  const { events } = createRuntime({ drainTimeoutMs: 25 });
  const dispose = events.subscribe('*', 'integrations.webhooks', () => {});
  events.start([{ key: 'integrations.webhooks', type: '*' }]);
  events.processing = true;
  await assert.rejects(events.drain(), /consumers must remain registered/);
  assert.throws(dispose, /while delivery is active/);
  assert.equal(events.snapshot().consumers, 1);
  assert.throws(() => events.start(), /previous worker has drained/);
  events.processing = false;
  await events.drain();
  dispose();
  assert.equal(events.snapshot().consumers, 0);
});
await check('successful drain permits unsubscription after processing settles', async () => {
  const { events } = createRuntime({ drainTimeoutMs: 300 });
  const dispose = events.subscribe('*', 'integrations.webhooks', () => {});
  events.start([{ key: 'integrations.webhooks', type: '*' }]);
  events.processing = true;
  const pending = events.drain();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.throws(dispose, /while delivery is active/);
  events.processing = false;
  await pending;
  dispose();
  assert.equal(events.snapshot().consumers, 0);
});
await check('drain closes idle timer and prevents future claims', async () => {
  const { events } = createRuntime();
  events.subscribe('*', 'integrations.webhooks', () => {});
  events.start([{ key: 'integrations.webhooks', type: '*' }]);
  await events.drain();
  assert.equal(events.snapshot().running, false);
  assert.equal(events.timer, null);
  events.wake();
  assert.equal(events.timer, null);
});
await check('outbox signal reaches wildcard consumers and is acknowledged once', async () => {
  const { events, writes } = createRuntime();
  let wake = 0, projection = 0, webhooks = 0;
  events.subscribe('*', 'resource-change-runtime-wake', () => { wake++; });
  events.subscribe('*', 'projects.read-model-invalidation', () => { projection++; });
  events.subscribe('*', 'integrations.webhooks', () => { webhooks++; });
  await events.deliver(row('work.assignment.changed'));
  assert.deepEqual([wake, projection, webhooks], [1,1,1]);
  assert.equal(writes.filter(([sql]) => sql.includes('completedConsumers')).length, 3);
  assert.equal(writes.filter(([sql]) => /SET \"processedAt\" = NOW\(\)/.test(sql)).length, 1);
});
await check('activity-only consumers do not receive signal-only assignment events', async () => {
  const { events } = createRuntime();
  let activity = 0, wildcard = 0;
  events.subscribe('activity.recorded', 'notifications.materialize-activity', () => { activity++; });
  events.subscribe('*', 'integrations.webhooks', () => { wildcard++; });
  await events.deliver(row('work.assignment.changed'));
  assert.equal(activity, 0);
  assert.equal(wildcard, 1);
});
await check('activity event still reaches its explicitly owned materializer', async () => {
  const { events } = createRuntime();
  let activity = 0, wildcard = 0;
  events.subscribe('activity.recorded', 'notifications.materialize-activity', () => { activity++; });
  events.subscribe('*', 'integrations.webhooks', () => { wildcard++; });
  await events.deliver(row('activity.recorded'));
  assert.equal(activity, 1);
  assert.equal(wildcard, 1);
});
const app = fs.readFileSync('apps/server/src/app/cluster-server.ts', 'utf8');
const registry = fs.readFileSync('packages/shared/src/domain-event-registry.ts', 'utf8');
await check('production outbox shutdown awaits full drain before removing fanout', () => {
  const block = app.match(/onDraining:\s*async \(\) => \{([\s\S]*?)\n  \},\n  onClose:/)?.[1];
  assert.ok(block);
  assert.ok(block.indexOf('await eventRuntime.drain()') < block.indexOf('webhooks.stopEventSubscription()'));
  assert.ok(!block.includes('eventRuntime.drain().catch'), 'failing drain must not be swallowed');
});
await check('assignment-specific materializer is not registered into historical outbox without backfill', () => {
  const ownerList = app.match(/eventRuntime\.start\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(ownerList);
  assert.equal([...ownerList.matchAll(/key:/g)].length, 7);
  assert.doesNotMatch(ownerList, /work\.assignment\.changed|assignment\.materialize/);
  assert.match(app, /signal.*consumed/);
});
await check('event registry explicitly classifies assignment changes as signal-only', () => {
  assert.match(registry, /description:.*signal-only event/);
  assert.match(registry, /type: "work.assignment.changed"/);
});
await check('storage destructive operations remain disabled at source boundary', () => {
  const roadmap = fs.readFileSync('IMPLEMENTATION_ROADMAP_R75.md', 'utf8');
  assert.match(roadmap, /Actual quarantine, physical delete, managed-blob reclamation and tier migration remain \*\*disabled\*\*/);
});
console.log(`R76 TD4 final outbox lifecycle: ${passed}/${passed} checks passed`);

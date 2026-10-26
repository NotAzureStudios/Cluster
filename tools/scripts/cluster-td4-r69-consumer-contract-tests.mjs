/** R69: executable durable subscription ownership and canonical event scope checks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const file = 'apps/server/src/core/domain-events.ts';
const source = readFileSync(file, 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(code.diagnostics?.length || 0, 0);
const mod = { exports: {} };
const mocks = {
  '@cluster/shared': { clusterDomainEventDescriptor: () => null, clusterResourceAddressSchema: { parse: value => value } },
  'node:crypto': { randomUUID: () => 'generated-event-id' },
  './reliability-context.js': { currentReliabilityContext: () => null, runWithReliabilityContext: (_ctx, run) => run() },
};
vm.runInNewContext(code.outputText, { module: mod, exports: mod.exports, require: id => { if (!(id in mocks)) throw Error(`unexpected import ${id}`); return mocks[id]; }, Buffer, Date, JSON, String, Number, Math, Set, Map, Error, Promise, process, queueMicrotask, setTimeout, clearTimeout, console }, { filename: file });
const { DurableDomainEventRuntime } = mod.exports;
let passed = 0;
async function check(label, run) { await run(); passed++; console.log('PASS', label); }
function runtime() {
  const db = { $transaction: async fn => fn(db), $executeRawUnsafe: async () => 1, $queryRawUnsafe: async () => [] };
  const inst = new DurableDomainEventRuntime(db);
  inst.pump = async () => {};
  return inst;
}
const activity = { key: 'notifications.materialize-activity', type: 'activity.recorded' };
const webhook = { key: 'integrations.webhooks', type: '*' };
await check('missing required subscriber blocks startup', () => {
  const events = runtime();
  assert.throws(() => events.start([activity]), /missing required consumers/);
  assert.equal(events.snapshot().running, false);
});
await check('known key registered for the wrong event family cannot acknowledge work', () => {
  const events = runtime();
  events.subscribe('work.assignment.changed', activity.key, () => {});
  assert.throws(() => events.start([activity]), /notifications.materialize-activity \(activity.recorded\)/);
  assert.equal(events.snapshot().running, false);
});
await check('wildcard may not masquerade as required exact event subscription', () => {
  const events = runtime();
  events.subscribe('*', activity.key, () => {});
  assert.throws(() => events.start([activity]), /missing required consumers/);
});
await check('exact subscription may not masquerade as a mandatory wildcard owner', () => {
  const events = runtime();
  events.subscribe('activity.recorded', webhook.key, () => {});
  assert.throws(() => events.start([webhook]), /missing required consumers/);
});
await check('duplicate required keys fail closed before startup', () => {
  const events = runtime();
  events.subscribe('*', webhook.key, () => {});
  assert.throws(() => events.start([webhook, webhook]), /Duplicate required domain event consumer/);
  assert.equal(events.snapshot().running, false);
});
await check('invalid type and invalid owner key reject before startup', () => {
  const events = runtime();
  assert.throws(() => events.start([{ key: 'Bad Owner Key', type: '*' }]), /consumer key is invalid/);
  assert.throws(() => events.start([{ key: 'example', type: 'has spaces' }]), /event type is invalid/);
});
await check('valid exact and wildcard subscriber owners satisfy runtime admission', async () => {
  const events = runtime();
  events.subscribe('*', webhook.key, () => {});
  events.subscribe('activity.recorded', activity.key, () => {});
  events.start([webhook, activity]);
  assert.equal(events.snapshot().running, true);
  await events.drain();
});
await check('canonical unscoped resource remains unscoped despite contextual Project', async () => {
  const params = [];
  const tx = { $queryRawUnsafe: async (sql, ...values) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('INSERT INTO "DomainEventOutbox"')) { params.push(values); return [{ id: values[0] }]; }
    throw Error('unexpected SQL');
  } };
  const events = runtime();
  await events.appendInTransaction(tx, {
    id: 'packet-activity', type: 'activity.recorded', schemaVersion: 1,
    projectId: 'P-context', resource: { kind: 'packet', id: 'packet-A' }, payload: { id: 'a1' },
  });
  assert.equal(params[0][7], 'P-context', 'Project context is retained as event metadata');
  assert.equal(params[0][8], 'packet');
  assert.equal(params[0][9], 'packet-A');
  assert.equal(params[0][10], null, 'resource address never borrows Project context');
});
await check('explicit Project resource placement remains durable and authoritative', async () => {
  const params = [];
  const tx = { $queryRawUnsafe: async (sql, ...values) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('INSERT INTO "DomainEventOutbox"')) { params.push(values); return [{ id: values[0] }]; }
    throw Error('unexpected SQL');
  } };
  await runtime().appendInTransaction(tx, { id: 'card-activity', type: 'activity.recorded', schemaVersion: 1,
    projectId: 'context-P1', resource: { kind: 'card', id: 'card-A', projectId: 'owning-P2' }, payload: {} });
  assert.equal(params[0][7], 'context-P1');
  assert.equal(params[0][10], 'owning-P2');
});
const app = readFileSync('apps/server/src/app/cluster-server.ts', 'utf8');
await check('production manifest contains seven typed owner obligations, no untyped placeholders', () => {
  const registration = app.match(/eventRuntime\.start\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(registration);
  const keys = [...registration.matchAll(/key: "([a-z0-9.:-]+)"/g)].map(m => m[1]);
  assert.equal(keys.length, 7);
  assert.equal(new Set(keys).size, 7);
  assert.equal((registration.match(/type: "\*"/g) || []).length, 3);
  assert.equal((registration.match(/type: CLUSTER_DOMAIN_EVENTS\.activityRecorded\.type/g) || []).length, 4);
  assert.equal((registration.match(/type:/g) || []).length, 7);
});
await check('all seven subscriber declarations retain their intended owners', () => {
  const server = app;
  const readModel = readFileSync('apps/server/src/app/server-read-model-runtime.ts', 'utf8');
  const notification = readFileSync('apps/server/src/domains/notifications/notification-service.ts', 'utf8');
  const studio = readFileSync('apps/server/src/domains/automation/studio-automation-event-bridge.ts', 'utf8');
  const project = readFileSync('apps/server/src/domains/projects/project-automation-service.ts', 'utf8');
  const webhookOwner = readFileSync('apps/server/src/domains/integrations/webhook-service.ts', 'utf8');
  for (const [s, owner] of [[server, 'resource-change-runtime-wake'], [readModel, 'projects.read-model-invalidation'],
    [server, 'search.activity-changes'], [notification, 'notifications.materialize-activity'],
    [studio, 'automation.studio-activity'], [project, 'projects.automation-activity'],
    [webhookOwner, 'integrations.webhooks']]) assert.ok(s.includes(`"${owner}"`), `missing composition subscriber ${owner}`);
});
console.log(`R69 consumer contract: ${passed}/${passed} checks passed`);

/** TD4 R54: executable outbox identity, typed payload and consumer retry tests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const source = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, mocks, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(source(file), { module: mod, exports: mod.exports,
    require: (id) => { if (!(id in mocks)) throw Error(`Missing mock ${id}`); return mocks[id]; },
    console, process, Date, Promise, Number, Math, String, BigInt, Boolean, Buffer, JSON, Error, Array, Map, Set,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, ...globals,
  }, { filename: file });
  return mod.exports;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
const known = {
  'activity.recorded': { schemaVersion: 1, payloadSchema: { parse(value) {
    if (!value || !String(value.id || '').trim() || !String(value.type || '').trim() || !String(value.entityType || '').trim()) throw Error('invalid activity payload');
    return value;
  } } },
  'work.assignment.changed': { schemaVersion: 1, payloadSchema: { parse(value) {
    if (!value || !value.resource?.kind || !value.resource?.id || !value.kind) throw Error('invalid assignment payload');
    return value;
  } } },
};
const shared = {
  clusterDomainEventDescriptor: type => known[type] || null,
  clusterResourceAddressSchema: { parse(value) { if (!value?.kind || !value?.id) throw Error('invalid resource'); return value; } },
};
const { DurableDomainEventRuntime } = load('apps/server/src/core/domain-events.ts', {
  '@cluster/shared': shared,
  'node:crypto': { randomUUID: () => 'generated-id' },
  './reliability-context.js': { currentReliabilityContext: () => null, runWithReliabilityContext: (_ctx, fn) => fn() },
});
let inserted = null;
let lockTaken = false;
const writes = [];
const db = {
  $transaction: async fn => fn(db),
  $queryRawUnsafe: async (query, ...values) => {
    if (query.includes('pg_advisory_xact_lock')) { lockTaken = true; return []; }
    if (query.includes('INSERT INTO "DomainEventOutbox"')) {
      assert.equal(lockTaken, true, 'the outbox lock must precede insertion');
      if (inserted) return [];
      inserted = {
        id: values[0], type: values[1], schemaVersion: values[2], workspaceId: values[3],
        correlationId: values[4], causationId: values[5], actorUserId: values[6], projectId: values[7],
        resourceKind: values[8], resourceId: values[9], resourceProjectId: values[10], resourceRevision: values[11],
        payload: values[12], occurredAt: values[13], completedConsumers: '[]', sequence: 1n,
      };
      return [inserted];
    }
    if (query.includes('SELECT * FROM "DomainEventOutbox"')) return inserted ? [inserted] : [];
    throw Error(`Unexpected query ${query}`);
  },
  $executeRawUnsafe: async (query, ...values) => { writes.push({ query, values }); return 1; },
};
const runtime = new DurableDomainEventRuntime(db);
const activity = (overrides={}) => ({ id: 'event-1', type: 'activity.recorded', schemaVersion: 1,
  occurredAt: new Date('2026-10-15T12:00:00Z'), actorUserId: 'U1', projectId: 'P1',
  resource: { kind: 'project', id: 'P1', projectId: 'P1' }, resourceRevision: '2',
  payload: { id:'activity-1', type: 'updated', entityType: 'project' }, ...overrides });
await check('known event is committed with the canonical ordering lock', async () => {
  await runtime.appendInTransaction(db, activity());
  assert.equal(inserted.resourceId, 'P1');
  assert.equal(inserted.actorUserId, 'U1');
});
await check('a legitimate same-ID retry is idempotent', async () => {
  const row = await runtime.appendInTransaction(db, activity());
  assert.equal(row.id, 'event-1');
});
await check('reusing an event ID with a different resource is rejected', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({ resource: { kind:'project', id:'P2' } })), /reused for a different event/);
});
await check('reusing an event ID with a different actor is rejected', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({ actorUserId: 'U2' })), /reused for a different event/);
});
await check('reusing an event ID with another workspace or revision is rejected', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({ workspaceId:'W2' })), /reused for a different event/);
  await assert.rejects(runtime.appendInTransaction(db, activity({ resourceRevision:'3' })), /reused for a different event/);
});
await check('known event schemas validate before persistence', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({ payload:{ id: 'missing-kind' } })), /invalid activity payload/);
  await assert.rejects(runtime.appendInTransaction(db, activity({ schemaVersion: 2 })), /Unsupported schema version/);
});
await check('assignment payload cannot claim another resource identity', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({ type:'work.assignment.changed', payload: { kind:'owner', resource:{ kind:'project', id:'P999' } } })), /does not match/);
});
await check('assignment payload cannot claim a different project scope', async () => {
  await assert.rejects(runtime.appendInTransaction(db, activity({
    type:'work.assignment.changed',
    payload: { kind:'owner', resource:{ kind:'project', id:'P1', projectId:'P999' } },
  })), /does not match/);
});
await check('invalid persisted JSON cannot advance a consumer checkpoint', async () => {
  const bad = { ...inserted, payload: '{corrupt', type:'activity.recorded' };
  await assert.rejects(runtime.deliver(bad), /Invalid persisted payload/);
  assert.equal(writes.length, 0);
});
await check('invalid known persisted event cannot reach subscribers', async () => {
  let called = 0;
  runtime.subscribe('activity.recorded', 'test-consumer', async () => { called++; });
  const bad = { ...inserted, payload:'{}', type:'activity.recorded' };
  await assert.rejects(runtime.deliver(bad), /invalid activity payload/);
  assert.equal(called, 0);
  assert.equal(writes.length, 0);
});
await check('valid typed persisted event invokes consumer and records completion', async () => {
  let called = 0;
  runtime.subscribe('activity.recorded', 'second-consumer', async () => { called++; });
  await runtime.deliver(inserted);
  assert.equal(called, 1);
  assert.ok(writes.some(w => w.query.includes('"completedConsumers"')));
  assert.ok(writes.some(w => w.query.includes('"processedAt"')));
});
// Exercise the actual Notification Inbox subscriber, including partial fanout.
const captured = {};
let failureUser = 'U2';
const delivered = new Set();
const repository = {
  recipientUsersForActivity: async () => [{id:'U1'}, {id:'U2'}],
  deliver: async (_record, ids) => {
    const id = ids[0];
    if (failureUser === id) { failureUser = null; throw Error('temporary notification storage outage'); }
    if (delivered.has(id)) return {count:0,records:[]};
    delivered.add(id);
    return {count:1,records:[{id:`notification-${id}`,userId:id}]};
  },
};
const notifShared = {
  CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type:'activity.recorded' } },
  CLUSTER_NOTIFICATION_CATEGORIES: ['activity', 'work', 'system'],
  CLUSTER_NOTIFICATION_PRIORITIES: ['normal','high','critical'],
  CLUSTER_NOTIFICATION_SIGNALS: ['activity','failure','assignment'],
  CLUSTER_NOTIFICATION_TOOLS: ['project', 'builds'],
  clusterResourceAddressFromEntity: () => null,
  clusterResourceKindFromEntityType: () => null,
};
const {createNotificationService} = load('apps/server/src/domains/notifications/notification-service.ts', {
  '@cluster/shared': notifShared,
  '../../core/cursor-pagination.js': { buildCursorPage:()=>({}) },
  './notification-repository.js': { createNotificationRepository:()=>repository },
  '../comments/subscription-service.js': { createSubscriptionService:()=>({ recipientIds:async()=>[] }), notificationWatchScope:()=> 'all' },
  '../../core/bounded-cache.js': { BoundedCache: class { deleteWhere(){} clear(){} getOrLoad(_k,_o,fn){return fn()} } },
  './notification-policy.js': { evaluateNotificationPolicy:()=>({store:true,deliveryMode:'in_app',interruptive:false,quietHours:false,projectMode:'all',toolMode:'all',priorityFloor:'normal',priority:'normal'}) },
  './notification-lifecycle.js': { NOTIFICATION_RETENTION:{}, notificationDigestSlot:()=>'', notificationEscalationLevel:()=>0, notificationEscalationPriority:()=> 'normal' },
});
const notificationService = createNotificationService({ prisma:{}, events: {subscribe:(_type,key,fn)=>{captured[key]=fn;}}, logger:{warn(){}}, publishSummaryInvalidation:()=>{} });
const domainEvent = { payload: { id:'activity-1', type:'failed', entityType:'build', title:'Build failed', createdAt:new Date(), metadata:{} } };
await check('notification subscriber rejects a partial fanout so the outbox retries', async () => {
  await assert.rejects(captured['notifications.materialize-activity'](domainEvent), /temporary notification storage outage/);
  assert.deepEqual([...delivered], ['U1']);
});
await check('outbox replay completes only undelivered recipients, with no duplicates', async () => {
  await captured['notifications.materialize-activity'](domainEvent);
  assert.deepEqual([...delivered], ['U1','U2']);
});
await check('temporary notification ACL lookup outage rejects durable delivery instead of silently muting a recipient', async () => {
  delivered.clear();
  let failed = false;
  notificationService.setVisibilityFilter(async (userId, records) => {
    if (userId === 'U2' && !failed) { failed = true; throw Error('temporary permission store outage'); }
    return records;
  });
  await assert.rejects(captured['notifications.materialize-activity'](domainEvent), /temporary permission store outage/);
  assert.deepEqual([...delivered], ['U1']);
  await captured['notifications.materialize-activity'](domainEvent);
  assert.deepEqual([...delivered], ['U1','U2']);
  notificationService.setVisibilityFilter(null);
});
const registry = fs.readFileSync('packages/shared/src/domain-event-registry.ts','utf8');
await check('shared registry owns concrete known payload validation contracts', () => {
  assert.match(registry,/activityRecordedPayloadSchema = z\.object/);
  assert.match(registry,/assignmentChangedPayloadSchema = z\.object/);
  assert.match(registry,/payloadSchema: activityRecordedPayloadSchema/);
  assert.match(registry,/payloadSchema: assignmentChangedPayloadSchema/);
});
console.log(`${passed}/${passed} TD4 R54 typed-consumer retry checks passed`);

/** R59: test canonical event resource lanes and persisted event identity boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const filename = 'apps/server/src/core/domain-events.ts';
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.equal(output.diagnostics?.length || 0, 0);
const module = { exports: {} };
const assignmentSchema = { parse(value) {
  if (!value || !value.resource?.kind || !value.resource?.id || !value.kind) throw Error('invalid assignment payload');
  return value;
} };
const mocks = {
  '@cluster/shared': {
    clusterDomainEventDescriptor: type => type === 'work.assignment.changed' ? { schemaVersion: 1, payloadSchema: assignmentSchema } : null,
    clusterResourceAddressSchema: { parse(value) { if (!['project', 'card', 'source_commit', 'packet'].includes(value?.kind) || !value.id) throw Error('invalid canonical resource address'); return value; } },
  },
  'node:crypto': { randomUUID: () => 'new-event' },
  './reliability-context.js': { currentReliabilityContext: () => null, runWithReliabilityContext: (_context, handler) => handler() },
};
vm.runInNewContext(output.outputText, {
  module, exports: module.exports, require: id => { if (!(id in mocks)) throw Error(`unmocked dependency ${id}`); return mocks[id]; },
  Buffer, Date, JSON, String, Number, Math, Set, Map, Error, Promise, process,
  queueMicrotask, setTimeout, clearTimeout, console,
}, { filename });
const { DurableDomainEventRuntime } = module.exports;
const sqlClaim = source.match(/WITH candidate AS \([\s\S]*?RETURNING event\.\*`/)?.[0];
assert.ok(sqlClaim, 'read the actual SQL claim from the canonical runtime');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
await test('the indexed PostgreSQL schema supports resource predecessor lookups without migration', () => {
  assert.match(fs.readFileSync('apps/server/prisma/schema.prisma','utf8'), /@@index\(\[resourceKind, resourceId, sequence\]\)/);
  assert.match(fs.readFileSync('apps/server/prisma/migrations/20260911034000_backend_resource_outbox_foundation/migration.sql','utf8'), /DomainEventOutbox_resourceKind_resourceId_sequence_idx/);
});
await test('the claim blocks an earlier pending canonical resource revision', () => {
  assert.match(sqlClaim, /predecessor\."resourceKind" = "DomainEventOutbox"\."resourceKind"/);
  assert.match(sqlClaim, /predecessor\."resourceId" = "DomainEventOutbox"\."resourceId"/);
  assert.match(sqlClaim, /predecessor\."sequence" < "DomainEventOutbox"\."sequence"/);
  assert.match(sqlClaim, /predecessor\."processedAt" IS NULL/);
  assert.match(sqlClaim, /predecessor\."deadLetteredAt" IS NULL/);
  assert.match(sqlClaim, /ORDER BY "availableAt" ASC, "sequence" ASC/);
  assert.match(sqlClaim, /FOR UPDATE SKIP LOCKED/);
  assert.match(sqlClaim, /"resourceKind" IS NULL OR "resourceId" IS NULL/);
});
let records = [];
let simulatedNow = Date.now();
function event(sequence, kind, id, options = {}) {
  return { id: `event-${sequence}`, sequence: BigInt(sequence), resourceKind: kind, resourceId: id, resourceProjectId: options.projectId || null,
    availableAt: options.availableAt ?? simulatedNow, processedAt: options.processedAt || null, deadLetteredAt: options.deadLetteredAt || null,
    attempts: options.attempts || 0, maxAttempts: 12, leaseOwner: options.leaseOwner || null, leaseExpiresAt: options.leaseExpiresAt || null,
  };
}
// Execute the same ordering predicate as the SQL via a small controlled row
// simulator. This is not a PostgreSQL acceptance test; the SQL text assertions
// above make the test fail if the actual claim loses the predicate.
function dbForClaim() {
  const db = {
    $transaction: async fn => fn(db),
    $executeRawUnsafe: async sql => { if (!sql.includes('"deadLetteredAt"')) throw Error('unexpected mutation'); return 0; },
    $queryRawUnsafe: async (sql, owner, leaseMs) => {
      assert.match(sql, /WITH candidate AS/);
      const eligible = records.filter(candidate =>
        !candidate.processedAt && !candidate.deadLetteredAt && candidate.attempts < candidate.maxAttempts &&
        candidate.availableAt <= simulatedNow && (!candidate.leaseExpiresAt || candidate.leaseExpiresAt < simulatedNow) &&
        (!candidate.resourceKind || !candidate.resourceId || !records.some(prior =>
          prior.resourceKind === candidate.resourceKind && prior.resourceId === candidate.resourceId &&
          prior.sequence < candidate.sequence && !prior.processedAt && !prior.deadLetteredAt)));
      eligible.sort((a, b) => a.availableAt - b.availableAt || Number(a.sequence - b.sequence));
      const selected = eligible[0];
      if (!selected) return [];
      selected.leaseOwner = owner;
      selected.leaseExpiresAt = simulatedNow + leaseMs;
      selected.attempts++;
      return [selected];
    },
  };
  return db;
}
const runtime = new DurableDomainEventRuntime(dbForClaim());
await test('failed early event holds later same-resource work during backoff', async () => {
  records = [event(1, 'project', 'A', { availableAt: simulatedNow + 30_000 }), event(2, 'project', 'A')];
  assert.equal(await runtime.claim(), null);
  assert.equal(records[1].attempts, 0);
});
await test('unrelated resource proceeds while another resource retries', async () => {
  records.push(event(3, 'project', 'B'));
  assert.equal((await runtime.claim())?.id, 'event-3');
});
await test('leased predecessor blocks a second worker, even when newer work is ready', async () => {
  records = [event(1, 'card', 'C'), event(2, 'card', 'C')];
  assert.equal((await runtime.claim())?.id, 'event-1');
  assert.equal(await new DurableDomainEventRuntime(dbForClaim()).claim(), null);
});
await test('successful predecessor releases the next row in the same resource lane', async () => {
  records[0].processedAt = simulatedNow;
  assert.equal((await new DurableDomainEventRuntime(dbForClaim()).claim())?.id, 'event-2');
});
await test('explicitly dead-lettered predecessor does not stall unrelated recovery forever', async () => {
  records = [event(1, 'card', 'C', { deadLetteredAt: simulatedNow }), event(2, 'card', 'C')];
  assert.equal((await runtime.claim())?.id, 'event-2');
});
await test('kind is part of lane identity, even with identical row IDs', async () => {
  records = [event(1, 'project', 'A', { availableAt: simulatedNow + 40_000 }), event(2, 'card', 'A')];
  assert.equal((await runtime.claim())?.id, 'event-2');
});
await test('Project placement does not allow reordering the same canonical source resource', async () => {
  records = [event(1, 'source_commit', 'S1', { availableAt: simulatedNow + 40_000, projectId: 'P1' }),
    event(2, 'source_commit', 'S1', { projectId: 'P2' })];
  assert.equal(await runtime.claim(), null);
});
await test('unscoped events have no globally blocking phantom resource lane', async () => {
  records = [event(1, null, null, { availableAt: simulatedNow + 40_000 }), event(2, null, null)];
  assert.equal((await runtime.claim())?.id, 'event-2');
});
await test('equal available times use durable sequence to choose the first event', async () => {
  records = [event(7, 'card', 'X'), event(4, 'card', 'Y')];
  assert.equal((await runtime.claim())?.id, 'event-4');
});
const completed = [];
const deliveryDb = {
  $executeRawUnsafe: async (sql, ...args) => { completed.push({ sql, args }); return 1; },
  $transaction: async fn => fn(deliveryDb),
  $queryRawUnsafe: async (sql, ...args) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('INSERT INTO "DomainEventOutbox"')) return [{ id: args[0], type: args[1], payload: args[12] }];
    throw Error('unexpected SQL');
  },
};
const delivery = new DurableDomainEventRuntime(deliveryDb);
const row = (overrides = {}) => ({
  id: 'assignment-1', type: 'work.assignment.changed', schemaVersion: 1,
  payload: JSON.stringify({ resource: { kind: 'card', id: 'C1', projectId: 'P1' }, kind: 'assignee' }),
  resourceKind: 'card', resourceId: 'C1', resourceProjectId: 'P1',
  completedConsumers: '[]', occurredAt: new Date(), ...overrides,
});
let observed = 0;
delivery.subscribe('work.assignment.changed', 'assignment-test', () => { observed++; });
await test('valid persisted assignment invokes durable consumer with parsed address', async () => {
  await delivery.deliver(row());
  assert.equal(observed, 1);
  assert.equal(completed.length, 2);
});
await test('forged persisted assignment identity is rejected before any subscriber or checkpoint', async () => {
  const previous = completed.length;
  await assert.rejects(delivery.deliver(row({ resourceId: 'C2' })), /Persisted assignment event resource does not match/);
  assert.equal(observed, 1);
  assert.equal(completed.length, previous);
});
await test('persisted assignment missing source address cannot bypass scoped routing', async () => {
  await assert.rejects(delivery.deliver(row({ resourceKind: null, resourceId: null, resourceProjectId: null })), /Persisted assignment event resource does not match/);
  assert.equal(observed, 1);
});
await test('partial or unknown stored resource addresses reject before consumer work', async () => {
  await assert.rejects(delivery.deliver(row({ resourceId: null })), /Invalid persisted resource identity/);
  await assert.rejects(delivery.deliver(row({ resourceKind: 'unknown-resource' })), /invalid canonical resource address/);
  assert.equal(observed, 1);
});
await test('assignment publisher must include resource identity matching durable payload', async () => {
  const payload = { resource: { kind: 'card', id: 'C1', projectId: 'P1' }, kind: 'assignee' };
  await assert.rejects(delivery.appendInTransaction(deliveryDb, {
    id: 'bad-publish', type: 'work.assignment.changed', schemaVersion: 1, occurredAt: new Date(), payload,
    resource: null, projectId: 'P1',
  }), /Assignment event resource does not match/);
});
await test('global assignment never inherits its context Project as a resource scope', async () => {
  const received = [];
  const tx = {
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('INSERT INTO "DomainEventOutbox"')) {
        received.push(args);
        return [{ id: args[0], type: args[1], payload: args[12] }];
      }
      throw Error('unexpected query');
    },
  };
  await delivery.appendInTransaction(tx, {
    id: 'global-packet', type: 'work.assignment.changed', schemaVersion: 1, occurredAt: new Date(),
    projectId: 'P1', resource: { kind: 'packet', id: 'PK1' },
    payload: { resource: { kind: 'packet', id: 'PK1' }, kind: 'responsible' },
  });
  assert.equal(received[0][9], 'PK1');
  assert.equal(received[0][10], null, 'the canonical global resource remains unscoped');
  assert.equal(received[0][7], 'P1', 'the contextual Project still participates in event metadata');
});
await test('idempotent event reuse cannot silently replace causation or correlation evidence', async () => {
  const existing = {
    id: 'same-id', type: 'activity.recorded', schemaVersion: 1, workspaceId: null,
    correlationId: 'corr-original', causationId: 'cause-original', actorUserId: 'actor', projectId: null,
    resourceKind: 'project', resourceId: 'A', resourceProjectId: null,
    resourceRevision: null, payload: '{}',
  };
  const db = {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('INSERT INTO "DomainEventOutbox"')) return [];
      if (sql.includes('SELECT * FROM "DomainEventOutbox"')) return [existing];
      throw Error('unexpected query');
    },
  };
  const retry = new DurableDomainEventRuntime(db);
  const input = { id: 'same-id', type: 'activity.recorded', schemaVersion: 1, occurredAt: new Date(),
    actorUserId: 'actor', resource: { kind: 'project', id: 'A' }, payload: {},
    correlationId: 'corr-original', causationId: 'cause-original',
  };
  assert.equal((await retry.appendInTransaction(db, input)).id, 'same-id');
  await assert.rejects(retry.appendInTransaction(db, { ...input, correlationId: 'other-correlation' }), /reused for a different event/);
  await assert.rejects(retry.appendInTransaction(db, { ...input, causationId: 'other-cause' }), /reused for a different event/);
});
// Exercise the real Activity producer: its canonical resource normalization
// must agree with what durable append/replay validate.
const activityFile = 'apps/server/src/domains/activity/activity-service.ts';
const activityModule = { exports: {} };
const activityCode = ts.transpileModule(fs.readFileSync(activityFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let persisted = [];
let commits = 0;
const scoped = new Set(['project', 'card']);
const activityDeps = {
  '@cluster/shared': {
    CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded', schemaVersion: 1 }, assignmentChanged: { type: 'work.assignment.changed', schemaVersion: 1 } },
    CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE: 'work_assignment_changed',
    clusterResourceAddressFromEntity: ({ entityType, entityId, projectId }) =>
      ['project', 'card', 'packet'].includes(entityType) && entityId
        ? { kind: entityType, id: entityId, ...(scoped.has(entityType) && projectId ? { projectId } : {}) } : null,
  },
  '../../core/domain-events.js': {
    createClusterDomainEvent: (descriptor, input) => ({ ...input, id: 'new-event-id', type: descriptor.type, schemaVersion: descriptor.schemaVersion }),
  },
  './activity-repository.js': {
    createActivityRepository: () => ({ create: async input => ({ ...input, id: 'activity-new', createdAt: new Date() }), list: async () => [], userSummaries: () => [] }),
  },
  '../../core/cursor-pagination.js': { buildCursorPage: rows => rows },
};
vm.runInNewContext(activityCode, {
  module: activityModule, exports: activityModule.exports,
  require: id => { if (!(id in activityDeps)) throw Error(`unmocked activity import ${id}`); return activityDeps[id]; },
  Date, JSON, String, Number, Math, Object, Error, Promise,
}, { filename: activityFile });
const activity = activityModule.exports.createActivityService({
  prisma: { $transaction: async fn => { const result = await fn({}); commits++; return result; } },
  events: { appendInTransaction: async (_tx, event) => { persisted.push(event); }, wake: () => {} },
  logger: { warn: () => {} },
});
await test('Activity producer canonicalizes globally-scoped Packet assignment without losing Project context', async () => {
  persisted = []; commits = 0;
  const output = await activity.record({ type: 'work_assignment_changed', entityType: 'packet', entityId: 'PK1', projectId: 'P1', title: 'Assigned',
    metadata: { assignment: { kind: 'responsible', resource: { kind: 'packet', id: 'PK1', projectId: 'P1' } } },
  });
  assert.equal(output.id, 'activity-new');
  assert.equal(commits, 1);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[1].resource.projectId, undefined);
  assert.equal(persisted[1].payload.resource.projectId, undefined);
  assert.equal(persisted[1].projectId, 'P1');
});
await test('Activity producer preserves scoped Card assignment parent on both payload and envelope', async () => {
  persisted = [];
  await activity.record({ type: 'work_assignment_changed', entityType: 'card', entityId: 'C1', projectId: 'P1', title: 'Assigned',
    metadata: { assignment: { kind: 'assignee', resource: { kind: 'card', id: 'C1', projectId: 'P1' } } },
  });
  assert.equal(persisted.length, 2);
  assert.equal(persisted[1].resource.projectId, 'P1');
  assert.equal(persisted[1].payload.resource.projectId, 'P1');
});
await test('unknown assignment resource prevents a partial durable Activity/assignment transaction', async () => {
  persisted = []; commits = 0;
  const output = await activity.record({ type: 'work_assignment_changed', entityType: 'mystery', entityId: 'X', title: 'Assigned',
    metadata: { assignment: { kind: 'assignee', resource: { kind: 'mystery', id: 'X' } } },
  });
  assert.equal(output, null);
  assert.equal(commits, 0, 'transaction callback failed before commit');
});
console.log(`${passed}/${passed} TD4 R59 resource-ordering and typed-replay checks passed`);

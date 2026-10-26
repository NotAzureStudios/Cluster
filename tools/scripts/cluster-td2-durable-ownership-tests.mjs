import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (file) => fs.readFileSync(path.join(base, file), 'utf8');
function loadTs(file, stubs = {}) {
  const compiled = ts.transpileModule(src(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  const localRequire = (name) => name in stubs ? stubs[name] : name.startsWith('node:') ? require(name) : (() => { throw new Error(`Unmocked runtime import ${name} from ${file}`); })();
  new Function('require', 'module', 'exports', compiled.outputText)(localRequire, module, module.exports);
  return module.exports;
}
const { reconcileConfigurableToolOwners, CONFIGURABLE_TOOL_SETTING_FLAGS } = loadTs('apps/server/src/domains/access/configurable-tool-availability.ts');
const jobTypes = loadTs('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { BackgroundJobQueue } = loadTs('apps/server/src/domains/jobs/job-queue-service.ts', {
  '../../core/reliability-context.js': { currentReliabilityContext: () => null },
  '../../core/cursor-pagination.js': { decodeCursor: () => null, encodeCursor: () => '' },
  './job-types.js': jobTypes,
  '../../core/postgres-advisory-lock.js': { acquireTransactionAdvisoryLock: async () => {} },
});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, callback) => callback() },
  './job-types.js': jobTypes,
  './job-queue-service.js': { BackgroundJobQueue },
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS', name); }

await check('all six Studio availability switches reconcile from one policy; unrelated changes are ignored', () => {
  assert.equal(CONFIGURABLE_TOOL_SETTING_FLAGS.length, 6);
  assert.equal(new Set(CONFIGURABLE_TOOL_SETTING_FLAGS).size, 6);
  const received = [];
  reconcileConfigurableToolOwners({ calendarEnabled: false, schedulerEnabled: false }, (name, state) => received.push([name, state]));
  assert.equal(received.length, 6);
  assert.ok(received.some(([name, state]) => name === 'calendar' && state === false));
  assert.ok(received.some(([name, state]) => name === 'scheduler' && state === false));
  assert.ok(received.some(([name, state]) => name === 'library' && state === true));
  const scoped = [];
  reconcileConfigurableToolOwners({ libraryEnabled: false }, (name, state) => scoped.push([name, state]), ['libraryEnabled', 'unrelated']);
  assert.deepEqual(scoped, [['library', false]]);
});

await check('repeating unchanged tool state does not reset timers during reconciliation', async () => {
  const tasks = loadTs('apps/server/src/core/background-tasks.ts').BackgroundTaskRegistry;
  const registry = new tasks();
  try {
    registry.scheduleAdaptive('calendar', 1000, () => {}, { owner: 'calendar' });
    const first = registry.snapshots()[0].nextRunAt;
    registry.setOwnerEnabled('calendar', true);
    assert.equal(registry.snapshots()[0].nextRunAt, first);
    registry.setOwnerEnabled('calendar', false);
    assert.equal(registry.snapshots()[0].nextRunAt, null);
    registry.setOwnerEnabled('calendar', false);
    assert.equal(registry.snapshots()[0].nextRunAt, null);
    registry.setOwnerEnabled('calendar', true);
    assert.ok(registry.snapshots()[0].nextRunAt);
  } finally { registry.stopAll(); }
});

await check('SQL claim excludes disabled-owned job types before attempts or leases are changed', async () => {
  let sql = '', args = [];
  const db = { $transaction: async (fn) => fn({
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async (query, ...values) => { sql = query; args = values; return []; },
  }) };
  const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.claim('w1', 60000, ['default'], 3, 20, ['automation.calendar-scan']), null);
  assert.match(sql, /AND NOT \(job\."type" = ANY\(\$2::text\[\]\)\)/);
  assert.deepEqual(args[1], ['automation.calendar-scan']);
});

function dbForDefer(cancelled = false) {
  const record = { status: 'RUNNING', leaseOwner: 'w1:claim-uuid', leaseExpiresAt: new Date(Date.now() + 60_000), attempts: 2, cancelRequestedAt: cancelled ? new Date() : null, attemptPresent: true };
  const sqls = [];
  const db = { $transaction: async (fn) => fn({
    $queryRawUnsafe: async (sql, id, claimToken, attempt) => {
      sqls.push(sql);
      return record.status === 'RUNNING' && record.leaseOwner === claimToken && record.attempts === attempt && record.leaseExpiresAt > new Date() ? [{ cancelRequestedAt: record.cancelRequestedAt }] : [];
    },
    $executeRawUnsafe: async (sql, ...args) => {
      sqls.push(sql);
      if (sql.includes('UPDATE "BackgroundJob"')) {
        if (record.leaseOwner !== args[1] || record.attempts !== args[4] || record.leaseExpiresAt <= new Date()) return 0;
        record.status = args[2] ? 'CANCELLED' : 'QUEUED';
        if (!args[2]) record.attempts -= 1;
        record.leaseOwner = null;
      }
      if (sql.includes('DELETE FROM "BackgroundJobAttempt"')) record.attemptPresent = false;
      return 1;
    },
  }) };
  return { db, record, sqls };
}
await check('lease-fenced defer returns a disabled-owned job to queue without burning attempts', async () => {
  const { db, record, sqls } = dbForDefer();
  const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.deferDisabled({ id: 'job1', attempts: 2, leaseOwner: 'w1:claim-uuid' }, 'w1', 45000), 'DEFERRED');
  assert.equal(record.status, 'QUEUED');
  assert.equal(record.attempts, 1);
  assert.equal(record.leaseOwner, null);
  assert.equal(record.attemptPresent, false);
  assert.ok(sqls.some((s) => s.includes('FOR UPDATE')));
  assert.ok(sqls.some((s) => s.includes('"runAfter"')));
});
await check('a cancelled claimed job remains cancelled instead of silently reappearing', async () => {
  const { db, record } = dbForDefer(true);
  const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.deferDisabled({ id: 'job2', attempts: 2, leaseOwner: 'w1:claim-uuid' }, 'w1'), 'CANCELLED');
  assert.equal(record.status, 'CANCELLED');
  assert.equal(record.attempts, 2);
});
await check('deferral refuses a missing or stolen lease', async () => {
  const { db } = dbForDefer();
  const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.deferDisabled({ id: 'job3', attempts: 2, leaseOwner: 'wrong-worker:old-claim' }, 'wrong-worker'), null);
});
function jobRecord(type = 'automation.calendar-scan') { return { id: 'j', type, payload: '{}', attempts: 1, maxAttempts: 5, correlationId: null, causationId: null, workspaceId: null, createdById: null }; }
await check('worker defers a job if its tool gets disabled after SQL claim', async () => {
  let disabled = false, deferCalls = 0, handlerCalls = 0, calls = 0;
  const queue = {
    claim: async () => { calls++; if (calls !== 1) return null; disabled = true; return jobRecord(); },
    deferDisabled: async () => { deferCalls++; return 'DEFERRED'; },
  };
  const worker = new DurableJobWorker(queue, { concurrency: 1, blockedTypes: () => disabled ? ['automation.calendar-scan'] : [] });
  worker.register('automation.calendar-scan', async () => { handlerCalls++; });
  assert.equal(await worker.runBatch(), 1);
  await wait(10);
  assert.equal(deferCalls, 1);
  assert.equal(handlerCalls, 0);
  assert.equal(worker.snapshot().deferred, 1);
  worker.stop();
});
await check('handler-side disable race defers instead of succeeding or consuming a retry', async () => {
  let claims = 0, deferred = 0, succeeded = 0, failed = 0;
  const queue = {
    claim: async () => ++claims === 1 ? jobRecord() : null,
    heartbeat: async () => true,
    cancellationRequested: async () => false,
    deferDisabled: async () => { deferred++; return 'DEFERRED'; },
    succeed: async () => { succeeded++; },
    fail: async () => { failed++; },
  };
  const worker = new DurableJobWorker(queue, { concurrency: 1, leaseMs: 60000 });
  worker.register('automation.calendar-scan', async () => { throw new jobTypes.BackgroundJobDeferredError(); });
  await worker.runBatch();
  await wait(10);
  assert.deepEqual({ deferred, succeeded, failed }, { deferred: 1, succeeded: 0, failed: 0 });
  assert.equal(worker.snapshot().deferred, 1);
  worker.stop();
});
await check('Calendar durable handler uses deferral rather than false success; protected Settings reconcile flags', () => {
  const job = src('apps/server/src/app/server-job-runtime.ts');
  const settings = src('apps/server/src/app/server-services-settings-integrations.ts');
  const cluster = src('apps/server/src/app/cluster-server.ts');
  assert.match(job, /blockedTypes: blockedOwnedTypes/);
  assert.match(job, /throw new BackgroundJobDeferredError\("Calendar is disabled/);
  assert.match(settings, /onStudioSettingsChanged\?\.\(CONFIGURABLE_TOOL_SETTING_FLAGS, committed\)/);
  assert.match(cluster, /reconcileToolAvailability\(bootToolSettings\)/);
  assert.match(cluster, /settingsCoordination\?\.committedLocally\(changedKeys, values\)/);
  assert.match(cluster, /applyToolAvailability: reconcileToolAvailability/);
  assert.match(cluster, /studio-tool-availability-reconcile/);
  assert.match(cluster, /readSettings\(true\)/);
});
console.log(`${count}/${count} TD2 durable ownership checks passed`);

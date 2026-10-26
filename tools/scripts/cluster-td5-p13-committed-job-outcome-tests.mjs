/** TD5 P13: executable acknowledgement-status contract and worker counters. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); }
})();
function load(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unmocked import ${name} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const types = load('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { BackgroundJobQueue } = load('apps/server/src/domains/jobs/job-queue-service.ts', {
  '../../core/reliability-context.js': { currentReliabilityContext: () => null },
  '../../core/cursor-pagination.js': { decodeCursor: () => null, encodeCursor: () => '' },
  '../../core/postgres-advisory-lock.js': { acquireTransactionAdvisoryLock: async () => {} },
  './job-types.js': types,
});
const { DurableJobWorker } = load('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, callback) => callback() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue },
});
const job = (payload = '{}', type = 'test.outcome') => ({
  id: 'p13-job', type, payload, leaseOwner: 'worker:claim', attempts: 1,
  maxAttempts: 3, workspaceId: null, correlationId: null, createdById: null,
});
function dbFixture({ cancelled = false, owned = true, rollback = false } = {}) {
  const state = { cancelled, owned, statements: [], committed: false, status: null };
  const tx = {
    $queryRawUnsafe: async (sql) => {
      state.statements.push(sql);
      if (sql.includes('SELECT "status", "cancelRequestedAt"') || sql.includes('SELECT "cancelRequestedAt"')) {
        return state.owned ? [{ status: 'RUNNING', cancelRequestedAt: state.cancelled ? new Date() : null }] : [];
      }
      return [];
    },
    $executeRawUnsafe: async (sql, ...args) => {
      state.statements.push(sql);
      if (sql.includes('UPDATE "BackgroundJob"')) {
        state.status = args[2] === true ? 'CANCELLED' : args[2] === false ? 'QUEUED' : args[2];
      }
      return state.owned ? 1 : 0;
    },
  };
  const db = {
    $transaction: async (callback) => {
      const value = await callback(tx);
      if (rollback) throw Error('simulated commit failure');
      state.committed = true;
      return value;
    },
  };
  return { queue: new BackgroundJobQueue(db), state };
}

test('committed successful acknowledgement returns SUCCEEDED, not a generic boolean', async () => {
  const { queue, state } = dbFixture();
  assert.equal(await queue.succeed(job(), 'worker', { ok: true }), 'SUCCEEDED');
  assert.equal(state.status, 'SUCCEEDED');
  assert.equal(state.committed, true);
});
test('a cancellation arriving at success acknowledgement returns committed CANCELLED', async () => {
  const { queue, state } = dbFixture({ cancelled: true });
  assert.equal(await queue.succeed(job(), 'worker', { ok: true }), 'CANCELLED');
  assert.equal(state.status, 'CANCELLED');
});
test('a stale lease returns null without a false completion', async () => {
  const { queue, state } = dbFixture({ owned: false });
  assert.equal(await queue.succeed(job(), 'worker', {}), null);
  assert.equal(state.status, null);
});
test('commit failure rejects without reporting a committed status', async () => {
  const { queue, state } = dbFixture({ rollback: true });
  await assert.rejects(queue.succeed(job(), 'worker', {}), /commit failure/);
  assert.equal(state.committed, false);
});
test('failed execution reports QUEUED when PostgreSQL commits retry scheduling', async () => {
  const { queue, state } = dbFixture();
  assert.equal(await queue.fail(job(), 'worker', Error('temporary failure')), 'QUEUED');
  assert.equal(state.status, 'QUEUED');
});
test('failed execution reports DEAD_LETTER when retries are exhausted', async () => {
  const { queue, state } = dbFixture();
  assert.equal(await queue.fail({ ...job(), attempts: 3 }, 'worker', Error('failed')), 'DEAD_LETTER');
  assert.equal(state.status, 'DEAD_LETTER');
});
test('cancellation racing the failure acknowledgement reports CANCELLED', async () => {
  const { queue, state } = dbFixture({ cancelled: true });
  assert.equal(await queue.fail(job(), 'worker', Error('failed')), 'CANCELLED');
  assert.equal(state.status, 'CANCELLED');
});
test('an obsolete attempt cannot acknowledge a failure', async () => {
  const { queue } = dbFixture({ owned: false });
  assert.equal(await queue.fail(job(), 'worker', Error('failed')), null);
});
test('deferred ownership and cancellation are distinct committed outcomes', async () => {
  const normal = dbFixture();
  assert.equal(await normal.queue.deferDisabled(job(), 'worker'), 'DEFERRED');
  const cancelled = dbFixture({ cancelled: true });
  assert.equal(await cancelled.queue.deferDisabled(job(), 'worker'), 'CANCELLED');
  const stale = dbFixture({ owned: false });
  assert.equal(await stale.queue.deferDisabled(job(), 'worker'), null);
});

async function executeWorker({ handler = async () => ({ ok: true }), type = 'test.outcome',
  payload = '{}', succeed = async () => 'SUCCEEDED', fail = async () => 'QUEUED',
  deferDisabled = async () => 'DEFERRED', blockedTypes } = {}) {
  let claims = 0;
  const counters = { succeed: 0, fail: 0, defer: 0 };
  const queue = {
    claim: async () => ++claims === 1 ? job(payload, type) : null,
    heartbeat: async () => true,
    cancellationRequested: async () => false,
    updateProgress: async () => true,
    succeed: async (...args) => { counters.succeed++; return succeed(...args); },
    fail: async (...args) => { counters.fail++; return fail(...args); },
    deferDisabled: async (...args) => { counters.defer++; return deferDisabled(...args); },
  };
  const worker = new DurableJobWorker(queue, { concurrency: 1, blockedTypes });
  if (handler) worker.register('test.outcome', handler);
  await worker.runBatch();
  await worker.drain();
  return { state: worker.snapshot(), counters };
}
test('worker counts committed success as success', async () => {
  const { state } = await executeWorker();
  assert.equal(state.succeeded, 1);
  assert.equal(state.cancelled, 0);
});
test('worker counts cancellation committed during success acknowledgement as cancellation', async () => {
  const { state, counters } = await executeWorker({ succeed: async () => 'CANCELLED' });
  assert.equal(state.succeeded, 0);
  assert.equal(state.cancelled, 1);
  assert.equal(counters.fail, 0);
});
test('worker counts a cancellation committed during failure acknowledgement as cancellation', async () => {
  const { state } = await executeWorker({ handler: async () => { throw Error('handler error'); }, fail: async () => 'CANCELLED' });
  assert.equal(state.cancelled, 1);
  assert.equal(state.failed, 0);
});
test('worker counts a retryable failure as failure and not cancellation', async () => {
  const { state } = await executeWorker({ handler: async () => { throw Error('handler error'); } });
  assert.equal(state.failed, 1);
  assert.equal(state.cancelled, 0);
});
test('worker does not invent a result when success acknowledgement loses its lease', async () => {
  const { state } = await executeWorker({ succeed: async () => null });
  assert.equal(state.succeeded, 0);
  assert.equal(state.leaseLost, 1);
});
test('worker counts an already-cancelled invalid payload correctly', async () => {
  const { state, counters } = await executeWorker({ payload: '{invalid', fail: async () => 'CANCELLED' });
  assert.equal(state.cancelled, 1);
  assert.equal(state.failed, 0);
  assert.equal(counters.fail, 1);
});
test('worker counts unregistered job cancellation as cancellation, not failure', async () => {
  const { state } = await executeWorker({ type: 'test.unknown', handler: null, fail: async () => 'CANCELLED' });
  assert.equal(state.unknownTypes, 1);
  assert.equal(state.cancelled, 1);
  assert.equal(state.failed, 0);
});
test('worker counts cancelled tool-owned deferral as cancellation', async () => {
  const { state, counters } = await executeWorker({
    blockedTypes: () => ['test.outcome'],
    deferDisabled: async () => 'CANCELLED',
  });
  assert.equal(state.deferred, 0);
  assert.equal(state.cancelled, 1);
  assert.equal(counters.defer, 1);
});
test('worker counts normal tool-owned deferral as deferred', async () => {
  const { state } = await executeWorker({ blockedTypes: () => ['test.outcome'] });
  assert.equal(state.deferred, 1);
  assert.equal(state.cancelled, 0);
});

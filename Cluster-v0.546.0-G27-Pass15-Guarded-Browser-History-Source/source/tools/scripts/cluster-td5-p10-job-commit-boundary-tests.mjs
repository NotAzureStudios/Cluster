/** TD5 P10: executable transaction-boundary fault injection for the production job queue.
 * Uses a deterministic database authority, NOT a substitute for PostgreSQL acceptance.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); }
})();
function load(file, stubs) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0, `${file} must transpile`);
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unexpected queue dependency: ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
const types = load('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { BackgroundJobQueue } = load('apps/server/src/domains/jobs/job-queue-service.ts', {
  '../../core/reliability-context.js': { currentReliabilityContext: () => null },
  '../../core/cursor-pagination.js': { encodeCursor: () => '', decodeCursor: () => null },
  './job-types.js': types,
  '../../core/postgres-advisory-lock.js': { acquireTransactionAdvisoryLock: async () => {} },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function dbFixture() {
  let sequence = 0;
  const state = { jobs: [], queries: 0, transactionOpen: false, commitGate: null, failCommit: false, slowCount: null, events: [] };
  const db = {
    async $transaction(action) {
      assert(!state.transactionOpen, 'fixture only admits one transaction');
      state.transactionOpen = true;
      const pending = [];
      const tx = {
        async $queryRawUnsafe(query, ...values) {
          state.events.push(query.startsWith('INSERT') ? 'insert' : 'tx-read');
          if (query.includes('SELECT * FROM "BackgroundJob"') && query.includes('"dedupeKey"')) {
            const [dedupeKey, type, workspaceId] = values;
            return state.jobs.filter(job => job.dedupeKey === dedupeKey && job.type === type && job.workspaceId === workspaceId);
          }
          if (query.includes('INSERT INTO "BackgroundJob"')) {
            const [id, queue, type, workspaceId, _correlationId, _causationId, _priority, _cost, payload, maxAttempts, runAfter, dedupeKey] = values;
            const job = { id, queue, type, workspaceId, payload, status: 'QUEUED', attempts: 0, maxAttempts, runAfter, dedupeKey };
            pending.push(job);
            return [job];
          }
          if (query.includes('SELECT COALESCE(SUM("costUnits")')) return [{ activeCost: 0 }];
          if (query.includes('WITH workspace_load') && query.includes('SELECT job."id", job."workspaceId"')) return [];
          if (query.includes('FROM "BackgroundJob"') && query.includes('FOR UPDATE')) return [{ status: 'RUNNING', cancelRequestedAt: null }];
          return [];
        },
        async $executeRawUnsafe(query) {
          state.events.push('tx-execute');
          return query.includes('UPDATE "BackgroundJobAttempt"') ? 1 : 1;
        },
      };
      try {
        const result = await action(tx);
        state.events.push('transaction-body-done');
        if (state.commitGate) await state.commitGate.promise;
        if (state.failCommit) throw Error('simulated database commit rejection');
        state.jobs.push(...pending);
        state.events.push('committed');
        return result;
      } finally { state.transactionOpen = false; }
    },
    async $queryRawUnsafe(query) {
      state.queries++;
      if (query.includes('COUNT(*)::bigint AS count')) {
        const oldSnapshot = state.jobs.length ? [{ status: 'QUEUED', count: state.jobs.length }] : [];
        if (state.slowCount) await state.slowCount.promise;
        return oldSnapshot;
      }
      return [];
    },
  };
  return { db, state };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(condition, message) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await tick(); }
  assert.fail(message);
}
const jobInput = { queue: 'default', type: 'test.commit' };

// PostgreSQL rollback / commit are simulated here so every ordering branch can
// be forced deterministically, including the moments between SQL and commit.
test('committed enqueue succeeds even when info logger throws', async () => {
  const { db, state } = dbFixture();
  let loggedAfterCommit = false;
  const queue = new BackgroundJobQueue(db, { info() { loggedAfterCommit = !state.transactionOpen && state.jobs.length === 1; throw Error('telemetry down'); } });
  const job = await queue.enqueue(jobInput);
  assert.equal(state.jobs.length, 1);
  assert.equal(job.id, state.jobs[0].id);
  assert(loggedAfterCommit, 'logging only starts after commit');
});

test('an enqueue whose transaction aborts emits no success logging or wake and does not reset cache', async () => {
  const { db, state } = dbFixture();
  state.failCommit = true;
  let infoCalls = 0, wakeCalls = 0;
  const queue = new BackgroundJobQueue(db, { info() { infoCalls++; } }, { wakePublisher() { wakeCalls++; } });
  await queue.counts();
  const previouslyCached = queue.snapshot();
  await assert.rejects(queue.enqueue(jobInput), /simulated database commit rejection/);
  assert.equal(state.jobs.length, 0);
  assert.equal(infoCalls, 0);
  assert.equal(wakeCalls, 0);
  assert.equal(queue.snapshot(), previouslyCached);
});

test('cache remains valid until transaction commits; then it is invalidated', async () => {
  const { db, state } = dbFixture();
  await new BackgroundJobQueue(db).counts();
  const gate = deferred(); state.commitGate = gate;
  const queue = new BackgroundJobQueue(db);
  await queue.counts();
  const original = queue.snapshot();
  const pending = queue.enqueue(jobInput);
  await waitFor(() => state.events.includes('transaction-body-done'), 'enqueue did not reach commit barrier');
  assert.equal(queue.snapshot(), original, 'not invalidated on uncommitted write');
  gate.resolve(); await pending;
  assert.equal(queue.snapshot(), null);
  assert.equal((await queue.counts()).total, 1);
});

test('deduplicated enqueue reuses committed record without claiming a second insert or logging it again', async () => {
  const { db, state } = dbFixture();
  let infoCalls = 0;
  const queue = new BackgroundJobQueue(db, { info() { infoCalls++; } });
  const input = { ...jobInput, dedupeKey: 'shared-request' };
  const first = await queue.enqueue(input);
  assert.equal(infoCalls, 1);
  await queue.counts();
  const saved = queue.snapshot();
  const second = await queue.enqueue(input);
  assert.equal(second.id, first.id);
  assert.equal(infoCalls, 1);
  assert.equal(state.jobs.length, 1);
  assert.equal(queue.snapshot(), saved);
});

test('a counts read begun before a commit cannot publish stale results after invalidation', async () => {
  const { db, state } = dbFixture();
  state.slowCount = deferred();
  const queue = new BackgroundJobQueue(db);
  const oldRead = queue.counts();
  await waitFor(() => state.queries === 1, 'counts did not reach slow query');
  await queue.enqueue(jobInput);
  assert.equal(queue.snapshot(), null);
  state.slowCount.resolve(); state.slowCount = null;
  assert.equal((await oldRead).total, 0, 'in-progress read is allowed to observe its old snapshot');
  assert.equal(queue.snapshot(), null, 'old result must not poison the current cache');
  assert.equal((await queue.counts()).total, 1);
});

test('claim sweep invalidates the cache only after commit even if it finds no claimable jobs', async () => {
  const { db, state } = dbFixture();
  const queue = new BackgroundJobQueue(db);
  await queue.counts();
  const old = queue.snapshot();
  const gate = deferred(); state.commitGate = gate;
  const claim = queue.claim('worker-a');
  await waitFor(() => state.events.includes('transaction-body-done'), 'claim did not reach commit barrier');
  assert.equal(queue.snapshot(), old);
  gate.resolve();
  assert.equal(await claim, null);
  assert.equal(queue.snapshot(), null, 'stale lease reconciliation may alter counts without a new claim');
});

test('rolled-back claim does not invalidate counts', async () => {
  const { db, state } = dbFixture();
  const queue = new BackgroundJobQueue(db);
  await queue.counts();
  const old = queue.snapshot();
  state.failCommit = true;
  await assert.rejects(queue.claim('worker-a'), /simulated database commit rejection/);
  assert.equal(queue.snapshot(), old);
});

test('committed failure acknowledgement succeeds even when warning logger throws', async () => {
  const { db, state } = dbFixture();
  let sawCommit = false;
  const queue = new BackgroundJobQueue(db, { warn() { sawCommit = state.events.at(-1) === 'committed'; throw Error('logging sink unavailable'); } });
  const record = { id: 'job-1', type: 'test.commit', leaseOwner: 'worker:token', attempts: 1, maxAttempts: 5 };
  const result = await queue.fail(record, 'worker', new Error('work failed'));
  assert.equal(result, 'QUEUED');
  assert.equal(sawCommit, true);
});

test('rolled-back failure acknowledgement emits no warning and retains cache', async () => {
  const { db, state } = dbFixture();
  let warnings = 0;
  const queue = new BackgroundJobQueue(db, { warn() { warnings++; } });
  await queue.counts(); const old = queue.snapshot();
  state.failCommit = true;
  await assert.rejects(queue.fail({ id: 'job-1', type: 'test.commit', leaseOwner: 't', attempts: 1, maxAttempts: 5 }, 'worker', Error('failed')), /simulated database commit rejection/);
  assert.equal(warnings, 0);
  assert.equal(queue.snapshot(), old);
});

test('runtime preflight uses an unambiguous TD5 label rather than a stale prior-pass name', () => {
  const summary = JSON.parse(execFileSync(process.execPath, ['tools/scripts/cluster-td5-p6-runtime-gate.mjs', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TD5_CERT_DATABASE_URL: '', TD5_CERT_DISPOSABLE: '' },
  }));
  assert.equal(summary.phase, 'TD5 Runtime Acceptance');
  assert.equal(summary.certification, 'NOT_PERFORMED');
});

test('a failing asynchronous wake publisher does not change successful durable enqueue outcome', async () => {
  const { db } = dbFixture();
  const queue = new BackgroundJobQueue(db, { warn() { throw Error('logger outage'); } }, { wakePublisher: async () => { throw Error('notification outage'); } });
  const job = await queue.enqueue(jobInput);
  assert(job.id);
  await tick();
});

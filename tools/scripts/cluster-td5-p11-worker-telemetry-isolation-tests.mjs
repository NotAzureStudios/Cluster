/** TD5 P11: executable worker lifecycle checks. No PostgreSQL certification claimed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); }
})();
function load(file, imports = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unmocked dependency ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
const types = load('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { DurableJobWorker } = load('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, callback) => callback() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue: class {} },
});
const makeJob = (id = 'job-p11') => ({
  id, type: 'test.telemetry', payload: '{}', leaseOwner: 'worker:claim-id', attempts: 1, maxAttempts: 3,
  workspaceId: null, correlationId: null, createdById: null,
});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let i = 0; i < 6; i++) await tick(); }
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { resolve, reject, promise }; }
async function waitFor(check, description) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.fail(`Did not observe ${description}`);
}
function fixture({ logger = {}, handler = async () => ({ ok: true }), claimResult = makeJob(), ...overrides } = {}) {
  let claimed = false;
  const counters = { succeed: 0, fail: 0, heartbeat: 0, cancellation: 0, defer: 0 };
  const queue = {
    claim: async () => { if (claimed) return null; claimed = true; return claimResult; },
    heartbeat: async () => { counters.heartbeat++; return true; },
    cancellationRequested: async () => { counters.cancellation++; return false; },
    succeed: async () => { counters.succeed++; return 'SUCCEEDED'; },
    fail: async () => { counters.fail++; return 'QUEUED'; },
    deferDisabled: async () => { counters.defer++; return 'DEFERRED'; },
    updateProgress: async () => true,
    ...overrides,
  };
  const worker = new DurableJobWorker(queue, { concurrency: 1, leaseMs: 60000, logger });
  worker.register('test.telemetry', handler);
  return { worker, queue, counters };
}

// Successful PostgreSQL acknowledgement must stay successful, regardless of
// diagnostics. This used to fall into the handler's catch and call queue.fail.
test('throwing success logger cannot convert committed SUCCEEDED into a FAIL attempt', async () => {
  const { worker, counters } = fixture({ logger: { info: () => { throw Error('log sink unavailable'); } } });
  assert.equal(await worker.runBatch(), 1);
  await worker.drain();
  assert.equal(counters.succeed, 1);
  assert.equal(counters.fail, 0);
  assert.equal(worker.snapshot().succeeded, 1);
  assert.equal(worker.snapshot().leaseLost, 0);
  assert.equal(worker.snapshot().unacknowledgedErrors, 0);
});

test('throwing logger after an uncertain success acknowledgement does not attempt FAIL', async () => {
  const { worker, counters } = fixture({
    logger: { warn: () => { throw Error('warn logging failed'); } },
    succeed: async () => { counters.succeed++; throw Error('reply lost after commit'); },
  });
  await worker.runBatch(); await worker.drain();
  assert.equal(counters.fail, 0);
  assert.equal(worker.snapshot().unacknowledgedErrors, 1);
  assert.equal(worker.snapshot().failed, 0);
});

test('throwing logger cannot convert committed failure acknowledgement into an unacknowledged failure', async () => {
  const { worker, counters } = fixture({
    logger: { warn: () => { throw Error('warn logging failed'); } },
    handler: async () => { throw Error('genuine handler failure'); },
  });
  await worker.runBatch(); await worker.drain();
  assert.equal(counters.fail, 1);
  assert.equal(worker.snapshot().failed, 1);
  assert.equal(worker.snapshot().unacknowledgedErrors, 0);
});

test('warning logger rejection during failed outcome acknowledgement does not escape execution observer', async () => {
  const { worker } = fixture({
    logger: { warn: () => { throw Error('warn logging failed'); } },
    handler: async () => { throw Error('handler failure'); },
    fail: async () => { throw Error('database unreachable'); },
  });
  await worker.runBatch(); await worker.drain();
  assert.equal(worker.snapshot().failed, 0);
  assert.equal(worker.snapshot().unacknowledgedErrors, 1);
});

test('failed early deferral tolerates a throwing warn sink', async () => {
  const record = makeJob();
  const { worker } = fixture({
    logger: { warn: () => { throw Error('warn logging failed'); } },
    claimResult: record,
    deferDisabled: async () => { throw Error('database offline'); },
  });
  // Set block policy at the worker boundary to exercise the early path.
  worker.options.blockedTypes = () => ['test.telemetry'];
  await worker.runBatch(); await worker.drain();
  assert.equal(worker.snapshot().unacknowledgedErrors, 0);
  assert.equal(worker.snapshot().succeeded, 0);
});

test('throwing warning sink cannot escape heartbeat or cancellation timer rejection handlers', async () => {
  const previousInterval = globalThis.setInterval;
  const previousClear = globalThis.clearInterval;
  const timers = [];
  const running = deferred();
  const errors = [];
  const onUnhandled = (reason) => errors.push(reason);
  process.on('unhandledRejection', onUnhandled);
  globalThis.setInterval = (callback, ms) => {
    const timer = { callback, ms, closed: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { timer.closed = true; };
  try {
    let renewal = 0;
    let poll = 0;
    let handlerEntered = false;
    let injectPollFailure = false;
    let pollFailed = false;
    const { worker } = fixture({
      logger: { warn: () => { throw Error('warn logging failed'); } },
      handler: async () => { handlerEntered = true; await running.promise; return { ok: true }; },
      heartbeat: async () => { if (++renewal > 1) throw Error('temporary connection outage'); return true; },
      cancellationRequested: async () => { poll++; if (injectPollFailure && !pollFailed) { pollFailed = true; throw Error('temporary connection outage'); } return false; },
    });
    await worker.runBatch();
    await waitFor(() => timers.length === 2 && handlerEntered, 'handler running with both worker timers');
    const heart = timers.find(timer => timer.ms > 1000);
    const cancel = timers.find(timer => timer.ms <= 1000);
    assert(heart && cancel);
    injectPollFailure = true;
    heart.callback(); cancel.callback(); cancel.callback();
    await flush();
    assert.equal(errors.length, 0, 'timer failures must be observed even if warn itself throws');
    running.resolve();
    await worker.drain();
    assert.equal(worker.snapshot().succeeded, 1);
    assert(timers.every(timer => timer.closed));
  } finally {
    running.resolve();
    globalThis.setInterval = previousInterval;
    globalThis.clearInterval = previousClear;
    process.off('unhandledRejection', onUnhandled);
  }
});

test('logger isolation does not silence normal completion information', async () => {
  let message = '';
  const { worker } = fixture({ logger: { info: (_payload, label) => { message = label; } } });
  await worker.runBatch(); await worker.drain();
  assert.equal(message, 'background job completed');
  assert.equal(worker.snapshot().succeeded, 1);
});


test('async completion logger rejection is observed without a false FAIL write', async () => {
  const rejectedLogs = [];
  const onUnhandled = (reason) => rejectedLogs.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { worker, counters } = fixture({ logger: { info: async () => { throw Error('async log transport rejected'); } } });
    await worker.runBatch(); await worker.drain(); await flush();
    assert.equal(worker.snapshot().succeeded, 1);
    assert.equal(counters.fail, 0);
    assert.equal(rejectedLogs.length, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('async failure logger rejection is observed after committed FAIL acknowledgement', async () => {
  const rejectedLogs = [];
  const onUnhandled = (reason) => rejectedLogs.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { worker, counters } = fixture({
      logger: { warn: async () => { throw Error('async log transport rejected'); } },
      handler: async () => { throw Error('handler failure'); },
    });
    await worker.runBatch(); await worker.drain(); await flush();
    assert.equal(worker.snapshot().failed, 1);
    assert.equal(counters.fail, 1);
    assert.equal(rejectedLogs.length, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

// The queue itself publishes telemetry after commit. Async logger failures
// must not escape those detached notification paths either.
const { BackgroundJobQueue } = load('apps/server/src/domains/jobs/job-queue-service.ts', {
  '../../core/reliability-context.js': { currentReliabilityContext: () => null },
  '../../core/cursor-pagination.js': { decodeCursor: () => null, encodeCursor: () => '' },
  '../../core/postgres-advisory-lock.js': { acquireTransactionAdvisoryLock: async () => {} },
  './job-types.js': types,
});
function queueFixture(logger, wakePublisher = () => {}) {
  const jobs = [];
  const db = {
    async $transaction(run) {
      const pending = [];
      const tx = {
        async $queryRawUnsafe(sql, ...args) {
          if (sql.includes('INSERT INTO "BackgroundJob"')) {
            const job = { id: args[0], queue: args[1], type: args[2], attempts: 0, maxAttempts: 5 };
            pending.push(job); return [job];
          }
          if (sql.includes('SELECT "status", "cancelRequestedAt"')) return [{ status: 'RUNNING', cancelRequestedAt: null }];
          return [];
        },
        async $executeRawUnsafe() { return 1; },
      };
      const result = await run(tx);
      jobs.push(...pending);
      return result;
    },
  };
  return { queue: new BackgroundJobQueue(db, logger, { wakePublisher }), jobs };
}

test('async queue enqueue logger rejection cannot escape the committed insert', async () => {
  const errors = [];
  const onUnhandled = reason => errors.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { queue, jobs } = queueFixture({ info: async () => { throw Error('queue logger offline'); } });
    const job = await queue.enqueue({ type: 'test.telemetry' });
    await flush();
    assert.equal(jobs.length, 1);
    assert.equal(job.id, jobs[0].id);
    assert.equal(errors.length, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('async queue warning rejection inside failing wake publisher is observed', async () => {
  const errors = [];
  const onUnhandled = reason => errors.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { queue, jobs } = queueFixture(
      { warn: async () => { throw Error('warning sink offline'); } },
      async () => { throw Error('publisher offline'); },
    );
    await queue.enqueue({ type: 'test.telemetry' });
    await flush();
    assert.equal(jobs.length, 1);
    assert.equal(errors.length, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('async queue failure warning cannot reverse a committed acknowledgement', async () => {
  const errors = [];
  const onUnhandled = reason => errors.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { queue } = queueFixture({ warn: async () => { throw Error('queue warn offline'); } });
    const job = { ...makeJob(), status: 'RUNNING', maxAttempts: 5 };
    assert.equal(await queue.fail(job, 'worker', Error('handler failure')), 'QUEUED');
    await flush();
    assert.equal(errors.length, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

/** TD5 P12: executable composition-level lifecycle tests, NOT live PostgreSQL certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
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
function fixture({ logger = { info() {}, warn() {}, error() {} }, readSettings = async () => ({}), claim = async () => 0, workerSnapshot = () => ({ running: 0 }) } = {}) {
  let scheduled = 0; let stopped = 0; let drained = 0; let unsubscribed = 0; let workerOptions;
  class StubWorker {
    constructor(_queue, options) { workerOptions = options; }
    register() { return this; }
    runBatch() { return claim(); }
    snapshot() { return workerSnapshot(); }
    stop() { stopped++; }
    async drain() { drained++; }
  }
  const policy = {
    disabledStudioToolJobTypes: () => [],
    studioToolForDurableJobType: (type) => type === 'automation.calendar-scan' ? 'calendar' : null,
    automationJobRequiredToolOwners: (type) => type === 'automation.studio-action' ? ['calendar'] : [],
  };
  const { createServerJobRuntime } = load('apps/server/src/app/server-job-runtime.ts', {
    '../domains/jobs/job-queue-service.js': { BackgroundJobQueue: class {}, subscribeBackgroundJobQueueWake: () => () => { unsubscribed++; } },
    '../domains/jobs/job-worker.js': { DurableJobWorker: StubWorker },
    '../domains/jobs/job-types.js': { BackgroundJobDeferredError: class extends Error {} },
    '../domains/jobs/job-tool-ownership.js': policy,
    '../domains/access/configurable-tool-availability.js': { TOOL_AVAILABILITY: { calendar: { flag: 'calendarEnabled' } } },
    '../domains/planning/calendar-reminder-occurrences.js': { dueCalendarReminderOccurrence: () => null },
    '../domains/studio-systems/studio-announcement-delivery.js': { createStudioAnnouncementDelivery: () => ({ runDue: async () => ({ delivered: 0 }) }) },
    '../domains/users/studio-access-expiry-lifecycle.js': { runStudioAccessExpiryTick: async () => ({ expired: 0 }) },
    '../domains/inventory/inventory-credential-expiry-lifecycle.js': { runInventoryCredentialExpiryTick: async () => ({ committed: 0 }) },
  });
  const runtime = createServerJobRuntime({
    prisma: {}, queue: {}, logger, readSettings,
    backgroundTasks: { isOwnerEnabled: () => true, scheduleAdaptive: () => { scheduled++; } },
    projectAutomation: {}, studioAutomation: {},
  });
  return { runtime, options: () => workerOptions, state: () => ({ scheduled, stopped, drained, unsubscribed }) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let i = 0; i < 8; i++) await tick(); }
async function eventually(check, label) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(`Timed out waiting for ${label}`);
}

test('settings transport failure stays denied even if the warning logger throws', async () => {
  const { runtime, options } = fixture({ logger: { info() {}, warn() { throw Error('logging unavailable'); }, error() {} }, readSettings: async () => { throw Error('PostgreSQL offline'); } });
  assert.equal(await options().verifyExecutionAvailability('automation.calendar-scan'), false);
  assert.equal(await options().verifyContextAvailability('automation.studio-action', {}), false);
  assert.equal(await options().verifyExecutionAvailability('system.job-history-prune'), true);
  await runtime.drain();
});

test('rejected async warning logger never changes authoritative tool denial', async () => {
  const { runtime, options } = fixture({ logger: { info() {}, warn() { return Promise.reject(Error('log sink down')); }, error() {} }, readSettings: async () => { throw Error('unavailable'); } });
  assert.equal(await options().verifyExecutionAvailability('automation.calendar-scan'), false);
  assert.equal(await options().verifyContextAvailability('automation.studio-action', {}), false);
  await flush();
  await runtime.drain();
});

test('scheduler boot is idempotent and does not duplicate recurring producers', async () => {
  const { runtime, state } = fixture();
  runtime.start();
  const scheduledOnce = state().scheduled;
  assert.ok(scheduledOnce >= 9, 'the full producer set was registered');
  runtime.start();
  assert.equal(state().scheduled, scheduledOnce, 'second start must not duplicate producers');
  assert.equal(runtime.snapshot().running, true);
  await runtime.drain();
  assert.deepEqual({ stopped: state().stopped, drained: state().drained, unsubscribed: state().unsubscribed }, { stopped: 1, drained: 1, unsubscribed: 1 });
});

test('a drained worker cannot silently restart without its wake subscription', async () => {
  const { runtime, state } = fixture();
  runtime.start();
  const scheduledOnce = state().scheduled;
  await runtime.drain();
  assert.throws(() => runtime.start(), /cannot restart/);
  assert.equal(state().scheduled, scheduledOnce, 'drained runtime must not resubscribe producers');
  assert.equal(runtime.snapshot().running, false);
});

test('first scheduler claim failure reschedules even if sync diagnostics throws', async () => {
  let calls = 0;
  const { runtime } = fixture({ claim: async () => { if (++calls === 1) throw Error('database temporarily unavailable'); return 0; }, logger: { info() {}, warn() { throw Error('logger offline'); }, error() {} } });
  const nativeTimeout = globalThis.setTimeout;
  try {
    // Preserve real short timeouts, only accelerate the runtime's backoff.
    globalThis.setTimeout = (handler, delay, ...args) => nativeTimeout(handler, delay >= 1000 ? 1 : delay, ...args);
    runtime.start();
    await eventually(() => calls >= 2, 'second queue claim');
  } finally { await runtime.drain(); globalThis.setTimeout = nativeTimeout; }
  assert.ok(calls >= 2);
});

test('scheduler retries after a rejected async diagnostic Promise', async () => {
  let calls = 0;
  const { runtime } = fixture({ claim: async () => { if (++calls === 1) throw Error('transaction rolled back'); return 0; }, logger: { info() {}, warn() { return Promise.reject(Error('logger rejected')); }, error() {} } });
  const nativeTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (handler, delay, ...args) => nativeTimeout(handler, delay >= 1000 ? 1 : delay, ...args);
    runtime.start();
    await eventually(() => calls >= 2, 'second claim after logger rejection');
  } finally { await runtime.drain(); globalThis.setTimeout = nativeTimeout; }
  await flush();
  assert.ok(calls >= 2);
});

test('a snapshot failure also recovers via the independent fallback scheduler', async () => {
  let snapshots = 0, claims = 0;
  const { runtime } = fixture({ claim: async () => { claims++; return 0; }, workerSnapshot: () => { if (++snapshots === 1) throw Error('stats are unavailable'); return { running: 0 }; }, logger: { info() {}, warn() { throw Error('logger unavailable'); }, error() {} } });
  const nativeTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (handler, delay, ...args) => nativeTimeout(handler, delay >= 1000 ? 1 : delay, ...args);
    runtime.start();
    await eventually(() => claims >= 2, 'retry after snapshot exception');
  } finally { await runtime.drain(); globalThis.setTimeout = nativeTimeout; }
  assert.ok(claims >= 2);
});

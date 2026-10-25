import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function loadTs(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const js = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(overrides), js)((name) => require(name), mod, mod.exports, ...Object.values(overrides));
  return mod.exports;
}
const { BackgroundTaskRegistry } = loadTs('apps/server/src/core/background-tasks.ts');
let passed = 0;
async function check(title, fn) { await fn(); passed++; console.log('PASS', title); }
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const clock = () => {
  const timers = new Map(); let next = 0;
  function setTimeout(fn, delay) { const id = ++next; const handle = { id, delay, unref() {} }; timers.set(id, { fn, handle }); return handle; }
  function clearTimeout(handle) { timers.delete(handle.id); }
  async function fire() { assert.equal(timers.size, 1, 'expected one governor timer'); const [id, item] = timers.entries().next().value; timers.delete(id); item.fn(); await flush(); }
  return { timers, setTimeout, clearTimeout, fire };
};
function governor({ sampleSystem, db, counts } = {}) {
  const c = clock(); let scaleCalls = 0, observed = 0, dbUpdates = 0, countReads = 0;
  const runtime = {
    prisma: { $queryRawUnsafe: db ?? (async () => [{ total: 1, active: 0, idle: 1, waiting: 0 }]) },
    databaseUrl: 'postgresql://localhost/cluster', databasePoolMax: 10,
    runtimeTelemetry: { sampleSystem: sampleSystem ?? (() => {}), updateDatabasePressure: () => dbUpdates++, snapshot: () => ({}) },
    resourceGovernor: { snapshot: () => ({ mode: 'normal' }), observe: () => { observed++; return { requestCapacityScale: 0.7, mode: 'normal' }; } },
    concurrentWorkLimiter: { setCapacityScale: () => scaleCalls++ },
    jobQueue: { counts: async () => { countReads++; return counts ? counts() : { queued: 0 }; }, snapshot: () => ({ queued: 0 }) },
    logger: { warn: () => {} }, intervalMs: 250,
  };
  // Inject a fake clock into the transpiled module without changing production APIs.
  const { createServerResourceGovernorRuntime } = loadTs('apps/server/src/app/server-resource-governor-runtime.ts', { setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const instance = createServerResourceGovernorRuntime(runtime);
  return { instance, clock: c, get stats() { return { observed, scaleCalls, dbUpdates, countReads }; } };
}
await check('governor survives initial sample failure and schedules a recovery sample', async () => {
  let calls = 0;
  const t = governor({ sampleSystem: () => { if (++calls === 1) throw Error('sampling source failed'); } });
  t.instance.start(); await flush();
  assert.equal(t.instance.samplingStatus().failures, 1);
  assert.equal(t.clock.timers.size, 1);
  await t.clock.fire();
  assert.equal(t.instance.samplingStatus().samples, 1);
  assert.equal(t.instance.samplingStatus().consecutiveFailures, 0);
  assert.equal(t.stats.scaleCalls, 1);
  t.instance.stop(); assert.equal(t.clock.timers.size, 0);
});
await check('queued count failure uses fallback but immediately retries on next sample', async () => {
  let calls = 0;
  const t = governor({ counts: () => { if (++calls === 1) throw Error('database pressure'); return { queued: 4 }; } });
  t.instance.start(); await flush(); await t.clock.fire();
  assert.equal(calls, 2);
  assert.equal(t.instance.samplingStatus().samples, 2);
  t.instance.stop();
});
await check('stop while database sample is pending cannot publish stale governor admission', async () => {
  const query = deferred();
  const t = governor({ db: () => query.promise });
  t.instance.start(); await flush(); t.instance.stop(); query.resolve([{ total: 1 }]); await flush();
  assert.equal(t.stats.scaleCalls, 0);
  assert.equal(t.stats.dbUpdates, 0);
  assert.equal(t.clock.timers.size, 0);
  assert.equal(t.instance.samplingStatus().running, false);
});
await check('restart does not allow a stale generation to resurrect its timer', async () => {
  const query = deferred(); let first = true;
  const t = governor({ db: () => { if (first) { first = false; return query.promise; } return Promise.resolve([{ total: 1 }]); } });
  t.instance.start(); await flush(); t.instance.stop(); t.instance.start(); await flush();
  assert.equal(t.instance.samplingStatus().samples, 0, 'overlap with an old generation is not a fresh successful sample');
  assert.equal(t.clock.timers.size, 1);
  query.resolve([{ total: 1 }]); await flush();
  assert.equal(t.clock.timers.size, 1);
  await t.clock.fire();
  assert.equal(t.instance.samplingStatus().samples, 1);
  t.instance.stop(); assert.equal(t.clock.timers.size, 0);
});
await check('per-owner diagnostics show paused timers and listeners, without disabling core tasks', async () => {
  const background = new BackgroundTaskRegistry(); let eventListener = 0, eventDispose = 0;
  try {
    background.scheduleInterval('calendar-tick', 10, () => {}, { owner: 'calendar', runImmediately: false });
    background.scheduleInterval('core-health', 10, () => {}, { runImmediately: false });
    background.registerOwnedSubscription('calendar-events', 'calendar', () => { eventListener++; return () => eventDispose++; });
    let owner = background.ownerSnapshots().find(r => r.owner === 'calendar');
    assert.equal(owner.armedTimers, 1); assert.equal(owner.activeSubscriptions, 1);
    background.setOwnerEnabled('calendar', false);
    owner = background.ownerSnapshots().find(r => r.owner === 'calendar');
    assert.equal(owner.enabled, false); assert.equal(owner.armedTimers, 0); assert.equal(owner.activeSubscriptions, 0);
    assert.equal(background.snapshots().find(r => r.name === 'core-health').suspended, false);
    background.setOwnerEnabled('calendar', true);
    owner = background.ownerSnapshots().find(r => r.owner === 'calendar');
    assert.equal(owner.armedTimers, 1); assert.equal(owner.activeSubscriptions, 1);
    assert.equal(eventListener, 2); assert.equal(eventDispose, 1);
  } finally { background.stopAll(); }
  assert.equal(eventDispose, 2);
});
await check('in-flight cancellation is counted without pretending the task completed or failed', async () => {
  const runtime = new BackgroundTaskRegistry(); const holding = deferred(); let began;
  const started = new Promise(resolve => { began = resolve; });
  try {
    runtime.scheduleInterval('calendar-cancellable', 10, async (signal) => {
      began(); await holding.promise;
      if (signal.aborted) throw signal.reason;
    }, { owner: 'calendar', runImmediately: true });
    await started;
    runtime.setOwnerEnabled('calendar', false);
    holding.resolve(); await flush();
    const task = runtime.snapshots().find(r => r.name === 'calendar-cancellable');
    assert.equal(task.cancelledRuns, 1);
    assert.equal(task.failures, 0);
    assert.equal(task.lastActivity, null);
    const owner = runtime.ownerSnapshots().find(r => r.owner === 'calendar');
    assert.equal(owner.totalCancelledRuns, 1);
    assert.equal(owner.armedTimers, 0);
  } finally { runtime.stopAll(); }
});
await check('a real error after cancellation still counts as failure', async () => {
  const runtime = new BackgroundTaskRegistry(); const hold = deferred(); let began;
  const started = new Promise(resolve => { began = resolve; });
  try {
    runtime.scheduleInterval('library-write', 10, async () => { began(); await hold.promise; throw Error('disk failed'); }, { owner:'library', runImmediately:true });
    await started;
    runtime.setOwnerEnabled('library', false);
    hold.resolve(); await flush();
    const task = runtime.snapshots().find(r => r.name === 'library-write');
    assert.equal(task.cancelledRuns, 0);
    assert.equal(task.failures, 1);
  } finally { runtime.stopAll(); }
});
await check('operator diagnostics expose owner and sampler summaries only through authenticated route', () => {
  const health = fs.readFileSync(path.join(root, 'apps/server/src/app/server-routes-health-operations.ts'), 'utf8');
  const cluster = fs.readFileSync(path.join(root, 'apps/server/src/app/cluster-server.ts'), 'utf8');
  assert.match(health, /requireAdminUserForRequest\(request, reply\)[\s\S]*?toolRuntimeOwners: backgroundTasks\.ownerSnapshots\(\)/);
  assert.match(health, /governorSampler: deps\.resourceGovernorRuntime\?\.samplingStatus/);
  const publicHealth = health.slice(health.indexOf('app.get("/health"'), health.indexOf('app.get("/api/admin/operations/health"'));
  assert.doesNotMatch(publicHealth, /governorSampler|toolRuntimeOwners/, 'public health must not leak detailed diagnostics');
  assert.match(cluster, /createServerResourceGovernorRuntime\(\{[\s\S]*?logger: app\.log,/);
  assert.match(cluster, /registerHealthOperationsRoutes\(\{[\s\S]*?resourceGovernorRuntime,/);
});
console.log(`${passed}/${passed} TD2 extended runtime closeout checks passed`);

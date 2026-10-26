import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function loadTs(file, stubs = {}) {
  const compiled = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unmocked import ${name} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const types = loadTs('apps/server/src/domains/jobs/job-types.ts', { '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} } });
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, fn) => fn() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue: class {} },
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const makeJob = type => ({ id: 'owned-job', type, payload: '{}', attempts: 1, maxAttempts: 5, correlationId: null, workspaceId: null, createdById: null });
let checks = 0;
async function check(label, fn) { await fn(); checks += 1; console.log('PASS', label); }
async function run(type, handler, { availability = () => true, localDisabled = () => false, cancel = () => false } = {}) {
  let claims = 0, deferred = 0, succeeded = 0, failed = 0, verifications = 0;
  const queue = {
    claim: async () => ++claims === 1 ? makeJob(type) : null,
    cancellationRequested: async () => cancel(),
    deferDisabled: async () => { deferred++; return true; },
    updateProgress: async () => {}, heartbeat: async () => true,
    succeed: async () => { succeeded++; }, fail: async () => { failed++; },
  };
  const worker = new DurableJobWorker(queue, {
    concurrency: 1, leaseMs: 60_000,
    blockedTypes: () => localDisabled() ? [type] : [],
    verifyExecutionAvailability: async () => { verifications++; return availability(); },
  });
  worker.register(type, handler);
  await worker.runBatch();
  for (let i = 0; i < 90 && worker.snapshot().running; i++) await wait(5);
  assert.equal(worker.snapshot().running, 0, 'worker did not finish');
  worker.stop();
  return { claims, deferred, succeeded, failed, verifications };
}
await check('in-flight remote disable at a retryable checkpoint defers without failure or success', async () => {
  let enabled = true, completedUnits = 0;
  const result = await run('library.derivative.build', async ({ throwIfToolUnavailable }) => {
    await throwIfToolUnavailable();
    completedUnits++;
    enabled = false; // another server commits disable; local flag remains stale
    await throwIfToolUnavailable();
    completedUnits++; // forbidden while disabled
  }, { availability: () => enabled });
  assert.equal(completedUnits, 1);
  assert.deepEqual({ deferred: result.deferred, succeeded: result.succeeded, failed: result.failed }, { deferred: 1, succeeded: 0, failed: 0 });
  assert.equal(result.verifications, 3); // one pre-handler, two explicit checkpoints
});
await check('process-local disable defers even if stale authoritative read says enabled', async () => {
  let disabled = false, ran = 0;
  const result = await run('library.derivative.build', async ({ throwIfToolUnavailable }) => {
    disabled = true;
    await throwIfToolUnavailable();
    ran++;
  }, { localDisabled: () => disabled });
  assert.equal(ran, 0); assert.equal(result.deferred, 1); assert.equal(result.verifications, 1);
});
await check('authoritative Settings lookup failure after starting optional work defers safely', async () => {
  let reads = 0;
  const result = await run('library.derivative.build', async ({ throwIfToolUnavailable }) => {
    await throwIfToolUnavailable();
  }, { availability: () => ++reads === 1 });
  assert.equal(result.deferred, 1); assert.equal(result.failed, 0);
});
await check('healthy owned work can pass repeated checkpoints and succeed', async () => {
  let checkpoints = 0;
  const result = await run('library.derivative.build', async ({ throwIfToolUnavailable }) => {
    await throwIfToolUnavailable(); checkpoints++;
    await throwIfToolUnavailable(); checkpoints++;
  });
  assert.equal(checkpoints, 2); assert.equal(result.succeeded, 1); assert.equal(result.deferred, 0);
});
await check('unowned maintenance remains runnable and uses no additional checks unless requested', async () => {
  const result = await run('system.job-history-prune', async () => {});
  assert.equal(result.succeeded, 1); assert.equal(result.verifications, 1); // inherited entry gate is existing behavior
});
await check('actual user cancellation is not incorrectly converted into availability deferral', async () => {
  let cancelled = false;
  const result = await run('library.derivative.build', async ({ throwIfToolUnavailable }) => {
    cancelled = true;
    await throwIfToolUnavailable();
  }, { cancel: () => cancelled });
  assert.equal(result.deferred, 0); assert.equal(result.failed, 1); // queue.fail owns CANCELLED transition
});
await check('Library derivatives recheck between units and before publishing result', () => {
  const source = read('apps/server/src/domains/library/library-9e2-jobs.ts');
  assert.match(source, /const kind = kinds\[index\]; await throwIfToolUnavailable\(\)/);
  const derivative = source.split('input.worker.register("library.derivative.build"')[1];
  const publishAt = derivative.indexOf('const row = await input.prisma.libraryDerivative.upsert');
  assert.ok(publishAt > 0, 'Library must publish a durable derivative');
  const beforePublish = derivative.slice(0, publishAt);
  const availabilityCheck = beforePublish.lastIndexOf('await throwIfToolUnavailable();');
  const freshSourceCheck = beforePublish.lastIndexOf('const currentSource = await input.prisma.libraryItem.findUnique');
  assert.ok(availabilityCheck >= 0 && freshSourceCheck > availabilityCheck,
    'Library must recheck tool availability and current source revision before publishing');
  assert.match(source, /error instanceof BackgroundJobDeferredError\) throw error/);
});
await check('Library transfer has pre-commit boundary and does not check tool availability after storage commit', () => {
  const source = read('apps/server/src/domains/library/library-9e2-jobs.ts');
  const transfer = source.split('input.worker.register("library.transfer.finalize"')[1].split('input.worker.register("library.derivative.build"')[0];
  const commitIndex = transfer.indexOf('input.storeCompletedUpload(');
  assert.ok(commitIndex > 0);
  assert.match(transfer.slice(0, commitIndex), /await throwIfToolUnavailable\(\); await updateProgress\(35/);
  assert.doesNotMatch(transfer.slice(commitIndex), /throwIfToolUnavailable/);
});
console.log(`${checks}/${checks} TD2 in-flight availability checks passed`);

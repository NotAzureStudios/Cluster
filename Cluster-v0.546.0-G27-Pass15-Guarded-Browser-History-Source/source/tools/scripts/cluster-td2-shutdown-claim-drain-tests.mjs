import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
function loadTs(file, stubs) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(content, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unmocked import ${name} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const types = loadTs('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, fn) => fn() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue: class {} },
});
const job = {
  id: 'job-shutdown', type: 'library.derivative.build', payload: '{}',
  leaseOwner: 'opaque-claim-token', attempts: 1, maxAttempts: 5,
  correlationId: null, workspaceId: null, createdById: null,
};
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
let count = 0;
async function check(title, fn) { await fn(); ++count; console.log('PASS', title); }

await check('stop during a pending claim releases the unstarted lease rather than executing', async () => {
  const claim = deferred();
  let handlerCalls=0, claims=0, releases=0;
  const queue = {
    claim: async () => { claims++; return claim.promise; },
    deferDisabled: async (claimedJob, workerId, delayMs) => {
      assert.equal(claimedJob.leaseOwner, job.leaseOwner);
      assert.equal(workerId, 'shutdown-worker');
      assert.equal(delayMs, 1000);
      releases++; return 'DEFERRED';
    },
  };
  const worker = new DurableJobWorker(queue, { workerId: 'shutdown-worker', concurrency: 1 });
  worker.register(job.type, async () => { handlerCalls++; });
  const batch = worker.runBatch();
  let drained = false;
  const draining = worker.drain().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false, 'drain must include an outstanding claim');
  claim.resolve(job);
  assert.equal(await batch, 0);
  await draining;
  assert.equal(handlerCalls, 0);
  assert.equal(claims, 1);
  assert.equal(releases, 1);
  assert.equal(worker.snapshot().claimed, 0);
  assert.equal(worker.snapshot().deferred, 1);
  assert.equal(await worker.runBatch(), 0);
});

await check('drain waits for release transaction before returning', async () => {
  const claim=deferred(), release=deferred();
  let done=false;
  const queue={ claim: async () => claim.promise, deferDisabled: async () => release.promise };
  const worker=new DurableJobWorker(queue, { concurrency:1 });
  worker.register(job.type, async () => { throw Error('should not execute'); });
  const batch=worker.runBatch();
  const draining=worker.drain().then(() => { done=true; });
  claim.resolve(job);
  await tick(); await tick();
  assert.equal(done,false);
  release.resolve('DEFERRED');
  assert.equal(await batch,0);
  await draining;
  assert.equal(worker.snapshot().deferred,1);
});

await check('failed release cannot start the handler and leaves the claim for lease recovery', async () => {
  const claim=deferred();
  let handlers=0, warnings=0;
  const queue={ claim:async()=>claim.promise, deferDisabled:async()=>{ throw Error('db unavailable'); } };
  const worker=new DurableJobWorker(queue,{concurrency:1,logger:{warn:()=>{warnings++;}}});
  worker.register(job.type,async()=>{handlers++;});
  const batch=worker.runBatch();
  const draining=worker.drain();
  claim.resolve(job);
  assert.equal(await batch,0);
  await draining;
  assert.equal(handlers,0);
  assert.equal(warnings,1);
  assert.equal(worker.snapshot().succeeded,0);
});

await check('superseded lease cannot be released during shutdown', async () => {
  const claim=deferred();
  let handlers=0;
  const queue={claim:async()=>claim.promise,deferDisabled:async()=>null};
  const worker=new DurableJobWorker(queue,{concurrency:1});
  worker.register(job.type,async()=>{handlers++;});
  const batch=worker.runBatch(); const draining=worker.drain(); claim.resolve(job);
  assert.equal(await batch,0); await draining;
  assert.equal(handlers,0);
  assert.equal(worker.snapshot().leaseLost,1);
});

await check('drain still waits for existing handler to finish safely', async () => {
  const finish=deferred(), entered=deferred();
  let claims=0, success=0;
  const queue={
    claim:async()=>{claims++; return claims===1?job:null;},
    heartbeat:async()=>true,
    cancellationRequested:async()=>false,
    succeed:async()=>{success++;return 'SUCCEEDED';},
    fail:async()=>'QUEUED',
  };
  const worker=new DurableJobWorker(queue,{concurrency:1});
  worker.register(job.type,async()=>{entered.resolve(); await finish.promise; return {ok:true};});
  assert.equal(await worker.runBatch(),1);
  await entered.promise;
  let drained=false;
  const draining=worker.drain().then(()=>{drained=true;});
  await tick(); assert.equal(drained,false);
  finish.resolve(); await draining;
  assert.equal(success,1);
  assert.equal(worker.snapshot().succeeded,1);
});

await check('failed pending database claim settles drain without launching work', async () => {
  const claim=deferred();
  const queue={claim:async()=>claim.promise};
  const worker=new DurableJobWorker(queue,{concurrency:1});
  let ran=0;
  worker.register(job.type,async()=>{ran++;});
  const batch=worker.runBatch(); const draining=worker.drain();
  claim.reject(Error('database shutdown'));
  await assert.rejects(batch, /database shutdown/);
  await draining;
  assert.equal(ran,0);
});
console.log(`${count}/${count} TD2 shutdown claim drain checks passed`);

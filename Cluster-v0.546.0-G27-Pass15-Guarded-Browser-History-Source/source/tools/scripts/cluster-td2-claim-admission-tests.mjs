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
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('require','module','exports',compiled.outputText)((name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw Error(`Unmocked import ${name} in ${file}`);
  },mod,mod.exports);
  return mod.exports;
}
const types = loadTs('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_context, fn) => fn() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue: class {} },
});
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve=res; reject=rej; }); return { promise, resolve, reject }; };
const nextTick = () => new Promise((resolve) => setImmediate(resolve));
const job = (id) => ({id, type:'test.owned', payload:'{}', leaseOwner:`lease:${id}`, attempts:1, maxAttempts:5, correlationId:null,workspaceId:null,createdById:null });
let passed = 0;
async function check(name, fn) { await fn(); console.log('PASS',name); passed++; }

await check('overlapping runBatch callers do not exceed concurrency while a claim is pending', async () => {
  const heldClaim=deferred(), finish=deferred(), entered=deferred(); let claims=0, running=0, peak=0;
  const queue={
    claim:async()=> { claims++; return claims===1?heldClaim.promise:null; },
    heartbeat:async()=>true, cancellationRequested:async()=>false,
    succeed:async()=>true, fail:async()=>true,
  };
  const worker=new DurableJobWorker(queue,{concurrency:1});
  worker.register('test.owned', async()=>{running++; peak=Math.max(running,peak); entered.resolve(); await finish.promise; running--;});
  const first=worker.runBatch();
  assert.equal(worker.snapshot().pendingClaimBatches,1);
  assert.equal(await worker.runBatch(),0);
  assert.equal(await worker.runBatch(),0);
  assert.equal(claims,1, 'a second PostgreSQL claim should never start during the first claim');
  heldClaim.resolve(job('one'));
  assert.equal(await first,1);
  await entered.promise;
  assert.equal(peak,1);
  assert.equal(worker.snapshot().running,1);
  assert.equal(worker.snapshot().pendingClaimBatches,0);
  assert.equal(await worker.runBatch(),0);
  finish.resolve(); await worker.drain();
  assert.equal(peak,1);
});

await check('a completed claim cycle permits a fresh cycle to fill available slots', async()=>{
  let claims=0; const finish=deferred();
  const queue={claim:async()=>{claims++;return claims===1?job('two'):null;}, heartbeat:async()=>true, cancellationRequested:async()=>false,succeed:async()=>true,fail:async()=>true};
  const worker=new DurableJobWorker(queue,{concurrency:1});
  worker.register('test.owned',async()=>{await finish.promise;});
  assert.equal(await worker.runBatch(),1);
  assert.equal(await worker.runBatch(),0);
  assert.equal(claims,1, 'running concurrency still enforced');
  finish.resolve();
  await nextTick(); await nextTick();
  assert.equal(await worker.runBatch(),0);
  assert.equal(claims,2, 'a new admission cycle is allowed after the first finishes');
  await worker.drain();
});

await check('failed claim releases admission state and allows retry',async()=>{
  let claims=0;
  const queue={ claim:async()=>{claims++;if(claims===1)throw new Error('database briefly down');return null;} };
  const worker=new DurableJobWorker(queue,{concurrency:1});
  await assert.rejects(worker.runBatch(),/database briefly down/);
  await nextTick();
  assert.equal(worker.snapshot().pendingClaimBatches,0);
  assert.equal(await worker.runBatch(),0);
  assert.equal(claims,2);
  await worker.drain();
});

await check('shutdown waits for pending admission; duplicate callers cannot start a handler',async()=>{
  const claim=deferred(), release=deferred(); let calls=0, releases=0;
  const queue={claim:async()=>{calls++;return claim.promise;},deferDisabled:async()=>{releases++;return release.promise;}};
  const worker=new DurableJobWorker(queue,{concurrency:1});
  let handlerCalls=0; worker.register('test.owned',async()=>{handlerCalls++;});
  const first=worker.runBatch();
  assert.equal(await worker.runBatch(),0);
  let drained=false;
  const drain=worker.drain().then(()=>{drained=true;});
  claim.resolve(job('late'));
  await nextTick(); assert.equal(drained,false);
  release.resolve(true);
  assert.equal(await first,0);
  await drain;
  assert.equal(calls,1); assert.equal(releases,1); assert.equal(handlerCalls,0);
  assert.equal(worker.snapshot().pendingClaimBatches,0);
});
console.log(`${passed}/${passed} TD2 claim-admission checks passed`);

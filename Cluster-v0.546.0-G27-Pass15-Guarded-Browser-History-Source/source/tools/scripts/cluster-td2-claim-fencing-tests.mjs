import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function loadTs(file, stubs) {
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
const { BackgroundJobQueue } = loadTs('apps/server/src/domains/jobs/job-queue-service.ts', {
  '../../core/reliability-context.js': { currentReliabilityContext: () => null },
  '../../core/cursor-pagination.js': { decodeCursor: () => null, encodeCursor: () => '' },
  './job-types.js': types,
  '../../core/postgres-advisory-lock.js': { acquireTransactionAdvisoryLock: async () => {} },
});
const { DurableJobWorker } = loadTs('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_ctx, fn) => fn() },
  './job-types.js': types,
  './job-queue-service.js': { BackgroundJobQueue },
});
let assertions = 0;
async function check(label, fn) { await fn(); assertions++; console.log('PASS', label); }
const baseJob = (token, attempt=1) => ({
  id:'job-1', type:'library.derivative.build', payload:'{}', leaseOwner: token,
  status:'RUNNING', attempts:attempt, maxAttempts:5, correlationId:null,
  workspaceId:null, createdById:null, leaseExpiresAt:new Date(Date.now() + 30000),
});
class StubDb {
  constructor(job) { this.job = { ...job }; this.writes = []; this.attempts = []; this.lastClaimToken = null; }
  async $transaction(fn) { return fn(this); }
  owned(params) { return this.job.status === 'RUNNING' && this.job.leaseOwner === params[1]
    && this.job.leaseExpiresAt > new Date() && this.job.attempts === params.at(-1); }
  async $queryRawUnsafe(sql, ...params) {
    if (sql.includes('SELECT job."id", job."workspaceId"')) {
      return [{ id: this.job.id, workspaceId: null }];
    }
    if (sql.includes('WITH workspace_load')) {
      assert.equal(params[7], this.job.id);
      assert.match(sql, /"leaseOwner"\s*=\s*\$7/);
      assert.equal(params[1], 'host:123:worker');
      const token = params[6];
      assert.ok(token.startsWith('host:123:worker:'));
      this.lastClaimToken = token;
      this.job = { ...this.job, leaseOwner:token, attempts:this.job.attempts + 1, status:'RUNNING', leaseExpiresAt:new Date(Date.now()+60000) };
      return [{ ...this.job }];
    }
    if (sql.includes('INSERT INTO "BackgroundJobAttempt"')) {
      this.attempts.push({ jobId:params[1], attempt:params[2], workerId:params[3] }); return [{}];
    }
    if (sql.includes('FROM "BackgroundJob"') && sql.includes('FOR UPDATE')) {
      assert.match(sql, /"leaseOwner"\s*=\s*\$2/);
      assert.match(sql, /"leaseExpiresAt"\s*>\s*NOW\(\)/);
      assert.match(sql, /"attempts"\s*=\s*\$3/);
      return this.owned(params) ? [{ ...this.job, cancelRequestedAt:null }] : [];
    }
    return [];
  }
  async $executeRawUnsafe(sql, ...params) {
    this.writes.push({ sql, params });
    if (sql.includes('"BackgroundJobAttempt"')) return 1;
    if (!sql.includes('UPDATE "BackgroundJob"')) return 0;
    if (!sql.includes('"leaseOwner" = $2')) return 0;
    assert.match(sql, /"leaseExpiresAt"\s*>\s*NOW\(\)/);
    assert.match(sql, /"attempts"\s*=\s*\$\d+/);
    if (!this.owned(params)) return 0;
    if (sql.includes('"progress" = $3')) this.job.progress = params[2];
    if (sql.includes('"status" = CASE WHEN $3')) { this.job.status = params[2] ? 'CANCELLED':'QUEUED'; this.job.leaseOwner = null; }
    else if (sql.includes('"status" = $3')) { this.job.status = params[2]; this.job.leaseOwner = null; }
    else if (sql.includes('"leaseExpiresAt" = NOW()')) this.job.leaseExpiresAt = new Date(Date.now() + params[2]);
    return 1;
  }
}
await check('each queue claim uses a new opaque lease token, retaining process worker identity for attempts', async () => {
  const db = new StubDb(baseJob('original', 0)); const queue = new BackgroundJobQueue(db);
  const first = await queue.claim('host:123:worker');
  assert.ok(first.leaseOwner !== 'host:123:worker');
  assert.equal(db.attempts[0].workerId, 'host:123:worker');
  db.job.status = 'QUEUED';
  const second = await queue.claim('host:123:worker');
  assert.notEqual(first.leaseOwner, second.leaseOwner);
});
await check('expired claims cannot resurrect themselves via heartbeat or progress', async () => {
  const job = baseJob('token-a'); job.leaseExpiresAt = new Date(Date.now()-1000);
  const db = new StubDb(job); const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.heartbeat(job), false);
  assert.equal(await queue.updateProgress(job, 44), false);
});
await check('a newer claim rejects the previous worker even with the same worker ID and attempt', async () => {
  const old = baseJob('old-token');
  const db = new StubDb(baseJob('fresh-token')); const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.heartbeat(old), false);
  assert.equal(await queue.updateProgress(old, 20), false);
  assert.equal(await queue.deferDisabled(old, 'same-worker'), null);
  assert.equal(await queue.succeed(old, 'same-worker', {}), null);
  assert.equal(await queue.fail(old, 'same-worker', Error('stale')), null);
  assert.equal(db.job.leaseOwner, 'fresh-token');
  assert.equal(db.job.status, 'RUNNING');
});
await check('a valid claim can renew and write progress while an expired one cannot', async () => {
  const job = baseJob('current'); const db = new StubDb(job); const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.heartbeat(job), true);
  assert.equal(await queue.updateProgress(job, 73, 'Working'), true);
  assert.equal(db.job.progress, 73);
});
await check('valid finalization completes only the current claim', async () => {
  const job = baseJob('current'); const db = new StubDb(job); const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.succeed(job, 'worker-process', { ok:true }), 'SUCCEEDED');
  assert.equal(db.job.status, 'SUCCEEDED');
  assert.equal(await queue.succeed(job, 'worker-process', { ok:true }), null);
});
await check('valid deferral restores attempt budget, while stale claim cannot defer a reclaimed job', async () => {
  const job = baseJob('token-1'); const db = new StubDb(job); const queue = new BackgroundJobQueue(db);
  assert.equal(await queue.deferDisabled(job, 'worker-process'), 'DEFERRED');
  assert.equal(db.job.status, 'QUEUED');
  assert.equal(await queue.deferDisabled(job, 'worker-process'), null);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runWorker({ heartbeat, succeed, progress=false } = {}) {
  const job = baseJob('token'); let claimed=false, ran=false, success=0, fail=0;
  const queue = {
    claim:async () => { if (claimed) return null; claimed=true; return job; },
    cancellationRequested:async () => false,
    heartbeat:heartbeat ?? (async()=>true),
    updateProgress: async()=>!progress,
    succeed:succeed ?? (async()=>{ success++; return 'SUCCEEDED'; }),
    fail:async()=>{ fail++; return null; },
    deferDisabled:async()=>null,
  };
  const worker = new DurableJobWorker(queue, { concurrency:1, leaseMs:60000 });
  worker.register(job.type, async ({ updateProgress }) => { ran=true; if (progress) await updateProgress(20); return 'ok'; });
  await worker.runBatch();
  for (let i=0;i<80 && worker.snapshot().running;i++) await pause(5);
  assert.equal(worker.snapshot().running,0);
  worker.stop();
  return { snapshot:worker.snapshot(), ran, success, fail };
}
await check('worker fences the handler before entry when its lease cannot be renewed', async () => {
  const r = await runWorker({ heartbeat:async()=>false });
  assert.equal(r.ran,false);
  assert.equal(r.snapshot.succeeded,0);
  assert.equal(r.snapshot.leaseLost,1);
});
await check('worker does not report success if the completion fence rejects it', async () => {
  const r = await runWorker({ succeed:async()=>null });
  assert.equal(r.ran,true);
  assert.equal(r.snapshot.succeeded,0);
  assert.equal(r.snapshot.leaseLost,1);
});
await check('worker stops after fenced progress write fails', async () => {
  const r = await runWorker({ progress:true });
  assert.equal(r.snapshot.succeeded,0);
  assert.equal(r.snapshot.leaseLost,1);
});
console.log(`${assertions}/${assertions} TD2 claim fencing checks passed`);

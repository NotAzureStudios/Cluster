import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GpuMediaLeaseCoordinator, GpuMediaLeaseLost } from '../../apps/server/src/core/gpu-media-leases.ts';
import { computeGpuMediaBudget } from '../../apps/server/src/core/gpu-telemetry.ts';

let checks = 0;
const check = (condition, reason) => { assert.ok(condition, reason); checks++; };
const src = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

// Fake the PostgreSQL transaction, row count and xact advisory lock, exercising
// the actual coordinator with multiple independent callers. No DB is claimed.
const records = new Map();
let transactionTail = Promise.resolve();
let denied = false;
let renewFailure = false;
const statement = (segments) => segments.join('$');
const transaction = {
  async $queryRaw(parts, ...values) {
    const sql = statement(parts);
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: !denied }];
    if (sql.includes('count(*)')) return [{ count: [...records.values()].filter(row => row.host === values[0] && row.deviceId === values[1] && row.expiresAt > Date.now()).length }];
    if (sql.includes('UPDATE "GpuMediaLease"')) {
      const row = records.get(values[1]);
      if (renewFailure || !row || row.expiresAt <= Date.now()) return [];
      if (row.host !== values[2] || row.deviceId !== values[3] || row.jobId !== values[4]) return [];
      row.expiresAt = Date.now() + Number(values[0]) * 1000;
      return [{id: row.id}];
    }
    throw Error(`Unexpected query: ${sql}`);
  },
  async $executeRaw(parts, ...values) {
    const sql = statement(parts);
    if (sql.includes('DELETE') && sql.includes('"expiresAt"')) {
      for (const [id, row] of records) if (row.expiresAt <= Date.now()) records.delete(id);
      return 1;
    }
    if (sql.includes('INSERT')) {
      const [id, host, deviceId, jobId, ttlSeconds] = values;
      records.set(id, {id, host, deviceId, jobId, expiresAt:Date.now()+ttlSeconds*1000});
      return 1;
    }
    if (sql.includes('DELETE') && sql.includes('"id"')) {
      const row = records.get(values[0]);
      if (row && row.host === values[1] && row.deviceId === values[2] && row.jobId === values[3]) records.delete(row.id);
      return 1;
    }
    throw Error(`Unexpected execute: ${sql}`);
  },
  async $transaction(work) {
    const prev = transactionTail;
    let unlock;
    transactionTail = new Promise(resolve => { unlock = resolve; });
    await prev;
    try { return await work(transaction); } finally { unlock(); }
  },
};
const a = new GpuMediaLeaseCoordinator(transaction, 15, 15);
const b = new GpuMediaLeaseCoordinator(transaction, 15, 15);
const claims = await Promise.all([a,b,a,b,a].map((client, i) => client.tryAcquire({host:'server',deviceId:'GPU-a',jobId:`job-${i}`,limit:2})));
check(claims.filter(Boolean).length === 2, 'cross-worker capacity must be shared');
check(records.size === 2, 'only two leases may be inserted');
check(await a.tryAcquire({host:'server',deviceId:'GPU-b',jobId:'another-card',limit:1}) !== null, 'separate card has separate quota');
check(await a.tryAcquire({host:'server-2',deviceId:'GPU-a',jobId:'remote-card',limit:1}) !== null, 'remote host gets own card budget');
const lease = claims[0];
check(await b.renew(lease), 'another process can renew a valid lease');
await a.release(lease);
check(!await b.renew(lease), 'a released lease cannot be renewed');
check(await b.tryAcquire({host:'server',deviceId:'GPU-a',jobId:'reuse',limit:2}) !== null, 'released slot is reusable');
check(await a.tryAcquire({host:'server',deviceId:'GPU-a',jobId:'zero',limit:0}) === null, 'zero budget refuses work');
denied = true;
check(await a.tryAcquire({host:'server',deviceId:'GPU-a',jobId:'contended',limit:9}) === null, 'DB lock contention fails closed');
denied = false;
let thrown = false;
try { await a.run({id:'not-present',host:'server',deviceId:'GPU-a',jobId:'orphan'}, async (signal) => {
  await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
}); } catch(e) { thrown = e instanceof GpuMediaLeaseLost; }
check(thrown, 'a vanished lease must cancel accelerated work');
const ok = await a.tryAcquire({host:'server',deviceId:'GPU-c',jobId:'complete',limit:1});
check(await a.run(ok, async (signal) => { check(!signal.aborted, 'normal work starts active'); return 27; }) === 27, 'lease runs work');
check(!records.has(ok.id), 'lease released after completion');
const expired = await a.tryAcquire({host:'server',deviceId:'GPU-z',jobId:'crashed',limit:1});
records.get(expired.id).expiresAt = Date.now() - 1;
check(await a.tryAcquire({host:'server',deviceId:'GPU-z',jobId:'replacement',limit:1}) !== null, 'expired lease reclaimed');
const bad = await a.tryAcquire({host:'server',deviceId:'GPU-d',jobId:'disconnect',limit:1});
renewFailure = true;
const failure = await a.run(bad, async (signal) => {
  await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}));
  return 'not-published';
}).then(()=>null,e=>e);
check(failure instanceof GpuMediaLeaseLost, 'failed lease renewal prevents publishing GPU output');
renewFailure = false;
const telemetry = {status:'available',devices:[
 {id:'gpu-default',vendor:'nvidia',memoryTotalMiB:4096,memoryUsedMiB:1800,utilizationPercent:24,temperatureC:57},
 {id:'gpu-other',vendor:'nvidia',memoryTotalMiB:24576,memoryUsedMiB:300,utilizationPercent:1,temperatureC:34},
]};
check(computeGpuMediaBudget(telemetry,'nvenc').deviceId === 'gpu-default', 'without FFmpeg device binding, capacity must match default adapter');
check(computeGpuMediaBudget({...telemetry, devices:[{...telemetry.devices[0],temperatureC:99},telemetry.devices[1]]},'nvenc').limit === 0, 'hot default GPU must not borrow the other GPU capacity');
check(computeGpuMediaBudget({...telemetry,status:'stale'},'nvenc').deviceId === 'gpu-default', 'stale sensor must retain the same lease pool identity');
const cancelledLease = await a.tryAcquire({host:'server',deviceId:'GPU-cancel',jobId:'cancel',limit:1});
const cancelledController = new AbortController();
const cancelledJob = a.run(cancelledLease, async (jobSignal) => {
  await new Promise(resolve => jobSignal.addEventListener('abort', resolve, {once:true}));
  return 'should-not-publish';
}, cancelledController.signal).then(()=>null,error=>error);
cancelledController.abort(new Error('stopped'));
check((await cancelledJob)?.message === 'stopped', 'abort during lease run prevents publishing');
check(!records.has(cancelledLease.id), 'aborted job releases lease');
const worker = src('apps/server/src/workers/media-worker.ts');
check(worker.includes('GpuMediaLeaseCoordinator') && worker.includes('gpuLeases.run('), 'encode and thumbnails use DB admission');
check(worker.includes('gpuWork(fresh.deviceId') && worker.includes('gpuWork(device'), 'both accelerated job kinds take leases');
const ops = src('apps/server/src/domains/media/media-operations-routes.ts');
check(ops.includes('gpuJobs:') && ops.includes('requireStudioAdmin'), 'GPU occupancy is admin-only');
const schema = src('apps/server/prisma/schema.prisma');
check(schema.includes('model GpuMediaLease') && schema.includes('@@index([host, deviceId, expiresAt])'), 'schema supports scoped quota');
console.log(`GPU shared lease assertions: ${checks}/${checks} PASS`);

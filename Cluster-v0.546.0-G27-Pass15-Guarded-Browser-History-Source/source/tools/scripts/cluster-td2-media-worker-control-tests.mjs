import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function source(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
const file = 'apps/server/src/workers/media-worker-control.ts';
const { outputText } = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const imported = { exports: {} };
new Function('require', 'module', 'exports', outputText)(require, imported, imported.exports);
const { MediaWorkerControl } = imported.exports;
let count = 0;
async function check(name, fn) { await fn(); count += 1; console.log(`PASS ${name}`); }
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
await check('no authoritative directive means no new claims at startup', () => {
  const control = new MediaWorkerControl(async () => 'active');
  assert.equal(control.current(), 'maintenance');
});
await check('fresh active directive permits claims, drain and maintenance suspend', async () => {
  let mode = 'active';
  const c = new MediaWorkerControl(async () => mode);
  await c.refresh(); assert.equal(c.current(), 'active');
  mode = 'drain'; await c.refresh(); assert.equal(c.current(), 'drain');
  mode = 'maintenance'; await c.refresh(); assert.equal(c.current(), 'maintenance');
});
await check('read failure immediately fails closed and recovery re-enables', async () => {
  let fail = false;
  const c = new MediaWorkerControl(async () => { if (fail) throw Error('disconnected'); return 'active'; });
  await c.refresh(); fail = true;
  await assert.rejects(c.refresh(), /disconnected/);
  assert.equal(c.current(), 'maintenance');
  fail = false; await c.refresh(); assert.equal(c.current(), 'active');
});
await check('directive freshness expires even if an I/O request hangs', async () => {
  let now = 100;
  const io = deferred();
  let reads = 0;
  const c = new MediaWorkerControl(() => ++reads === 1 ? Promise.resolve('active') : io.promise, () => now, 15);
  await c.refresh(); assert.equal(c.current(), 'active');
  const pending = c.refresh(); now += 16;
  assert.equal(c.current(), 'maintenance');
  io.resolve('active'); await pending; assert.equal(c.current(), 'active');
});
await check('concurrent directive refreshes share one authoritative request', async () => {
  const io = deferred(); let reads = 0;
  const c = new MediaWorkerControl(() => { reads++; return io.promise; });
  const first = c.refresh(), second = c.refresh();
  assert.strictEqual(first, second);
  assert.equal(reads, 1); io.resolve('active');
  await Promise.all([first, second]); assert.equal(c.current(), 'active');
});
await check('invalid directive fails closed, never silently treats unknown as active', async () => {
  let mode = 'active';
  const c = new MediaWorkerControl(async () => mode);
  await c.refresh(); mode = 'resuming';
  await assert.rejects(c.refresh(), /unrecognized state/);
  assert.equal(c.current(), 'maintenance');
});
await check('shutdown wins over a directive already in flight', async () => {
  const io = deferred(); const c = new MediaWorkerControl(() => io.promise);
  const pending = c.refresh(); c.stop(); io.resolve('active');
  assert.equal(await pending, 'drain');
  assert.equal(c.current(), 'drain');
  assert.equal(await c.refresh(), 'drain');
});
await check('shutdown also wins over an in-flight directive error', async () => {
  const io = deferred(); const c = new MediaWorkerControl(() => io.promise);
  const pending = c.refresh(); c.stop(); io.reject(Error('lost connection'));
  await assert.rejects(pending, /lost connection/);
  assert.equal(c.current(), 'drain');
});
await check('invalid freshness budget is rejected', () => {
  assert.throws(() => new MediaWorkerControl(async () => 'active', Date.now, 0), /freshness/);
});
await check('standalone worker actually observes fail-closed control and stops periodic timers', () => {
  const s = source('apps/server/src/workers/media-worker.ts');
  assert.match(s, /new MediaWorkerControl\(\(\) => mediaWorkerDirective\(prisma, worker\.workerId\)\)/);
  assert.match(s, /control\.current\(\) !== "active"/);
  assert.match(s, /control\.stop\(\)/);
  assert.match(s, /shutdownController\.abort\(\)/);
  assert.match(s, /if \(heartbeatTimer\) clearInterval\(heartbeatTimer\)/);
  assert.match(s, /if \(directiveTimer\) clearInterval\(directiveTimer\)/);
  assert.match(s, /if \(retentionTimer\) clearInterval\(retentionTimer\)/);
  assert.doesNotMatch(s, /catch\(\(\) => "active"\)/);
});
console.log(`${count}/${count} standalone media worker control checks passed`);

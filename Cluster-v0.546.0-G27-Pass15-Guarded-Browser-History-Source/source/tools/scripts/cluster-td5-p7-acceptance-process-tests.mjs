/** Fail-closed acceptance-runner timeout, error and subprocess isolation tests. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBoundedAcceptanceStep } from './cluster-td5-acceptance-process.mjs';
const step = (args, timeoutMs = 2000) => runBoundedAcceptanceStep({
  name: 'Disposable acceptance fixture', command: process.execPath, args, timeoutMs, stdio: 'ignore',
});
test('completed subprocess has an observable success exit code', async () => {
  assert.equal(await step(['-e', 'process.exit(0)']), 0);
});
test('failed subprocess cannot be counted as passed', async () => {
  assert.equal(await step(['-e', 'process.exit(17)']), 17);
});
test('signal exit cannot count as success', async () => {
  if (process.platform === 'win32') return;
  assert.notEqual(await step(['-e', "process.kill(process.pid,'SIGTERM')"], 2_000), 0);
});
test('hung acceptance stage is interrupted by a bounded deadline', async () => {
  await assert.rejects(step(['-e', 'setInterval(()=>{},100)'], 100), /deadline/);
});
test('failed spawn rejects without leaking connection material', async () => {
  await assert.rejects(runBoundedAcceptanceStep({ name: 'Bad stage', command: '/not-a-real-td5-binary', args: [], timeoutMs: 200,
    env: { DATABASE_URL: 'postgresql://secret:password@localhost/cluster_td5_cert_test' }, stdio: 'ignore' }),
    error => !String(error).includes('password') && /could not start/.test(String(error)));
});
test('acceptance commands cannot use a shell string or infinite timer', async () => {
  assert.throws(() => runBoundedAcceptanceStep({ name: 'Invalid', command: process.execPath, args: '-e process.exit()', timeoutMs: 100 }), /Invalid/);
  assert.throws(() => runBoundedAcceptanceStep({ name: 'Invalid', command: process.execPath, args: [], timeoutMs: Infinity }), /Invalid/);
});
test('timed-out subprocess trees cannot later publish a completion artifact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cluster-td5-p7-'));
  const output = path.join(dir, 'after-deadline.txt');
  try {
    const js = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(output)},'wrongly alive'),450);setInterval(()=>{},100)`;
    await assert.rejects(step(['-e', js], 90), /deadline/);
    await new Promise(resolve => setTimeout(resolve, 550));
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('disposable runtime gate checks server PostgreSQL 18 contract before any migration', async () => {
  const output = spawnSync(process.execPath, ['tools/scripts/cluster-td5-p6-runtime-gate.mjs', '--run'], {
    encoding: 'utf8', timeout: 8000,
    env: { ...process.env, TD5_CERT_DISPOSABLE: 'I_UNDERSTAND', TD5_CERT_DATABASE_URL: 'postgresql://user:secret@127.0.0.1/cluster_td5_cert_safe' },
  });
  assert.equal(output.status, 2);
  assert.match(output.stdout + output.stderr, /BLOCKED/);
  assert.doesNotMatch(output.stdout + output.stderr, /user:secret/);
});

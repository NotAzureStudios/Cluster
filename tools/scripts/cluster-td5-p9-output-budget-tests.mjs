/** TD5 P9: actual child-process output containment and partial-secret protection. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAcceptanceOutputRedactor } from './cluster-td5-acceptance-redaction.mjs';
import { DEFAULT_ACCEPTANCE_OUTPUT_LIMIT, runBoundedAcceptanceStep } from './cluster-td5-acceptance-process.mjs';

const capture = () => { let text = ''; return { write: chunk => { text += chunk; }, read: () => text }; };
const child = (code, options = {}) => {
  const stdout = capture(), stderr = capture();
  return { stdout, stderr, run: () => runBoundedAcceptanceStep({
    name: 'TD5 P9 fixture', command: process.execPath, args: ['-e', code],
    timeoutMs: 2500, stdio: 'pipe', redactions: ['postgresql://alice:unique-password@localhost/cluster_td5_cert_test', 'unique-password', 'secret', 'secret123'],
    output: stdout, errorOutput: stderr, ...options,
  }) };
};

test('long database URL cut short by process exit never reveals a username or password prefix', async () => {
  const f = child("process.stdout.write('connect=postgresql://alice:unique-password@localhost/clus'); process.exit(3)");
  assert.equal(await f.run(), 3);
  assert.equal(f.stdout.read(), 'connect=[REDACTED]');
});

test('short-token and incomplete-long-token suffix is masked on process exit', () => {
  const parts = [];
  const filter = createAcceptanceOutputRedactor(value => parts.push(value), ['secret','secret123']);
  filter.write('key=secret12'); filter.end();
  assert.equal(parts.join(''), 'key=[REDACTED]');
});

test('incomplete credential is masked after process deadline', async () => {
  const f = child("process.stderr.write('password=unique-pass');setInterval(()=>{},100)", { timeoutMs: 350 });
  await assert.rejects(f.run(), /deadline/);
  assert.equal(f.stderr.read(), 'password=[REDACTED]');
});

test('combined stdout and stderr budget terminates a verbose child', async () => {
  const f = child("process.stdout.write('A'.repeat(850));process.stderr.write('B'.repeat(850));setInterval(()=>{},100)", { maxOutputBytes: 1200 });
  await assert.rejects(f.run(), /combined output budget/);
  assert(f.stdout.read().length + f.stderr.read().length <= 1200);
});

test('stdout-only flooding is rejected even without any newlines', async () => {
  const f = child("process.stdout.write('X'.repeat(8192));setInterval(()=>{},100)", { maxOutputBytes: 1024 });
  await assert.rejects(f.run(), /combined output budget/);
  assert.equal(f.stdout.read(), '');
});

test('output overflow kills process tree before child can publish an artifact', async () => {
  if (process.platform === 'win32') return;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cluster-td5-p9-'));
  const target = path.join(dir, 'after-overflow.txt');
  try {
    const program = `process.stdout.write('X'.repeat(4096));setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(target)},'still alive'),350);setInterval(()=>{},100)`;
    const f = child(program, { maxOutputBytes: 300 });
    await assert.rejects(f.run(), /combined output budget/);
    await new Promise(resolve => setTimeout(resolve, 500));
    await assert.rejects(readFile(target), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failing output sink cannot turn a failed logging step into a success', async () => {
  const f = child("process.stdout.write('plain text');process.exit(0)", { output: { write: () => { throw new Error('private sink details'); } } });
  await assert.rejects(f.run(), /output processing failed/);
});

test('nonsensical output budgets are rejected before spawning', async () => {
  for (const maxOutputBytes of [0, -1, Infinity, NaN, 1.5, 129 * 1024 * 1024]) {
    const f = child('process.exit(0)', { maxOutputBytes });
    assert.throws(() => f.run(), /Invalid bounded acceptance step configuration/);
  }
  assert.equal(DEFAULT_ACCEPTANCE_OUTPUT_LIMIT, 16 * 1024 * 1024);
});

test('ordinary short messages and fully printed secrets still behave as before', async () => {
  const f = child("process.stdout.write('checked secret123 and done');process.exit(0)");
  assert.equal(await f.run(), 0);
  assert.equal(f.stdout.read(), 'checked [REDACTED] and done');
});


test('unredacted inherited subprocess output is forbidden', () => {
  const f = child('process.exit(0)', { stdio: 'inherit' });
  assert.throws(() => f.run(), /Invalid bounded acceptance step configuration/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/notifications/native-notification-claims.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports });
const { deliverNativeNotificationTokens } = module.exports;
let count = 0;
async function test(label, run) { await run(); ++count; console.log('PASS ' + label); }
const tokens = (xs) => [...xs];
await test('First poll primes historical tokens without requesting native delivery', async () => {
  let state = null; let calls = 0;
  const input = { tokens: ['a:0', 'b:0'], primeIfMissing: true, read: () => state, write: (ids) => { state = ids; }, deliver: async () => { calls++; return true; } };
  assert.deepEqual(tokens(await deliverNativeNotificationTokens(input)), []);
  assert.deepEqual(tokens(state), ['a:0', 'b:0']); assert.equal(calls, 0);
  assert.deepEqual(tokens(await deliverNativeNotificationTokens({ ...input, tokens: ['a:0', 'c:0'] })), ['c:0']);
});
await test('Denied permission, rejected native display, and thrown bridge errors leave tokens retryable', async () => {
  let state = []; let attempts = 0;
  const base = { tokens: ['alert:0'], primeIfMissing: false, read: () => state, write: (ids) => { state = ids; } };
  for (const result of [false, false]) {
    assert.deepEqual(tokens(await deliverNativeNotificationTokens({ ...base, deliver: async () => { attempts++; return result; } })), []);
    assert.deepEqual(tokens(state), []);
  }
  assert.deepEqual(tokens(await deliverNativeNotificationTokens({ ...base, deliver: async () => { throw new Error('Bridge offline'); } })), []);
  assert.deepEqual(tokens(state), []);
  assert.deepEqual(tokens(await deliverNativeNotificationTokens({ ...base, deliver: async () => true })), ['alert:0']);
  assert.deepEqual(tokens(state), ['alert:0']);
  assert.equal(attempts, 2);
});
await test('Concurrent windows deliver once when a functional exclusive lock is available', async () => {
  let state = []; let calls = 0; let tail = Promise.resolve();
  const exclusive = (work) => { const next = tail.then(work); tail = next.then(() => undefined, () => undefined); return next; };
  const input = { tokens: ['x:0'], primeIfMissing: false, read: () => state, write: (ids) => { state = ids; }, exclusive,
    deliver: async () => { calls++; await Promise.resolve(); return true; } };
  const results = await Promise.all([deliverNativeNotificationTokens(input), deliverNativeNotificationTokens(input), deliverNativeNotificationTokens(input)]);
  assert.deepEqual(results.map(tokens), [['x:0'], [], []]); assert.equal(calls, 1);
});
await test('A denied delivery releases the lock so another window can retry', async () => {
  let state = []; let calls = 0; let tail = Promise.resolve();
  const exclusive = (work) => { const next = tail.then(work); tail = next.then(() => undefined, () => undefined); return next; };
  const input = { tokens: ['x:0'], primeIfMissing: false, read: () => state, write: (ids) => { state = ids; }, exclusive,
    deliver: async () => ++calls === 2 };
  const results = await Promise.all([deliverNativeNotificationTokens(input), deliverNativeNotificationTokens(input)]);
  assert.deepEqual(results.map(tokens), [[], ['x:0']]); assert.equal(calls, 2);
});
await test('Legacy seen ID suppresses level zero but permits escalation', async () => {
  let state = ['existing'];
  const result = await deliverNativeNotificationTokens({ tokens: ['existing:0', 'existing:1'], primeIfMissing: false, read: () => state, write: ids => { state = ids; }, deliver: async () => true });
  assert.deepEqual(tokens(result), ['existing:1']);
});
await test('Nonfunctional Web Locks gracefully uses a best-effort fallback', async () => {
  let state = [];
  const result = await deliverNativeNotificationTokens({ tokens: ['a:0'], primeIfMissing: false, read: () => state, write: ids => { state = ids; }, deliver: async () => true, exclusive: async () => { throw new Error('Unavailable'); } });
  assert.deepEqual(tokens(result), ['a:0']);
});
await test('Production renderer waits for confirmed native success before acknowledging token', async () => {
  const s = read('packages/renderer/src/features/notifications/desktop-notification-sync.ts');
  assert.match(s, /deliverNativeNotificationTokens\(\{/);
  assert.match(s, /deliver: \(fresh\) => showItems/);
  assert.match(s, /return delivered === true/);
  assert.match(s, /if \(!permission \|\| !alive\) return false/);
  assert.match(s, /locks\.request\(`cluster-native-notifications:\$\{user\.id\}`/);
  assert.match(s, /await deliverItems\(items, true\)/);
  assert.match(s, /deliverItems\(\[item\], false\)/);
});
console.log(`${count}/${count} G27 P51 native delivery recovery passed`);

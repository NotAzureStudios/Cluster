// Automatic signed Server updates: download when published, install only in
// the maintenance window (nightly 03:00 studio time without one), and leave
// failed or rolled-back installs for an owner.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(path.join(tmpdir(), 'cluster-auto-update-'));
const built = buildSync({ entryPoints: [path.join(root, 'apps/server/src/core/server-auto-update.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
writeFileSync(path.join(out, 'auto-update.mjs'), built.outputFiles[0].text);
const { inServerUpdateWindow, serverAutoUpdateTick } = await import(pathToFileURL(path.join(out, 'auto-update.mjs')).href);
rmSync(out, { recursive: true, force: true });

let n = 0;
async function check(label, fn) { await fn(); n++; console.log('PASS', label); }
const MIN = 60_000, HOUR = 60 * MIN;
// 2026-11-22 is a Sunday. 08:30Z = 03:30 New York; 17:00Z = 12:00.
const night = Date.parse('2026-11-22T08:30:00Z');
const noon = Date.parse('2026-11-22T17:00:00Z');
const studio = { studioTimezone: 'America/New_York' };

function harness(status, { settings = studio, now = night, available = true } = {}) {
  const calls = [];
  const deps = {
    dataRoot: '/nowhere', readSettings: async () => settings, log: { info() {} }, now: () => now,
    native: async (action) => { calls.push(action); return action === 'status' ? { ok: true, installSupported: true, ...status } : action === 'check' ? { ok: true, state: 'checked', available, installSupported: false } : { ok: true, state: 'queued', release: '2.0.800', installSupported: true }; },
    stage: async () => { calls.push('stage'); return true; },
  };
  return { deps, calls };
}

await check('default window is nightly 03:00-04:00 studio time', () => {
  assert.equal(inServerUpdateWindow(studio, night), true);
  assert.equal(inServerUpdateWindow(studio, noon), false);
});
await check('an enabled maintenance window replaces the default', () => {
  const settings = { ...studio, maintenanceWindowEnabled: true, maintenanceWindowTimezone: 'America/New_York', maintenanceWindowDaysCsv: 'Sun', maintenanceWindowStart: '12:00', maintenanceWindowDurationMinutes: 60 };
  assert.equal(inServerUpdateWindow(settings, noon), true);
  assert.equal(inServerUpdateWindow(settings, night), false);
});
await check('turned off: never touches the native updater', async () => {
  const { deps, calls } = harness({ state: 'installed' }, { settings: { ...studio, serverAutoUpdate: false } });
  assert.deepEqual(await serverAutoUpdateTick(deps), { nextDelayMs: HOUR });
  assert.deepEqual(calls, []);
});
await check('a newer release is downloaded right away, any time of day', async () => {
  const { deps, calls } = harness({ state: 'installed' }, { now: noon });
  await serverAutoUpdateTick(deps);
  assert.deepEqual(calls, ['status', 'check', 'stage']);
});
await check('nothing newer: check again in 30 minutes', async () => {
  const { deps, calls } = harness({ state: 'installed' }, { available: false });
  assert.deepEqual(await serverAutoUpdateTick(deps), { nextDelayMs: 30 * MIN });
  assert.deepEqual(calls, ['status', 'check']);
});
await check('a verified download waits for the window', async () => {
  const { deps, calls } = harness({ state: 'verified' }, { now: noon });
  await serverAutoUpdateTick(deps);
  assert.deepEqual(calls, ['status']);
});
await check('a verified download installs inside the window', async () => {
  const { deps, calls } = harness({ state: 'verified' });
  await serverAutoUpdateTick(deps);
  assert.deepEqual(calls, ['status', 'install']);
});
await check('no protected broker: never installs', async () => {
  const { deps, calls } = harness({ state: 'verified', installSupported: false });
  await serverAutoUpdateTick(deps);
  assert.deepEqual(calls, ['status']);
});
await check('rolled-back or blocked installs wait for an owner', async () => {
  for (const state of ['recovered', 'blocked']) {
    const { deps, calls } = harness({ state });
    assert.deepEqual(await serverAutoUpdateTick(deps), { nextDelayMs: HOUR });
    assert.deepEqual(calls, ['status']);
  }
});
await check('a failed download retries after an hour, not sooner', async () => {
  const recent = harness({ state: 'failed', updatedAt: new Date(night - 10 * MIN).toISOString() });
  await serverAutoUpdateTick(recent.deps);
  assert.deepEqual(recent.calls, ['status']);
  const old = harness({ state: 'failed', updatedAt: new Date(night - 2 * HOUR).toISOString() });
  await serverAutoUpdateTick(old.deps);
  assert.deepEqual(old.calls, ['status', 'check', 'stage']);
});
await check('in-flight work is only polled', async () => {
  for (const state of ['staging', 'queued', 'installing']) {
    const { deps, calls } = harness({ state });
    assert.deepEqual(await serverAutoUpdateTick(deps), { nextDelayMs: 5 * MIN });
    assert.deepEqual(calls, ['status']);
  }
});
console.log(`Server auto-update: ${n}/${n} passed`);

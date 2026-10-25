import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function loadTs(file, stubs) {
  const { outputText } = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((key) => {
    if (Object.hasOwn(stubs, key)) return stubs[key];
    throw new Error(`Unmocked dependency ${key} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const { registerStudioAutomationEventBridge, scanStudioAutomationCalendar } = loadTs(
  'apps/server/src/domains/automation/studio-automation-event-bridge.ts',
  { '@cluster/shared': { CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded' } } } },
);
const now = new Date();
const events = count => Array.from({ length: count }, (_, i) => ({ id: `event-${i}`, title: 'Work', startsAt: new Date(now.getTime() + 30 * 60_000), ownerId: 'member', projectId: 'project', status: 'scheduled' }));
let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log('PASS', label); }
await check('Calendar scan fails closed before querying when its owner is disabled', async () => {
  let queried = false;
  await assert.rejects(scanStudioAutomationCalendar({
    prisma: { calendarEvent: { findMany: async () => { queried = true; return events(1); } } },
    studioAutomation: { processEvent: async () => {} },
    checkAvailability: async () => { throw Error('Calendar disabled'); }, now,
  }), /Calendar disabled/);
  assert.equal(queried, false);
});
await check('Calendar scan checks the owner during a long batch instead of processing everything', async () => {
  let enabled = true, processed = 0, gates = 0;
  await assert.rejects(scanStudioAutomationCalendar({
    prisma: { calendarEvent: { findMany: async () => events(130) } },
    studioAutomation: { processEvent: async () => { processed++; if (processed === 1) enabled = false; } },
    checkAvailability: async () => { gates++; if (!enabled) throw Error('defer due to tool disable'); }, now,
  }), /defer due to tool disable/);
  assert.equal(processed, 64, 'maximum one 64-event segment after remote disable');
  assert.equal(gates, 3, 'entry, first segment and next segment');
});
await check('healthy scan processes all events, with bounded checkpoints and final check', async () => {
  let processed = 0, gates = 0;
  const result = await scanStudioAutomationCalendar({
    prisma: { calendarEvent: { findMany: async () => events(130) } },
    studioAutomation: { processEvent: async () => { processed++; } },
    checkAvailability: async () => { gates++; }, now,
  });
  assert.equal(processed, 130); assert.equal(result.evaluated, 130);
  assert.equal(gates, 5, 'entry + 0/64/128 + exit, not per-row DB reads');
});
function bridge({ availability, entity = 'calendar_event', type = 'created', prismaThrows = false } = {}) {
  let handler, dbReads = 0, processed = 0, checked = 0;
  const prisma = {
    calendarEvent: { findUnique: async () => { dbReads++; if (prismaThrows) throw Error('DB calendar read'); return events(1)[0]; } },
    project: { findUnique: async () => ({ id: 'project', name: 'Test', status: 'active', projectType: 'generic', memberships: [] }) },
  };
  registerStudioAutomationEventBridge({
    prisma,
    events: { subscribe: (name, key, cb) => { assert.equal(key, 'automation.studio-activity'); handler = cb; } },
    studioAutomation: { processEvent: async () => { processed++; } },
    isCalendarEnabled: async () => { checked++; return availability?.() ?? true; },
  });
  const fire = () => handler({ id: 'activity', payload: { id: 'activity', userId: 'user', entityType: entity, type, entityId: 'event-0', createdAt: now } });
  return { fire, counters: () => ({ dbReads, processed, checked }) };
}
await check('disabled Calendar activity avoids Calendar DB reads and automation work', async () => {
  const test = bridge({ availability: () => false });
  await test.fire(); assert.deepEqual(test.counters(), { dbReads: 0, processed: 0, checked: 1 });
});
await check('enabled Calendar events keep their normal event-driven automation behavior', async () => {
  const test = bridge(); await test.fire();
  assert.deepEqual(test.counters(), { dbReads: 1, processed: 1, checked: 1 });
});
await check('Calendar disable does not suspend independent Project-created automation', async () => {
  const test = bridge({ availability: () => false, entity: 'project' });
  await test.fire(); assert.deepEqual(test.counters(), { dbReads: 0, processed: 1, checked: 0 });
});
await check('Calendar availability failure is not silently interpreted as enabled', async () => {
  const test = bridge({ availability: () => { throw Error('Settings unavailable'); } });
  await assert.rejects(test.fire(), /Settings unavailable/);
  assert.deepEqual(test.counters(), { dbReads: 0, processed: 0, checked: 1 });
});
await check('job handler passes the guarded scan callback through to the shared scanner', () => {
  const job = read('apps/server/src/app/server-job-runtime.ts');
  const runtime = read('apps/server/src/app/server-automation-job-runtime.ts');
  assert.match(job, /evaluateCalendarTriggers\?\.\(new Date\(\), throwIfToolUnavailable\)/);
  assert.match(runtime, /scanStudioAutomationCalendar\(\{ prisma: input\.prisma, studioAutomation, now, checkAvailability \}\)/);
  assert.match(runtime, /input\.readSettings\(true\)/);
  assert.match(runtime, /input\.backgroundTasks\.isOwnerEnabled\("calendar"\)/);
});
console.log(`${checks}/${checks} TD2 Calendar runtime ownership checks passed`);

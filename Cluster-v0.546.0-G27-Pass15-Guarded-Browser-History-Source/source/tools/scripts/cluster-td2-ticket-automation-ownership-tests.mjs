import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, stubs) {
  const { outputText } = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(key => {
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (key === 'node:crypto') return require(key);
    throw Error(`Unmocked import ${key} in ${file}`);
  }, mod, mod.exports);
  return mod.exports;
}
const shared = { CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded' } }, CLUSTER_WORKFLOW_RELATIONSHIPS: [], CLUSTER_WORK_SOURCE_KINDS: [] };
const { registerStudioAutomationEventBridge } = load('apps/server/src/domains/automation/studio-automation-event-bridge.ts', { '@cluster/shared': shared });
const ownership = load('apps/server/src/domains/jobs/job-tool-ownership.ts', {});
const { createProjectAutomationService } = load('apps/server/src/domains/projects/project-automation-service.ts', {
  '@cluster/shared': shared,
  '../jobs/job-types.js': { BackgroundJobRetryError: class extends Error {}, BackgroundJobDeferredError: class extends Error {} },
  '../jobs/job-tool-ownership.js': ownership,
  './project-control-service.js': { serializeProjectControlRecord: value => value },
});
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('PASS', label); }
const ticket = { id: 'card-1', workItemKind: 'ticket', title: 'Bug', listId: 'list-1', list: { title: 'Bugs', isDone: false, boardId: 'board-1', board: { id: 'board-1', projectId: 'p1', project: { id: 'p1' } } } };
function testStudio({ enabled = true, entityType = 'ticket', card = ticket, failure = false } = {}) {
  let handler, reads = 0, checks = 0, processed = 0;
  registerStudioAutomationEventBridge({
    prisma: {
      card: { findUnique: async () => { reads++; return card; } },
      project: { findUnique: async () => { reads++; return { id: 'p1', name: 'Project', status: 'active', memberships: [] }; } },
    },
    events: { subscribe: (_type, _key, cb) => { handler = cb; } },
    studioAutomation: { processEvent: async () => { processed++; } },
    isTicketsEnabled: async () => { checks++; if (failure) throw Error('Settings DB failed'); return enabled; },
  });
  return {
    fire: () => handler({ id: 'activity', payload: { id: 'activity', entityType, entityId: 'card-1', projectId: 'p1', type: entityType === 'project' ? 'created' : 'updated' } }),
    counters: () => ({ reads, checks, processed }),
  };
}
await check('Explicit Ticket event does no DB lookup or automation when disabled', async () => {
  const t = testStudio({ enabled: false }); await t.fire();
  assert.deepEqual(t.counters(), { reads: 0, checks: 1, processed: 0 });
});
await check('Card event classified as Ticket is suppressed before automation', async () => {
  const t = testStudio({ enabled: false, entityType: 'card' }); await t.fire();
  assert.deepEqual(t.counters(), { reads: 1, checks: 1, processed: 0 });
});
await check('Healthy enabled Ticket automation remains operational', async () => {
  const t = testStudio(); await t.fire();
  assert.deepEqual(t.counters(), { reads: 1, checks: 1, processed: 1 });
});
await check('Non-Ticket cards remain outside Ticket automation without a Settings read', async () => {
  const t = testStudio({ enabled: false, entityType: 'card', card: { ...ticket, workItemKind: 'task' } });
  await t.fire(); assert.deepEqual(t.counters(), { reads: 1, checks: 0, processed: 0 });
});
await check('Disabled Ticket policy does not suppress Project-created automation', async () => {
  const t = testStudio({ enabled: false, entityType: 'project' });
  await t.fire(); assert.deepEqual(t.counters(), { reads: 1, checks: 0, processed: 1 });
});
await check('Ticket Settings failures do not fail open', async () => {
  const t = testStudio({ failure: true });
  await assert.rejects(t.fire(), /Settings DB failed/);
  assert.deepEqual(t.counters(), { reads: 0, checks: 1, processed: 0 });
});
function testProject({ enabled = true, entityType = 'ticket', card = ticket, failure = false } = {}) {
  let handler, cardReads = 0, ruleReads = 0, checks = 0;
  const prisma = {
    card: { findUnique: async () => { cardReads++; return card; } },
    projectControlRecord: { findMany: async () => { ruleReads++; return []; } },
  };
  createProjectAutomationService({
    prisma,
    events: { subscribe: (_type, key, cb) => { assert.equal(key, 'projects.automation-activity'); handler = cb; } },
    jobQueue: { enqueue: async () => { throw Error('Unexpected job'); } },
    logActivity: async () => {},
    isTicketsEnabled: async () => { checks++; if (failure) throw Error('Settings DB failed'); return enabled; },
  });
  return {
    fire: () => handler({ id: 'activity', payload: { id: 'activity', entityType, entityId: 'card-1', projectId: 'p1', type: 'updated' } }),
    counters: () => ({ cardReads, ruleReads, checks }),
  };
}
await check('Project automation skips explicit disabled Ticket events before DB read', async () => {
  const t = testProject({ enabled: false }); await t.fire();
  assert.deepEqual(t.counters(), { cardReads: 0, ruleReads: 0, checks: 1 });
});
await check('Project automation does not enqueue work for a disabled Ticket card', async () => {
  const t = testProject({ enabled: false, entityType: 'card' }); await t.fire();
  assert.deepEqual(t.counters(), { cardReads: 1, ruleReads: 0, checks: 1 });
});
await check('Project automation still handles enabled Ticket events', async () => {
  const t = testProject(); await t.fire();
  assert.deepEqual(t.counters(), { cardReads: 1, ruleReads: 1, checks: 1 });
});
await check('Unrelated Project/Board activity does not read Ticket Settings', async () => {
  const t = testProject({ enabled: false, entityType: 'card', card: { ...ticket, workItemKind: 'task' } });
  await t.fire(); assert.deepEqual(t.counters(), { cardReads: 1, ruleReads: 1, checks: 0 });
});
await check('Project Ticket automation fails closed when authoritative Settings unavailable', async () => {
  const t = testProject({ failure: true });
  await assert.rejects(t.fire(), /Settings DB failed/);
  assert.deepEqual(t.counters(), { cardReads: 0, ruleReads: 0, checks: 1 });
});
await check('Both bridges use the same fresh Settings gate and local kill switch', async () => {
  const wiring = read('apps/server/src/app/server-automation-job-runtime.ts');
  assert.match(wiring, /input\.backgroundTasks\.isOwnerEnabled\("tickets"\)/);
  assert.match(wiring, /input\.readSettings\(true\)/);
  assert.match(wiring, /settings\.ticketsEnabled !== false/);
  assert.match(wiring, /createProjectAutomationService\(\{[^}]*isTicketsEnabled/);
  assert.match(wiring, /registerStudioAutomationEventBridge\(\{[\s\S]*?isTicketsEnabled/);
});
console.log(`${passed}/${passed} TD2 Ticket automation ownership checks passed`);

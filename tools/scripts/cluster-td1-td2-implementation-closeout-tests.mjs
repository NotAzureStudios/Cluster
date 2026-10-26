import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, stubs = {}) {
  const { outputText } = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('node:')) return require(id);
    throw Error(`Unmocked ${id} for ${file}`);
  }, module, module.exports);
  return module.exports;
}
const ownership = load('apps/server/src/domains/jobs/job-tool-ownership.ts');
const jobs = load('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { createStudioAutomationService } = load('apps/server/src/domains/automation/studio-automation-service.ts', {
  '../decisions/decision-service.js': { createDecisionService: () => ({}) },
  '../jobs/job-types.js': jobs,
  '../jobs/job-tool-ownership.js': ownership,
});
let count = 0;
async function check(name, test) { await test(); count++; console.log('PASS ' + name); }
function storeFixture() {
  let row = null;
  let simulateCreateCollision = false;
  let simulateUpdateCollision = false;
  const prisma = { clientStateRecord: {
    findUnique: async () => row && { ...row },
    create: async ({ data }) => {
      if (simulateCreateCollision) { row = { ...data, id: 'newer', payload: '[]', revision: 1 }; throw Object.assign(new Error('duplicate'), { code: 'P2002' }); }
      row = { ...data, id: 'the-rules' }; return { ...row };
    },
    updateMany: async ({ where, data }) => {
      if (simulateUpdateCollision) { row.revision++; return { count: 0 }; }
      if (where.revision !== row?.revision || where.id !== row?.id) return { count: 0 };
      row = { ...row, payload: data.payload, revision: row.revision + 1 }; return { count: 1 };
    },
  }};
  return { prisma, get: () => row, seed: x => { row = { id: 'existing', payload: '[]', revision: x }; }, createCollision: () => { simulateCreateCollision = true; }, updateCollision: () => { simulateUpdateCollision = true; } };
}
function service(db, enabled = async () => true, log = async () => {}) {
  return createStudioAutomationService({ prisma: db.prisma, jobQueue: { enqueue: async () => { throw new Error('unexpected enqueue'); } }, logActivity: log, isActionToolEnabled: enabled });
}
await check('automation rule route requires a caller-supplied original revision', () => {
  const text = source('apps/server/src/domains/automation/studio-automation-routes.ts');
  assert.match(text, /expectedRevision: z\.number\(\)\.int\(\)\.min\(0\)\s*[},]/);
  assert.doesNotMatch(text, /expectedRevision: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/);
});
await check('the saved automation editor sends the loaded original revision', () => {
  const text = source('packages/renderer/src/features/application/modules/application-automation-settings.tsx');
  assert.match(text, /expectedRevision: ruleRevision/);
});
await check('missing write version is never silently promoted to the current revision', async () => {
  const db = storeFixture(); db.seed(4);
  await assert.rejects(service(db).saveRules([], undefined), /original read revision/);
  assert.equal(db.get().revision, 4);
});
await check('initial rules create only from explicit empty revision zero', async () => {
  const db = storeFixture();
  assert.equal((await service(db).saveRules([], 5)).conflict, true);
  assert.equal(db.get(), null);
  assert.equal((await service(db).saveRules([], 0)).revision, 1);
});
await check('racing initial Studio rule creates return a conflict, not a 500', async () => {
  const db = storeFixture(); db.createCollision();
  const result = await service(db).saveRules([], 0);
  assert.equal(result.conflict, true);
  assert.equal(result.current.revision, 1);
});
await check('stale rule writers cannot overwrite newer versions', async () => {
  const db = storeFixture(); db.seed(4);
  const result = await service(db).saveRules([], 3);
  assert.equal(result.conflict, true);
  assert.equal(db.get().revision, 4);
});
await check('racing revision compare-and-swap rejects lost update', async () => {
  const db = storeFixture(); db.seed(4); db.updateCollision();
  assert.equal((await service(db).saveRules([], 4)).conflict, true);
  assert.equal(db.get().revision, 5);
});
await check('valid Studio rules advance revision on a successful acknowledged write', async () => {
  const db = storeFixture(); db.seed(4);
  assert.equal((await service(db).saveRules([], 4)).revision, 5);
});
await check('Ticket activation checks tool permission before Card permission', () => {
  const text = source('apps/server/src/domains/automation/studio-automation-routes.ts');
  const start = text.indexOf('app.post("/api/automation/tickets/:cardId/activate"');
  const section = text.slice(start, start + 520);
  assert.ok(section.indexOf('requireTool(request, reply, "tickets", "edit")') >= 0);
  assert.ok(section.indexOf('requireTool(request, reply, "tickets", "edit")') < section.indexOf('requireCard(request, reply'));
});
await check('direct service Ticket activation defers before loading Card data', async () => {
  const db = storeFixture(); let fetches = 0;
  db.prisma.card = { findUnique: async () => { fetches++; throw Error('should not read card'); } };
  await assert.rejects(service(db, async () => false).activateTicket('t', {}, []), jobs.BackgroundJobDeferredError);
  assert.equal(fetches, 0);
});
const calendarRule = { id: 'r', name: 'Calendar rule', enabled: true, trigger: 'calendar_upcoming', projectId: '', conditions: [], actions: [{ id: 'a', type: 'notify_inbox', value: 'notice' }] };
const payload = { ruleId: 'r', ruleName: 'Calendar rule', action: { id: 'a' }, event: { trigger: 'calendar_upcoming', entityType: 'calendar', entityId: 'e', entityLabel: 'Event', projectId: 'p' } };
await check('disable between admission and execution defers without a fake failure record', async () => {
  const db = storeFixture(); db.seed(1); db.prisma.clientStateRecord.findUnique = async () => ({ revision: 1, payload: JSON.stringify([calendarRule]) });
  let reads = 0, writes = 0, effects = 0;
  db.prisma.clusterPersistenceRecord = { create: async () => { writes++; } };
  await assert.rejects(service(db, async owner => { assert.equal(owner, 'calendar'); return ++reads === 1; }, async () => { effects++; }).executeDurableJob(payload), jobs.BackgroundJobDeferredError);
  assert.equal(reads, 2); assert.equal(writes, 0); assert.equal(effects, 0);
});
await check('enabled action passes both fences and emits exactly one result', async () => {
  const db = storeFixture(); db.seed(1); db.prisma.clientStateRecord.findUnique = async () => ({ revision: 1, payload: JSON.stringify([calendarRule]) });
  let checks = 0, history = 0, effects = 0;
  db.prisma.clusterPersistenceRecord = { create: async () => { history++; } };
  const result = await service(db, async () => { checks++; return true; }, async () => { effects++; }).executeDurableJob(payload);
  assert.equal(result.actionId, 'a'); assert.equal(checks, 2); assert.equal(history, 1); assert.equal(effects, 1);
});
await check('disabled source Calendar automation creates no receipt or queued actions', async () => {
  const db = storeFixture(); let persisted = 0, policyReads = 0;
  db.prisma.clusterPersistenceRecord = { create: async () => { persisted++; } };
  const svc = service(db, async owner => { assert.equal(owner, 'calendar'); policyReads++; return false; });
  const results = await svc.processEvent({ trigger: 'calendar_started', entityType: 'calendar', entityId: 'e', entityLabel: 'Event' });
  assert.deepEqual(results, []); assert.equal(persisted, 0); assert.equal(policyReads, 1);
});
await check('disabled source Ticket automation creates no receipt or queued actions', async () => {
  const db = storeFixture(); let persisted = 0;
  db.prisma.clusterPersistenceRecord = { create: async () => { persisted++; } };
  const svc = service(db, async owner => { assert.equal(owner, 'tickets'); return false; });
  assert.deepEqual(await svc.processEvent({ trigger: 'ticket_urgent', entityType: 'ticket', entityId: 't', entityLabel: 'Ticket' }), []);
  assert.equal(persisted, 0);
});
await check('non-configurable shared Project/Build event is not blocked by Ticket policy', async () => {
  const db = storeFixture(); let persisted = 0;
  db.prisma.clusterPersistenceRecord = {
    create: async () => { persisted++; return {}; },
    update: async () => {},
  };
  const svc = service(db, async () => { throw Error('Unnecessary policy read'); });
  assert.deepEqual(await svc.processEvent({ trigger: 'build_completed', entityType: 'build', entityId: 'b', entityLabel: 'Build' }), []);
  assert.equal(persisted, 1);
});
console.log(`${count}/${count} TD1/TD2 implementation closeout checks passed`);

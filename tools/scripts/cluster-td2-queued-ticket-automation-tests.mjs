import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function source(f) { return fs.readFileSync(path.join(root, f), 'utf8'); }
function load(f, stubs = {}) {
  const { outputText } = ts.transpileModule(source(f), { fileName: f, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const m = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('node:')) return require(id);
    throw Error(`Unmocked module ${id} in ${f}`);
  }, m, m.exports);
  return m.exports;
}
const policy = load('apps/server/src/domains/jobs/job-tool-ownership.ts');
const jobTypes = load('apps/server/src/domains/jobs/job-types.ts', { '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} } });
const { DurableJobWorker } = load('apps/server/src/domains/jobs/job-worker.ts', {
  '../../core/reliability-context.js': { runWithReliabilityContext: (_, fn) => fn() },
  './job-types.js': jobTypes,
  './job-queue-service.js': { BackgroundJobQueue: class {} },
});
let count = 0;
async function check(label, test) { await test(); count++; console.log('PASS', label); }
const studioTicket = { trigger: 'ticket_status_changed', entityType: 'ticket', event: { entityType: 'ticket' } };
const projectTicket = { options: { context: { trigger: 'ticket_changed', sourceType: 'card', source: { workItemKind: 'ticket' } } } };
const projectCard = { options: { context: { trigger: 'board_changed', sourceType: 'card', source: { workItemKind: 'card' } } } };
await check('only Ticket-origin generic jobs require Ticket availability', () => {
  assert.equal(policy.automationJobRequiresTickets('automation.studio-action', studioTicket), true);
  assert.equal(policy.automationJobRequiresTickets('automation.project-rule', projectTicket), true);
  assert.equal(policy.automationJobRequiresTickets('automation.project-rule', projectCard), false);
  assert.equal(policy.automationJobRequiresTickets('automation.studio-action', { trigger: 'project_created', entityType: 'project' }), false);
  assert.equal(policy.automationJobRequiresTickets('system.job-history-prune', studioTicket), false);
});
await check('Ticket creation is detected across branch and delayed rule actions', () => {
  assert.equal(policy.automationActionsCreateTicket([{ type: 'branch', elseActions: [{ type: 'create_ticket' }] }]), true);
  assert.equal(policy.automationJobRequiresTickets('automation.project-rule', { options: { actionsOverride: [{ type: 'create_ticket' }] } }), true);
  assert.equal(policy.automationActionsCreateTicket([{ type: 'notify' }, { type: 'create_timeline' }]), false);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(payload, { type = 'automation.project-rule', enabled = true, failRead = false, flipDuring = false } = {}) {
  let claimed = 0, deferred = 0, success = 0, failed = 0, handlerRuns = 0, reads = 0;
  const job = { id: 'generic-automation', type, payload: JSON.stringify(payload), attempts: 1, maxAttempts: 5, correlationId: null, workspaceId: null, createdById: null };
  const queue = {
    claim: async () => ++claimed === 1 ? job : null,
    cancellationRequested: async () => false,
    heartbeat: async () => true,
    deferDisabled: async () => { deferred++; return true; },
    succeed: async () => { success++; return true; },
    fail: async () => { failed++; return true; },
    updateProgress: async () => true,
  };
  const worker = new DurableJobWorker(queue, {
    concurrency: 1, leaseMs: 60_000,
    verifyContextAvailability: async (kind, body) => {
      if (!policy.automationJobRequiresTickets(kind, body)) return true;
      reads++;
      if (failRead) return false;
      return enabled;
    },
  });
  worker.register(type, async ({ throwIfToolUnavailable }) => {
    handlerRuns++;
    if (flipDuring) { enabled = false; await throwIfToolUnavailable(); }
    return { ok: true };
  });
  await worker.runBatch();
  for (let i = 0; i < 100 && worker.snapshot().running; i++) await wait(5);
  assert.equal(worker.snapshot().running, 0);
  worker.stop();
  return { deferred, success, failed, handlerRuns, reads, snapshot: worker.snapshot() };
}
await check('queued Studio Ticket action defers without executing or failing', async () => {
  const r = await run(studioTicket, { type: 'automation.studio-action', enabled: false });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns], [1,0,0,0]);
});
await check('queued Project Ticket rule defers without burning retry attempts', async () => {
  const r = await run(projectTicket, { enabled: false });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns], [1,0,0,0]);
});
await check('ordinary Project Card automation is unaffected while Tickets disabled', async () => {
  const r = await run(projectCard, { enabled: false });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns, r.reads], [0,1,0,1,0]);
});
await check('Ticket-dependent job resumes when tool enabled', async () => {
  const r = await run(projectTicket, { enabled: true });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns], [0,1,0,1]);
});
await check('remote disable during work defers at the next safe checkpoint', async () => {
  const r = await run(projectTicket, { enabled: true, flipDuring: true });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns], [1,0,0,1]);
});
await check('failed authoritative availability check fails closed for Ticket jobs', async () => {
  const r = await run(projectTicket, { failRead: true });
  assert.deepEqual([r.deferred, r.success, r.failed, r.handlerRuns], [1,0,0,0]);
});
const { createProjectAutomationService } = load('apps/server/src/domains/projects/project-automation-service.ts', {
  '@cluster/shared': { CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded' } }, CLUSTER_WORKFLOW_RELATIONSHIPS: [], CLUSTER_WORK_SOURCE_KINDS: [] },
  '../jobs/job-types.js': jobTypes,
  '../jobs/job-tool-ownership.js': policy,
  './project-control-service.js': { serializeProjectControlRecord: value => value },
});
await check('Project rule fetching detects Ticket-producing actions even for ordinary Board origin', async () => {
  let executed = 0, checks = 0;
  const service = createProjectAutomationService({
    prisma: {
      projectControlRecord: { findFirst: async () => ({ id: 'r', projectId: 'p', title: 'Make Ticket', status: 'active', payload: JSON.stringify({ enabled: true, actions: [{ type: 'branch', thenActions: [{ type: 'create_ticket' }] }] }) }) },
      clusterPersistenceRecord: { findUnique: async () => { executed++; return null; } },
    },
    events: { subscribe: () => {} }, logActivity: async () => {}, jobQueue: { enqueue: async () => {} },
    isTicketsEnabled: async () => { checks++; return false; },
  });
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: projectCard.options }, 1), jobTypes.BackgroundJobDeferredError);
  assert.equal(executed, 0, 'deferral must happen before Project run record and actions');
  assert.equal(checks, 1);
});
await check('Project Ticket-producing executor defers when policy lookup fails', async () => {
  const service = createProjectAutomationService({
    prisma: { projectControlRecord: { findFirst: async () => ({ id: 'r', projectId: 'p', title: 'Create Ticket', status: 'active', payload: JSON.stringify({ actions: [{ type: 'create_ticket' }] }) }) } },
    events: { subscribe: () => {} }, logActivity: async () => {}, jobQueue: { enqueue: async () => {} },
    logger: { warn: () => {} }, isTicketsEnabled: async () => { throw Error('database unavailable'); },
  });
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: projectCard.options }, 1), jobTypes.BackgroundJobDeferredError);
});
await check('missing Ticket policy does not allow Ticket-creating Project rule to execute', async () => {
  const service = createProjectAutomationService({
    prisma: { projectControlRecord: { findFirst: async () => ({ id: 'r', projectId: 'p', title: 'Create Ticket', status: 'active', payload: JSON.stringify({ actions: [{ type: 'create_ticket' }] }) }) } },
    events: { subscribe: () => {} }, logActivity: async () => {}, jobQueue: { enqueue: async () => {} },
  });
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: projectCard.options }, 1), jobTypes.BackgroundJobDeferredError);
});
await check('Project executor ignores Ticket availability for unrelated rule actions', async () => {
  let checks = 0;
  const service = createProjectAutomationService({
    prisma: {
      projectControlRecord: { findFirst: async () => ({ id: 'r', projectId: 'p', title: 'Notify', status: 'paused', payload: JSON.stringify({ enabled: true, actions: [{ type: 'log_activity' }] }) }) },
    },
    events: { subscribe: () => {} }, logActivity: async () => {}, jobQueue: { enqueue: async () => {} },
    isTicketsEnabled: async () => { checks++; return false; },
  });
  const r = await service.executeDurableJob({ ruleId: 'r', options: projectCard.options }, 1);
  assert.equal(r.skipped, true);
  assert.equal(checks, 0);
});
console.log(`${count}/${count} TD2 queued Ticket automation checks passed`);

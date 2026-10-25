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
  const { outputText } = ts.transpileModule(source(f), { fileName: f, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const m = { exports: {} };
  new Function('require', 'module', 'exports', outputText)((id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('node:')) return require(id);
    throw Error(`Unmocked module ${id} in ${f}`);
  }, m, m.exports);
  return m.exports;
}
const policy = load('apps/server/src/domains/jobs/job-tool-ownership.ts');
const jobTypes = load('apps/server/src/domains/jobs/job-types.ts', {
  '../../core/state-machine.js': { lifecycleTransitionMap: () => ({}), assertLifecycleTransition: () => {} },
});
const { createProjectAutomationService } = load('apps/server/src/domains/projects/project-automation-service.ts', {
  '@cluster/shared': { CLUSTER_DOMAIN_EVENTS: { activityRecorded: { type: 'activity.recorded' } }, CLUSTER_WORKFLOW_RELATIONSHIPS: [], CLUSTER_WORK_SOURCE_KINDS: [] },
  '../jobs/job-types.js': jobTypes,
  '../jobs/job-tool-ownership.js': policy,
  './project-control-service.js': { serializeProjectControlRecord: item => item },
});
const { createStudioAutomationService } = load('apps/server/src/domains/automation/studio-automation-service.ts', {
  '../decisions/decision-service.js': { createDecisionService: () => ({}) },
  '../jobs/job-types.js': jobTypes,
  '../jobs/job-tool-ownership.js': policy,
});
let checks = 0;
async function check(title, fn) { await fn(); checks++; console.log(`PASS ${title}`); }
const context = { trigger: 'manual', projectId: 'p', sourceType: 'automation', sourceId: 'r', source: { id: 'r', title: 'Automation' } };
const ticketContext = { trigger: 'ticket_updated', projectId: 'p', sourceType: 'ticket', sourceId: 'x', source: {} };

await check('canonical cross-tool action ownership covers four tools and nested branches', () => {
  assert.deepEqual(policy.automationActionToolOwners([
    { type: 'create_ticket' }, { type: 'create_calendar' }, { type: 'branch', elseActions: [{ type: 'create_schedule' }], thenActions: [{ type: 'create_timeline' }] }, { type: 'notify' },
  ]), ['calendar', 'scheduler', 'tickets', 'timeline']);
  assert.deepEqual(policy.automationActionToolOwners([{ type: 'notify' }, { type: 'update_source_record' }]), []);
  assert.deepEqual(policy.automationActionToolOwners([{ type: 'branch', thenActions: [{ type: 'branch', elseActions: [{ type: 'create_ticket' }] }] }]), ['tickets']);
});
await check('queued overrides and event source identities are classified, unrelated project work is not', () => {
  assert.deepEqual(policy.automationJobRequiredToolOwners('automation.project-rule', { options: { actionsOverride: [{ type: 'create_timeline' }, { type: 'create_schedule' }] } }), ['scheduler', 'timeline']);
  assert.deepEqual(policy.automationJobRequiredToolOwners('automation.studio-action', { event: { trigger: 'calendar_upcoming', entityType: 'calendar' } }), ['calendar']);
  assert.deepEqual(policy.automationJobRequiredToolOwners('automation.project-rule', { options: { context: { sourceType: 'schedule_block', trigger: 'record_changed' } } }), ['scheduler']);
  assert.deepEqual(policy.automationJobRequiredToolOwners('automation.project-rule', { options: { context: { sourceType: 'card', source: { workItemKind: 'ticket' } } } }), ['tickets']);
  assert.deepEqual(policy.automationJobRequiredToolOwners('automation.project-rule', { options: { context } }), []);
  assert.deepEqual(policy.automationJobRequiredToolOwners('system.job-history-prune', { options: { actionsOverride: [{ type: 'create_calendar' }] } }), []);
});

function makeProjectService(actions, enabledFor = async () => false) {
  const tally = { firstWrite: 0, toolReads: [], failures: 0 };
  const rule = { id: 'r', projectId: 'p', ownerId: null, title: 'Rule', status: 'active', payload: JSON.stringify({ enabled: true, actions }) };
  const service = createProjectAutomationService({
    prisma: {
      projectControlRecord: { findFirst: async () => rule },
      clusterPersistenceRecord: {
        findUnique: async () => { tally.firstWrite++; throw Error('AFTER_POLICY_CHECK'); },
      },
    },
    events: { subscribe: () => {} }, logActivity: async () => {}, jobQueue: { enqueue: async () => {} },
    isTicketsEnabled: async () => { tally.toolReads.push('tickets'); return enabledFor('tickets'); },
    isActionToolEnabled: async owner => { tally.toolReads.push(owner); return enabledFor(owner); },
  });
  return { service, tally };
}
for (const [type, owner] of [
  ['create_ticket', 'tickets'], ['create_calendar', 'calendar'], ['create_timeline', 'timeline'], ['create_schedule', 'scheduler'],
]) {
  await check(`${type} defers without a run record or retry consumption when ${owner} is disabled`, async () => {
    const { service, tally } = makeProjectService([{ type }]);
    await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: { context } }), jobTypes.BackgroundJobDeferredError);
    assert.deepEqual(tally.toolReads, [owner]);
    assert.equal(tally.firstWrite, 0);
  });
}
await check('multiple action owners all checked before any Project automation action commits', async () => {
  const { service, tally } = makeProjectService([{ type: 'notify' }, { type: 'create_calendar' }, { type: 'create_timeline' }], o => o === 'calendar');
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: { context } }), jobTypes.BackgroundJobDeferredError);
  assert.deepEqual(tally.toolReads, ['calendar', 'timeline']);
  assert.equal(tally.firstWrite, 0);
});
await check('failed authoritative policy lookup defers without creating a Project run', async () => {
  const { service, tally } = makeProjectService([{ type: 'create_schedule' }], async () => { throw Error('database unreachable'); });
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: { context } }), jobTypes.BackgroundJobDeferredError);
  assert.equal(tally.firstWrite, 0);
});
await check('direct Project execution follows the same availability policy', async () => {
  const { service, tally } = makeProjectService([{ type: 'create_calendar' }]);
  await assert.rejects(service.executeRule('r', { context }), jobTypes.BackgroundJobDeferredError);
  assert.equal(tally.firstWrite, 0);
});
await check('manual dry-run remains a read-only preview even when tool is disabled', async () => {
  const { service, tally } = makeProjectService([{ type: 'create_calendar' }]);
  const result = await service.executeRule('r', { context, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(tally.toolReads, []);
  assert.equal(tally.firstWrite, 0);
});
await check('enabled Project tools proceed past preflight without being mislabeled deferred', async () => {
  const { service, tally } = makeProjectService([{ type: 'create_calendar' }], async () => true);
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: { context } }), /AFTER_POLICY_CHECK/);
  assert.equal(tally.firstWrite, 1);
});
await check('a queued Ticket source defers even when its action is not Ticket-specific', async () => {
  const { service, tally } = makeProjectService([{ type: 'notify' }]);
  await assert.rejects(service.executeDurableJob({ ruleId: 'r', options: { context: ticketContext } }), jobTypes.BackgroundJobDeferredError);
  assert.deepEqual(tally.toolReads, ['tickets']);
  assert.equal(tally.firstWrite, 0);
});

function studioFixture(ownerEnabled) {
  const stats = { reads: [], runWrites: 0, eventActions: 0 };
  const rule = { id: 'sr', name: 'Rule', enabled: true, trigger: 'calendar_upcoming', projectId: '', conditions: [], actions: [{ id: 'a', type: 'notify_inbox', value: 'test' }] };
  const prisma = {
    clientStateRecord: { findUnique: async () => ({ revision: 1, payload: JSON.stringify([rule]) }) },
    clusterPersistenceRecord: { create: async () => { stats.runWrites++; return {}; } },
  };
  const service = createStudioAutomationService({
    prisma, logActivity: async () => { stats.eventActions++; }, jobQueue: {},
    isActionToolEnabled: async owner => { stats.reads.push(owner); return ownerEnabled(owner); },
  });
  const payload = { ruleId: 'sr', ruleName: 'Rule', action: { id: 'a' }, event: { trigger: 'calendar_upcoming', entityType: 'calendar', entityId: 'e', entityLabel: 'Event', projectId: 'p' } };
  return { service, payload, stats };
}
await check('Studio queued Calendar action defers without fake failure history', async () => {
  const { service, payload, stats } = studioFixture(() => false);
  await assert.rejects(service.executeDurableJob(payload), jobTypes.BackgroundJobDeferredError);
  assert.deepEqual(stats.reads, ['calendar']);
  assert.equal(stats.eventActions, 0);
  assert.equal(stats.runWrites, 0);
});
await check('Studio queued action resumes when Calendar is available', async () => {
  const { service, payload, stats } = studioFixture(() => true);
  const output = await service.executeDurableJob(payload);
  assert.equal(output.ruleId, 'sr');
  assert.equal(stats.eventActions, 1);
  assert.equal(stats.runWrites, 1);
});
await check('wired authoritative runtime owns all action-producing tool classes', () => {
  const server = source('apps/server/src/app/server-automation-job-runtime.ts');
  const runtime = source('apps/server/src/app/server-job-runtime.ts');
  assert.match(server, /const isActionToolEnabled = async/);
  assert.match(server, /createProjectAutomationService\(\{[^}]*isActionToolEnabled/);
  assert.match(server, /createStudioAutomationService\(\{[^}]*isActionToolEnabled/);
  assert.match(runtime, /automationJobRequiredToolOwners\(type, payload\)/);
  assert.match(runtime, /TOOL_AVAILABILITY\[owner\]\.flag/);
});
console.log(`${checks}/${checks} TD2 cross-tool automation checks passed`);

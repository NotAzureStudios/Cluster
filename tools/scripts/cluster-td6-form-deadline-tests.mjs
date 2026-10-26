import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript`); } })();
const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const source = read('apps/server/src/domains/studio-systems/studio-form-reminders.ts');
const transpiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let failedMembership = false;
const modules = {
  'node:crypto': crypto,
  '../access/studio-audience.js': {
    parseStudioJson: (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } },
    parseStudioAudience: v => JSON.parse(v),
    loadStudioAudienceUserContext: async (_db, user, opts) => { assert.equal(opts.strict, true); if (failedMembership) throw Error('Membership lookup unavailable'); return { id: user.id }; },
    studioAudienceMatchesContext: (audience, userId) => audience.mode === 'all' || audience.targets.some(x => x.kind === 'user' && x.id === userId),
  }
};
const mod = { exports: {} }; vm.runInNewContext(transpiled, { require: name => { if (!modules[name]) throw Error('Unexpected import: ' + name); return modules[name]; }, module: mod, exports: mod.exports, console, Date, Map, Set, Number, String, Error, Promise }, { filename: 'studio-form-reminders.js' });
const { getFormReminderStage, runStudioFormReminderTick } = mod.exports;
let tests = 0;
function check(value, message) { assert.ok(value, message); tests++; }
const now = new Date('2026-10-17T15:00:00Z');
const dueAt = '2026-10-19T15:00:00Z';
const settings = { dueAt, reminderDaysBefore: 3, remindWhenOverdue: true, acceptingResponses: true };
check(getFormReminderStage(settings, new Date('2026-10-16T15:00:00Z')) === 'before_due', 'Boundary exactly three days before due is included');
check(getFormReminderStage(settings, new Date('2026-10-16T14:59:59Z')) === null, 'No early send before reminder window');
check(getFormReminderStage(settings, new Date(dueAt)) === 'overdue', 'Due instant switches to overdue');
check(getFormReminderStage({ ...settings, remindWhenOverdue: false }, new Date(dueAt)) === null, 'Overdue opt-out respected');
check(getFormReminderStage({ ...settings, acceptingResponses: false }, now) === null, 'Closed form never reminds');
check(getFormReminderStage({ ...settings, dueAt: 'not-a-date' }, now) === null, 'Invalid stored dates fail closed');
check(getFormReminderStage({ ...settings, reminderDaysBefore: null }, now) === null, 'No due-soon reminder unless configured');
let version = { id: 'version-1', formId: 'form-1', version: 1, status: 'published', settingsJson: JSON.stringify(settings) };
let form = { id: 'form-1', purpose: 'general', title: 'Studio Security Form', status: 'active', audienceJson: JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u1' }, { kind: 'user', id: 'u2' }, { kind: 'user', id: 'u4' }] }), versions: [version] };
const users = [{ id: 'u1', archived: false, accountState: 'ACTIVE', accessExpiresAt: null }, { id: 'u2', archived: false, accountState: 'ACTIVE', accessExpiresAt: null }, { id: 'u3', archived: false, accountState: 'ACTIVE', accessExpiresAt: null }, { id: 'u4', archived: false, accountState: 'SUSPENDED', accessExpiresAt: null }];
let completions = [{ formId: 'form-1', userId: 'u2', status: 'submitted' }];
let reminders = [];
let onClaim = null;
let assignmentRows = [];
const db = {
  studioFormAssignment: { findMany: async () => assignmentRows, findUnique: async ({ where }) => assignmentRows.find(row => row.formId === where.formId_userId.formId && row.userId === where.formId_userId.userId) || null },
  studioForm: {
    findMany: async () => [form],
    findUnique: async () => form,
  },
  studioFormVersion: { findFirst: async () => version },
  studioFormSubmission: {
    findMany: async () => completions.filter(x => x.status === 'submitted').map(x => ({ userId: x.userId })),
    findFirst: async ({ where }) => completions.find(x => x.formId === where.formId && x.userId === where.userId) || null,
  },
  user: {
    findMany: async () => users.filter(x => !x.archived && x.accountState !== 'SUSPENDED' && x.accountState !== 'DISABLED' && (!x.accessExpiresAt || x.accessExpiresAt > now)),
    findUnique: async ({ where }) => users.find(x => x.id === where.id) || null,
  },
  studioFormReminderDelivery: {
    upsert: async ({ where, create }) => {
      let row = reminders.find(x => x.formVersionId === where.formVersionId_userId_stage.formVersionId && x.userId === where.formVersionId_userId_stage.userId && x.stage === where.formVersionId_userId_stage.stage);
      if (!row) { row = { ...create, id: String(reminders.length + 1), state: 'pending', claimToken: null, leaseUntil: null, deliveredAt: null }; reminders.push(row); }
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const row = reminders.find(x => x.id === where.id && (where.claimToken === undefined || where.claimToken === x.claimToken) && (!where.OR || (rowCanClaim(x, now))));
      if (!row) return { count: 0 };
      Object.assign(row, data); if (data.state === "sending") onClaim?.(); return { count: 1 };
    },
  }
};
function rowCanClaim(row, at) { return row.state === 'pending' || (row.state === 'sending' && row.leaseUntil <= at); }
const notices = [];
let failDelivery = false;
const logActivity = async x => { if (failDelivery) throw Error('Notification transport failure'); notices.push(x); };
const run = (at = now) => runStudioFormReminderTick({ prisma: db, logActivity, now: at });
const first = await run();
check(first.sent === 1 && notices.length === 1, 'One due-soon reminder for eligible, incomplete person');
check(notices[0].metadata.userIds.join() === 'u1', 'No notices to completed, suspended or unrelated users');
check(notices[0].metadata.notificationGroupKey === 'studio-form-deadline:version-1:u1:before_due', 'Dedupe key scopes version/user/stage');
const duplicate = await run();
check(duplicate.sent === 0 && notices.length === 1, 'Repeated worker tick cannot resend completed stage');
failedMembership = true;
form.audienceJson = JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u3' }] });
await assert.rejects(run(), /Membership lookup unavailable/);
check(notices.length === 1, 'Membership-read failure denies reminder rather than granting access');
failedMembership = false;
form.audienceJson = JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u3' }] });
failDelivery = true;
await assert.rejects(run(), /Notification transport failure/);
check(reminders.find(x => x.userId === 'u3')?.state === 'pending', 'Transport failure resets claim for retry');
failDelivery = false;
const recovered = await run();
check(recovered.sent === 1 && reminders.find(x => x.userId === 'u3')?.state === 'sent', 'Retry completes after transport recovers');
version = { ...version, id: 'version-2', version: 2, settingsJson: JSON.stringify(settings) };
form.versions = [version];
const afterPublish = await run();
check(afterPublish.sent === 1 && notices.at(-1).metadata.notificationGroupKey.includes('version-2'), 'New published version has separate durable claims');
const overdue = await run(new Date('2026-10-21T15:00:00Z'));
check(overdue.sent === 1 && notices.at(-1).type === 'studio_form_overdue', 'One optional overdue reminder is emitted');
const noRepeat = await run(new Date('2026-10-21T16:00:00Z'));
check(noRepeat.sent === 0, 'Overdue reminder does not repeat');
completions.push({ formId: 'form-1', userId: 'u3', status: 'submitted' });
version = { ...version, id: 'version-3', version: 3 };
form.versions = [version];
const submitted = await run();
check(submitted.sent === 0, 'Previously completed form never reminds on republish');
// A revocation after claim, but before dispatch, is rechecked by the worker.
completions = [];
form.audienceJson = JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u3' }] });
version = { ...version, id: 'version-4', version: 4 }; form.versions = [version];
onClaim = () => { form.audienceJson = JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u1' }] }); onClaim = null; };
const beforeRevocation = notices.length;
const revoked = await run();
check(revoked.sent === 0 && notices.length === beforeRevocation, 'Access revoked during claim prevents dispatch');
// Two independent job attempts can race to claim but only one may deliver.
form.audienceJson = JSON.stringify({ mode: 'include', targets: [{ kind: 'user', id: 'u3' }] });
version = { ...version, id: 'version-5', version: 5 }; form.versions = [version];
const parallel = await Promise.all([run(), run()]);
check(parallel.reduce((sum, item) => sum + item.sent, 0) === 1 && notices.length === beforeRevocation + 1, 'Two concurrent ticks produce one delivery claim');

// G25 assignment-scoped deadlines may trigger even while the shared deadline is far away.
const farDue = { ...settings, dueAt: '2026-10-30T15:00:00Z' };
version = { ...version, id: 'version-6', version: 6, settingsJson: JSON.stringify(farDue) }; form.versions = [version];
assignmentRows = [{ formId: 'form-1', userId: 'u3', status: 'active', required: true, dueAt: new Date('2026-10-19T15:00:00Z') }];
const overridden = await run();
check(overridden.sent === 1 && notices.at(-1).metadata.userIds[0] === 'u3', 'Individual assignment deadline overrides a later published deadline');
check(notices.at(-1).metadata.dueAt === '2026-10-19T15:00:00.000Z', 'Assignment reminder publishes the actual personal due instant');
version = { ...version, id: 'version-7', version: 7 }; form.versions = [version];
assignmentRows[0].dueAt = new Date('2026-10-30T15:00:00Z');
const postponed = await run();
check(postponed.sent === 0, 'Postponed personal deadline is not reminded early');
version = { ...version, id: 'version-8', version: 8 }; form.versions = [version];
assignmentRows[0].dueAt = new Date('2026-10-19T15:00:00Z');
onClaim = () => { assignmentRows[0].status = 'revoked'; onClaim = null; };
const beforeRevoking = notices.length;
const duringRevocation = await run();
check(duringRevocation.sent === 0 && notices.length === beforeRevoking, 'Revoked assignment is rechecked after claiming reminder');
assignmentRows = [];
const scanSources = ['packages/shared/src/studio-systems-contracts.ts', 'apps/server/src/domains/studio-systems/studio-systems-routes.ts', 'apps/server/src/app/server-job-runtime.ts', 'apps/server/src/app/server-automation-job-runtime.ts', 'apps/server/src/app/cluster-server.ts', 'packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx', 'packages/renderer/src/features/settings/MyFormsPanel.tsx'];
for (const file of scanSources) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(ast.parseDiagnostics.length === 0, `${file} parses`);
}
check(read('apps/server/prisma/schema.prisma').includes('@@unique([formVersionId, userId, stage])'), 'Durable per-recipient claim uses a Prisma composite unique key');
check(read('apps/server/prisma/migrations/20261017190000_td6_studio_form_reminder_deliveries/migration.sql').includes('CREATE UNIQUE INDEX'), 'Migration declares the unique claim index');
check(read('apps/server/src/app/server-job-runtime.ts').includes('studio.form-deadline-reminders'), 'Durable maintenance job is registered and scheduled');
check(read('packages/renderer/src/features/settings/MyFormsPanel.tsx').includes('Late submissions are still accepted.'), 'Respondent sees deadline as advisory');
// The administrative evidence endpoint must use Settings authority and never return answers.
const routeModules = {
  'node:crypto': crypto,
  '@cluster/shared': Object.fromEntries(['PACKET_COMPLIANCE_DATA_FIELDS', 'POLICY_COMPLIANCE_DATA_FIELDS', 'STUDIO_FORM_TEMPLATES', 'projectVisibleStudioFormAnswers', 'studioAudienceSchema', 'studioFormCreateSchema', 'studioFormTemplateCreateSchema', 'studioFormSubmissionSchema', 'studioFormVersionCreateSchema', 'studioPolicyAcceptanceSchema', 'studioPolicyCreateSchema', 'studioPolicyVersionCreateSchema'].map(k => [k, { parse: x => x }])),
  'zod': { z: { object: () => ({ parse: x => x }), string: () => ({ min: () => ({ max: () => ({}) }) }) } },
  '../../core/data-query.js': { normalizeClusterDataQuery: x => x },
  '../access/studio-audience.js': { parseStudioJson: JSON.parse, studioAudienceMatchesUser: async () => true },
  './studio-form-runtime.js': { serializeStudioForm: x => x, serializeStudioFormVersion: x => x, validateStudioFormAnswers: () => ({ ok: true }) },
  './studio-knowledge-runtime.js': {}, './studio-knowledge-evidence.js': {}, './studio-knowledge-compliance.js': {},
};
const routeSource = ts.transpileModule(read('apps/server/src/domains/studio-systems/studio-systems-routes.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const routeModule = { exports: {} };
vm.runInNewContext(routeSource, { require: name => { if (!(name in routeModules)) throw Error('Unexpected route import: ' + name); return routeModules[name]; }, module: routeModule, exports: routeModule.exports, console, Date, Promise, Set, Map, URL }, { filename: 'studio-systems-routes.js' });
const endpoints = new Map(); let authorized = false; let queried = false;
const router = Object.fromEntries(['get','post','put','patch','delete'].map(method => [method, (path, fn) => endpoints.set(`${method} ${path}`, fn)]));
routeModule.exports.registerStudioSystemsRoutes({
  app: router, prisma: { ...db, studioFormReminderDelivery: { ...db.studioFormReminderDelivery, groupBy: async () => { queried = true; return [{ stage: 'before_due', state: 'sent', _count: { _all: 2 } }, { stage: 'overdue', state: 'sent', _count: { _all: 1 } }, { stage: 'overdue', state: 'pending', _count: { _all: 1 } }]; } } },
  authorization: { requireTool: async () => authorized }, getCurrentUser: async () => ({ id: 'owner' }), logActivity: async () => {},
});
const evidenceEndpoint = endpoints.get('get /api/studio-systems/forms/:formId/deadline-status');
check(typeof evidenceEndpoint === 'function', 'Administrative reminder evidence route is mounted');
const fakeReply = () => ({ status: 200, headers: {}, code(code) { this.status = code; return this; }, header(key, value) { this.headers[key] = value; return this; }, send(value) { this.sent = value; return value; } });
await evidenceEndpoint({ params: { formId: form.id } }, fakeReply());
check(!queried, 'Non-administrator cannot query reminder delivery evidence');
authorized = true;
const reply = fakeReply(); const summary = await evidenceEndpoint({ params: { formId: form.id } }, reply);
check(queried && summary.beforeDue === 2 && summary.overdue === 1 && summary.pending === 1, 'Admin receives current published reminder counts');
check(reply.headers['Cache-Control'] === 'private, no-store' && !('answers' in summary), 'Admin summary never contains answers or cacheable respondent data');
form.purpose = 'application'; queried = false;
const rejectedReply = fakeReply(); await evidenceEndpoint({ params: { formId: form.id } }, rejectedReply);
check(rejectedReply.status === 404 && !queried, 'Public application reminder evidence is not exposed as an ordinary Form');
form.purpose = 'general';
console.log(`${tests}/${tests} TD6 F02 Forms deadline and reminder assertions passed`);

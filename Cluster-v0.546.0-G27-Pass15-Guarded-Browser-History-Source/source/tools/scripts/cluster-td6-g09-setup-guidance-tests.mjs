import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { const binary = execFileSync('which', ['tsc'], { encoding: 'utf8' }).trim();
  ts = require(resolve(join(binary, '..', '..', 'lib', 'typescript.js'))); }
const text = (file) => readFileSync(join(root, file), 'utf8');
function load(file, imports = {}) {
  const js = ts.transpileModule(text(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (name) => Object.prototype.hasOwnProperty.call(imports, name) ? imports[name] : require(name),
    Intl, Date, Promise, Error, Set, Map, Object, Array, String, Boolean, Number, JSON,
  }, { filename: file });
  return module.exports;
}
const guide = load('apps/server/src/core/setup-guidance.ts');
const config = load('apps/server/src/core/setup-configuration.ts');
let checks = 0;
async function check(label, fn) { await fn(); console.log(`PASS ${label}`); checks++; }

await check('no Owners is not considered a secure state', () => {
  const status = guide.ownerSecurityReadiness([], [], []);
  assert.equal(status.passkeysReady, false); assert.equal(status.recoveryReady, false); assert.equal(status.ownerCount, 0);
});
await check('one protected Owner cannot mask another Owner with no passkey or codes', () => {
  const status = guide.ownerSecurityReadiness(['owner1','owner2'], ['owner1','owner1'], ['owner1']);
  assert.equal(status.passkeysReady, false); assert.equal(status.recoveryReady, false);
  assert.equal(status.missingPasskeys, 1); assert.equal(status.missingRecovery, 1);
});
await check('each independently protected Owner is ready', () => {
  const status = guide.ownerSecurityReadiness(['owner1','owner2','owner1'], ['owner2','owner1'], ['owner1','owner2']);
  assert.equal(status.passkeysReady, true); assert.equal(status.recoveryReady, true); assert.equal(status.ownerCount, 2);
});
await check('all checklist steps have a real grouped action and plain-language guidance', () => {
  assert.equal(config.SETUP_CHECKLIST_IDS.length, Object.keys(guide.SETUP_GUIDES).length);
  for (const id of config.SETUP_CHECKLIST_IDS) {
    assert.ok(['Security','Studio','Infrastructure','Workspace'].includes(guide.SETUP_GUIDES[id]?.group), id);
    assert.ok(guide.SETUP_GUIDES[id].detail.length > 30 && guide.SETUP_GUIDES[id].nextStep.length > 20, id);
  }
});
await check('Owner recovery cannot be skipped, studio timezone can', () => {
  const cleaned = config.sanitizeSkippedSetupItems(['owner-passkey','recovery-codes','studio-timezone','studio-timezone','wrong']);
  assert.equal(JSON.stringify(cleaned), JSON.stringify(['studio-timezone']));
});
await check('selective configurations only contain explicitly chosen safe keys', () => {
  const exported = config.exportSafeStudioConfiguration({ studioName: 'Studio', studioTimezone: 'UTC', defaultCreateStarterBoard: false, discordBotToken: 'DONTEXPORT' });
  const narrowed = { ...exported, settings: { studioName: exported.settings.studioName } };
  const changes = config.planSafeStudioConfiguration(narrowed, { studioName:'Old', studioTimezone:'America/New_York' });
  assert.equal(changes.changes.length, 1);
  assert.equal(changes.changes[0].key, 'studioName');
  assert.equal(JSON.stringify(exported).includes('DONTEXPORT'), false);
});
// The source route handlers are exercised with their real implementation and a
// deliberately limited mock of the Prisma read model. This is not a live DB test.
const schema = new Proxy({}, { get(_target, key) { if (key === 'parse') return (value) => value; return () => schema; } });
const z = new Proxy({}, { get() { return () => schema; } });
const imported = {
  'zod': { z },
  '../core/auth.js': {},
  '../core/security.js': { isLoopbackAddress: () => true },
  '../core/instance-setup.js': { inspectInstanceSetup: async () => ({ setupRequired: false }) },
  '../core/setup-guidance.js': guide,
  '../core/setup-configuration.js': config,
  '../core/security-audit-store.js': { appendSecurityAuditEvent: async () => ({}) },
};
const { registerSetupRoutes } = load('apps/server/src/app/server-routes-setup.ts', imported);
const handlers = new Map();
const people = [ { id:'owner1', archived:false }, { id:'owner2', archived:false }, { id:'admin', archived:false } ];
const grants = [ { role:'owner',userId:'owner1'}, {role:'owner',userId:'owner2'}, {role:'admin',userId:'admin'} ];
let keys = ['owner1'], codes = ['owner1']; let securityReads = 0;
let settings = { studioName:'Studio', studioTimezone:'America/New_York', backupEnabled: true, discordBotToken: 'PRIVATE', setupChecklistSkippedIds:['first-project'] };
let authorize = true;
const prisma = {
  appSetting: { findMany: async ({ where }) => where.key.in.filter((key) => Object.prototype.hasOwnProperty.call(settings, key)).map((key) => ({ key, value: JSON.stringify(settings[key]) })) },
  workspaceMember: { findMany: async () => grants },
  user: { findMany: async () => people.filter((person) => !person.archived) },
  authenticator: { findMany: async () => { securityReads++; return keys.map((userId) => ({ userId })); } },
  authenticatorRecoveryCode: { findMany: async () => codes.map((userId) => ({ userId })) },
  project: { count: async () => 0 },
  studioManagedDomain: { count: async () => 0 },
};
registerSetupRoutes({
  app: { get: (path, handler) => handlers.set(`GET ${path}`, handler), post: (path, handler) => handlers.set(`POST ${path}`, handler), patch: (path, handler) => handlers.set(`PATCH ${path}`, handler) },
  prisma,
  readSettings: async () => settings,
  requireAdminUserForRequest: async () => authorize ? { id:'admin' } : null,
  getSetupStatus: async () => ({ setupComplete: true, version: '0.546.0' }),
});
function reply() { const result = { status: 200, headers: {}, code(value) { this.status=value;return this; }, header(key,value) {this.headers[key]=value;return this;}, send(body){return body;} }; return result; }
const checklist = handlers.get('GET /api/admin/setup/checklist');
await check('unprivileged caller cannot query setup security posture', async () => {
  authorize = false; const before = securityReads;
  assert.equal(await checklist({}, reply()), undefined); assert.equal(securityReads, before);
  authorize = true;
});
await check('per-owner security posture is incomplete despite another Owner being protected', async () => {
  const response = reply(); const data = await checklist({}, response);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(data.security.ready, false);
  assert.equal(data.security.missingPasskeys, 1);
  assert.equal(data.security.missingRecovery, 1);
  assert.equal(data.items.find((item) => item.id === 'first-project').status, 'skipped');
  assert.equal(data.items.find((item) => item.id === 'studio-timezone').status, 'complete');
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
});
await check('missing studio timezone is shown as unfinished even when other defaults exist', async () => {
  settings = { ...settings, studioTimezone:'Unknown/Invalid' };
  const data = await checklist({}, reply());
  assert.equal(data.items.find((item) => item.id === 'studio-timezone').status, 'recommended');
  settings = { ...settings, studioTimezone:'America/New_York' };
});
await check('archived former Owner does not misrepresent active Owner readiness', async () => {
  people[1].archived = true;
  const data = await checklist({}, reply());
  assert.equal(data.security.ownerCount, 1); assert.equal(data.security.ready, true);
  people[1].archived = false;
});
await check('preview still checks administrator access and limits changes to selected fields', async () => {
  const preview = handlers.get('POST /api/admin/setup/configuration/preview');
  const request = { body: { configuration: { format:'clusterconfig', schemaVersion:1, settings: { studioName:'New Studio' } } } };
  authorize=false;assert.equal(await preview(request, reply()), undefined);authorize=true;
  const output=await preview(request,reply());
  assert.equal(output.changes.length,1);assert.equal(output.changes[0].key,'studioName');
  assert.equal(output.requestedCount,1); assert.match(output.previewId,/^[a-f0-9]{64}$/);
});
await check('renderer requires a new server preview when field selection changes', () => {
  const ui=text('packages/renderer/src/features/admin/AdminSetupChecklist.tsx');
  assert.match(ui, /setPreview\(null\); setRollbackPreview\(null\); setFeedback\(""\); setError\(""\);/);
  assert.match(ui, /Object\.fromEntries\(Object\.entries\(source\.settings\)\.filter/);
  assert.match(ui, /selectedKeys\.includes\(key\)/);
  assert.match(ui, /aria-valuenow=\{state\.complete\}/);
});
await check('review of earlier imported values excludes absent and unsafe fields', () => {
  const ui=text('packages/renderer/src/features/admin/AdminSetupChecklist.tsx');
  assert.match(ui, /function reviewPriorValues\(revision: ConfigurationRevision\)/);
  assert.match(ui, /typeof change\.before === \"boolean\"/);
  assert.match(ui, /Object\.prototype\.hasOwnProperty\.call\(CONFIG_LABELS, change\.key\)/);
  assert.match(ui, /setPreview\(null\); setRollbackPreview\(null\); setFeedback\(\"\"\)/);
  assert.match(ui, /Review pre-import values/);
});
await check('first-run import invalidates late file reads when changing mode', () => {
  const ui=text('packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx');
  assert.match(ui, /generation !== importGeneration\.current/);
  assert.match(ui, /\+\+importGeneration\.current; setMode/);
});
console.log(`G09 first-run & configuration integration: ${checks}/${checks} passed`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  // Source-only checkpoints may not contain node_modules. Resolve the globally
  // installed compiler without assuming Linux, a username, or a Node install path.
  const { execFileSync } = require('node:child_process');
  const { join } = require('node:path');
  ts = require(join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js'));
}
const source = fs.readFileSync('apps/server/src/app/server-services-settings-integrations.ts', 'utf8');
const studioRoute = fs.readFileSync('apps/server/src/app/server-routes-configuration-integrations.ts', 'utf8');
const ui = fs.readFileSync('packages/renderer/src/features/settings/StudioSettingsPage.tsx', 'utf8');
const admin = fs.readFileSync('apps/server/src/domains/admin/admin-tool-routes.ts', 'utf8');
const checklist = fs.readFileSync('apps/server/src/app/server-routes-setup.ts', 'utf8');
const team = fs.readFileSync('apps/server/src/domains/users/team-routes.ts', 'utf8');
const main = fs.readFileSync('apps/server/src/app/cluster-server.ts', 'utf8');
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error?.stack || error}`); process.exitCode = 1; }
}
await check('regular Studio Settings route enforces admin plus PIN', () => {
  const put = studioRoute.slice(studioRoute.indexOf('app.put("/api/settings"'), studioRoute.indexOf('app.get("/api/security/diagnostics"'));
  assert.match(put, /requireAdminUserForRequest\(request, reply\)/);
  assert.match(put, /if \(!body\.securityPin\)/);
  assert.match(put, /verifyUserPin\(admin, body\.securityPin, "apply_studio_settings", request\)/);
});
await check('Studio Settings UI posts edited fields, not entire stale snapshot', () => {
  assert.match(ui, /loadedSettingsRef\.current = merged/);
  assert.match(ui, /JSON\.stringify\(value\) !== JSON\.stringify\(/);
  assert.match(ui, /\.\.\.changedSettings,\s*expectedSettings,\s*securityPin: pin/);
  assert.doesNotMatch(ui, /\.\.\.withoutServerManagedSettings\(nextSettings\),/);
});
await check('tool configuration and People profile fields only patch selected keys', () => {
  assert.match(admin, /await patchSettings\(patch\)/);
  assert.match(team, /await patchSettings\(\{ studioPeopleProfileFields: body\.fields \}\)/);
  assert.match(main, /registerTeamRoutes\([\s\S]*?patchSettings \}\)/);
});
await check('setup checklist derives list under lock', () => {
  assert.match(checklist, /mutateSettingsKeys\(\["setupChecklistSkippedIds"\]/);
  assert.match(checklist, /new Set\(sanitizeSkippedSetupItems\(current\.setupChecklistSkippedIds\)\)/);
});
await check('patch shares imports transaction lock and serializable isolation', () => {
  assert.match(source, /pg_advisory_xact_lock\(506, 1\)/);
  assert.match(source, /isolationLevel: "Serializable"/);
  assert.match(source, /SERVER_MANAGED_SETTING_KEYS as Set<string>/);
});

// Execute the real TypeScript service through the installed TypeScript transpiler
// with a deterministic in-memory Prisma fixture. No PostgreSQL runtime claims.
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const settings = new Map([['studioName', JSON.stringify('Before')], ['unrelated', JSON.stringify('keep')], ['setupChecklistSkippedIds', JSON.stringify([])]]);
let transactions = 0, advisoryLocks = 0, tail = Promise.resolve();
const whereRows = ({ where } = {}) => [...settings.entries()].filter(([key]) => !where?.key?.in || where.key.in.includes(key)).map(([key, value]) => ({ key, value }));
const appSetting = {
  findMany: async (q) => whereRows(q),
  upsert: async ({where,update,create}) => { settings.set(where.key, (settings.has(where.key) ? update.value : create.value)); },
  deleteMany: async () => {},
};
const prisma = {
  appSetting,
  contextPack: { findMany: async () => [] },
  $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    transactions++;
    const run = tail.then(() => fn({ appSetting, $queryRaw: async () => { advisoryLocks++; return [{locked:1}]; } }));
    tail = run.catch(() => undefined);
    return run;
  },
};
const unavailableFs = { readFile: async () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } };
const cryptoMock = {
  BOOT_SECRET_SETTING_KEYS: new Set(), SENSITIVE_SETTING_KEYS: new Set(),
  decryptSettingStorageValue: (key, val) => val, encryptSettingStorageValue: (key, val) => val,
  shouldEncryptSetting: () => false, encryptedValueNeedsRotation: () => false,
};
const sandbox = {
  module: {exports:{}}, exports: {}, console, process, setTimeout, clearTimeout,
  require: (id) => {
    if (id === 'node:fs/promises') return { __esModule: true, default: unavailableFs };
    if (id.includes('setting-crypto')) return cryptoMock;
    if (id.includes('server-config-publication-journal')) return {hasPublicationJournal:async()=>false};
    return {};
  },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(output, sandbox, {filename:'settings-service-test.cjs'});
const services = sandbox.module.exports.createSettingsIntegrationServices({
  CONFIG_FILE_PATH: '/missing/cluster-config.json', DATA_LAYOUT: {}, DATA_ROOT: '/missing',
  SERVER_MANAGED_SETTING_KEYS: new Set(['serverHost','sessionDays','discordBotToken']),
  app: { log: {error: () => {} } }, prisma, studioPermissionSettings: {},
});
await check('selected-field patch does not rewrite unrelated settings', async () => {
  await services.patchSettings({ studioName: 'After' });
  assert.equal(JSON.parse(settings.get('studioName')), 'After');
  assert.equal(JSON.parse(settings.get('unrelated')), 'keep');
});
await check('two concurrent checklist updaters preserve both edits', async () => {
  await Promise.all([
    services.mutateSettingsKeys(['setupChecklistSkippedIds'], (current) => ({setupChecklistSkippedIds: [...(current.setupChecklistSkippedIds || []), 'backups']})),
    services.mutateSettingsKeys(['setupChecklistSkippedIds'], (current) => ({setupChecklistSkippedIds: [...(current.setupChecklistSkippedIds || []), 'first-project']})),
  ]);
  assert.deepEqual([...JSON.parse(settings.get('setupChecklistSkippedIds'))].sort(), ['backups','first-project']);
  assert.ok(transactions >= 3 && advisoryLocks >= 3);
});
await check('forbidden server-managed settings and internal keys reject without mutation', async () => {
  const oldSize = settings.size;
  await assert.rejects(services.patchSettings({serverHost:'0.0.0.0'}), /server-managed/);
  await assert.rejects(services.patchSettings({'_internal.superuser':'enabled'}), /unsupported/);
  assert.equal(settings.size, oldSize);
});
await check('out-of-selection updater cannot sneak in new fields', async () => {
  await assert.rejects(services.mutateSettingsKeys(['studioName'], () => ({serverHost:'0.0.0.0'})), /unselected/);
  assert.ok(!settings.has('serverHost'));
});
console.log(`${passed}/9 v0.506 settings convergence assertions passed.`);

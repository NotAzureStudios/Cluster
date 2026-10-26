import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const tests = [];
function load(file, imports = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: name => name in imports ? imports[name] : (name === "./managed-package-seat-policy.js" ? { packageSeatEligibleIds: async (_db, ids) => ids, packageSeatEligibleUsers: async (_db, _pkg, ids) => ids, registerManagedPackageSeatRoutes: () => {} } : name === "./managed-package-readiness.js" ? { registerManagedPackageReadinessRoutes: () => {} } : require(name)), Buffer, Date, JSON, String, Number, Set, Map, Math, Promise }, { filename: file });
  return module.exports;
}
const policy = load('apps/server/src/domains/inventory/managed-package-policy.ts');
const artifactStore = load('apps/server/src/domains/inventory/managed-package-artifact-store.ts', {'./managed-package-policy.js': policy});
const device = load('apps/server/src/domains/inventory/managed-package-device.ts', { './managed-package-policy.js': policy });
const { projectPackageReconciliation } = load('apps/server/src/domains/inventory/managed-package-reconciliation.ts', { './managed-package-device.js': device });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
const fingerprint = policy.packageKeyFingerprint(publicKeyPem);
const pkg = { id: 'package-1', key: 'studio-preset', title: 'Studio Preset', description: '', archivedAt: null };
const policyRow = { packageId: pkg.id, channel: 'stable', releaseId: 'rel-current', state: 'active', percentage: 100 };
const manifest = { schema: 1, packageKey: pkg.key, version: '2.0.0', platform: 'windows-x64', filename: 'preset.zip', artifactSha256: 'a'.repeat(64), artifactSize: 500 };
const rel = { id: 'rel-current', packageId: pkg.id, version: manifest.version, platform: manifest.platform, filename: manifest.filename, artifactSha256: manifest.artifactSha256, artifactSize: manifest.artifactSize, manifestJson: JSON.stringify(manifest), manifestSha256: sha(policy.packageSigningInput(manifest)), signature: sign(null, policy.packageSigningInput(manifest), privateKey).toString('base64'), signingKeyFingerprint: fingerprint, revokedAt: null };
const key = { fingerprint, publicKeyPem, disabledAt: null };
const registrations = Array.from({ length: 4 }, (_, i) => ({ id: `reg-0${i+1}`, userId: `user-${i+1}`, lastSeenAt: new Date(1000 * (i+1)), label: `Machine ${i+1}` }));
const reports = [
  { deviceRegistrationId: 'reg-01', releaseId: rel.id, state: 'content_selected', offeredAt: new Date(5000), lastReportedAt: new Date(5500) },
  { deviceRegistrationId: 'reg-02', releaseId: 'old-release', state: 'content_selected', offeredAt: new Date(4000), lastReportedAt: new Date(4100) },
  { deviceRegistrationId: 'reg-03', releaseId: rel.id, state: 'failed', offeredAt: new Date(3000), lastReportedAt: new Date(3100) },
];
function projection(override = {}) { return projectPackageReconciliation({ pkg, policy: policyRow, pins: [], releases: [rel], signingKeys: [key], registrations, entitledUserIds: registrations.map(r=>r.userId), deployments: reports, channel: 'stable', platform: 'windows-x64', ...override }); }
function test(name, fn) { fn(); tests.push(name); console.log('PASS', name); }
test('Signed active target is computed via canonical resolver', () => { const r = projection(); assert.equal(r.devices[0].target.releaseId, rel.id); assert.equal(r.devices[0].status, 'reported_selected'); assert.equal(r.devices[0].osAttested, false); assert.equal(r.installerCertified, false); });
test('Different release is diagnostic, not falsely current', () => assert.equal(projection().devices[1].status, 'different_release_reported'));
test('Failure claims distinguished', () => assert.equal(projection().devices[2].status, 'reported_failure'));
test('Missing report means no sample, not proof of no activity', () => assert.equal(projection().devices[3].status, 'no_report'));
test('Counts are page-scoped', () => { const r = projection({ registrations: registrations.slice(0, 2) }); assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 2); });
test('Newer report supersedes prior report', () => { const r = projection({ deployments: [{ ...reports[0], state: 'rolled_back', offeredAt: new Date(6000) }, ...reports] }); assert.equal(r.devices[0].status, 'reported_rollback'); });
test('Offered and progress are not installation', () => { for (const [state, expect] of [['offered','offer_pending'],['staged','reported_in_progress'],['content_selected','reported_selected']]) { const r = projection({ deployments: [{ ...reports[0], state }] }); assert.equal(r.devices[0].status, expect); } });
test('No active recipient entitlement removes target even with active rollout',()=>{const r=projection({entitledUserIds:[]});assert.equal(r.devices[0].target,null);});
test('Paused policy has no targets', () => assert.equal(projection({ policy: { ...policyRow, state: 'paused' } }).devices[0].status, 'not_targeted'));
test('Zero cohort has no targets', () => assert.equal(projection({ policy: { ...policyRow, percentage: 0 } }).devices[0].target, null));
test('Valid pin overrides paused rollout', () => { const r = projection({ policy: { ...policyRow, state: 'paused' }, pins: [{ deviceId: 'reg-01', releaseId: rel.id, packageId: pkg.id, active: true }] }); assert.equal(r.devices[0].target.selection, 'device_pin'); assert.equal(r.devices[1].target, null); });
test('Inactive pin cannot override paused policy', () => assert.equal(projection({ policy: { ...policyRow, state: 'paused' }, pins: [{ deviceId: 'reg-01', releaseId: rel.id, active: false }] }).devices[0].target, null));
test('Revoked release never targeted', () => assert.equal(projection({ releases: [{ ...rel, revokedAt: new Date() }] }).devices[0].target, null));
test('Disabled key never targeted', () => assert.equal(projection({ signingKeys: [{ ...key, disabledAt: new Date() }] }).devices[0].target, null));
test('Tampered manifest never targeted', () => assert.equal(projection({ releases: [{ ...rel, manifestJson: JSON.stringify({ ...manifest, version: '9.9.9' }) }] }).devices[0].target, null));
test('Incorrect platform never targeted', () => assert.equal(projection({ platform: 'linux-x64' }).devices[0].target, null));
test('No package artifact or private signature material in diagnostics', () => { const r = projection(); assert.equal(JSON.stringify(r).includes(publicKeyPem), false); assert.equal(JSON.stringify(r).includes(rel.signature), false); assert.equal(JSON.stringify(r).includes('artifactBase64'), false); });

// Exercise the registered endpoint as well as the pure projection.
const chain = () => ({ min(){return this}, max(){return this}, regex(){return this}, uuid(){return this}, trim(){return this}, int(){return this}, default(){return this}, positive(){return this}, optional(){return this} });
const z = { array:()=>chain(), object: () => ({ ...chain(),strict(){return this}, parse: value => value }), string: chain, number: chain, coerce: { number: chain }, enum: () => chain(), literal: () => chain() };
const routes = load('apps/server/src/domains/inventory/managed-package-routes.ts', {'./managed-package-artifact-store.js': artifactStore, './managed-package-entitlements.js':{registerManagedPackageEntitlementRoutes:()=>{}},'./managed-package-segments.js': load('apps/server/src/domains/inventory/managed-package-segments.ts'), './managed-package-grants.js': {mintPackageDeploymentGrant:()=>{throw new Error('grant not configured in historical fixture')},readPackageDeploymentPrivateKey:()=>undefined}, 'zod': { z }, '../sessions/device-proof.js': { requestDeviceProof: () => null }, './managed-package-device.js': device, './managed-package-reconciliation.js': { projectPackageReconciliation }, './managed-package-deployments.js': load('apps/server/src/domains/inventory/managed-package-deployments.ts'), './managed-package-policy.js': policy });
const handlers = new Map();
const app = { get: (url, fn) => handlers.set('GET ' + url, fn), post: (url, opts, fn) => handlers.set('POST ' + url, fn || opts), put: (url, fn) => handlers.set('PUT ' + url, fn) };
let adminAllowed = true;
let dbReads = 0;
const db = {
  managedPackageEntitlement:{findMany:async()=>registrations.map(r=>({userId:r.userId}))},
  user:{findMany:async()=>registrations.map(r=>({id:r.userId}))},
  managedPackage: { findUnique: async () => pkg },
  deviceRegistration: { findMany: async ({ where, take }) => { dbReads++; assert.equal(where.proofStatus, 'verified'); assert.equal(where.platform, 'desktop'); assert.equal(where.revokedAt, null); assert.ok(where.proofKeyFingerprint.not === null); const filtered = registrations.filter(r => !where.id || r.id > where.id.gt); return filtered.slice(0, take); } },
  managedPackageRollout: { findUnique: async () => policyRow },
  managedPackagePin: { findMany: async () => [] },
  managedPackageRelease: { findMany: async () => [rel] },
  managedPackageSigningKey: { findMany: async () => [key] },
  managedPackageDeviceDeployment: { findMany: async ({ where, take }) => { dbReads++; assert.equal(where.packageId, pkg.id); assert.equal(take, 1001); return reports.filter(r => where.deviceRegistrationId.in.includes(r.deviceRegistrationId)); } },
};
routes.registerManagedPackageRoutes({ app, prisma: db, authorization: { requireAdmin: async () => adminAllowed ? { id: 'admin' } : null }, requireConfirmation: () => false, logSecurityEvent: async () => {}, getCurrentSession: async () => null });
const handler = handlers.get('GET /api/admin/packages/:id/reconciliation');
assert.ok(handler, 'Admin reconciliation route must be registered');
function reply() { return { status: 200, headers: {}, header(k,v) { this.headers[k]=v; return this; }, code(n) { this.status=n; return this; }, send(body) { this.body=body; return this; } }; }
async function call(query) { const response = reply(); const value = await handler({ params: { id: pkg.id }, query }, response); return { ...response, body: response.body || value }; }
const routeTests = [];
async function routeTest(name, fn) { await fn(); routeTests.push(name); console.log('PASS', name); }
await routeTest('No DB reads without admin authorization', async () => { adminAllowed = false; const before = dbReads; await call({ channel: 'stable', platform: 'windows-x64', limit: 2 }); assert.equal(dbReads, before); adminAllowed = true; });
await routeTest('Endpoint caps registration page and hides private signing material', async () => { const r = await call({ channel: 'stable', platform: 'windows-x64', limit: 2 }); assert.equal(r.status, 200); assert.equal(r.body.devices.length, 2); assert.equal(r.body.nextCursor, 'reg-02'); assert.equal(r.body.osAttested, false); assert.equal(r.body.platformIsDeviceAttested, false); assert.ok(!JSON.stringify(r.body).includes(publicKeyPem)); assert.ok(!JSON.stringify(r.body).includes(rel.signature)); });
await routeTest('Cursor yields next sorted device page', async () => { const r = await call({ channel: 'stable', platform: 'windows-x64', limit: 2, cursor: 'reg-02' }); assert.deepEqual(Array.from(r.body.devices, d => d.registrationId), ['reg-03', 'reg-04']); assert.equal(r.body.nextCursor, null); });
await routeTest('Empty page does not imply whole population is empty', async () => { const r = await call({ channel: 'stable', platform: 'windows-x64', limit: 2, cursor: 'reg-99' }); assert.equal(r.body.devices.length, 0); assert.equal(r.body.scope, 'verified-desktop-registration-page'); });
const ui = fs.readFileSync('packages/renderer/src/features/settings/StudioManagedPackagesPanel.tsx', 'utf8');
test('UI clearly distinguishes report from OS attestation', () => { assert.match(ui, /not proof of OS installation/); assert.match(ui, /loadReconciliation\(reconciliationCursor\)/); });
console.log(`Cluster 0.517 Package reconciliation: ${tests.length + routeTests.length}/${tests.length + routeTests.length} checks passed`);

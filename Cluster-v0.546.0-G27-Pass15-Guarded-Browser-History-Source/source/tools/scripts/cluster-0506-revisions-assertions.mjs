import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (path) => fs.readFileSync(path, 'utf8');
const route = read('apps/server/src/app/server-routes-setup.ts');
const schema = read('apps/server/prisma/schema.prisma');
const migration = read('apps/server/prisma/migrations/20261008010000_studio_configuration_revision/migration.sql');
const ui = read('packages/renderer/src/features/admin/AdminSetupChecklist.tsx');
const checks = [
  ['revision schema and new migration agree', () => {
    for (const column of ['actorUserId','requestedJson','changesJson','previewId','createdAt']) {
      assert.match(schema, new RegExp(`\\b${column}\\b`));
      assert.ok(migration.includes(`"${column}"`));
    }
    assert.match(schema, /model StudioConfigurationRevision/);
    assert.match(migration, /CREATE TABLE "StudioConfigurationRevision"/);
  }],
  ['history endpoint is explicitly admin only and no-store', () => {
    assert.match(route, /app\.get\("\/api\/admin\/setup\/configuration\/revisions"[\s\S]*?requireAdminUserForRequest\(request, reply\)/);
    assert.match(route, /configuration\/revisions"[\s\S]*?Cache-Control", "no-store"/);
  }],
  ['history is bounded and selects only allowlisted revision columns', () => {
    assert.match(route, /studioConfigurationRevision\.findMany\(\{[\s\S]*?take: 20/);
    assert.match(route, /requested: parseClusterConfigBundle/);
    assert.doesNotMatch(route.slice(route.indexOf('app.get("/api/admin/setup/configuration/revisions"'), route.indexOf('app.post("/api/admin/setup/configuration/apply"')), /appSetting\.findMany/);
  }],
  ['apply commits in a serializable PostgreSQL transaction', () => {
    assert.match(route, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(route, /isolationLevel: "Serializable"/);
    assert.match(route, /pg_advisory_xact_lock\(506, 1\)/);
  }],
  ['transaction checks current stored rows and preview before any mutation', () => {
    const start = route.indexOf('prisma.$transaction(async (tx) => {');
    const body = route.slice(start, route.indexOf('}, { isolationLevel: "Serializable" });', start));
    assert.ok(body.indexOf('tx.appSetting.findMany') > -1);
    assert.ok(body.indexOf('configurationPlan(payload.configuration, current)') > body.indexOf('tx.appSetting.findMany'));
    assert.ok(body.indexOf('prepared.previewId !== payload.previewId') < body.indexOf('tx.appSetting.upsert'));
  }],
  ['only changed allowlisted keys are written, no full-object save', () => {
    const start=route.indexOf('app.post("/api/admin/setup/configuration/apply"');
    const body=route.slice(start,route.indexOf('app.post("/api/setup/complete"',start));
    assert.match(body, /CLUSTER_CONFIG_FIELDS\.filter/);
    assert.match(body, /for \(const change of prepared\.plan\.changes\)/);
    assert.doesNotMatch(body, /await saveSettings\(/);
  }],
  ['no-op imports create neither writes nor revisions', () => {
    assert.match(route, /if \(!prepared\.plan\.changes\.length\) return \{ applied: 0, revisionId: null/);
  }],
  ['revision row is inserted inside the same transaction', () => {
    const start = route.indexOf('prisma.$transaction(async (tx) => {');
    const body = route.slice(start, route.indexOf('}, { isolationLevel: "Serializable" });',start));
    assert.match(body, /tx\.studioConfigurationRevision\.create/);
    assert.match(body, /requestedJson: JSON\.stringify\(prepared\.plan\.requested\)/);
    assert.match(body, /changesJson: JSON\.stringify\(prepared\.plan\.changes\)/);
  }],
  ['serialization conflicts and stale previews return 409', () => {
    assert.match(route, /code === "P2034"/);
    assert.match(route, /code: "CONFIGURATION_PREVIEW_STALE"/);
    assert.match(route, /reply\.code\(409\)/);
  }],
  ['audit evidence links the revision without serializing secrets', () => {
    assert.match(route, /revisionId: revision\.id, changedFields: prepared\.plan\.changes\.map/);
    assert.match(route, /await appendSecurityAuditEvent\(tx/);
    const start = route.indexOf('event: "instance.configuration_imported"');
    assert.doesNotMatch(route.slice(start, route.indexOf('return { applied:',start)), /JSON\.stringify\(payload\)/);
  }],
  ['historical values require explicit server preview and apply', () => {
    assert.match(ui, /api\/admin\/setup\/configuration\/revisions/);
    assert.match(ui, /function reviewRevision\(revision: ConfigurationRevision\)/);
    assert.match(ui, /setPreview\(null\); setRollbackPreview\(null\); setFeedback/);
    assert.match(ui, /Review imported values/);
    assert.match(ui, /Preview changes/);
  }],
  ['release number remains simple', () => {
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.version, JSON.parse(read('VERSION_NAMING_CONVENTION.json')).internalSemver);
  }],
];
let passed = 0;
for (const [name, fn] of checks) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
console.log(`${passed}/${checks.length} v0.506 revision-publication assertions passed.`);

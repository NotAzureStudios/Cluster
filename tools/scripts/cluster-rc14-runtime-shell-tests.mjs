// RC14 targeted runtime incident guards: PostgreSQL parameter typing, settings wiring,
// outbox lock serialization and workspace-specific loading geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const queue=read('apps/server/src/domains/jobs/job-queue-service.ts');
const sql=queue.match(/const rows = await tx\.\$queryRawUnsafe<BackgroundJobRecord\[]>\(\s*`WITH workspace_load AS \([\s\S]*?RETURNING job\.\*`,([\s\S]*?)\);/);
assert.ok(sql,'must find transactional second-pass worker claim');
const placeholders=[...sql[0].matchAll(/\$(\d+)(?![\d])/g)].map(x=>Number(x[1]));
const distinct=[...new Set(placeholders)].sort((a,b)=>a-b);
assert.deepEqual(distinct,[1,2,3,4,5,6,7],'no absent placeholders: PostgreSQL cannot infer unused $2');
assert.match(sql[0],/\$2::bigint/);
assert.ok(!/\n\s*owner,\n\s*boundedLeaseMs/.test(sql[1]),'unused owner argument must not be passed to claim SQL');
assert.match(read('apps/server/src/core/domain-events.ts'),/pg_advisory_xact_lock\(6192449487634434181::bigint\)::text/);
assert.match(read('apps/server/src/app/cluster-server.ts'),/createSettingsIntegrationServices\(\{[\s\S]*?AUTH_SECRET,\s*CONFIG_FILE_PATH,\s*DATABASE_URL,/);
for(const f of ['apps/server/src/app/server-services-settings-integrations.ts','apps/server/src/app/server-routes-setup.ts']){
 const t=read(f); assert.doesNotMatch(t,/SELECT 1 AS "locked" FROM pg_advisory_xact_lock/);
}
const loading=read('packages/renderer/src/components/LoadingState.tsx');
for(const screen of ['board','whiteboard','projects','library','settings','studioSettings','calendar','mywork','dashboard']) assert.ok(loading.includes(`"${screen}"`),`missing screen skeleton ${screen}`);
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
assert.match(app,/<Suspense fallback=\{<ScreenLoadingState screen=\{screen\} \/>\}>/);
assert.match(app,/<BoardLoadingState label="Loading board"/);
const css=read('packages/renderer/src/features/shell/shell-v2.css');
assert.match(css,/RC14: Search takes the full remaining taskbar row/);
assert.match(css,/grid-template-columns: auto minmax\(0, 1fr\) !important/);
assert.match(css,/\.taskbar-right-v143 \{ display: none !important; \}/);
const manifest=JSON.parse(read('config/release-candidate.json'));
assert.ok(manifest.sequence>=14 && manifest.release===`1.0.0-rc.${manifest.sequence}`);
console.log('RC14: unused PostgreSQL parameter removed, settings URL wired, void locks handled, search expanded, skeletons mapped');

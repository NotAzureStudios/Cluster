// RC36 source-only regression gate. Passing this gate does NOT certify a
// dependency-backed build, Windows installer, PostgreSQL, or live transfers.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const checks=[
  'cluster-rc-smoke.mjs',
  'cluster-rc30-performance-traffic-tests.mjs',
  'cluster-rc31-cache-inventory-regressions.mjs',
  'cluster-rc32-navigation-cache-performance-tests.mjs',
  'cluster-rc33-bug-audit-graph-tests.mjs',
  'cluster-rc33-transfer-graphs-tests.mjs',
  'cluster-rc34-visual-density-tests.mjs',
  'cluster-rc35-release-closeout-tests.mjs',
  'cluster-rc36-cache-race-tests.mjs',
  'cluster-rc36-durable-invalidation-tests.mjs',
  'cluster-rc36-traffic-scope-tests.mjs',
  'cluster-rc35-source-audit.mjs',
];
let passed=0;
for (const script of checks) {
  const result=spawnSync(process.execPath,['--experimental-strip-types',`tools/scripts/${script}`],{
    cwd:root,env:{...process.env,CI:'1'},encoding:'utf8',timeout:120_000,maxBuffer:16*1024*1024,
  });
  if (result.status!==0 || result.error) {
    console.error(`RC36 CHECK FAILED: ${script} (${result.error?.message||`exit ${result.status}`})`);
    console.error(String(result.stdout||'').slice(-3000));
    console.error(String(result.stderr||'').slice(-3000));
    process.exitCode=1;
    break;
  }
  passed++;
  console.log(`RC36 source check ${passed}/${checks.length}: ${script}`);
}
if (passed===checks.length) console.log(`RC36 SOURCE CHECK PASS ${passed}/${checks.length}. Build and runtime certification remain separate.`);

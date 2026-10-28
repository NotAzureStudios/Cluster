// RC installation gate. Execute a compact, cross-platform source regression
// matrix against the EXACT revision that will be installed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tests=[
  'tools/scripts/cluster-batch-l-build-boundary-tests.mjs',
  'tools/scripts/cluster-rc-renderer-boundary-tests.mjs',
  'tools/scripts/cluster-rc3-renderer-type-tests.mjs',
  'tools/scripts/cluster-rc4-migration-tests.mjs',
  'tools/scripts/cluster-rc-runtime-admission-tests.mjs',
  'tools/installer/installer-contract-tests.mjs',
  'tools/scripts/cluster-td6-g27-domain-settings-oobe-tests.mjs',
  'tools/scripts/cluster-td6-g27-configuration-rollback-tests.mjs',
  'tools/scripts/cluster-td2-workspace-claim-races.mjs',
  'tools/scripts/cluster-td6-g09-setup-guidance-tests.mjs',
  'tools/scripts/cluster-td6-source-scan.mjs',
  'tools/scripts/cluster-rc6-native-boundary-tests.mjs',
  'tools/scripts/cluster-rc7-portable-postgres-tests.mjs',
  'tools/scripts/cluster-rc8-schema-lineage-tests.mjs',
  'tools/scripts/cluster-rc9-root-entry-tests.mjs',
  'tools/scripts/cluster-rc10-passkey-domain-tests.mjs',
  'tools/scripts/cluster-rc11-staged-bootstrap-tests.mjs',
  'tools/scripts/cluster-rc12-source-build-distribution-tests.mjs',
  'tools/scripts/cluster-rc13-ui-api-budgets-tests.mjs',
  'tools/scripts/cluster-rc14-runtime-shell-tests.mjs',
  'tools/scripts/cluster-rc15-icons-visual-contract-tests.mjs',
  'tools/scripts/cluster-rc16-icon-migration-tests.mjs',
  'tools/scripts/cluster-rc17-workspace-density-tests.mjs',
  'tools/scripts/cluster-inventory-completion-tests.mjs',
  'tools/scripts/cluster-rc18-resource-workflow-tests.mjs',
  'tools/scripts/cluster-rc19-workflow-consistency-tests.mjs',
  'tools/scripts/cluster-rc20-windows-release-gates.mjs',
  'tools/scripts/cluster-rc21-request-fairness-tests.mjs',
  'tools/scripts/cluster-rc22-workspace-visual-tests.mjs',
  'tools/scripts/cluster-rc23-runtime-diagnostics-tests.mjs',
  'tools/scripts/cluster-rc26-projects-viewer-build-regression.mjs',
  'tools/scripts/cluster-rc27-admin-navigation-density-tests.mjs',
  'tools/scripts/cluster-rc27-shell-spatial-preferences-tests.mjs',
];
let passed=0;
for(const script of tests){
 const result=spawnSync(process.execPath,['--experimental-strip-types',script],{
  cwd:root,env:{...process.env,CI:'1'},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,
 });
 if(result.status!==0 || result.error){
  console.error(`RC CHECK FAILED ${script}:`,result.error||`exit ${result.status}`);
  console.error(String(result.stdout||'').slice(-4000));
  console.error(String(result.stderr||'').slice(-4000));
  process.exitCode=1;break;
 }
 passed++;
 console.log(`RC CHECK PASS (${passed}/${tests.length}): ${script}`);
}
if(passed===tests.length)console.log(`${passed}/${tests.length} RC source regression commands passed`);

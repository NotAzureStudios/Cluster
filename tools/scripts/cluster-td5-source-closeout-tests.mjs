/** Source-only regression reconciliation. Intentionally does not launch a database,
 * native process, or unsafe storage cleanup. Platform acceptance is a separate gate. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scripts = [
  'cluster-td5-p1-lifecycle-tests.mjs',
  'cluster-td5-p2-local-storage-integrity-tests.mjs',
  'cluster-td5-p3-path-and-integrity-tests.mjs',
  'cluster-td5-p4-backup-mirror-safety-tests.mjs',
  'cluster-td5-p5-direct-upload-retention-tests.mjs',
  'cluster-td5-p6-build-database-gate-tests.mjs',
  'cluster-td5-p7-runtime-budget-tests.mjs',
  'cluster-td5-p7-acceptance-process-tests.mjs',
  'cluster-td5-p8-acceptance-output-tests.mjs',
  'cluster-td5-p9-output-budget-tests.mjs',
  'cluster-td5-p10-job-commit-boundary-tests.mjs',
  'cluster-td5-p11-worker-telemetry-isolation-tests.mjs',
  'cluster-td5-p12-runtime-scheduler-isolation-tests.mjs',
  'cluster-td5-p13-committed-job-outcome-tests.mjs',
];
let assertions = 0;
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', resolve(root, 'tools/scripts', script)], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 50_000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/# pass (\d+)/);
  const passed = Number(match?.[1] || 0);
  if (result.error || result.status !== 0 || !passed) {
    console.error(`FAIL ${script} (status=${result.status})\n${output.slice(-7000)}`);
    process.exitCode = 1;
    break;
  }
  assertions += passed;
  console.log(`PASS ${script}: ${passed} test cases`);
}
if (process.exitCode !== 1) console.log(`TD5 source closeout: ${scripts.length}/${scripts.length} scripts, ${assertions} cases passed. Runtime certification NOT RUN.`);

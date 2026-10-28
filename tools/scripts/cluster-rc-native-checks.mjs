// Mandatory RC native Go test gate. Run on the target OS using the pinned private
// Go 1.27.1 toolchain, before npm dependency install and frontend compilation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modules = ['apps/host-go', 'apps/server-launcher-go', 'apps/update-helper-go', 'apps/workstation-go', 'tools/server-entry-go'];
for (const module of modules) {
  console.log(`[RC native] Testing ${module}...`);
  const result = spawnSync('go', ['test', '-count=1', './...'], {
    cwd: path.join(root, module),
    stdio: 'inherit',
    timeout: 120_000,
    env: { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0' },
  });
  if (result.error || result.status !== 0) {
    console.error(`[RC native] ${module} failed: ${result.error?.message || `exit ${result.status}`}`);
    process.exit(1);
  }
}
console.log(`[RC native] ${modules.length}/${modules.length} Go module suites passed.`);

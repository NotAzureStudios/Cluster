// Managed startup trusts only exactly pinned external dependencies (the
// launcher's installedDependencyGraphHealthy fails closed on ranges). Cluster
// 2.0.0 shipped two caret ranges and its installs would not start; this keeps
// any range from reaching a release build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The same manifests, in the same order, as the launcher's dependencyManifestPaths().
const manifests = ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json', 'packages/api-client/package.json', 'packages/renderer/package.json'];
const launcher = readFileSync(path.join(root, 'apps/server-launcher-go/main.go'), 'utf8');
for (const manifest of manifests) {
  const [dir, file] = [path.posix.dirname(manifest), path.posix.basename(manifest)];
  const goPath = dir === '.' ? `"${file}"` : `filepath.Join(${dir.split('/').map((part) => `"${part}"`).join(', ')}, "${file}")`;
  assert.ok(launcher.includes(goPath), `launcher checks ${manifest}`);
}
const exact = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const problems = [];
let checked = 0;
for (const manifest of manifests) {
  const json = JSON.parse(readFileSync(path.join(root, manifest), 'utf8'));
  const workspace = path.posix.dirname(manifest);
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(json[section] || {})) {
      if (name.startsWith('@cluster/') || spec === '*' || spec.startsWith('workspace:') || spec.startsWith('file:')) continue;
      checked++;
      if (!exact.test(spec)) { problems.push(`${manifest} ${section} ${name}: "${spec}" is a range; pin it exactly`); continue; }
      const locked = lock.packages[`${workspace === '.' ? '' : `${workspace}/`}node_modules/${name}`] || lock.packages[`node_modules/${name}`];
      if (!locked) problems.push(`${manifest} ${name}: not in package-lock.json`);
      else if (locked.version !== spec) problems.push(`${manifest} ${name}: pinned ${spec} but lockfile installs ${locked.version}`);
    }
  }
}
assert.deepEqual(problems, [], problems.join('\n'));
console.log(`Exact dependency pins: ${checked} external dependencies across ${manifests.length} manifests are pinned and locked`);

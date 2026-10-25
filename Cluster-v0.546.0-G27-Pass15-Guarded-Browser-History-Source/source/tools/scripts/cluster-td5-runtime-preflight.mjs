// Evidence inventory only. This does not start PostgreSQL, run migrations,
// assert Windows parity, or mark a release certified.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/toolchain-versions.json'), 'utf8'));
const checks = [];
const record = (id, status, detail) => checks.push({ id, status, detail });
const present = (name) => fs.existsSync(path.join(root, name));
const capture = (command, args) => {
  try { return execFileSync(command, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const numericVersion = (value) => (value.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? []);
const meets = (actual, required) => {
  const a = numericVersion(actual), b = numericVersion(required);
  return a.length === 3 && b.length === 3 && (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]))));
};
const nodeMajor = Number(contract.node.version.split('.')[0]);
const nodeOk = process.versions.node.split('.')[0] === String(nodeMajor) && meets(process.versions.node, contract.node.version);
record('node', nodeOk ? 'ready' : 'blocked', { expected: `>=${contract.node.version} <${nodeMajor + 1}`, observed: process.versions.node });
const goText = capture('go', ['version']);
const goVersion = goText ? goText.match(/go(\d+\.\d+\.\d+)/)?.[1] ?? null : null;
record('go', goVersion && meets(goVersion, contract.go.minimum) ? 'ready' : 'blocked', { expected: contract.go.minimum, observed: goVersion });
const deps = present('node_modules/typescript/package.json') && present('node_modules/@prisma/client/package.json');
record('node-dependencies', deps ? 'ready' : 'blocked', { installed: deps });
const prisma = present('apps/server/src/generated/prisma/client.ts') || present('apps/server/src/generated/prisma/client.js');
record('prisma-client', prisma ? 'ready' : 'blocked', { generated: prisma });
const pg = capture('pg_config', ['--version']) || capture('psql', ['--version']);
record('postgresql-tools', pg ? 'available-unverified' : 'blocked', { observed: pg });
const qt = capture('qmake6', ['-query', 'QT_VERSION']);
record('qt', qt && qt.startsWith(contract.qt.majorMinor) ? 'available-unverified' : 'blocked', { expected: contract.qt.version, observed: qt });
const windows = process.platform === 'win32';
record('windows-native', windows ? 'available-unverified' : 'blocked', { platform: process.platform });
// There is deliberately no lockfile in the lean source package: this is a
// reproducibility gap, not proof that the application itself is broken.
const lock = present('package-lock.json') || present('npm-shrinkwrap.json');
record('dependency-lock', lock ? 'ready' : 'blocked', { present: lock });
const result = { kind: 'cluster-td5-preflight', productVersion: contract.cluster,
  certification: 'not-performed', checks, blockers: checks.filter((value) => value.status === 'blocked').map((value) => value.id) };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Cluster TD5 runtime preflight for ${contract.cluster}: NOT CERTIFIED`);
  for (const check of checks) console.log(`${check.status.toUpperCase().padEnd(22)} ${check.id}`);
  console.log(`Blockers: ${result.blockers.join(', ') || 'none detected (acceptance tests still required)'}`);
}
if (process.argv.includes('--strict') && result.blockers.length) process.exitCode = 1;

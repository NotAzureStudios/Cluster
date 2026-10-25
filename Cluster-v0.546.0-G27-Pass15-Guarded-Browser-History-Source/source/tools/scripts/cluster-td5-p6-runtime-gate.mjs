/**
 * TD5 P6: gated real dependency/build/PostgreSQL acceptance, never simulated.
 *
 * Default is a read-only prerequisite inventory. The --run mode REQUIRES:
 *  - Node 24.20+, a reviewed package-lock and installed workspace dependencies
 *  - generated Prisma client and a disposable, EMPTY PostgreSQL 18 database
 *  - TD5_CERT_DISPOSABLE=I_UNDERSTAND and TD5_CERT_DATABASE_URL set to a
 *    database whose literal name begins cluster_td5_cert_
 *
 * This does NOT test Windows, NAS, SMB, S3, Qt, or native process lifecycle.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runBoundedAcceptanceStep } from './cluster-td5-acceptance-process.mjs';
import { databaseOutputSecrets, redactSensitiveText } from './cluster-td5-acceptance-redaction.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const mode = process.argv.includes('--run') ? 'run' : 'preflight';
const jsonOutput = process.argv.includes('--json');
const checks = [];
const add = (name, passed, detail) => checks.push({ name, status: passed ? 'ready' : 'blocked', detail });
const has = rel => existsSync(path.join(root, rel));
const toolchain = JSON.parse(readFileSync(path.join(root, 'config/toolchain-versions.json'), 'utf8'));
function versionParts(raw) { return String(raw || '').match(/^\d+\.\d+\.\d+$/) ? raw.split('.').map(Number) : null; }
function inPinnedNodeRange(actual, min) {
  const a = versionParts(actual), b = versionParts(min);
  return Boolean(a && b && a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
}
const targetUrl = process.env.TD5_CERT_DATABASE_URL || '';
function analyzeTarget(raw) {
  try {
    const u = new URL(raw);
    if (!['postgresql:', 'postgres:'].includes(u.protocol)) return { safe: false, reason: 'not PostgreSQL' };
    // Decode only for validation. Do not display host, path, credentials, or query.
    const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (!/^cluster_td5_cert_[a-zA-Z0-9_]+$/.test(name)) return { safe: false, reason: 'database name must start cluster_td5_cert_' };
    if (!u.hostname || u.hash) return { safe: false, reason: 'invalid connection target' };
    return { safe: true, databaseName: name };
  } catch { return { safe: false, reason: 'invalid PostgreSQL URL' }; }
}
const target = analyzeTarget(targetUrl);
const acknowledged = process.env.TD5_CERT_DISPOSABLE === 'I_UNDERSTAND';
let lockReady = false;
if (has('package-lock.json')) {
  try {
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const fromLock = lock?.packages?.[''];
    lockReady = lock.lockfileVersion >= 3 && fromLock?.name === packageJson.name &&
      fromLock?.version === packageJson.version &&
      ['dependencies', 'devDependencies', 'optionalDependencies'].every(field =>
        JSON.stringify(fromLock[field] || {}) === JSON.stringify(packageJson[field] || {}));
  } catch { lockReady = false; }
}
const depsReady = ['node_modules/.bin/tsc', 'node_modules/.bin/vite',
  'node_modules/prisma/build/index.js', 'node_modules/@prisma/client/package.json',
  'node_modules/pg/package.json'].every(has);
const prismaReady = has('apps/server/src/generated/prisma/client.ts') || has('apps/server/src/generated/prisma/client.js');
add('pinned-node', inPinnedNodeRange(process.versions.node, toolchain.node.version), `required >=${toolchain.node.version} <25; observed ${process.versions.node}`);
add('dependency-lock', lockReady, lockReady ? 'lockfile v3 matches root manifest; restore with npm ci before certification' : 'missing or inconsistent package-lock.json');
add('workspace-dependencies', depsReady, depsReady ? 'installed binaries present; build not yet executed' : 'npm workspace dependencies missing');
checks.push({ name: 'generated-prisma', status: prismaReady ? 'ready' : 'will-generate',
  detail: prismaReady ? 'generated client present; not runtime-certified' : 'Prisma generate will run before compilation' });
add('disposable-database-name', target.safe, target.safe ? 'literal disposable database-name convention satisfied' : target.reason);
add('explicit-disposable-consent', acknowledged, acknowledged ? 'operator acknowledged destructive test database' : 'set TD5_CERT_DISPOSABLE=I_UNDERSTAND');
const summary = {
  phase: 'TD5 Runtime Acceptance', mode, certification: 'NOT_PERFORMED',
  productVersion: toolchain.cluster, checks,
  blockers: checks.filter(c => c.status === 'blocked').map(c => c.name),
  // No connection-string-derived fields, even hostname, enter the summary.
};
const render = () => jsonOutput ? console.log(JSON.stringify(summary, null, 2)) :
  console.log(`Cluster TD5 runtime acceptance ${mode}: ${summary.certification}\n${checks.map(c => `${c.status.toUpperCase().padEnd(8)} ${c.name}: ${c.detail}`).join('\n')}`);
if (mode !== 'run') {
  render();
  if (process.argv.includes('--strict') && summary.blockers.length) process.exitCode = 2;
} else if (summary.blockers.length) {
  render();
  console.error('BLOCKED: no application build, migration, or database mutation attempted.');
  process.exitCode = 2;
} else {
  let Client;
  try { ({ Client } = await import('pg')); }
  catch { console.error('BLOCKED: installed pg driver is unavailable.'); process.exitCode = 2; }
  if (Client) {
    const client = new Client({ connectionString: targetUrl, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    let connected = false;
    try {
      await client.connect(); connected = true;
      // Confirm the *server's* actual database identity, not merely the URL.
      const info = (await client.query(`SELECT current_database() AS name,
        current_setting('server_version_num')::integer AS version,
        pg_is_in_recovery() AS recovering`)).rows[0];
      if (info?.name !== target.databaseName || Math.floor(Number(info?.version) / 10000) !== Number(toolchain.postgresql.major) || info?.recovering) {
        throw new Error('PostgreSQL 18, exact disposable database identity, and writable primary are required.');
      }
      // A fresh empty public schema is mandatory. Reusing a populated database
      // would make migrate deploy or certification tests dangerously ambiguous.
      // Retain an independent, session-level mutex for the entire acceptance
      // sequence. Releasing the connection after the empty check allowed a
      // second certification runner to begin racing against migration deploy.
      const mutex = (await client.query('SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [0x434c5553, 0x54443550])).rows[0]?.acquired;
      if (mutex !== true) throw new Error('Another TD5 certification run already owns this disposable database.');
      // This is an isolated disposable target, not an arbitrary shared database.
      // Existing sessions make even an empty schema unsafe to mutate.
      const peers = (await client.query(`SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()`)).rows[0]?.count;
      if (Number(peers) !== 0) throw new Error('Disposable target has other active database connections; refusing certification.');
      const tables = (await client.query(`SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
        WHERE n.nspname <> 'information_schema'
          AND n.nspname NOT LIKE 'pg_%'
          AND c.relkind IN ('r','p','v','m','f','S')`)).rows[0]?.count;
      if (tables !== 0) throw new Error('Disposable target is not empty; refusing migration on an existing database.');
      const steps = [
        ['Prisma schema validate', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:validate'], 5 * 60_000],
        ['Generate Prisma client', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:generate'], 5 * 60_000],
        ['Full workspace build', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], 25 * 60_000],
        ['Deploy full migration history', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:deploy'], 20 * 60_000],
        ['Verify migration state', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:status'], 5 * 60_000],
        ['TD1 independent PostgreSQL sessions', process.execPath, ['tools/scripts/cluster-td1-postgres-certification.mjs'], 10 * 60_000],
        ['TD2 competing PostgreSQL workers', process.execPath, ['tools/scripts/cluster-td2-postgres-queue-certification.mjs'], 10 * 60_000],
      ];
      const env = {
        ...process.env, DATABASE_URL: targetUrl, DIRECT_DATABASE_URL: targetUrl,
        TD1_CERT_DISPOSABLE: 'I_UNDERSTAND', TD1_CERT_DATABASE_URL: targetUrl,
        TD2_CERT_DISPOSABLE: 'I_UNDERSTAND', TD2_CERT_DATABASE_URL: targetUrl,
      };
      const evidence = [];
      const redactions = databaseOutputSecrets(env);
      for (const [name, bin, args, timeoutMs] of steps) {
        console.log(`RUN ${name}`);
        const startedAt = new Date().toISOString();
        const code = await runBoundedAcceptanceStep({ name, command: bin, args, cwd: root, env, timeoutMs, stdio: 'pipe', redactions });
        evidence.push({ name, startedAt, passed: code === 0 });
        if (code !== 0) throw new Error(`${name} failed. Subsequent certification steps were not run.`);
      }
      // Fingerprints are evidence references, not proof of installation without
      // the successful commands above. No DB credentials are included.
      const migrations = await readdir(path.join(root, 'apps/server/prisma/migrations'), { withFileTypes: true });
      const history = createHash('sha256');
      for (const name of migrations.filter(x => x.isDirectory()).map(x => x.name).sort()) {
        history.update(name); history.update(await readFile(path.join(root, 'apps/server/prisma/migrations', name, 'migration.sql')));
      }
      summary.certification = 'PINNED_BUILD_AND_DISPOSABLE_POSTGRESQL_SMOKES_PASSED';
      summary.evidence = { steps: evidence, migrationCount: migrations.filter(x => x.isDirectory()).length,
        migrationSha256: history.digest('hex'), lockSha256: createHash('sha256').update(readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
      summary.limitations = ['Windows/Qt acceptance not run', 'NTFS/SMB/NAS/S3 provider testing not run', 'full multi-user/browser acceptance not run', 'full application PostgreSQL transaction certification remains separate'];
      render();
    } catch (error) {
      // Never print raw pg/Prisma error strings: they may contain connection URLs.
      console.error('FAIL: TD5 P6 runtime gate stopped. Examine prior step output without sharing credentials.');
      console.error(error instanceof Error ? redactSensitiveText(error.message, databaseOutputSecrets(process.env)) : 'Unknown execution error');
      process.exitCode = 1;
    } finally {
      if (connected) await client.end().catch(() => {});
    }
  }
}

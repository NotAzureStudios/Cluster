/** TD5 P6 fail-closed runtime-gate and credential-redaction regression tests. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatabaseConfiguration, redactDatabaseUrl } from './database-config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databaseScript = path.join(root, 'tools/scripts/database-config.mjs');
const gateScript = path.join(root, 'tools/scripts/cluster-td5-p6-runtime-gate.mjs');
const url = 'postgresql://owner:secret-password@127.0.0.1:5432/cluster_td5_cert_p6?token=hidden-token&sslmode=disable';
const direct = 'postgresql://super:second-secret@127.0.0.1:5432/cluster_td5_cert_p6?sslkey=hidden-key';
function run(script, args = [], env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: direct,
      TD5_CERT_DATABASE_URL: '', TD5_CERT_DISPOSABLE: '', ...env },
  });
  assert.equal(result.error, undefined);
  return { code: result.status, output: result.stdout + result.stderr };
}
test('database diagnostic CLI never publishes primary or direct credentials', () => {
  const r = run(databaseScript);
  assert.equal(r.code, 0, r.output);
  const data = JSON.parse(r.output);
  assert.equal(data.provider, 'postgresql');
  for (const secret of ['secret-password', 'second-secret', 'hidden-token', 'hidden-key']) {
    assert.equal(r.output.includes(secret), false, `credential leaked: ${secret}`);
  }
  assert.equal(Object.hasOwn(data, 'redactedUrl'), false, 'avoid ambiguous redundant output');
  assert.match(data.databaseUrl, /REDACTED/);
  assert.match(data.directUrl, /REDACTED/);
});
test('URL redaction treats unfamiliar query fields as secret by default', () => {
  const value = redactDatabaseUrl('postgres://u:p@localhost/db?schema=cluster&connection_limit=4&arbitraryCredential=hidden&sslkey=private');
  assert(!value.includes('hidden'));
  assert(!value.includes('private'));
  assert.match(value, /schema=cluster/);
});
test('database configuration rejects a non-PostgreSQL direct connection', async () => {
  const old = process.env.DIRECT_DATABASE_URL;
  process.env.DIRECT_DATABASE_URL = 'file:///tmp/unexpected.db';
  try { await assert.rejects(loadDatabaseConfiguration(root, { databaseUrl: url }), /requires PostgreSQL/); }
  finally { if (old === undefined) delete process.env.DIRECT_DATABASE_URL; else process.env.DIRECT_DATABASE_URL = old; }
});
test('P6 preflight does not claim certification or print database credentials', () => {
  const r = run(gateScript, ['--json'], { TD5_CERT_DATABASE_URL: url, TD5_CERT_DISPOSABLE: 'I_UNDERSTAND' });
  assert.equal(r.code, 0, r.output);
  const data = JSON.parse(r.output);
  assert.equal(data.certification, 'NOT_PERFORMED');
  assert(data.blockers.includes('dependency-lock'));
  assert(!r.output.includes('secret-password'));
  assert(!r.output.includes('hidden-token'));
});
test('strict preflight fails nonzero if pinned toolchain or dependencies are missing', () => {
  const r = run(gateScript, ['--strict']);
  assert.equal(r.code, 2);
  assert.match(r.output, /BLOCKED/);
});
test('run mode cannot touch database without explicit disposable consent', () => {
  const r = run(gateScript, ['--run'], { TD5_CERT_DATABASE_URL: url });
  assert.equal(r.code, 2);
  assert.match(r.output, /no application build, migration, or database mutation attempted/);
  assert(!r.output.includes('secret-password'));
});
test('run mode rejects a production-like database name despite consent', () => {
  const r = run(gateScript, ['--run'], {
    TD5_CERT_DISPOSABLE: 'I_UNDERSTAND',
    TD5_CERT_DATABASE_URL: 'postgresql://owner:secret-password@127.0.0.1:5432/cluster_production',
  });
  assert.equal(r.code, 2);
  assert.match(r.output, /database name must start cluster_td5_cert_/);
});
test('run mode cannot claim success when pinned runtime prerequisites are absent', () => {
  const r = run(gateScript, ['--run', '--json'], { TD5_CERT_DATABASE_URL: url, TD5_CERT_DISPOSABLE: 'I_UNDERSTAND' });
  assert.equal(r.code, 2);
  assert(!r.output.includes('DEPENDENCY_BUILD_AND_POSTGRESQL_GATES_PASSED'));
  assert(!r.output.includes('secret-password'));
  assert(!r.output.includes('hidden-token'));
});

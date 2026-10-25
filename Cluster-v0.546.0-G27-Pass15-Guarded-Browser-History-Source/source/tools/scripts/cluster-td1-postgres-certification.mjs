/**
 * TD1 disposable PostgreSQL integration gate.
 *
 * Usage on a test PostgreSQL 17/18 server with workspace dependencies installed:
 *   TD1_CERT_DATABASE_URL=postgresql://... TD1_CERT_DISPOSABLE=I_UNDERSTAND \
 *     node tools/scripts/cluster-td1-postgres-certification.mjs
 *
 * This creates a random isolated schema, applies the two actual TD1 migrations
 * against a minimal Project fixture, exercises concurrent SQL CAS operations,
 * then drops the schema. It must NEVER be run on a production server.
 * It intentionally cannot certify Fastify/Prisma, Windows/NTFS, or the full app.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.TD1_CERT_DISPOSABLE !== 'I_UNDERSTAND') {
  console.error('BLOCKED: TD1_CERT_DISPOSABLE=I_UNDERSTAND must explicitly authorize an isolated-schema test against disposable PostgreSQL.');
  process.exitCode = 2;
} else if (!(process.env.TD1_CERT_DATABASE_URL || '').startsWith('postgres')) {
  console.error('BLOCKED: provide TD1_CERT_DATABASE_URL to a disposable PostgreSQL 17/18 database.');
  process.exitCode = 2;
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const names = [
    '20261011133000_td1_project_calendar_inheritance',
    '20261011143000_td1_project_calendar_parent_lock',
  ];
  const schema = `td1_cert_${randomBytes(8).toString('hex')}`;
  let Client;
  try {
    const pg = await import('pg');
    Client = pg.Client || pg.default?.Client;
    if (!Client) throw new Error('missing Client export');
  } catch {
    console.error('BLOCKED: package pg is unavailable; install workspace dependencies before live PostgreSQL certification.');
    process.exitCode = 2;
  }
  if (Client) {
    const dbUrl = process.env.TD1_CERT_DATABASE_URL;
    const clients = Array.from({ length: 2 }, () => new Client({ connectionString: dbUrl }));
    let created = false;
    let tests = 0;
    const check = (name, fn) => fn().then(() => { tests++; console.log(`PASS ${name}`); });
    try {
      await Promise.all(clients.map(c => c.connect()));
      const [a, b] = clients;
      // Schema name is generated from hex only; never interpolated from a user-supplied string.
      await a.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      for (const c of clients) await c.query(`SET search_path TO "${schema}"`);
      await a.query('CREATE TABLE "Project" ("id" TEXT PRIMARY KEY)');
      for (const name of names) {
        const sql = await readFile(path.join(root, 'apps/server/prisma/migrations', name, 'migration.sql'), 'utf8');
        await a.query(sql);
      }
      await check('TD1 migrations create Project override with unlocked default', async () => {
        const result = await a.query(`SELECT "lockUserOverride", "revision" FROM "ProjectToolSettingOverride" LIMIT 1`);
        assert.equal(result.rowCount, 0);
        const def = await a.query(`SELECT column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='ProjectToolSettingOverride' AND column_name='lockUserOverride'`, [schema]);
        assert.match(def.rows[0]?.column_default || '', /false/i);
      });
      await a.query(`INSERT INTO "Project" ("id") VALUES ('p1'), ('p2')`);
      await a.query(`INSERT INTO "ProjectToolSettingOverride" ("projectId","tool","field","valueJson","updatedAt") VALUES ('p1','calendar','defaultView','"month"',NOW())`);
      await check('Project override revision update is atomic across two independent clients', async () => {
        const update = (client, view) => client.query(`UPDATE "ProjectToolSettingOverride" SET "valueJson"=$1, "revision"="revision"+1,"updatedAt"=NOW() WHERE "projectId"='p1' AND "tool"='calendar' AND "field"='defaultView' AND "revision"=1 RETURNING "revision"`, [JSON.stringify(view)]);
        const results = await Promise.all([update(a,'day'), update(b,'week')]);
        assert.deepEqual(results.map(x => x.rowCount).sort(), [0,1]);
        const row = await a.query(`SELECT "revision" FROM "ProjectToolSettingOverride" WHERE "projectId"='p1'`);
        assert.equal(row.rows[0].revision, 2);
      });
      await check('stale reset is rejected and revised lock is persisted', async () => {
        const stale = await b.query(`DELETE FROM "ProjectToolSettingOverride" WHERE "projectId"='p1' AND "tool"='calendar' AND "field"='defaultView' AND "revision"=1`);
        assert.equal(stale.rowCount, 0);
        const update = await a.query(`UPDATE "ProjectToolSettingOverride" SET "lockUserOverride"=TRUE, "revision"="revision"+1,"updatedAt"=NOW() WHERE "projectId"='p1' AND "tool"='calendar' AND "field"='defaultView' AND "revision"=2`);
        assert.equal(update.rowCount, 1);
        const locked = await b.query(`SELECT "lockUserOverride" FROM "ProjectToolSettingOverride" WHERE "projectId"='p1'`);
        assert.equal(locked.rows[0].lockUserOverride, true);
      });
      await check('parent project deletion cascades override, reset releases child row', async () => {
        await a.query(`INSERT INTO "ProjectToolSettingOverride" ("projectId","tool","field","valueJson","updatedAt") VALUES ('p2','calendar','defaultView','"week"',NOW())`);
        await b.query(`DELETE FROM "Project" WHERE "id"='p2'`);
        const deleted = await a.query(`SELECT * FROM "ProjectToolSettingOverride" WHERE "projectId"='p2'`);
        assert.equal(deleted.rowCount, 0);
        const reset = await a.query(`DELETE FROM "ProjectToolSettingOverride" WHERE "projectId"='p1' AND "revision"=3`);
        assert.equal(reset.rowCount, 1);
      });
      await a.query(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "preferences" TEXT, "personalAccentColor" TEXT)`);
      await a.query(`INSERT INTO "User" ("id", "preferences", "personalAccentColor") VALUES ('u1','{"userShowHelpText":false}','#57c1ff')`);
      await check('user preferences CAS prevents an accent-only race', async () => {
        const original = await a.query(`SELECT "preferences","personalAccentColor" FROM "User" WHERE "id"='u1'`);
        await b.query(`UPDATE "User" SET "personalAccentColor"='#091827' WHERE "id"='u1'`);
        const stale = await a.query(`UPDATE "User" SET "preferences"=$1,"personalAccentColor"=$2 WHERE "id"='u1' AND "preferences"=$3 AND "personalAccentColor"=$4`, [JSON.stringify({userShowHelpText:true}),'#fefefe',original.rows[0].preferences,original.rows[0].personalAccentColor]);
        assert.equal(stale.rowCount, 0);
        const persisted = await b.query(`SELECT "preferences","personalAccentColor" FROM "User" WHERE "id"='u1'`);
        assert.equal(persisted.rows[0].personalAccentColor,'#091827');
        assert.equal(JSON.parse(persisted.rows[0].preferences).userShowHelpText,false);
      });
      console.log(`PASS TD1 PostgreSQL isolated-schema integration: ${tests}/${tests} checks`);
    } catch (error) {
      // Do not echo DB URLs or credentials from connection failures.
      console.error('FAIL TD1 PostgreSQL integration:', String(error?.message || error).replaceAll(dbUrl, '[redacted]'));
      process.exitCode = 1;
    } finally {
      // Drop the throwaway schema only; this script never modifies public tables.
      if (created) {
        try { await clients[0].query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        catch { console.error('WARNING: cleanup of isolated test schema failed; remove schema', schema, 'manually.'); process.exitCode = 1; }
      }
      await Promise.all(clients.map(async c => { try { await c.end(); } catch { /* disconnected client */ } }));
    }
  }
}

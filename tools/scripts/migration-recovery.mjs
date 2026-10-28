// Narrow, fail-closed recovery for the PostgreSQL 63-byte index-name collision
// in the 1.0.0-rc.3 Calendar G21 migration. NEVER generic migration healing.
// Prisma/PostgreSQL may commit the CREATE TABLE and UNIQUE INDEX before the
// duplicate CREATE INDEX fails, leaving a partially applied empty table.
import { createRequire } from 'node:module';
import path from 'node:path';

export const BROKEN_MIGRATION = '20261021230000_td6_g21_calendar_meeting_occurrence_responses';
const TABLE = 'CalendarMeetingOccurrenceResponse';
const UNIQUE_INDEX = 'CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceSta';
const EXPECTED_COLUMNS = [
  'attendanceStatus','calendarEventId','id','occurrenceStartsAt','revision',
  'rsvpStatus','updatedAt','updatedByUserId','userId',
];
const nameIsCollision = (value) => /42P07|already exists|CalendarMeetingOccurrenceResponse_calendarEventId_occurrenceSta/i.test(String(value || ''));

export function recoveryDecision({ failed, tableExists, columns = [], indexes = [], constraints = [], rowCount = 0 }) {
  if (!Array.isArray(failed) || failed.length === 0) return { action: 'none' };
  if (failed.length !== 1 || failed[0].migration_name !== BROKEN_MIGRATION || !nameIsCollision(failed[0].logs)) {
    return { action: 'refuse', reason: 'Unexpected or unrecognized failed migration; no automatic recovery is allowed.' };
  }
  if (!tableExists) return { action: 'resolve-only' }; // PostgreSQL rolled back the DDL.
  if (!Number.isInteger(rowCount) || rowCount !== 0) return { action: 'refuse', reason: 'Partial Calendar response table contains data.' };
  if (JSON.stringify([...columns].sort()) !== JSON.stringify(EXPECTED_COLUMNS)) {
    return { action: 'refuse', reason: 'Partial Calendar response columns do not match the original failed migration.' };
  }
  const expectedIndexes = [TABLE + '_pkey', UNIQUE_INDEX].sort();
  if (JSON.stringify([...indexes.map(x => x.indexname)].sort()) !== JSON.stringify(expectedIndexes) ||
      !indexes.some(x => x.indexname === UNIQUE_INDEX && /CREATE UNIQUE INDEX/i.test(x.indexdef) && /"userId"/.test(x.indexdef))) {
    return { action: 'refuse', reason: 'Partial Calendar response indexes do not match known G21 intermediate state.' };
  }
  if (constraints.length !== 1 || constraints[0].conname !== TABLE + '_pkey' || constraints[0].contype !== 'p') {
    return { action: 'refuse', reason: 'Unexpected foreign keys or constraints found on partial Calendar response table.' };
  }
  return { action: 'drop-empty-partial-and-resolve' };
}

export async function recoverRc3MeetingOccurrenceMigration({ root, config, resolveRolledBack, makeClient }) {
  const requireFrom = createRequire(path.join(root, config.portable ? 'app' : '', 'package.json'));
  const Client = makeClient || requireFrom('pg').Client;
  const db = new Client({ connectionString: config.directUrl, connectionTimeoutMillis: 10000 });
  await db.connect();
  let needsResolve = false;
  try {
    // PostgreSQL advisory lock isolates concurrent Cluster startup recovery.
    // The subsequent Prisma resolve runs after the transaction commits.
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(475641, 21230000)');
    let failures;
    try {
      failures = (await db.query('SELECT migration_name, logs FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')).rows;
    } catch (error) {
      if (error?.code === '42P01') { await db.query('ROLLBACK'); return false; }
      throw error;
    }
    if (!failures.length) { await db.query('COMMIT'); return false; }
    const tableExists = Boolean((await db.query('SELECT to_regclass($1) AS table_name', [`public."${TABLE}"`])).rows[0]?.table_name);
    if (tableExists) await db.query(`LOCK TABLE public."${TABLE}" IN ACCESS EXCLUSIVE MODE`);
    const [columns, indexes, constraints, count] = tableExists ? await Promise.all([
      db.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['public', TABLE]),
      db.query('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2', ['public', TABLE]),
      db.query('SELECT conname, contype FROM pg_constraint WHERE conrelid = $1::regclass', [`public."${TABLE}"`]),
      db.query(`SELECT count(*)::integer AS n FROM public."${TABLE}"`),
    ]) : [null,null,null,null];
    const decision = recoveryDecision({ failed: failures, tableExists,
      columns: columns?.rows.map(x => x.column_name), indexes: indexes?.rows,
      constraints: constraints?.rows, rowCount: count?.rows[0]?.n });
    if (decision.action === 'refuse') throw new Error(`RC3 G21 migration recovery refused: ${decision.reason}`);
    if (decision.action === 'drop-empty-partial-and-resolve') {
      console.log('RC3 Calendar migration: verified empty partial table; reverting only the incomplete G21 table.');
      await db.query(`DROP TABLE public."${TABLE}" RESTRICT`);
    }
    await db.query('COMMIT');
    needsResolve = decision.action !== 'none';
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
  if (needsResolve) {
    console.log('RC3 Calendar migration: resolving known failed migration as rolled back, then normal Prisma deploy resumes.');
    await resolveRolledBack();
  }
  return needsResolve;
}

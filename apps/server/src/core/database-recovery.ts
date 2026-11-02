import crypto from "node:crypto";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { throwIfAborted } from "./operation-cancellation.js";
import { runManagedSubprocess } from "./managed-subprocess.js";

const COMMAND_TIMEOUT_MS = 15 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;

function postgresEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("Cluster recovery requires a PostgreSQL DATABASE_URL.");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE,
  };
}

function command(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = COMMAND_TIMEOUT_MS, signal?: AbortSignal) {
  return runManagedSubprocess({ command, args, env, signal,
    timeoutMs, maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES });
}

function sqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function drillDatabaseUrl(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function maintenanceDatabaseUrl(databaseUrl: string) {
  return drillDatabaseUrl(databaseUrl, "postgres");
}

function parseCountOutput(value: string) {
  const result: Record<string, number> = {};
  for (const line of value.split(/\r?\n/)) {
    const [name, count] = line.trim().split("\t");
    if (!name || !/^\d+$/.test(count || "")) continue;
    result[name] = Number(count);
  }
  return result;
}

async function publicTableNames(databaseUrl: string, signal?: AbortSignal) {
  const sql = `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename;`;
  const result = await command("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], postgresEnvironment(databaseUrl), COMMAND_TIMEOUT_MS, signal);
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function authoritativeCounts(databaseUrl: string, signal?: AbortSignal) {
  const tables = await publicTableNames(databaseUrl, signal);
  if (!tables.length) return {};
  const sql = tables
    .map((table) => `SELECT '${table.replaceAll("'", "''")}' AS name, count(*)::bigint AS count FROM ${sqlIdentifier(table)}`)
    .join(" UNION ALL ");
  const result = await command("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--field-separator", "\t", "--command", `${sql} ORDER BY name;`], postgresEnvironment(databaseUrl), COMMAND_TIMEOUT_MS, signal);
  return parseCountOutput(result.stdout);
}

async function migrationState(databaseUrl: string, signal?: AbortSignal) {
  const env = postgresEnvironment(databaseUrl);
  const sql = `SELECT COALESCE(string_agg(migration_name, ',' ORDER BY finished_at), '') FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`;
  const result = await command("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], env, COMMAND_TIMEOUT_MS, signal);
  return result.stdout.trim().split(",").filter(Boolean);
}

export async function databaseRecoverySnapshot(databaseUrl: string, signal?: AbortSignal) {
  const env = postgresEnvironment(databaseUrl);
  const sql = `SELECT current_database(), (SELECT oid::text FROM pg_database WHERE datname = current_database()), current_setting('server_version_num'), pg_is_in_recovery();`;
  const result = await command("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--field-separator", "\t", "--command", sql], env, COMMAND_TIMEOUT_MS, signal);
  const [database = "unknown", databaseOid = "unknown", versionNumber = "unknown", recovery = "unknown"] = result.stdout.trim().split("\t");
  throwIfAborted(signal);
  const [counts, migrations] = await Promise.all([authoritativeCounts(databaseUrl, signal), migrationState(databaseUrl, signal)]);
  return { database, databaseOid, versionNumber: Number(versionNumber) || null, recovery: recovery === "t", counts, migrations };
}

export async function runDatabaseRestoreDrill(input: {
  databaseUrl: string;
  dumpPath: string;
  expected?: { counts?: Record<string, number>; migrations?: string[] };
  signal?: AbortSignal;
}) {
  throwIfAborted(input.signal);
  const suffix = crypto.randomBytes(6).toString("hex");
  const databaseName = `cluster_restore_drill_${Date.now()}_${suffix}`;
  const maintenanceUrl = maintenanceDatabaseUrl(input.databaseUrl);
  const drillUrl = drillDatabaseUrl(input.databaseUrl, databaseName);
  const maintenanceEnv = postgresEnvironment(maintenanceUrl);
  let created = false;
  let restoreError: unknown = null;
  try {
    await command("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command", `CREATE DATABASE ${sqlIdentifier(databaseName)} TEMPLATE template0;`], maintenanceEnv, COMMAND_TIMEOUT_MS, input.signal);
    created = true;
    await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", input.dumpPath], postgresEnvironment(drillUrl), COMMAND_TIMEOUT_MS, input.signal);
    const snapshot = await databaseRecoverySnapshot(drillUrl, input.signal);
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(input.expected?.counts || {})) {
      if (typeof value === "number" && snapshot.counts[key] !== value) mismatches.push(`${key} count ${snapshot.counts[key] ?? "missing"} != ${value}`);
    }
    if (input.expected?.migrations?.length) {
      const restored = snapshot.migrations.join("\n");
      const expected = input.expected.migrations.join("\n");
      if (restored !== expected) mismatches.push("migration history mismatch");
    }
    return { ok: mismatches.length === 0, databaseName, snapshot, mismatches };
  } catch (error) {
    restoreError = error;
    throw error;
  } finally {
    if (created) {
      try {
        await command("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command",
          `DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)} WITH (FORCE);`], maintenanceEnv, COMMAND_TIMEOUT_MS);
      } catch (cleanupError) {
        if (restoreError) throw new AggregateError([restoreError, cleanupError], "PostgreSQL restore drill and temporary database cleanup both failed.");
        throw new Error(`PostgreSQL restore drill cleanup failed; inspect temporary database ${databaseName}.`, { cause: cleanupError });
      }
    }
  }
}


/**
 * Destructive restore of an installed PostgreSQL database. This API refuses to
 * touch the live database until the selected dump successfully restores into
 * an isolated drill database AND a separate safety backup is verified.
 *
 * The Server must be in maintenance with API writers stopped by the caller.
 */
export async function replaceDatabaseFromBackup(input: {
  databaseUrl: string;
  dumpPath: string;
  safetyDumpPath?: string | null;
}) {
  const target = new URL(input.databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!databaseName || ["postgres", "template0", "template1"].includes(databaseName.toLowerCase())) {
    throw new Error("Refusing to replace a PostgreSQL maintenance/template database.");
  }
  const safetyDumpPath = String(input.safetyDumpPath || "").trim();
  if (!safetyDumpPath || path.resolve(safetyDumpPath) === path.resolve(input.dumpPath)) {
    throw new Error("A separate, explicit safety dump destination is required before replacing a live database.");
  }
  const source = await lstat(input.dumpPath);
  if (!source.isFile() || source.isSymbolicLink() || source.size <= 0) {
    throw new Error("The selected restore source is not a regular, nonempty PostgreSQL dump.");
  }
  // Do not overwrite an existing recovery point even when the destination
  // is controlled by a privileged maintenance workflow.
  const existingSafety = await lstat(safetyDumpPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (existingSafety) throw new Error("Safety backup path already exists; refusing to overwrite recovery evidence.");

  // Validates the dump by executing pg_restore against a disposable database,
  // not merely by listing the archive's TOC.
  const drill = await runDatabaseRestoreDrill({ databaseUrl: input.databaseUrl, dumpPath: input.dumpPath });
  if (!drill.ok || !drill.snapshot.migrations.length) {
    throw new Error("Selected backup failed isolated PostgreSQL restore/migration verification.");
  }

  const maintenanceUrl = maintenanceDatabaseUrl(input.databaseUrl);
  const maintenanceEnv = postgresEnvironment(maintenanceUrl);
  const liveEnv = postgresEnvironment(input.databaseUrl);
  const restoreTimeout = 30 * 60_000;
  await command("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", safetyDumpPath], liveEnv, restoreTimeout);
  const safety = await command("pg_restore", ["--list", safetyDumpPath], liveEnv, restoreTimeout);
  if (!safety.stdout.includes("TABLE") || (await lstat(safetyDumpPath)).size <= 0) {
    throw new Error("The new safety backup could not be verified; live database was not touched.");
  }

  const resetDatabase = async () => {
    // psql -c with DROP and CREATE in one string runs as a single implicit
    // transaction; PostgreSQL rejects CREATE DATABASE in a transaction.
    // Execute each statement independently and fail on SQL errors.
    await command("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName.replaceAll("'", "''")}' AND pid <> pg_backend_pid();`], maintenanceEnv);
    await command("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command",
      `DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)};`], maintenanceEnv);
    await command("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--command",
      `CREATE DATABASE ${sqlIdentifier(databaseName)} TEMPLATE template0;`], maintenanceEnv);
  };

  let destructivePhaseStarted = false;
  try {
    destructivePhaseStarted = true;
    await resetDatabase();
    await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", input.dumpPath], liveEnv, restoreTimeout);
    const restored = await databaseRecoverySnapshot(input.databaseUrl);
    if (!restored.migrations.length || restored.migrations.join("\n") !== drill.snapshot.migrations.join("\n")) {
      throw new Error("Restored database migration history differs from the verified source.");
    }
    return restored;
  } catch (restoreError) {
    if (!destructivePhaseStarted) throw restoreError;
    try {
      await resetDatabase();
      await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", safetyDumpPath], liveEnv, restoreTimeout);
      // A successful process exit is not enough: verify application schema
      // and migrations before reporting an effective rollback.
      const rollback = await databaseRecoverySnapshot(input.databaseUrl);
      if (!rollback.migrations.length) throw new Error("Safety rollback did not restore the expected Cluster schema.");
    } catch (rollbackError) {
      throw new AggregateError([restoreError, rollbackError],
        `Database restore failed AND safety rollback failed. Do not restart Cluster; inspect verified backup ${safetyDumpPath}.`);
    }
    throw new Error(`Database restore failed; the prior database was restored from ${safetyDumpPath}.`, { cause: restoreError });
  }
}

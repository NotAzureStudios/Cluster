import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { OperationCancelledError, throwIfAborted } from "./operation-cancellation.js";

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
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let abortKillTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (settled) return;
      child.kill("SIGTERM");
      abortKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5_000);
      abortKillTimer.unref?.();
    };
    const finish = (error?: Error, result?: { stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} exceeded the ${timeoutMs} ms recovery timeout.`));
    }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const append = (target: "stdout" | "stderr", chunk: unknown) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error(`${command} produced more than ${MAX_COMMAND_OUTPUT_BYTES} bytes of recovery output.`));
        return;
      }
      if (target === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (signal?.aborted) {
        finish(signal.reason instanceof Error ? signal.reason : new OperationCancelledError(`${command} was cancelled.`));
      } else if (code === 0) finish(undefined, { stdout, stderr });
      else finish(new Error(`${command} failed with exit code ${code}: ${stderr.trim().slice(0, 2000)}`));
    });
  });
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
  try {
    await command("psql", ["--no-psqlrc", "--command", `CREATE DATABASE ${sqlIdentifier(databaseName)} TEMPLATE template0;`], maintenanceEnv, COMMAND_TIMEOUT_MS, input.signal);
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
  } finally {
    if (created) {
      await command("psql", ["--no-psqlrc", "--command", `DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)} WITH (FORCE);`], maintenanceEnv, COMMAND_TIMEOUT_MS).catch(() => undefined);
    }
  }
}


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
  const maintenanceUrl = maintenanceDatabaseUrl(input.databaseUrl);
  const maintenanceEnv = postgresEnvironment(maintenanceUrl);
  if (input.safetyDumpPath) {
    await command("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", input.safetyDumpPath], postgresEnvironment(input.databaseUrl), 30 * 60_000);
  }
  await command("psql", ["--no-psqlrc", "--command", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName.replaceAll("'", "''")}' AND pid <> pg_backend_pid();`], maintenanceEnv);
  await command("psql", ["--no-psqlrc", "--command", `DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)}; CREATE DATABASE ${sqlIdentifier(databaseName)} TEMPLATE template0;`], maintenanceEnv);
  try {
    await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", input.dumpPath], postgresEnvironment(input.databaseUrl), 30 * 60_000);
  } catch (error) {
    if (input.safetyDumpPath) {
      await command("psql", ["--no-psqlrc", "--command", `DROP DATABASE IF EXISTS ${sqlIdentifier(databaseName)}; CREATE DATABASE ${sqlIdentifier(databaseName)} TEMPLATE template0;`], maintenanceEnv).catch(() => undefined);
      await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", input.safetyDumpPath], postgresEnvironment(input.databaseUrl), 30 * 60_000).catch(() => undefined);
    }
    throw error;
  }
  return databaseRecoverySnapshot(input.databaseUrl);
}

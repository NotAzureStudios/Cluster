import { Client } from "pg";
import path from "node:path";
import { spawnPortable } from "./command-invocation.mjs";
import { loadDatabaseConfiguration, resolveClusterRoot } from "./database-config.mjs";

function run(command, args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawnPortable(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", (error) => resolve({ ok: false, error: error.message }));
    child.once("close", (code) => resolve({ ok: code === 0, code }));
  });
}

function driverConnectionString(raw) {
  const url = new URL(raw);
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("pool_timeout");
  url.searchParams.delete("connect_timeout");
  return url.toString();
}

const root = await resolveClusterRoot();
const config = await loadDatabaseConfiguration(root);
const env = { ...process.env, DATABASE_URL: config.databaseUrl, DIRECT_DATABASE_URL: config.directUrl };
const commandScript = path.join(root, "tools", "scripts", "database-command.mjs");

console.log("Provider: postgresql");
console.log(`Connection: ${config.redactedUrl}`);
const connection = new URL(config.databaseUrl);
const connectionLimit = Number(connection.searchParams.get("connection_limit") || 0);
const poolTimeout = Number(connection.searchParams.get("pool_timeout") || 0);
const connectTimeout = Number(connection.searchParams.get("connect_timeout") || 0);
if (!connectionLimit) console.warn("DATABASE_URL does not declare connection_limit. Start around 10-20 connections for one small-studio server.");
else if (connectionLimit < 5) console.warn(`connection_limit=${connectionLimit} may be too small under collaboration and upload load.`);
else if (connectionLimit > 30) console.warn(`connection_limit=${connectionLimit} is unusually high for one Cluster process.`);
if (!poolTimeout) console.warn("DATABASE_URL does not declare pool_timeout.");
if (!connectTimeout) console.warn("DATABASE_URL does not declare connect_timeout.");

for (const action of ["validate", "generate", "status"]) {
  const result = await run(process.execPath, [commandScript, action], env, root);
  if (!result.ok) process.exit(1);
}

const client = new Client({
  connectionString: driverConnectionString(config.databaseUrl),
  connectionTimeoutMillis: Math.max(1, connectTimeout || 10) * 1000,
});
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT
      current_setting('server_version') AS version,
      current_setting('server_version_num')::int AS version_num,
      current_setting('TimeZone') AS timezone,
      current_setting('max_connections')::int AS max_connections,
      current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout,
      current_setting('statement_timeout') AS statement_timeout,
      current_setting('lock_timeout') AS lock_timeout,
      current_schema() AS schema,
      pg_is_in_recovery() AS in_recovery,
      has_schema_privilege(current_user,current_schema(),'USAGE') AS schema_usage,
      has_schema_privilege(current_user,current_schema(),'CREATE') AS schema_create
  `);
  const row = rows[0] || {};
  const activity = (await client.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE state='active')::int AS active,
      count(*) FILTER (WHERE state='idle in transaction')::int AS idle_in_transaction,
      count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waits
    FROM pg_stat_activity
    WHERE datname=current_database()
  `)).rows[0] || {};
  console.log("Database connection succeeded.");
  console.log(JSON.stringify({ ...row, connections: activity }, null, 2));
  if (Number(row.version_num || 0) < 150000) throw new Error("Cluster requires PostgreSQL 15 or newer.");
  if (row.in_recovery) throw new Error("Cluster must connect to a writable PostgreSQL primary.");
  if (!row.schema_usage || !row.schema_create) throw new Error("The PostgreSQL user requires USAGE and CREATE privileges on the active schema.");
  if (String(row.timezone || "").toUpperCase() !== "UTC") console.warn("PostgreSQL timezone is not UTC. UTC is recommended.");
  if (String(row.idle_transaction_timeout || "0") === "0") console.warn("idle_in_transaction_session_timeout is disabled.");
  if (Number(activity.idle_in_transaction || 0) > 0) console.warn("Idle-in-transaction sessions are present.");
  if (Number(activity.lock_waits || 0) > 0) console.warn("PostgreSQL currently has lock waits.");
  const migrations = (await client.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,
      count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS failed
    FROM "_prisma_migrations"
  `)).rows[0] || {};
  console.log("Prisma migration ledger:", JSON.stringify(migrations));
  if (Number(migrations.total || 0) < 1) throw new Error("No applied Cluster migration was found.");
  if (Number(migrations.unfinished || 0) > 0 || Number(migrations.failed || 0) > 0) throw new Error("Prisma migration ledger contains unfinished or failed migrations.");
} finally {
  await client.end().catch(() => {});
}

const pgDump = await run(process.platform === "win32" ? "where" : "which", ["pg_dump"], env, root);
const pgRestore = await run(process.platform === "win32" ? "where" : "which", ["pg_restore"], env, root);
if (!pgDump.ok || !pgRestore.ok) console.warn("pg_dump/pg_restore are unavailable. Scheduled database backups require PostgreSQL client tools.");
else console.log("PostgreSQL backup tools are available.");
console.log("Cluster PostgreSQL doctor passed.");

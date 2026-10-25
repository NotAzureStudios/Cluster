import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPortable } from "./command-invocation.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../..");

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) {
      result.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result.set(key, next);
      index += 1;
    } else {
      result.set(key, true);
    }
  }
  return result;
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

function databaseIdentity(value) {
  const url = new URL(value);
  return {
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

function sameDatabase(left, right) {
  const a = databaseIdentity(left);
  const b = databaseIdentity(right);
  return a.hostname === b.hostname && a.port === b.port && a.database === b.database;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnPortable(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function requireTool(name) {
  await run(name, ["--version"], { capture: true });
}

async function tableNames(databaseUrl) {
  const sql = `SELECT quote_ident(table_schema) || '.' || quote_ident(table_name)
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;`;
  const result = await run("psql", ["--dbname", databaseUrl, "--no-psqlrc", "--tuples-only", "--no-align", "--command", sql], { capture: true });
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function tableCounts(databaseUrl) {
  const names = await tableNames(databaseUrl);
  if (!names.length) return {};
  const union = names.map((name) => `SELECT ${sqlLiteral(name)} AS name, count(*)::bigint AS count FROM ${name}`).join(" UNION ALL ");
  const result = await run("psql", ["--dbname", databaseUrl, "--no-psqlrc", "--tuples-only", "--no-align", "--field-separator", "\t", "--command", `${union} ORDER BY name;`], { capture: true });
  const counts = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.lastIndexOf("\t");
    if (separator < 0) continue;
    counts[line.slice(0, separator)] = Number(line.slice(separator + 1));
  }
  return counts;
}

const args = parseArgs(process.argv.slice(2));
const sourceUrl = String(args.get("source") || process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const restoreUrl = String(args.get("restore-target") || process.env.POSTGRES_RESTORE_DATABASE_URL || "").trim();
if (!/^postgres(?:ql)?:\/\//i.test(sourceUrl)) throw new Error("Set a PostgreSQL source with --source or POSTGRES_DATABASE_URL.");
if (!/^postgres(?:ql)?:\/\//i.test(restoreUrl)) throw new Error("Set an isolated restore database with --restore-target or POSTGRES_RESTORE_DATABASE_URL.");
if (sameDatabase(sourceUrl, restoreUrl)) throw new Error("The restore target must not be the source database.");
const restoreIdentity = databaseIdentity(restoreUrl);
if (!args.has("allow-unsafe-name") && !/(?:drill|restore|test|staging|scratch|tmp)/i.test(restoreIdentity.database)) {
  throw new Error(`Restore database name ${restoreIdentity.database || "(empty)"} does not look isolated. Use a name containing drill, restore, test, staging, scratch, or tmp.`);
}

await Promise.all([requireTool("psql"), requireTool("pg_dump"), requireTool("pg_restore")]);
const targetBefore = await tableCounts(restoreUrl);
if (Object.keys(targetBefore).length && !args.has("allow-non-empty")) {
  throw new Error(`Restore target is not empty (${Object.keys(targetBefore).length} tables). Use a disposable empty database or explicitly pass --allow-non-empty.`);
}

const startedAt = new Date();
const drillDirectory = path.join(ROOT, "data", "system", "backups", "drills");
await fs.mkdir(drillDirectory, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const dumpPath = path.resolve(String(args.get("output") || path.join(drillDirectory, `cluster-postgresql-drill-${stamp}.dump`)));
const reportPath = path.join(ROOT, "data", "system", "runtime", "quality-reports", `postgresql-backup-restore-drill-${stamp}.json`);
await fs.mkdir(path.dirname(reportPath), { recursive: true });

console.log(`Source: ${redactUrl(sourceUrl)}`);
console.log(`Restore target: ${redactUrl(restoreUrl)}`);
console.log(`Creating custom-format dump: ${dumpPath}`);
await run("pg_dump", ["--dbname", sourceUrl, "--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", dumpPath]);
const dumpStat = await fs.stat(dumpPath);
if (dumpStat.size <= 0) throw new Error("pg_dump produced an empty file.");
await run("pg_restore", ["--list", dumpPath], { capture: true });

console.log("Restoring into the isolated drill database...");
await run("pg_restore", [
  "--dbname", restoreUrl,
  "--exit-on-error",
  "--no-owner",
  "--no-privileges",
  ...(Object.keys(targetBefore).length ? ["--clean", "--if-exists"] : []),
  dumpPath,
]);

console.log("Comparing exact table row counts...");
const [sourceCounts, restoredCounts] = await Promise.all([tableCounts(sourceUrl), tableCounts(restoreUrl)]);
const names = [...new Set([...Object.keys(sourceCounts), ...Object.keys(restoredCounts)])].sort();
const tableResults = names.map((name) => ({
  table: name,
  sourceRows: sourceCounts[name] ?? null,
  restoredRows: restoredCounts[name] ?? null,
  matches: sourceCounts[name] === restoredCounts[name],
}));
const passed = tableResults.length > 0 && tableResults.every((item) => item.matches);
const report = {
  schemaVersion: 1,
  tool: "cluster-postgresql-backup-restore-drill",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  source: redactUrl(sourceUrl),
  restoreTarget: redactUrl(restoreUrl),
  dumpPath,
  dumpBytes: dumpStat.size,
  tables: tableResults,
  summary: {
    sourceTables: Object.keys(sourceCounts).length,
    restoredTables: Object.keys(restoredCounts).length,
    sourceRows: Object.values(sourceCounts).reduce((total, value) => total + value, 0),
    restoredRows: Object.values(restoredCounts).reduce((total, value) => total + value, 0),
    mismatches: tableResults.filter((item) => !item.matches).length,
  },
  passed,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Tables: ${report.summary.sourceTables}; rows: ${report.summary.sourceRows}; mismatches: ${report.summary.mismatches}`);
console.log(`Result: ${passed ? "PASS" : "FAIL"}`);
console.log(`Report: ${reportPath}`);
if (!args.has("keep-dump") && passed) {
  await fs.rm(dumpPath, { force: true });
  console.log("Removed temporary drill dump. Pass --keep-dump to retain it.");
}
if (!passed) process.exitCode = 1;

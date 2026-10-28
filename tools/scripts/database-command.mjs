import fs from "node:fs/promises";
import path from "node:path";
import { spawnPortable } from "./command-invocation.mjs";
import { loadDatabaseConfiguration, resolveClusterRoot } from "./database-config.mjs";
import { recoverRc3MeetingOccurrenceMigration } from "./migration-recovery.mjs";

const root = await resolveClusterRoot();
const action = process.argv[2] || "deploy";
const config = await loadDatabaseConfiguration(root);
const env = {
  ...process.env,
  DATABASE_URL: config.databaseUrl,
  DIRECT_DATABASE_URL: config.directUrl,
};
const portable = config.schemaPath.includes(`${path.sep}app${path.sep}db${path.sep}`);
const prismaModulesRoot = portable ? path.join(root, "app", "node_modules") : path.join(root, "node_modules");
const prismaCli = path.join(prismaModulesRoot, "prisma", "build", "index.js");
const prismaArgs = ["--config", config.configPath];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnPortable(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal ?? "unknown"}`)));
  });
}

async function requireMigrationHistory() {
  const migrationsDirectory = path.join(path.dirname(config.schemaPath), "migrations");
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true }).catch(() => []);
  const migrations = entries.filter((entry) => entry.isDirectory() && /^\d/.test(entry.name));
  if (!migrations.length) throw new Error("Cluster PostgreSQL migration history is missing from the release.");
}

console.log("Cluster database provider: postgresql");
console.log(`Database: ${config.redactedUrl}`);

try {
  if (action === "generate") {
    await run(process.execPath, [prismaCli, "generate", ...prismaArgs]);
  } else if (action === "validate") {
    await run(process.execPath, [prismaCli, "validate", ...prismaArgs]);
  } else if (action === "status") {
    await requireMigrationHistory();
    await run(process.execPath, [prismaCli, "migrate", "status", ...prismaArgs]);
  } else if (action === "doctor") {
    await requireMigrationHistory();
    console.log("Database doctor: validating Prisma schema...");
    await run(process.execPath, [prismaCli, "validate", ...prismaArgs]);
    console.log("Database doctor: checking PostgreSQL migration state...");
    await run(process.execPath, [prismaCli, "migrate", "status", ...prismaArgs]);
    console.log("Database doctor: healthy");
  } else if (action === "studio") {
    await run(process.execPath, [prismaCli, "studio", ...prismaArgs]);
  } else if (["deploy", "release"].includes(action)) {
    await requireMigrationHistory();
    // RC3 could leave a half-applied migration after the 63-byte PostgreSQL
    // index collision. Recover only that known empty-table failure; never
    // broadly reset migrations or drop user data.
    await recoverRc3MeetingOccurrenceMigration({
      root, config,
      resolveRolledBack: () => run(process.execPath, [prismaCli, "migrate", "resolve", "--rolled-back",
        "20261021230000_td6_g21_calendar_meeting_occurrence_responses", ...prismaArgs]),
    });
    await run(process.execPath, [prismaCli, "migrate", "deploy", ...prismaArgs]);
  } else {
    throw new Error(`Unknown database action: ${action}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

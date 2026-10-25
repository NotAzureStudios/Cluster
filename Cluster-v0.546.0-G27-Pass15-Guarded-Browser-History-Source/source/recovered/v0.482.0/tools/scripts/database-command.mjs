import fs from "node:fs/promises";
import path from "node:path";
import { spawnPortable } from "./command-invocation.mjs";
import { loadDatabaseConfiguration, resolveClusterRoot } from "./database-config.mjs";

const root = await resolveClusterRoot();
const action = process.argv[2] || "deploy";
const config = await loadDatabaseConfiguration(root);
const env = {
  ...process.env,
  DATABASE_URL: config.databaseUrl,
  DIRECT_DATABASE_URL: config.directUrl,
};
const prismaArgs = ["--config", path.join(root, "prisma.config.ts")];

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
    await run("npx", ["prisma", "generate", ...prismaArgs]);
  } else if (action === "validate") {
    await run("npx", ["prisma", "validate", ...prismaArgs]);
  } else if (action === "status") {
    await requireMigrationHistory();
    await run("npx", ["prisma", "migrate", "status", ...prismaArgs]);
  } else if (action === "studio") {
    await run("npx", ["prisma", "studio", ...prismaArgs]);
  } else if (["deploy", "release"].includes(action)) {
    await requireMigrationHistory();
    await run("npx", ["prisma", "migrate", "deploy", ...prismaArgs]);
  } else {
    throw new Error(`Unknown database action: ${action}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

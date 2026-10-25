import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function resolveClusterRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  while (true) {
    try {
      await fs.access(path.join(current, "package.json"));
      await fs.access(path.join(current, "apps", "server", "prisma", "schema.prisma"));
      return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate the Cluster repository root.");
    current = parent;
  }
}

export function parseEnv(content) {
  const values = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export function requirePostgresqlUrl(databaseUrl) {
  const normalized = String(databaseUrl || "").trim().toLowerCase();
  if (normalized.startsWith("postgresql://") || normalized.startsWith("postgres://")) return databaseUrl;
  throw new Error("Cluster Server requires PostgreSQL. Configure DATABASE_URL before starting the server.");
}

export function redactDatabaseUrl(databaseUrl) {
  const raw = String(databaseUrl || "");
  if (!raw) return "not configured";
  try {
    const parsed = new URL(raw);
    if (parsed.username) parsed.username = `${parsed.username.slice(0, 1)}…`;
    if (parsed.password) parsed.password = "[REDACTED]";
    return parsed.toString();
  } catch {
    return "[REDACTED DATABASE URL]";
  }
}

export async function loadDatabaseConfiguration(rootDirectory = process.cwd(), overrides = {}) {
  rootDirectory = await resolveClusterRoot(rootDirectory);
  const envPath = path.join(rootDirectory, "apps", "server", ".env");
  let fileValues = {};
  try { fileValues = parseEnv(await fs.readFile(envPath, "utf8")); } catch {}
  const databaseUrl = overrides.databaseUrl || process.env.DATABASE_URL || fileValues.DATABASE_URL || "";
  requirePostgresqlUrl(databaseUrl);
  const directUrl = process.env.DIRECT_DATABASE_URL || fileValues.DIRECT_DATABASE_URL || databaseUrl;
  return {
    provider: "postgresql",
    databaseUrl,
    directUrl,
    envPath,
    schemaPath: path.join(rootDirectory, "apps", "server", "prisma", "schema.prisma"),
    redactedUrl: redactDatabaseUrl(databaseUrl),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  const config = await loadDatabaseConfiguration();
  console.log(JSON.stringify(config, null, 2));
}

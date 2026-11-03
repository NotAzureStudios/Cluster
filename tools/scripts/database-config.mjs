import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_SCHEMA = path.join("apps", "server", "prisma", "schema.prisma");
const PORTABLE_SCHEMA = path.join("app", "db", "schema.prisma");
const BOOTSTRAP_SCHEMA = path.join("app", "bootstrap", "apps", "server", "prisma", "schema.prisma");

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function resolveClusterRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory);
  while (true) {
    const packageFile = path.join(current, "package.json");
    const releaseFile = path.join(current, "CLUSTER_RELEASE.json");
    const sourceSchema = path.join(current, SOURCE_SCHEMA);
    const portableSchema = path.join(current, PORTABLE_SCHEMA);
    const bootstrapSchema = path.join(current, BOOTSTRAP_SCHEMA);
    if ((await exists(packageFile)) && (await exists(sourceSchema))) return current;
    if ((await exists(releaseFile)) && ((await exists(portableSchema)) || (await exists(bootstrapSchema)))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not locate the Cluster root.");
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
    // Connection strings may carry credentials in query parameters too.
    // Only expose the known non-secret connection settings in diagnostics.
    const publicQueryOptions = new Set(["schema", "sslmode", "connect_timeout", "connection_limit", "pgbouncer"]);
    for (const key of parsed.searchParams.keys()) {
      if (!publicQueryOptions.has(key.toLowerCase())) parsed.searchParams.set(key, "[REDACTED]");
    }
    return parsed.toString();
  } catch {
    return "[REDACTED DATABASE URL]";
  }
}

async function readPortableBootSettings(rootDirectory) {
  const configPath = path.resolve(process.env.CLUSTER_CONFIG_FILE || path.join(rootDirectory, "cluster.config.json"));
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    const settings = parsed?.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;
    return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  } catch {
    return {};
  }
}

function resolvePortableDomain(dataRoot, configured, fallback) {
  const value = String(configured || "").trim();
  if (!value) return path.join(dataRoot, fallback);
  return path.resolve(path.isAbsolute(value) ? value : path.join(dataRoot, value));
}

export async function loadDatabaseConfiguration(rootDirectory = process.cwd(), overrides = {}) {
  rootDirectory = await resolveClusterRoot(rootDirectory);
  const packaged = await exists(path.join(rootDirectory, "CLUSTER_RELEASE.json"));
  const portableSchemaExists = await exists(path.join(rootDirectory, PORTABLE_SCHEMA));
  const bootstrapSchemaExists = await exists(path.join(rootDirectory, BOOTSTRAP_SCHEMA));
  const bootSettings = packaged ? await readPortableBootSettings(rootDirectory) : {};
  const dataRoot = packaged
    ? path.resolve(process.env.CLUSTER_DATA_DIR || bootSettings.dataRootOverride || path.join(rootDirectory, "data"))
    : null;
  const runtimeRoot = packaged ? resolvePortableDomain(dataRoot, bootSettings.runtimeRootOverride, "Runtime") : null;
  const envPath = packaged
    ? path.join(runtimeRoot, "server.env")
    : path.join(rootDirectory, "apps", "server", ".env");
  let fileValues = {};
  try { fileValues = parseEnv(await fs.readFile(envPath, "utf8")); } catch {}
  // The Windows managed source-layout launcher writes its generated, private
  // PostgreSQL URL to apps/server/.env. Portable app/db deployments use
  // data/Runtime/server.env instead. The read-only database CLI needs to
  // support BOTH without inventing credentials or connecting to an unknown DB.
  // Require the installer ownership marker before reading the managed fallback.
  let resolvedEnvPath = envPath;
  const managedSourceEnv = path.join(rootDirectory, "apps", "server", ".env");
  if (packaged && await exists(path.join(rootDirectory, ".cluster-installer-managed.json")) &&
      !(fileValues.DATABASE_URL || fileValues.DIRECT_DATABASE_URL) &&
      await exists(path.join(rootDirectory, SOURCE_SCHEMA))) {
    try {
      const managedValues = parseEnv(await fs.readFile(managedSourceEnv, "utf8"));
      if (managedValues.DATABASE_URL || managedValues.DIRECT_DATABASE_URL) {
        fileValues = managedValues;
        resolvedEnvPath = managedSourceEnv;
      }
    } catch {}
  }
  const databaseUrl = overrides.databaseUrl || process.env.DATABASE_URL || fileValues.DATABASE_URL || "";
  requirePostgresqlUrl(databaseUrl);
  const directUrl = process.env.DIRECT_DATABASE_URL || fileValues.DIRECT_DATABASE_URL || databaseUrl;
  requirePostgresqlUrl(directUrl);
  return {
    provider: "postgresql",
    databaseUrl,
    directUrl,
    envPath: resolvedEnvPath,
    portable: packaged,
    schemaPath: path.join(rootDirectory, portableSchemaExists ? PORTABLE_SCHEMA : packaged && bootstrapSchemaExists ? BOOTSTRAP_SCHEMA : SOURCE_SCHEMA),
    configPath: portableSchemaExists
      ? path.join("app", "db", "prisma.config.ts")
      : packaged && bootstrapSchemaExists
        ? path.join("app", "bootstrap", "prisma.config.ts")
        : "prisma.config.ts",
    redactedUrl: redactDatabaseUrl(databaseUrl),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  const config = await loadDatabaseConfiguration();
  // Never dump the operational connection strings, including credential-bearing
  // query parameters, into shell output or persisted diagnostic logs.
  console.log(JSON.stringify({
    provider: config.provider,
    portable: config.portable,
    schemaPath: config.schemaPath,
    configPath: config.configPath,
    databaseUrl: redactDatabaseUrl(config.databaseUrl),
    directUrl: redactDatabaseUrl(config.directUrl),
  }, null, 2));
}

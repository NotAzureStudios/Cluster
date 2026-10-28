import { createReadStream } from "node:fs";
import { chmod } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { throwIfAborted, OperationCancelledError } from "./operation-cancellation.js";
import { runManagedSubprocess } from "./managed-subprocess.js";

export type DatabaseBackupResult = {
  provider: "postgresql";
  path: string;
  integrity: { ok: boolean; detail: unknown };
};

const BACKUP_COMMAND_TIMEOUT_MS = 30 * 60_000;
const MAX_BACKUP_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;

function run(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  return runManagedSubprocess({ command, args, env, signal,
    timeoutMs: BACKUP_COMMAND_TIMEOUT_MS, maxOutputBytes: MAX_BACKUP_COMMAND_OUTPUT_BYTES });
}

function postgresEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("Cluster backups require a PostgreSQL DATABASE_URL.");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || process.env.PGSSLMODE,
  };
}

export async function sha256File(filePath: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      if (signal?.aborted) {
        stream.destroy(signal.reason instanceof Error ? signal.reason : new OperationCancelledError());
        return;
      }
      hash.update(chunk);
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function createDatabaseBackup(input: {
  prisma?: unknown;
  databaseUrl: string;
  destinationBase: string;
  signal?: AbortSignal;
}): Promise<DatabaseBackupResult> {
  const dumpPath = `${input.destinationBase}.dump`;
  const partialPath = `${dumpPath}.partial-${process.pid}-${Date.now()}`;
  const environment = postgresEnvironment(input.databaseUrl);
  try {
    throwIfAborted(input.signal);
    await run("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", partialPath], environment, input.signal);
    await chmod(partialPath, 0o600).catch(() => undefined);
    await (await import("node:fs/promises")).rename(partialPath, dumpPath);
    await chmod(dumpPath, 0o600).catch(() => undefined);
  } catch (error) {
    await (await import("node:fs/promises")).rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
  throwIfAborted(input.signal);
  const verification = await run("pg_restore", ["--list", dumpPath], environment, input.signal);
  const ok = verification.stdout.includes("TABLE DATA") || verification.stdout.includes("DATABASE") || verification.stdout.includes("TABLE");
  if (!ok) throw new Error("pg_restore could not verify the generated PostgreSQL backup.");
  return { provider: "postgresql", path: dumpPath, integrity: { ok: true, detail: "pg_restore --list passed" } };
}

export async function verifyDatabaseBackup(filePath: string, provider: "postgresql", databaseUrl: string, signal?: AbortSignal) {
  if (provider !== "postgresql" || path.extname(filePath).toLowerCase() !== ".dump") return { ok: false, result: "Expected a PostgreSQL custom-format .dump backup." };
  throwIfAborted(signal);
  const verification = await run("pg_restore", ["--list", filePath], postgresEnvironment(databaseUrl), signal);
  return { ok: verification.stdout.length > 0, result: "pg_restore --list passed" };
}

export function backupProviderFromPath(filePath: string): "postgresql" {
  if (path.extname(filePath).toLowerCase() !== ".dump") throw new Error("Cluster Server only accepts PostgreSQL .dump backup artifacts.");
  return "postgresql";
}

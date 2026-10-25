import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OperationCancelledError, throwIfAborted } from "./operation-cancellation.js";

export type DatabaseBackupResult = {
  provider: "postgresql";
  path: string;
  integrity: { ok: boolean; detail: unknown };
};

const BACKUP_COMMAND_TIMEOUT_MS = 30 * 60_000;
const MAX_BACKUP_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;

function run(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) {
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
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${command} exceeded the ${BACKUP_COMMAND_TIMEOUT_MS} ms backup timeout.`)));
    }, BACKUP_COMMAND_TIMEOUT_MS);
    timer.unref?.();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const append = (target: "stdout" | "stderr", chunk: unknown) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > MAX_BACKUP_COMMAND_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error(`${command} produced too much backup output.`)));
        return;
      }
      if (target === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new OperationCancelledError(`${command} was cancelled.`));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim().slice(0, 2000)}`));
    }));
  });
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

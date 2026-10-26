type DatabaseLockTransaction = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type DatabaseLockClient = {
  $transaction<T>(
    operation: (transaction: DatabaseLockTransaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

type DatabaseLockLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

export type DatabaseBootstrapLockOptions = {
  timeoutMs?: number;
  retryMs?: number;
  operationTimeoutMs?: number;
  logger?: DatabaseLockLogger;
};

const CLUSTER_LOCK_NAMESPACE = 0x434c5553;
const CLUSTER_BOOTSTRAP_LOCK = 0x54455231;
const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

function firstBoolean(rows: unknown) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return false;
  const value = Object.values(row as Record<string, unknown>)[0];
  return value === true || value === 1 || value === "1" || value === "t";
}

function bootstrapLockTimeoutError(timeoutMs: number, attempts: number) {
  const error = new Error(`Another Cluster server is preparing this PostgreSQL database. The bootstrap lock was not available after ${timeoutMs} ms.`) as Error & { code?: string; attempts?: number };
  error.code = "DATABASE_BOOTSTRAP_LOCK_TIMEOUT";
  error.attempts = attempts;
  return error;
}

export async function withDatabaseBootstrapLock<T>(
  prisma: DatabaseLockClient,
  databaseUrl: string,
  operation: () => Promise<T>,
  options: DatabaseBootstrapLockOptions = {},
): Promise<T> {
  if (!/^postgres(?:ql)?:\/\//i.test(String(databaseUrl || ""))) throw new Error("Cluster Server requires PostgreSQL before database bootstrap can begin.");
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 60_000);
  const retryMs = Math.max(100, Math.min(options.retryMs ?? 500, 5_000));
  const operationTimeoutMs = Math.max(timeoutMs + 60_000, options.operationTimeoutMs ?? 15 * 60_000);
  const startedAt = Date.now();
  let attempts = 0;
  try {
    return await prisma.$transaction(async (transaction) => {
      while (Date.now() - startedAt < timeoutMs) {
        attempts += 1;
        const rows = await transaction.$queryRawUnsafe("SELECT pg_try_advisory_xact_lock($1::integer, $2::integer) AS locked", CLUSTER_LOCK_NAMESPACE, CLUSTER_BOOTSTRAP_LOCK);
        if (firstBoolean(rows)) {
          options.logger?.info?.({ attempts, waitedMs: Date.now() - startedAt, provider: "postgresql" }, "Cluster acquired the database bootstrap lock");
          return operation();
        }
        await sleep(retryMs);
      }
      throw bootstrapLockTimeoutError(timeoutMs, attempts);
    }, { maxWait: timeoutMs, timeout: operationTimeoutMs });
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === "DATABASE_BOOTSTRAP_LOCK_TIMEOUT") {
      options.logger?.warn?.({ attempts, timeoutMs }, "Cluster database bootstrap lock timed out");
    }
    throw error;
  }
}

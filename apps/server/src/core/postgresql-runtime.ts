type PrismaRawClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type Logger = {
  info(data: unknown, message?: string): void;
  warn(data: unknown, message?: string): void;
};

export async function configurePostgresqlRuntime(prisma: PrismaRawClient, databaseUrl: string, logger: Logger) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(databaseUrl || ""))) {
    throw new Error("Cluster Server requires a PostgreSQL DATABASE_URL.");
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ version_num: number; timezone: string; recovery: boolean }>>(
    "SELECT current_setting('server_version_num')::int AS version_num, current_setting('TimeZone') AS timezone, pg_is_in_recovery() AS recovery",
  );
  const runtime = rows?.[0];
  const versionNumber = Number(runtime?.version_num || 0);
  if (versionNumber < 180000) {
    throw new Error(`PostgreSQL 18 or newer is required. Detected server_version_num=${versionNumber || "unknown"}.`);
  }
  if (runtime?.recovery) {
    logger.warn({ provider: "postgresql", versionNumber }, "Cluster refused to start against a PostgreSQL recovery replica");
    throw new Error("Cluster Server requires a writable PostgreSQL primary. The configured database is currently in recovery/read-only replica mode.");
  }
  logger.info({ provider: "postgresql", versionNumber, timezone: runtime?.timezone || "unknown" }, "PostgreSQL runtime verified");
  return { applied: true, provider: "postgresql" as const, versionNumber, timezone: runtime?.timezone || "unknown", recovery: Boolean(runtime?.recovery) };
}

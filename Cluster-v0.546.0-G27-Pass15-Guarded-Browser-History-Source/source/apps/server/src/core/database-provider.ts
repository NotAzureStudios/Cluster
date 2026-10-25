export type ClusterDatabaseProvider = "postgresql";

export function databaseProviderFromUrl(databaseUrl: string | null | undefined): ClusterDatabaseProvider {
  const normalized = String(databaseUrl || "").trim().toLowerCase();
  if (normalized.startsWith("postgresql://") || normalized.startsWith("postgres://")) return "postgresql";
  throw new Error("Cluster Server requires PostgreSQL. DATABASE_URL must begin with postgresql:// or postgres://.");
}

export function redactDatabaseUrl(databaseUrl: string | null | undefined) {
  const raw = String(databaseUrl || "");
  if (!raw) return "not configured";
  try {
    const url = new URL(raw);
    if (url.password) url.password = "[REDACTED]";
    if (url.username) url.username = `${url.username.slice(0, 1)}…`;
    return url.toString();
  } catch {
    return "[REDACTED DATABASE URL]";
  }
}

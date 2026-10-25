import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { databaseResourceBudget } from "./database-resource-budget.js";

export { PrismaClient };

type GeneratedClientOptions = NonNullable<ConstructorParameters<typeof PrismaClient>[0]>;
type DirectClientOptions = Extract<GeneratedClientOptions, { adapter: unknown }>;
type ClientOptions = Omit<DirectClientOptions, "adapter">;

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function postgresPoolConfiguration() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) throw new Error("DATABASE_URL is required before Prisma Client can start.");
  const url = new URL(raw);
  const budget = databaseResourceBudget(raw);
  const max = budget.apiPoolMax;
  const connectSeconds = positiveInteger(url.searchParams.get("connect_timeout"), 10);
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("pool_timeout");
  url.searchParams.delete("connect_timeout");
  if (!url.searchParams.has("application_name")) url.searchParams.set("application_name", `cluster-api-${process.pid}`);
  return {
    connectionString: url.toString(),
    max,
    connectionTimeoutMillis: connectSeconds * 1000,
    idleTimeoutMillis: budget.poolMode === "transaction" ? 2_000 : 10_000,
  };
}

export function createPrismaClient(options: ClientOptions = {}) {
  const adapter = new PrismaPg(postgresPoolConfiguration());
  const clientOptions: DirectClientOptions = { ...options, adapter };
  return new PrismaClient(clientOptions);
}

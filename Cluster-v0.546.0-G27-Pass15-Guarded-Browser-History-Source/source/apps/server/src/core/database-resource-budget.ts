import { availableParallelism } from "node:os";

function positiveInteger(value: unknown, fallback: number) {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type DatabaseResourceBudget = {
  globalBudget: number;
  reservedConnections: number;
  expectedApiNodes: number;
  apiPoolMax: number;
  coordinationConnectionsPerNode: number;
  poolMode: "session" | "transaction";
};

export function databaseResourceBudget(databaseUrl: string): DatabaseResourceBudget {
  const url = new URL(databaseUrl);
  const explicitUrlLimit = positiveInteger(url.searchParams.get("connection_limit"), 0);
  const cpuDefault = Math.max(4, Math.min(24, availableParallelism()));
  const globalBudget = positiveInteger(process.env.CLUSTER_DB_CONNECTION_BUDGET, 100);
  const expectedApiNodes = positiveInteger(process.env.CLUSTER_DB_EXPECTED_API_NODES, 1);
  const reservedConnections = Math.min(globalBudget - 1, positiveInteger(process.env.CLUSTER_DB_RESERVED_CONNECTIONS, 12));
  const coordinationConnectionsPerNode = 1;
  // Every API node needs a coordination session and at least one application
  // session. Never declare an impossible cluster budget to be valid by
  // forcing a two-connection pool or honoring an oversized URL override.
  const allocatable = globalBudget - reservedConnections - expectedApiNodes * coordinationConnectionsPerNode;
  if (allocatable < expectedApiNodes) {
    throw new Error("Cluster database connection budget cannot support the configured reserved connections and API nodes. Increase CLUSTER_DB_CONNECTION_BUDGET or reduce reservations/nodes.");
  }
  const fairShare = Math.floor(allocatable / expectedApiNodes);
  const requestedPool = explicitUrlLimit || cpuDefault;
  const apiPoolMax = Math.min(requestedPool, fairShare);
  const poolMode = String(process.env.CLUSTER_DB_POOL_MODE || "session").toLowerCase() === "transaction" ? "transaction" : "session";
  return { globalBudget, reservedConnections, expectedApiNodes, apiPoolMax, coordinationConnectionsPerNode, poolMode };
}

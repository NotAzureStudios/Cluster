export type ApiReadBudget = {
  maxQueries: number;
  maxDatabaseMs: number;
  maxSlowQueries: number;
  maxPayloadBytes: number;
};

export type ApiReadContract = {
  id: string;
  method: "GET";
  route: string;
  cache: "no-store" | "private-revalidate";
  budget: ApiReadBudget;
};

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * Canonical budgets for task-oriented read projections. These are telemetry
 * guardrails, not arbitrary request killers: production records violations,
 * while tests/benchmarks can make them release gates.
 */
export const API_READ_CONTRACTS = Object.freeze([
  { id: "projects.list", method: "GET", route: "/api/projects", cache: "private-revalidate", budget: { maxQueries: 40, maxDatabaseMs: 400, maxSlowQueries: 1, maxPayloadBytes: 2 * MIB } },
  { id: "projects.types", method: "GET", route: "/api/project-types", cache: "private-revalidate", budget: { maxQueries: 4, maxDatabaseMs: 150, maxSlowQueries: 1, maxPayloadBytes: 256 * KIB } },
  { id: "whiteboards.list", method: "GET", route: "/api/whiteboards", cache: "private-revalidate", budget: { maxQueries: 30, maxDatabaseMs: 350, maxSlowQueries: 1, maxPayloadBytes: 512 * KIB } },
  { id: "project.overview", method: "GET", route: "/api/projects/:projectId/overview", cache: "no-store", budget: { maxQueries: 40, maxDatabaseMs: 1_000, maxSlowQueries: 3, maxPayloadBytes: 1536 * KIB } },
  { id: "changes.poll", method: "GET", route: "/api/changes", cache: "no-store", budget: { maxQueries: 8, maxDatabaseMs: 350, maxSlowQueries: 2, maxPayloadBytes: 512 * KIB } },
  { id: "activity.list", method: "GET", route: "/api/activity", cache: "private-revalidate", budget: { maxQueries: 24, maxDatabaseMs: 450, maxSlowQueries: 2, maxPayloadBytes: 1024 * KIB } },
  { id: "notifications.summary", method: "GET", route: "/api/notifications/summary", cache: "private-revalidate", budget: { maxQueries: 28, maxDatabaseMs: 300, maxSlowQueries: 1, maxPayloadBytes: 256 * KIB } },
  { id: "search.command", method: "GET", route: "/api/command/search", cache: "no-store", budget: { maxQueries: 14, maxDatabaseMs: 500, maxSlowQueries: 2, maxPayloadBytes: 1024 * KIB } },
  { id: "library.workspace", method: "GET", route: "/api/library/workspace", cache: "private-revalidate", budget: { maxQueries: 56, maxDatabaseMs: 700, maxSlowQueries: 2, maxPayloadBytes: 4 * MIB } },
  { id: "library.summary", method: "GET", route: "/api/library/summary", cache: "private-revalidate", budget: { maxQueries: 34, maxDatabaseMs: 350, maxSlowQueries: 1, maxPayloadBytes: 512 * KIB } },
  { id: "jobs.metrics", method: "GET", route: "/api/admin/operations/jobs/metrics", cache: "no-store", budget: { maxQueries: 8, maxDatabaseMs: 300, maxSlowQueries: 1, maxPayloadBytes: 256 * KIB } },
] satisfies readonly ApiReadContract[]);

const BY_ROUTE = new Map(API_READ_CONTRACTS.map((contract) => [`${contract.method}:${contract.route}`, contract]));

export function apiReadContractFor(method: string, route: string | undefined | null): ApiReadContract | null {
  const key = `${String(method || "GET").toUpperCase()}:${String(route || "")}`;
  return BY_ROUTE.get(key) || null;
}

export function evaluateReadBudget(input: { queries: number; totalDurationMs: number; slowQueries: number }, contract: ApiReadContract) {
  const violations: string[] = [];
  if (input.queries > contract.budget.maxQueries) violations.push(`queries ${input.queries}/${contract.budget.maxQueries}`);
  if (input.totalDurationMs > contract.budget.maxDatabaseMs) violations.push(`databaseMs ${input.totalDurationMs.toFixed(2)}/${contract.budget.maxDatabaseMs}`);
  if (input.slowQueries > contract.budget.maxSlowQueries) violations.push(`slowQueries ${input.slowQueries}/${contract.budget.maxSlowQueries}`);
  return violations;
}

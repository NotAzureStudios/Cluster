export type PerformanceBudgetStatus = "pass" | "warn" | "fail" | "unknown";
export type PerformanceBudgetResult = {
  key: string;
  label: string;
  unit: string;
  target: number;
  warning: number;
  actual: number | null;
  direction: "max" | "min";
  status: PerformanceBudgetStatus;
  detail: string;
};

export const SERVER_PERFORMANCE_BUDGETS = Object.freeze({
  requestP95Ms: { target: 750, warning: 1_200 },
  requestP99Ms: { target: 1_500, warning: 2_500 },
  requestErrorRate: { target: 0.01, warning: 0.03 },
  eventLoopP95Ms: { target: 40, warning: 80 },
  rssMiB: { target: 768, warning: 1_024 },
  heapUtilization: { target: 0.80, warning: 0.90 },
  databaseP95Ms: { target: 100, warning: 250 },
  databaseP99Ms: { target: 250, warning: 600 },
  databaseFanoutP95: { target: 24, warning: 48 },
  databaseDuplicateFanoutP95: { target: 6, warning: 16 },
  postgresCacheHitRatio: { target: 0.95, warning: 0.90 },
  postgresIndexScanRatio: { target: 0.70, warning: 0.50 },
  postgresLockWaits: { target: 0, warning: 2 },
  postgresConnectionUtilization: { target: 0.70, warning: 0.85 },
  postgresTemporaryBytes: { target: 256 * 1024 * 1024, warning: 1024 * 1024 * 1024 },
  postgresDeadRowRatio: { target: 0.10, warning: 0.20 },
  deadLetterJobs: { target: 0, warning: 5 },
  accelerationCacheErrorRate: { target: 0.005, warning: 0.02 },
  accelerationBusErrors: { target: 0, warning: 3 },
  collaborationSlowDisconnects: { target: 0, warning: 3 },
});

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classify(actual: number | null, target: number, warning: number, direction: "max" | "min"): PerformanceBudgetStatus {
  if (actual == null) return "unknown";
  if (direction === "max") {
    if (actual <= target) return "pass";
    if (actual <= warning) return "warn";
    return "fail";
  }
  if (actual >= target) return "pass";
  if (actual >= warning) return "warn";
  return "fail";
}

function result(key: string, label: string, unit: string, actualValue: unknown, budget: { target: number; warning: number }, direction: "max" | "min", detail: string): PerformanceBudgetResult {
  const actual = finite(actualValue);
  return { key, label, unit, actual, target: budget.target, warning: budget.warning, direction, status: classify(actual, budget.target, budget.warning, direction), detail };
}

export function assessServerPerformance(input: { runtime?: any; databaseQueries?: any; postgres?: any; durableJobs?: any; acceleration?: any; collaboration?: any }) {
  const runtime = input.runtime || {};
  const database = input.databaseQueries || {};
  const postgres = input.postgres || {};
  const workload = postgres.workload || {};
  const liveRows = finite(workload.liveRows) || 0;
  const deadRows = finite(workload.deadRows) || 0;
  const deadRowRatio = liveRows + deadRows > 0 ? deadRows / (liveRows + deadRows) : null;
  const blockSamples = (finite(workload.blocksRead) || 0) + (finite(workload.blocksHit) || 0);
  const scanSamples = (finite(workload.sequentialScans) || 0) + (finite(workload.indexScans) || 0);
  const deadLetters = Number(input.durableJobs?.DEAD_LETTER ?? input.durableJobs?.deadLetter ?? input.durableJobs?.dead ?? 0);
  const accelerationCacheOps = (finite(input.acceleration?.cache?.hits) || 0) + (finite(input.acceleration?.cache?.misses) || 0) + (finite(input.acceleration?.cache?.writes) || 0);
  const accelerationCacheErrors = finite(input.acceleration?.cache?.errors) || 0;
  const accelerationCacheErrorRate = accelerationCacheOps > 0 ? accelerationCacheErrors / accelerationCacheOps : null;
  const heapUsed = finite(runtime.memory?.heapUsedMiB);
  const heapLimit = finite(runtime.memory?.heapLimitMiB);
  const heapUtilization = heapUsed != null && heapLimit ? heapUsed / heapLimit : null;
  const connectionTotal = finite(postgres.connections?.total);
  const connectionMax = finite(postgres.connections?.max);
  const connectionUtilization = connectionTotal != null && connectionMax ? connectionTotal / connectionMax : null;
  const checks = [
    result("request-p95", "API request p95", "ms", runtime.requests?.p95Ms, SERVER_PERFORMANCE_BUDGETS.requestP95Ms, "max", "Bounded server request latency."),
    result("request-p99", "API request p99", "ms", runtime.requests?.p99Ms, SERVER_PERFORMANCE_BUDGETS.requestP99Ms, "max", "Tail latency catches stalls hidden by averages."),
    result("request-error-rate", "Server error rate", "ratio", runtime.requests?.errorRate, SERVER_PERFORMANCE_BUDGETS.requestErrorRate, "max", "HTTP 5xx responses divided by completed requests."),
    result("event-loop-p95", "Event-loop delay p95", "ms", runtime.eventLoop?.p95Ms, SERVER_PERFORMANCE_BUDGETS.eventLoopP95Ms, "max", "Sustained delay indicates CPU or synchronous work pressure."),
    result("rss-memory", "Server RSS memory", "MiB", runtime.memory?.rssMiB, SERVER_PERFORMANCE_BUDGETS.rssMiB, "max", "Resident memory budget for the Node.js server process."),
    result("heap-utilization", "V8 heap utilization", "ratio", heapUtilization, SERVER_PERFORMANCE_BUDGETS.heapUtilization, "max", "Heap pressure before GC and allocation failures become operational risks."),
    result("database-p95", "Database query p95", "ms", database.p95Ms, SERVER_PERFORMANCE_BUDGETS.databaseP95Ms, "max", "Observed Prisma/database query latency."),
    result("database-p99", "Database query p99", "ms", database.p99Ms, SERVER_PERFORMANCE_BUDGETS.databaseP99Ms, "max", "Tail query latency for hot-path regression detection."),
    result("database-fanout-p95", "Database queries / request p95", "queries", database.fanout?.samples ? database.fanout?.p95Queries : null, SERVER_PERFORMANCE_BUDGETS.databaseFanoutP95, "max", "Request-level query fanout catches N+1 and repeated lookup regressions even when individual queries are fast."),
    result("database-duplicate-fanout-p95", "Duplicate database queries / request p95", "queries", database.fanout?.samples ? database.fanout?.p95DuplicateQueries : null, SERVER_PERFORMANCE_BUDGETS.databaseDuplicateFanoutP95, "max", "Repeated SQL fingerprints within one request expose avoidable lookups and N+1-style work."),
    result("postgres-cache-hit", "PostgreSQL cache hit", "ratio", blockSamples > 0 ? workload.cacheHitRatio : null, SERVER_PERFORMANCE_BUDGETS.postgresCacheHitRatio, "min", "Shared-buffer hit ratio for the current database."),
    result("postgres-index-scan", "PostgreSQL index scan ratio", "ratio", scanSamples > 0 ? workload.indexScanRatio : null, SERVER_PERFORMANCE_BUDGETS.postgresIndexScanRatio, "min", "Aggregate index scans relative to index + sequential scans."),
    result("postgres-lock-waits", "PostgreSQL lock waits", "connections", postgres.connections?.lockWaits, SERVER_PERFORMANCE_BUDGETS.postgresLockWaits, "max", "Current sessions waiting on PostgreSQL locks."),
    result("postgres-connection-utilization", "PostgreSQL connection utilization", "ratio", connectionUtilization, SERVER_PERFORMANCE_BUDGETS.postgresConnectionUtilization, "max", "Total connections relative to PostgreSQL max_connections."),
    result("postgres-temp-bytes", "PostgreSQL temporary spill", "bytes", workload.temporaryBytes, SERVER_PERFORMANCE_BUDGETS.postgresTemporaryBytes, "max", "Temporary-file spill can indicate memory-starved sorts or hashes."),
    result("postgres-dead-rows", "PostgreSQL dead-row ratio", "ratio", deadRowRatio, SERVER_PERFORMANCE_BUDGETS.postgresDeadRowRatio, "max", "Approximate dead tuples versus live + dead tuples."),
    result("dead-letter-jobs", "Dead-letter jobs", "jobs", deadLetters, SERVER_PERFORMANCE_BUDGETS.deadLetterJobs, "max", "Durable jobs that exhausted their retry budget."),
    result("acceleration-cache-errors", "Acceleration cache error rate", "ratio", accelerationCacheErrorRate, SERVER_PERFORMANCE_BUDGETS.accelerationCacheErrorRate, "max", "Redis/shared-cache failures should be rare; Cluster can fall back but repeated failures waste work."),
    result("acceleration-bus-errors", "Acceleration bus errors", "events", input.acceleration?.bus?.errors, SERVER_PERFORMANCE_BUDGETS.accelerationBusErrors, "max", "Errors publishing or decoding shared acceleration events."),
    result("collaboration-slow-disconnects", "Slow realtime client disconnects", "clients", input.collaboration?.slowClientDisconnects, SERVER_PERFORMANCE_BUDGETS.collaborationSlowDisconnects, "max", "Clients disconnected because their outgoing realtime buffer exceeded the safety bound."),
  ];
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failures ? "fail" : warnings ? "warn" : "pass",
    failures,
    warnings,
    checks,
  };
}

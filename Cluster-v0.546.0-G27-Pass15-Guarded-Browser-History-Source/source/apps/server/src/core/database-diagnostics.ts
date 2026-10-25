import { AsyncLocalStorage } from "node:async_hooks";

export type QueryDiagnostic = {
  label: string;
  route: string;
  durationMs: number;
  startedAt: string;
  success: boolean;
  detail?: string;
};

type RawPrisma = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<any>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<any>;
};

type RequestQueryFingerprint = {
  fingerprint: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type RequestQueryContext = {
  route: string;
  queries: number;
  totalDurationMs: number;
  slowQueries: number;
  maxQueryMs: number;
  queryFingerprints: Map<string, RequestQueryFingerprint>;
};

export type RequestQuerySample = Omit<RequestQueryContext, "queryFingerprints"> & {
  completedAt: string;
  uniqueQueries: number;
  duplicateQueries: number;
  duplicateFingerprints: RequestQueryFingerprint[];
};

type BudgetViolationSample = {
  contractId: string;
  route: string;
  kind: "query" | "payload";
  detail: string;
  observedAt: string;
};

const round = (value: number) => Number(value.toFixed(2));

function queryFingerprint(query: string) {
  return String(query || "query")
    .replace(/\s+/g, " ")
    .replace(/\$\d+/g, "$?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/'(?:''|[^'])*'/g, "'?'")
    .trim()
    .slice(0, 220);
}

export class DatabaseDiagnostics {
  private readonly samples: QueryDiagnostic[] = [];
  private readonly requestSamples: RequestQuerySample[] = [];
  private readonly activeRequests = new Map<string, RequestQueryContext>();
  private readonly budgetViolations: BudgetViolationSample[] = [];
  private slowCount = 0;
  private readonly routeContext = new AsyncLocalStorage<{ route: string; requestId?: string }>();
  private providerSnapshotCache: { expiresAt: number; value: any } | null = null;
  private providerSnapshotPending: Promise<any> | null = null;
  private readonly providerSnapshotTtlMs = Math.max(1_000, Number(process.env.CLUSTER_DATABASE_PROVIDER_CACHE_MS || 10_000));

  constructor(
    private readonly prisma: RawPrisma,
    private readonly databaseUrl: string,
    private readonly options: { maxSamples?: number; slowQueryMs?: number } = {},
  ) {}


  beginRequest(requestId: string, route: string) {
    const normalizedRoute = String(route || "unknown");
    this.activeRequests.set(requestId, { route: normalizedRoute, queries: 0, totalDurationMs: 0, slowQueries: 0, maxQueryMs: 0, queryFingerprints: new Map() });
    this.routeContext.enterWith({ route: normalizedRoute, requestId });
  }

  enterRoute(route: string) {
    this.routeContext.enterWith({ route });
  }

  completeRequest(requestId: string): RequestQuerySample | null {
    const current = this.activeRequests.get(requestId);
    if (!current) return null;
    this.activeRequests.delete(requestId);
    const duplicateFingerprints = [...current.queryFingerprints.values()]
      .filter((entry) => entry.count > 1)
      .map((entry) => ({ ...entry, totalDurationMs: round(entry.totalDurationMs), maxDurationMs: round(entry.maxDurationMs) }))
      .sort((left, right) => right.count - left.count || right.totalDurationMs - left.totalDurationMs)
      .slice(0, 8);
    const uniqueQueries = current.queryFingerprints.size;
    const duplicateQueries = Math.max(0, current.queries - uniqueQueries);
    const sample: RequestQuerySample = {
      route: current.route,
      queries: current.queries,
      totalDurationMs: round(current.totalDurationMs),
      slowQueries: current.slowQueries,
      maxQueryMs: round(current.maxQueryMs),
      completedAt: new Date().toISOString(),
      uniqueQueries,
      duplicateQueries,
      duplicateFingerprints,
    };
    this.requestSamples.push(sample);
    const limit = this.options.maxSamples ?? 256;
    if (this.requestSamples.length > limit) this.requestSamples.splice(0, this.requestSamples.length - limit);
    return sample;
  }

  recordBudgetViolation(input: Omit<BudgetViolationSample, "observedAt">) {
    this.budgetViolations.push({ ...input, observedAt: new Date().toISOString() });
    const limit = this.options.maxSamples ?? 256;
    if (this.budgetViolations.length > limit) this.budgetViolations.splice(0, this.budgetViolations.length - limit);
  }

  recordQuery(event: { query?: string; duration?: number; target?: string }) {
    const query = String(event.query || "query").replace(/\s+/g, " ").trim().slice(0, 180);
    const context = this.routeContext.getStore();
    const durationMs = Number(event.duration || 0);
    if (context?.requestId) {
      const request = this.activeRequests.get(context.requestId);
      if (request) {
        request.queries += 1;
        request.totalDurationMs += durationMs;
        request.maxQueryMs = Math.max(request.maxQueryMs, durationMs);
        if (durationMs >= (this.options.slowQueryMs ?? 100)) request.slowQueries += 1;
        const fingerprint = queryFingerprint(query);
        const fingerprintEntry = request.queryFingerprints.get(fingerprint) || { fingerprint, count: 0, totalDurationMs: 0, maxDurationMs: 0 };
        fingerprintEntry.count += 1;
        fingerprintEntry.totalDurationMs += durationMs;
        fingerprintEntry.maxDurationMs = Math.max(fingerprintEntry.maxDurationMs, durationMs);
        request.queryFingerprints.set(fingerprint, fingerprintEntry);
      }
    }
    this.record({
      label: String(event.target || query.split(" ", 1)[0] || "query"),
      route: context?.route || "background",
      durationMs,
      startedAt: new Date(),
      success: true,
      detail: query,
    });
  }

  async measure<T>(label: string, route: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    const started = process.hrtime.bigint();
    try {
      const result = await operation();
      this.record({ label, route, durationMs: Number(process.hrtime.bigint() - started) / 1_000_000, startedAt, success: true });
      return result;
    } catch (error) {
      this.record({
        label,
        route,
        durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        startedAt,
        success: false,
        detail: error instanceof Error ? error.message : "Unknown query failure",
      });
      throw error;
    }
  }

  snapshot() {
    const sorted = [...this.samples].sort((a, b) => b.durationMs - a.durationMs);
    const durations = this.samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const percentile = (values: number[], ratio: number) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : 0;
    const grouped = new Map<string, QueryDiagnostic[]>();
    for (const sample of this.samples) {
      const key = `${sample.route}::${sample.label}`;
      const bucket = grouped.get(key) || [];
      bucket.push(sample);
      grouped.set(key, bucket);
    }
    const groups = [...grouped.entries()].map(([key, values]) => {
      const split = key.indexOf("::");
      const route = key.slice(0, split);
      const label = key.slice(split + 2);
      const groupDurations = values.map((sample) => sample.durationMs).sort((a, b) => a - b);
      return {
        route,
        label,
        count: values.length,
        failures: values.filter((sample) => !sample.success).length,
        averageMs: round(groupDurations.reduce((sum, value) => sum + value, 0) / Math.max(1, groupDurations.length)),
        p95Ms: round(percentile(groupDurations, 0.95) || 0),
        p99Ms: round(percentile(groupDurations, 0.99) || 0),
        maxMs: round(groupDurations.at(-1) || 0),
      };
    }).sort((left, right) => right.p95Ms - left.p95Ms || right.count - left.count).slice(0, 30);
    const requestQueryCounts = this.requestSamples.map((sample) => sample.queries).sort((a, b) => a - b);
    const requestQueryMs = this.requestSamples.map((sample) => sample.totalDurationMs).sort((a, b) => a - b);
    const requestDuplicateCounts = this.requestSamples.map((sample) => sample.duplicateQueries).sort((a, b) => a - b);
    const requestGroups = new Map<string, RequestQuerySample[]>();
    for (const sample of this.requestSamples) {
      const bucket = requestGroups.get(sample.route) || [];
      bucket.push(sample);
      requestGroups.set(sample.route, bucket);
    }
    const fanoutRoutes = [...requestGroups.entries()].map(([route, values]) => {
      const counts = values.map((sample) => sample.queries).sort((a, b) => a - b);
      const totalMs = values.map((sample) => sample.totalDurationMs).sort((a, b) => a - b);
      const duplicateCounts = values.map((sample) => sample.duplicateQueries).sort((a, b) => a - b);
      const repeated = new Map<string, RequestQueryFingerprint>();
      for (const sample of values) {
        for (const entry of sample.duplicateFingerprints) {
          const current = repeated.get(entry.fingerprint) || { fingerprint: entry.fingerprint, count: 0, totalDurationMs: 0, maxDurationMs: 0 };
          current.count += entry.count;
          current.totalDurationMs += entry.totalDurationMs;
          current.maxDurationMs = Math.max(current.maxDurationMs, entry.maxDurationMs);
          repeated.set(entry.fingerprint, current);
        }
      }
      return {
        route,
        requests: values.length,
        averageQueries: round(counts.reduce((sum, value) => sum + value, 0) / Math.max(1, counts.length)),
        p95Queries: round(percentile(counts, 0.95) || 0),
        p99Queries: round(percentile(counts, 0.99) || 0),
        maxQueries: counts.at(-1) || 0,
        averageDuplicateQueries: round(duplicateCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, duplicateCounts.length)),
        p95DuplicateQueries: round(percentile(duplicateCounts, 0.95) || 0),
        maxDuplicateQueries: duplicateCounts.at(-1) || 0,
        p95DatabaseMs: round(percentile(totalMs, 0.95) || 0),
        maxDatabaseMs: round(totalMs.at(-1) || 0),
        slowQueries: values.reduce((sum, sample) => sum + sample.slowQueries, 0),
        duplicateFingerprints: [...repeated.values()]
          .map((entry) => ({ ...entry, totalDurationMs: round(entry.totalDurationMs), maxDurationMs: round(entry.maxDurationMs) }))
          .sort((left, right) => right.count - left.count || right.totalDurationMs - left.totalDurationMs)
          .slice(0, 8),
      };
    }).sort((left, right) => right.p95Queries - left.p95Queries || right.p95DatabaseMs - left.p95DatabaseMs).slice(0, 20);
    return {
      samples: this.samples.length,
      slowQueries: this.slowCount,
      averageMs: round(this.samples.reduce((sum, sample) => sum + sample.durationMs, 0) / Math.max(1, this.samples.length)),
      p50Ms: round(percentile(durations, 0.5) || 0),
      p95Ms: round(percentile(durations, 0.95) || 0),
      p99Ms: round(percentile(durations, 0.99) || 0),
      groups,
      slowest: sorted.slice(0, 20),
      budgets: {
        violations: this.budgetViolations.length,
        recent: this.budgetViolations.slice(-30).reverse(),
      },
      fanout: {
        samples: this.requestSamples.length,
        activeRequests: this.activeRequests.size,
        averageQueries: round(requestQueryCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, requestQueryCounts.length)),
        p50Queries: round(percentile(requestQueryCounts, 0.5) || 0),
        p95Queries: round(percentile(requestQueryCounts, 0.95) || 0),
        p99Queries: round(percentile(requestQueryCounts, 0.99) || 0),
        maxQueries: requestQueryCounts.at(-1) || 0,
        averageDuplicateQueries: round(requestDuplicateCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, requestDuplicateCounts.length)),
        p95DuplicateQueries: round(percentile(requestDuplicateCounts, 0.95) || 0),
        p99DuplicateQueries: round(percentile(requestDuplicateCounts, 0.99) || 0),
        maxDuplicateQueries: requestDuplicateCounts.at(-1) || 0,
        p95DatabaseMs: round(percentile(requestQueryMs, 0.95) || 0),
        routes: fanoutRoutes,
      },
    };
  }

  async postgresSnapshot() {
    const [runtimeRows, sizeRows, connectionRows, lockRows, migrationRows, databaseRows, tableRows, hotTableRows, indexRows, foreignKeyRows, statementRows] = await Promise.all([
      this.prisma.$queryRawUnsafe(
        "SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS version_num, current_setting('max_connections')::int AS max_connections, current_setting('TimeZone') AS timezone, current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout, current_schema() AS schema, pg_is_in_recovery() AS in_recovery",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe("SELECT pg_database_size(current_database())::text AS bytes").catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state = 'idle')::int AS idle, count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction, COALESCE(EXTRACT(EPOCH FROM max(clock_timestamp() - query_start) FILTER (WHERE state = 'active')), 0)::float8 AS longest_active_seconds FROM pg_stat_activity WHERE datname = current_database()",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting, count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waits FROM pg_stat_activity WHERE datname = current_database()",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,
                count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS failed
           FROM "_prisma_migrations"`,
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT xact_commit::text AS commits, xact_rollback::text AS rollbacks, blks_read::text AS blocks_read, blks_hit::text AS blocks_hit, deadlocks::text AS deadlocks, temp_files::text AS temp_files, temp_bytes::text AS temp_bytes, conflicts::text AS conflicts FROM pg_stat_database WHERE datname = current_database()",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT COALESCE(sum(seq_scan), 0)::text AS sequential_scans, COALESCE(sum(idx_scan), 0)::text AS index_scans, COALESCE(sum(n_live_tup), 0)::text AS live_rows, COALESCE(sum(n_dead_tup), 0)::text AS dead_rows, COALESCE(max(n_dead_tup), 0)::text AS largest_dead_table_rows FROM pg_stat_user_tables",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT relname AS table_name, seq_scan::text, idx_scan::text, n_live_tup::text AS live_rows, n_dead_tup::text AS dead_rows, n_mod_since_analyze::text AS modified_since_analyze, pg_relation_size(relid)::text AS table_bytes, pg_indexes_size(relid)::text AS index_bytes, pg_total_relation_size(relid)::text AS total_bytes, last_analyze, last_autoanalyze, last_autovacuum FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC, (n_live_tup + n_dead_tup) DESC LIMIT 20",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT relname AS table_name, indexrelname AS index_name, idx_scan::text AS scans, pg_relation_size(indexrelid)::text AS bytes FROM pg_stat_user_indexes ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC LIMIT 30",
      ).catch(() => []),
      this.prisma.$queryRawUnsafe(
        "SELECT c.conrelid::regclass::text AS table_name, c.conname AS constraint_name, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indisready AND i.indkey::smallint[] @> c.conkey) ORDER BY c.conrelid::regclass::text, c.conname LIMIT 50",
      ).catch(() => []),
      (async () => {
        const extensionRows = await this.prisma.$queryRawUnsafe(
          "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS available",
        ).catch(() => []);
        if (!Boolean((extensionRows as any[])?.[0]?.available)) return [];
        return this.prisma.$queryRawUnsafe(
          "SELECT queryid::text AS query_id, calls::text, total_exec_time::float8 AS total_ms, mean_exec_time::float8 AS mean_ms, rows::text, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY total_exec_time DESC LIMIT 20",
        ).catch(() => []);
      })(),
    ]);
    const first = (rows: any, key: string, fallback: unknown = null) => rows?.[0]?.[key] ?? fallback;
    const numeric = (rows: any, key: string) => Number(first(rows, key, 0));
    const blocksRead = numeric(databaseRows, "blocks_read");
    const blocksHit = numeric(databaseRows, "blocks_hit");
    const commits = numeric(databaseRows, "commits");
    const rollbacks = numeric(databaseRows, "rollbacks");
    const sequentialScans = numeric(tableRows, "sequential_scans");
    const indexScans = numeric(tableRows, "index_scans");
    const liveRows = numeric(tableRows, "live_rows");
    const deadRows = numeric(tableRows, "dead_rows");
    const cacheHitRatio = blocksRead + blocksHit ? round(blocksHit / (blocksRead + blocksHit)) : 0;
    const indexScanRatio = sequentialScans + indexScans ? round(indexScans / (sequentialScans + indexScans)) : 0;
    const deadRowRatio = liveRows + deadRows ? round(deadRows / (liveRows + deadRows)) : 0;
    const recommendations: string[] = [];
    if (cacheHitRatio && cacheHitRatio < 0.9) recommendations.push("PostgreSQL cache hit ratio is below 90%; review working-set size and memory pressure.");
    if (indexScanRatio < 0.5 && sequentialScans > 100) recommendations.push("Sequential scans dominate indexed scans; inspect hot tables and query predicates.");
    if (deadRowRatio > 0.2) recommendations.push("Dead tuples exceed 20% of observed rows; review autovacuum/analyze health.");
    if (Number(first(lockRows, "lock_waits", 0)) > 0) recommendations.push("Active lock waits are present; inspect long transactions before increasing concurrency.");
    const expensiveStatements = (statementRows as any[]).filter((row: any) => Number(row.mean_ms || 0) >= 100 || Number(row.total_ms || 0) >= 5_000);
    if (expensiveStatements.length) recommendations.push(`${expensiveStatements.length} pg_stat_statements fingerprints exceed the statement latency budget; inspect predicates, indexes, and result-set size.`);
    if ((foreignKeyRows as any[]).length) recommendations.push(`${(foreignKeyRows as any[]).length} foreign-key constraints do not have a covering index; review write/read paths before adding indexes.`);
    const unusedLargeIndexes = (indexRows as any[]).filter((row: any) => Number(row.scans || 0) === 0 && Number(row.bytes || 0) >= 64 * 1024 * 1024);
    if (unusedLargeIndexes.length) recommendations.push(`${unusedLargeIndexes.length} large indexes have zero scans in the current PostgreSQL statistics window; verify they are still justified before reclaiming space.`);
    return {
      provider: "postgresql",
      version: String(first(runtimeRows, "version", "unknown")),
      versionNumber: Number(first(runtimeRows, "version_num", 0)),
      schema: String(first(runtimeRows, "schema", "public")),
      timezone: String(first(runtimeRows, "timezone", "unknown")),
      inRecovery: Boolean(first(runtimeRows, "in_recovery", false)),
      timeouts: {
        idleInTransaction: String(first(runtimeRows, "idle_transaction_timeout", "unknown")),
        statement: String(first(runtimeRows, "statement_timeout", "unknown")),
        lock: String(first(runtimeRows, "lock_timeout", "unknown")),
      },
      databaseBytes: Number(first(sizeRows, "bytes", 0)),
      connections: {
        total: Number(first(connectionRows, "total", 0)),
        active: Number(first(connectionRows, "active", 0)),
        idle: Number(first(connectionRows, "idle", 0)),
        idleInTransaction: Number(first(connectionRows, "idle_in_transaction", 0)),
        longestActiveSeconds: round(Number(first(connectionRows, "longest_active_seconds", 0))),
        waiting: Number(first(lockRows, "waiting", 0)),
        lockWaits: Number(first(lockRows, "lock_waits", 0)),
        max: Number(first(runtimeRows, "max_connections", 0)),
      },
      workload: {
        commits,
        rollbacks,
        rollbackRatio: commits + rollbacks ? round(rollbacks / (commits + rollbacks)) : 0,
        blocksRead,
        blocksHit,
        cacheHitRatio,
        deadlocks: numeric(databaseRows, "deadlocks"),
        conflicts: numeric(databaseRows, "conflicts"),
        temporaryFiles: numeric(databaseRows, "temp_files"),
        temporaryBytes: numeric(databaseRows, "temp_bytes"),
        sequentialScans,
        indexScans,
        indexScanRatio,
        liveRows,
        deadRows,
        deadRowRatio,
        largestDeadTableRows: numeric(tableRows, "largest_dead_table_rows"),
      },
      tables: (hotTableRows as any[]).map((row: any) => ({
        table: String(row.table_name || ""),
        sequentialScans: Number(row.seq_scan || 0),
        indexScans: Number(row.idx_scan || 0),
        liveRows: Number(row.live_rows || 0),
        deadRows: Number(row.dead_rows || 0),
        modifiedSinceAnalyze: Number(row.modified_since_analyze || 0),
        tableBytes: Number(row.table_bytes || 0),
        indexBytes: Number(row.index_bytes || 0),
        totalBytes: Number(row.total_bytes || 0),
        lastAnalyzeAt: row.last_analyze || row.last_autoanalyze || null,
        lastAutovacuumAt: row.last_autovacuum || null,
      })),
      indexes: (indexRows as any[]).map((row: any) => ({ table: String(row.table_name || ""), index: String(row.index_name || ""), scans: Number(row.scans || 0), bytes: Number(row.bytes || 0) })),
      missingForeignKeyIndexes: (foreignKeyRows as any[]).map((row: any) => ({ table: String(row.table_name || ""), constraint: String(row.constraint_name || ""), definition: String(row.definition || "") })),
      statements: {
        available: (statementRows as any[]).length > 0,
        hot: (statementRows as any[]).map((row: any) => ({
          queryId: String(row.query_id || ""),
          calls: Number(row.calls || 0),
          totalMs: round(Number(row.total_ms || 0)),
          meanMs: round(Number(row.mean_ms || 0)),
          rows: Number(row.rows || 0),
          query: String(row.query || ""),
        })),
      },
      recommendations,
      migrations: {
        tracked: Number(first(migrationRows, "total", 0)),
        unfinished: Number(first(migrationRows, "unfinished", 0)),
        failed: Number(first(migrationRows, "failed", 0)),
        migrationHistoryPresent: Number(first(migrationRows, "total", 0)) > 0,
      },
      activeConnections: Number(first(connectionRows, "active", 0)),
      waitingConnections: Number(first(lockRows, "waiting", 0)),
    };
  }

  async providerSnapshot(force = false) {
    const now = Date.now();
    if (!force && this.providerSnapshotCache && this.providerSnapshotCache.expiresAt > now) return this.providerSnapshotCache.value;
    if (!force && this.providerSnapshotPending) return this.providerSnapshotPending;

    let pending!: Promise<any>;
    pending = this.postgresSnapshot()
      .then((value) => {
        this.providerSnapshotCache = { expiresAt: Date.now() + this.providerSnapshotTtlMs, value };
        return value;
      })
      .finally(() => {
        if (this.providerSnapshotPending === pending) this.providerSnapshotPending = null;
      });
    this.providerSnapshotPending = pending;
    return pending;
  }

  async optimize() {
    await this.prisma.$executeRawUnsafe("ANALYZE");
    this.providerSnapshotCache = null;
    return this.providerSnapshot(true);
  }

  private record(input: { label: string; route: string; durationMs: number; startedAt: Date; success: boolean; detail?: string }) {
    const sample: QueryDiagnostic = {
      label: input.label,
      route: input.route,
      durationMs: round(input.durationMs),
      startedAt: input.startedAt.toISOString(),
      success: input.success,
      ...(input.detail ? { detail: input.detail } : {}),
    };
    if (sample.durationMs >= (this.options.slowQueryMs ?? 100)) this.slowCount += 1;
    this.samples.push(sample);
    const limit = this.options.maxSamples ?? 256;
    if (this.samples.length > limit) this.samples.splice(0, this.samples.length - limit);
  }
}

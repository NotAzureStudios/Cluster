import { ClusterButton } from "../../components/ClusterButton";
import { ClusterVisualRankedBars } from "../../components/ClusterVisualMetrics";
import { useEffect, useRef, useState } from "react";
import { queryApi } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { LoadingState } from "../../components/LoadingState";
import { HealthStrip, PipelineRail, VisualState } from "../../components/ClusterVisualIntelligence";
import type { VisualDatum } from "../../components/visual-intelligence";
import { RequestErrorState } from "../../components/RequestState";
import { TelemetryTrendChart } from "../../components/TelemetryTrendChart";
import { appendTrendSample, type TrendSample } from "../../components/telemetry-trend";
import "./server-performance.css";
import "./operations-workspaces.css";

type BudgetCheck = { key: string; label: string; unit: string; actual: number | null; target: number; warning: number; direction: "max" | "min"; status: "pass" | "warn" | "fail" | "unknown"; detail: string };
type OperationsPerformance = {
  ok: boolean;
  generatedAt: string;
  runtime?: { requests?: { p50Ms?: number; p95Ms?: number; p99Ms?: number; errorRate?: number; total?: number }; eventLoop?: { p95Ms?: number }; routes?: Array<{ route: string; count: number; errors: number; p95Ms: number; p99Ms?: number; maxMs: number }> };
  databaseQueries?: { p50Ms?: number; p95Ms?: number; p99Ms?: number; slowQueries?: number; groups?: Array<{ route: string; label: string; count: number; failures: number; p95Ms: number; p99Ms: number; maxMs: number }>; fanout?: { samples?: number; p95Queries?: number; p99Queries?: number; maxQueries?: number; routes?: Array<{ route: string; requests: number; averageQueries: number; p95Queries: number; p99Queries: number; maxQueries: number; p95DatabaseMs: number }> } };
  postgres?: { connections?: { total?: number; active?: number; max?: number; lockWaits?: number }; workload?: { cacheHitRatio?: number; indexScanRatio?: number; deadRowRatio?: number; liveRows?: number; deadRows?: number; temporaryBytes?: number }; statements?: { available?: boolean; hot?: Array<{ queryId: string; calls: number; totalMs: number; meanMs: number; rows: number; query: string }> }; tables?: Array<{ table: string; sequentialScans: number; indexScans: number; liveRows: number; deadRows: number; modifiedSinceAnalyze: number; tableBytes?: number; indexBytes?: number; totalBytes?: number }>; missingForeignKeyIndexes?: Array<{ table: string; constraint: string; definition: string }>; recommendations?: string[] };
  gpu?: { status: "available" | "partial" | "unavailable" | "stale"; sampledAt: string | null; provider: string; metricsSupported: boolean; devices: Array<{ id: string; name: string; vendor: string; utilizationPercent: number | null; memoryTotalMiB: number | null; memoryUsedMiB: number | null; temperatureC: number | null; powerWatts: number | null }> };
  gpuJobs?: Array<{ host: string; deviceId: string; active: number }>;
  durableJobs?: { queued?: number; running?: number; deadLetter?: number };
  budgets?: { status: "pass" | "warn" | "fail"; failures: number; warnings: number; checks: BudgetCheck[] };
};

function ms(value?: number | null) { return value == null ? "—" : `${Math.round(value)} ms`; }
function ratio(value?: number | null) { return value == null ? "—" : `${Math.round(value * 1000) / 10}%`; }
function budgetValue(check: BudgetCheck) {
  if (check.actual == null) return "No sample";
  if (check.unit === "ms") return ms(check.actual);
  if (check.unit === "ratio") return ratio(check.actual);
  return `${Math.round(check.actual * 100) / 100} ${check.unit}`;
}

export function ServerPerformancePanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<OperationsPerformance | null>(null);
  const [trendSamples, setTrendSamples] = useState<TrendSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState("Loading server performance…");
  const refreshingRef = useRef(false);
  async function refresh() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!data) setLoading(true);
    try {
      setError(null);
      const result = await queryApi<OperationsPerformance>("/api/admin/operations/performance", { staleMs: 10_000, maxAgeMs: 45_000, persist: false, tags: ["operations", "performance"] });
      setData(result);
      setTrendSamples((samples) => appendTrendSample(samples, {
        at: Date.parse(result.generatedAt),
        requestP95Ms: result.runtime?.requests?.p95Ms ?? null,
        databaseP95Ms: result.databaseQueries?.p95Ms ?? null,
      }));
      setStatus(`Updated ${new Date(result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      setError(error);
      setStatus("Performance refresh failed");
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  useVisibleRefresh(() => refresh(), { intervalMs: compact ? 45_000 : 20_000 });
  const checks = data?.budgets?.checks || [];
  const topRoutes = [...(data?.runtime?.routes || [])].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, compact ? 4 : 8);
  const hotQueries = data?.databaseQueries?.groups?.slice(0, compact ? 3 : 6) || [];
  const fanoutRoutes = data?.databaseQueries?.fanout?.routes?.slice(0, compact ? 0 : 6) || [];
  const tables = data?.postgres?.tables?.slice(0, compact ? 0 : 8) || [];
  const statements = data?.postgres?.statements?.hot?.slice(0, compact ? 0 : 6) || [];
  const operationsHealth: VisualDatum[] = data ? [
    { id: "requests", label: "Request p95", value: Math.round(data.runtime?.requests?.p95Ms || 0), detail: ms(data.runtime?.requests?.p95Ms), tone: data.budgets?.status === "fail" ? "danger" : data.budgets?.status === "warn" ? "warning" : "success" },
    { id: "database", label: "Database p95", value: Math.round(data.databaseQueries?.p95Ms || 0), detail: ms(data.databaseQueries?.p95Ms), tone: (data.databaseQueries?.slowQueries || 0) > 0 ? "warning" : "success" },
    { id: "jobs", label: "Job queue", value: data.durableJobs?.queued || 0, detail: `${data.durableJobs?.running || 0} running · ${data.durableJobs?.deadLetter || 0} dead-letter`, tone: (data.durableJobs?.deadLetter || 0) > 0 ? "danger" : (data.durableJobs?.queued || 0) > 0 ? "info" : "success" },
    { id: "postgres", label: "PostgreSQL", value: Math.round((data.postgres?.workload?.cacheHitRatio || 0) * 100), detail: `${ratio(data.postgres?.workload?.cacheHitRatio)} cache hit`, tone: (data.postgres?.connections?.lockWaits || 0) > 0 ? "warning" : "success" },
  ] : [];
  const operationsPipeline: VisualDatum[] = data ? [
    { id: "client", label: "Client", detail: "Renderer telemetry", tone: "info" },
    { id: "api", label: "API", detail: `${data.runtime?.requests?.total || 0} sampled requests`, tone: (data.runtime?.requests?.errorRate || 0) > 0.02 ? "warning" : "success" },
    { id: "database", label: "Database", detail: `${data.databaseQueries?.slowQueries || 0} slow queries`, tone: (data.databaseQueries?.slowQueries || 0) > 0 ? "warning" : "success" },
    { id: "jobs", label: "Jobs", detail: `${data.durableJobs?.queued || 0} queued`, tone: (data.durableJobs?.deadLetter || 0) > 0 ? "danger" : "success" },
  ] : [];
  return (
    <section className={`server-performance-v387 ${compact ? "compact" : ""}`}>
      <header><div><strong>Server performance</strong><span>{status}</span></div><div className="button-row"><span className={`soft-pill ${data?.budgets?.status === "fail" ? "danger" : data?.budgets?.status === "warn" ? "warning" : "good"}`}>{data?.budgets ? `${data.budgets.failures} fail · ${data.budgets.warnings} warn` : "No posture"}</span><ClusterButton type="button" className="" disabled={loading} onClick={() => void refresh()} variant="quiet" size="compact">{loading ? "Refreshing…" : "Refresh"}</ClusterButton></div></header>
      {loading && !data ? <LoadingState label="Loading server performance" rows={4} compact /> : error && !data ? <RequestErrorState error={error} title="Server performance unavailable" onRetry={() => void refresh()} compact /> : null}
      {error && data ? <RequestErrorState error={error} title="Performance refresh failed" onRetry={() => void refresh()} compact /> : null}
      <VisualState state={!data ? (loading ? "loading" : error ? "error" : "empty") : error ? "stale" : "ready"} label={error && data ? "Showing the last successful operations snapshot" : undefined}>
        <div className="operations-visual-intelligence-v504">
          <HealthStrip items={operationsHealth} label="Server operational health" />
          {!compact ? <PipelineRail items={operationsPipeline} label="Operational request path" /> : null}
        </div>
      </VisualState>
      {!compact ? <TelemetryTrendChart samples={trendSamples} /> : null}
      {!compact && topRoutes.length > 0 && <ClusterVisualRankedBars label="Slowest API routes · p95" rows={topRoutes.filter((route) => Number.isFinite(route.p95Ms)).map((route) => ({ id: route.route, label: route.route, value: route.p95Ms }))} formatValue={(value) => ms(value)} tone="warning" />}
      <details className="cluster-visual-advanced"><summary>Technical server metrics</summary><div className="cluster-visual-advanced__body"><div className="server-performance-kpis-v387">
        <article><span>Request p95 / p99</span><strong>{ms(data?.runtime?.requests?.p95Ms)} / {ms(data?.runtime?.requests?.p99Ms)}</strong></article>
        <article><span>Database p95 / p99</span><strong>{ms(data?.databaseQueries?.p95Ms)} / {ms(data?.databaseQueries?.p99Ms)}</strong></article>
        <article><span>Query fanout p95 / p99</span><strong>{data?.databaseQueries?.fanout?.samples ? `${Math.round(data.databaseQueries.fanout.p95Queries || 0)} / ${Math.round(data.databaseQueries.fanout.p99Queries || 0)}` : "—"}</strong></article>
        <article><span>Cache hit</span><strong>{ratio(data?.postgres?.workload?.cacheHitRatio)}</strong></article>
        <article><span>Index scan</span><strong>{ratio(data?.postgres?.workload?.indexScanRatio)}</strong></article>
        <article><span>Lock waits</span><strong>{data?.postgres?.connections?.lockWaits ?? "—"}</strong></article>
        <article><span>Dead-letter jobs</span><strong>{data?.durableJobs?.deadLetter ?? "—"}</strong></article>
        <article><span>GPU devices</span><strong>{data?.gpu?.devices?.length ?? "—"}</strong></article>
        <article><span>GPU media jobs</span><strong>{data?.gpuJobs ? data.gpuJobs.reduce((sum, item) => sum + item.active, 0) : "—"}</strong></article>
      </div>
      </div></details>
      <div className="server-performance-budgets-v387" aria-label="Host GPU metrics">
        {data?.gpu?.devices?.length ? data.gpu.devices.map((gpu) => <article key={gpu.id} data-status="pass"><span>{gpu.name}</span><strong>{gpu.utilizationPercent == null ? "Load unavailable" : `${gpu.utilizationPercent}% GPU`}</strong><small>{gpu.memoryTotalMiB == null || gpu.memoryUsedMiB == null ? "VRAM unavailable" : `${Math.round(gpu.memoryUsedMiB)} / ${Math.round(gpu.memoryTotalMiB)} MiB VRAM`} · {gpu.temperatureC == null ? "Temperature unavailable" : `${gpu.temperatureC}°C`} · {gpu.powerWatts == null ? "Power unavailable" : `${gpu.powerWatts} W`} · {data?.gpuJobs?.filter((job) => job.deviceId === gpu.id).reduce((sum, job) => sum + job.active, 0) ?? "—"} GPU jobs</small></article>) : <article data-status="unknown"><span>GPU telemetry</span><strong>{data?.gpu?.status === "stale" ? "Stale" : "Unavailable"}</strong><small>GPU usage requires a supported local sensor. CPU metrics remain available.</small></article>}
      </div>
      <div className="server-performance-budgets-v387">{checks.filter((check: BudgetCheck) => check.status === "fail" || check.status === "warn").map((check: BudgetCheck) => <article key={check.key} data-status={check.status}><span>{check.label}</span><strong>{budgetValue(check)}</strong><small>Target {check.direction === "max" ? "≤" : "≥"} {check.unit === "ratio" ? ratio(check.target) : check.unit === "ms" ? ms(check.target) : `${check.target} ${check.unit}`}</small></article>)}</div>
      {!compact && <details className="cluster-visual-advanced"><summary>Database diagnostics and route details</summary><div className="cluster-visual-advanced__body"><div className="server-performance-budgets-v387">{checks.filter((check: BudgetCheck) => check.status !== "fail" && check.status !== "warn").map((check: BudgetCheck) => <article key={check.key} data-status={check.status}><span>{check.label}</span><strong>{budgetValue(check)}</strong><small>Target {check.direction === "max" ? "≤" : "≥"} {check.unit === "ratio" ? ratio(check.target) : check.unit === "ms" ? ms(check.target) : `${check.target} ${check.unit}`}</small></article>)}</div><div className="server-performance-detail-v387">
        <section><header><strong>Slow routes</strong><span>p95 / p99</span></header>{topRoutes.length ? topRoutes.map((route) => <p key={route.route}><code>{route.route}</code><span>{ms(route.p95Ms)} / {ms(route.p99Ms)}</span></p>) : <small>No request samples yet.</small>}</section>
        <section><header><strong>Hot queries</strong><span>p95 / p99</span></header>{hotQueries.length ? hotQueries.map((query) => <p key={`${query.route}-${query.label}`}><code>{query.route} · {query.label}</code><span>{ms(query.p95Ms)} / {ms(query.p99Ms)}</span></p>) : <small>No query samples yet.</small>}</section>
        <section><header><strong>Query fanout</strong><span>queries / request</span></header>{fanoutRoutes.length ? fanoutRoutes.map((route) => <p key={route.route}><code>{route.route}</code><span>{Math.round(route.p95Queries)} p95 · {Math.round(route.maxQueries)} max</span></p>) : <small>No request-level query samples yet.</small>}</section>
        <section><header><strong>Table pressure</strong><span>live / dead</span></header>{tables.length ? tables.map((table) => <p key={table.table}><code>{table.table}</code><span>{table.liveRows.toLocaleString()} / {table.deadRows.toLocaleString()}</span></p>) : <small>No PostgreSQL table statistics.</small>}</section>
        <section><header><strong>Statement hotspots</strong><span>mean / calls</span></header>{statements.length ? statements.map((statement) => <p key={statement.queryId || statement.query}><code title={statement.query}>{statement.query.slice(0, 72)}</code><span>{ms(statement.meanMs)} / {statement.calls.toLocaleString()}</span></p>) : <small>{data?.postgres?.statements?.available === false ? "pg_stat_statements is not available." : "No statement hotspots sampled."}</small>}</section>
      </div></div></details>}
      {!compact && (data?.postgres?.missingForeignKeyIndexes?.length ?? 0) > 0 && <div className="server-performance-recommendations-v387"><strong>Index coverage</strong><p>{data?.postgres?.missingForeignKeyIndexes?.length ?? 0} foreign-key constraints lack a covering index in the current schema diagnostics.</p></div>}
      {!compact && Boolean(data?.postgres?.recommendations?.length) && <div className="server-performance-recommendations-v387"><strong>Database recommendations</strong>{data?.postgres?.recommendations?.map((item) => <p key={item}>{item}</p>)}</div>}
    </section>
  );
}

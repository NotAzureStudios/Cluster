import { monitorEventLoopDelay, performance, PerformanceObserver } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

export type RuntimeTelemetrySnapshot = {
  process: {
    pid: number;
    uptimeSeconds: number;
    cpuPercent: number;
  };
  requests: {
    total: number;
    errors: number;
    errorRate: number;
    inFlight: number;
    ratePerSecond: number;
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    slow: number;
    longLived: number;
  };
  eventLoop: {
    utilization: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  gc: {
    count: number;
    totalPauseMs: number;
    averagePauseMs: number;
    p95PauseMs: number;
    p99PauseMs: number;
    maxPauseMs: number;
  };
  database: {
    poolMax: number;
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingConnections: number;
    utilization: number;
    sampledAt: string | null;
  };
  memory: {
    rssMiB: number;
    heapUsedMiB: number;
    heapTotalMiB: number;
    heapLimitMiB: number;
    externalMiB: number;
  };
  routes: Array<{
    route: string;
    count: number;
    errors: number;
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  }>;
};

type RouteMetric = { count: number; errors: number; totalMs: number; maxMs: number; samples: number[] };
type RequestRateSample = { at: number; total: number };

const round = (value: number, precision = 1) => Number.isFinite(value) ? Number(value.toFixed(precision)) : 0;
const toMiB = (bytes: number) => round(bytes / 1024 / 1024);
const toMs = (nanoseconds: number) => round(nanoseconds / 1_000_000, 2);

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] || 0;
}

export function normalizeTelemetryRoute(route: string) {
  const pathname = String(route || "/").split("?")[0] || "/";
  return pathname
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ":id")
    .replace(/\/[0-9]{2,}(?=\/|$)/g, "/:id")
    .replace(/\/[^/]{24,}(?=\/|$)/g, "/:id");
}

export class RuntimeTelemetry {
  private total = 0;
  private errors = 0;
  private inFlight = 0;
  private longLived = 0;
  private totalMs = 0;
  private maxMs = 0;
  private slow = 0;
  private readonly samples: number[] = [];
  private readonly routes = new Map<string, RouteMetric>();
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });
  private previousElu = performance.eventLoopUtilization();
  private previousCpu = process.cpuUsage();
  private previousCpuAt = process.hrtime.bigint();
  private lastEluUtilization = 0;
  private lastCpuPercent = 0;
  private lastRequestRatePerSecond = 0;
  private readonly gcSamples: number[] = [];
  private gcCount = 0;
  private gcTotalPauseMs = 0;
  private gcMaxPauseMs = 0;
  private readonly requestRateSamples: RequestRateSample[] = [];
  private readonly gcObserver: PerformanceObserver;
  private databasePressure = { poolMax: 0, totalConnections: 0, activeConnections: 0, idleConnections: 0, waitingConnections: 0, utilization: 0, sampledAt: null as string | null };

  constructor(private readonly options: { maxSamples?: number; maxRoutes?: number; slowRequestMs?: number } = {}) {
    this.eventLoop.enable();
    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const durationMs = Number(entry.duration || 0);
        this.gcCount += 1;
        this.gcTotalPauseMs += durationMs;
        this.gcMaxPauseMs = Math.max(this.gcMaxPauseMs, durationMs);
        this.pushSample(this.gcSamples, durationMs);
      }
    });
    try { this.gcObserver.observe({ entryTypes: ["gc"] }); } catch { /* older runtimes may not expose GC observations */ }
    this.sampleSystem();
  }

  /**
   * Samples process-level pressure once for the resource governor. Snapshot
   * consumers are intentionally read-only so diagnostics cannot perturb the
   * CPU/event-loop measurement window simply by being opened.
   */
  sampleSystem() {
    const elu = performance.eventLoopUtilization(this.previousElu);
    this.previousElu = performance.eventLoopUtilization();
    this.lastEluUtilization = Number.isFinite(elu.utilization) ? elu.utilization : 0;

    const nowCpuAt = process.hrtime.bigint();
    const cpu = process.cpuUsage(this.previousCpu);
    this.previousCpu = process.cpuUsage();
    const elapsedMicros = Number(nowCpuAt - this.previousCpuAt) / 1000;
    this.previousCpuAt = nowCpuAt;
    this.lastCpuPercent = elapsedMicros > 0 ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : 0;

    const now = Date.now();
    this.requestRateSamples.push({ at: now, total: this.total });
    while (this.requestRateSamples.length > 2 && this.requestRateSamples[0]!.at < now - 10_000) this.requestRateSamples.shift();
    const first = this.requestRateSamples[0];
    this.lastRequestRatePerSecond = first && now > first.at ? (this.total - first.total) / ((now - first.at) / 1000) : 0;
  }

  begin() { this.inFlight += 1; return process.hrtime.bigint(); }
  updateDatabasePressure(input: { poolMax: number; totalConnections: number; activeConnections: number; idleConnections: number; waitingConnections: number }) {
    const poolMax = Math.max(0, Number(input.poolMax || 0));
    const totalConnections = Math.max(0, Number(input.totalConnections || 0));
    this.databasePressure = {
      poolMax,
      totalConnections,
      activeConnections: Math.max(0, Number(input.activeConnections || 0)),
      idleConnections: Math.max(0, Number(input.idleConnections || 0)),
      waitingConnections: Math.max(0, Number(input.waitingConnections || 0)),
      utilization: poolMax > 0 ? Math.min(1, totalConnections / poolMax) : 0,
      sampledAt: new Date().toISOString(),
    };
  }

  beginLongLived() {
    this.longLived += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.longLived = Math.max(0, this.longLived - 1);
    };
  }

  complete(startedAt: bigint, route: string, statusCode: number) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.total += 1; this.totalMs += durationMs; this.maxMs = Math.max(this.maxMs, durationMs);
    if (statusCode >= 500) this.errors += 1;
    if (durationMs >= (this.options.slowRequestMs ?? 750)) this.slow += 1;
    this.pushSample(this.samples, durationMs);
    let key = normalizeTelemetryRoute(route);
    if (!this.routes.has(key) && this.routes.size >= (this.options.maxRoutes ?? 96)) key = "other";
    const metric = this.routes.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, samples: [] };
    metric.count += 1; metric.totalMs += durationMs; metric.maxMs = Math.max(metric.maxMs, durationMs);
    if (statusCode >= 500) metric.errors += 1;
    this.pushSample(metric.samples, durationMs); this.routes.set(key, metric);
    return durationMs;
  }

  abandon(startedAt: bigint, route: string) { return this.complete(startedAt, route, 499); }

  /** API Tool Manager needs every bounded route, not only the 20 slowest. */
  routeMetricsSnapshot(): RuntimeTelemetrySnapshot["routes"] {
    return [...this.routes.entries()].map(([route, metric]) => ({
      route, count: metric.count, errors: metric.errors,
      averageMs: round(metric.totalMs / Math.max(1, metric.count)),
      p50Ms: round(percentile(metric.samples, .5)),
      p95Ms: round(percentile(metric.samples, .95)),
      p99Ms: round(percentile(metric.samples, .99)), maxMs: round(metric.maxMs),
    })).sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
  }

  snapshot(): RuntimeTelemetrySnapshot {
    const memory = process.memoryUsage();
    const heapStatistics = getHeapStatistics();
    const routes = [...this.routes.entries()].map(([route, metric]) => ({
      route, count: metric.count, errors: metric.errors,
      averageMs: round(metric.totalMs / Math.max(1, metric.count)), p50Ms: round(percentile(metric.samples, .5)),
      p95Ms: round(percentile(metric.samples, .95)), p99Ms: round(percentile(metric.samples, .99)), maxMs: round(metric.maxMs),
    })).sort((a,b) => b.p95Ms - a.p95Ms || b.count - a.count).slice(0,20);

    return {
      process: { pid: process.pid, uptimeSeconds: round(process.uptime(), 0), cpuPercent: round(this.lastCpuPercent, 1) },
      requests: { total: this.total, errors: this.errors, errorRate: round(this.errors / Math.max(1,this.total),4), inFlight: this.inFlight,
        ratePerSecond: round(this.lastRequestRatePerSecond,2), averageMs: round(this.totalMs / Math.max(1,this.total)), p50Ms: round(percentile(this.samples,.5)),
        p95Ms: round(percentile(this.samples,.95)), p99Ms: round(percentile(this.samples,.99)), maxMs: round(this.maxMs), slow: this.slow, longLived: this.longLived },
      eventLoop: { utilization: round(this.lastEluUtilization,4), meanMs: toMs(this.eventLoop.mean), p50Ms: toMs(this.eventLoop.percentile(50)),
        p95Ms: toMs(this.eventLoop.percentile(95)), p99Ms: toMs(this.eventLoop.percentile(99)), maxMs: toMs(this.eventLoop.max) },
      gc: { count: this.gcCount, totalPauseMs: round(this.gcTotalPauseMs), averagePauseMs: round(this.gcTotalPauseMs / Math.max(1,this.gcCount)),
        p95PauseMs: round(percentile(this.gcSamples,.95)), p99PauseMs: round(percentile(this.gcSamples,.99)), maxPauseMs: round(this.gcMaxPauseMs) },
      database: { ...this.databasePressure, utilization: round(this.databasePressure.utilization, 4) },
      memory: { rssMiB: toMiB(memory.rss), heapUsedMiB: toMiB(memory.heapUsed), heapTotalMiB: toMiB(memory.heapTotal), heapLimitMiB: toMiB(heapStatistics.heap_size_limit), externalMiB: toMiB(memory.external) }, routes,
    };
  }

  stop() { this.eventLoop.disable(); this.gcObserver.disconnect(); }
  private pushSample(target: number[], value: number) { target.push(value); const limit=this.options.maxSamples ?? 256; if (target.length>limit) target.splice(0,target.length-limit); }
}

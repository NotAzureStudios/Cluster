import type { ResourceGovernor } from "../core/resource-governor.js";
import type { RuntimeTelemetry } from "../core/runtime-telemetry.js";
import type { GpuTelemetry } from "../core/gpu-telemetry.js";
import type { ConcurrentWorkLimiter } from "../core/request-workload.js";
import type { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";

export function createServerResourceGovernorRuntime(input: {
  prisma: any;
  databaseUrl: string;
  databasePoolMax: number;
  runtimeTelemetry: RuntimeTelemetry;
  gpuTelemetry?: GpuTelemetry;
  resourceGovernor: ResourceGovernor;
  concurrentWorkLimiter: ConcurrentWorkLimiter;
  jobQueue: BackgroundJobQueue;
  intervalMs?: number;
  databaseSampleMs?: number;
  queueSampleMs?: number;
  logger?: { warn?: (error: unknown, message: string) => void };
}) {
  let sampling = false;
  let databaseSampleAt = 0;
  let queueSampleAt = 0;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  // A stopped/restarted runtime must not apply an older telemetry result.
  let generation = 0;
  let samples = 0;
  let completedSamples = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;
  let nextSampleAt: string | null = null;
  const databaseApplicationName = (() => {
    try {
      const url = new URL(input.databaseUrl);
      return String(url.searchParams.get("application_name") || `cluster-api-${process.pid}`);
    } catch {
      return `cluster-api-${process.pid}`;
    }
  })();

  async function sampleDatabasePressure(now: number, sampledGeneration: number) {
    if (now - databaseSampleAt < (input.databaseSampleMs ?? (input.resourceGovernor.snapshot().mode === "normal" ? 30_000 : 5_000))) return;
    try {
      const rows = await input.prisma.$queryRawUnsafe(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active, count(*) FILTER (WHERE state = 'idle')::int AS idle, count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1",
        databaseApplicationName,
      ) as any[];
      const row = rows?.[0] || {};
      if (sampledGeneration !== generation) return;
      input.runtimeTelemetry.updateDatabasePressure({
        poolMax: input.databasePoolMax,
        totalConnections: Number(row.total || 0),
        activeConnections: Number(row.active || 0),
        idleConnections: Number(row.idle || 0),
        waitingConnections: Number(row.waiting || 0),
      });
      databaseSampleAt = Date.now();
    } catch {
      // Readiness remains authoritative. Pressure telemetry is advisory.
    }
  }

  async function sample() {
    if (sampling) return input.resourceGovernor.snapshot();
    sampling = true;
    const sampledGeneration = generation;
    try {
      const now = Date.now();
      input.runtimeTelemetry.sampleSystem();
      await Promise.all([sampleDatabasePressure(now, sampledGeneration), input.gpuTelemetry?.sample().catch(() => undefined)]);
      // Keep retrying a failed queue count instead of caching fallback data as a fresh DB sample.
      const queueDue = now - queueSampleAt >= (input.queueSampleMs ?? (input.resourceGovernor.snapshot().mode === "normal" ? 30_000 : 5_000));
      let queue = input.jobQueue.snapshot();
      if (queueDue) {
        try {
          queue = await input.jobQueue.counts();
          queueSampleAt = Date.now();
        } catch {
          queue = input.jobQueue.snapshot();
        }
      }
      if (sampledGeneration !== generation) return input.resourceGovernor.snapshot();
      const snapshot = input.resourceGovernor.observe(input.runtimeTelemetry.snapshot(), queue);
      input.concurrentWorkLimiter.setCapacityScale(snapshot.requestCapacityScale);
      completedSamples += 1;
      return snapshot;
    } finally {
      sampling = false;
    }
  }

  function nextDelayMs() {
    const mode = input.resourceGovernor.snapshot().mode;
    const configured = Math.max(250, input.intervalMs ?? 1_000);
    if (mode === "critical") return Math.min(configured, 500);
    if (mode === "saturated") return Math.min(configured, 1_000);
    if (mode === "busy") return Math.max(configured, 2_000);
    return Math.max(configured, 10_000);
  }

  async function tick(tickGeneration: number) {
    try {
      const priorCompletions = completedSamples;
      await sample();
      if (tickGeneration !== generation || !running || priorCompletions === completedSamples) return;
      samples += 1;
      consecutiveFailures = 0;
      lastSuccessAt = new Date().toISOString();
      lastError = null;
    } catch (error) {
      if (tickGeneration !== generation || !running) return;
      failures += 1;
      consecutiveFailures += 1;
      lastError = error instanceof Error ? error.message : String(error);
      input.logger?.warn?.(error, "resource governor sampling failed; retrying");
    } finally {
      // Even if a telemetry provider throws, admission must not lose its
      // sampling loop. A stale generation cannot arm a timer after shutdown.
      if (running && tickGeneration === generation) schedule(tickGeneration);
    }
  }

  function schedule(tickGeneration: number) {
    if (!running || tickGeneration !== generation) return;
    if (timer) clearTimeout(timer);
    const delay = nextDelayMs();
    nextSampleAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(() => {
      timer = null;
      nextSampleAt = null;
      void tick(tickGeneration);
    }, delay);
    timer.unref?.();
  }

  function start() {
    if (running) return;
    running = true;
    generation += 1;
    void tick(generation);
  }

  function stop() {
    running = false;
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    nextSampleAt = null;
  }

  function samplingStatus() {
    return { running, sampling, samples, failures, consecutiveFailures, lastSuccessAt, lastError, nextSampleAt };
  }

  return { start, stop, sample, samplingStatus, snapshot: () => input.resourceGovernor.snapshot() };
}

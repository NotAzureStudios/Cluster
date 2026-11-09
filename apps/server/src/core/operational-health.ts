import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { BackgroundTaskSnapshot } from "./background-tasks.js";
import type { ReadinessProbeResult } from "./readiness-probe.js";
import type { RuntimeTelemetrySnapshot, RuntimeSaturationSignals } from "./runtime-telemetry.js";
import type { ClusterRuntimeAccessMode } from "./runtime-access-state.js";

export type OperationalHealthState = "starting" | "healthy" | "degraded" | "unavailable" | "draining" | "maintenance" | "read-only" | "recovery";
export type OperationalHealthCheck = {
  key: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type StorageProbeResult = {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  cached: boolean;
  failures: Array<{ key: string; error: string }>;
};

export type OperationalHealthSnapshot = {
  state: OperationalHealthState;
  ready: boolean;
  generatedAt: string;
  checks: OperationalHealthCheck[];
  incidents: Array<{ at: string; from: OperationalHealthState | null; to: OperationalHealthState; reasons: string[] }>;
};

const round = (value: number) => Number.isFinite(value) ? Number(value.toFixed(1)) : 0;

export function assessOperationalHealth(input: {
  serverReady: boolean;
  serverDraining: boolean;
  runtimeMode?: ClusterRuntimeAccessMode;
  database: ReadinessProbeResult | null;
  storage: StorageProbeResult | null;
  runtime: RuntimeTelemetrySnapshot;
  backgroundTasks: BackgroundTaskSnapshot[];
}): Omit<OperationalHealthSnapshot, "incidents"> {
  const checks: OperationalHealthCheck[] = [];

  if (input.serverDraining) {
    checks.push({ key: "lifecycle", status: "fail", detail: "Server is draining and is not accepting new application work." });
  } else if (input.runtimeMode === "recovery") {
    checks.push({ key: "lifecycle", status: "fail", detail: "Server is in recovery mode; workspace traffic and queued mutation replay are held." });
  } else if (input.runtimeMode === "maintenance") {
    checks.push({ key: "lifecycle", status: "warn", detail: "Server is in maintenance mode; control-plane access remains available while workspace traffic is held." });
  } else if (input.runtimeMode === "read-only") {
    checks.push({ key: "lifecycle", status: "warn", detail: "Server is in read-only mode; reads are available while mutations remain queued client-side." });
  } else if (!input.serverReady) {
    checks.push({ key: "lifecycle", status: "warn", detail: "Server startup has not reached the ready state." });
  } else {
    checks.push({ key: "lifecycle", status: "pass", detail: "Server lifecycle is accepting application traffic." });
  }

  if (!input.database) {
    checks.push({ key: "database", status: "warn", detail: "Database readiness has not been sampled yet." });
  } else if (!input.database.ok) {
    checks.push({ key: "database", status: "fail", detail: input.database.timedOut ? "Database readiness probe timed out." : "Database readiness probe failed." });
  } else if (input.database.latencyMs >= 750) {
    checks.push({ key: "database", status: "warn", detail: `Database readiness latency is elevated at ${round(input.database.latencyMs)} ms.` });
  } else {
    checks.push({ key: "database", status: "pass", detail: `Database readiness latency is ${round(input.database.latencyMs)} ms.` });
  }

  if (!input.storage) {
    checks.push({ key: "storage", status: "warn", detail: "Writable-storage readiness has not been sampled yet." });
  } else if (!input.storage.ok) {
    checks.push({ key: "storage", status: "fail", detail: `${input.storage.failures.length} critical storage location(s) are not writable.` });
  } else {
    checks.push({ key: "storage", status: "pass", detail: `Critical storage write/delete probe completed in ${round(input.storage.latencyMs)} ms.` });
  }

  const eventLoopP95 = input.runtime.eventLoop.p95Ms;
  if (eventLoopP95 >= 1_000) checks.push({ key: "event-loop", status: "fail", detail: `Event-loop p95 delay is critically high at ${round(eventLoopP95)} ms.` });
  else if (eventLoopP95 >= 250) checks.push({ key: "event-loop", status: "warn", detail: `Event-loop p95 delay is elevated at ${round(eventLoopP95)} ms.` });
  else checks.push({ key: "event-loop", status: "pass", detail: `Event-loop p95 delay is ${round(eventLoopP95)} ms.` });

  const requestCount = input.runtime.requests.total;
  const errorRate = input.runtime.requests.errorRate;
  if (requestCount >= 20 && errorRate >= 0.25) checks.push({ key: "requests", status: "fail", detail: `Server error rate is ${(errorRate * 100).toFixed(1)}% across ${requestCount} observed requests.` });
  else if (requestCount >= 20 && errorRate >= 0.05) checks.push({ key: "requests", status: "warn", detail: `Server error rate is ${(errorRate * 100).toFixed(1)}% across ${requestCount} observed requests.` });
  else checks.push({ key: "requests", status: "pass", detail: `${requestCount} requests observed with ${(errorRate * 100).toFixed(1)}% server errors.` });

  const heapRatio = input.runtime.memory.heapLimitMiB > 0 ? input.runtime.memory.heapUsedMiB / input.runtime.memory.heapLimitMiB : 0;
  if (heapRatio >= 0.95) checks.push({ key: "memory", status: "fail", detail: `V8 heap is ${(heapRatio * 100).toFixed(1)}% utilized.` });
  else if (heapRatio >= 0.85) checks.push({ key: "memory", status: "warn", detail: `V8 heap is ${(heapRatio * 100).toFixed(1)}% utilized.` });
  else checks.push({ key: "memory", status: "pass", detail: `V8 heap is ${(heapRatio * 100).toFixed(1)}% utilized.` });

  const failedTasks = input.backgroundTasks.filter((task) => task.consecutiveFailures >= 3);
  const criticalTasks = failedTasks.filter((task) => task.consecutiveFailures >= 8);
  if (criticalTasks.length) checks.push({ key: "background-tasks", status: "fail", detail: `${criticalTasks.length} background task(s) have at least 8 consecutive failures.` });
  else if (failedTasks.length) checks.push({ key: "background-tasks", status: "warn", detail: `${failedTasks.length} background task(s) have at least 3 consecutive failures.` });
  else checks.push({ key: "background-tasks", status: "pass", detail: `${input.backgroundTasks.length} background task(s) have no sustained failure streak.` });

  const runtimeMode = input.runtimeMode || "normal";
  const essentialFailure = input.serverDraining || !input.serverReady || runtimeMode === "maintenance" || runtimeMode === "recovery" || input.database?.ok === false || input.storage?.ok === false;
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  let state: OperationalHealthState = "healthy";
  if (input.serverDraining) state = "draining";
  else if (runtimeMode === "recovery") state = "recovery";
  else if (runtimeMode === "maintenance") state = "maintenance";
  else if (runtimeMode === "read-only") state = "read-only";
  else if (!input.serverReady) state = "starting";
  else if (essentialFailure) state = "unavailable";
  else if (failures.length || warnings.length) state = "degraded";

  return {
    state,
    ready: !essentialFailure,
    generatedAt: new Date().toISOString(),
    checks,
  };
}

export class WritableStorageProbe {
  private cached: Omit<StorageProbeResult, "cached"> | null = null;
  private inFlight: Promise<Omit<StorageProbeResult, "cached">> | null = null;

  constructor(
    private readonly locations: Array<{ key: string; root: string }>,
    private readonly options: { ttlMs?: number; timeoutMs?: number } = {},
  ) {}

  async check(force = false): Promise<StorageProbeResult> {
    const ttlMs = Math.max(0, this.options.ttlMs ?? 5_000);
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < ttlMs) return { ...this.cached, cached: true };
    if (!this.inFlight) {
      this.inFlight = this.run().then((result) => {
        this.cached = result;
        return result;
      }).finally(() => { this.inFlight = null; });
    }
    const timeoutMs = Math.max(100, this.options.timeoutMs ?? 2_500);
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeout = new Promise<Omit<StorageProbeResult, "cached">>((resolve) => {
        timer = setTimeout(() => resolve({
          ok: false,
          checkedAt: new Date().toISOString(),
          latencyMs: timeoutMs,
          failures: [{ key: "probe", error: `Writable storage probe timed out after ${timeoutMs} ms.` }],
        }), timeoutMs);
        timer.unref?.();
      });
      const active = this.inFlight;
      if (!active) throw new Error("Writable storage probe did not start.");
      return { ...(await Promise.race([active, timeout])), cached: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  snapshot(): StorageProbeResult | null {
    return this.cached ? { ...this.cached, cached: true } : null;
  }

  private async run(): Promise<Omit<StorageProbeResult, "cached">> {
    const started = performance.now();
    const failures: Array<{ key: string; error: string }> = [];
    for (const location of this.locations) {
      const probeName = `.cluster-health-${process.pid}-${randomBytes(6).toString("hex")}`;
      const target = path.join(location.root, probeName);
      try {
        await fs.mkdir(location.root, { recursive: true });
        await fs.writeFile(target, "cluster-health\n", { flag: "wx", mode: 0o600 });
        await fs.unlink(target);
      } catch (error) {
        await fs.unlink(target).catch(() => undefined);
        failures.push({ key: location.key, error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
      }
    }
    return {
      ok: failures.length === 0,
      checkedAt: new Date().toISOString(),
      latencyMs: Number((performance.now() - started).toFixed(1)),
      failures,
    };
  }
}

export class OperationalHealthHistory {
  private current: OperationalHealthState | null = null;
  private readonly incidents: OperationalHealthSnapshot["incidents"] = [];

  observe(snapshot: Omit<OperationalHealthSnapshot, "incidents">) {
    if (snapshot.state !== this.current) {
      const reasons = snapshot.checks.filter((check) => check.status !== "pass").map((check) => `${check.key}:${check.status}`).slice(0, 12);
      this.incidents.push({ at: snapshot.generatedAt, from: this.current, to: snapshot.state, reasons });
      if (this.incidents.length > 64) this.incidents.splice(0, this.incidents.length - 64);
      this.current = snapshot.state;
    }
    return { ...snapshot, incidents: [...this.incidents] } satisfies OperationalHealthSnapshot;
  }

  snapshot() {
    return { current: this.current, incidents: [...this.incidents] };
  }
}

export type RuntimeSaturationState = "normal" | "busy" | "saturated" | "critical";
export type RuntimeSaturationSnapshot = {
  state: RuntimeSaturationState;
  retryAfterSeconds: number | null;
  reasons: string[];
};

/**
 * One semantic overload contract for API workers and the host supervisor.
 * This deliberately uses several signals so one noisy metric does not eject
 * an otherwise healthy worker from rotation.
 */
export function assessRuntimeSaturation(runtime: RuntimeSaturationSignals): RuntimeSaturationSnapshot {
  const reasons: string[] = [];
  let score = 0;
  if (runtime.eventLoop.p99Ms >= 1_000) { score += 4; reasons.push("event-loop-critical"); }
  else if (runtime.eventLoop.p95Ms >= 250) { score += 2; reasons.push("event-loop-high"); }
  if (runtime.eventLoop.utilization >= 0.98) { score += 4; reasons.push("event-loop-utilization-critical"); }
  else if (runtime.eventLoop.utilization >= 0.85) { score += 2; reasons.push("event-loop-utilization-high"); }
  if (runtime.process.cpuPercent >= 98) { score += 3; reasons.push("cpu-critical"); }
  else if (runtime.process.cpuPercent >= 85) { score += 1; reasons.push("cpu-high"); }
  if (runtime.requests.p99Ms >= 5_000 && runtime.requests.total >= 20) { score += 3; reasons.push("request-latency-critical"); }
  else if (runtime.requests.p95Ms >= 1_500 && runtime.requests.total >= 20) { score += 1; reasons.push("request-latency-high"); }
  const heapRatio = runtime.memory.heapLimitMiB > 0 ? runtime.memory.heapUsedMiB / runtime.memory.heapLimitMiB : 0;
  if (heapRatio >= .95) { score += 3; reasons.push("heap-critical"); }
  else if (heapRatio >= .85) { score += 1; reasons.push("heap-high"); }
  if (runtime.gc.p99PauseMs >= 500) { score += 2; reasons.push("gc-pause-high"); }
  if (runtime.database.waitingConnections >= 4) { score += 4; reasons.push("database-waiting-critical"); }
  else if (runtime.database.waitingConnections > 0) { score += 2; reasons.push("database-waiting"); }
  if (runtime.database.utilization >= .95) { score += 3; reasons.push("database-pool-critical"); }
  else if (runtime.database.utilization >= .8) { score += 1; reasons.push("database-pool-high"); }
  if (runtime.requests.longLived >= 500) { score += 2; reasons.push("long-lived-connections-high"); }

  if (score >= 8) return { state: "critical", retryAfterSeconds: 5, reasons };
  if (score >= 5) return { state: "saturated", retryAfterSeconds: 3, reasons };
  if (score >= 2) return { state: "busy", retryAfterSeconds: null, reasons };
  return { state: "normal", retryAfterSeconds: null, reasons };
}

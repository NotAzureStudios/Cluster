import { availableParallelism } from "node:os";
import type { RuntimeTelemetrySnapshot } from "./runtime-telemetry.js";
import { assessRuntimeSaturation, type RuntimeSaturationState } from "./operational-health.js";
import type { BackgroundJobQueueCounts } from "../domains/jobs/job-types.js";
import type { RequestWorkClass } from "./request-workload.js";
import { computeGovernedJobConcurrency, normalizeServerResourceProfile, type ServerResourceProfile } from "./server-resource-policy.js";

export type ResourceGovernorMode = RuntimeSaturationState;
export type ResourceGovernorProfile = ServerResourceProfile;

export type ResourceGovernorSnapshot = {
  mode: ResourceGovernorMode;
  observedMode: ResourceGovernorMode;
  profile: ResourceGovernorProfile;
  /** Active boot-time cap after limits; base worker pool can be smaller. */
  maximumJobConcurrency: number;
  /** Hysteresis delay between overload recovery steps. */
  recoveryHoldMs: number;
  changedAt: string;
  recoveryCandidateSince: string | null;
  requestCapacityScale: number;
  backgroundConcurrencyScale: number;
  allowBackgroundTasks: boolean;
  allowMaintenanceTasks: boolean;
  allowedJobQueues: string[];
  queue: BackgroundJobQueueCounts | null;
  runtime: {
    cpuPercent: number;
    eventLoopUtilization: number;
    eventLoopP95Ms: number;
    heapRatio: number;
    databaseUtilization: number;
    databaseWaitingConnections: number;
    requestP95Ms: number;
  };
  reasons: string[];
};

const RANK: Record<ResourceGovernorMode, number> = { normal: 0, busy: 1, saturated: 2, critical: 3 };

// Queue admission is workload-aware. User-triggered durable work must remain claimable
// whenever the worker still has capacity; background/maintenance queues may be shed.
const INTERACTIVE_JOB_QUEUES = ["default", "system", "library-transfer", "source-control", "media.software"] as const;
const BACKGROUND_JOB_QUEUES = ["integrations", "library-derivative"] as const;
const MAINTENANCE_JOB_QUEUES = ["maintenance"] as const;

const POLICY: Record<ResourceGovernorMode, {
  requestCapacityScale: number;
  backgroundConcurrencyScale: number;
  allowBackgroundTasks: boolean;
  allowMaintenanceTasks: boolean;
}> = {
  normal: { requestCapacityScale: 1, backgroundConcurrencyScale: 1, allowBackgroundTasks: true, allowMaintenanceTasks: true },
  busy: { requestCapacityScale: .72, backgroundConcurrencyScale: .7, allowBackgroundTasks: true, allowMaintenanceTasks: false },
  saturated: { requestCapacityScale: .4, backgroundConcurrencyScale: .25, allowBackgroundTasks: false, allowMaintenanceTasks: false },
  critical: { requestCapacityScale: .15, backgroundConcurrencyScale: 0, allowBackgroundTasks: false, allowMaintenanceTasks: false },
};

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/**
 * Cluster's automatic resource governor.
 *
 * The governor never changes correctness rules. It only controls admission and
 * background parallelism so interactive work remains responsive under pressure.
 * Escalation is immediate; recovery is deliberately hysteretic to avoid flapping.
 */
export class ResourceGovernor {
  private mode: ResourceGovernorMode = "normal";
  private observedMode: ResourceGovernorMode = "normal";
  private changedAt = new Date();
  private recoveryCandidateSince: Date | null = null;
  private queue: BackgroundJobQueueCounts | null = null;
  private lastRuntime: ResourceGovernorSnapshot["runtime"] = {
    cpuPercent: 0,
    eventLoopUtilization: 0,
    eventLoopP95Ms: 0,
    heapRatio: 0,
    databaseUtilization: 0,
    databaseWaitingConnections: 0,
    requestP95Ms: 0,
  };
  private reasons: string[] = [];

  constructor(private readonly options: {
    recoveryHoldMs?: number;
    maximumJobConcurrency?: number;
    profile?: ResourceGovernorProfile;
  } = {}) {}

  profile(): ResourceGovernorProfile {
    return normalizeServerResourceProfile(this.options.profile);
  }

  private maximumJobConcurrency(): number {
    return boundedNumber(this.options.maximumJobConcurrency ?? process.env.CLUSTER_JOB_WORKER_MAX_CONCURRENCY, 1, 128, 128);
  }

  private recoveryHoldMs(): number {
    return boundedNumber(this.options.recoveryHoldMs ?? process.env.CLUSTER_RESOURCE_RECOVERY_HOLD_MS, 1_000, 120_000, 7_500);
  }

  observe(runtime: RuntimeTelemetrySnapshot, queue?: BackgroundJobQueueCounts | null) {
    if (queue) this.queue = { ...queue };
    const saturation = assessRuntimeSaturation(runtime);
    this.observedMode = saturation.state;
    this.reasons = [...saturation.reasons];

    const heapRatio = runtime.memory.heapLimitMiB > 0 ? runtime.memory.heapUsedMiB / runtime.memory.heapLimitMiB : 0;
    this.lastRuntime = {
      cpuPercent: runtime.process.cpuPercent,
      eventLoopUtilization: runtime.eventLoop.utilization,
      eventLoopP95Ms: runtime.eventLoop.p95Ms,
      heapRatio: Number(heapRatio.toFixed(4)),
      databaseUtilization: runtime.database.utilization,
      databaseWaitingConnections: runtime.database.waitingConnections,
      requestP95Ms: runtime.requests.p95Ms,
    };

    // A very deep durable queue is useful as a throughput signal only while the
    // interactive runtime is healthy. It must never override overload backoff.
    if (this.queue && this.mode === "normal" && this.queue.queued >= Math.max(64, availableParallelism() * 16)) {
      this.reasons.push("durable-queue-deep");
    }

    const currentRank = RANK[this.mode];
    const observedRank = RANK[saturation.state];
    if (observedRank > currentRank) {
      this.setMode(saturation.state);
      this.recoveryCandidateSince = null;
    } else if (observedRank < currentRank) {
      const now = new Date();
      if (!this.recoveryCandidateSince) this.recoveryCandidateSince = now;
      const recoveryHoldMs = this.recoveryHoldMs();
      if (now.getTime() - this.recoveryCandidateSince.getTime() >= recoveryHoldMs) {
        // Recover one level at a time to avoid immediately flooding a node that
        // has only just returned to healthy telemetry.
        const nextRank = Math.max(observedRank, currentRank - 1);
        const next = (Object.keys(RANK) as ResourceGovernorMode[]).find((key) => RANK[key] === nextRank) || saturation.state;
        this.setMode(next);
        this.recoveryCandidateSince = next === saturation.state ? null : now;
      }
    } else {
      this.recoveryCandidateSince = null;
    }
    return this.snapshot();
  }

  updateQueue(queue: BackgroundJobQueueCounts | null) {
    this.queue = queue ? { ...queue } : null;
    return this.snapshot();
  }

  requestCapacityScale() {
    return POLICY[this.mode].requestCapacityScale;
  }

  jobConcurrency(baseConcurrency: number) {
    const base = Math.max(1, Math.round(baseConcurrency || 1));
    const configuredMax = this.maximumJobConcurrency();
    return computeGovernedJobConcurrency({
      base,
      mode: this.mode,
      policyScale: POLICY[this.mode].backgroundConcurrencyScale,
      profile: this.profile(),
      workerCap: configuredMax,
      queued: this.queue?.queued ?? null,
    });
  }

  allowsTask(workloadClass: "interactive" | "background" | "maintenance") {
    if (workloadClass === "interactive") return true;
    if (workloadClass === "maintenance") return POLICY[this.mode].allowMaintenanceTasks;
    return POLICY[this.mode].allowBackgroundTasks;
  }

  allowedJobQueues() {
    const queues: string[] = [...INTERACTIVE_JOB_QUEUES];
    if (POLICY[this.mode].allowBackgroundTasks) queues.push(...BACKGROUND_JOB_QUEUES);
    if (POLICY[this.mode].allowMaintenanceTasks) queues.push(...MAINTENANCE_JOB_QUEUES);
    return queues;
  }

  admissionFor(workClass: RequestWorkClass) {
    if (this.mode === "critical") return { allow: false, retryAfterSeconds: 5, reason: "runtime-critical" };
    if (this.mode === "saturated" && workClass !== "normal") {
      return { allow: false, retryAfterSeconds: 3, reason: "protect-interactive-capacity" };
    }
    return { allow: true, retryAfterSeconds: null, reason: null };
  }

  /** Read the mode for response headers without allocating a full diagnostics snapshot. */
  currentMode(): ResourceGovernorMode { return this.mode; }

  snapshot(): ResourceGovernorSnapshot {
    const policy = POLICY[this.mode];
    return {
      mode: this.mode,
      observedMode: this.observedMode,
      profile: this.profile(),
      maximumJobConcurrency: this.maximumJobConcurrency(),
      recoveryHoldMs: this.recoveryHoldMs(),
      changedAt: this.changedAt.toISOString(),
      recoveryCandidateSince: this.recoveryCandidateSince?.toISOString() || null,
      requestCapacityScale: policy.requestCapacityScale,
      backgroundConcurrencyScale: policy.backgroundConcurrencyScale,
      allowBackgroundTasks: policy.allowBackgroundTasks,
      allowMaintenanceTasks: policy.allowMaintenanceTasks,
      allowedJobQueues: this.allowedJobQueues(),
      queue: this.queue ? { ...this.queue } : null,
      runtime: { ...this.lastRuntime },
      reasons: [...this.reasons],
    };
  }

  private setMode(mode: ResourceGovernorMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.changedAt = new Date();
  }
}

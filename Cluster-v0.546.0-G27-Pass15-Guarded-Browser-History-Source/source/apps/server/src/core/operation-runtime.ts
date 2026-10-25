import type { ClusterOperation, ClusterOperationRequest, ClusterOperationStatus } from "@cluster/shared";
import type { BackgroundJobAttemptRecord, BackgroundJobRecord } from "../domains/jobs/job-types.js";
import { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import { currentReliabilityContext } from "./reliability-context.js";

const STATUS_MAP: Record<BackgroundJobRecord["status"], ClusterOperationStatus> = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  DEAD_LETTER: "dead-letter",
  CANCELLED: "cancelled",
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function backgroundJobToOperation(
  job: BackgroundJobRecord,
  options: { includePayload?: boolean; includeResult?: boolean; attempts?: BackgroundJobAttemptRecord[] } = {},
): ClusterOperation {
  return {
    id: job.id,
    type: job.type,
    queue: job.queue,
    status: STATUS_MAP[job.status],
    workspaceId: job.workspaceId,
    createdById: job.createdById,
    trace: {
      correlationId: job.correlationId || job.id,
      causationId: job.causationId || null,
      requestId: null,
    },
    priority: job.priority,
    costUnits: job.costUnits,
    progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
    progressMessage: job.progressMessage,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: iso(job.runAfter) || new Date(0).toISOString(),
    cancelRequestedAt: iso(job.cancelRequestedAt),
    lastError: job.lastError,
    createdAt: iso(job.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(job.updatedAt) || new Date(0).toISOString(),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    ...(options.includePayload ? { payload: parseJson(job.payload) } : {}),
    ...(options.includeResult ? { result: parseJson(job.result) } : {}),
    ...(options.attempts ? {
      attemptHistory: options.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        workerId: attempt.workerId,
        status: attempt.status,
        startedAt: iso(attempt.startedAt) || new Date(0).toISOString(),
        finishedAt: iso(attempt.finishedAt),
        durationMs: attempt.durationMs,
        error: attempt.error,
      })),
    } : {}),
  };
}

/**
 * Canonical long-running-operation facade. BackgroundJob remains the durable
 * execution store; product domains consume this abstraction instead of
 * inventing another queue/run/progress lifecycle.
 */
export class ClusterOperationRuntime {
  constructor(private readonly queue: BackgroundJobQueue) {}

  async enqueue<TPayload = unknown>(input: ClusterOperationRequest<TPayload>) {
    const reliability = currentReliabilityContext();
    const runAfter = input.runAfter instanceof Date ? input.runAfter : input.runAfter ? new Date(input.runAfter) : undefined;
    const job = await this.queue.enqueue({
      type: input.type,
      queue: input.queue,
      workspaceId: input.workspaceId ?? reliability?.workspaceId ?? null,
      correlationId: input.trace?.correlationId ?? reliability?.correlationId ?? null,
      causationId: input.trace?.causationId ?? reliability?.causationId ?? null,
      payload: input.payload,
      priority: input.priority,
      costUnits: input.costUnits,
      maxAttempts: input.maxAttempts,
      runAfter,
      dedupeKey: input.dedupeKey,
      createdById: input.createdById ?? reliability?.userId ?? null,
      authorization: input.authorization ?? null,
    });
    return backgroundJobToOperation(job);
  }

  async get(operationId: string) {
    const record = await this.queue.get(operationId);
    return record ? backgroundJobToOperation(record.job, { includePayload: true, includeResult: true, attempts: record.attempts }) : null;
  }

  async list(input: { status?: string; queue?: string; type?: string; limit?: number } = {}) {
    const jobs = await this.queue.list(input);
    return jobs.map((job) => backgroundJobToOperation(job));
  }

  async cancel(operationId: string) {
    const job = await this.queue.cancel(operationId);
    return job ? backgroundJobToOperation(job) : null;
  }

  async retry(operationId: string) {
    const job = await this.queue.retry(operationId);
    return job ? backgroundJobToOperation(job) : null;
  }

  async runNow(operationId: string) {
    const job = await this.queue.runNow(operationId);
    return job ? backgroundJobToOperation(job) : null;
  }
}

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { runWithReliabilityContext } from "../../core/reliability-context.js";
import {
  BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY,
  BackgroundJobAuthorizationError,
  BackgroundJobCancelledError,
  BackgroundJobDeferredError,
  BackgroundJobLeaseLostError,
  type BackgroundJobAuthorizationRequirement,
  type BackgroundJobExecutionAuthorizer,
  type BackgroundJobHandler,
  type BackgroundJobRecord,
} from "./job-types.js";
import { BackgroundJobQueue } from "./job-queue-service.js";

type WorkerLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
};

export type DurableJobWorkerSnapshot = {
  workerId: string;
  queues: string[];
  concurrency: number;
  running: number;
  pendingClaimBatches: number;
  claimed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  deferred: number;
  leaseLost: number;
  unknownTypes: number;
  authorizationDenied: number;
  /** Claims whose handler could not acknowledge an outcome to the queue. Recovered by lease expiry. */
  unacknowledgedErrors: number;
  executionAuthorizationEnabled: boolean;
  lastClaimedAt: string | null;
  lastFinishedAt: string | null;
  registeredTypes: string[];
  /** Job types paused by disabled tool policy at snapshot time. */
  blockedTypes: string[];
};

export class DurableJobWorker {
  readonly workerId: string;
  private readonly handlers = new Map<string, BackgroundJobHandler>();
  private readonly active = new Set<Promise<void>>();
  /** A DB claim can be pending when shutdown starts. Drain must wait for it,
   * not just handlers that have already been added to active. */
  private readonly claiming = new Set<Promise<number>>();
  private stopped = false;
  private claimed = 0;
  private succeeded = 0;
  private failed = 0;
  private cancelled = 0;
  private deferred = 0;
  private leaseLost = 0;
  private unknownTypes = 0;
  private authorizationDenied = 0;
  private unacknowledgedErrors = 0;
  private executionAuthorizer: BackgroundJobExecutionAuthorizer | null = null;
  private lastClaimedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;

  constructor(
    private readonly queue: BackgroundJobQueue,
    private readonly options: {
      queues?: string[] | (() => string[]);
      concurrency?: number | (() => number);
      leaseMs?: number;
      workspaceConcurrency?: number | (() => number);
      workspaceCostBudget?: number | (() => number);
      cancellationPollMs?: number;
      logger?: WorkerLogger;
      workerId?: string;
      /** Types owned by disabled tools. Never claim them until re-enabled. */
      blockedTypes?: () => string[];
      /** Fresh authoritative gate for registered tool-owned job types. Runs after
       * authorization and before invoking the handler; false defers the lease
       * without treating an availability hold as an attempted failure. */
      verifyExecutionAvailability?: (type: string) => Promise<boolean>;
      /** Payload-specific ownership for mixed-purpose job types (e.g. Ticket
       * automation inside the shared Project automation queue). */
      verifyContextAvailability?: (type: string, payload: unknown) => Promise<boolean>;
    } = {},
  ) {
    this.workerId = options.workerId || `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  }

  /** Diagnostics must never determine whether a committed queue state is
   * acknowledged, or escape from detached heartbeat/cancellation timers. */
  private log(level: keyof WorkerLogger, payload: unknown, message: string) {
    try {
      // Logger implementations may return a Promise even when typed as void.
      // Observe that rejection immediately, including inside detached timers.
      const outcome: unknown = this.options.logger?.[level]?.(payload, message);
      if (outcome && typeof (outcome as { then?: unknown }).then === "function") {
        void Promise.resolve(outcome).catch(() => undefined);
      }
    } catch { /* logging is best-effort; durable PostgreSQL state is authoritative */ }
  }

  register<TPayload = unknown>(type: string, handler: BackgroundJobHandler<TPayload>) {
    const key = String(type || "").trim().toLowerCase();
    if (!key) throw new Error("Background job handler type is required.");
    if (this.handlers.has(key)) throw new Error(`Background job handler already registered for ${key}.`);
    this.handlers.set(key, handler as BackgroundJobHandler);
    return this;
  }

  registeredTypes() {
    return [...this.handlers.keys()].sort();
  }

  setExecutionAuthorizer(authorizer: BackgroundJobExecutionAuthorizer | null) {
    this.executionAuthorizer = authorizer;
    return this;
  }

  runBatch(): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    // Claiming awaits PostgreSQL before it adds a handler to `active`. Two
    // overlapping claim cycles can otherwise both see an empty active set and
    // exceed the configured concurrency, workspace budget, and resource limits.
    // Coalesce admission cycles rather than duplicating claim transactions.
    if (this.claiming.size > 0) return Promise.resolve(0);
    const batch = this.claimBatch();
    this.claiming.add(batch);
    // Keep the original rejection available to the caller; the observer must
    // handle it separately so cleanup never creates an unhandled rejection.
    void batch.finally(() => this.claiming.delete(batch)).catch(() => undefined);
    return batch;
  }

  private async claimBatch(): Promise<number> {
    if (this.stopped) return 0;
    const concurrency = this.effectiveConcurrency();
    const queues = this.effectiveQueues();
    if (concurrency <= 0 || !queues.length) return 0;
    let started = 0;
    while (!this.stopped && this.active.size < concurrency) {
      const job = await this.queue.claim(
        this.workerId,
        this.options.leaseMs ?? 60_000,
        queues,
        this.effectiveWorkspaceConcurrency(concurrency),
        this.effectiveWorkspaceCostBudget(concurrency),
        this.options.blockedTypes?.() ?? [],
      );
      if (!job) break;
      if (this.stopped) {
        // The claim finished after draining began. Do not launch a handler or
        // consume an attempt for work that never started. If the database is
        // unavailable the fenced lease expires and another worker can recover.
        try {
          const status = await this.queue.deferDisabled(job, this.workerId, 1_000);
          if (status === "DEFERRED") this.deferred += 1;
          else if (status === "CANCELLED") this.cancelled += 1;
          else this.leaseLost += 1;
        } catch (error) {
          this.log("warn", { error, jobId: job.id }, "unstarted job claim could not be released during shutdown");
        }
        break;
      }
      started += 1;
      this.claimed += 1;
      this.lastClaimedAt = new Date();
      // Handler execution is intentionally fire-and-forget until drain(). Its
      // database finalization can itself throw (for example while PostgreSQL is
      // restarting). Observe every rejection *now*, not only if drain is later
      // called: an unhandled rejection could otherwise kill the entire server.
      // Never acknowledge success/failure without an actual queue commit; the
      // still-leased job is recovered through the ordinary expiration path.
      const execution = this.execute(job).catch((error: unknown) => {
        this.unacknowledgedErrors += 1;
        try {
          this.log("warn", { error, jobId: job.id, type: job.type }, "background job outcome could not be acknowledged; lease recovery required");
        } catch { /* diagnostics must not crash a durable worker */ }
      });
      const promise = execution.finally(() => this.active.delete(promise));
      this.active.add(promise);
    }
    // Do not wait for the slowest job in the current cohort. The caller polls
    // runBatch repeatedly, so returning immediately lets newly freed slots be
    // refilled while long-running siblings continue in the background.
    return started;
  }

  stop() {
    this.stopped = true;
  }

  async drain() {
    this.stopped = true;
    // Claims are awaited first: any claim returned after stop is released
    // without a handler, and only then can the active set be considered final.
    if (this.claiming.size) await Promise.allSettled([...this.claiming]);
    if (this.active.size) await Promise.allSettled([...this.active]);
  }

  snapshot(): DurableJobWorkerSnapshot {
    return {
      workerId: this.workerId,
      queues: this.effectiveQueues(),
      concurrency: this.effectiveConcurrency(),
      running: this.active.size,
      pendingClaimBatches: this.claiming.size,
      claimed: this.claimed,
      succeeded: this.succeeded,
      failed: this.failed,
      cancelled: this.cancelled,
      deferred: this.deferred,
      leaseLost: this.leaseLost,
      unknownTypes: this.unknownTypes,
      authorizationDenied: this.authorizationDenied,
      unacknowledgedErrors: this.unacknowledgedErrors,
      executionAuthorizationEnabled: Boolean(this.executionAuthorizer),
      lastClaimedAt: this.lastClaimedAt?.toISOString() || null,
      lastFinishedAt: this.lastFinishedAt?.toISOString() || null,
      registeredTypes: this.registeredTypes(),
      blockedTypes: this.options.blockedTypes?.() ?? [],
    };
  }


  private effectiveConcurrency() {
    const configured = typeof this.options.concurrency === "function" ? this.options.concurrency() : (this.options.concurrency ?? 2);
    return Math.max(0, Math.min(128, Math.round(Number(configured) || 0)));
  }

  private effectiveWorkspaceConcurrency(concurrency: number) {
    const configured = typeof this.options.workspaceConcurrency === "function"
      ? this.options.workspaceConcurrency()
      : this.options.workspaceConcurrency;
    const fallback = Math.max(1, Math.ceil(Math.max(1, concurrency) / 2));
    return Math.max(1, Math.min(128, Math.round(Number(configured ?? process.env.CLUSTER_JOB_WORKSPACE_CONCURRENCY ?? fallback) || fallback)));
  }

  private effectiveWorkspaceCostBudget(concurrency: number) {
    const configured = typeof this.options.workspaceCostBudget === "function"
      ? this.options.workspaceCostBudget()
      : this.options.workspaceCostBudget;
    const fallback = Math.max(8, Math.max(1, concurrency) * 8);
    return Math.max(1, Math.min(100_000, Math.round(Number(configured ?? process.env.CLUSTER_JOB_WORKSPACE_RUNNING_COST ?? fallback) || fallback)));
  }

  private effectiveQueues() {
    const configured = typeof this.options.queues === "function" ? this.options.queues() : (this.options.queues ?? ["default"]);
    return [...new Set(configured.map((queue) => String(queue || "").trim()).filter(Boolean))];
  }

  private async execute(job: BackgroundJobRecord) {
    // A concurrent tool toggle can occur between SQL claim and handler entry.
    if ((this.options.blockedTypes?.() ?? []).includes(job.type)) {
      try {
        const status = await this.queue.deferDisabled(job, this.workerId);
        if (status === "DEFERRED") this.deferred += 1;
        else if (status === "CANCELLED") this.cancelled += 1;
        else this.leaseLost += 1;
      } catch (error) {
        // The lease will expire and PostgreSQL can reclaim the job. Never
        // surface an unhandled rejection from the worker's fire-and-forget task.
        this.log("warn", { error, jobId: job.id }, "disabled job deferral failed");
      }
      this.lastFinishedAt = new Date();
      return;
    }
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.unknownTypes += 1;
      const acknowledged = await this.queue.fail(job, this.workerId, new Error(`No background job handler is registered for ${job.type}.`));
      if (acknowledged === null) this.leaseLost += 1;
      else if (acknowledged === "CANCELLED") this.cancelled += 1;
      else this.failed += 1;
      this.lastFinishedAt = new Date();
      return;
    }

    let payload: unknown = {};
    let authorizationRequirement: BackgroundJobAuthorizationRequirement | null = null;
    try {
      payload = JSON.parse(job.payload || "{}");
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const record = { ...(payload as Record<string, unknown>) };
        authorizationRequirement = (record[BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY] || null) as BackgroundJobAuthorizationRequirement | null;
        delete record[BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY];
        payload = record;
      }
    } catch {
      const acknowledged = await this.queue.fail(job, this.workerId, new Error("Background job payload is not valid JSON."));
      if (acknowledged === null) this.leaseLost += 1;
      else if (acknowledged === "CANCELLED") this.cancelled += 1;
      else this.failed += 1;
      this.lastFinishedAt = new Date();
      return;
    }

    const leaseMs = this.options.leaseMs ?? 60_000;
    const controller = new AbortController();
    const abort = (reason: Error) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    // A slow cancellation query must not spawn another query on every poll tick.
    // Coalesce the timer and handler boundary checks on the same in-flight read.
    let cancellationCheck: Promise<boolean> | null = null;
    const cancellationRequested = (): Promise<boolean> => {
      if (controller.signal.aborted) return Promise.resolve(controller.signal.reason instanceof BackgroundJobCancelledError);
      if (cancellationCheck) return cancellationCheck;
      const pending = Promise.resolve().then(() => this.queue.cancellationRequested(job.id)).then((requested) => {
        if (requested) abort(new BackgroundJobCancelledError());
        return requested;
      });
      cancellationCheck = pending;
      void pending.finally(() => { if (cancellationCheck === pending) cancellationCheck = null; }).catch(() => undefined);
      return pending;
    };
    const throwIfCancelled = async () => {
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new BackgroundJobCancelledError();
      if (await cancellationRequested()) throw controller.signal.reason instanceof Error ? controller.signal.reason : new BackgroundJobCancelledError();
    };

    // Timer ticks and explicit handler checkpoints share one lease renewal.
    // Without coalescing, slow PostgreSQL responses can pile up heartbeats for
    // the same token and distort both pool pressure and lease telemetry.
    let lastLeaseConfirmationAt = Date.now();
    let leaseRenewal: Promise<boolean> | null = null;
    const renewLease = (): Promise<boolean> => {
      if (leaseRenewal) return leaseRenewal;
      const pending = Promise.resolve().then(() => this.queue.heartbeat(job, leaseMs)).then((owned) => {
        if (owned) lastLeaseConfirmationAt = Date.now();
        return owned;
      });
      leaseRenewal = pending;
      void pending.finally(() => { if (leaseRenewal === pending) leaseRenewal = null; }).catch(() => undefined);
      return pending;
    };

    // Handlers may recheck availability before each independent unit of work.
    // Unlike aborting all running jobs on a tool toggle, these checkpoints
    // preserve atomic transfer commits while preventing further optional work.
    const throwIfToolUnavailable = async () => {
      await throwIfCancelled();
      if ((this.options.blockedTypes?.() ?? []).includes(job.type)) {
        throw new BackgroundJobDeferredError(`Job owner disabled while executing ${job.type}.`);
      }
      if (this.options.verifyExecutionAvailability && !(await this.options.verifyExecutionAvailability(job.type))) {
        throw new BackgroundJobDeferredError(`Authoritative tool availability prevents continuing ${job.type}.`);
      }
      if (this.options.verifyContextAvailability && !(await this.options.verifyContextAvailability(job.type, payload))) {
        throw new BackgroundJobDeferredError(`Tool dependency disabled for ${job.type}; preserve queued automation.`);
      }
      // Fence every retryable boundary against a reclaimed/expired lease,
      // including a new claim made by this same worker process.
      if (!(await renewLease())) {
        throw new BackgroundJobLeaseLostError(`Background job claim was lost before continuing ${job.type}.`);
      }
      await throwIfCancelled();
    };

    const leaseUncertaintyBudgetMs = Math.max(5_000, Math.floor(leaseMs * 0.6));
    const heartbeat = setInterval(() => {
      void renewLease().then((owned) => {
        if (!owned) {
          abort(new BackgroundJobLeaseLostError());
          return;
        }
      }).catch((error) => {
        const uncertainForMs = Date.now() - lastLeaseConfirmationAt;
        this.log("warn", { jobId: job.id, error, uncertainForMs, leaseMs }, "background job heartbeat failed");
        if (uncertainForMs >= leaseUncertaintyBudgetMs) {
          abort(new BackgroundJobLeaseLostError("Background job lease could not be confirmed before its safety window expired."));
        }
      });
    }, Math.max(2_500, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();

    const cancellationPoll = setInterval(() => {
      void cancellationRequested().catch((error) => {
        this.log("warn", { jobId: job.id, error }, "background job cancellation poll failed");
      });
    }, Math.max(250, Math.min(5_000, Math.round(this.options.cancellationPollMs ?? 750))));
    cancellationPoll.unref?.();

    try {
      await throwIfCancelled();
      if (authorizationRequirement) {
        if (!this.executionAuthorizer) throw new BackgroundJobAuthorizationError("Background job execution authorization is not configured.", "BACKGROUND_JOB_AUTHORIZATION_UNAVAILABLE");
        const decision = await this.executionAuthorizer({ job, requirement: authorizationRequirement });
        if (!decision.allowed) {
          this.authorizationDenied += 1;
          throw new BackgroundJobAuthorizationError(decision.reason || "Background job authorization is no longer valid.", decision.code || "BACKGROUND_JOB_AUTHORIZATION_REVOKED");
        }
      }
      // Source-of-truth gate after async authorization, immediately before the
      // handler begins. Long-running owned handlers can repeat it at safe
      // boundaries; ordinary shared maintenance remains unaffected.
      await throwIfToolUnavailable();
      const result = await runWithReliabilityContext({
        correlationId: job.correlationId || job.id,
        causationId: job.id,
        workspaceId: job.workspaceId,
        userId: job.createdById,
      }, () => handler({
        job,
        payload,
        signal: controller.signal,
        throwIfCancelled,
        throwIfToolUnavailable,
        updateProgress: async (progress, message) => {
          await throwIfCancelled();
          if (!(await this.queue.updateProgress(job, progress, message))) {
            throw new BackgroundJobLeaseLostError(`Background job lease was lost during progress update for ${job.type}.`);
          }
        },
        enqueue: (input) => this.queue.enqueue({
          ...input,
          workspaceId: input.workspaceId ?? job.workspaceId,
          correlationId: input.correlationId ?? job.correlationId ?? job.id,
          causationId: input.causationId ?? job.id,
        }),
        cancellationRequested,
      }));
      await throwIfCancelled();
      // A transport failure during SUCCEEDED acknowledgement is ambiguous: the
      // database may have committed while the reply was lost. Never interpret
      // this as a *handler* error and follow it with a conflicting FAIL write.
      // Leave the claim to expire if it was not committed; fenced retries and
      // operation-level idempotency must handle the uncertain outcome.
      let committedStatus: "SUCCEEDED" | "CANCELLED" | null;
      try {
        committedStatus = await this.queue.succeed(job, this.workerId, result);
      } catch (error) {
        this.unacknowledgedErrors += 1;
        try {
          this.log("warn", { error, jobId: job.id, type: job.type }, "background job success acknowledgement uncertain; retaining lease for recovery");
        } catch { /* logging failure cannot change queue outcome */ }
        return;
      }
      if (committedStatus === null) {
        this.leaseLost += 1;
        abort(new BackgroundJobLeaseLostError());
        return;
      }
      if (committedStatus === "CANCELLED") {
        this.cancelled += 1;
        this.log("info", { jobId: job.id, type: job.type, attempt: job.attempts }, "background job cancelled at acknowledgement");
      } else {
        this.succeeded += 1;
        this.log("info", { jobId: job.id, type: job.type, attempt: job.attempts }, "background job completed");
      }
    } catch (error) {
      if (error instanceof BackgroundJobDeferredError) {
        try {
          const status = await this.queue.deferDisabled(job, this.workerId);
        if (status === "DEFERRED") this.deferred += 1;
        else if (status === "CANCELLED") this.cancelled += 1;
        else this.leaseLost += 1;
        } catch (deferError) {
          this.log("warn", { error: deferError, jobId: job.id }, "disabled job deferral failed");
          // The unacknowledged job remains leased until expiration and can be
          // reclaimed without pretending it succeeded or consuming more work.
        }
        return;
      }
      // The transaction can observe cancellation requested after our last
      // pre-acknowledgement check. Count only the committed database status.
      const committedStatus = await this.queue.fail(job, this.workerId, error);
      if (committedStatus === null) this.leaseLost += 1;
      else if (committedStatus === "CANCELLED") this.cancelled += 1;
      else this.failed += 1;
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancellationPoll);
      this.lastFinishedAt = new Date();
    }
  }
}

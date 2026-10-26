export type BackgroundTaskLogger = {
  info?: (details: Record<string, unknown>, message: string) => void;
  warn?: (error: unknown, message: string) => void;
};

export type BackgroundTaskWorkloadClass = "interactive" | "background" | "maintenance";
export type BackgroundTaskActivity = "active" | "idle";
export type BackgroundTaskResult = void | { activity?: BackgroundTaskActivity; nextDelayMs?: number };

export type BackgroundTaskSnapshot = {
  name: string;
  owner: string | null;
  suspended: boolean;
  intervalMs: number;
  schedulingMode: "interval" | "adaptive";
  workloadClass: BackgroundTaskWorkloadClass;
  running: boolean;
  cancellationRequested: boolean;
  runs: number;
  cancelledRuns: number;
  failures: number;
  consecutiveFailures: number;
  consecutiveIdleRuns: number;
  lastActivity: BackgroundTaskActivity | null;
  skippedOverlaps: number;
  skippedPressure: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  nextRunAt: string | null;
  lastDurationMs: number | null;
  averageDurationMs: number | null;
  lastError: string | null;
};

/** A lightweight, synchronously disposable subscription owned by one tool. */
type OwnedSubscriptionRecord = {
  name: string;
  owner: string;
  subscribe: () => () => void;
  unsubscribe: (() => void) | null;
  onSuspend?: () => void;
  onResume?: () => void;
  lastError: string | null;
};

export type OwnedSubscriptionSnapshot = {
  name: string;
  owner: string;
  active: boolean;
  suspended: boolean;
  lastError: string | null;
};

/** Aggregate evidence of scheduler execution by optional tool owner.
 * This counts callbacks/timers, not process-level CPU or database usage. */
export type BackgroundOwnerSnapshot = {
  owner: string;
  enabled: boolean;
  taskCount: number;
  runningTasks: number;
  armedTimers: number;
  subscriptionCount: number;
  activeSubscriptions: number;
  totalRuns: number;
  totalCancelledRuns: number;
  totalFailures: number;
  totalDurationMs: number;
  skippedOverlaps: number;
  skippedPressure: number;
};

type TaskRecord = {
  name: string;
  owner: string | null;
  rearm: (resume: boolean, delayOverrideMs?: number) => void;
  intervalMs: number;
  schedulingMode: "interval" | "adaptive";
  workloadClass: BackgroundTaskWorkloadClass;
  timer: NodeJS.Timeout | null;
  running: boolean;
  controller: AbortController | null;
  runs: number;
  cancelledRuns: number;
  failures: number;
  consecutiveFailures: number;
  consecutiveIdleRuns: number;
  lastActivity: BackgroundTaskActivity | null;
  skippedOverlaps: number;
  skippedPressure: number;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  nextRunAt: Date | null;
  lastDurationMs: number | null;
  totalDurationMs: number;
  lastError: string | null;
  createdAt: Date;
};

type AdaptiveTaskOptions = {
  runImmediately?: boolean;
  unref?: boolean;
  jitterRatio?: number;
  maxBackoffMs?: number;
  slowTaskMs?: number;
  workloadClass?: BackgroundTaskWorkloadClass;
  /** Tool owning this timer; unlike workloadClass, the owner can be suspended. */
  owner?: string;
};

type IntervalTaskOptions = {
  runImmediately?: boolean;
  unref?: boolean;
  slowTaskMs?: number;
  workloadClass?: BackgroundTaskWorkloadClass;
  /** Tool owning this timer; unlike workloadClass, the owner can be suspended. */
  owner?: string;
};

export class BackgroundTaskRegistry {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly subscriptions = new Map<string, OwnedSubscriptionRecord>();
  private stopped = false;
  private readonly suspendedOwners = new Set<string>();
  private lastPressureOverrideAt = 0;

  constructor(
    private readonly logger: BackgroundTaskLogger = {},
    private readonly options: { admit?: (workloadClass: BackgroundTaskWorkloadClass) => boolean } = {},
  ) {}

  /** Suspend/resume tool-owned timers without dropping their registration.
   * Running callbacks receive cooperative abort signals; callers must check
   * the signal at I/O boundaries. This cannot undo an already-committed write. */
  setOwnerEnabled(owner: string, enabled: boolean) {
    if (!owner.trim()) throw new Error("Background task owner must be nonempty.");
    // A repeated reconciliation must not reschedule a task mid-flight or
    // unnecessarily move its next run, especially during periodic DB refreshes.
    if (this.isOwnerEnabled(owner) === enabled) {
      // Reconciliation is normally a no-op, but a listener whose reconnect
      // failed may be retried without touching healthy subscriptions or timers.
      if (enabled && !this.stopped) {
        for (const entry of this.subscriptions.values()) {
          if (entry.owner !== owner || entry.unsubscribe) continue;
          try { entry.onResume?.(); this.startSubscription(entry); }
          catch (error) {
            entry.lastError = error instanceof Error ? error.message : String(error);
            this.logger.warn?.(error, `tool subscription ${entry.name} retry failed`);
          }
        }
      }
      return;
    }
    if (enabled) this.suspendedOwners.delete(owner);
    else this.suspendedOwners.add(owner);
    if (this.stopped) return;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.owner !== owner) continue;
      if (enabled) {
        try {
          subscription.onResume?.();
          this.startSubscription(subscription);
        } catch (error) {
          subscription.lastError = error instanceof Error ? error.message : String(error);
          this.logger.warn?.(error, `tool subscription ${subscription.name} could not resume`);
        }
      } else {
        this.stopSubscription(subscription);
        try { subscription.onSuspend?.(); }
        catch (error) { this.logger.warn?.(error, `tool subscription ${subscription.name} suspend cleanup failed`); }
      }
    }
    for (const record of this.tasks.values()) {
      if (record.owner !== owner) continue;
      if (!enabled) {
        this.clearTimer(record);
        record.controller?.abort(new Error(`Tool ${owner} disabled`));
      } else if (!record.timer && (!record.running || record.schedulingMode === "interval")) record.rearm(true);
    }
  }

  isOwnerEnabled(owner: string) { return !this.suspendedOwners.has(owner); }

  /** The registry controls listeners as well as timers. A stopped owner has no active
   * callback registration; a resumed owner starts exactly one fresh registration.
   * subscribe must return a synchronous disposer so a disable cannot race setup. */
  registerOwnedSubscription(
    name: string,
    owner: string,
    subscribe: () => () => void,
    hooks: { onSuspend?: () => void; onResume?: () => void } = {},
  ): () => void {
    if (this.stopped) throw new Error("Background task registry has already stopped.");
    if (!name.trim() || !owner.trim()) throw new Error("Tool subscription name and owner must be nonempty.");
    if (this.subscriptions.has(name) || this.tasks.has(name)) throw new Error(`Background resource ${name} is already registered.`);
    const record: OwnedSubscriptionRecord = { name, owner, subscribe, unsubscribe: null, ...hooks, lastError: null };
    this.subscriptions.set(name, record);
    try {
      if (this.isOwnerEnabled(owner)) this.startSubscription(record);
      else hooks.onSuspend?.();
    } catch (error) {
      this.stopSubscription(record);
      this.subscriptions.delete(name);
      throw error;
    }
    return () => {
      if (this.subscriptions.get(name) !== record) return;
      this.stopSubscription(record);
      this.subscriptions.delete(name);
    };
  }

  private startSubscription(record: OwnedSubscriptionRecord) {
    if (this.stopped || !this.isOwnerEnabled(record.owner) || record.unsubscribe) return;
    const dispose = record.subscribe();
    if (typeof dispose !== "function") throw new Error(`Tool subscription ${record.name} must return a disposer.`);
    record.unsubscribe = dispose;
    record.lastError = null;
  }

  private stopSubscription(record: OwnedSubscriptionRecord) {
    const dispose = record.unsubscribe;
    record.unsubscribe = null;
    if (!dispose) return;
    try { dispose(); }
    catch (error) {
      record.lastError = error instanceof Error ? error.message : String(error);
      this.logger.warn?.(error, `tool subscription ${record.name} dispose failed`);
    }
  }

  subscriptionSnapshots(): OwnedSubscriptionSnapshot[] {
    return [...this.subscriptions.values()].map((entry) => ({
      name: entry.name, owner: entry.owner, active: Boolean(entry.unsubscribe),
      suspended: !this.isOwnerEnabled(entry.owner), lastError: entry.lastError,
    }));
  }

  /** Inexpensive per-owner runtime evidence for the authenticated Operations UI.
   * Disabled owners remain visible even when they have no registered callbacks. */
  ownerSnapshots(): BackgroundOwnerSnapshot[] {
    const owners = new Set(this.suspendedOwners);
    for (const task of this.tasks.values()) if (task.owner) owners.add(task.owner);
    for (const subscription of this.subscriptions.values()) owners.add(subscription.owner);
    const summary = [...owners].sort().map((owner): BackgroundOwnerSnapshot => ({
      owner, enabled: !this.stopped && this.isOwnerEnabled(owner),
      taskCount: 0, runningTasks: 0, armedTimers: 0,
      subscriptionCount: 0, activeSubscriptions: 0,
      totalRuns: 0, totalCancelledRuns: 0, totalFailures: 0, totalDurationMs: 0,
      skippedOverlaps: 0, skippedPressure: 0,
    }));
    const byOwner = new Map(summary.map((item) => [item.owner, item]));
    for (const task of this.tasks.values()) {
      if (!task.owner) continue;
      const row = byOwner.get(task.owner)!;
      row.taskCount += 1;
      row.runningTasks += Number(task.running);
      row.armedTimers += Number(Boolean(task.timer));
      row.totalRuns += task.runs;
      row.totalCancelledRuns += task.cancelledRuns;
      row.totalFailures += task.failures;
      row.totalDurationMs += task.totalDurationMs;
      row.skippedOverlaps += task.skippedOverlaps;
      row.skippedPressure += task.skippedPressure;
    }
    for (const subscription of this.subscriptions.values()) {
      const row = byOwner.get(subscription.owner)!;
      row.subscriptionCount += 1;
      row.activeSubscriptions += Number(Boolean(subscription.unsubscribe));
    }
    return summary.map((row) => ({ ...row, totalDurationMs: Number(row.totalDurationMs.toFixed(1)) }));
  }

  scheduleInterval(
    name: string,
    intervalMs: number,
    task: (signal: AbortSignal) => BackgroundTaskResult | Promise<BackgroundTaskResult>,
    options: IntervalTaskOptions = {},
  ) {
    const record = this.createRecord(name, intervalMs, "interval", options.workloadClass ?? "background", options.owner);
    const run = () => this.runTask(record, task, options.slowTaskMs);
    record.rearm = (resume: boolean) => {
      if (this.stopped || this.tasks.get(name) !== record || (record.owner && !this.isOwnerEnabled(record.owner))) return;
      record.timer = setInterval(() => { void run(); }, intervalMs);
      record.nextRunAt = new Date(Date.now() + intervalMs);
      if (options.unref !== false) record.timer.unref?.();
      if (options.runImmediately && !resume) void run();
    };
    this.tasks.set(name, record);
    record.rearm(false);
    return () => this.stop(name);
  }

  scheduleAdaptive(
    name: string,
    intervalMs: number,
    task: (signal: AbortSignal) => BackgroundTaskResult | Promise<BackgroundTaskResult>,
    options: AdaptiveTaskOptions = {},
  ) {
    const record = this.createRecord(name, intervalMs, "adaptive", options.workloadClass ?? "background", options.owner);
    const schedule = (delayMs: number) => {
      if (this.stopped || this.tasks.get(name) !== record || record.timer || (record.owner && !this.isOwnerEnabled(record.owner))) return;
      const delay = Math.max(1, Math.round(delayMs));
      record.nextRunAt = new Date(Date.now() + delay);
      record.timer = setTimeout(async () => {
        record.timer = null;
        const outcome = await this.runTask(record, task, options.slowTaskMs);
        if (this.stopped || this.tasks.get(name) !== record || (record.owner && !this.isOwnerEnabled(record.owner))) return;
        const maxBackoffMs = Math.max(intervalMs, options.maxBackoffMs ?? intervalMs * 16);
        const explicitDelay = outcome.result && typeof outcome.result === "object" && Number.isFinite(outcome.result.nextDelayMs)
          ? Math.max(1, Number(outcome.result.nextDelayMs))
          : null;
        const exponent = record.consecutiveFailures > 0
          ? Math.min(record.consecutiveFailures, 6)
          : Math.min(record.consecutiveIdleRuns, 6);
        const backoff = explicitDelay ?? Math.min(maxBackoffMs, intervalMs * 2 ** exponent);
        const jitterRatio = Math.min(0.5, Math.max(0, options.jitterRatio ?? 0.08));
        const jittered = Math.min(maxBackoffMs, backoff * (1 - jitterRatio + Math.random() * jitterRatio * 2));
        schedule(jittered);
      }, delay);
      if (options.unref !== false) record.timer.unref?.();
    };
    // Resume re-arms a normal interval, rather than waking a backlog at once.
    record.rearm = (resume: boolean, delayOverrideMs?: number) => schedule(delayOverrideMs ?? (!resume && options.runImmediately ? 1 : intervalMs));
    this.tasks.set(name, record);
    record.rearm(false);
    return () => this.stop(name);
  }

  /** Re-arm an existing adaptive task after a committed schedule change.
   * Never interrupt an active check or create a second callback for the same name.
   * When a check is running it will read effective settings before its next arm.
   */
  rescheduleAdaptive(name: string, nextDelayMs: number): boolean {
    if (!Number.isSafeInteger(nextDelayMs) || nextDelayMs < 60_000 || nextDelayMs > 24 * 60 * 60_000) return false;
    const record = this.tasks.get(name);
    if (this.stopped || !record || record.schedulingMode !== "adaptive" || record.running ||
        (record.owner && !this.isOwnerEnabled(record.owner))) return false;
    this.clearTimer(record);
    record.rearm(true, nextDelayMs);
    return true;
  }

  private clearTimer(record: TaskRecord) {
    if (record.timer) {
      if (record.schedulingMode === "interval") clearInterval(record.timer);
      else clearTimeout(record.timer);
    }
    record.timer = null;
    record.nextRunAt = null;
  }

  stop(name: string) {
    const task = this.tasks.get(name);
    if (!task) return false;
    this.clearTimer(task);
    task.controller?.abort(new Error(`Background task ${name} stopped`));
    this.tasks.delete(name);
    return true;
  }

  stopAll() {
    this.stopped = true;
    for (const task of this.tasks.values()) {
      this.clearTimer(task);
      task.controller?.abort(new Error("Background task registry stopped"));
    }
    this.tasks.clear();
    for (const subscription of this.subscriptions.values()) this.stopSubscription(subscription);
    this.subscriptions.clear();
  }

  snapshots(): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()].map((task) => ({
      name: task.name,
      owner: task.owner,
      suspended: task.owner ? !this.isOwnerEnabled(task.owner) : false,
      intervalMs: task.intervalMs,
      schedulingMode: task.schedulingMode,
      workloadClass: task.workloadClass,
      running: task.running,
      cancellationRequested: Boolean(task.controller?.signal.aborted),
      runs: task.runs,
      cancelledRuns: task.cancelledRuns,
      failures: task.failures,
      consecutiveFailures: task.consecutiveFailures,
      consecutiveIdleRuns: task.consecutiveIdleRuns,
      lastActivity: task.lastActivity,
      skippedOverlaps: task.skippedOverlaps,
      skippedPressure: task.skippedPressure,
      lastStartedAt: task.lastStartedAt?.toISOString() || null,
      lastFinishedAt: task.lastFinishedAt?.toISOString() || null,
      nextRunAt: task.nextRunAt?.toISOString() || null,
      lastDurationMs: task.lastDurationMs,
      averageDurationMs: task.runs ? Number((task.totalDurationMs / task.runs).toFixed(1)) : null,
      lastError: task.lastError,
    }));
  }

  private createRecord(name: string, intervalMs: number, schedulingMode: "interval" | "adaptive", workloadClass: BackgroundTaskWorkloadClass, owner?: string): TaskRecord {
    if (this.stopped) throw new Error("Background task registry has already stopped.");
    if (!name.trim()) throw new Error("Background task name is required.");
    if (owner !== undefined && !owner.trim()) throw new Error("Background task owner must be nonempty.");
    if (this.tasks.has(name) || this.subscriptions.has(name)) throw new Error(`Background resource ${name} is already registered.`);
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("Background task interval must be positive.");
    return {
      name,
      owner: owner ?? null,
      rearm: () => {},
      intervalMs,
      schedulingMode,
      workloadClass,
      timer: null,
      running: false,
      controller: null,
      runs: 0,
      cancelledRuns: 0,
      failures: 0,
      consecutiveFailures: 0,
      consecutiveIdleRuns: 0,
      lastActivity: null,
      skippedOverlaps: 0,
      skippedPressure: 0,
      lastStartedAt: null,
      lastFinishedAt: null,
      nextRunAt: null,
      lastDurationMs: null,
      totalDurationMs: 0,
      lastError: null,
      createdAt: new Date(),
    };
  }

  private async runTask(record: TaskRecord, task: (signal: AbortSignal) => BackgroundTaskResult | Promise<BackgroundTaskResult>, slowTaskMs?: number): Promise<{ result: BackgroundTaskResult }> {
    if (this.stopped || this.tasks.get(record.name) !== record || (record.owner && !this.isOwnerEnabled(record.owner))) return { result: undefined };
    if (record.running) {
      record.skippedOverlaps += 1;
      return { result: undefined };
    }
    if (this.options.admit && !this.options.admit(record.workloadClass)) {
      record.skippedPressure += 1;
      const now = Date.now();
      const anchor = record.lastFinishedAt || record.lastStartedAt || record.createdAt;
      const maxDeferralMs = record.workloadClass === "maintenance"
        ? Math.max(30 * 60_000, record.intervalMs * 4)
        : Math.max(5 * 60_000, record.intervalMs * 4);
      const agedOut = now - anchor.getTime() >= maxDeferralMs;
      // A single aged task may pierce pressure admission every two seconds. That keeps background
      // maintenance alive without allowing a hidden/idle backlog to wake up as one giant burst.
      if (!agedOut || now - this.lastPressureOverrideAt < 2_000) return { result: undefined };
      this.lastPressureOverrideAt = now;
      this.logger.info?.({ name: record.name, workloadClass: record.workloadClass, deferredMs: now - anchor.getTime(), skippedPressure: record.skippedPressure }, "background task admitted after pressure deferral budget");
    }
    record.running = true;
    const controller = new AbortController();
    record.controller = controller;
    record.runs += 1;
    record.lastStartedAt = new Date();
    const startedAt = performance.now();
    let result: BackgroundTaskResult = undefined;
    try {
      result = await task(controller.signal);
      record.lastError = null;
      record.consecutiveFailures = 0;
      if (controller.signal.aborted) {
        // An owner shutdown is not successful active work or an idle cycle.
        record.cancelledRuns += 1;
        record.lastActivity = null;
        record.consecutiveIdleRuns = 0;
      } else {
        const activity = result && typeof result === "object" && result.activity ? result.activity : "active";
        record.lastActivity = activity;
        record.consecutiveIdleRuns = activity === "idle" ? record.consecutiveIdleRuns + 1 : 0;
      }
    } catch (error) {
      const abortError = controller.signal.aborted && (error === controller.signal.reason
        || (error instanceof Error && error.name === "AbortError"));
      if (abortError) {
        record.cancelledRuns += 1;
        record.lastError = null;
        record.lastActivity = null;
        record.consecutiveIdleRuns = 0;
      } else {
        record.failures += 1;
        record.consecutiveFailures += 1;
        record.consecutiveIdleRuns = 0;
        record.lastActivity = null;
        record.lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn?.(error, `background task ${record.name} failed`);
      }
    } finally {
      if (record.controller === controller) record.controller = null;
      const durationMs = Number((performance.now() - startedAt).toFixed(1));
      record.running = false;
      record.lastFinishedAt = new Date();
      record.lastDurationMs = durationMs;
      record.totalDurationMs += durationMs;
      if (slowTaskMs && durationMs >= slowTaskMs) {
        this.logger.info?.({ name: record.name, durationMs, slowTaskMs }, "background task exceeded its expected duration");
      }
      if (record.schedulingMode === "interval") record.nextRunAt = !this.stopped && this.tasks.get(record.name) === record && (!record.owner || this.isOwnerEnabled(record.owner))
        ? new Date(Date.now() + record.intervalMs) : null;
    }
    return { result };
  }
}

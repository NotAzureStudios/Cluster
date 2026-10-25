import { dueCalendarReminderOccurrence } from "../domains/planning/calendar-reminder-occurrences.js";
import { availableParallelism } from "node:os";
import type { BackgroundTaskRegistry } from "../core/background-tasks.js";
import { BackgroundJobQueue, subscribeBackgroundJobQueueWake } from "../domains/jobs/job-queue-service.js";
import { DurableJobWorker } from "../domains/jobs/job-worker.js";
import { BackgroundJobDeferredError } from "../domains/jobs/job-types.js";
import { automationJobRequiredToolOwners, disabledStudioToolJobTypes, studioToolForDurableJobType } from "../domains/jobs/job-tool-ownership.js";
import { TOOL_AVAILABILITY } from "../domains/access/configurable-tool-availability.js";
import { createStudioAnnouncementDelivery } from "../domains/studio-systems/studio-announcement-delivery.js";
import { runStudioAccessExpiryTick } from "../domains/users/studio-access-expiry-lifecycle.js";
import { runInventoryCredentialExpiryTick } from "../domains/inventory/inventory-credential-expiry-lifecycle.js";
import type { ResourceGovernor } from "../core/resource-governor.js";

type JobRuntimeLogger = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type AutomationService = {
  evaluateOverdue?: () => Promise<unknown>;
  evaluateScheduled?: () => Promise<unknown>;
  executeDurableJob?: (payload: unknown, attempt: number) => Promise<unknown>;
  evaluateCalendarTriggers?: (now?: Date, checkAvailability?: () => Promise<void>) => Promise<unknown>;
};

type IntegrationDeliveryService = {
  deliver?: (deliveryId: string, attempt: number, maxAttempts: number) => Promise<unknown>;
  recoverPending?: (limit?: number) => Promise<unknown>;
};

type NotificationLifecycleService = {
  scheduleDueDigests?: (enqueue: (input: any) => Promise<any>, now?: Date) => Promise<unknown>;
  deliverScheduledDigest?: (deliveryId: string, now?: Date) => Promise<unknown>;
  escalateActionRequired?: (now?: Date) => Promise<unknown>;
  pruneLifecycle?: (now?: Date) => Promise<unknown>;
  invalidateSummary?: (userId?: string | null) => void;
};

type StudioOnboardingLifecycleService = {
  runLifecycle?: (input?: { now?: Date; limit?: number }) => Promise<unknown>;
};

type StudioFormReminderService = {
  runLifecycle?: (input?: { now?: Date; maxDeliveries?: number }) => Promise<unknown>;
};

type StudioKnowledgeLifecycleService = {
  runLifecycle?: (input?: { now?: Date }) => Promise<unknown>;
};

function periodicJobKey(type: string, intervalMs: number) {
  return `${type}:${Math.floor(Date.now() / intervalMs)}`;
}

export function createServerJobRuntime(input: {
  prisma: any;
  logger: JobRuntimeLogger;
  backgroundTasks: BackgroundTaskRegistry;
  /** Authoritative Studio Settings read; bypass cache for the execution gate. */
  readSettings: (force: boolean) => Promise<Record<string, unknown>>;
  projectAutomation: AutomationService;
  studioAutomation: AutomationService;
  notifications?: NotificationLifecycleService;
  onboarding?: StudioOnboardingLifecycleService;
  forms?: StudioFormReminderService;
  knowledge?: StudioKnowledgeLifecycleService;
  announcements?: { runDue: (input?: { now?: Date; limit?: number }) => Promise<unknown> };
  calendarReminders?: { runDue: (input?: { now?: Date; limit?: number }) => Promise<unknown> };
  integrations?: IntegrationDeliveryService;
  queue?: BackgroundJobQueue;
  resourceGovernor?: ResourceGovernor;
}) {
  // Diagnostics are not a control plane. A throwing or asynchronously rejecting
  // log sink must not turn a failed claim into a permanently stopped scheduler,
  // or convert uncertain policy evidence into permission to execute a job.
  const log = (level: "info" | "warn" | "error", payload: unknown, message: string) => {
    try {
      const outcome: unknown = input.logger[level](payload, message);
      if (outcome && typeof (outcome as { then?: unknown }).then === "function") {
        void Promise.resolve(outcome).catch(() => undefined);
      }
    } catch { /* queue state and policy decisions are authoritative */ }
  };
  const queue = input.queue ?? new BackgroundJobQueue(input.prisma, {
    info: input.logger.info,
    warn: input.logger.warn,
  });
  const configuredConcurrency = Number.parseInt(String(process.env.CLUSTER_JOB_WORKER_CONCURRENCY || ""), 10);
  const defaultConcurrency = Math.max(2, Math.min(32, availableParallelism()));
  const workerConcurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.min(128, configuredConcurrency) : defaultConcurrency;
  // Keep disabled tool work in PostgreSQL; claiming then “skipping” is data loss.
  const blockedOwnedTypes = () => disabledStudioToolJobTypes((tool) => input.backgroundTasks.isOwnerEnabled(tool));
  const worker = new DurableJobWorker(queue, {
    blockedTypes: blockedOwnedTypes,
    verifyExecutionAvailability: async (type) => {
      const owner = studioToolForDurableJobType(type);
      if (!owner) return true; // Shared maintenance must not inherit a tool switch.
      try {
        const current = await input.readSettings(true);
        return current[TOOL_AVAILABILITY[owner].flag] !== false;
      } catch (error) {
        log("warn", { error, type, owner }, "tool availability verification failed; deferring owned job");
        return false; // Uncertain policy is never permission to start new work.
      }
    },
    verifyContextAvailability: async (type, payload) => {
      const owners = automationJobRequiredToolOwners(type, payload);
      if (!owners.length) return true;
      try {
        const settings = await input.readSettings(true);
        return owners.every((owner) => settings[TOOL_AVAILABILITY[owner].flag] !== false);
      } catch (error) {
        log("warn", { error, type, owners }, "automation tool availability lookup failed; deferring job");
        return false;
      }
    },
    queues: () => input.resourceGovernor?.allowedJobQueues() ?? ["default", "maintenance"],
    concurrency: () => input.resourceGovernor?.jobConcurrency(workerConcurrency) ?? workerConcurrency,
    leaseMs: 60_000,
    logger: input.logger,
  });

  let workerTimer: NodeJS.Timeout | null = null;
  let nextWorkerAt = 0;
  let workerLoopRunning = false;
  let workerStarted = false;
  let workerStartedOnce = false;
  let workerDraining = false;
  let idleDelayMs = 1_000;
  const maxIdleDelayMs = Math.max(15_000, Math.min(5 * 60_000, Number(process.env.CLUSTER_JOB_MAX_IDLE_POLL_MS || 60_000)));
  let workerLoopRuns = 0;
  let wakeCount = 0;
  let fallbackPolls = 0;
  let lastWakeAt: string | null = null;
  let lastLoopAt: string | null = null;

  const scheduleWorker = (delayMs: number, source: "wake" | "fallback" = "fallback") => {
    if (workerDraining || !workerStarted) return;
    const delay = Math.max(1, Math.round(delayMs));
    const dueAt = Date.now() + delay;
    if (workerTimer && nextWorkerAt > 0 && nextWorkerAt <= dueAt) return;
    if (workerTimer) clearTimeout(workerTimer);
    nextWorkerAt = dueAt;
    workerTimer = setTimeout(() => {
      workerTimer = null;
      nextWorkerAt = 0;
      if (source === "fallback") fallbackPolls += 1;
      void runWorkerLoop();
    }, delay);
    workerTimer.unref?.();
  };

  const runWorkerLoop = async () => {
    if (workerDraining || !workerStarted || workerLoopRunning) return;
    workerLoopRunning = true;
    workerLoopRuns += 1;
    lastLoopAt = new Date().toISOString();
    try {
      const started = await worker.runBatch();
      const active = worker.snapshot().running;
      if (started > 0 || active > 0) {
        idleDelayMs = 1_000;
        scheduleWorker(1_000);
      } else {
        idleDelayMs = Math.min(maxIdleDelayMs, Math.max(2_000, idleDelayMs * 2));
        scheduleWorker(idleDelayMs);
      }
    } catch (error) {
      log("warn", { error }, "durable job worker loop failed");
      idleDelayMs = Math.min(maxIdleDelayMs, Math.max(2_000, idleDelayMs * 2));
      scheduleWorker(idleDelayMs);
    } finally {
      workerLoopRunning = false;
    }
  };

  const wakeWorker = () => {
    if (workerDraining || !workerStarted) return;
    wakeCount += 1;
    lastWakeAt = new Date().toISOString();
    idleDelayMs = 1_000;
    scheduleWorker(1, "wake");
  };
  const unsubscribeQueueWake = subscribeBackgroundJobQueueWake(wakeWorker);

  worker
    .register("automation.project-overdue", async ({ updateProgress }) => {
      await updateProgress(10, "Evaluating scheduled, overdue, and retryable project automation rules");
      const result = input.projectAutomation.evaluateScheduled ? await input.projectAutomation.evaluateScheduled() : await input.projectAutomation.evaluateOverdue?.();
      await updateProgress(95, "Project automation evaluation completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("automation.project-rule", async ({ payload, job, updateProgress, cancellationRequested, throwIfToolUnavailable }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Executing project automation rule");
      await throwIfToolUnavailable();
      const result = await input.projectAutomation.executeDurableJob?.(payload, job.attempts);
      await updateProgress(95, "Project automation rule completed");
      return { executed: true, result: result ?? null };
    })
    .register("automation.studio-action", async ({ payload, job, updateProgress, cancellationRequested, throwIfToolUnavailable }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Executing studio automation action");
      await throwIfToolUnavailable();
      const result = await input.studioAutomation.executeDurableJob?.(payload, job.attempts);
      await updateProgress(95, "Studio automation action completed");
      return { executed: true, result: result ?? null };
    })
    .register("automation.calendar-scan", async ({ updateProgress, throwIfToolUnavailable }) => {
      // Already queued Calendar work must not execute after the tool is disabled.
      if (!input.backgroundTasks.isOwnerEnabled("calendar")) throw new BackgroundJobDeferredError("Calendar is disabled; preserve queued automation scan.");
      await updateProgress(10, "Evaluating Calendar automation triggers");
      const result = await input.studioAutomation.evaluateCalendarTriggers?.(new Date(), throwIfToolUnavailable);
      await updateProgress(95, "Calendar automation evaluation completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("studio.calendar-owner-reminders", async ({ updateProgress, throwIfToolUnavailable }) => {
      await throwIfToolUnavailable();
      if (!input.backgroundTasks.isOwnerEnabled("calendar")) throw new BackgroundJobDeferredError("Calendar disabled");
      await updateProgress(10, "Checking owner Calendar reminders");
      const result = await input.calendarReminders?.runDue({ limit: 500 });
      await updateProgress(95, "Owner Calendar reminders checked");
      return result ?? { examined: 0 };
    })
    .register("studio.announcement-publish-due", async ({ updateProgress }) => {
      await updateProgress(10, "Publishing due Studio announcements");
      const result = await input.announcements?.runDue({ limit: 25 });
      await updateProgress(95, "Studio announcement schedule checked");
      return result ?? { examined: 0 };
    })
    .register("system.job-history-prune", async ({ payload, updateProgress }) => {
      const retentionDays = Number((payload as { retentionDays?: unknown } | null)?.retentionDays || 30);
      await updateProgress(20, "Pruning terminal background job history");
      const removed = await queue.pruneHistory(retentionDays);
      await updateProgress(95, `Pruned ${removed} background job record(s)`);
      return { removed, retentionDays: Math.max(1, Math.min(365, Math.round(retentionDays))) };
    })
    .register("notifications.digest-scan", async ({ updateProgress, enqueue }) => {
      await updateProgress(10, "Scanning users for due notification digests");
      const result = await input.notifications?.scheduleDueDigests?.(enqueue, new Date());
      await updateProgress(95, "Notification digest scan completed");
      return { scanned: true, result: result ?? null };
    })
    .register("notifications.digest-deliver", async ({ payload, updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      const deliveryId = String((payload as { deliveryId?: unknown } | null)?.deliveryId || "").trim();
      if (!deliveryId) throw new Error("Notification digest delivery ID is required.");
      await updateProgress(15, "Building scheduled notification digest");
      const result = await input.notifications?.deliverScheduledDigest?.(deliveryId, new Date());
      await updateProgress(95, "Notification digest delivery completed");
      return { delivered: true, result: result ?? null };
    })
    .register("notifications.escalation-sweep", async ({ updateProgress }) => {
      await updateProgress(10, "Evaluating unacknowledged action-required notifications");
      const result = await input.notifications?.escalateActionRequired?.(new Date());
      await updateProgress(95, "Notification escalation sweep completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("notifications.retention-prune", async ({ updateProgress }) => {
      await updateProgress(15, "Pruning expired notification lifecycle records");
      const result = await input.notifications?.pruneLifecycle?.(new Date());
      await updateProgress(95, "Notification retention pruning completed");
      return { pruned: true, result: result ?? null };
    })
    .register("studio.onboarding-lifecycle", async ({ updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Evaluating onboarding reminders and escalations");
      const result = await input.onboarding?.runLifecycle?.({ now: new Date(), limit: 1000 });
      await updateProgress(95, "Onboarding lifecycle evaluation completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("studio.people-access-expiry", async ({ updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Reviewing access expirations and session revocations");
      const result = await runStudioAccessExpiryTick({ prisma: input.prisma, now: new Date(), limit: 500 });
      await updateProgress(95, "Access expiry review complete");
      return result;
    })
    .register("studio.inventory-credential-expiry", async ({ updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Checking Inventory seat, assigned-key and Vault credential deadlines");
      const result = await runInventoryCredentialExpiryTick({ prisma: input.prisma, now: new Date(),
        onCommitted: (recipients) => { for (const id of recipients) input.notifications?.invalidateSummary?.(id); },
      });
      await updateProgress(95, "Credential expiry reminder review completed");
      return result;
    })
    .register("studio.form-deadline-reminders", async ({ updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Checking published Form deadlines and audiences");
      const result = await input.forms?.runLifecycle?.({ now: new Date(), maxDeliveries: 250 });
      await updateProgress(95, "Form reminder scan completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("studio.knowledge-lifecycle", async ({ updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      await updateProgress(10, "Reconciling required knowledge assignments and recertification");
      const result = await input.knowledge?.runLifecycle?.({ now: new Date() });
      await updateProgress(95, "Required knowledge lifecycle reconciliation completed");
      return { evaluated: true, result: result ?? null };
    })
    .register("integrations.webhook-deliver", async ({ payload, job, updateProgress, cancellationRequested }) => {
      if (await cancellationRequested()) return { cancelled: true };
      const deliveryId = String((payload as { deliveryId?: unknown } | null)?.deliveryId || "").trim();
      if (!deliveryId) throw new Error("Webhook delivery ID is required.");
      await updateProgress(10, "Preparing signed webhook delivery");
      const result = await input.integrations?.deliver?.(deliveryId, job.attempts, job.maxAttempts);
      await updateProgress(95, "Webhook delivery attempt completed");
      return { delivered: true, result: result ?? null };
    })
    .register("integrations.webhook-recovery", async ({ updateProgress }) => {
      await updateProgress(10, "Recovering pending webhook deliveries");
      const result = await input.integrations?.recoverPending?.(1_000);
      await updateProgress(95, "Webhook delivery recovery completed");
      return { recovered: true, result: result ?? null };
    });

  function start() {
    // start() may be called twice by overlapping boot paths. Re-registering
    // adaptive tasks duplicates producers. A drained worker cannot restart:
    // its stop flag and wake subscription are terminal for this runtime.
    if (workerStarted && !workerDraining) return;
    if (workerStartedOnce) throw new Error("A drained durable job runtime cannot restart; create a new runtime instance.");
    workerStartedOnce = true;
    workerDraining = false;
    workerStarted = true;
    wakeWorker();
    input.backgroundTasks.scheduleAdaptive("studio-calendar-automation-enqueue", 5 * 60 * 1000, async (signal) => {
      // Avoid enqueueing fresh work when this callback raced a Tool Config disable.
      if (signal.aborted || !input.backgroundTasks.isOwnerEnabled("calendar")) return { activity: "idle" };
      await queue.enqueue({
        type: "automation.calendar-scan",
        dedupeKey: periodicJobKey("automation.calendar-scan", 5 * 60 * 1000),
        maxAttempts: 5,
        priority: -5,
      });
    }, { owner: "calendar", runImmediately: true, maxBackoffMs: 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("project-automation-enqueue", 5 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "automation.project-overdue",
        dedupeKey: periodicJobKey("automation.project-overdue", 5 * 60 * 1000),
        maxAttempts: 5,
      });
    }, { runImmediately: true, maxBackoffMs: 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("background-job-history-enqueue", 24 * 60 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "system.job-history-prune",
        queue: "maintenance",
        payload: { retentionDays: 30 },
        dedupeKey: periodicJobKey("system.job-history-prune", 24 * 60 * 60 * 1000),
        maxAttempts: 3,
        priority: -20,
      });
    }, { runImmediately: false, maxBackoffMs: 24 * 60 * 60 * 1000, workloadClass: "maintenance" });
    input.backgroundTasks.scheduleAdaptive("notification-digest-enqueue", 15 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "notifications.digest-scan",
        dedupeKey: periodicJobKey("notifications.digest-scan", 15 * 60 * 1000),
        maxAttempts: 5,
        priority: -10,
      });
    }, { runImmediately: true, maxBackoffMs: 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("notification-escalation-enqueue", 15 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "notifications.escalation-sweep",
        dedupeKey: periodicJobKey("notifications.escalation-sweep", 15 * 60 * 1000),
        maxAttempts: 5,
        priority: 10,
      });
    }, { runImmediately: true, maxBackoffMs: 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("notification-retention-enqueue", 24 * 60 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "notifications.retention-prune",
        queue: "maintenance",
        dedupeKey: periodicJobKey("notifications.retention-prune", 24 * 60 * 60 * 1000),
        maxAttempts: 3,
        priority: -20,
      });
    }, { runImmediately: false, maxBackoffMs: 24 * 60 * 60 * 1000, workloadClass: "maintenance" });
    input.backgroundTasks.scheduleAdaptive("studio-onboarding-lifecycle-enqueue", 60 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "studio.onboarding-lifecycle",
        queue: "maintenance",
        dedupeKey: "studio-onboarding-lifecycle",
        maxAttempts: 5,
        priority: 5,
      });
    }, { runImmediately: false, maxBackoffMs: 6 * 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-people-access-expiry-enqueue", 60 * 60 * 1000, async () => {
      await queue.enqueue({ type: "studio.people-access-expiry", queue: "maintenance",
        dedupeKey: periodicJobKey("studio.people-access-expiry", 60 * 60 * 1000), maxAttempts: 5, priority: 10 });
    }, { runImmediately: true, maxBackoffMs: 6 * 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-inventory-credential-expiry-enqueue", 24 * 60 * 60 * 1000, async () => {
      await queue.enqueue({ type: "studio.inventory-credential-expiry", queue: "maintenance",
        dedupeKey: periodicJobKey("studio.inventory-credential-expiry", 24 * 60 * 60 * 1000), maxAttempts: 5, priority: 5 });
    }, { runImmediately: true, maxBackoffMs: 24 * 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-calendar-owner-reminders-enqueue", 60_000, async (signal) => {
      if (signal.aborted || !input.backgroundTasks.isOwnerEnabled("calendar")) return;
      const now = new Date();
      const nearby = await input.prisma.calendarEvent.findMany({
        where: { status: "scheduled", ownerId: { not: null }, reminderMinutes: { not: null },
          startsAt: { lte: new Date(now.getTime() + 7 * 86_400_000) },
          OR: [{ recurrenceRule: { not: null }, OR: [
            { recurrenceEndDate: null }, { recurrenceEndDate: { gte: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) } },
            { occurrenceExceptions: { some: { status: "rescheduled", movedStartsAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: new Date(now.getTime() + 7 * 86_400_000) } } } },
          ] }, { startsAt: { gte: new Date(now.getTime() - 5 * 60_000) } }] },
        select: { startsAt: true, reminderMinutes: true, recurrenceRule: true, recurrenceEndDate: true, timezone: true, status: true, ownerId: true, occurrenceExceptions: { select: { occurrenceStartsAt: true, status: true, movedStartsAt: true, movedEndsAt: true } } }, take: 501,
      });
      if (!Array.isArray(nearby) || nearby.length > 500) throw new Error("CALENDAR_REMINDER_SCAN_INCOMPLETE");
      if (!nearby.some((event: any) => dueCalendarReminderOccurrence(event, now))) return;
      await queue.enqueue({ type: "studio.calendar-owner-reminders", queue: "maintenance",
        dedupeKey: periodicJobKey("studio.calendar-owner-reminders", 60_000), maxAttempts: 5, priority: 5 });
    }, { owner: "calendar", runImmediately: true, maxBackoffMs: 15 * 60_000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-announcement-schedule-enqueue", 60_000, async () => {
      const due = await input.prisma.studioAnnouncement.findFirst({ where: { status: "scheduled", scheduledAt: { lte: new Date() } }, select: { id: true } });
      if (!due) return; // Avoid an empty maintenance job every minute on idle servers.
      await queue.enqueue({ type: "studio.announcement-publish-due", queue: "maintenance",
        dedupeKey: periodicJobKey("studio.announcement-publish-due", 60_000), maxAttempts: 5, priority: 5 });
    }, { runImmediately: true, maxBackoffMs: 15 * 60_000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-form-deadline-enqueue", 60 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "studio.form-deadline-reminders", queue: "maintenance",
        dedupeKey: periodicJobKey("studio.form-deadline-reminders", 60 * 60 * 1000),
        maxAttempts: 5, priority: 5,
      });
    }, { runImmediately: true, maxBackoffMs: 6 * 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("studio-knowledge-lifecycle-enqueue", 60 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "studio.knowledge-lifecycle",
        queue: "maintenance",
        dedupeKey: periodicJobKey("studio.knowledge-lifecycle", 60 * 60 * 1000),
        maxAttempts: 5,
        priority: 5,
      });
    }, { runImmediately: true, maxBackoffMs: 6 * 60 * 60 * 1000, workloadClass: "background" });
    input.backgroundTasks.scheduleAdaptive("integration-webhook-recovery-enqueue", 5 * 60 * 1000, async () => {
      await queue.enqueue({
        type: "integrations.webhook-recovery",
        queue: "maintenance",
        dedupeKey: periodicJobKey("integrations.webhook-recovery", 5 * 60 * 1000),
        maxAttempts: 5,
        priority: -5,
      });
    }, { runImmediately: true, maxBackoffMs: 60 * 60 * 1000, workloadClass: "maintenance" });
  }

  async function drain() {
    workerDraining = true;
    workerStarted = false;
    unsubscribeQueueWake();
    if (workerTimer) clearTimeout(workerTimer);
    workerTimer = null;
    nextWorkerAt = 0;
    worker.stop();
    await worker.drain();
  }

  const snapshot = () => ({
    mode: "event-wake-plus-postgresql-queue",
    running: workerStarted && !workerDraining,
    workerLoopRunning,
    idleFallbackMs: idleDelayMs,
    maxIdleFallbackMs: maxIdleDelayMs,
    nextRunInMs: nextWorkerAt > 0 ? Math.max(0, nextWorkerAt - Date.now()) : null,
    workerLoopRuns,
    wakeCount,
    fallbackPolls,
    pausedOwnedJobTypes: blockedOwnedTypes(),
    lastWakeAt,
    lastLoopAt,
  });

  return { queue, worker, start, drain, wake: wakeWorker, snapshot };
}

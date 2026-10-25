import { createCalendarReminderLifecycle } from "../domains/planning/calendar-reminder-lifecycle.js";
import { createStudioAnnouncementDelivery } from "../domains/studio-systems/studio-announcement-delivery.js";
import { ClusterOperationRuntime } from "../core/operation-runtime.js";
import { createStudioAutomationService } from "../domains/automation/studio-automation-service.js";
import { registerStudioAutomationEventBridge, scanStudioAutomationCalendar } from "../domains/automation/studio-automation-event-bridge.js";
import { BackgroundJobQueue } from "../domains/jobs/job-queue-service.js";
import { createProjectAutomationService } from "../domains/projects/project-automation-service.js";
import { createServerJobRuntime } from "./server-job-runtime.js";
import { TOOL_AVAILABILITY } from "../domains/access/configurable-tool-availability.js";
import type { ClusterAdminConfigurableToolId } from "@cluster/shared";

export function createServerAutomationJobRuntime(input: {
  prisma: any;
  events: any;
  canViewCalendarReminderRecipient?: (user: any, event: any) => Promise<boolean>;
  logActivity: (input: any) => Promise<unknown>;
  logger: any;
  backgroundTasks: any;
  readSettings: (force: boolean) => Promise<Record<string, unknown>>;
  notifications: any;
  onboarding: { runLifecycle?: (input?: { now?: Date; limit?: number }) => Promise<unknown> };
  forms: { runLifecycle?: (input?: { now?: Date; maxDeliveries?: number }) => Promise<unknown> };
  knowledge: { runLifecycle?: (input?: { now?: Date }) => Promise<unknown> };
  integrations: { deliver?: (deliveryId: string, attempt: number, maxAttempts: number) => Promise<unknown>; recoverPending?: (limit?: number) => Promise<unknown> };
  resourceGovernor: any;
  wakePublisher?: () => void | Promise<void>;
}) {
  const jobQueue = new BackgroundJobQueue(input.prisma as any, { info: (payload, message) => input.logger.info(payload, message), warn: (payload, message) => input.logger.warn(payload, message) }, { wakePublisher: input.wakePublisher });
  // Tickets is a Studio-level kill switch, not a switch for all Project automation.
  // Check database truth to avoid another process handling a Ticket event while stale.
  const isTicketsEnabled = async () => {
    if (!input.backgroundTasks.isOwnerEnabled("tickets")) return false;
    const settings = await input.readSettings(true);
    return settings.ticketsEnabled !== false;
  };
  // Generic Project automation can create Calendar, Scheduler and Timeline
  // records too. Inspect their current Studio authority, not a stale local
  // projection. Shared Project automation is never disabled wholesale.
  const isActionToolEnabled = async (owner: ClusterAdminConfigurableToolId) => {
    if (!input.backgroundTasks.isOwnerEnabled(owner)) return false;
    const current = await input.readSettings(true);
    return current[TOOL_AVAILABILITY[owner].flag] !== false;
  };
  const projectAutomation = createProjectAutomationService({ prisma: input.prisma, events: input.events, logActivity: input.logActivity, logger: input.logger, jobQueue, isTicketsEnabled, isActionToolEnabled });
  const operationRuntime = new ClusterOperationRuntime(jobQueue);
  const studioAutomation = createStudioAutomationService({ prisma: input.prisma, logActivity: input.logActivity, logger: input.logger, jobQueue, isActionToolEnabled });
  registerStudioAutomationEventBridge({
    prisma: input.prisma, events: input.events, studioAutomation, logger: input.logger, isTicketsEnabled,
    isCalendarEnabled: async () => {
      if (!input.backgroundTasks.isOwnerEnabled("calendar")) return false;
      // Another server may have disabled Calendar before this process
      // receives the coordination message; always consult DB truth.
      const settings = await input.readSettings(true);
      return settings.calendarEnabled !== false;
    },
  });
  const jobRuntime = createServerJobRuntime({
    prisma: input.prisma,
    logger: { info: (payload, message) => input.logger.info(payload, message), warn: (payload, message) => input.logger.warn(payload, message), error: (payload, message) => input.logger.error(payload, message) },
    backgroundTasks: input.backgroundTasks,
    readSettings: input.readSettings,
    projectAutomation,
    studioAutomation: {
      ...studioAutomation,
      evaluateCalendarTriggers: (now?: Date, checkAvailability?: () => Promise<void>) =>
        scanStudioAutomationCalendar({ prisma: input.prisma, studioAutomation, now, checkAvailability }),
    },
    notifications: input.notifications,
    onboarding: input.onboarding,
    forms: input.forms,
    knowledge: input.knowledge,
    announcements: createStudioAnnouncementDelivery({ prisma: input.prisma, events: input.events }),
    calendarReminders: createCalendarReminderLifecycle({ prisma: input.prisma, events: input.events, canViewRecipient: input.canViewCalendarReminderRecipient }),
    resourceGovernor: input.resourceGovernor,
    integrations: input.integrations,
    queue: jobQueue,
  });
  return { projectAutomation, jobQueue, operationRuntime, studioAutomation, jobRuntime, jobWorker: jobRuntime.worker };
}

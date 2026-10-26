import { CLUSTER_DOMAIN_EVENTS, type ClusterDomainEvent, type ClusterStudioAutomationEvent } from "@cluster/shared";

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isTicket(card: any) {
  return card?.workItemKind === "ticket";
}

function calendarTrigger(event: any, now = new Date()): "calendar_started" | "calendar_upcoming" | null {
  const startsAt = event?.startsAt instanceof Date ? event.startsAt : new Date(event?.startsAt || 0);
  const start = startsAt.getTime();
  if (!Number.isFinite(start)) return null;
  const current = now.getTime();
  if (start <= current + 5 * 60_000 && start >= current - 60 * 60_000) return "calendar_started";
  if (start > current && start <= current + 7 * 24 * 60 * 60_000) return "calendar_upcoming";
  return null;
}

function calendarAutomationEvent(event: any, trigger: "calendar_started" | "calendar_upcoming"): ClusterStudioAutomationEvent {
  const startsAt = event.startsAt instanceof Date ? event.startsAt.toISOString() : new Date(event.startsAt).toISOString();
  return {
    id: `calendar:${trigger}:${event.id}:${startsAt}`,
    trigger,
    entityType: "calendar",
    entityId: String(event.id),
    entityLabel: String(event.title || "Calendar event"),
    projectId: event.projectId || null,
    createdAt: new Date().toISOString(),
    context: {
      startsAt,
      endsAt: event.endsAt instanceof Date ? event.endsAt.toISOString() : event.endsAt ? new Date(event.endsAt).toISOString() : null,
      eventType: event.eventType || "meeting",
      status: event.status || "scheduled",
      ownerId: event.ownerId || null,
      reminderMinutes: event.reminderMinutes ?? null,
      sourceMode: "server",
    },
  };
}

export function registerStudioAutomationEventBridge(input: {
  prisma: any;
  events: { subscribe: (type: string, key: string, handler: (event: ClusterDomainEvent<any>) => Promise<void> | void) => unknown };
  studioAutomation: { processEvent: (event: ClusterStudioAutomationEvent, actorId?: string | null) => Promise<unknown> };
  logger?: { warn?: (payload: unknown, message?: string) => void };
  /** Fresh Studio availability gate for Calendar-only automation events. */
  isCalendarEnabled?: () => Promise<boolean>;
  /** Ticket automation remains separate from Project and normal Board activity. */
  isTicketsEnabled?: () => Promise<boolean>;
}) {
  const { prisma, events, studioAutomation, logger } = input;

  events.subscribe(CLUSTER_DOMAIN_EVENTS.activityRecorded.type, "automation.studio-activity", async (domainEvent) => {
    const activity = domainEvent.payload || {};
    const metadata = parseObject(activity.metadata);
    const actorId = activity.userId || domainEvent.actorUserId || null;
    const activityId = String(activity.id || domainEvent.id || "activity");
    const entityType = String(activity.entityType || "").trim().toLowerCase();
    const activityType = String(activity.type || "").trim().toLowerCase();

    try {
      if (entityType === "project" && activityType === "created" && activity.entityId) {
        const project = await prisma.project.findUnique({ where: { id: String(activity.entityId) }, include: { memberships: { where: { status: "active" }, select: { userId: true } } } });
        if (!project) return;
        await studioAutomation.processEvent({
          id: `activity:${activityId}:project_created`,
          trigger: "project_created",
          entityType: "project",
          entityId: project.id,
          entityLabel: project.name,
          projectId: project.id,
          createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : new Date(activity.createdAt || Date.now()).toISOString(),
          context: {
            title: project.name,
            name: project.name,
            status: project.status,
            projectType: project.projectType,
            external: Boolean(project.external),
            memberIds: (project.memberships || []).map((membership: any) => String(membership.userId || "")).filter(Boolean),
          },
        }, actorId);
        return;
      }

      if (["card", "ticket"].includes(entityType) && ["updated", "moved"].includes(activityType) && activity.entityId) {
        // Avoid any Ticket lookup for explicit Ticket events when the tool is off.
        if (entityType === "ticket" && input.isTicketsEnabled && !(await input.isTicketsEnabled())) return;
        const card = await prisma.card.findUnique({
          where: { id: String(activity.entityId) },
          include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } },
        });
        if (!card || (!isTicket(card) && entityType !== "ticket")) return;
        // Some Ticket changes arrive as generic Card activity. Classify after
        // reading the card, but before invoking any Ticket automation.
        if (entityType === "card" && isTicket(card) && input.isTicketsEnabled && !(await input.isTicketsEnabled())) return;
        const trigger = activityType === "moved" ? "ticket_status_changed" : "ticket_updated";
        await studioAutomation.processEvent({
          id: `activity:${activityId}:${trigger}`,
          trigger,
          entityType: "ticket",
          entityId: card.id,
          entityLabel: card.title,
          projectId: card.list.board.project.id,
          createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : new Date(activity.createdAt || Date.now()).toISOString(),
          context: {
            title: card.title,
            description: card.description || "",
            priority: card.priority,
            previousPriority: metadata.previousPriority || null,
            dueDate: card.dueDate?.toISOString?.() || null,
            labels: parseList(card.labels),
            assigneeId: card.assigneeId || null,
            revision: card.revision,
            fromListId: metadata.fromListId || null,
            toListId: metadata.toListId || card.listId,
            fromStatus: metadata.from || metadata.fromStatus || "",
            status: metadata.to || metadata.status || card.list.title,
          },
        }, actorId);
        return;
      }

      if (entityType === "custom_field_value" && ["created", "updated"].includes(activityType)) {
        const targetEntityType = String(metadata.targetEntityType || "").trim();
        const targetEntityId = String(metadata.targetEntityId || "").trim();
        const fieldId = String(metadata.fieldId || activity.message || "").trim();
        if (!targetEntityType || !targetEntityId || !fieldId) return;
        await studioAutomation.processEvent({
          id: `activity:${activityId}:custom_field_changed`,
          trigger: "custom_field_changed",
          entityType: targetEntityType,
          entityId: targetEntityId,
          entityLabel: String(metadata.entityLabel || targetEntityId),
          projectId: activity.projectId || metadata.projectId || null,
          createdAt: activity.createdAt instanceof Date ? activity.createdAt.toISOString() : new Date(activity.createdAt || Date.now()).toISOString(),
          context: {
            fieldId,
            fieldLabel: metadata.fieldLabel || fieldId,
            value: metadata.value,
          },
        }, actorId);
        return;
      }

      if (entityType === "calendar_event" && ["created", "updated"].includes(activityType) && activity.entityId) {
        // Calendar has a Studio kill switch; its event-driven automation must
        // respect it too. Keep the common bridge alive for Project/Ticket work.
        // A disabled Calendar event is intentionally not replayed on re-enable.
        if (input.isCalendarEnabled && !(await input.isCalendarEnabled())) return;
        const calendarEvent = await prisma.calendarEvent.findUnique({ where: { id: String(activity.entityId) } });
        if (!calendarEvent) return;
        const trigger = calendarTrigger(calendarEvent);
        if (!trigger) return;
        await studioAutomation.processEvent(calendarAutomationEvent(calendarEvent, trigger), actorId);
      }
    } catch (error) {
      logger?.warn?.({ err: error, activityId, entityType, activityType }, "studio automation activity bridge failed");
      throw error;
    }
  });
}

export async function scanStudioAutomationCalendar(input: {
  prisma: any;
  studioAutomation: { processEvent: (event: ClusterStudioAutomationEvent, actorId?: string | null) => Promise<unknown> };
  now?: Date;
  /** Recheck the owner's availability at bounded boundaries in large scans. */
  checkAvailability?: () => Promise<void>;
}) {
  // Check before opening a potentially large scan, not only at worker entry.
  await input.checkAvailability?.();
  const now = input.now instanceof Date ? input.now : new Date();
  const events = await input.prisma.calendarEvent.findMany({
    where: {
      startsAt: {
        gte: new Date(now.getTime() - 60 * 60_000),
        lte: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
      },
    },
    orderBy: { startsAt: "asc" },
    take: 5_000,
  });
  let evaluated = 0;
  for (let index = 0; index < events.length; index += 1) {
    // A 5,000-row scan must not run indefinitely after Calendar is disabled.
    // A bounded checkpoint avoids a DB/lease read for every individual event.
    if (index % 64 === 0) await input.checkAvailability?.();
    const event = events[index];
    const trigger = calendarTrigger(event, now);
    if (!trigger) continue;
    await input.studioAutomation.processEvent(calendarAutomationEvent(event, trigger), event.ownerId || null);
    evaluated += 1;
  }
  await input.checkAvailability?.();
  return { scanned: events.length, evaluated };
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SCHEDULING_CONTRACT, type TimelineItemInput } from "@cluster/shared";
import { minutesBetween } from "../../core/time.js";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { AuthorizationService } from "../access/authorization.js";
import { canAccessCalendarEvent } from "./calendar-access.js";

const timelineRangeQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  projectId: z.string().optional(),
  type: z.string().optional(),
});

const timelineItemInputSchema = z.object({
  projectId: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  startsAt: z.string(),
  endsAt: z.string().optional().nullable(),
  type: z.string().optional(),
  color: z.string().optional().nullable(),
  externalUrl: z.string().optional().nullable(),
});

const revisionInputSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
});

type TimelineRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  readSettings: () => Promise<Record<string, any>>;
  serializeTimelineItem: (item: any) => any;
  sendRevisionConflict: (reply: FastifyReply, entityLabel: string, current: unknown) => unknown;
  authorization: AuthorizationService;
};

function timelineItemData(body: TimelineItemInput) {
  return {
    projectId: body.projectId || null,
    title: body.title,
    description: body.description || null,
    startsAt: new Date(body.startsAt),
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    type: body.type || SCHEDULING_CONTRACT.timeline.defaultType,
    color: body.color || null,
    externalUrl: body.externalUrl || null,
  };
}

export function registerTimelineRoutes({
  app,
  prisma,
  getCurrentUser,
  logActivity,
  readSettings,
  serializeTimelineItem,
  sendRevisionConflict,
  authorization,
}: TimelineRouteDependencies) {
  async function canViewTimelineItem(request: FastifyRequest, item: any) {
    if (item.project) return authorization.requestCanTarget(request, "timeline", item.id, item.project, "view");
    return authorization.requestCanUserScope(request, { ownerUserId: item.userId, tool: "timeline", minimum: "view", allowUnowned: true });
  }

  async function canViewCalendarEvent(request: FastifyRequest, event: any) {
    return canAccessCalendarEvent(authorization, request, event, "view");
  }

  async function canViewCard(request: FastifyRequest, card: any) {
    const board = card?.list?.board;
    const project = board?.project;
    if (!board || !project || !(await authorization.requestCanTarget(request, "board", board.id, project, "view"))) return false;
    if (card.workItemKind === "ticket") {
      return authorization.requestCanTarget(request, "ticket", card.id, project, "view");
    }
    return true;
  }

  async function canViewScheduleBlock(request: FastifyRequest, block: any) {
    if (!(await authorization.requestCanUserScope(request, { ownerUserId: block.userId, tool: "scheduler", minimum: "view" }))) return false;
    return !block.project || authorization.requestCanTarget(request, "schedule", block.id, block.project, "view");
  }

  async function canViewTimeEntry(request: FastifyRequest, entry: any) {
    if (!(await authorization.requestCanUserScope(request, { ownerUserId: entry.userId, tool: "scheduler", minimum: "view" }))) return false;
    return !entry.project || authorization.requestCanTarget(request, "time", entry.id, entry.project, "view");
  }

  async function requireTimelinePlacement(request: FastifyRequest, reply: FastifyReply, body: TimelineItemInput, targetId: string) {
    if (!body.projectId) return true;
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project || project.archived) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
      return false;
    }
    return authorization.requireTarget(request, reply, "timeline", targetId, project, "contribute");
  }
  app.get("/api/timeline", async (request) => {
    const query = timelineRangeQuerySchema.parse(request.query);
    const start = query.start ? new Date(query.start) : new Date(Date.now() - SCHEDULING_CONTRACT.timeline.defaultPastDays * 24 * 60 * 60 * 1000);
    const end = query.end ? new Date(query.end) : new Date(Date.now() + SCHEDULING_CONTRACT.timeline.defaultFutureDays * 24 * 60 * 60 * 1000);
    const itemWhere: any = { startsAt: { gte: start, lte: end } };
    if (query.projectId) itemWhere.projectId = query.projectId;
    if (query.type && query.type !== "all") itemWhere.type = query.type;

    const timelineSettings = await readSettings();
    const [items, events, dueCards, scheduleBlocks, timeEntries] = await Promise.all([
      prisma.timelineItem.findMany({ where: itemWhere, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true }, orderBy: { startsAt: "asc" } }),
      timelineSettings.timelineIncludeCalendar === false ? Promise.resolve([]) : prisma.calendarEvent.findMany({
        where: { startsAt: { gte: start, lte: end }, ...(query.projectId ? { projectId: query.projectId } : {}) },
        include: { project: { include: { memberships: { where: { status: "active" } } } } },
        orderBy: { startsAt: "asc" },
      }),
      timelineSettings.timelineIncludeDueDates === false ? Promise.resolve([]) : prisma.card.findMany({
        where: { archived: false, dueDate: { gte: start, lte: end }, ...(query.projectId ? { list: { board: { projectId: query.projectId } } } : {}) },
        include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } },
        orderBy: { dueDate: "asc" },
      }),
      timelineSettings.timelineIncludeSchedule === false ? Promise.resolve([]) : prisma.scheduleBlock.findMany({
        where: { startsAt: { gte: start, lte: end }, ...(query.projectId ? { projectId: query.projectId } : {}) },
        include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true },
        orderBy: { startsAt: "asc" },
      }),
      prisma.timeEntry.findMany({
        where: { startedAt: { gte: start, lte: end }, ...(query.projectId ? { projectId: query.projectId } : {}) },
        include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true },
        orderBy: { startedAt: "asc" },
        take: SCHEDULING_CONTRACT.timeline.maximumTimeEntries,
      }),
    ]);

    const visibleItems = [];
    for (const item of items) if (await canViewTimelineItem(request, item)) visibleItems.push(item);
    const visibleEvents = [];
    for (const event of events) if (await canViewCalendarEvent(request, event)) visibleEvents.push(event);
    const visibleDueCards = [];
    for (const card of dueCards) if (await canViewCard(request, card)) visibleDueCards.push(card);
    const visibleScheduleBlocks = [];
    for (const block of scheduleBlocks) if (await canViewScheduleBlock(request, block)) visibleScheduleBlocks.push(block);
    const visibleTimeEntries = [];
    for (const entry of timeEntries) if (await canViewTimeEntry(request, entry)) visibleTimeEntries.push(entry);

    const entries = [
      ...visibleItems.map((item: any) => ({
        id: item.id, source: "manual", type: item.type, title: item.title, description: item.description,
        startsAt: item.startsAt, endsAt: item.endsAt, color: item.color || "#3b82f6", externalUrl: item.externalUrl,
        ownerId: item.userId || null, projectId: item.projectId || null,
        project: item.project ? { id: item.project.id, name: item.project.name } : null,
      })),
      ...visibleEvents.map((event: any) => ({
        id: event.id, source: "calendar", type: "calendar", title: event.title,
        description: event.description || event.location || "Calendar event", startsAt: event.startsAt, endsAt: event.endsAt,
        color: event.color || "#2563eb", externalUrl: event.externalUrl,
        project: event.project ? { id: event.project.id, name: event.project.name } : null,
      })),
      ...visibleDueCards.map((card: any) => ({
        id: card.id, source: "card", type: "due-date", title: card.title,
        description: `${card.list.board.name} · ${card.list.title} · ${card.priority}`, startsAt: card.dueDate, endsAt: null,
        color: card.priority === "urgent" ? "#ef4444" : card.priority === "high" ? "#f97316" : "#60a5fa",
        externalUrl: card.externalUrl, ownerId: card.assigneeId || null, projectId: card.list.board.project.id, boardId: card.list.board.id, listId: card.list.id,
        project: { id: card.list.board.project.id, name: card.list.board.project.name },
      })),
      ...visibleScheduleBlocks.map((block: any) => ({
        id: block.id, source: "schedule", type: block.type || "schedule", title: block.title,
        description: `${block.user?.displayName || block.user?.username || "Unassigned"}${block.description ? ` · ${block.description}` : ""}`,
        startsAt: block.startsAt, endsAt: block.endsAt, color: block.color || "#8b5cf6", externalUrl: null,
        project: block.project ? { id: block.project.id, name: block.project.name } : null,
      })),
      ...visibleTimeEntries.map((entry: any) => ({
        id: entry.id, source: "time", type: entry.endedAt ? "time-entry" : "timer-running", title: entry.title,
        description: `${entry.user?.displayName || entry.user?.username || "Unknown"} · ${minutesBetween(new Date(entry.startedAt), entry.endedAt ? new Date(entry.endedAt) : new Date())} min`,
        startsAt: entry.startedAt, endsAt: entry.endedAt, color: entry.endedAt ? "#14b8a6" : "#22c55e", externalUrl: null,
        project: entry.project ? { id: entry.project.id, name: entry.project.name } : null,
      })),
    ].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    return { entries, manualItems: visibleItems.map(serializeTimelineItem), range: { start, end } };
  });

  app.get("/api/timeline/items", async (request) => {
    const items = await prisma.timelineItem.findMany({ include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true }, orderBy: { startsAt: "asc" } });
    const visible = [];
    for (const item of items) if (await canViewTimelineItem(request, item)) visible.push(item);
    return visible.map(serializeTimelineItem);
  });

  app.get("/api/timeline/items/:itemId", async (request, reply) => {
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const item = await prisma.timelineItem.findUnique({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true } });
    if (!item) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Timeline item not found." });
    if (!(await canViewTimelineItem(request, item))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You no longer have access to this Timeline item." });
    return serializeTimelineItem(item);
  });

  app.post("/api/timeline/items", async (request, reply) => {
    const user = await getCurrentUser(request);
    const body = timelineItemInputSchema.parse(request.body);
    if (!(await requireTimelinePlacement(request, reply, body, `timeline:create:${body.projectId || user?.id || "studio"}`))) return;
    const item = await prisma.timelineItem.create({
      data: { userId: user?.id || null, ...timelineItemData(body) },
      include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true },
    });
    await logActivity({ userId: user?.id, projectId: item.projectId, type: "created", entityType: "timeline_item", entityId: item.id, title: "Timeline item created", message: item.title });
    return serializeTimelineItem(item);
  });

  app.put("/api/timeline/items/:itemId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = timelineItemInputSchema.and(revisionInputSchema).parse(request.body);
    const existing = await prisma.timelineItem.findUnique({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true } });
    if (!existing) return reply.code(404).send({ ok: false, error: "Timeline item not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== existing.revision) return sendRevisionConflict(reply, "timeline item", serializeTimelineItem(existing));
    if (!(await requireTimelinePlacement(request, reply, body, params.itemId))) return;
    const updated = await prisma.timelineItem.updateMany({
      where: { id: params.itemId, revision: existing.revision },
      data: { ...timelineItemData(body), revision: { increment: 1 } },
    });
    if (!updated.count) {
      const current = await prisma.timelineItem.findUnique({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true } });
      return sendRevisionConflict(reply, "timeline item", current ? serializeTimelineItem(current) : null);
    }
    const item = await prisma.timelineItem.findUniqueOrThrow({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true } });
    await logActivity({ userId: user?.id, projectId: item.projectId, type: "updated", entityType: "timeline_item", entityId: item.id, title: "Timeline item updated", message: item.title });
    return serializeTimelineItem(item);
  });

  app.delete("/api/timeline/items/:itemId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ itemId: z.string() }).parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(request.body || {});
    const item = await prisma.timelineItem.findUnique({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" }, select: { userId: true } } } } } });
    if (!item) return reply.code(404).send({ ok: false, error: "Timeline item not found." });
    if (body.expectedRevision !== undefined && body.expectedRevision !== item.revision) return sendRevisionConflict(reply, "timeline item", serializeTimelineItem(item));
    const timelineAudience = item.projectId
      ? JSON.stringify(Array.isArray(item.project?.memberships) ? item.project.memberships.map((membership: any) => String(membership.userId || "")).filter(Boolean) : [])
      : JSON.stringify([...new Set([item.userId, user?.id].filter(Boolean).map(String))]);
    const timelineWorkspace = item.project?.workspaceId || (await prisma.workspaceMember.findFirst({ where: { userId: user?.id || "" }, select: { workspaceId: true } }))?.workspaceId || null;
    const removed = await prisma.$transaction(async (transaction: any) => {
      const deleted = await transaction.timelineItem.deleteMany({ where: { id: params.itemId, revision: item.revision } });
      if (!deleted.count) return false;
      await transaction.syncTombstone.create({ data: { workspaceId: timelineWorkspace, projectId: item.projectId, entityType: "timeline_item", entityId: item.id, visibleToUserIds: timelineAudience } });
      return true;
    });
    if (!removed) {
      const current = await prisma.timelineItem.findUnique({ where: { id: params.itemId }, include: { project: { include: { memberships: { where: { status: "active" } } } }, user: true } });
      return sendRevisionConflict(reply, "timeline item", current ? serializeTimelineItem(current) : null);
    }
    await logActivity({ userId: user?.id, projectId: item.projectId, type: "deleted", entityType: "timeline_item", entityId: item.id, title: "Timeline item deleted", message: item.title });
    return { ok: true };
  });
}

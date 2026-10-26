import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthorizationService } from "../access/authorization.js";
import { z } from "zod";
import { SCHEDULING_CONTRACT } from "@cluster/shared";
import {
  breakMinutes as calculateBreakMinutes,
  minutesBetween,
  netEntryMinutes,
  summarizeTime,
  timeExceptions,
  validateTimeRange,
  weekKey
} from "../../core/time.js";
import { buildCursorPage, cursorWhere, decodeCursor } from "../../core/cursor-pagination.js";
import { workAssignmentActivity } from "../work/work-assignment.js";
import { createTimeRouteSerializers } from "./time-route-serialization.js";
import { scheduleBlockInclude, scheduleBlockInputSchema, timeEntryInclude } from "./time-route-contracts.js";
import { createTimeRouteAccess } from "./time-route-access.js";
import { createDecisionService } from "../decisions/decision-service.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";
import {
  acquireSchedulePlacementLocks,
  buildScheduleOccurrences,
  ensureScheduleCalendarAvailable,
  findSchedulePlacementConflicts,
  normalizeScheduleParticipants,
  normalizeScheduleTimezone,
  normalizeScheduleResourceRequests,
  parseScheduleStringList,
  replaceScheduleReservations,
  scheduleBlockUserIds,
  serializeScheduleReservations,
  serializeScheduleResource,
} from "./scheduler-planning.js";
type TimeRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, minimum?: string) => boolean;
  serializeUserLite: (user: any) => any;
  logActivity: (input: any) => Promise<any>;
  readSettings: () => Promise<Record<string, any>>;
  verifyUserPin: (user: any, pin: string, purpose: string, request?: FastifyRequest | null) => Promise<boolean>;
  authorization: AuthorizationService;
};
export function registerTimeRoutes({
  app,
  prisma,
  getCurrentUser,
  decorateUserForClient,
  hasToolPermission,
  serializeUserLite,
  logActivity,
  readSettings,
  verifyUserPin,
  authorization
}: TimeRouteDependencies) {
  const { serializeTimeBreak, serializeTimeEntry, serializeScheduleBlock, buildScheduleInsights } = createTimeRouteSerializers(serializeUserLite);
  const decisions = createDecisionService(prisma);
  const {
    weekStart: weekStartNode,
    weekEnd: weekEndNode,
    resolveBillableValue,
    isTimeManager,
    canOperateTimerForUser,
    canCorrectTimeEntry,
    canDeleteTimeEntry,
    canChangeScheduleBlock,
    targetUserIdForWrite,
    canViewTimeEntry,
    canViewScheduleBlock,
    canViewCalendarEvent,
    requireTimeReferences,
    requireExistingTimeProject,
    filterVisibleTimeEntries,
    filterVisibleScheduleBlocks,
  } = createTimeRouteAccess({ prisma, getCurrentUser, decorateUserForClient, hasToolPermission, serializeUserLite, readSettings, authorization });
app.get("/api/time/active", async (request) => {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw new Error("Login required.");
  const query = z.object({ userId: z.string().optional() }).parse(request.query || {});
  const userId = query.userId || currentUser.id;
  if (!(await canOperateTimerForUser(currentUser, userId))) throw new Error("Time manage permission required.");
  const active = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    include: timeEntryInclude,
    orderBy: { startedAt: "desc" }
  });
  return { active: active && await canViewTimeEntry(request, active) ? serializeTimeEntry(active) : null };
});
app.get("/api/time/workspace", async (request) => {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw new Error("Login required.");
  const query = z.object({
    start: z.string(),
    end: z.string(),
    userId: z.string().optional(),
    projectId: z.string().optional()
  }).parse(request.query);
  const start = new Date(query.start);
  const end = new Date(query.end);
  validateTimeRange(start, end, SCHEDULING_CONTRACT.scheduler.maximumRangeDays * 24 * 60);
  const decorated = await decorateUserForClient(currentUser);
  const canManage = Boolean(decorated?.isAdmin || hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "manage"));
  const settings = await readSettings();
  const userId = query.userId || (canManage ? undefined : currentUser.id);
  if (query.userId && query.userId !== currentUser.id && !canManage) throw new Error("Time manage permission required.");
  const entryWhere: any = { startedAt: { gte: start, lt: end } };
  if (userId) entryWhere.userId = userId;
  if (query.projectId) entryWhere.projectId = query.projectId;
  const scheduleAnd: any[] = [{ startsAt: { lt: end } }, { endsAt: { gt: start } }];
  if (userId) scheduleAnd.push({ OR: [{ userId }, { participantIds: { contains: `"${userId}"` } }] });
  if (query.projectId) scheduleAnd.push({ projectId: query.projectId });
  const scheduleWhere: any = { AND: scheduleAnd };
  const calendarWhere: any = { startsAt: { gte: start, lt: end } };
  if (query.projectId) calendarWhere.projectId = query.projectId;
  const [entries, blocks, active, users, milestoneProjects, resources, calendarEvents, selectedProject] = await Promise.all([
    prisma.timeEntry.findMany({ where: entryWhere, include: timeEntryInclude, orderBy: { startedAt: "desc" }, take: 1000 }),
    prisma.scheduleBlock.findMany({ where: scheduleWhere, include: { user: true, project: { include: { memberships: { where: { status: "active" } } } }, board: true, card: true, calendarEvent: true, resourceReservations: { include: { resource: true } } }, orderBy: { startsAt: "asc" }, take: SCHEDULING_CONTRACT.scheduler.maximumBlocksPerRange }),
    prisma.timeEntry.findFirst({ where: { userId: currentUser.id, endedAt: null }, include: timeEntryInclude, orderBy: { startedAt: "desc" } }),
    canManage ? prisma.user.findMany({ where: { archived: false }, include: { employment: true }, orderBy: [{ displayName: "asc" }, { username: "asc" }] }) : prisma.user.findMany({ where: { id: currentUser.id }, include: { employment: true } }),
    prisma.project.findMany({ where: { archived: false, targetDate: { not: null } }, select: { id: true, name: true, projectType: true, targetDate: true, priority: true, status: true, archived: true }, take: 500 }),
    settings.schedulerResourcePlanningEnabled === false ? Promise.resolve([]) : prisma.scheduleResource.findMany({ where: { status: { not: "retired" } }, orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }], take: SCHEDULING_CONTRACT.scheduler.maximumResources }),
    prisma.calendarEvent.findMany({ where: calendarWhere, include: { project: { include: { memberships: { where: { status: "active" } } } }, scheduleBlocks: { select: { id: true } } }, orderBy: { startsAt: "asc" }, take: 1000 }),
    query.projectId ? prisma.project.findUnique({ where: { id: query.projectId }, select: { id: true, name: true, projectType: true } }) : Promise.resolve(null),
  ]);
  const [visibleEntries, visibleBlocks] = await Promise.all([
    filterVisibleTimeEntries(request, entries as any[]),
    filterVisibleScheduleBlocks(request, blocks as any[]),
  ]);
  const visibleCalendarEvents = [];
  for (const event of calendarEvents as any[]) if (await canViewCalendarEvent(request, event)) visibleCalendarEvents.push(event);
  const visibleActive = active && await canViewTimeEntry(request, active) ? active : null;
  const capacityHours = userId
    ? Number(users.find((user: any) => user.id === userId)?.employment?.capacityHours || 40)
    : users.reduce((sum: number, user: any) => sum + Number(user.employment?.capacityHours ?? 40), 0);
  const summary = summarizeTime(visibleEntries as any[], visibleBlocks as any[], { rangeStart: start, rangeEnd: end, capacityHours });
  const userNames = new Map(users.map((user: any) => [user.id, user.displayName || user.username]));
  const projectNames = new Map([
    ...(visibleEntries as any[]).filter((entry) => entry.project).map((entry) => [entry.project.id, entry.project.name] as [string, string]),
    ...(visibleBlocks as any[]).filter((block) => block.project).map((block) => [block.project.id, block.project.name] as [string, string]),
  ]);
  const resourceRows = (resources as any[]).map(serializeScheduleResource);
  const recommendedResources = selectedProject
    ? resourceRows.filter((resource: any) => !resource.projectTypeIds.length || resource.projectTypeIds.includes(String(selectedProject.projectType))).slice(0, 64)
    : [];
  return {
    range: { start: start.toISOString(), end: end.toISOString(), weekStart: weekStartNode(start).toISOString() },
    currentUser: await decorateUserForClient(currentUser),
    canManage,
    permissions: {
      canAddManual: canManage || (settings.schedulerAllowManualEntries === true),
      canEditOwnEntries: canManage,
      canDeleteOwnEntries: canManage,
      canEditOwnSchedule: canManage,
      canDeleteOwnSchedule: canManage,
      resourcePlanningEnabled: settings.schedulerResourcePlanningEnabled !== false,
      conflictWarnings: settings.schedulerConflictWarnings !== false,
      calendarMirrorDefault: settings.schedulerCalendarMirrorDefault === true,
    },
    active: visibleActive ? serializeTimeEntry(visibleActive) : null,
    entries: visibleEntries.map(serializeTimeEntry),
    scheduleBlocks: visibleBlocks.map(serializeScheduleBlock),
    users: users.map(serializeUserLite),
    summary: {
      ...summary,
      totalMinutes: summary.trackedMinutes,
      byUser: summary.byUser.map((item) => ({ ...item, name: userNames.get(item.id) || "Unknown user" })),
      byProject: summary.byProject.map((item) => ({ ...item, name: projectNames.get(item.id) || "Unknown project" }))
    },
    exceptions: timeExceptions(visibleEntries as any[], visibleBlocks as any[]),
    planning: {
      ...buildScheduleInsights(visibleBlocks as any[], users as any[], milestoneProjects as any[], resources as any[], start, end),
      resources: resourceRows,
      recommendedResources,
      calendarEvents: visibleCalendarEvents.map((event: any) => ({ id: event.id, projectId: event.projectId, project: event.project ? { id: event.project.id, name: event.project.name } : null, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, eventType: event.eventType, status: event.status, ownerId: event.ownerId, attendeeIds: parseScheduleStringList(event.attendeeIds), scheduled: Boolean(event.scheduleBlocks?.length) })),
    },
  };
});
app.get("/api/time/entries", async (request) => {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw new Error("Login required.");
  const query = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    userId: z.string().optional(),
    projectId: z.string().optional(),
    boardId: z.string().optional(),
    cardId: z.string().optional()
  }).parse(request.query);
  const decorated = await decorateUserForClient(currentUser);
  const canManage = Boolean(decorated?.isAdmin || hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "manage"));
  const where: any = {};
  if (query.userId) {
    if (query.userId !== currentUser.id && !canManage) throw new Error("Time manage permission required.");
    where.userId = query.userId;
  } else if (!canManage) {
    where.userId = currentUser.id;
  }
  if (query.projectId) where.projectId = query.projectId;
  if (query.boardId) where.boardId = query.boardId;
  if (query.cardId) where.cardId = query.cardId;
  if (query.start || query.end) {
    where.startedAt = {};
    if (query.start) where.startedAt.gte = new Date(query.start);
    if (query.end) where.startedAt.lt = new Date(query.end);
  }
  const entries = await prisma.timeEntry.findMany({ where, include: timeEntryInclude, orderBy: { startedAt: "desc" }, take: 1000 });
  const visibleEntries = await filterVisibleTimeEntries(request, entries as any[]);
  return visibleEntries.map(serializeTimeEntry);
});
app.get("/api/time/summary", async (request) => {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw new Error("Login required.");
  const query = z.object({ start: z.string().optional(), end: z.string().optional(), userId: z.string().optional(), projectId: z.string().optional() }).parse(request.query);
  const start = query.start ? new Date(query.start) : weekStartNode(new Date());
  const end = query.end ? new Date(query.end) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const decorated = await decorateUserForClient(currentUser);
  const canManage = Boolean(decorated?.isAdmin || hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "manage"));
  const userId = query.userId || (canManage ? undefined : currentUser.id);
  if (query.userId && query.userId !== currentUser.id && !canManage) throw new Error("Time manage permission required.");
  const entryWhere: any = { startedAt: { gte: start, lt: end } };
  const blockWhere: any = { startsAt: { lt: end }, endsAt: { gt: start } };
  if (userId) { entryWhere.userId = userId; blockWhere.userId = userId; }
  if (query.projectId) { entryWhere.projectId = query.projectId; blockWhere.projectId = query.projectId; }
  const [entries, blocks, users] = await Promise.all([
    prisma.timeEntry.findMany({ where: entryWhere, include: timeEntryInclude, orderBy: { startedAt: "asc" }, take: 2000 }),
    prisma.scheduleBlock.findMany({ where: blockWhere, include: { user: true, project: { include: { memberships: { where: { status: "active" } } } } }, orderBy: { startsAt: "asc" }, take: 2000 }),
    prisma.user.findMany({ where: userId ? { id: userId } : { archived: false }, include: { employment: true } })
  ]);
  const [visibleEntries, visibleBlocks] = await Promise.all([
    filterVisibleTimeEntries(request, entries as any[]),
    filterVisibleScheduleBlocks(request, blocks as any[]),
  ]);
  const capacityHours = users.reduce((sum: number, user: any) => sum + Number(user.employment?.capacityHours ?? 40), 0);
  const summary = summarizeTime(visibleEntries as any[], visibleBlocks as any[], { rangeStart: start, rangeEnd: end, capacityHours });
  const userNames = new Map(users.map((user: any) => [user.id, user.displayName || user.username]));
  const projectNames = new Map((visibleEntries as any[]).filter((entry) => entry.project).map((entry) => [entry.project.id, entry.project.name]));
  return {
    ...summary,
    totalMinutes: summary.trackedMinutes,
    byUser: summary.byUser.map((item) => ({ ...item, name: userNames.get(item.id) || "Unknown user" })),
    byProject: summary.byProject.map((item) => ({ ...item, name: projectNames.get(item.id) || "Unknown project" })),
    byCard: []
  };
});
app.post("/api/time/start", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({
    userId: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    boardId: z.string().optional().nullable(),
    cardId: z.string().optional().nullable(),
    title: z.string().trim().min(1).max(160).optional().default("Work session"),
    description: z.string().max(4000).optional().nullable(),
    category: z.enum(["work", "meeting", "admin", "research", "support", "other"]).optional().default("work"),
    timezone: z.string().max(100).optional().nullable(),
    billable: z.boolean().optional().default(false),
    pin: z.string()
  }).parse(request.body);
  await verifyUserPin(actor, body.pin, "clock_in", request);
  const userId = await targetUserIdForWrite(request, body.userId);
  const refs = await requireTimeReferences(request, reply, body, "time", `time:new:${userId}`);
  if (!refs) return;
  const now = new Date();
  const billable = await resolveBillableValue(actor, refs.projectId, body.category);
  const entry = await prisma.$transaction(async (tx: any) => {
    const active = await tx.timeEntry.findFirst({ where: { userId, endedAt: null } });
    if (active) throw new Error("Stop or switch the active timer before starting another one.");
    return tx.timeEntry.create({
      data: { userId, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId, title: body.title, description: body.description || null, category: body.category, timezone: body.timezone || null, startedAt: now, billable, source: "clock", createdById: actor.id, updatedById: actor.id },
      include: timeEntryInclude
    });
  });
  await logActivity({ userId: actor.id, projectId: entry.projectId, boardId: entry.boardId, cardId: entry.cardId, type: "time", entityType: "time_entry", entityId: entry.id, title: "Clocked in", message: entry.title });
  return serializeTimeEntry(entry);
});
app.post("/api/time/switch", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({
    projectId: z.string().optional().nullable(),
    boardId: z.string().optional().nullable(),
    cardId: z.string().optional().nullable(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(4000).optional().nullable(),
    category: z.enum(["work", "meeting", "admin", "research", "support", "other"]).optional().default("work"),
    timezone: z.string().max(100).optional().nullable(),
    billable: z.boolean().optional().default(false),
    pin: z.string()
  }).parse(request.body);
  await verifyUserPin(actor, body.pin, "switch_clock", request);
  const refs = await requireTimeReferences(request, reply, body, "time", `time:new:${actor.id}`);
  if (!refs) return;
  const currentActive = await prisma.timeEntry.findFirst({ where: { userId: actor.id, endedAt: null }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
  if (currentActive && !(await requireExistingTimeProject(request, reply, "time", currentActive.id, currentActive.project, "contribute"))) return;
  const now = new Date();
  const billable = await resolveBillableValue(actor, refs.projectId, body.category);
  const result = await prisma.$transaction(async (tx: any) => {
    const active = await tx.timeEntry.findFirst({ where: { userId: actor.id, endedAt: null }, include: { breaks: true } });
    let stopped = null;
    if (active) {
      await tx.timeBreak.updateMany({ where: { timeEntryId: active.id, endedAt: null }, data: { endedAt: now } });
      const refreshedBreaks = await tx.timeBreak.findMany({ where: { timeEntryId: active.id } });
      stopped = await tx.timeEntry.update({
        where: { id: active.id },
        data: { endedAt: now, durationMinutes: netEntryMinutes({ ...active, endedAt: now, breaks: refreshedBreaks }), updatedById: actor.id },
        include: timeEntryInclude
      });
    }
    const started = await tx.timeEntry.create({
      data: { userId: actor.id, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId, title: body.title, description: body.description || null, category: body.category, timezone: body.timezone || null, startedAt: now, billable, source: "clock", createdById: actor.id, updatedById: actor.id },
      include: timeEntryInclude
    });
    return { stopped, started };
  });
  await logActivity({ userId: actor.id, projectId: result.started.projectId, type: "time", entityType: "time_entry", entityId: result.started.id, title: "Switched timer", message: result.started.title });
  return { stopped: result.stopped ? serializeTimeEntry(result.stopped) : null, started: serializeTimeEntry(result.started) };
});
app.post("/api/time/stop", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({ entryId: z.string().optional(), description: z.string().max(4000).optional().nullable(), pin: z.string() }).parse(request.body || {});
  await verifyUserPin(actor, body.pin, "clock_out", request);
  const active = await prisma.timeEntry.findFirst({ where: body.entryId ? { id: body.entryId } : { userId: actor.id, endedAt: null }, include: { breaks: true, project: { include: { memberships: { where: { status: "active" } } } } } });
  if (!active) throw new Error("No active timer found.");
  if (!(await canOperateTimerForUser(actor, active.userId))) throw new Error("Time manage permission required.");
  if (!(await requireExistingTimeProject(request, reply, "time", active.id, active.project, "contribute"))) return;
  const endedAt = new Date();
  const entry = await prisma.$transaction(async (tx: any) => {
    await tx.timeBreak.updateMany({ where: { timeEntryId: active.id, endedAt: null }, data: { endedAt } });
    const breaks = await tx.timeBreak.findMany({ where: { timeEntryId: active.id } });
    return tx.timeEntry.update({
      where: { id: active.id },
      data: { endedAt, durationMinutes: netEntryMinutes({ ...active, endedAt, breaks }), description: body.description ?? active.description, updatedById: actor.id },
      include: timeEntryInclude
    });
  });
  await logActivity({ userId: actor.id, projectId: entry.projectId, boardId: entry.boardId, cardId: entry.cardId, type: "time", entityType: "time_entry", entityId: entry.id, title: "Clocked out", message: `${entry.durationMinutes || 0} minutes logged` });
  return serializeTimeEntry(entry);
});
app.post("/api/time/breaks/start", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({ entryId: z.string().optional(), type: z.enum(["paid", "unpaid", "meal", "personal"]).optional().default("unpaid"), note: z.string().max(500).optional().nullable(), pin: z.string() }).parse(request.body || {});
  await verifyUserPin(actor, body.pin, "start_break", request);
  const entry = await prisma.timeEntry.findFirst({ where: body.entryId ? { id: body.entryId } : { userId: actor.id, endedAt: null }, include: { breaks: true, project: { include: { memberships: { where: { status: "active" } } } } } });
  if (!entry || entry.endedAt) throw new Error("An active shift is required to start a break.");
  if (!(await canOperateTimerForUser(actor, entry.userId))) throw new Error("Time manage permission required.");
  if (!(await requireExistingTimeProject(request, reply, "time", entry.id, entry.project, "contribute"))) return;
  if (entry.breaks.some((item: any) => !item.endedAt)) throw new Error("A break is already running.");
  const item = await prisma.timeBreak.create({ data: { timeEntryId: entry.id, type: body.type, note: body.note || null, startedAt: new Date() } });
  await logActivity({ userId: actor.id, projectId: entry.projectId, type: "time_break", entityType: "time_break", entityId: item.id, title: "Break started", message: body.type });
  return serializeTimeBreak(item);
});
app.post("/api/time/breaks/stop", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({ entryId: z.string().optional(), breakId: z.string().optional(), pin: z.string() }).parse(request.body || {});
  await verifyUserPin(actor, body.pin, "end_break", request);
  const item = await prisma.timeBreak.findFirst({
    where: body.breakId ? { id: body.breakId } : { ...(body.entryId ? { timeEntryId: body.entryId } : { timeEntry: { userId: actor.id, endedAt: null } }), endedAt: null },
    include: { timeEntry: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } }
  });
  if (!item) throw new Error("No active break found.");
  if (!(await canOperateTimerForUser(actor, item.timeEntry.userId))) throw new Error("Time manage permission required.");
  if (!(await requireExistingTimeProject(request, reply, "time", item.timeEntry.id, item.timeEntry.project, "contribute"))) return;
  const endedAt = new Date();
  const updated = await prisma.timeBreak.update({ where: { id: item.id }, data: { endedAt, durationMinutes: minutesBetween(new Date(item.startedAt), endedAt) } });
  await logActivity({ userId: actor.id, projectId: item.timeEntry.projectId, type: "time_break", entityType: "time_break", entityId: item.id, title: "Break ended", message: `${updated.durationMinutes || 0} minutes` });
  return serializeTimeBreak(updated);
});
app.post("/api/time/entries", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const body = z.object({
    userId: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    boardId: z.string().optional().nullable(),
    cardId: z.string().optional().nullable(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(4000).optional().nullable(),
    category: z.enum(["work", "meeting", "admin", "research", "support", "other"]).optional().default("work"),
    timezone: z.string().max(100).optional().nullable(),
    startedAt: z.string(),
    endedAt: z.string(),
    billable: z.boolean().optional().default(false)
  }).parse(request.body);
  const userId = await targetUserIdForWrite(request, body.userId);
  const settings = await readSettings();
  if (!(await isTimeManager(actor)) && settings.schedulerAllowManualEntries !== true) throw new Error("Manual Scheduler entries are disabled. Use the timer.");
  if (settings.schedulerRequireProject === true && !body.projectId && !body.boardId && !body.cardId) throw new Error("A project is required for Scheduler entries.");
  const refs = await requireTimeReferences(request, reply, body, "time", `time:new:${userId}`);
  if (!refs) return;
  const startedAt = new Date(body.startedAt);
  const endedAt = new Date(body.endedAt);
  validateTimeRange(startedAt, endedAt, 24 * 60);
  const billable = await resolveBillableValue(actor, refs.projectId, body.category, body.billable);
  const entry = await prisma.timeEntry.create({
    data: { userId, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId, title: body.title, description: body.description || null, category: body.category, timezone: body.timezone || null, startedAt, endedAt, durationMinutes: minutesBetween(startedAt, endedAt), billable, source: "manual", createdById: actor.id, updatedById: actor.id },
    include: timeEntryInclude
  });
  await logActivity({ userId: actor.id, projectId: entry.projectId, boardId: entry.boardId, cardId: entry.cardId, type: "time", entityType: "time_entry", entityId: entry.id, title: "Time logged", message: entry.title });
  return serializeTimeEntry(entry);
});
app.put("/api/time/entries/:entryId", async (request, reply) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const params = z.object({ entryId: z.string() }).parse(request.params);
  const body = z.object({
    userId: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    boardId: z.string().optional().nullable(),
    cardId: z.string().optional().nullable(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(4000).optional().nullable(),
    category: z.enum(["work", "meeting", "admin", "research", "support", "other"]).optional().default("work"),
    timezone: z.string().max(100).optional().nullable(),
    startedAt: z.string(),
    endedAt: z.string(),
    billable: z.boolean().optional().default(false)
  }).parse(request.body);
  const existing = await prisma.timeEntry.findUnique({ where: { id: params.entryId } });
  if (!existing) throw new Error("Time entry not found.");
  if (!(await canCorrectTimeEntry(actor, existing))) throw new Error("Scheduler correction permission required.");
  const userId = body.userId || existing.userId;
  if (userId !== existing.userId && !(await isTimeManager(actor))) throw new Error("Scheduler manage permission required to reassign entries.");
  const refs = await requireTimeReferences(request, reply, body, "time", existing.id);
  if (!refs) return;
  const startedAt = new Date(body.startedAt);
  const endedAt = new Date(body.endedAt);
  validateTimeRange(startedAt, endedAt, 24 * 60);
  const billable = await resolveBillableValue(actor, refs.projectId, body.category, body.billable);
  const entry = await prisma.timeEntry.update({
    where: { id: params.entryId },
    data: { userId, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId, title: body.title, description: body.description || null, category: body.category, timezone: body.timezone || null, startedAt, endedAt, durationMinutes: Math.max(0, minutesBetween(startedAt, endedAt) - calculateBreakMinutes(await prisma.timeBreak.findMany({ where: { timeEntryId: existing.id } }))), billable, updatedById: actor.id },
    include: timeEntryInclude
  });
  await logActivity({ userId: actor.id, projectId: entry.projectId, boardId: entry.boardId, cardId: entry.cardId, type: "time", entityType: "time_entry", entityId: entry.id, title: "Time entry updated", message: entry.title });
  return serializeTimeEntry(entry);
});
app.delete("/api/time/entries/:entryId", async (request) => {
  const actor = await getCurrentUser(request);
  if (!actor) throw new Error("Login required.");
  const params = z.object({ entryId: z.string() }).parse(request.params);
  const existing = await prisma.timeEntry.findUnique({ where: { id: params.entryId } });
  if (!existing) throw new Error("Time entry not found.");
  if (!(await canDeleteTimeEntry(actor, existing))) throw new Error("Scheduler delete permission required.");
  const entry = await prisma.timeEntry.delete({ where: { id: params.entryId } });
  await logActivity({ userId: actor.id, projectId: entry.projectId, boardId: entry.boardId, cardId: entry.cardId, type: "time", entityType: "time_entry", entityId: entry.id, title: "Time entry deleted", message: entry.title });
  return { ok: true };
});
  function calendarStatusForSchedule(status: string) {
    if (status === "tentative") return "tentative";
    if (status === "cancelled") return "cancelled";
    return "scheduled";
  }
  async function validateScheduleOwner(reply: FastifyReply, ownerId: string) {
    const owner = await prisma.user.findFirst({ where: { id: ownerId, archived: false }, select: { id: true } });
    if (!owner) {
      reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "The selected production lead is unavailable or archived." });
      return false;
    }
    return true;
  }
  async function validateScheduleParticipants(reply: FastifyReply, ownerId: string, participantIds: string[]) {
    const normalized = normalizeScheduleParticipants(ownerId, participantIds);
    if (!normalized.length) return normalized;
    const users = await prisma.user.findMany({ where: { id: { in: normalized }, archived: false }, select: { id: true } });
    if (users.length !== normalized.length) {
      reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "One or more selected crew members are unavailable or archived." });
      return null;
    }
    return normalized;
  }
  async function validateScheduleResources(reply: FastifyReply, resources: any[], settings: Record<string, any>) {
    const normalized = normalizeScheduleResourceRequests(resources);
    if (!normalized.length) return normalized;
    if (settings.schedulerResourcePlanningEnabled === false) {
      reply.code(400).send({ ok: false, code: "RESOURCE_PLANNING_DISABLED", error: "Scheduler resource planning is disabled by an administrator." });
      return null;
    }
    const rows = await prisma.scheduleResource.findMany({ where: { id: { in: normalized.map((item) => item.resourceId) } }, select: { id: true } });
    if (rows.length !== normalized.length) {
      reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "One or more selected Scheduler resources no longer exist." });
      return null;
    }
    return normalized;
  }
  async function requireCalendarPlacement(request: FastifyRequest, reply: FastifyReply, project: any | null, ownerId: string, targetId: string) {
    if (project && !(await authorization.requireTarget(request, reply, "calendar", targetId, project, "contribute"))) return false;
    return authorization.requireUserScope(request, reply, { ownerUserId: ownerId, tool: "calendar", minimum: "edit", allowUnowned: Boolean(project) });
  }
  async function loadCalendarLink(request: FastifyRequest, reply: FastifyReply, calendarEventId: string | null | undefined, project: any | null, ownerId: string, targetId: string) {
    if (!calendarEventId) return null;
    const event = await prisma.calendarEvent.findUnique({ where: { id: calendarEventId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } });
    if (!event) {
      reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar event not found." });
      return undefined;
    }
    if (String(project?.id || "") !== String(event.projectId || "")) {
      reply.code(400).send({ ok: false, code: "PARENT_MISMATCH", error: "The Calendar event and production window must belong to the same project scope." });
      return undefined;
    }
    if (!(await canAccessCalendarEvent(authorization, request, event, "edit"))) {
      reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot modify this Calendar event." });
      return undefined;
    }
    if (!(await requireCalendarPlacement(request, reply, project || event.project || null, ownerId, targetId))) return undefined;
    return event;
  }
  function calendarMirrorData(input: any, refs: any, ownerId: string, participantIds: string[], startsAt: Date, endsAt: Date) {
    return {
      projectId: refs.projectId || null,
      title: input.title,
      description: input.description || null,
      startsAt,
      endsAt,
      allDay: false,
      color: input.color || null,
      source: "scheduler",
      eventType: input.windowKind === "standard" ? "schedule" : input.windowKind,
      status: calendarStatusForSchedule(input.status),
      ownerId,
      attendeeIds: JSON.stringify(participantIds),
      revision: 1,
    };
  }
  app.get("/api/schedule/blocks", async (request) => {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) throw new Error("Login required.");
    const query = z.object({
      userId: z.string().optional(),
      projectId: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      status: z.enum(SCHEDULING_CONTRACT.scheduler.blockStatuses).optional(),
      windowKind: z.enum(SCHEDULING_CONTRACT.scheduler.windowKinds).optional(),
      resourceId: z.string().optional(),
    }).parse(request.query || {});
    const decorated = await decorateUserForClient(currentUser);
    const canManage = Boolean(decorated?.isAdmin || hasToolPermission(currentUser, decorated?.workspaceRole, "scheduler", "manage"));
    const and: any[] = [];
    if (query.userId) {
      if (query.userId !== currentUser.id && !canManage) throw new Error("Time manage permission required.");
      and.push({ OR: [{ userId: query.userId }, { participantIds: { contains: `\"${query.userId}\"` } }] });
    } else if (!canManage) and.push({ OR: [{ userId: currentUser.id }, { participantIds: { contains: `\"${currentUser.id}\"` } }] });
    if (query.projectId) and.push({ projectId: query.projectId });
    if (query.status) and.push({ status: query.status });
    if (query.windowKind) and.push({ windowKind: query.windowKind });
    if (query.resourceId) and.push({ resourceReservations: { some: { resourceId: query.resourceId } } });
    if (query.start && query.end) {
      and.push({ startsAt: { lt: new Date(query.end) } }, { endsAt: { gt: new Date(query.start) } });
    } else {
      if (query.start) and.push({ endsAt: { gt: new Date(query.start) } });
      if (query.end) and.push({ startsAt: { lt: new Date(query.end) } });
    }
    const blocks = await prisma.scheduleBlock.findMany({ where: and.length ? { AND: and } : {}, include: scheduleBlockInclude, orderBy: { startsAt: "asc" }, take: SCHEDULING_CONTRACT.scheduler.maximumBlocksPerRange });
    const visibleBlocks = await filterVisibleScheduleBlocks(request, blocks as any[]);
    return visibleBlocks.map(serializeScheduleBlock);
  });
  app.post("/api/schedule/blocks", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const body = scheduleBlockInputSchema.parse(request.body);
    const canManage = await isTimeManager(actor);
    const userId = body.userId || actor.id;
    if (!canManage && body.type !== "time-off") throw new Error("Scheduler manage permission required to create schedule blocks.");
    if (userId !== actor.id && !canManage) throw new Error("Scheduler manage permission required.");
    if (!(await validateScheduleOwner(reply, userId))) return;
    const refs = await requireTimeReferences(request, reply, body, "schedule", `schedule:new:${userId}`);
    if (!refs) return;
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    validateTimeRange(startsAt, endsAt, 7 * 24 * 60);
    const settings = await readSettings();
    if (body.type === "time-off" && !canManage) {
      if (settings.approvalTimeOff === false) throw new Error("Time-off requests are disabled. A Scheduler manager must create this block.");
      const payload = { type: "time_off", requestedById: actor.id, requestedByName: actor.displayName || actor.username, targetType: "schedule_block", userId, projectId: refs.projectId, title: body.title, description: body.description || null, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), color: body.color || null, reason: body.description || body.title };
      const decision = await decisions.request({
        type: "time_off",
        title: `Time off: ${body.title}`,
        projectId: refs.projectId,
        resource: { kind: "schedule_block", id: `pending:${actor.id}:${startsAt.toISOString()}`, ...(refs.projectId ? { projectId: refs.projectId } : {}) } as any,
        requestedById: actor.id,
        requestedByName: actor.displayName || actor.username,
        reason: body.description || body.title,
        sourceKey: `time-off:${actor.id}:${startsAt.toISOString()}`,
        payload,
      });
      await logActivity({ userId: actor.id, projectId: refs.projectId, type: "approval_requested", entityType: "time_off", entityId: decision.id, title: "Time off requested", message: body.title, metadata: { approvalId: decision.id, start: startsAt.toISOString(), end: endsAt.toISOString() } });
      return { pendingApproval: true, approvalId: decision.id, title: body.title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), type: "time-off" };
    }
    if (body.recurrence && !canManage) throw new Error("Scheduler manage permission required to create recurring blocks.");
    if (body.recurrence && body.calendarEventId) return reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "A linked Calendar event can only be placed once. Create recurring Scheduler windows without an existing Calendar link." });
    const participantIds = await validateScheduleParticipants(reply, userId, body.participantIds);
    if (!participantIds) return;
    const resources = await validateScheduleResources(reply, body.resources, settings);
    if (!resources) return;
    const timezone = normalizeScheduleTimezone(body.timezone);
    const calendarMirror = body.calendarMirror ?? (settings.schedulerCalendarMirrorDefault === true);
    const linkedCalendar = await loadCalendarLink(request, reply, body.calendarEventId, refs.project || null, userId, `schedule:new:${userId}`);
    if (linkedCalendar === undefined) return;
    if (calendarMirror && !linkedCalendar && !(await requireCalendarPlacement(request, reply, refs.project || null, userId, `schedule:new:${userId}`))) return;
    const occurrences = buildScheduleOccurrences(startsAt, endsAt, body.recurrence, timezone);
    const recurrenceGroupId = body.recurrence ? randomUUID() : null;
    const transactionResult: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, { userIds: [userId, ...participantIds], resources, calendarEventIds: [linkedCalendar?.id] });
      if (linkedCalendar?.id) {
        const liveCalendar = await tx.calendarEvent.findUnique({ where: { id: linkedCalendar.id }, select: { id: true } });
        if (!liveCalendar) return { error: { status: 409, code: "CALENDAR_LINK_STALE", message: "The linked Calendar event was removed before the production window could be placed." } };
        if (!(await ensureScheduleCalendarAvailable(tx, linkedCalendar.id))) return { error: { status: 409, code: "CALENDAR_ALREADY_SCHEDULED", message: "This Calendar event is already placed on the production schedule." } };
      }
      const placements: Array<{ startsAt: Date; endsAt: Date; index: number; conflicts: any[] }> = [];
      for (const occurrence of occurrences) {
        const conflicts = await findSchedulePlacementConflicts(tx, { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, userIds: [userId, ...participantIds], resources });
        if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
          return { error: { status: 409, code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "Recurring Calendar occupancy could not be fully verified for this slot." } };
        if (settings.schedulerConflictWarnings !== false && conflicts.length && !body.allowConflicts) {
          return { error: { status: 409, code: "SCHEDULER_CONFLICT", message: "This production window conflicts with existing people or resource reservations.", occurrence: occurrence.index + 1, conflicts } };
        }
        placements.push({ ...occurrence, conflicts });
      }
      const created: any[] = [];
      for (const placement of placements) {
        let calendarEventId = linkedCalendar?.id || null;
        let ownsCalendarMirror = false;
        if (calendarMirror && !linkedCalendar) {
          const event = await tx.calendarEvent.create({ data: calendarMirrorData(body, refs, userId, participantIds, placement.startsAt, placement.endsAt) });
          calendarEventId = event.id;
          ownsCalendarMirror = true;
        }
        const item = await tx.scheduleBlock.create({
          data: {
            userId, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId,
            title: body.title, description: body.description || null, startsAt: placement.startsAt, endsAt: placement.endsAt,
            type: body.type, windowKind: body.windowKind, status: body.status, participantIds: JSON.stringify(participantIds),
            timezone, recurrenceGroupId, recurrenceIndex: recurrenceGroupId ? placement.index : null,
            recurrenceFrequency: body.recurrence?.frequency || null,
            calendarEventId, calendarSync: ownsCalendarMirror, color: body.color || null,
          },
        });
        await replaceScheduleReservations(tx, item.id, resources);
        created.push(await tx.scheduleBlock.findUnique({ where: { id: item.id }, include: scheduleBlockInclude }));
      }
      return { created, placements };
    });
    if (transactionResult?.error) {
      const error = transactionResult.error;
      return reply.code(error.status || 409).send({ ok: false, code: error.code, error: error.message, occurrence: error.occurrence, conflicts: error.conflicts });
    }
    const created = transactionResult.created as any[];
    for (let occurrence = 0; occurrence < created.length; occurrence += 1) {
      const block = created[occurrence];
      const placement = transactionResult.placements[occurrence];
      await logActivity({ userId: actor.id, projectId: block.projectId, boardId: block.boardId, cardId: block.cardId, type: "schedule", entityType: "schedule_block", entityId: block.id, title: occurrence ? "Recurring production window created" : "Production window created", message: block.title, metadata: { windowKind: block.windowKind, status: block.status, participantCount: participantIds.length, resourceCount: resources.length, calendarMirrored: Boolean(block.calendarSync), timezone, recurrenceGroupId, conflictOverride: body.allowConflicts && placement.conflicts.length > 0, ...(body.recurrence ? { recurrence: body.recurrence, occurrence: occurrence + 1, total: created.length } : {}) } });
      const assignment = workAssignmentActivity({ actorUserId: actor.id, source: { kind: "scheduler", id: block.id, projectId: block.projectId, label: block.title }, assigneeId: block.userId, projectId: block.projectId, boardId: block.boardId, cardId: block.cardId, startsAt: block.startsAt, dueAt: block.endsAt });
      if (assignment) await logActivity(assignment);
    }
    return created.length === 1 ? serializeScheduleBlock(created[0]) : { recurring: true, recurrenceGroupId, count: created.length, blocks: created.map(serializeScheduleBlock) };
  });
  app.get("/api/schedule/blocks/:blockId", async (request, reply) => {
    const params = z.object({ blockId: z.string() }).parse(request.params);
    const block = await prisma.scheduleBlock.findUnique({ where: { id: params.blockId }, include: scheduleBlockInclude });
    if (!block) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Schedule block not found." });
    if (!(await canViewScheduleBlock(request, block))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You no longer have access to this schedule block." });
    return serializeScheduleBlock(block);
  });
  app.post("/api/schedule/blocks/:blockId/calendar/reconcile", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const { blockId } = z.object({ blockId: z.string() }).parse(request.params);
    const { action } = z.object({ action: z.enum(["repair", "unlink"]).optional().default("repair") }).parse(request.body || {});
    const existing = await prisma.scheduleBlock.findUnique({ where: { id: blockId }, include: scheduleBlockInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Schedule block not found." });
    if (existing.placementAuthority === "calendar") return reply.code(409).send({ ok: false, code: "CALENDAR_OWNS_PLACEMENT", error: "This meeting reservation is owned by Calendar. Edit the meeting instead." });
    if (!(await canChangeScheduleBlock(actor, existing, "edit"))) throw new Error("Scheduler edit permission required.");
    if (!(await requireCalendarPlacement(request, reply, existing.project || null, existing.userId || actor.id, existing.id))) return;
    const result: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, { blockIds: [existing.id], userIds: scheduleBlockUserIds(existing), resources: serializeScheduleReservations(existing).map((item: any) => ({ resourceId: item.resourceId, quantity: item.quantity })), calendarEventIds: [existing.calendarEventId] });
      const current = await tx.scheduleBlock.findUnique({ where: { id: existing.id }, include: scheduleBlockInclude });
      if (!current) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Schedule block not found." } };
      if (action === "unlink") {
        const ownedCalendarId = current.calendarSync ? current.calendarEventId : null;
        const block = await tx.scheduleBlock.update({ where: { id: current.id }, data: { calendarEventId: null, calendarSync: false, revision: { increment: 1 } } });
        if (ownedCalendarId) await tx.calendarEvent.deleteMany({ where: { id: ownedCalendarId, source: "scheduler" } });
        return { block, repaired: false, unlinked: true };
      }
      if (!current.calendarSync) {
        if (!current.calendarEventId) return { block: current, repaired: false, unlinked: false };
        const linked = await tx.calendarEvent.findUnique({ where: { id: current.calendarEventId }, select: { id: true } });
        if (!linked) {
          const block = await tx.scheduleBlock.update({ where: { id: current.id }, data: { calendarEventId: null, revision: { increment: 1 } } });
          return { block, repaired: true, unlinked: true };
        }
        return { block: current, repaired: false, unlinked: false };
      }
      const participants = parseScheduleStringList(current.participantIds);
      const mirrorInput = { title: current.title, description: current.description, color: current.color, windowKind: current.windowKind, status: current.status };
      const refs = { projectId: current.projectId, boardId: current.boardId, cardId: current.cardId };
      let calendarEventId = current.calendarEventId;
      const liveMirror = calendarEventId ? await tx.calendarEvent.findUnique({ where: { id: calendarEventId }, select: { id: true } }) : null;
      if (liveMirror && calendarEventId) {
        await tx.calendarEvent.update({ where: { id: calendarEventId }, data: { ...calendarMirrorData(mirrorInput, refs, current.userId || actor.id, participants, current.startsAt, current.endsAt), revision: { increment: 1 } } });
      } else {
        const event = await tx.calendarEvent.create({ data: calendarMirrorData(mirrorInput, refs, current.userId || actor.id, participants, current.startsAt, current.endsAt) });
        calendarEventId = event.id;
      }
      const block = await tx.scheduleBlock.update({ where: { id: current.id }, data: { calendarEventId, calendarSync: true, revision: { increment: 1 } } });
      return { block, repaired: true, unlinked: false };
    });
    if (result?.error) return reply.code(result.error.status || 409).send({ ok: false, code: result.error.code, error: result.error.message });
    await logActivity({ userId: actor.id, projectId: existing.projectId, boardId: existing.boardId, cardId: existing.cardId, type: "schedule", entityType: "schedule_block", entityId: existing.id, title: action === "unlink" ? "Scheduler Calendar link removed" : "Scheduler Calendar link reconciled", message: existing.title, metadata: { action, repaired: Boolean(result.repaired), unlinked: Boolean(result.unlinked) } });
    const block = await prisma.scheduleBlock.findUnique({ where: { id: existing.id }, include: scheduleBlockInclude });
    return { ok: true, action, repaired: Boolean(result.repaired), unlinked: Boolean(result.unlinked), block: block ? serializeScheduleBlock(block) : null };
  });
  app.put("/api/schedule/blocks/:blockId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const params = z.object({ blockId: z.string() }).parse(request.params);
    const query = z.object({ scope: z.enum(["single", "future"]).optional().default("single") }).parse(request.query || {});
    const existing = await prisma.scheduleBlock.findUnique({ where: { id: params.blockId }, include: scheduleBlockInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Schedule block not found." });
    if (existing.placementAuthority === "calendar") return reply.code(409).send({ ok: false, code: "CALENDAR_OWNS_PLACEMENT", error: "This meeting reservation is owned by Calendar. Edit the meeting instead." });
    if (!(await canChangeScheduleBlock(actor, existing, "edit"))) throw new Error("Scheduler edit permission required.");
    const rawBody = request.body && typeof request.body === "object" ? request.body as Record<string, any> : {};
    const body = scheduleBlockInputSchema.omit({ recurrence: true }).parse({
      ...rawBody,
      participantIds: rawBody.participantIds ?? parseScheduleStringList(existing.participantIds),
      resources: rawBody.resources ?? serializeScheduleReservations(existing).map((item: any) => ({ resourceId: item.resourceId, quantity: item.quantity })),
      windowKind: rawBody.windowKind ?? existing.windowKind ?? SCHEDULING_CONTRACT.scheduler.defaultWindowKind,
      status: rawBody.status ?? existing.status ?? SCHEDULING_CONTRACT.scheduler.defaultBlockStatus,
      calendarMirror: rawBody.calendarMirror ?? Boolean(existing.calendarSync),
      calendarEventId: rawBody.calendarEventId === undefined ? existing.calendarEventId : rawBody.calendarEventId,
      timezone: rawBody.timezone ?? existing.timezone ?? "UTC",
      expectedRevision: rawBody.expectedRevision,
    });
    const userId = body.userId || existing.userId || actor.id;
    if (userId !== existing.userId && !(await isTimeManager(actor))) throw new Error("Scheduler manage permission required to reassign schedule blocks.");
    if (!(await validateScheduleOwner(reply, userId))) return;
    const refs = await requireTimeReferences(request, reply, body, "schedule", existing.id);
    if (!refs) return;
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    validateTimeRange(startsAt, endsAt, 7 * 24 * 60);
    const settings = await readSettings();
    const participantIds = await validateScheduleParticipants(reply, userId, body.participantIds);
    if (!participantIds) return;
    const resources = await validateScheduleResources(reply, body.resources, settings);
    if (!resources) return;
    const timezone = normalizeScheduleTimezone(body.timezone || existing.timezone);
    let targets = [existing];
    if (query.scope === "future" && existing.recurrenceGroupId) {
      targets = await prisma.scheduleBlock.findMany({
        where: { recurrenceGroupId: existing.recurrenceGroupId, recurrenceIndex: { gte: Number(existing.recurrenceIndex || 0) } },
        include: scheduleBlockInclude,
        orderBy: [{ recurrenceIndex: "asc" }, { startsAt: "asc" }],
        take: SCHEDULING_CONTRACT.scheduler.maximumRecurringOccurrences,
      });
    }
    if (query.scope === "future" && !existing.recurrenceGroupId) return reply.code(400).send({ ok: false, code: "NOT_RECURRING", error: "This production window is not part of a recurring series." });
    if (query.scope === "future" && targets.some((item: any) => item.calendarEventId && !item.calendarSync)) return reply.code(400).send({ ok: false, code: "SERIES_EXTERNAL_CALENDAR", error: "Future-series edits cannot rewrite externally linked Calendar events. Edit that occurrence by itself." });
    const requestedMirror = body.calendarMirror ?? Boolean(existing.calendarSync);
    const requestedCalendarId = body.calendarEventId === undefined ? existing.calendarEventId : body.calendarEventId;
    const linkedCalendar = query.scope === "single" && requestedCalendarId && requestedCalendarId !== existing.calendarEventId
      ? await loadCalendarLink(request, reply, requestedCalendarId, refs.project || null, userId, existing.id)
      : null;
    if (linkedCalendar === undefined) return;
    if (requestedMirror && query.scope === "single" && !requestedCalendarId && !(await requireCalendarPlacement(request, reply, refs.project || null, userId, existing.id))) return;
    if (requestedMirror && query.scope === "future" && !(await requireCalendarPlacement(request, reply, refs.project || null, userId, existing.id))) return;
    if (existing.calendarSync && existing.calendarEventId && !(await requireCalendarPlacement(request, reply, refs.project || existing.project || null, userId, existing.id))) return;
    const targetIds = targets.map((item: any) => item.id);
    const oldResourceRequests = targets.flatMap((item: any) => serializeScheduleReservations(item).map((reservation: any) => ({ resourceId: reservation.resourceId, quantity: reservation.quantity })));
    const oldUserIds = targets.flatMap((item: any) => scheduleBlockUserIds(item));
    const oldCalendarIds = targets.map((item: any) => item.calendarEventId);
    const futureOccurrences = query.scope === "future" && existing.recurrenceFrequency
      ? buildScheduleOccurrences(startsAt, endsAt, { frequency: existing.recurrenceFrequency as "daily" | "weekly", occurrences: targets.length }, timezone)
      : null;
    const shiftMs = startsAt.getTime() - new Date(existing.startsAt).getTime();
    const durationMs = Math.max(1, endsAt.getTime() - startsAt.getTime());
    const transactionResult: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, {
        blockIds: targetIds,
        userIds: [...oldUserIds, userId, ...participantIds],
        resources: [...oldResourceRequests, ...resources],
        calendarEventIds: [...oldCalendarIds, linkedCalendar?.id],
      });
      const liveTargets = await tx.scheduleBlock.findMany({ where: { id: { in: targetIds } }, include: scheduleBlockInclude, orderBy: [{ recurrenceIndex: "asc" }, { startsAt: "asc" }] });
      const liveSelected = liveTargets.find((item: any) => item.id === existing.id);
      if (!liveSelected) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Schedule block not found." } };
      if (body.expectedRevision && Number(liveSelected.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This production window changed since you opened it.", currentRevision: Number(liveSelected.revision || 1) } };
      if (linkedCalendar?.id) {
        const liveCalendar = await tx.calendarEvent.findUnique({ where: { id: linkedCalendar.id }, select: { id: true } });
        if (!liveCalendar) return { error: { status: 409, code: "CALENDAR_LINK_STALE", message: "The linked Calendar event was removed before the production window could be updated." } };
        if (!(await ensureScheduleCalendarAvailable(tx, linkedCalendar.id, targetIds))) return { error: { status: 409, code: "CALENDAR_ALREADY_SCHEDULED", message: "This Calendar event is already placed on the production schedule." } };
      }
      const planned = liveTargets.map((target: any, index: number) => {
        if (query.scope === "single") return { target, startsAt, endsAt };
        if (futureOccurrences?.[index]) return { target, startsAt: futureOccurrences[index].startsAt, endsAt: futureOccurrences[index].endsAt };
        const nextStart = new Date(new Date(target.startsAt).getTime() + shiftMs);
        return { target, startsAt: nextStart, endsAt: new Date(nextStart.getTime() + durationMs) };
      });
      const conflictSets: any[] = [];
      for (const placement of planned) {
        const conflicts = await findSchedulePlacementConflicts(tx, { startsAt: placement.startsAt, endsAt: placement.endsAt, userIds: [userId, ...participantIds], resources, excludeBlockIds: targetIds });
        if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
          return { error: { status: 409, code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "Recurring Calendar occupancy could not be fully verified for this slot." } };
        if (settings.schedulerConflictWarnings !== false && conflicts.length && !body.allowConflicts) return { error: { status: 409, code: "SCHEDULER_CONFLICT", message: "This production window conflicts with existing people or resource reservations.", conflicts } };
        conflictSets.push(conflicts);
      }
      const updatedBlocks: any[] = [];
      for (let index = 0; index < planned.length; index += 1) {
        const placement = planned[index];
        const current = placement.target;
        let calendarEventId: string | null = query.scope === "single" ? (requestedCalendarId || null) : (current.calendarEventId || null);
        let ownsCalendarMirror = Boolean(current.calendarSync && calendarEventId === current.calendarEventId);
        if (query.scope === "single" && linkedCalendar) { calendarEventId = linkedCalendar.id; ownsCalendarMirror = false; }
        if (current.calendarSync && !requestedMirror) { calendarEventId = null; ownsCalendarMirror = false; }
        if (requestedMirror && !calendarEventId) {
          const event = await tx.calendarEvent.create({ data: calendarMirrorData(body, refs, userId, participantIds, placement.startsAt, placement.endsAt) });
          calendarEventId = event.id;
          ownsCalendarMirror = true;
        } else if (requestedMirror && ownsCalendarMirror && calendarEventId) {
          const mirror = await tx.calendarEvent.findUnique({ where: { id: calendarEventId }, select: { id: true } });
          if (!mirror) {
            const event = await tx.calendarEvent.create({ data: calendarMirrorData(body, refs, userId, participantIds, placement.startsAt, placement.endsAt) });
            calendarEventId = event.id;
            ownsCalendarMirror = true;
          } else {
            await tx.calendarEvent.update({ where: { id: calendarEventId }, data: { ...calendarMirrorData(body, refs, userId, participantIds, placement.startsAt, placement.endsAt), revision: { increment: 1 } } });
          }
        }
        const previousOwnedCalendarId = current.calendarSync ? current.calendarEventId : null;
        const updated = await tx.scheduleBlock.update({
          where: { id: current.id },
          data: {
            userId, projectId: refs.projectId, boardId: refs.boardId, cardId: refs.cardId,
            title: body.title, description: body.description || null, startsAt: placement.startsAt, endsAt: placement.endsAt,
            type: body.type, windowKind: body.windowKind, status: body.status, participantIds: JSON.stringify(participantIds),
            timezone, calendarEventId, calendarSync: ownsCalendarMirror, color: body.color || null, revision: { increment: 1 },
          },
        });
        await replaceScheduleReservations(tx, updated.id, resources);
        if (previousOwnedCalendarId && previousOwnedCalendarId !== calendarEventId) await tx.calendarEvent.deleteMany({ where: { id: previousOwnedCalendarId, source: "scheduler" } });
        updatedBlocks.push(await tx.scheduleBlock.findUnique({ where: { id: updated.id }, include: scheduleBlockInclude }));
      }
      return { blocks: updatedBlocks, conflictSets };
    });
    if (transactionResult?.error) {
      const error = transactionResult.error;
      return reply.code(error.status || 409).send({ ok: false, code: error.code, error: error.message, currentRevision: error.currentRevision, conflicts: error.conflicts });
    }
    const blocks = transactionResult.blocks as any[];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      await logActivity({ userId: actor.id, projectId: block.projectId, boardId: block.boardId, cardId: block.cardId, type: "schedule", entityType: "schedule_block", entityId: block.id, title: query.scope === "future" ? "Recurring production window updated" : "Production window updated", message: block.title, metadata: { windowKind: block.windowKind, status: block.status, participantCount: participantIds.length, resourceCount: resources.length, calendarMirrored: Boolean(block.calendarSync), timezone, seriesScope: query.scope, conflictOverride: body.allowConflicts && transactionResult.conflictSets[index]?.length > 0 } });
      const previous = targets.find((item: any) => item.id === block.id);
      const assignment = workAssignmentActivity({ actorUserId: actor.id, source: { kind: "scheduler", id: block.id, projectId: block.projectId, label: block.title }, previousAssigneeId: previous?.userId, assigneeId: block.userId, projectId: block.projectId, boardId: block.boardId, cardId: block.cardId, startsAt: block.startsAt, dueAt: block.endsAt });
      if (assignment) await logActivity(assignment);
    }
    return query.scope === "single" ? serializeScheduleBlock(blocks[0]) : { recurring: true, scope: "future", recurrenceGroupId: existing.recurrenceGroupId, count: blocks.length, blocks: blocks.map(serializeScheduleBlock) };
  });
  app.delete("/api/schedule/blocks/:blockId", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) throw new Error("Login required.");
    const params = z.object({ blockId: z.string() }).parse(request.params);
    const query = z.object({ scope: z.enum(["single", "future"]).optional().default("single") }).parse(request.query || {});
    const existing = await prisma.scheduleBlock.findUnique({ where: { id: params.blockId }, include: scheduleBlockInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Schedule block not found." });
    if (existing.placementAuthority === "calendar") return reply.code(409).send({ ok: false, code: "CALENDAR_OWNS_PLACEMENT", error: "This meeting reservation is owned by Calendar. Delete or edit the meeting instead." });
    if (!(await canChangeScheduleBlock(actor, existing, "delete"))) throw new Error("Scheduler delete permission required.");
    let targets = [existing];
    if (query.scope === "future" && existing.recurrenceGroupId) {
      targets = await prisma.scheduleBlock.findMany({ where: { recurrenceGroupId: existing.recurrenceGroupId, recurrenceIndex: { gte: Number(existing.recurrenceIndex || 0) } }, include: scheduleBlockInclude, orderBy: [{ recurrenceIndex: "asc" }, { startsAt: "asc" }], take: SCHEDULING_CONTRACT.scheduler.maximumRecurringOccurrences });
    }
    if (query.scope === "future" && !existing.recurrenceGroupId) return reply.code(400).send({ ok: false, code: "NOT_RECURRING", error: "This production window is not part of a recurring series." });
    const targetIds = targets.map((item: any) => item.id);
    const resourceRequests = targets.flatMap((item: any) => serializeScheduleReservations(item).map((reservation: any) => ({ resourceId: reservation.resourceId, quantity: reservation.quantity })));
    const userIds = targets.flatMap((item: any) => scheduleBlockUserIds(item));
    const calendarEventIds = targets.map((item: any) => item.calendarEventId);
    await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, { blockIds: targetIds, userIds, resources: resourceRequests, calendarEventIds });
      const mirrors = targets.filter((item: any) => item.calendarSync && item.calendarEventId).map((item: any) => item.calendarEventId);
      await tx.scheduleBlock.deleteMany({ where: { id: { in: targetIds } } });
      if (mirrors.length) await tx.calendarEvent.deleteMany({ where: { id: { in: mirrors }, source: "scheduler" } });
    });
    for (const block of targets) await logActivity({ userId: actor.id, projectId: block.projectId, boardId: block.boardId, cardId: block.cardId, type: "schedule", entityType: "schedule_block", entityId: block.id, title: query.scope === "future" ? "Recurring production window deleted" : "Production window deleted", message: block.title, metadata: { windowKind: block.windowKind, calendarMirrorRemoved: Boolean(block.calendarSync), seriesScope: query.scope } });
    return query.scope === "single" ? { ok: true } : { ok: true, recurring: true, scope: "future", count: targets.length };
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { projectCalendarViewSnapshot } from "../admin/project-tool-settings.js";
import { SCHEDULING_CONTRACT, clusterResolveEffectiveCalendarView, type CalendarEventInput } from "@cluster/shared";
import type { ActivityRecordInput } from "../activity/activity-service.js";
import type { AuthorizationService } from "../access/authorization.js";
import { workAssignmentActivity } from "../work/work-assignment.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";
import { AUTHORIZATION_RULE_SELECT } from "../access/authorization.js";
import { canAccessCalendarEvent } from "./calendar-access.js";
import { calendarRangeWhere, isCalendarInstant, isCalendarTimezone, isCalendarWindowValid } from "./calendar-intervals.js";
import { supportsCalendarReminderRecurrence, calendarOccurrencesInWindow, calendarOccurrenceIsValid, isCancelledCalendarOccurrence, movedCalendarOccurrence } from "./calendar-reminder-occurrences.js";
import { checkCalendarSeriesConflicts, validateCalendarSeriesHorizon } from "./calendar-series-horizon.js";
import {
  acquireSchedulePlacementLocks,
  findSchedulePlacementConflicts,
  normalizeScheduleResourceRequests,
  normalizeScheduleTimezone,
  replaceScheduleReservations,
} from "../time/scheduler-planning.js";

const calendarRangeQuerySchema = z.object({
  start: z.string().refine(isCalendarInstant, "Calendar start must include a valid ISO timezone offset.").optional(),
  end: z.string().refine(isCalendarInstant, "Calendar end must include a valid ISO timezone offset.").optional(),
  projectId: z.string().optional(),
  personId: z.string().optional(),
});

const meetingResourceSchema = z.object({
  resourceId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(SCHEDULING_CONTRACT.scheduler.maximumResourceQuantity).optional(),
});

const calendarEventInputSchema = z.object({
  projectId: z.string().optional().nullable(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(8_000).optional().nullable(),
  location: z.string().max(240).optional().nullable(),
  startsAt: z.string().refine(isCalendarInstant, "Calendar start must include a valid ISO timezone offset."),
  endsAt: z.string().refine(isCalendarInstant, "Calendar end must include a valid ISO timezone offset.").optional().nullable(),
  allDay: z.boolean().optional(),
  color: z.string().max(32).optional().nullable(),
  externalUrl: z.string().max(2_000).optional().nullable(),
  eventType: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  ownerId: z.string().optional().nullable(),
  attendeeIds: z.array(z.string()).max(SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock).optional(),
  delegateIds: z.array(z.string()).max(20).optional(),
  visibility: z.enum(SCHEDULING_CONTRACT.calendar.eventVisibilities).optional(),
  notes: z.string().max(SCHEDULING_CONTRACT.calendar.maximumEventNotesLength).optional().nullable(),
  timezone: z.string().trim().max(80).refine(isCalendarTimezone, "Choose a valid IANA timezone.").optional().nullable(),
  attachmentIds: z.array(z.string()).max(SCHEDULING_CONTRACT.calendar.maximumEventAttachments).optional(),
  decisionIds: z.array(z.string()).max(SCHEDULING_CONTRACT.calendar.maximumEventLinkedDecisions).optional(),
  actionItemIds: z.array(z.string()).max(SCHEDULING_CONTRACT.calendar.maximumEventActionItems).optional(),
  reminderMinutes: z.number().int().min(0).max(SCHEDULING_CONTRACT.calendar.maximumReminderMinutes).optional().nullable(),
  reminderAudience: z.enum(["owner", "participants"]).optional(),
  recurrenceRule: z.string().max(512).optional().nullable(),
  recurrenceEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  ticketId: z.string().optional().nullable(),
  expectedRevision: z.number().int().min(1).optional(),
  meeting: z.object({
    agenda: z.string().max(SCHEDULING_CONTRACT.calendar.maximumMeetingAgendaLength).optional().nullable(),
    resources: z.array(meetingResourceSchema).max(SCHEDULING_CONTRACT.scheduler.maximumResourcesPerBlock).optional(),
    allowConflicts: z.boolean().optional(),
  }).optional().nullable(),
}).superRefine((input, context) => {
  if (input.reminderMinutes != null && !supportsCalendarReminderRecurrence(input.recurrenceRule)) context.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Reminders support daily, weekly, weekday, and monthly recurrence only." });
  if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) context.addIssue({ code: "custom", path: ["endsAt"], message: "Event end must follow its start." });
});

const rsvpSchema = z.object({
  status: z.enum(SCHEDULING_CONTRACT.calendar.meetingRsvpStates),
  expectedRevision: z.number().int().min(1),
});

const attendanceSchema = z.object({
  expectedRevision: z.number().int().min(1),
  attendance: z.array(z.object({
    userId: z.string(),
    status: z.enum(SCHEDULING_CONTRACT.calendar.meetingAttendanceStates),
  })).max(SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock + 1),
});

const calendarEventInclude = {
  project: { include: { memberships: { where: { status: "active" } } } },
  meeting: true,
  occurrenceExceptions: true,
  scheduleBlocks: {
    where: { placementAuthority: "calendar" },
    include: { resourceReservations: { include: { resource: true } } },
  },
} as const;

type CalendarRouteDependencies = {
  app: FastifyInstance;
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  logActivity: (input: ActivityRecordInput) => Promise<unknown>;
  readSettings: () => Promise<Record<string, any>>;
  serializeCalendarEvent: (event: any) => unknown;
  authorization: AuthorizationService;
};

function uniqueStrings(values: unknown) {
  return Array.from(new Set(Array.isArray(values) ? values.map((value) => String(value || "").trim()).filter(Boolean) : []));
}

function parseObject(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function parseStringList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function calendarEventData(body: CalendarEventInput, ownerId = body.ownerId || null) {
  return {
    projectId: body.projectId || null,
    title: body.title,
    description: body.description || null,
    location: body.location || null,
    startsAt: new Date(body.startsAt),
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    allDay: Boolean(body.allDay),
    color: body.color || null,
    externalUrl: body.externalUrl || null,
    eventType: body.eventType || SCHEDULING_CONTRACT.calendar.defaultEventType,
    status: body.status || SCHEDULING_CONTRACT.calendar.defaultStatus,
    ownerId,
    attendeeIds: JSON.stringify(uniqueStrings(body.attendeeIds || []).filter((id) => id !== ownerId)),
    delegateIds: JSON.stringify(uniqueStrings(body.delegateIds || []).filter((id) => id !== ownerId)),
    visibility: body.visibility || (body.projectId ? "project" : "studio"),
    notes: body.notes || null,
    timezone: normalizeScheduleTimezone(body.timezone || "UTC"),
    attachmentIds: JSON.stringify(uniqueStrings(body.attachmentIds || [])),
    decisionIds: JSON.stringify(uniqueStrings(body.decisionIds || [])),
    actionItemIds: JSON.stringify(uniqueStrings(body.actionItemIds || [])),
    reminderMinutes: body.reminderMinutes ?? null,
    reminderAudience: body.reminderAudience === "participants" ? "participants" : "owner",
    recurrenceRule: body.recurrenceRule || null,
    recurrenceEndDate: body.recurrenceRule ? (body.recurrenceEndDate || null) : null,
    ticketId: body.ticketId || null,
  };
}

function scheduleStatusFromEvent(status: string | undefined) {
  if (status === "cancelled") return "cancelled";
  if (status === "tentative") return "tentative";
  return "confirmed";
}

function participantIdsFor(body: CalendarEventInput, organizerId: string) {
  return uniqueStrings(body.attendeeIds || []).filter((id) => id !== organizerId);
}

function meetingStateData(body: CalendarEventInput, organizerId: string, previous: any | null = null) {
  const attendees = participantIdsFor(body, organizerId);
  const participants = [organizerId, ...attendees];
  const previousRsvp = parseObject(previous?.rsvpState);
  const previousAttendance = parseObject(previous?.attendanceState);
  const rsvp: Record<string, string> = {};
  const attendance: Record<string, string> = {};
  for (const userId of participants) {
    rsvp[userId] = userId === organizerId ? "accepted" : previousRsvp[userId] || "pending";
    attendance[userId] = previousAttendance[userId] || "unknown";
  }
  return {
    organizerId,
    agenda: body.meeting?.agenda || null,
    rsvpState: JSON.stringify(rsvp),
    attendanceState: JSON.stringify(attendance),
  };
}

export function registerCalendarRoutes({
  app,
  prisma,
  getCurrentUser,
  logActivity,
  readSettings,
  serializeCalendarEvent,
  authorization,
}: CalendarRouteDependencies) {
  async function canViewEvent(request: FastifyRequest, event: any) {
    return canAccessCalendarEvent(authorization, request, event, "view");
  }

  async function serializeForRequest(_request: FastifyRequest, event: any) {
    return serializeCalendarEvent(event) as Record<string, any>;
  }

  async function requireEventPlacement(request: FastifyRequest, reply: FastifyReply, body: CalendarEventInput, ownerId: string | null, targetId: string) {
    if ((body.visibility || (body.projectId ? "project" : "studio")) === "project" && !body.projectId) {
      reply.code(400).send({ ok: false, code: "CALENDAR_PROJECT_REQUIRED", error: "Project-visible Calendar objects require a Project." });
      return null;
    }
    let project: any | null = null;
    if (body.projectId) {
      project = await prisma.project.findUnique({ where: { id: body.projectId } });
      if (!project || project.archived) {
        reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
        return null;
      }
      if (!(await authorization.requireTarget(request, reply, "calendar", targetId, project, "contribute"))) return null;
    }
    if (!(await authorization.requireUserScope(request, reply, { ownerUserId: ownerId, tool: "calendar", minimum: "edit", allowUnowned: Boolean(project) }))) return null;
    if (body.ticketId) {
      const card = await authorization.requireCard(request, reply, body.ticketId, "view");
      if (!card) return null;
      if (project && card.list.board.project?.id !== project.id) {
        reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "Calendar ticket must belong to the same project." });
        return null;
      }
    }
    return project || true;
  }

  async function validateCalendarPlan(request: FastifyRequest, reply: FastifyReply, body: CalendarEventInput, organizerId: string) {
    const attendees = participantIdsFor(body, organizerId);
    const requestedUsers = uniqueStrings([organizerId, ...attendees, ...(body.delegateIds || [])]);
    const existingUsers = await prisma.user.count({ where: { id: { in: requestedUsers }, archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } } });
    if (existingUsers !== requestedUsers.length) {
      reply.code(400).send({ ok: false, code: "CALENDAR_PARTICIPANT_INVALID", error: "One or more Calendar participants are unavailable." });
      return null;
    }
    const visibility = body.visibility || (body.projectId ? "project" : "studio");
    if (visibility === "project" && !body.projectId) {
      reply.code(400).send({ ok: false, code: "CALENDAR_PROJECT_REQUIRED", error: "Project-visible Calendar objects require a Project." });
      return null;
    }
    if (visibility === "participants" && requestedUsers.length < 1) {
      reply.code(400).send({ ok: false, code: "CALENDAR_PARTICIPANT_REQUIRED", error: "Participant-visible Calendar objects require an owner or participant." });
      return null;
    }
    const attachmentIds = uniqueStrings(body.attachmentIds || []);
    if (attachmentIds.length) {
      const items = await prisma.libraryItem.findMany({ where: { id: { in: attachmentIds }, deletedAt: null }, select: { id: true, projectId: true } });
      if (items.length !== attachmentIds.length || (body.projectId && items.some((item: any) => item.projectId && item.projectId !== body.projectId))) {
        reply.code(400).send({ ok: false, code: "CALENDAR_ATTACHMENT_INVALID", error: "One or more linked Library items are unavailable or belong to another project." });
        return null;
      }
    }
    const decisionIds = uniqueStrings(body.decisionIds || []);
    if (decisionIds.length) {
      const decisions = await prisma.clusterPersistenceRecord.findMany({ where: { id: { in: decisionIds }, kind: "approvalRequest", archived: false }, select: { id: true, projectId: true } });
      if (decisions.length !== decisionIds.length || (body.projectId && decisions.some((item: any) => item.projectId && item.projectId !== body.projectId))) {
        reply.code(400).send({ ok: false, code: "CALENDAR_DECISION_INVALID", error: "One or more linked Decisions are unavailable or belong to another project." });
        return null;
      }
    }

    const isMeeting = (body.eventType || SCHEDULING_CONTRACT.calendar.defaultEventType) === "meeting";
    if (!isMeeting) return { meeting: false, attendees, resources: [] as any[] };
    // A meeting recurrence must have an authoritative DST-aware occurrence
    // projector. Accepting an unknown rule would leave future reservations
    // impossible to verify and could permanently block resource planning.
    if (body.recurrenceRule && !supportsCalendarReminderRecurrence(body.recurrenceRule)) {
      reply.code(400).send({ ok: false, code: "CALENDAR_RECURRENCE_UNSUPPORTED", error: "Choose daily, weekly, weekdays, or monthly recurrence for a reservable meeting." });
      return null;
    }
    const startsAt = new Date(body.startsAt);
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (!endsAt || !(startsAt < endsAt)) {
      reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "Meetings require an end time after the start time." });
      return null;
    }
    if (body.recurrenceRule) {
      const horizon = validateCalendarSeriesHorizon({ startsAt, endsAt, timezone: body.timezone || "UTC", recurrenceRule: body.recurrenceRule, recurrenceEndDate: body.recurrenceEndDate });
      if (!horizon.valid) { reply.code(409).send({ ok: false, code: horizon.code, error: horizon.message }); return null; }
    }
    const resources = normalizeScheduleResourceRequests(body.meeting?.resources || []);
    if (resources.length) {
      const rows = await prisma.scheduleResource.findMany({ where: { id: { in: resources.map((item: any) => item.resourceId) }, status: "active" } });
      if (rows.length !== resources.length) {
        reply.code(409).send({ ok: false, code: "MEETING_RESOURCE_UNAVAILABLE", error: "One or more meeting resources are unavailable." });
        return null;
      }
    }
    return { meeting: true, attendees, resources };
  }

  async function delegatedCalendarEditor(request: FastifyRequest, event: any): Promise<boolean> {
    const identity = await authorization.identityForRequest(request);
    const actorId = String(identity.user?.id || "");
    if (!actorId || !parseStringList(event.delegateIds).includes(actorId)) return false;
    return canAccessCalendarEvent(authorization, request, event, "edit");
  }

  async function canChangeCalendarExceptions(request: FastifyRequest, event: any): Promise<boolean> {
    const identity = await authorization.identityForRequest(request);
    if (!identity.user) return false;
    if (String(identity.user.id) === String(event.ownerId || "") && await canAccessCalendarEvent(authorization, request, event, "edit")) return true;
    if (await delegatedCalendarEditor(request, event)) return true;
    if (event.project) return (await authorization.requestCanTarget(request, "calendar", event.id, event.project, "manage")) && (await canAccessCalendarEvent(authorization, request, event, "edit"));
    return (await authorization.requestCanUserScope(request, { ownerUserId: event.ownerId, tool: "calendar", minimum: "manage", allowUnowned: true })) && (await canAccessCalendarEvent(authorization, request, event, "edit"));
  }

  /** Authoritative bounded occurrence projection, with the original series ID
   * and a separate occurrence key. Detached series updates are NOT created. */
  async function occurrencesForRequest(request: FastifyRequest, events: any[], start: Date, end: Date) {
    const visible: Record<string, any>[] = [];
    const authorized: any[] = [];
    for (const event of events) if (await canViewEvent(request, event)) authorized.push(event);
    const recurringIds = authorized.filter((event: any) => event.meeting && event.recurrenceRule).map((event: any) => event.id);
    // Responses attach to the ORIGINAL series instant, even if that date is
    // outside the visible window and its rescheduled date appears here.
    const movedOriginals = authorized.flatMap((event: any) => (event.occurrenceExceptions || [])
      .filter((exception: any) => exception.status === "rescheduled" && exception.movedStartsAt &&
        new Date(exception.movedStartsAt).getTime() < end.getTime() && new Date(exception.movedEndsAt).getTime() > start.getTime())
      .map((exception: any) => new Date(exception.occurrenceStartsAt)));
    if (movedOriginals.length > 1024) throw Object.assign(new Error("Narrow the Calendar window to load moved occurrence responses."), { statusCode: 409, code: "CALENDAR_MOVED_RESPONSE_LIMIT" });
    const responseRows = recurringIds.length ? await prisma.calendarMeetingOccurrenceResponse.findMany({
      where: { calendarEventId: { in: recurringIds }, OR: [{ occurrenceStartsAt: {
        gte: new Date(start.getTime() - 31 * 86_400_000), lt: end } },
        ...(movedOriginals.length ? [{ occurrenceStartsAt: { in: movedOriginals } }] : [])] },
      select: { calendarEventId: true, occurrenceStartsAt: true, userId: true, rsvpStatus: true, attendanceStatus: true },
      take: 4001,
    }) : [];
    if (!Array.isArray(responseRows) || responseRows.length > 4000) throw Object.assign(new Error("Narrow the Calendar date window to load all occurrence responses."), { statusCode: 409, code: "CALENDAR_OCCURRENCE_RESPONSE_LIMIT" });
    const bySeries = new Map<string, any[]>();
    for (const row of responseRows) {
      const list = bySeries.get(row.calendarEventId) || [];
      list.push(row);
      bySeries.set(row.calendarEventId, list);
    }
    for (const event of authorized) {
      const serialized = await serializeForRequest(request, event);
      if (!event.recurrenceRule || !supportsCalendarReminderRecurrence(event.recurrenceRule)) {
        if (new Date(event.startsAt).getTime() < end.getTime() && (!event.endsAt || new Date(event.endsAt).getTime() > start.getTime())) visible.push(serialized);
        continue;
      }
      const duration = event.endsAt ? new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime() : 0;
      const begins = new Date(start.getTime() - Math.max(0, Math.min(duration, 31 * 86_400_000)));
      const append = (original: Date, starts: Date, ends: Date | null) => {
        const startsAt = original.getTime();
        if (ends ? ends.getTime() <= start.getTime() : starts.getTime() < start.getTime()) return;
        if (starts.getTime() >= end.getTime()) return;
        visible.push({ ...serialized, startsAt: starts.toISOString(), endsAt: ends?.toISOString() || null,
          occurrenceStartsAt: original.toISOString(), occurrenceKey: `${event.id}:${original.toISOString()}`,
          meeting: serialized.meeting ? {
            ...serialized.meeting,
            rsvp: { ...serialized.meeting.rsvp, ...Object.fromEntries((bySeries.get(event.id) || [])
              .filter((row: any) => new Date(row.occurrenceStartsAt).getTime() === startsAt && row.rsvpStatus)
              .map((row: any) => [row.userId, row.rsvpStatus])) },
            attendance: { ...serialized.meeting.attendance, ...Object.fromEntries((bySeries.get(event.id) || [])
              .filter((row: any) => new Date(row.occurrenceStartsAt).getTime() === startsAt && row.attendanceStatus)
              .map((row: any) => [row.userId, row.attendanceStatus])) },
          } : null });
      };
      for (const date of calendarOccurrencesInWindow(event, begins, end)) {
        if (isCancelledCalendarOccurrence(event, date) || movedCalendarOccurrence(event, date)) continue;
        append(date, date, event.endsAt ? new Date(date.getTime() + duration) : null);
      }
      for (const exception of event.occurrenceExceptions || []) {
        if (exception.status !== "rescheduled") continue;
        const original = new Date(exception.occurrenceStartsAt);
        if (!calendarOccurrenceIsValid(event, original)) continue;
        const moved = movedCalendarOccurrence(event, original);
        if (moved) append(original, moved.startsAt, moved.endsAt);
      }
    }
    return visible.sort((a,b) => Date.parse(String(a.startsAt)) - Date.parse(String(b.startsAt)));
  }

  async function canManageMeetingAttendance(request: FastifyRequest, event: any) {
    const actor = await getCurrentUser(request);
    if (!actor) return false;
    if (String(event?.meeting?.organizerId || event?.ownerId || "") === String(actor.id)) return true;
    if (event?.project) return authorization.requestCanTarget(request, "calendar", event.id, event.project, "manage");
    return authorization.requestCanUserScope(request, { ownerUserId: event?.ownerId, tool: "calendar", minimum: "manage", allowUnowned: true });
  }

  // Effective Calendar view from Studio -> permitted Project override. No
  // private Project setting metadata is exposed to unauthorized callers.
  app.get("/api/calendar/view-preference", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Sign in required." });
    const { projectId } = z.object({ projectId: z.string().min(1).optional() }).parse(request.query);
    if (projectId && !(await authorization.requireProject(request, reply, projectId, "view"))) return;
    // The personal preference is optional: never manufacture an implicit user
    // override from Account Settings' UI fallback. Read current DB truth so a
    // change made in another session is reflected on the next preference load.
    const current = await prisma.user.findUnique({ where: { id: actor.id }, select: { preferences: true } });
    if (!current) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Account no longer available." });
    let userView: unknown;
    try {
      const parsed = JSON.parse(current.preferences || "{}");
      userView = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.userCalendarDefaultView : undefined;
    } catch { /* malformed legacy preferences cannot defeat Studio/Project defaults */ }
    const inherited = await projectCalendarViewSnapshot(prisma, projectId || null, await readSettings());
    return { ok: true, ...clusterResolveEffectiveCalendarView(inherited, userView) };
  });

  app.get("/api/calendar/events", async (request, reply) => {
    const query = calendarRangeQuerySchema.parse(request.query);
    if (!isCalendarWindowValid(query.start, query.end)) return reply.code(400).send({ ok: false, code: "CALENDAR_RANGE_INVALID", error: "Calendar range must be positive and no longer than 366 days." });
    const windowWhere = calendarRangeWhere(query.start, query.end);
    const where: any = query.start && query.end
      ? { OR: [windowWhere, { recurrenceRule: { not: null }, startsAt: { lt: new Date(query.end) },
          OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: new Date(Date.parse(query.start) - 86_400_000).toISOString().slice(0, 10) } },
            { occurrenceExceptions: { some: { status: "rescheduled", movedStartsAt: { lt: new Date(query.end) }, movedEndsAt: { gt: new Date(query.start) } } } }],
        }] }
      : windowWhere;
    if (query.projectId) where.projectId = query.projectId;
    // Explicit ceiling: never silently display incomplete recurrence results.
    const events = await prisma.calendarEvent.findMany({ where, include: calendarEventInclude, orderBy: { startsAt: "asc" }, take: 2001 });
    if (events.length > 2000) return reply.code(409).send({ ok: false, code: "CALENDAR_RESULT_LIMIT", error: "Narrow your date range or Project filter." });
    const selected = query.personId ? events.filter((event: any) => new Set([String(event.ownerId || ""), ...parseStringList(event.attendeeIds)]).has(String(query.personId))) : events;
    if (!query.start || !query.end) {
      const visible = [];
      for (const event of selected) if (await canViewEvent(request, event)) visible.push(await serializeForRequest(request, event));
      return visible;
    }
    return occurrencesForRequest(request, selected, new Date(query.start), new Date(query.end));
  });

  // Meeting records have their own IDs, but their canonical editable surface
  // is the parent CalendarEvent. Resolve this linkage only after applying the
  // same visibility policy as GET /api/calendar/events/:eventId. Do not return
  // a placeholder or existence oracle to people lacking Calendar access.
  app.get("/api/calendar/meetings/:meetingId/target", async (request, reply) => {
    const { meetingId } = z.object({ meetingId: z.string().trim().min(1).max(200) }).parse(request.params);
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { calendarEvent: { include: calendarEventInclude } },
    });
    const event = meeting?.calendarEvent;
    if (!event || event.meeting?.id !== meetingId || !(await canViewEvent(request, event)))
      return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Meeting unavailable." });
    return sendPrivateRevalidated(request, reply, {
      meetingId,
      eventId: event.id,
      projectId: event.projectId || null,
    });
  });

  app.get("/api/calendar/events/:eventId", async (request, reply) => {
    const params = z.object({ eventId: z.string() }).parse(request.params);
    const event = await prisma.calendarEvent.findUnique({ where: { id: params.eventId }, include: calendarEventInclude });
    if (!event) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar event not found." });
    if (!(await canViewEvent(request, event))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You no longer have access to this Calendar event." });
    const query = z.object({ occurrenceStartsAt: z.string().refine(isCalendarInstant).optional() }).parse(request.query || {});
    if (query.occurrenceStartsAt) {
      const occurrence = new Date(query.occurrenceStartsAt);
      if (!event.meeting || !event.recurrenceRule || !calendarOccurrenceIsValid(event, occurrence)) return reply.code(400).send({ ok: false, code: "CALENDAR_OCCURRENCE_INVALID", error: "That time is not part of the selected meeting series." });
      const rows = await prisma.calendarMeetingOccurrenceResponse.findMany({ where: { calendarEventId: event.id, occurrenceStartsAt: occurrence }, take: 202 });
      if (rows.length > 201) return reply.code(409).send({ ok: false, code: "CALENDAR_RESPONSE_LIMIT", error: "This occurrence has too many responses." });
      return serializeForRequest(request, { ...event, meetingOccurrenceResponses: rows });
    }
    return serializeForRequest(request, event);
  });

  app.post("/api/calendar/events", async (request, reply) => {
    const user = await getCurrentUser(request);
    const body = calendarEventInputSchema.parse(request.body) as CalendarEventInput;
    const ownerId = body.ownerId || user?.id || null;
    if (!ownerId) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    if (!(await requireEventPlacement(request, reply, body, ownerId, `calendar:create:${body.projectId || ownerId || "studio"}`))) return;
    const meetingPlan = await validateCalendarPlan(request, reply, body, ownerId);
    if (!meetingPlan) return;
    const startsAt = new Date(body.startsAt);
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    const settings = await readSettings();
    const transactionResult: any = await prisma.$transaction(async (tx: any) => {
      if (meetingPlan.meeting && endsAt) {
        await acquireSchedulePlacementLocks(tx, { userIds: [ownerId, ...meetingPlan.attendees], resources: meetingPlan.resources });
        const verification = body.recurrenceRule
          ? await checkCalendarSeriesConflicts(tx, { startsAt, endsAt, timezone: body.timezone || "UTC", recurrenceRule: body.recurrenceRule, recurrenceEndDate: body.recurrenceEndDate, userIds: [ownerId, ...meetingPlan.attendees], resources: meetingPlan.resources }, findSchedulePlacementConflicts)
          : null;
        if (verification?.error) return { error: { status: 409, code: verification.error.code, message: verification.error.message } };
        const conflicts = verification ? verification.conflicts : await findSchedulePlacementConflicts(tx, { startsAt, endsAt, userIds: [ownerId, ...meetingPlan.attendees], resources: meetingPlan.resources });
        if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
          return { error: { status: 409, code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "Recurring Calendar occupancy could not be fully verified." } };
        if (settings.schedulerConflictWarnings !== false && conflicts.length && !body.meeting?.allowConflicts) {
          return { error: { status: 409, code: "MEETING_SCHEDULER_CONFLICT", message: `This meeting conflicts with people availability or resource reservations${verification?.occurrenceStartsAt ? ` on ${verification.occurrenceStartsAt.slice(0, 10)}` : ""}.`, conflicts } };
        }
      }
      const event = await tx.calendarEvent.create({ data: calendarEventData(body, ownerId) });
      if (meetingPlan.meeting && endsAt) {
        await tx.meeting.create({ data: { calendarEventId: event.id, ...meetingStateData(body, ownerId) } });
        const block = await tx.scheduleBlock.create({
          data: {
            userId: ownerId,
            projectId: body.projectId || null,
            calendarEventId: event.id,
            title: body.title,
            description: body.description || null,
            startsAt,
            endsAt,
            type: "meeting",
            windowKind: "standard",
            status: scheduleStatusFromEvent(body.status),
            participantIds: JSON.stringify(meetingPlan.attendees),
            timezone: normalizeScheduleTimezone(body.timezone || "UTC"),
            calendarSync: false,
            placementAuthority: "calendar",
            color: body.color || null,
          },
        });
        await replaceScheduleReservations(tx, block.id, meetingPlan.resources);
      }
      return { event: await tx.calendarEvent.findUnique({ where: { id: event.id }, include: calendarEventInclude }) };
    });
    if (transactionResult?.error) return reply.code(transactionResult.error.status || 409).send({ ok: false, code: transactionResult.error.code, error: transactionResult.error.message, conflicts: transactionResult.error.conflicts });
    const event = transactionResult.event;
    await logActivity({ userId: user?.id, projectId: event.projectId, type: "created", entityType: "calendar_event", entityId: event.id, title: event.meeting ? "Meeting created" : "Calendar event created", message: event.title });
    const assignment = workAssignmentActivity({ actorUserId: user?.id, source: { kind: "calendar", id: event.id, projectId: event.projectId, label: event.title }, assigneeId: event.ownerId, projectId: event.projectId, startsAt: event.startsAt, dueAt: event.endsAt });
    if (assignment) await logActivity(assignment);
    return serializeForRequest(request, event);
  });

  app.put("/api/calendar/events/:eventId", async (request, reply) => {
    const user = await getCurrentUser(request);
    const params = z.object({ eventId: z.string() }).parse(request.params);
    const body = calendarEventInputSchema.parse(request.body) as CalendarEventInput;
    if (!body.expectedRevision) return reply.code(400).send({ ok: false, code: "REVISION_REQUIRED", error: "Calendar edits require the revision you opened." });
    const existing = await prisma.calendarEvent.findUnique({ where: { id: params.eventId }, include: calendarEventInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar event not found." });
    if (!(await canAccessCalendarEvent(authorization, request, existing, "edit"))) {
      return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot edit this Calendar object." });
    }
    const editorIsDelegate = await delegatedCalendarEditor(request, existing);
    const priorDelegates = parseStringList(existing.delegateIds);
    if (body.delegateIds === undefined) body.delegateIds = priorDelegates;
    const delegationsChanged = JSON.stringify(uniqueStrings(body.delegateIds).sort()) !== JSON.stringify(priorDelegates.slice().sort());
    const identity = await authorization.identityForRequest(request);
    const isOwnerOrAdmin = Boolean(identity.user && (String(identity.user.id) === String(existing.ownerId) || identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || ""))));
    if (delegationsChanged && !isOwnerOrAdmin) return reply.code(403).send({ ok: false, code: "CALENDAR_DELEGATION_FORBIDDEN", error: "Only the owner or administrator may change delegated editors." });
    if (editorIsDelegate && !isOwnerOrAdmin && (
      (body.ownerId !== undefined && String(body.ownerId || "") !== String(existing.ownerId || "")) ||
      String(body.projectId || "") !== String(existing.projectId || "") ||
      String(body.visibility || "") !== String(existing.visibility || "") ||
      JSON.stringify(uniqueStrings(body.attendeeIds || []).sort()) !== JSON.stringify(parseStringList(existing.attendeeIds).sort()) ||
      delegationsChanged
    )) return reply.code(403).send({ ok: false, code: "CALENDAR_DELEGATE_SCOPE", error: "Delegated editors cannot change ownership, audience, visibility, or Project." });
    const ownerId = body.ownerId === undefined ? existing.ownerId || user?.id || null : body.ownerId || null;
    if (!ownerId) return reply.code(400).send({ ok: false, code: "VALIDATION_FAILED", error: "Calendar events require an owner." });
    const anchorChanged = String(body.recurrenceEndDate || "") !== String(existing.recurrenceEndDate || "") || String(body.recurrenceRule || "") !== String(existing.recurrenceRule || "")
      || Date.parse(body.startsAt) !== new Date(existing.startsAt).getTime()
      || String(body.timezone || "UTC") !== String(existing.timezone || "UTC");
    if (anchorChanged && existing.occurrenceExceptions?.length) {
      return reply.code(409).send({ ok: false, code: "CALENDAR_EXCEPTION_ANCHOR_LOCKED", error: "Restore skipped occurrences before changing recurrence timing." });
    }
    const delegateSameScope = editorIsDelegate && !isOwnerOrAdmin && String(ownerId) === String(existing.ownerId)
      && String(body.projectId || "") === String(existing.projectId || "");
    if (!delegateSameScope && !(await requireEventPlacement(request, reply, body, ownerId, params.eventId))) return;
    const meetingPlan = await validateCalendarPlan(request, reply, body, ownerId);
    if (!meetingPlan) return;
    const startsAt = new Date(body.startsAt);
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    const settings = await readSettings();
    const existingPlacement = existing.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt) || null;
    const oldResources = existingPlacement?.resourceReservations?.map((item: any) => ({ resourceId: item.resourceId, quantity: item.quantity })) || [];
    const oldParticipants = [existing.ownerId, ...parseStringList(existing.attendeeIds)].filter(Boolean);
    const transactionResult: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, {
        blockIds: existingPlacement ? [existingPlacement.id] : [],
        userIds: [...oldParticipants, ownerId, ...meetingPlan.attendees],
        resources: [...oldResources, ...meetingPlan.resources],
        calendarEventIds: [existing.id],
      });
      const current = await tx.calendarEvent.findUnique({ where: { id: existing.id }, include: calendarEventInclude });
      if (!current) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Calendar event not found." } };
      if (anchorChanged && (current.occurrenceExceptions?.length || await tx.calendarMeetingOccurrenceResponse.findFirst({ where: { calendarEventId: current.id }, select: { id: true } })))
        return { error: { status: 409, code: "CALENDAR_EXCEPTION_ANCHOR_LOCKED", message: "Clear occurrence exceptions and individual responses before changing recurrence timing." } };
      if (Number(current.revision || 1) !== Number(body.expectedRevision)) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This Calendar event changed since you opened it.", currentRevision: Number(current.revision || 1) } };
      const currentPlacement = current.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt) || null;
      const detached = (current.occurrenceExceptions || []).some((row: any) => row.status === "rescheduled");
      if (detached) {
        const oldResourceIds = (currentPlacement?.resourceReservations || []).map((row: any) => `${row.resourceId}:${row.quantity}`).sort();
        const newResourceIds = meetingPlan.resources.map((row: any) => `${row.resourceId}:${row.quantity || 1}`).sort();
        if (!meetingPlan.meeting || String(current.ownerId || "") !== String(ownerId) ||
          String(current.projectId || "") !== String(body.projectId || "") ||
          JSON.stringify(parseStringList(current.attendeeIds).sort()) !== JSON.stringify(meetingPlan.attendees.slice().sort()) ||
          JSON.stringify(oldResourceIds) !== JSON.stringify(newResourceIds)) {
          return { error: { status: 409, code: "CALENDAR_DETACHED_BOOKINGS_LOCKED", message: "Restore individually moved meetings before changing participants, rooms, owner or Project." } };
        }
      }
      if (meetingPlan.meeting && endsAt) {
        const verification = body.recurrenceRule
          ? await checkCalendarSeriesConflicts(tx, { startsAt, endsAt, timezone: body.timezone || "UTC", recurrenceRule: body.recurrenceRule, recurrenceEndDate: body.recurrenceEndDate, userIds: [ownerId, ...meetingPlan.attendees], resources: meetingPlan.resources, excludeBlockId: currentPlacement?.id || null, excludeCalendarEventId: current.id }, findSchedulePlacementConflicts)
          : null;
        if (verification?.error) return { error: { status: 409, code: verification.error.code, message: verification.error.message } };
        const conflicts = verification ? verification.conflicts : await findSchedulePlacementConflicts(tx, { startsAt, endsAt, userIds: [ownerId, ...meetingPlan.attendees], resources: meetingPlan.resources, excludeBlockId: currentPlacement?.id || null,
          excludeCalendarEventId: current.id });
        if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
          return { error: { status: 409, code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "Recurring Calendar occupancy could not be fully verified." } };
        if (settings.schedulerConflictWarnings !== false && conflicts.length && !body.meeting?.allowConflicts) return { error: { status: 409, code: "MEETING_SCHEDULER_CONFLICT", message: `This meeting conflicts with people availability or resource reservations${verification?.occurrenceStartsAt ? ` on ${verification.occurrenceStartsAt.slice(0, 10)}` : ""}.`, conflicts } };
      }
      await tx.calendarEvent.update({ where: { id: current.id }, data: { ...calendarEventData(body, ownerId), revision: { increment: 1 } } });
      if (!meetingPlan.meeting) {
        // Orphaned occurrence responses must not outlive their meeting identity.
        await tx.calendarMeetingOccurrenceResponse.deleteMany({ where: { calendarEventId: current.id } });
        if (currentPlacement) await tx.scheduleBlock.delete({ where: { id: currentPlacement.id } });
        await tx.meeting.deleteMany({ where: { calendarEventId: current.id } });
      } else if (endsAt) {
        // Reinvitation must never resurrect an old attendee's private RSVP.
        await tx.calendarMeetingOccurrenceResponse.deleteMany({ where: {
          calendarEventId: current.id, userId: { notIn: [ownerId, ...meetingPlan.attendees] },
        } });
        if (current.meeting) await tx.meeting.update({ where: { calendarEventId: current.id }, data: { ...meetingStateData(body, ownerId, current.meeting), revision: { increment: 1 } } });
        else await tx.meeting.create({ data: { calendarEventId: current.id, ...meetingStateData(body, ownerId) } });
        const blockData = {
          userId: ownerId,
          projectId: body.projectId || null,
          title: body.title,
          description: body.description || null,
          startsAt,
          endsAt,
          type: "meeting",
          windowKind: "standard",
          status: scheduleStatusFromEvent(body.status),
          participantIds: JSON.stringify(meetingPlan.attendees),
          timezone: normalizeScheduleTimezone(body.timezone || current.timezone || "UTC"),
          calendarEventId: current.id,
          calendarSync: false,
          placementAuthority: "calendar",
          color: body.color || null,
        };
        const block = currentPlacement
          ? await tx.scheduleBlock.update({ where: { id: currentPlacement.id }, data: { ...blockData, revision: { increment: 1 } } })
          : await tx.scheduleBlock.create({ data: blockData });
        await replaceScheduleReservations(tx, block.id, meetingPlan.resources);
        if (detached) await tx.scheduleBlock.updateMany({ where: { calendarEventId: current.id, placementAuthority: "calendar", occurrenceStartsAt: { not: null } },
          data: { title: body.title, description: body.description || null, color: body.color || null,
            status: scheduleStatusFromEvent(body.status), revision: { increment: 1 } } });
      }
      return { event: await tx.calendarEvent.findUnique({ where: { id: current.id }, include: calendarEventInclude }) };
    });
    if (transactionResult?.error) return reply.code(transactionResult.error.status || 409).send({ ok: false, code: transactionResult.error.code, error: transactionResult.error.message, currentRevision: transactionResult.error.currentRevision, conflicts: transactionResult.error.conflicts });
    const event = transactionResult.event;
    await logActivity({ userId: user?.id, projectId: event.projectId, type: "updated", entityType: "calendar_event", entityId: event.id, title: event.meeting ? "Meeting updated" : "Calendar event updated", message: event.title });
    const assignment = workAssignmentActivity({ actorUserId: user?.id, source: { kind: "calendar", id: event.id, projectId: event.projectId, label: event.title }, previousAssigneeId: existing.ownerId, assigneeId: event.ownerId, projectId: event.projectId, startsAt: event.startsAt, dueAt: event.endsAt });
    if (assignment) await logActivity(assignment);
    return serializeForRequest(request, event);
  });

  /** Individual recurrence moves preserve the immutable original identity.
   * The Scheduler reservation is created/updated/deleted in the SAME serializable
   * transaction as the exception and series revision CAS. Conflicts fail closed. */
  app.patch("/api/calendar/events/:eventId/occurrence", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { eventId } = z.object({ eventId: z.string() }).parse(request.params);
    const body = z.object({
      occurrenceStartsAt: z.string().refine(isCalendarInstant),
      action: z.enum(["cancel", "restore", "reschedule"]),
      expectedRevision: z.number().int().min(1),
      startsAt: z.string().refine(isCalendarInstant).optional(),
      endsAt: z.string().refine(isCalendarInstant).optional(),
      reason: z.string().trim().max(500).optional(),
    }).parse(request.body);
    if (body.action === "reschedule" && (!body.startsAt || !body.endsAt ||
      Date.parse(body.endsAt) <= Date.parse(body.startsAt) ||
      Date.parse(body.endsAt) - Date.parse(body.startsAt) > 31 * 86_400_000)) {
      return reply.code(400).send({ ok: false, code: "CALENDAR_OCCURRENCE_RANGE_INVALID", error: "A moved occurrence requires a valid start and end (up to 31 days)." });
    }
    const existing = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar series not found." });
    if (!(await canChangeCalendarExceptions(request, existing))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot change occurrences in this Calendar series." });
    const original = new Date(body.occurrenceStartsAt);
    if (!calendarOccurrenceIsValid(existing, original)) return reply.code(400).send({ ok: false, code: "CALENDAR_OCCURRENCE_INVALID", error: "The selected instant is not an occurrence of this series." });
    const plannedStart = body.action === "reschedule" ? new Date(body.startsAt!) : original;
    const defaultDuration = existing.endsAt ? new Date(existing.endsAt).getTime() - new Date(existing.startsAt).getTime() : 0;
    const plannedEnd = body.action === "reschedule" ? new Date(body.endsAt!) : new Date(original.getTime() + defaultDuration);
    if (body.action === "reschedule" && plannedStart.getTime() < new Date(existing.startsAt).getTime())
      return reply.code(400).send({ ok: false, code: "CALENDAR_MOVE_BEFORE_ANCHOR", error: "An occurrence cannot move before its recurring series begins." });
    // The anchored Scheduler block is the series' resource template. Moving it
    // requires reauthoring the recurrence, so explicitly reject that operation.
    if (body.action === "reschedule" && existing.meeting && original.getTime() === new Date(existing.startsAt).getTime()) {
      return reply.code(409).send({ ok: false, code: "CALENDAR_ANCHOR_MOVE_UNSUPPORTED", error: "Edit the meeting series to move its first occurrence." });
    }
    let result: any;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        const base = existing.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt);
        const previous = existing.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && block.occurrenceStartsAt && new Date(block.occurrenceStartsAt).getTime() === original.getTime());
        const resources = (base?.resourceReservations || []).map((row: any) => ({ resourceId: row.resourceId, quantity: Number(row.quantity || 1) }));
        const userIds = [String(existing.ownerId || ""), ...parseStringList(existing.attendeeIds)].filter(Boolean);
        await acquireSchedulePlacementLocks(tx, { calendarEventIds: [eventId], blockIds: previous ? [previous.id] : [], userIds, resources });
        const current = await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
        if (!current) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Calendar series not found." } };
        if (Number(current.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This Calendar series changed; reload before editing an occurrence.", currentRevision: current.revision } };
        if (!calendarOccurrenceIsValid(current, original)) return { error: { status: 409, code: "CALENDAR_OCCURRENCE_CHANGED", message: "The recurrence definition changed." } };
        if (current.status === "cancelled") return { error: { status: 409, code: "CALENDAR_SERIES_CANCELLED", message: "A cancelled series cannot be rescheduled; restore or edit its series first." } };
        const exception = (current.occurrenceExceptions || []).find((row: any) => new Date(row.occurrenceStartsAt).getTime() === original.getTime());
        const movedBlock = current.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && block.occurrenceStartsAt && new Date(block.occurrenceStartsAt).getTime() === original.getTime());
        const currentBase = current.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt);
        if (current.meeting && (body.action === "reschedule" || (body.action === "restore" && exception)) && !currentBase) return { error: { status: 409, code: "MEETING_PLACEMENT_MISSING", message: "Meeting Scheduler authority must be repaired before moving an occurrence." } };
        if (body.action === "cancel" && original.getTime() === new Date(current.startsAt).getTime() && currentBase) return { error: { status: 409, code: "CALENDAR_PLACEMENT_ACTIVE", message: "This occurrence owns the series Scheduler placement. Edit or cancel the whole meeting first." } };
        if (body.action === "restore" && !exception) return { error: { status: 409, code: "CALENDAR_OCCURRENCE_UNCHANGED", message: "Occurrence already uses its original time." } };
        if (body.action === "cancel" && exception?.status === "cancelled") return { error: { status: 409, code: "CALENDAR_OCCURRENCE_UNCHANGED", message: "Occurrence is already skipped." } };
        if ((body.action === "reschedule" || (body.action === "restore" && exception)) && current.meeting) {
          const blockResources = (currentBase?.resourceReservations || []).map((row: any) => ({ resourceId: row.resourceId, quantity: Number(row.quantity || 1) }));
          const currentUsers = [String(current.ownerId || ""), ...parseStringList(current.attendeeIds)].filter(Boolean);
          const active = await tx.scheduleResource.findMany({ where: { id: { in: blockResources.map((r: any) => r.resourceId) }, status: "active" } });
          if (active.length !== blockResources.length) return { error: { status: 409, code: "MEETING_RESOURCE_UNAVAILABLE", message: "A required room or resource is not available." } };
          const conflicts = await findSchedulePlacementConflicts(tx, { startsAt: plannedStart, endsAt: plannedEnd, userIds: currentUsers,
            resources: blockResources, excludeBlockIds: movedBlock ? [movedBlock.id] : [],
            excludeCalendarOccurrence: { calendarEventId: eventId, occurrenceStartsAt: original } });
          if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
            return { error: { status: 409, code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "Recurring Calendar availability could not be fully verified. Try a shorter time range or review the recurrence." } };
          if (conflicts.length) return { error: { status: 409, code: "MEETING_SCHEDULER_CONFLICT", message: "The proposed occurrence conflicts with Calendar or Scheduler reservations.",
            // Calendar delegates do not automatically have access to other
            // users' Scheduler blocks or private meeting titles.
            conflicts: conflicts.slice(0, 30).map((item: any) => ({ kind: item.kind, severity: item.severity,
              message: item.kind === "resource" ? "A selected resource is unavailable for this time." : "A participant is busy or unavailable for this time." })) } };
        }
        if (body.action === "reschedule" && !exception && current.occurrenceExceptions.length >= 256) return { error: { status: 409, code: "CALENDAR_EXCEPTION_LIMIT", message: "The series reached its 256-exception limit." } };
        if (body.action === "cancel" && !exception && current.occurrenceExceptions.length >= 256) return { error: { status: 409, code: "CALENDAR_EXCEPTION_LIMIT", message: "The series reached its 256-exception limit." } };
        const claim = await tx.calendarEvent.updateMany({ where: { id: eventId, revision: body.expectedRevision }, data: { revision: { increment: 1 } } });
        if (claim.count !== 1) return { error: { status: 409, code: "REVISION_CONFLICT", message: "The Calendar series changed." } };
        if (movedBlock && body.action !== "reschedule") await tx.scheduleBlock.delete({ where: { id: movedBlock.id } });
        const key = { calendarEventId_occurrenceStartsAt: { calendarEventId: eventId, occurrenceStartsAt: original } };
        if (body.action === "restore") {
          await tx.calendarEventOccurrenceException.delete({ where: key });
        } else {
          const data = { status: body.action === "reschedule" ? "rescheduled" : "cancelled", movedStartsAt: body.action === "reschedule" ? plannedStart : null,
            movedEndsAt: body.action === "reschedule" ? plannedEnd : null, actorUserId: actor.id, reason: body.reason || null };
          if (exception) await tx.calendarEventOccurrenceException.update({ where: key, data });
          else await tx.calendarEventOccurrenceException.create({ data: { ...key.calendarEventId_occurrenceStartsAt, ...data } });
        }
        if (body.action === "reschedule" && current.meeting) {
          const blockData = { userId: current.ownerId, projectId: current.projectId || null, calendarEventId: eventId,
            occurrenceStartsAt: original, title: current.title, description: current.description || null, startsAt: plannedStart, endsAt: plannedEnd,
            type: "meeting", windowKind: "standard", status: scheduleStatusFromEvent(current.status),
            participantIds: current.attendeeIds, timezone: current.timezone, calendarSync: false,
            placementAuthority: "calendar", color: current.color || null };
          const booked = movedBlock
            ? await tx.scheduleBlock.update({ where: { id: movedBlock.id }, data: { ...blockData, revision: { increment: 1 } } })
            : await tx.scheduleBlock.create({ data: blockData });
          await replaceScheduleReservations(tx, booked.id, (currentBase.resourceReservations || []).map((row: any) => ({ resourceId: row.resourceId, quantity: row.quantity })));
        }
        return { event: await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude }) };
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      if (["P2002", "P2034"].includes(String(error?.code))) return reply.code(409).send({ ok: false, code: "CALENDAR_BOOKING_CONFLICT", error: "Scheduling changed concurrently; reload and retry." });
      throw error;
    }
    if (result?.error) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision, conflicts: result.error.conflicts });
    await logActivity({ userId: actor.id, projectId: existing.projectId, type: "updated", entityType: "calendar_event", entityId: eventId,
      title: body.action === "cancel" ? "Calendar occurrence cancelled" : body.action === "restore" ? "Calendar occurrence restored" : "Calendar occurrence moved",
      message: `${original.toISOString()}${body.action === "reschedule" ? ` → ${plannedStart.toISOString()}` : ""}${body.reason ? ` · ${body.reason}` : ""}` });
    return serializeForRequest(request, result.event);
  });

  /** Occurrence responses have their own CAS revisions, so an RSVP does not
   * invalidate reminder receipts for every other date in the series. */
  app.patch("/api/calendar/events/:eventId/occurrence-response", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { eventId } = z.object({ eventId: z.string() }).parse(request.params);
    const body = z.object({
      occurrenceStartsAt: z.string().refine(isCalendarInstant),
      expectedRevision: z.number().int().min(1),
      responses: z.array(z.object({
        userId: z.string().min(1),
        rsvp: z.enum(SCHEDULING_CONTRACT.calendar.meetingRsvpStates).optional(),
        attendance: z.enum(SCHEDULING_CONTRACT.calendar.meetingAttendanceStates).optional(),
        expectedResponseRevision: z.number().int().min(0),
      }).refine((item) => item.rsvp !== undefined || item.attendance !== undefined, "Response required.")).min(1)
        .max(SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock + 1),
    }).parse(request.body);
    const existing = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
    if (!existing?.meeting) return reply.code(404).send({ ok: false, code: "MEETING_NOT_FOUND", error: "Meeting not found." });
    if (!(await canViewEvent(request, existing))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot access this meeting." });
    const recordingAttendance = body.responses.some((item) => item.attendance !== undefined);
    if (recordingAttendance && !(await canManageMeetingAttendance(request, existing))) return reply.code(403).send({ ok: false, code: "MEETING_ATTENDANCE_FORBIDDEN", error: "Only the organizer or Calendar manager can record attendance." });
    if (body.responses.some((item) => item.rsvp !== undefined && item.userId !== String(actor.id))) return reply.code(403).send({ ok: false, code: "MEETING_RSVP_FORBIDDEN", error: "Only participants can change their own RSVP." });
    if (new Set(body.responses.map((item) => item.userId)).size !== body.responses.length) return reply.code(400).send({ ok: false, code: "MEETING_OCCURRENCE_DUPLICATE", error: "Each participant may appear once per update." });
    const occurrence = new Date(body.occurrenceStartsAt);
    let result: any;
    try {
      result = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, { calendarEventIds: [eventId] });
      const current = await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
      if (!current?.meeting) return { error: { status: 404, code: "MEETING_NOT_FOUND", message: "Meeting not found." } };
      if (Number(current.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "The meeting series changed; reload its responses.", currentRevision: current.revision } };
      if (!current.recurrenceRule || current.status === "cancelled" || !calendarOccurrenceIsValid(current, occurrence)) return { error: { status: 400, code: "CALENDAR_OCCURRENCE_INVALID", message: "Selected time is not an active occurrence of this recurring meeting." } };
      if (isCancelledCalendarOccurrence(current, occurrence)) return { error: { status: 409, code: "CALENDAR_OCCURRENCE_CANCELLED", message: "A skipped occurrence cannot receive responses." } };
      const participants = new Set([String(current.meeting.organizerId), ...parseStringList(current.attendeeIds)]);
      if (body.responses.some((item) => !participants.has(item.userId))) return { error: { status: 403, code: "MEETING_PARTICIPANT_REVOKED", message: "A participant is no longer invited." } };
      for (const item of body.responses) {
        const key = { calendarEventId_occurrenceStartsAt_userId: { calendarEventId: eventId, occurrenceStartsAt: occurrence, userId: item.userId } };
        const old = await tx.calendarMeetingOccurrenceResponse.findUnique({ where: key });
        if (Number(old?.revision || 0) !== item.expectedResponseRevision) return { error: { status: 409, code: "OCCURRENCE_RESPONSE_CONFLICT", message: "This occurrence response was updated elsewhere; reload it." } };
        const data = { ...(item.rsvp !== undefined ? { rsvpStatus: item.rsvp } : {}), ...(item.attendance !== undefined ? { attendanceStatus: item.attendance } : {}), updatedByUserId: String(actor.id) };
        if (old) {
          const updated = await tx.calendarMeetingOccurrenceResponse.updateMany({ where: { id: old.id, revision: old.revision }, data: { ...data, revision: { increment: 1 } } });
          if (updated.count !== 1) return { error: { status: 409, code: "OCCURRENCE_RESPONSE_CONFLICT", message: "A concurrent response was recorded." } };
        } else {
          await tx.calendarMeetingOccurrenceResponse.create({ data: { calendarEventId: eventId, occurrenceStartsAt: occurrence, userId: item.userId, ...data } });
        }
      }
      return { event: await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude }) };
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      // A unique-key race or serialization abort is a conflict, never a
      // fabricated success or an instruction to overwrite another response.
      if (["P2002", "P2034"].includes(String(error?.code || "")))
        return reply.code(409).send({ ok: false, code: "OCCURRENCE_RESPONSE_CONFLICT", error: "A concurrent occurrence response changed; reload before retrying." });
      throw error;
    }
    if (result?.error) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision });
    await logActivity({ userId: actor.id, projectId: existing.projectId, type: recordingAttendance ? "meeting_attendance" : "meeting_rsvp", entityType: "calendar_event", entityId: eventId, title: recordingAttendance ? "Meeting occurrence attendance updated" : "Meeting occurrence RSVP updated", message: `${occurrence.toISOString()} · ${body.responses.length} response(s)` });
    const responseRows = await prisma.calendarMeetingOccurrenceResponse.findMany({
      where: { calendarEventId: eventId, occurrenceStartsAt: occurrence }, take: 202,
    });
    if (responseRows.length > 201) return reply.code(409).send({ ok: false, code: "CALENDAR_RESPONSE_LIMIT", error: "This occurrence has too many responses." });
    return serializeForRequest(request, { ...result.event, meetingOccurrenceResponses: responseRows });
  });

  app.patch("/api/calendar/events/:eventId/rsvp", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { eventId } = z.object({ eventId: z.string() }).parse(request.params);
    const body = rsvpSchema.parse(request.body);
    const existing = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
    if (!existing?.meeting) return reply.code(404).send({ ok: false, code: "MEETING_NOT_FOUND", error: "Meeting not found." });
    if (!(await canViewEvent(request, existing))) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot RSVP to this meeting." });
    const participants = new Set([String(existing.meeting.organizerId), ...parseStringList(existing.attendeeIds)]);
    if (!participants.has(String(actor.id))) return reply.code(403).send({ ok: false, code: "MEETING_RSVP_FORBIDDEN", error: "Only the organizer or an invited attendee can RSVP." });
    const result: any = await prisma.$transaction(async (tx: any) => {
      const current = await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
      if (!current?.meeting) return { error: { status: 404, code: "MEETING_NOT_FOUND", message: "Meeting not found." } };
      if (Number(current.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This meeting changed since you opened it.", currentRevision: Number(current.revision || 1) } };
      const rsvp = parseObject(current.meeting.rsvpState);
      rsvp[String(actor.id)] = body.status;
      await tx.meeting.update({ where: { calendarEventId: eventId }, data: { rsvpState: JSON.stringify(rsvp), revision: { increment: 1 } } });
      await tx.calendarEvent.update({ where: { id: eventId }, data: { revision: { increment: 1 } } });
      return { event: await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude }) };
    });
    if (result?.error) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision });
    await logActivity({ userId: actor.id, projectId: existing.projectId, type: "meeting_rsvp", entityType: "calendar_event", entityId: eventId, title: "Meeting RSVP updated", message: body.status });
    return serializeForRequest(request, result.event);
  });

  app.patch("/api/calendar/events/:eventId/attendance", async (request, reply) => {
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const { eventId } = z.object({ eventId: z.string() }).parse(request.params);
    const body = attendanceSchema.parse(request.body);
    const existing = await prisma.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
    if (!existing?.meeting) return reply.code(404).send({ ok: false, code: "MEETING_NOT_FOUND", error: "Meeting not found." });
    if (!(await canManageMeetingAttendance(request, existing))) return reply.code(403).send({ ok: false, code: "MEETING_ATTENDANCE_FORBIDDEN", error: "Only the organizer or a Calendar manager can record attendance." });
    const participants = new Set([String(existing.meeting.organizerId), ...parseStringList(existing.attendeeIds)]);
    if (body.attendance.some((item) => !participants.has(item.userId))) return reply.code(400).send({ ok: false, code: "MEETING_ATTENDANCE_INVALID", error: "Attendance can only be recorded for meeting participants." });
    const result: any = await prisma.$transaction(async (tx: any) => {
      const current = await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude });
      if (!current?.meeting) return { error: { status: 404, code: "MEETING_NOT_FOUND", message: "Meeting not found." } };
      if (Number(current.revision || 1) !== body.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This meeting changed since you opened it.", currentRevision: Number(current.revision || 1) } };
      const attendance = parseObject(current.meeting.attendanceState);
      for (const item of body.attendance) attendance[item.userId] = item.status;
      await tx.meeting.update({ where: { calendarEventId: eventId }, data: { attendanceState: JSON.stringify(attendance), revision: { increment: 1 } } });
      await tx.calendarEvent.update({ where: { id: eventId }, data: { revision: { increment: 1 } } });
      return { event: await tx.calendarEvent.findUnique({ where: { id: eventId }, include: calendarEventInclude }) };
    });
    if (result?.error) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision });
    await logActivity({ userId: actor.id, projectId: existing.projectId, type: "meeting_attendance", entityType: "calendar_event", entityId: eventId, title: "Meeting attendance updated", message: `${body.attendance.length} participant${body.attendance.length === 1 ? "" : "s"}` });
    return serializeForRequest(request, result.event);
  });

  app.delete("/api/calendar/events/:eventId", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." });
    const params = z.object({ eventId: z.string() }).parse(request.params);
    const query = z.object({ expectedRevision: z.coerce.number().int().min(1) }).parse(request.query || {});
    const existing = await prisma.calendarEvent.findUnique({ where: { id: params.eventId }, include: calendarEventInclude });
    if (!existing) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Calendar event not found." });
    const identity = await authorization.identityForRequest(request);
    const privileged = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
    if (!privileged && await delegatedCalendarEditor(request, existing) && String(user.id) !== String(existing.ownerId || "")) {
      return reply.code(403).send({ ok: false, code: "CALENDAR_DELEGATE_DELETE_DENIED", error: "Delegated editors cannot delete the series." });
    }
    const canEdit = existing.project
      ? await authorization.requestCanTarget(request, "calendar", existing.id, existing.project, "contribute")
      : await authorization.requestCanUserScope(request, { ownerUserId: existing.ownerId, tool: "calendar", minimum: "edit", allowUnowned: true });
    const visibilityAllowed = await canAccessCalendarEvent(authorization, request, existing, "edit");
    if (!canEdit || !visibilityAllowed) return reply.code(403).send({ ok: false, code: "ACCESS_DENIED", error: "You cannot delete this Calendar event." });
    const placement = existing.scheduleBlocks?.find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt) || null;
    const result: any = await prisma.$transaction(async (tx: any) => {
      await acquireSchedulePlacementLocks(tx, {
        blockIds: placement ? [placement.id] : [],
        userIds: [existing.ownerId, ...parseStringList(existing.attendeeIds)].filter(Boolean),
        resources: placement?.resourceReservations?.map((item: any) => ({ resourceId: item.resourceId, quantity: item.quantity })) || [],
        calendarEventIds: [existing.id],
      });
      const current = await tx.calendarEvent.findUnique({ where: { id: existing.id }, include: calendarEventInclude });
      if (!current) return { error: { status: 404, code: "RESOURCE_NOT_FOUND", message: "Calendar event not found." } };
      if (Number(current.revision || 1) !== query.expectedRevision) return { error: { status: 409, code: "REVISION_CONFLICT", message: "This Calendar event changed since you opened it.", currentRevision: Number(current.revision || 1) } };
      await tx.scheduleBlock.deleteMany({ where: { calendarEventId: current.id, placementAuthority: "calendar" } });
      await tx.calendarEvent.delete({ where: { id: current.id } });
      return { ok: true };
    });
    if (result?.error) return reply.code(result.error.status).send({ ok: false, code: result.error.code, error: result.error.message, currentRevision: result.error.currentRevision });
    await logActivity({ userId: user.id, projectId: existing.projectId, type: "deleted", entityType: "calendar_event", entityId: existing.id, title: existing.meeting ? "Meeting deleted" : "Calendar event deleted", message: existing.title });
    return { ok: true };
  });

  app.get("/api/calendar/upcoming", async (request, reply) => {
    const settings = await readSettings();
    const days = Math.max(1, Math.min(SCHEDULING_CONTRACT.calendar.maximumUpcomingDays, Number(settings.notificationLookaheadDays ?? SCHEDULING_CONTRACT.calendar.defaultUpcomingDays)));
    const now = new Date();
    const soon = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const events = await prisma.calendarEvent.findMany({ where: { OR: [
      { startsAt: { gte: now, lte: soon } },
      { startsAt: { lt: now }, recurrenceRule: { not: null } },
    ] }, include: calendarEventInclude, orderBy: { startsAt: "asc" }, take: 1001 });
    if (events.length > 1000) return reply.code(409).send({ ok: false, code: "CALENDAR_RESULT_LIMIT", error: "Upcoming Calendar scan exceeded its safety bound." });
    const dueCards = settings.calendarIncludeDueCards === false ? [] : await prisma.card.findMany({
      where: { archived: false, dueDate: { gte: now, lte: soon } },
      include: { list: { include: { board: { include: { project: { include: { memberships: { where: { status: "active" } } } } } } } } },
      orderBy: { dueDate: "asc" },
      take: 40,
    });

    const identity = await authorization.identityForRequest(request);
    const privileged = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
    let accessRules: any[] = [];
    if (!privileged && identity.user) {
      const projectIds = [...new Set([
        ...events.map((event: any) => String(event.project?.id || event.projectId || "")),
        ...dueCards.map((card: any) => String(card.list?.board?.project?.id || "")),
      ].filter(Boolean))];
      const boardIds = [...new Set(dueCards.map((card: any) => String(card.list?.board?.id || "")).filter(Boolean))];
      const ruleOr: any[] = [];
      if (projectIds.length) ruleOr.push({ targetKind: "project", targetId: { in: projectIds } });
      if (boardIds.length) ruleOr.push({ targetKind: "board", targetId: { in: boardIds } });
      accessRules = ruleOr.length ? await prisma.accessRule.findMany({ where: { status: "active", OR: ruleOr }, select: AUTHORIZATION_RULE_SELECT }).catch(() => []) : [];
    }

    const visibleEvents = (await occurrencesForRequest(request, events, now, soon)).slice(0, 40);
    const visibleDueCards = [];
    for (const card of dueCards) {
      let allowed = privileged;
      if (!allowed && identity.user) {
        const board = card?.list?.board;
        const project = board?.project;
        allowed = Boolean(board && project && authorization.hasTargetAccess(identity.user, identity.role, "board", board.id, project, accessRules, "view"));
        if (allowed && card.workItemKind === "ticket") {
          allowed = authorization.hasToolPermission(identity.user, identity.role, "tickets", "view");
        }
      }
      if (allowed) visibleDueCards.push(card);
    }
    const payload = {
      lookaheadDays: days,
      events: visibleEvents,
      dueCards: visibleDueCards.map((card: any) => ({
        id: card.id,
        title: card.title,
        dueDate: card.dueDate,
        priority: card.priority,
        list: { id: card.list.id, title: card.list.title },
        board: { id: card.list.board.id, name: card.list.board.name },
        project: { id: card.list.board.project.id, name: card.list.board.project.name },
      })),
    };
    return sendPrivateRevalidated(request, reply, payload);
  });
}

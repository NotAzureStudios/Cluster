import { CLUSTER_DOMAIN_EVENTS } from "@cluster/shared";
import { createClusterDomainEvent } from "../../core/domain-events.js";
import { dueCalendarReminderOccurrence, movedCalendarOccurrence } from "./calendar-reminder-occurrences.js";

/** Durable G08 Calendar reminders. Authorizable recipients are checked at
 * delivery time, not inferred from a stale attendee list or a cached UI view.
 * Occurrence identity is shared by recurring series and occurrence responses.
 */
export function createCalendarReminderLifecycle(input: {
  prisma: any;
  events: any;
  canViewRecipient?: (user: any, calendarEvent: any) => Promise<boolean>;
}) {
  const { prisma, events } = input;
  function attendees(raw: unknown) {
    if (raw === null || raw === undefined || raw === "") return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed) || parsed.length > 200 || parsed.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("CALENDAR_REMINDER_PARTICIPANTS_INVALID");
    }
    return [...new Set(parsed)];
  }
  function isEligibleAccount(user: any, now: Date) {
    return Boolean(user && !user.archived && !["PRIVACY_ERASED", "SUSPENDED", "DISABLED"].includes(String(user.accountState))
      && (!user.accessExpiresAt || new Date(user.accessExpiresAt).getTime() > now.getTime()));
  }
  async function deliver(eventId: string, now: Date = new Date()) {
    let result;
    try {
      result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.calendarEvent.findUnique({
          where: { id: eventId },
          include: { project: { include: { memberships: { where: { status: "active" } } } }, meeting: true, occurrenceExceptions: true },
        });
        const occurrence = dueCalendarReminderOccurrence(current, now);
        if (!current || !occurrence) return { outcome: "not_due" as const, delivered: 0 };
        // Moved occurrences may originate months before the new booking. Fetch
        // their responses by ORIGINAL identity rather than recent date range.
        const responses = await tx.calendarMeetingOccurrenceResponse.findMany({
          where: { calendarEventId: current.id, occurrenceStartsAt: occurrence }, take: 202,
        });
        if (!Array.isArray(responses) || responses.length > 201) throw new Error("CALENDAR_REMINDER_RESPONSE_LIMIT");
        const notifyParticipants = current.reminderAudience === "participants";
        const recipientIds = [String(current.ownerId), ...(notifyParticipants ? attendees(current.attendeeIds) : [])];
        const uniqueIds = [...new Set(recipientIds.filter(Boolean))];
        if (uniqueIds.length > 201) throw new Error("CALENDAR_REMINDER_PARTICIPANTS_INVALID");
        const users = await tx.user.findMany({ where: { id: { in: uniqueIds } } });
        if (!Array.isArray(users)) throw new Error("CALENDAR_REMINDER_USER_LOOKUP_UNAVAILABLE");
        const byId = new Map(users.map((user: any) => [user.id, user]));
        const sent = await tx.calendarEventReminderDispatch.findMany({
          where: { calendarEventId: current.id, eventRevision: current.revision, occurrenceStartsAt: occurrence },
          select: { recipientUserId: true },
        });
        if (!Array.isArray(sent)) throw new Error("CALENDAR_REMINDER_RECEIPTS_UNAVAILABLE");
        const alreadySent = new Set(sent.map((row: any) => String(row.recipientUserId)));
        let declined = new Set<string>();
        if (notifyParticipants && current.meeting?.rsvpState) {
          let states: any;
          try { states = JSON.parse(current.meeting.rsvpState); } catch { throw new Error("CALENDAR_REMINDER_RSVP_INVALID"); }
          if (!states || typeof states !== "object" || Array.isArray(states)) throw new Error("CALENDAR_REMINDER_RSVP_INVALID");
          const selected = new Map(responses
            .filter((row: any) => new Date(row.occurrenceStartsAt).getTime() === occurrence.getTime() && row.rsvpStatus)
            .map((row: any) => [String(row.userId), row.rsvpStatus]));
          declined = new Set(Object.entries(states).filter(([id, state]) => (selected.get(id) || state) === "declined").map(([id]) => id));
        }
        let delivered = 0;
        for (const id of uniqueIds) {
          if (alreadySent.has(id) || (id !== current.ownerId && declined.has(id))) continue;
          const user = byId.get(id);
          if (!isEligibleAccount(user, now)) continue;
          // Owner-only delivery remains safe without a cross-tool callback.
          // Participant fanout, even to an admin, requires canonical permission
          // evaluation. No callback is never an implicit allow.
          if (notifyParticipants && (typeof input.canViewRecipient !== "function" || !(await input.canViewRecipient(user, current)))) continue;
          if (!notifyParticipants && id !== current.ownerId) continue;
          const activity = await tx.activityEvent.create({ data: {
            userId: null, type: "due", entityType: "calendar_reminder", entityId: current.id,
            title: `Calendar reminder: ${current.title}`.slice(0, 220),
            message: `Starts ${(movedCalendarOccurrence(current, occurrence)?.startsAt || occurrence).toISOString()}${current.location ? ` · ${current.location}` : ""}`.slice(0, 4000),
            metadata: JSON.stringify({ userIds: [id], notifyInbox: true, notificationSignal: "due", notificationTool: "calendar", notificationGroupKey: `calendar-reminder:${current.id}:${current.revision}:${occurrence.toISOString()}:${id}`, calendarEventId: current.id, eventRevision: current.revision, occurrenceStartsAt: occurrence.toISOString() }),
          } });
          await tx.calendarEventReminderDispatch.create({ data: {
            calendarEventId: current.id, eventRevision: current.revision, occurrenceStartsAt: occurrence,
            recipientUserId: id, activityEventId: activity.id, sentAt: now,
          } });
          await events.appendInTransaction(tx, createClusterDomainEvent(CLUSTER_DOMAIN_EVENTS.activityRecorded, {
            occurredAt: activity.createdAt instanceof Date ? activity.createdAt : now,
            actorUserId: null, resource: null, payload: activity,
          }));
          delivered += 1;
        }
        return { outcome: delivered ? "delivered" as const : "no_eligible_recipients" as const, delivered };
      }, { isolationLevel: "Serializable", timeout: 20_000 });
    } catch (error: any) {
      if (error?.code === "P2002") return { outcome: "already_sent" as const, delivered: 0 };
      throw error;
    }
    if (result.outcome === "delivered") events.wake();
    return result;
  }
  async function runDue(options: { now?: Date; limit?: number } = {}) {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(1000, options.limit ?? 500));
    const candidates = await prisma.calendarEvent.findMany({
      where: { ownerId: { not: null }, status: "scheduled", reminderMinutes: { not: null },
        startsAt: { lte: new Date(now.getTime() + 7 * 86_400_000) },
        OR: [{ recurrenceRule: { not: null }, OR: [
          { recurrenceEndDate: null }, { recurrenceEndDate: { gte: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) } },
          { occurrenceExceptions: { some: { status: "rescheduled", movedStartsAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: new Date(now.getTime() + 7 * 86_400_000) } } } },
        ] }, { startsAt: { gte: new Date(now.getTime() - 5 * 60_000) } }] },
      include: { occurrenceExceptions: { select: { occurrenceStartsAt: true, status: true, movedStartsAt: true, movedEndsAt: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: limit + 1,
    });
    if (!Array.isArray(candidates) || candidates.length > limit) throw new Error("CALENDAR_REMINDER_SCAN_INCOMPLETE");
    let delivered = 0;
    for (const event of candidates) {
      if (!dueCalendarReminderOccurrence(event, now)) continue;
      const result = await deliver(event.id, now);
      delivered += result.delivered;
    }
    return { examined: candidates.length, delivered };
  }
  return { deliver, runDue };
}

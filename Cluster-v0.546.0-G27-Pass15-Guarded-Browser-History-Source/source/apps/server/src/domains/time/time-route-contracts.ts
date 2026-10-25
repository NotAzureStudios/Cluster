import { SCHEDULING_CONTRACT } from "@cluster/shared";
import { z } from "zod";

export const timeEntryInclude = {
  user: true,
  project: { include: { memberships: { where: { status: "active" } } } },
  board: true,
  card: true,
  breaks: { orderBy: { startedAt: "asc" as const } },
};

export const scheduleBlockInclude = {
  user: true,
  project: { include: { memberships: { where: { status: "active" } } } },
  board: true,
  card: true,
  calendarEvent: true,
  resourceReservations: { include: { resource: true } },
};

const scheduleResourceRequestSchema = z.object({
  resourceId: z.string(),
  quantity: z.number().int().min(1).max(SCHEDULING_CONTRACT.scheduler.maximumResourceQuantity).optional(),
});

export const scheduleBlockInputSchema = z.object({
  userId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  boardId: z.string().optional().nullable(),
  cardId: z.string().optional().nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  type: z.enum(["work", "meeting", "focus", "availability", "time-off", "unavailable"]).optional().default("work"),
  windowKind: z.enum(SCHEDULING_CONTRACT.scheduler.windowKinds).optional().default(SCHEDULING_CONTRACT.scheduler.defaultWindowKind),
  status: z.enum(SCHEDULING_CONTRACT.scheduler.blockStatuses).optional().default(SCHEDULING_CONTRACT.scheduler.defaultBlockStatus),
  participantIds: z.array(z.string()).max(SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock).optional().default([]),
  resources: z.array(scheduleResourceRequestSchema).max(SCHEDULING_CONTRACT.scheduler.maximumResourcesPerBlock).optional().default([]),
  calendarMirror: z.boolean().optional(),
  calendarEventId: z.string().optional().nullable(),
  allowConflicts: z.boolean().optional().default(false),
  expectedRevision: z.number().int().min(1).optional(),
  color: z.string().max(32).optional().nullable(),
  timezone: z.string().trim().max(80).optional().nullable(),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly"]),
    occurrences: z.number().int().min(2).max(SCHEDULING_CONTRACT.scheduler.maximumRecurringOccurrences),
  }).optional().nullable(),
});

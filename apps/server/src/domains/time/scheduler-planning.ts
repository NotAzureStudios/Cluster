import { SCHEDULING_CONTRACT, type SchedulePlacementConflict, type ScheduleResourceRequest } from "@cluster/shared";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";
import { findCalendarVirtualOccupancy } from "./scheduler-calendar-availability.js";

export function parseScheduleStringList(value: unknown): string[] {
  if (Array.isArray(value)) return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? Array.from(new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))) : [];
  } catch {
    return [];
  }
}


export function normalizeScheduleTimezone(value: unknown) {
  const timezone = String(value || "").trim();
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone.slice(0, 80);
  } catch {
    return "UTC";
  }
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function wallClockUtc(parts: ZonedParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
}

/**
 * Deterministic DST policy: choose the earlier instant when a wall time repeats;
 * for a skipped wall time, shift forward by the gap (preserving the minute).
 * Avoid a correction loop, which oscillates forever at the spring transition.
 */
function zonedWallToUtc(parts: ZonedParts, timeZone: string) {
  const desired = wallClockUtc(parts);
  const offsetSamples = new Set<number>();
  for (const step of [-48, -24, 0, 24, 48]) {
    const epoch = desired + step * 3_600_000;
    offsetSamples.add(wallClockUtc(zonedParts(new Date(epoch), timeZone)) - epoch);
  }
  const candidates = Array.from(offsetSamples, (offset) => desired - offset).map((epoch) => ({ epoch, wall: wallClockUtc(zonedParts(new Date(epoch), timeZone)) }));
  const exact = candidates.filter((value) => value.wall === desired).sort((a, b) => a.epoch - b.epoch);
  if (exact.length) return new Date(exact[0].epoch);
  const following = candidates.filter((value) => value.wall > desired).sort((a, b) => a.wall - b.wall || a.epoch - b.epoch);
  if (following.length) return new Date(following[0].epoch);
  throw new RangeError(`Cannot resolve local calendar time in ${timeZone}.`);
}

export function buildScheduleOccurrences(startsAt: Date, endsAt: Date, recurrence: { frequency: "daily" | "weekly"; occurrences: number } | null | undefined, timezoneInput?: unknown) {
  const count = Math.max(1, Number(recurrence?.occurrences || 1));
  const timeZone = normalizeScheduleTimezone(timezoneInput);
  if (!recurrence || count === 1) return [{ startsAt, endsAt, index: 0, timezone: timeZone }];
  const startWall = zonedParts(startsAt, timeZone);
  const durationMs = Math.max(1, endsAt.getTime() - startsAt.getTime());
  const stepDays = recurrence.frequency === "daily" ? 1 : 7;
  const output: Array<{ startsAt: Date; endsAt: Date; index: number; timezone: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const wallDate = new Date(Date.UTC(startWall.year, startWall.month - 1, startWall.day + (index * stepDays), startWall.hour, startWall.minute, startWall.second));
    const nextParts: ZonedParts = {
      year: wallDate.getUTCFullYear(), month: wallDate.getUTCMonth() + 1, day: wallDate.getUTCDate(),
      hour: startWall.hour, minute: startWall.minute, second: startWall.second,
    };
    const occurrenceStartsAt = zonedWallToUtc(nextParts, timeZone);
    output.push({ startsAt: occurrenceStartsAt, endsAt: new Date(occurrenceStartsAt.getTime() + durationMs), index, timezone: timeZone });
  }
  return output;
}

type PlacementLockInput = {
  userIds?: string[];
  resources?: ScheduleResourceRequest[];
  blockIds?: string[];
  calendarEventIds?: Array<string | null | undefined>;
};

export async function acquireSchedulePlacementLocks(tx: any, input: PlacementLockInput) {
  const keys = new Set<string>();
  for (const userId of input.userIds || []) if (userId) keys.add(`cluster-schedule-user:${userId}`);
  for (const resource of normalizeScheduleResourceRequests(input.resources || [])) keys.add(`cluster-schedule-resource:${resource.resourceId}`);
  for (const blockId of input.blockIds || []) if (blockId) keys.add(`cluster-schedule-block:${blockId}`);
  for (const calendarEventId of input.calendarEventIds || []) if (calendarEventId) keys.add(`cluster-schedule-calendar:${calendarEventId}`);
  for (const key of Array.from(keys).sort()) await acquireTransactionAdvisoryLock(tx, key);
}

export async function ensureScheduleCalendarAvailable(tx: any, calendarEventId: string | null | undefined, excludeBlockIds: string[] = []) {
  if (!calendarEventId) return true;
  const existing = await tx.scheduleBlock.findFirst({
    where: { calendarEventId, ...(excludeBlockIds.length ? { id: { notIn: excludeBlockIds } } : {}) },
    select: { id: true },
  });
  return !existing;
}

export function normalizeScheduleParticipants(ownerId: string | null | undefined, participantIds: unknown) {
  const ids = parseScheduleStringList(participantIds).slice(0, SCHEDULING_CONTRACT.scheduler.maximumParticipantsPerBlock);
  return Array.from(new Set(ids.filter((id) => id !== String(ownerId || ""))));
}

export function normalizeScheduleResourceRequests(input: unknown): ScheduleResourceRequest[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const output: ScheduleResourceRequest[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const resourceId = String((raw as any).resourceId || "").trim();
    if (!resourceId || seen.has(resourceId)) continue;
    seen.add(resourceId);
    const quantity = Math.max(1, Math.min(SCHEDULING_CONTRACT.scheduler.maximumResourceQuantity, Math.floor(Number((raw as any).quantity || 1))));
    output.push({ resourceId, quantity });
    if (output.length >= SCHEDULING_CONTRACT.scheduler.maximumResourcesPerBlock) break;
  }
  return output;
}

export function scheduleBlockUserIds(block: any) {
  return Array.from(new Set([block?.userId, ...parseScheduleStringList(block?.participantIds)].map((value) => String(value || "").trim()).filter(Boolean)));
}

export function serializeScheduleResource(resource: any) {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    description: resource.description || null,
    location: resource.location || null,
    quantityTotal: Math.max(1, Number(resource.quantityTotal || 1)),
    status: resource.status || SCHEDULING_CONTRACT.scheduler.defaultResourceStatus,
    tags: parseScheduleStringList(resource.tags),
    projectTypeIds: parseScheduleStringList(resource.projectTypeIds),
    color: resource.color || null,
    revision: Number(resource.revision || 1),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

export function serializeScheduleReservations(block: any) {
  return (block?.resourceReservations || []).map((reservation: any) => ({
    id: reservation.id,
    resourceId: reservation.resourceId,
    quantity: Math.max(1, Number(reservation.quantity || 1)),
    resource: reservation.resource ? serializeScheduleResource(reservation.resource) : null,
  }));
}

type PlacementInput = {
  startsAt: Date;
  endsAt: Date;
  userIds: string[];
  resources: ScheduleResourceRequest[];
  excludeBlockId?: string | null;
  excludeBlockIds?: string[];
  excludeCalendarOccurrence?: { calendarEventId: string; occurrenceStartsAt: Date };
  excludeCalendarEventId?: string;
};

export type ScheduleAvailabilitySignal = {
  kind: "preferred";
  userId: string;
  startsAt: string;
  endsAt: string;
  title: string;
  message: string;
};

export async function findPreferredAvailabilitySignals(prisma: any, input: Pick<PlacementInput, "startsAt" | "endsAt" | "userIds">): Promise<ScheduleAvailabilitySignal[]> {
  const userIds = Array.from(new Set((input.userIds || []).map(String).filter(Boolean)));
  if (!userIds.length) return [];
  const rows = await prisma.availabilityException.findMany({
    where: {
      userId: { in: userIds },
      status: { not: "cancelled" },
      kind: "preferred",
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    orderBy: { startsAt: "asc" },
    take: Math.max(100, userIds.length * 20),
  }).catch((): any[] => []);
  return rows.map((row: any) => ({
    kind: "preferred" as const,
    userId: String(row.userId),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    title: row.reason || "Preferred availability",
    message: "This window overlaps a preferred availability period.",
  }));
}

export async function findSchedulePlacementConflicts(prisma: any, input: PlacementInput): Promise<SchedulePlacementConflict[]> {
  const userIds = Array.from(new Set((input.userIds || []).map(String).filter(Boolean)));
  const resources = normalizeScheduleResourceRequests(input.resources);
  const resourceIds = resources.map((item) => item.resourceId);
  const excludedIds = Array.from(new Set([...(input.excludeBlockIds || []), ...(input.excludeBlockId ? [input.excludeBlockId] : [])].filter(Boolean)));
  const relevant: any[] = [];
  if (userIds.length) {
    relevant.push({ userId: { in: userIds } });
    for (const userId of userIds) relevant.push({ participantIds: { contains: `\"${userId}\"` } });
  }
  if (resourceIds.length) relevant.push({ resourceReservations: { some: { resourceId: { in: resourceIds } } } });
  const overlapping = await prisma.scheduleBlock.findMany({
    where: {
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      status: { not: "cancelled" },
      ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
      ...(relevant.length ? { OR: relevant } : {}),
    },
    include: { resourceReservations: { include: { resource: true } } },
    orderBy: { startsAt: "asc" },
    take: SCHEDULING_CONTRACT.scheduler.maximumBlocksPerRange,
  });

  const conflicts: SchedulePlacementConflict[] = [];
  const workforceExceptions = userIds.length ? await prisma.availabilityException.findMany({
    where: {
      userId: { in: userIds },
      status: { not: "cancelled" },
      kind: { in: ["unavailable", "limited", "time_off"] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    orderBy: { startsAt: "asc" },
    take: Math.max(100, userIds.length * 20),
  }).catch((): any[] => []) : [];
  const workforceProfiles = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      workingPattern: { select: { timezone: true, hoursJson: true } },
      employment: { select: { capacityHours: true } },
      projectMemberships: { where: { status: "active" }, select: { allocationPercent: true, projectId: true } },
    },
  }).catch((): any[] => []) : [];
  const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const parseHours = (value: unknown) => { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } };
  const localClock = (value: Date, timezone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
    const read = (kind: string) => parts.find((part) => part.type === kind)?.value || "";
    return { day: read("weekday").toLowerCase(), minutes: Number(read("hour") || 0) * 60 + Number(read("minute") || 0) };
  };
  const intervalMinutes = (value: unknown) => { const [h, m] = String(value || "").split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  for (const profile of workforceProfiles) {
    const pattern = profile.workingPattern;
    const timezone = normalizeScheduleTimezone(pattern?.timezone || "UTC");
    const hours: any = parseHours(pattern?.hoursJson);
    const startLocal = localClock(input.startsAt, timezone);
    const endLocal = localClock(input.endsAt, timezone);
    const intervals = Array.isArray(hours?.[startLocal.day]) ? hours[startLocal.day] : [];
    const insideWorkingPattern = intervals.some((interval: any) => {
      const start = intervalMinutes(interval?.start); const end = intervalMinutes(interval?.end);
      return start != null && end != null && startLocal.day === endLocal.day && startLocal.minutes >= start && endLocal.minutes <= end;
    });
    if (Object.keys(hours || {}).some((key) => dayKeys.includes(String(key).toLowerCase())) && !insideWorkingPattern) {
      conflicts.push({ kind: "person", severity: "medium", message: `Proposed time is outside this person's declared working pattern (${timezone}).`, blockId: `working-pattern:${profile.id}`, title: "Outside working hours", startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), userId: profile.id });
    }
    const allocationPercent = (profile.projectMemberships || []).reduce((sum: number, membership: any) => sum + Number(membership.allocationPercent || 0), 0);
    if (allocationPercent > 100) {
      conflicts.push({ kind: "person", severity: "medium", message: `This person is already allocated at ${allocationPercent}% across active projects.`, blockId: `allocation:${profile.id}`, title: "Allocation conflict", startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), userId: profile.id });
    }
  }
  for (const exception of workforceExceptions) {
    const isLimited = exception.kind === "limited";
    const isTimeOff = exception.kind === "time_off";
    conflicts.push({
      kind: "person",
      severity: isLimited ? "medium" : "high",
      message: isLimited ? "This person has limited availability during the proposed window." : isTimeOff ? "This person has time off during the proposed window." : "This person is unavailable during the proposed window.",
      blockId: `availability:${exception.id}`,
      title: exception.reason || (isTimeOff ? "Time off" : isLimited ? "Limited availability" : "Unavailable"),
      startsAt: exception.startsAt.toISOString(),
      endsAt: exception.endsAt.toISOString(),
      userId: exception.userId,
    });
  }
  for (const block of overlapping) {
    const blockUsers = scheduleBlockUserIds(block);
    for (const userId of userIds) {
      if (!blockUsers.includes(userId)) continue;
      const hard = ["time-off", "unavailable"].includes(String(block.type));
      conflicts.push({
        kind: "person",
        severity: hard ? "high" : "medium",
        message: hard ? `${block.title} marks this person unavailable.` : `${block.title} overlaps this person's schedule.`,
        blockId: block.id,
        title: block.title,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
        userId,
      });
    }
  }

  const resourceRows = resourceIds.length ? await prisma.scheduleResource.findMany({ where: { id: { in: resourceIds } } }) : [];
  if (resourceIds.length) {
    const resourceMap = new Map(resourceRows.map((resource: any) => [String(resource.id), resource]));
    for (const request of resources) {
      const resource: any = resourceMap.get(request.resourceId);
      if (!resource) {
        conflicts.push({ kind: "resource", severity: "high", message: "Selected resource no longer exists.", blockId: `resource:${request.resourceId}`, title: "Missing resource", startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), resourceId: request.resourceId, requestedQuantity: request.quantity || 1, capacity: 0, reservedQuantity: 0 });
        continue;
      }
      const requestedQuantity = Math.max(1, Number(request.quantity || 1));
      const capacity = Math.max(1, Number(resource.quantityTotal || 1));
      if (resource.status !== "active") {
        conflicts.push({ kind: "resource", severity: "high", message: `${resource.name} is ${resource.status}.`, blockId: `resource:${resource.id}`, title: resource.name, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), resourceId: resource.id, requestedQuantity, capacity, reservedQuantity: 0 });
        continue;
      }
      const reservationBlocks: any[] = [];
      const events: Array<{ at: number; delta: number }> = [];
      for (const block of overlapping) {
        const reservation = (block.resourceReservations || []).find((item: any) => item.resourceId === resource.id);
        if (!reservation) continue;
        const quantity = Math.max(1, Number(reservation.quantity || 1));
        const startsAt = Math.max(input.startsAt.getTime(), new Date(block.startsAt).getTime());
        const endsAt = Math.min(input.endsAt.getTime(), new Date(block.endsAt).getTime());
        if (startsAt >= endsAt) continue;
        reservationBlocks.push(block);
        events.push({ at: startsAt, delta: quantity }, { at: endsAt, delta: -quantity });
      }
      events.sort((a, b) => a.at - b.at || a.delta - b.delta);
      let running = 0;
      let reservedQuantity = 0;
      for (const event of events) {
        running += event.delta;
        reservedQuantity = Math.max(reservedQuantity, running);
      }
      if (reservedQuantity + requestedQuantity > capacity) {
        const first = reservationBlocks[0];
        conflicts.push({
          kind: "resource",
          severity: "high",
          message: `${resource.name} would exceed capacity (${reservedQuantity + requestedQuantity}/${capacity}).`,
          blockId: first?.id || `resource:${resource.id}`,
          title: first?.title || resource.name,
          startsAt: first?.startsAt?.toISOString?.() || input.startsAt.toISOString(),
          endsAt: first?.endsAt?.toISOString?.() || input.endsAt.toISOString(),
          resourceId: resource.id,
          requestedQuantity,
          reservedQuantity,
          capacity,
        });
      }
    }
  }

  // The physical ScheduleBlock table stores a recurring meeting's anchor and
  // detached instances, not every future occurrence. Include virtual series
  // occupancy in every Scheduler availability/create/update path, with the
  // SAME user/resource locks acquired by placement callers.
  const capacityByResource = new Map<string, number>(resourceRows.map((row: any) =>
    [String(row.id), Math.max(1, Number(row.quantityTotal || 1))]));
  const virtual = userIds.length || resources.length ? await findCalendarVirtualOccupancy(prisma, {
    startsAt: input.startsAt, endsAt: input.endsAt, userIds, resources,
    excludeOccurrence: input.excludeCalendarOccurrence,
    excludeCalendarEventId: input.excludeCalendarEventId,
  }, overlapping, capacityByResource) : { incomplete: false, conflicts: [] as SchedulePlacementConflict[] };
  if (overlapping.length >= SCHEDULING_CONTRACT.scheduler.maximumBlocksPerRange || virtual.incomplete) conflicts.push({ kind: "resource", severity: "high",
    blockId: "calendar-virtual:incomplete", title: "Recurring availability uncertain",
    message: "Recurring Calendar occupancy could not be fully verified; this slot cannot be confirmed.",
    startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() });
  else conflicts.push(...virtual.conflicts);

  const unique = new Map<string, SchedulePlacementConflict>();
  for (const conflict of conflicts) {
    const key = `${conflict.kind}:${conflict.userId || conflict.resourceId || ""}:${conflict.blockId}:${conflict.message}`;
    if (!unique.has(key)) unique.set(key, conflict);
  }
  return Array.from(unique.values());
}

export async function replaceScheduleReservations(prisma: any, blockId: string, requests: ScheduleResourceRequest[]) {
  const normalized = normalizeScheduleResourceRequests(requests);
  await prisma.scheduleBlockResource.deleteMany({ where: { blockId } });
  if (!normalized.length) return [];
  await prisma.scheduleBlockResource.createMany({ data: normalized.map((item) => ({ blockId, resourceId: item.resourceId, quantity: Math.max(1, Number(item.quantity || 1)) })) });
  return normalized;
}

export async function schedulerProjectResourceRecommendations(prisma: any, projectId: string | null | undefined) {
  if (!projectId) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectType: true } });
  if (!project) return [];
  const resources = await prisma.scheduleResource.findMany({ where: { status: "active" }, orderBy: [{ type: "asc" }, { name: "asc" }], take: SCHEDULING_CONTRACT.scheduler.maximumResources });
  return resources
    .filter((resource: any) => {
      const types = parseScheduleStringList(resource.projectTypeIds);
      return !types.length || types.includes(String(project.projectType));
    })
    .map(serializeScheduleResource)
    .slice(0, 64);
}

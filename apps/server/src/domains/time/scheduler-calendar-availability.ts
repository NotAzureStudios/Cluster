/**
 * G25: bounded, authorization-neutral virtual recurring Calendar occupancy.
 * Every Scheduler placement must account for future Calendar series instances
 * that deliberately do not have a ScheduleBlock row. Return no private meeting
 * metadata to callers. Call under the same user/resource advisory locks as the
 * physical Scheduler check; an incomplete scan is never a proof of availability.
 */
import type { SchedulePlacementConflict, ScheduleResourceRequest } from "@cluster/shared";
import {
  calendarOccurrencesInWindow,
  isCancelledCalendarOccurrence,
  movedCalendarOccurrence,
  supportsCalendarReminderRecurrence,
} from "../planning/calendar-reminder-occurrences.js";

const DAY = 86_400_000;
const MAX_SERIES = 500;
const MAX_VIRTUAL_SLICES = 4000;

export type CalendarVirtualWindow = {
  startsAt: Date;
  endsAt: Date;
  userIds: string[];
  resources: ScheduleResourceRequest[];
  excludeOccurrence?: { calendarEventId: string; occurrenceStartsAt: Date };
  excludeCalendarEventId?: string;
};

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function summaryConflict(kind: "person" | "resource", input: CalendarVirtualWindow, fieldId: string,
  extras: Partial<SchedulePlacementConflict> = {}): SchedulePlacementConflict {
  return {
    kind, severity: "high", blockId: `calendar-virtual:${kind}:${fieldId}`,
    title: kind === "person" ? "Recurring Calendar commitment" : "Recurring resource capacity",
    message: kind === "person" ? "This attendee is already committed to another recurring meeting."
      : "The requested resource would exceed its capacity during a recurring Calendar meeting.",
    startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(),
    ...(kind === "person" ? { userId: fieldId } : { resourceId: fieldId }), ...extras,
  };
}

/** Pure evaluation for a bounded transaction snapshot, also used by regression tests. */
export function evaluateCalendarVirtualOccupancy(input: CalendarVirtualWindow, recurring: any[],
  physicalBlocks: any[], capacityByResource: Map<string, number>) {
  const wantUsers = new Set(input.userIds.filter(Boolean));
  const wantResources = new Map(input.resources.map((row) => [row.resourceId, Math.max(1, Number(row.quantity || 1))]));
  const startMs = input.startsAt.getTime(), endMs = input.endsAt.getTime();
  const fail = () => ({ incomplete: true, conflicts: [] as SchedulePlacementConflict[] });
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs || endMs - startMs > 366 * DAY || recurring.length > MAX_SERIES) return fail();
  const physicalAnchor = new Set(physicalBlocks.filter((row) => row.placementAuthority === "calendar" && !row.occurrenceStartsAt && row.calendarEventId && row.status !== "cancelled")
    .map((row) => String(row.calendarEventId)));
  const virtual: Array<{ start: number; end: number; users: string[]; resources: ScheduleResourceRequest[] }> = [];
  let projected = 0;
  for (const event of recurring) {
    if (event.id === input.excludeCalendarEventId) continue;
    if (!event.meeting || !["scheduled", "confirmed", "tentative"].includes(String(event.status))) continue;
    const people = [String(event.ownerId || ""), ...list(event.attendeeIds)].filter((id) => wantUsers.has(id));
    const base = (event.scheduleBlocks || []).find((block: any) => block.placementAuthority === "calendar" && !block.occurrenceStartsAt);
    const resources = (base?.resourceReservations || []).filter((row: any) => wantResources.has(String(row.resourceId)))
      .map((row: any) => ({ resourceId: String(row.resourceId), quantity: Math.max(1, Number(row.quantity || 1)) }));
    if (!people.length && !resources.length) continue;
    if (!supportsCalendarReminderRecurrence(event.recurrenceRule)) return fail();
    try { new Intl.DateTimeFormat("en-US", { timeZone: String(event.timezone || "UTC") }); }
    catch { return fail(); }
    if (!Array.isArray(event.occurrenceExceptions) || event.occurrenceExceptions.length > 256) return fail();
    const duration = event.endsAt ? new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime() : 0;
    if (duration < 1 || duration > 31 * DAY) return fail();
    const from = new Date(startMs - duration);
    if (endMs - from.getTime() > 366 * DAY) return fail();
    const originals = calendarOccurrencesInWindow(event, from, input.endsAt, 370);
    if (originals.length >= 370) return fail();
    for (const original of originals) {
      if (event.id === input.excludeOccurrence?.calendarEventId && original.getTime() === input.excludeOccurrence.occurrenceStartsAt.getTime()) continue;
      if (isCancelledCalendarOccurrence(event, original) || movedCalendarOccurrence(event, original)) continue;
      // The first series instance is already represented by its physical
      // Scheduler anchor; subsequent instances have no physical row.
      if (original.getTime() === new Date(event.startsAt).getTime() && physicalAnchor.has(String(event.id))) continue;
      const start = Math.max(startMs, original.getTime());
      const end = Math.min(endMs, original.getTime() + duration);
      if (start >= end) continue;
      virtual.push({ start, end, users: people, resources });
      if (++projected > MAX_VIRTUAL_SLICES) return fail();
    }
  }
  const conflicts: SchedulePlacementConflict[] = [];
  const blockedPeople = new Set<string>();
  for (const occurrence of virtual) for (const person of occurrence.users) {
    if (!blockedPeople.has(person)) {
      blockedPeople.add(person);
      conflicts.push(summaryConflict("person", input, person));
    }
  }
  for (const [resourceId, requestedQuantity] of wantResources) {
    const relevantVirtual = virtual.filter((row) => row.resources.some((r) => r.resourceId === resourceId));
    if (!relevantVirtual.length) continue;
    const capacity = capacityByResource.get(resourceId);
    // A non-existing resource is an error, not free capacity. Physical Scheduler
    // availability also reports this, but never infer a successful virtual scan.
    if (!capacity || capacity < 1) return fail();
    const events: Array<{ at: number; delta: number }> = [];
    for (const occurrence of relevantVirtual) {
      const quantity = occurrence.resources.find((r) => r.resourceId === resourceId)!.quantity || 1;
      events.push({ at: occurrence.start, delta: quantity }, { at: occurrence.end, delta: -quantity });
    }
    for (const block of physicalBlocks) {
      if (block.status === "cancelled") continue;
      const reservation = (block.resourceReservations || []).find((r: any) => r.resourceId === resourceId);
      if (!reservation) continue;
      const start = Math.max(startMs, new Date(block.startsAt).getTime());
      const end = Math.min(endMs, new Date(block.endsAt).getTime());
      if (start < end) events.push({ at: start, delta: Math.max(1, Number(reservation.quantity || 1)) },
        { at: end, delta: -Math.max(1, Number(reservation.quantity || 1)) });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let running = 0, peak = 0;
    for (const event of events) { running += event.delta; peak = Math.max(peak, running); }
    if (peak + requestedQuantity > capacity) conflicts.push(summaryConflict("resource", input, resourceId,
      { requestedQuantity, reservedQuantity: peak, capacity }));
  }
  return { incomplete: false, conflicts };
}

/** Query bounded candidate series and reuse already-loaded physical blocks. */
export async function findCalendarVirtualOccupancy(tx: any, input: CalendarVirtualWindow,
  physicalBlocks: any[], capacityByResource: Map<string, number>) {
  const relevant: any[] = [];
  if (input.userIds.length) {
    relevant.push({ ownerId: { in: input.userIds } });
    for (const userId of input.userIds) relevant.push({ attendeeIds: { contains: JSON.stringify(String(userId)) } });
  }
  if (input.resources.length) relevant.push({ scheduleBlocks: { some: {
    placementAuthority: "calendar", occurrenceStartsAt: null,
    resourceReservations: { some: { resourceId: { in: input.resources.map((resource) => resource.resourceId) } } },
  } } });
  if (!relevant.length) return { incomplete: false, conflicts: [] as SchedulePlacementConflict[] };
  const recurring = await tx.calendarEvent.findMany({
    where: {
      OR: relevant,
      recurrenceRule: { not: null }, startsAt: { lt: input.endsAt },
      // A local civil end date may be one day behind UTC, so use a safe
      // conservative lower bound. Physical detached bookings are read separately.
      AND: [{ OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: new Date(input.startsAt.getTime() - DAY).toISOString().slice(0, 10) } }] }],
      ...(input.excludeCalendarEventId ? { id: { not: input.excludeCalendarEventId } } : {}),
      status: { in: ["scheduled", "confirmed", "tentative"] }, meeting: { isNot: null },
    },
    include: {
      meeting: { select: { id: true } },
      occurrenceExceptions: true,
      scheduleBlocks: { where: { placementAuthority: "calendar", occurrenceStartsAt: null },
        include: { resourceReservations: true } },
    },
    take: MAX_SERIES + 1,
  });
  return evaluateCalendarVirtualOccupancy(input, recurring, physicalBlocks, capacityByResource);
}

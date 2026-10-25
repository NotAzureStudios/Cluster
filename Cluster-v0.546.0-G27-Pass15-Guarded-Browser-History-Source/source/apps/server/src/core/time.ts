export type TimeBreakLike = {
  type?: string | null;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  durationMinutes?: number | null;
};

export type TimeEntryLike = {
  id?: string;
  userId: string;
  projectId?: string | null;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  durationMinutes?: number | null;
  billable?: boolean | null;
  breaks?: TimeBreakLike[] | null;
};

export type ScheduleBlockLike = {
  userId?: string | null;
  projectId?: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
  type?: string | null;
};

export function asValidDate(value: Date | string, label = "date"): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}.`);
  return date;
}

export function minutesBetween(startedAt: Date | string, endedAt: Date | string): number {
  const start = asValidDate(startedAt, "start time");
  const end = asValidDate(endedAt, "end time");
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function mondayWeekStart(value: Date | string): Date {
  const date = asValidDate(value);
  const day = date.getDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday, 0, 0, 0, 0);
}

export function weekKey(value: Date | string): string {
  const start = mondayWeekStart(value);
  const year = start.getFullYear();
  const month = String(start.getMonth() + 1).padStart(2, "0");
  const day = String(start.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateTimeRange(startedAt: Date | string, endedAt: Date | string, maximumMinutes = 24 * 60): void {
  const start = asValidDate(startedAt, "start time");
  const end = asValidDate(endedAt, "end time");
  if (end.getTime() <= start.getTime()) throw new Error("End time must be after start time.");
  if (minutesBetween(start, end) > maximumMinutes) throw new Error(`Time range cannot exceed ${maximumMinutes} minutes.`);
}

export function breakMinutes(breaks: TimeBreakLike[] | null | undefined, now = new Date()): number {
  return (breaks || []).reduce((total, item) => {
    const start = asValidDate(item.startedAt, "break start");
    const end = item.endedAt ? asValidDate(item.endedAt, "break end") : now;
    const minutes = item.durationMinutes ?? minutesBetween(start, end);
    return total + Math.max(0, minutes);
  }, 0);
}

export function deductibleBreakMinutes(breaks: TimeBreakLike[] | null | undefined, now = new Date()): number {
  return breakMinutes((breaks || []).filter((item) => String(item.type || "unpaid").toLowerCase() !== "paid"), now);
}

export function grossEntryMinutes(entry: TimeEntryLike, now = new Date()): number {
  if (entry.durationMinutes != null && entry.endedAt) {
    return Math.max(0, entry.durationMinutes + deductibleBreakMinutes(entry.breaks, now));
  }
  return minutesBetween(entry.startedAt, entry.endedAt || now);
}

export function netEntryMinutes(entry: TimeEntryLike, now = new Date()): number {
  const explicit = entry.durationMinutes;
  if (explicit != null && entry.endedAt) return Math.max(0, explicit);
  return Math.max(0, grossEntryMinutes(entry, now) - deductibleBreakMinutes(entry.breaks, now));
}

export function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return start.getTime() < rangeEnd.getTime() && end.getTime() > rangeStart.getTime();
}

export function summarizeTime(
  entries: TimeEntryLike[],
  scheduleBlocks: ScheduleBlockLike[],
  input: { rangeStart: Date | string; rangeEnd: Date | string; capacityHours?: number | null; now?: Date } 
) {
  const rangeStart = asValidDate(input.rangeStart, "range start");
  const rangeEnd = asValidDate(input.rangeEnd, "range end");
  const now = input.now || new Date();
  const capacityMinutes = Math.max(0, Math.round((input.capacityHours ?? 40) * 60));
  let trackedMinutes = 0;
  let billableMinutes = 0;
  let breakTotalMinutes = 0;
  let runningCount = 0;
  const byUser = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byDay = new Map<string, number>();

  for (const entry of entries) {
    const minutes = netEntryMinutes(entry, now);
    const breaks = breakMinutes(entry.breaks, now);
    trackedMinutes += minutes;
    breakTotalMinutes += breaks;
    if (entry.billable) billableMinutes += minutes;
    if (!entry.endedAt) runningCount += 1;
    byUser.set(entry.userId, (byUser.get(entry.userId) || 0) + minutes);
    if (entry.projectId) byProject.set(entry.projectId, (byProject.get(entry.projectId) || 0) + minutes);
    const key = asValidDate(entry.startedAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + minutes);
  }

  let scheduledMinutes = 0;
  for (const block of scheduleBlocks) {
    const start = asValidDate(block.startsAt);
    const end = asValidDate(block.endsAt);
    if (overlapsRange(start, end, rangeStart, rangeEnd) && !["time-off", "unavailable"].includes(String(block.type || ""))) {
      scheduledMinutes += minutesBetween(start, end);
    }
  }

  const overtimeMinutes = Math.max(0, trackedMinutes - capacityMinutes);
  const remainingCapacityMinutes = Math.max(0, capacityMinutes - trackedMinutes);
  const utilizationPercent = capacityMinutes ? Math.round((trackedMinutes / capacityMinutes) * 100) : 0;
  const varianceMinutes = trackedMinutes - scheduledMinutes;

  return {
    trackedMinutes,
    billableMinutes,
    breakMinutes: breakTotalMinutes,
    scheduledMinutes,
    capacityMinutes,
    remainingCapacityMinutes,
    overtimeMinutes,
    varianceMinutes,
    utilizationPercent,
    runningCount,
    entryCount: entries.length,
    byUser: [...byUser.entries()].map(([id, minutes]) => ({ id, minutes })).sort((a, b) => b.minutes - a.minutes),
    byProject: [...byProject.entries()].map(([id, minutes]) => ({ id, minutes })).sort((a, b) => b.minutes - a.minutes),
    byDay: [...byDay.entries()].map(([date, minutes]) => ({ date, minutes })).sort((a, b) => a.date.localeCompare(b.date))
  };
}

export function timeExceptions(entries: TimeEntryLike[], scheduleBlocks: ScheduleBlockLike[], now = new Date()) {
  const exceptions: Array<{ code: string; severity: "low" | "medium" | "high"; entryId?: string; message: string }> = [];
  for (const entry of entries) {
    const gross = grossEntryMinutes(entry, now);
    const breaks = breakMinutes(entry.breaks, now);
    if (!entry.endedAt && gross > 12 * 60) exceptions.push({ code: "LONG_RUNNING_SHIFT", severity: "high", entryId: entry.id, message: "Active shift has been running for more than 12 hours." });
    if (entry.endedAt && gross > 16 * 60) exceptions.push({ code: "LONG_SHIFT", severity: "high", entryId: entry.id, message: "Shift exceeds 16 hours and should be reviewed." });
    if (gross >= 6 * 60 && breaks < 20) exceptions.push({ code: "MISSING_BREAK", severity: "medium", entryId: entry.id, message: "Shift exceeds 6 hours with less than 20 minutes of recorded break time." });
    if (!entry.projectId) exceptions.push({ code: "UNASSIGNED_PROJECT", severity: "low", entryId: entry.id, message: "Time entry is not assigned to a project." });
  }
  for (const block of scheduleBlocks) {
    const start = asValidDate(block.startsAt);
    const end = asValidDate(block.endsAt);
    if (end.getTime() <= start.getTime()) exceptions.push({ code: "INVALID_SCHEDULE_BLOCK", severity: "high", message: "Schedule block ends before it starts." });
  }
  return exceptions;
}

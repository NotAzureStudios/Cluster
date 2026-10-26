/** Bounded authority for future reservable Calendar series.
 * The end is a civil date in the meeting timezone (not a UTC instant): a
 * local 9AM meeting must retain its wall clock through DST changes.
 * No default end is silently written for existing unbounded records.
 */
import { calendarOccurrencesInWindow, supportsCalendarReminderRecurrence } from "./calendar-reminder-occurrences.js";

const DAY = 86_400_000;
export const CALENDAR_SERIES_MAX_DAYS = 366;
export const CALENDAR_SERIES_MAX_OCCURRENCES = 128;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function calendarCivilDay(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (key: string) => parts.find((p) => p.type === key)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayOrdinal(day: string): number {
  if (!datePattern.test(day)) return NaN;
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day ? Math.floor(stamp / DAY) : NaN;
}

export function validateCalendarSeriesHorizon(input: { startsAt: Date; endsAt: Date; timezone: string; recurrenceRule: string; recurrenceEndDate?: string | null }) {
  const { startsAt, endsAt, timezone, recurrenceRule, recurrenceEndDate } = input;
  if (!supportsCalendarReminderRecurrence(recurrenceRule) || !recurrenceRule)
    return { valid: false, code: "CALENDAR_RECURRENCE_UNSUPPORTED", message: "Choose a supported recurrence before reserving a series." };
  if (!recurrenceEndDate) return { valid: false, code: "CALENDAR_SERIES_END_REQUIRED", message: "Recurring meetings need an explicit final local date so every reserved occurrence can be checked." };
  let firstDay = "";
  try { firstDay = calendarCivilDay(startsAt, timezone); } catch { return { valid: false, code: "CALENDAR_TIMEZONE_INVALID", message: "Choose a valid Calendar timezone." }; }
  const span = dayOrdinal(recurrenceEndDate) - dayOrdinal(firstDay);
  if (!Number.isFinite(span) || span < 0 || span > CALENDAR_SERIES_MAX_DAYS)
    return { valid: false, code: "CALENDAR_SERIES_END_INVALID", message: `End date must be on or after the first meeting and within ${CALENDAR_SERIES_MAX_DAYS} days.` };
  if (!(startsAt < endsAt) || endsAt.getTime() - startsAt.getTime() > DAY)
    return { valid: false, code: "CALENDAR_SERIES_DURATION", message: "Recurring meeting reservations must be shorter than a day." };
  // Project in small windows: the existing recurrence projector intentionally
  // rejects scans wider than 366 days and must never silently truncate a series.
  const upper = new Date(startsAt.getTime() + (span + 2) * DAY);
  const event = { startsAt, endsAt, timezone, recurrenceRule, recurrenceEndDate };
  const occurrences: Date[] = [];
  const seen = new Set<number>();
  for (let cursor = startsAt.getTime(); cursor < upper.getTime(); cursor += 60 * DAY) {
    const until = new Date(Math.min(upper.getTime(), cursor + 60 * DAY));
    for (const instant of calendarOccurrencesInWindow(event, new Date(cursor), until, CALENDAR_SERIES_MAX_OCCURRENCES + 1)) {
      if (!seen.has(instant.getTime())) { seen.add(instant.getTime()); occurrences.push(instant); }
      if (occurrences.length > CALENDAR_SERIES_MAX_OCCURRENCES) break;
    }
    if (occurrences.length > CALENDAR_SERIES_MAX_OCCURRENCES) break;
  }
  if (!occurrences.length || occurrences.length > CALENDAR_SERIES_MAX_OCCURRENCES)
    return { valid: false, code: "CALENDAR_SERIES_TOO_LARGE", message: `Limit a recurring meeting reservation to ${CALENDAR_SERIES_MAX_OCCURRENCES} occurrences. Split longer plans into another series.` };
  return { valid: true as const, occurrences };
}

/** One transaction and lock set for all occurrences. Availability must not
 * produce a success if any checked window could not be verified. */
export async function checkCalendarSeriesConflicts(
  tx: any, input: { startsAt: Date; endsAt: Date; timezone: string; recurrenceRule: string; recurrenceEndDate?: string | null; userIds: string[]; resources: any[]; excludeBlockId?: string | null; excludeCalendarEventId?: string },
  check: (tx: any, input: any) => Promise<any[]>,
) {
  const result = validateCalendarSeriesHorizon(input as any);
  if (!result.valid) return { error: result, conflicts: [] as any[] };
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  const reported: any[] = [];
  let firstConflict: string | undefined;
  for (const occurrence of result.occurrences) {
    const conflicts = await check(tx, { startsAt: occurrence, endsAt: new Date(occurrence.getTime() + duration), userIds: input.userIds, resources: input.resources, excludeBlockId: input.excludeBlockId, excludeCalendarEventId: input.excludeCalendarEventId });
    if (conflicts.some((item: any) => item.blockId === "calendar-virtual:incomplete"))
      return { error: { code: "CALENDAR_AVAILABILITY_INCOMPLETE", message: "At least one future recurrence could not be verified. No series was saved." }, conflicts: [] };
    if (conflicts.length) {
      firstConflict ||= occurrence.toISOString();
      // Keep validating every date. Later incomplete scans must not be
      // downgraded to an overridable normal conflict.
      if (reported.length < 12) reported.push(...conflicts.slice(0, 12 - reported.length));
    }
  }
  return { conflicts: reported, occurrenceStartsAt: firstConflict, inspected: result.occurrences.length };
}

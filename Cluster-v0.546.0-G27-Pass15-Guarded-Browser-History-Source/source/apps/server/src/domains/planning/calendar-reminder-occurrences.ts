/** Bounded Calendar recurrence computation for the built-in recurrence options.
 * A recurring reminder uses the Calendar event's IANA zone for its local wall
 * clock time, so DST changes do not move a 9 AM meeting to 10 AM. Unsupported
 * RRULEs are not guessed into occurrences.
 */
const DAY = 86_400_000;
const supported = new Set([
  "FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY",
  "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
]);
export function supportsCalendarReminderRecurrence(rule: unknown) {
  return rule === null || rule === undefined || rule === "" || (typeof rule === "string" && supported.has(rule));
}
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, zone: string) {
  let formatter = zoneFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    if (zoneFormatters.size >= 64) zoneFormatters.clear();
    zoneFormatters.set(zone, formatter);
  }
  const fields: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) fields[part.type] = Number(part.value);
  }
  return { y: fields.year, m: fields.month, d: fields.day, h: fields.hour, min: fields.minute, s: fields.second, ms: (date.getTime() % 1000 + 1000) % 1000 };
}
type Civil = ReturnType<typeof parts>;
function millis(p: Civil) { return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s, p.ms); }
function dayNumber(p: Civil) { return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / DAY); }
function sameParts(a: Civil, b: Civil) {
  return a.y === b.y && a.m === b.m && a.d === b.d && a.h === b.h && a.min === b.min && a.s === b.s && a.ms === b.ms;
}
function utcForLocal(target: Civil, zone: string): Date | null {
  const targetMs = millis(target);
  let guess = targetMs;
  // Fixed-point offset resolution. Nonexistent local times at a DST jump
  // oscillate and are explicitly skipped instead of shifted unpredictably.
  const visited = new Set<number>();
  for (let i = 0; i < 8; i++) {
    if (visited.has(guess)) return null;
    visited.add(guess);
    const actual = parts(new Date(guess), zone);
    if (sameParts(actual, target)) return new Date(guess);
    guess += targetMs - millis(actual);
  }
  return null;
}
function matches(day: Civil, anchor: Civil, rule: string) {
  const anchorDay = dayNumber(anchor), dayIndex = dayNumber(day);
  if (dayIndex < anchorDay) return false;
  if (rule === "FREQ=DAILY") return true;
  if (rule === "FREQ=MONTHLY") return day.d === anchor.d;
  const weekday = new Date(dayIndex * DAY).getUTCDay();
  if (rule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return weekday >= 1 && weekday <= 5;
  return (dayIndex - anchorDay) % 7 === 0;
}

/** Return the precise start of the occurrence whose reminder is due now.
 * Only 11 local dates may be scanned (7-day max reminder + DST margin).
 */
export function dueCalendarReminderOccurrence(event: any, now: Date): Date | null {
  if (!event || event.status !== "scheduled" || !event.ownerId || event.reminderMinutes == null) return null;
  const lead = Number(event.reminderMinutes), nowMs = now.getTime();
  const anchorTime = new Date(event.startsAt).getTime();
  if (!Number.isInteger(lead) || lead < 0 || lead > 10080 || !Number.isFinite(anchorTime)) return null;
  const due = (timestamp: number) => nowMs >= timestamp - lead * 60_000 && nowMs <= timestamp + 5 * 60_000;
  if (!event.recurrenceRule) return due(anchorTime) ? new Date(anchorTime) : null;
  if (!supportsCalendarReminderRecurrence(event.recurrenceRule)) return null;
  const zone = String(event.timezone || "UTC");
  try {
    const anchor = parts(new Date(anchorTime), zone);
    const startDay = dayNumber(parts(new Date(nowMs - 5 * 60_000 - DAY), zone));
    const endDay = dayNumber(parts(new Date(nowMs + lead * 60_000 + DAY), zone));
    if (endDay - startDay > 11) return null;
    // Detached moves can land outside the original recurrence date's due
    // window. Walk bounded exception evidence first, retaining original IDs.
    const exceptions = event.occurrenceExceptions || [];
    if (exceptions.length > 256) return null;
    for (const exception of exceptions) {
      if (exception.status !== "rescheduled") continue;
      const original = new Date(exception.occurrenceStartsAt);
      const moved = movedCalendarOccurrence(event, original);
      if (moved && calendarOccurrenceIsValid(event, original) && due(moved.startsAt.getTime())) return original;
    }
    for (let day = startDay; day <= endDay; day++) {
      const value = new Date(day * DAY);
      const candidate = { ...anchor, y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
      if (!matches(candidate, anchor, event.recurrenceRule)) continue;
      if (event.recurrenceEndDate && `${candidate.y}-${String(candidate.m).padStart(2, "0")}-${String(candidate.d).padStart(2, "0")}` > event.recurrenceEndDate) continue;
      const occurrence = utcForLocal(candidate, zone);
      if (occurrence && calendarOccurrenceIsValid(event, occurrence) && occurrence.getTime() >= anchorTime && due(occurrence.getTime())
        && !isCancelledCalendarOccurrence(event, occurrence) && !movedCalendarOccurrence(event, occurrence)) return occurrence;
    }
  } catch { return null; } // Invalid/unavailable IANA timezone cannot authorize delivery.
  return null;
}

/** Recurrence window projection and exception membership share the reminder's
 * timezone/DST semantics. Missing spring-forward local times are omitted. */
export function calendarOccurrenceIsValid(event: any, candidate: Date): boolean {
  if (!event?.recurrenceRule || !supportsCalendarReminderRecurrence(event.recurrenceRule)) return false;
  const instant = candidate.getTime(), anchorTime = new Date(event.startsAt).getTime();
  if (!Number.isFinite(instant) || !Number.isFinite(anchorTime) || instant < anchorTime) return false;
  try {
    const zone = String(event.timezone || "UTC");
    const anchor = parts(new Date(anchorTime), zone), civil = parts(candidate, zone);
    if (event.recurrenceEndDate && `${civil.y}-${String(civil.m).padStart(2, "0")}-${String(civil.d).padStart(2, "0")}` > event.recurrenceEndDate) return false;
    return civil.h === anchor.h && civil.min === anchor.min && civil.s === anchor.s && civil.ms === anchor.ms && matches(civil, anchor, event.recurrenceRule)
      && utcForLocal(civil, zone)?.getTime() === instant;
  } catch { return false; }
}

export function calendarOccurrencesInWindow(event: any, from: Date, to: Date, max = 370): Date[] {
  if (!event?.recurrenceRule || !supportsCalendarReminderRecurrence(event.recurrenceRule)) return [];
  const fromMs = from.getTime(), toMs = to.getTime(), anchorMs = new Date(event.startsAt).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs || toMs - fromMs > 366 * DAY || !Number.isFinite(anchorMs)) return [];
  const results: Date[] = [];
  try {
    const zone = String(event.timezone || "UTC");
    const anchor = parts(new Date(anchorMs), zone);
    const first = dayNumber(parts(new Date(fromMs - DAY), zone));
    const last = dayNumber(parts(new Date(toMs + DAY), zone));
    for (let day = first; day <= last; day++) {
      const value = new Date(day * DAY);
      const candidate = { ...anchor, y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
      if (!matches(candidate, anchor, event.recurrenceRule)) continue;
      if (event.recurrenceEndDate && `${candidate.y}-${String(candidate.m).padStart(2, "0")}-${String(candidate.d).padStart(2, "0")}` > event.recurrenceEndDate) continue;
      const occurrence = utcForLocal(candidate, zone);
      if (occurrence && occurrence.getTime() >= anchorMs && occurrence.getTime() >= fromMs && occurrence.getTime() < toMs) {
        results.push(occurrence);
        if (results.length >= max) break;
      }
    }
  } catch { return []; }
  return results;
}

/** A moved occurrence keeps its original identity for RSVP, reminders and
 * deduplication, but appears at the new scheduled instant. */
export function movedCalendarOccurrence(event: any, original: Date): { startsAt: Date; endsAt: Date } | null {
  const exception = (event?.occurrenceExceptions || []).find((row: any) =>
    row.status === "rescheduled" && new Date(row.occurrenceStartsAt).getTime() === original.getTime());
  if (!exception?.movedStartsAt || !exception?.movedEndsAt) return null;
  const startsAt = new Date(exception.movedStartsAt), endsAt = new Date(exception.movedEndsAt);
  return startsAt.getTime() < endsAt.getTime() ? { startsAt, endsAt } : null;
}

export function isCancelledCalendarOccurrence(event: any, date: Date): boolean {
  return Array.isArray(event?.occurrenceExceptions) && event.occurrenceExceptions.some((row: any) =>
    row.status === "cancelled" && new Date(row.occurrenceStartsAt).getTime() === date.getTime());
}

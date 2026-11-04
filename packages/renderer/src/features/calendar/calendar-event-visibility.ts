import { calendarDateInputValue } from "./calendar-date-navigation";

/** Index only the already-authorized Calendar records for the visible range.
 * Mutates each bucket in place rather than repeatedly copying the entire day
 * for busy studio schedules. Recurrence instances retain their own identity. */
export function indexCalendarEventsByLocalDay<Event extends { startsAt: string }>(events: readonly Event[]) {
  const byDay = new Map<string, Event[]>();
  for (const event of events) {
    const key = calendarDateInputValue(new Date(event.startsAt));
    if (!key) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(event);
    else byDay.set(key, [event]);
  }
  return byDay;
}

/** Explicitly expanded, bounded list pages do not fetch any more data. */
export function calendarEventPage<Event>(items: readonly Event[], limit: number): Event[] {
  return items.slice(0, Number.isSafeInteger(limit) ? Math.max(0, limit) : 0);
}

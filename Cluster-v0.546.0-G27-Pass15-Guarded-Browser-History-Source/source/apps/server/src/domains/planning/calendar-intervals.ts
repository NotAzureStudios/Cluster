/** Canonical Calendar ISO instants and half-open range filtering. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
export function isCalendarInstant(value: string): boolean {
  if (!ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes impossible dates such as February 30. Reject them.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) return false;
  const [, yy, mm, dd, hh, min, sec] = match;
  const year = Number(yy), month = Number(mm), day = Number(dd);
  const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= monthEnd && Number(hh) <= 23 && Number(min) <= 59 && Number(sec || 0) <= 59;
}
export function isCalendarTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}
export function calendarRangeWhere(start?: string, end?: string) {
  const from = start ? new Date(start) : null;
  const to = end ? new Date(end) : null;
  // A multi-day event starting before the viewport is still visible if it
  // overlaps the window. An instant-only event uses its start timestamp.
  if (from && to) return { AND: [
    { startsAt: { lt: to } },
    { OR: [{ endsAt: { gt: from } }, { endsAt: null, startsAt: { gte: from } }] },
  ] };
  if (from) return { OR: [{ endsAt: { gt: from } }, { endsAt: null, startsAt: { gte: from } }] };
  if (to) return { startsAt: { lt: to } };
  return {};
}
export function isCalendarWindowValid(start?: string, end?: string, maximumDays = 366) {
  if (!start || !end) return true;
  const duration = Date.parse(end) - Date.parse(start);
  return duration > 0 && duration <= maximumDays * 86_400_000;
}

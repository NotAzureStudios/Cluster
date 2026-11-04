/** Server-side validation for administrator-managed profile fields. */
export function validPeopleTimeZone(value: string) {
  if (value.length > 100) return false;
  if (!value.trim()) return true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); return true; }
  catch { return false; }
}

/**
 * Accept calendar days and explicit ISO timestamps, but never silently
 * normalize an impossible day such as 2026-02-30 into March.
 */
export function validPeopleStartDate(value: string) {
  if (value.length > 64 || value.trim() !== value) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return false;
  if (!match[4]) return true;
  if (!/^T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(match[4])) return false;
  return Number.isFinite(new Date(value).getTime());
}

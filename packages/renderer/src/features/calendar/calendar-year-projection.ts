/** Calendar 2.0 Year is a navigation-only overview, not a year-wide event
 * query. Months/days use local civil dates and never invent event counts for
 * ranges that the server has not authorized or delivered. */
export type CalendarYearMonth = {
  month: number;
  title: string;
  days: readonly (Date | null)[];
};

export function calendarYearMonths(year: number): CalendarYearMonth[] {
  if (!Number.isSafeInteger(year) || year < 1000 || year > 9999) return [];
  return Array.from({ length: 12 }, (_, month) => {
    const first = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const length = Math.ceil((first.getDay() + lastDay) / 7) * 7;
    const days = Array.from({ length }, (_, offset) => {
      const day = offset - first.getDay() + 1;
      return day < 1 || day > lastDay ? null : new Date(year, month, day);
    });
    return {
      month,
      title: first.toLocaleDateString(undefined, { month: "long" }),
      days,
    };
  });
}

export function calendarYearNextDate(
  anchor: Date,
  yearOffset: number,
  preferredDay = anchor.getDate(),
): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isSafeInteger(yearOffset)) return new Date(NaN);
  const year = anchor.getFullYear() + yearOffset;
  if (year < 1000 || year > 9999) return new Date(NaN);
  const lastDay = new Date(year, anchor.getMonth() + 1, 0).getDate();
  return new Date(year, anchor.getMonth(), Math.min(Math.max(1, preferredDay), lastDay),
    anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
}

/** Calendar navigation uses local calendar fields, not 24h/30d millisecond
 * offsets. Date construction survives DST and month-end boundaries. */
import { calendarYearNextDate } from "./calendar-year-projection";

export type CalendarNavigationView = "year" | "month" | "week" | "day" | "agenda";

export function calendarDateInputValue(value: Date): string {
  if (!Number.isFinite(value.getTime())) return "";
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function parseCalendarLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearPart, monthPart, dayPart] = match;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date : null;
}

export function addCalendarMonths(value: Date, amount: number, preferredDay = value.getDate()): Date {
  const targetFirst = new Date(value.getFullYear(), value.getMonth() + amount, 1);
  const lastDay = new Date(targetFirst.getFullYear(), targetFirst.getMonth() + 1, 0).getDate();
  return new Date(
    targetFirst.getFullYear(), targetFirst.getMonth(), Math.min(Math.max(1, preferredDay), lastDay),
    value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds(),
  );
}

export function shiftCalendarWindow(
  anchor: Date,
  selected: Date,
  view: CalendarNavigationView,
  amount: number,
  preferredMonthDay = anchor.getDate(),
): { anchor: Date; selected: Date } {
  if (view === "year") {
    return {
      anchor: calendarYearNextDate(anchor, amount, preferredMonthDay),
      selected: calendarYearNextDate(selected, amount),
    };
  }
  if (view === "month" || view === "agenda") {
    const next = addCalendarMonths(anchor, amount, preferredMonthDay);
    return { anchor: next, selected: next };
  }
  const next = new Date(anchor);
  next.setDate(next.getDate() + amount * (view === "week" ? 7 : 1));
  if (view === "day") return { anchor: next, selected: next };
  const selectedNext = new Date(selected);
  selectedNext.setDate(selectedNext.getDate() + amount * 7);
  return { anchor: next, selected: selectedNext };
}

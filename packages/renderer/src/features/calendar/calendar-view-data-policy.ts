import type { CalendarNavigationView } from "./calendar-date-navigation";

/** Year is a civil-date navigator. It has no server-backed year occupancy
 * model, so fetching even one month of events or overlays while in Year
 * is unnecessary. Month/Week/Day/Agenda remain authoritative range views. */
export function calendarViewNeedsRangeData(view: CalendarNavigationView): boolean {
  return view !== "year";
}

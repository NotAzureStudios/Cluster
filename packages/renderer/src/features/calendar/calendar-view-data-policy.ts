import type { CalendarNavigationView } from "./calendar-date-navigation";

/** Year is a civil-date navigator. It has no server-backed year occupancy
 * model, so fetching even one month of events or overlays while in Year
 * is unnecessary. Month/Week/Day/Agenda remain authoritative range views. */
export function calendarViewNeedsRangeData(view: CalendarNavigationView): boolean {
  return view !== "year";
}

import type { CalendarLayerVisibility } from "./calendar-display-filters";

/** Calendar and Timeline have separate authoritative endpoints. Their
 * source-specific fetches can be suspended when no visible layer consumes
 * their data. Timeline is shared by Card and manual Timeline overlays. */
export function calendarViewNeedsEvents(
  view: CalendarNavigationView,
  layers: CalendarLayerVisibility,
): boolean {
  return calendarViewNeedsRangeData(view) && layers.events;
}

export function calendarViewNeedsTimeline(
  view: CalendarNavigationView,
  layers: CalendarLayerVisibility,
): boolean {
  return calendarViewNeedsRangeData(view) && (layers.timeline || layers.cards);
}

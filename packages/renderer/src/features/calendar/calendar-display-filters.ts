/**
 * Calendar 2.0 visual layer projection.
 *
 * Inputs are already permission-filtered by the Calendar and Timeline APIs.
 * This never queries, mutates, duplicates, or authorizes canonical resources.
 */
export type CalendarLayer = "events" | "timeline" | "cards";

export type CalendarLayerVisibility = Record<CalendarLayer, boolean>;

export const DEFAULT_CALENDAR_LAYER_VISIBILITY: CalendarLayerVisibility = {
  events: true,
  timeline: true,
  cards: true,
};

export type CalendarLayerItem = {
  startsAt: string;
  title: string;
  projectId?: string | null;
  project?: { id: string; name: string } | null;
  description?: string | null;
  location?: string | null;
  eventType?: string | null;
  status?: string | null;
  ownerId?: string | null;
  overlay?: { source: "timeline" | "card" } | null;
};

export type CalendarDisplayFilters = {
  project: string;
  type: string;
  owner: string;
  search: string;
  layers: CalendarLayerVisibility;
};

export function calendarItemLayer(item: CalendarLayerItem): CalendarLayer {
  return item.overlay?.source === "card" ? "cards"
    : item.overlay?.source === "timeline" ? "timeline"
      : "events";
}

export function filterCalendarDisplayItems<Item extends CalendarLayerItem>(
  events: readonly Item[],
  overlays: readonly Item[],
  filters: CalendarDisplayFilters,
): Item[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const filtered: Item[] = [];

  for (const item of [...events, ...overlays]) {
    if (!filters.layers[calendarItemLayer(item)]) continue;
    if (filters.project !== "all" && (filters.project === "studio"
      ? Boolean(item.projectId) : item.projectId !== filters.project)) continue;
    if (filters.type !== "all" && (item.eventType || "meeting") !== filters.type) continue;
    // Timeline entries expose ownerId when the API can reveal an owner.
    // An owner filter must not discard ALL overlays regardless of identity.
    if (filters.owner !== "all" && (filters.owner === "unassigned"
      ? Boolean(item.ownerId) : item.ownerId !== filters.owner)) continue;
    if (search && ![
      item.title, item.description, item.location, item.project?.name,
      item.eventType, item.status, item.overlay?.source,
    ].filter(Boolean).join(" ").toLocaleLowerCase().includes(search)) continue;
    filtered.push(item);
  }
  // A stable sort preserves canonical input order for equal timestamps.
  filtered.sort((a, b) => {
    const left = Date.parse(a.startsAt);
    const right = Date.parse(b.startsAt);
    return (Number.isFinite(left) ? left : Infinity)
      - (Number.isFinite(right) ? right : Infinity);
  });
  return filtered;
}

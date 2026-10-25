import type { TimelineEntry, TimelineItem, TimelinePayload } from "../application/application-models";

export function timelineItemToEntry(item: TimelineItem): TimelineEntry {
  return {
    id: item.id,
    source: "manual",
    type: item.type || "milestone",
    title: item.title,
    description: item.description || null,
    startsAt: item.startsAt,
    endsAt: item.endsAt || null,
    color: item.color || "#3b82f6",
    externalUrl: item.externalUrl || null,
    project: item.project ? { id: item.project.id, name: item.project.name } : null,
  };
}

function compareTimelineValues(a: { startsAt: string; id: string }, b: { startsAt: string; id: string }) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || a.id.localeCompare(b.id);
}

function insertSorted<T extends { startsAt: string; id: string }>(items: T[], item: T) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareTimelineValues(items[middle], item) <= 0) low = middle + 1;
    else high = middle;
  }
  return [...items.slice(0, low), item, ...items.slice(low)];
}

function upsertSorted<T extends { startsAt: string; id: string }>(items: T[], item: T, matches: (current: T) => boolean) {
  const index = items.findIndex(matches);
  if (index < 0) return insertSorted(items, item);
  const previous = items[index];
  if (compareTimelineValues(previous, item) === 0) {
    const next = items.slice();
    next[index] = item;
    return next;
  }
  const without = [...items.slice(0, index), ...items.slice(index + 1)];
  return insertSorted(without, item);
}

export function upsertTimelineItem(payload: TimelinePayload, item: TimelineItem): TimelinePayload {
  const manualItems = upsertSorted(payload.manualItems, item, (current) => current.id === item.id);
  const entry = timelineItemToEntry(item);
  const entries = upsertSorted(payload.entries, entry, (current) => current.source === "manual" && current.id === item.id);
  return { ...payload, manualItems, entries };
}

export function removeTimelineItem(payload: TimelinePayload, itemId: string): TimelinePayload {
  return {
    ...payload,
    manualItems: payload.manualItems.filter((item) => item.id !== itemId),
    entries: payload.entries.filter((entry) => !(entry.source === "manual" && entry.id === itemId)),
  };
}

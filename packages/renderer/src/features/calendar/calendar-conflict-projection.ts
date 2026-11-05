/**
 * This is a read-only visible-calendar warning projection. The server remains
 * authoritative for event/meeting booking, access, recurrence and conflicts.
 *
 * The previous O(n²) implementation checked every pair of events, including
 * entries in different months. A sorted two-pass interval sweep marks every
 * item with at least one compatible overlapping interval in O(n log n).
 * Forward traversal finds an earlier overlap; reverse traversal finds a
 * later one. No full active-event set or pairwise comparison is required.
 */
export type VisibleCalendarConflictEvent = {
  id: string;
  occurrenceKey?: string | null;
  startsAt: string;
  endsAt?: string | null;
  ownerId?: string | null;
  allDay?: boolean;
  overlay?: unknown;
};

type ConflictSpan = { key: string; ownerId: string | null; start: number; end: number };

export function visibleCalendarConflictIds(events: readonly VisibleCalendarConflictEvent[]): Set<string> {
  const spans: ConflictSpan[] = [];
  for (const event of events) {
    if (event.allDay || event.overlay) continue;
    const start = Date.parse(event.startsAt);
    const end = event.endsAt ? Date.parse(event.endsAt) : start + 60 * 60 * 1000;
    const key = event.occurrenceKey || event.id;
    // An invalid or zero/negative duration must not fabricate a conflict.
    if (!key || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    spans.push({ key, ownerId: event.ownerId || null, start, end });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const conflicts = new Set<string>();
  const maxEndByOwner = new Map<string, number>();
  let maxEndAny = -Infinity;
  let maxEndUnassigned = -Infinity;

  for (const item of spans) {
    // Events with explicit, different owners do not conflict with each other.
    // An unassigned event remains compatible with every owner, as before.
    const compatibleEnd = item.ownerId
      ? Math.max(maxEndUnassigned, maxEndByOwner.get(item.ownerId) ?? -Infinity)
      : maxEndAny;
    if (compatibleEnd > item.start) conflicts.add(item.key);
    maxEndAny = Math.max(maxEndAny, item.end);
    if (item.ownerId) {
      maxEndByOwner.set(item.ownerId, Math.max(maxEndByOwner.get(item.ownerId) ?? -Infinity, item.end));
    } else {
      maxEndUnassigned = Math.max(maxEndUnassigned, item.end);
    }
  }

  // Every earlier interval with an overlap is marked in this reverse pass;
  // only keeping the maximum previous end would omit other contributors.
  const minStartByOwner = new Map<string, number>();
  let minStartAny = Infinity;
  let minStartUnassigned = Infinity;

  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const item = spans[index];
    const compatibleStart = item.ownerId
      ? Math.min(minStartUnassigned, minStartByOwner.get(item.ownerId) ?? Infinity)
      : minStartAny;
    if (compatibleStart < item.end) conflicts.add(item.key);
    minStartAny = Math.min(minStartAny, item.start);
    if (item.ownerId) {
      minStartByOwner.set(item.ownerId, Math.min(minStartByOwner.get(item.ownerId) ?? Infinity, item.start));
    } else {
      minStartUnassigned = Math.min(minStartUnassigned, item.start);
    }
  }
  return conflicts;
}

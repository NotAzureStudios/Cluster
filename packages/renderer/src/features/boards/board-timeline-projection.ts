import type { BoardViewRow } from "./BoardAlternativeViews";

/** A view-only calculation; the canonical Board Card remains the source of truth. */
export function timelineWeekStart(value: Date) {
  const mondayOffset = (value.getDay() + 6) % 7;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() - mondayOffset);
}

function timelineDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Card dates are calendar dates. PostgreSQL sends UTC-midnight ISO strings;
  // interpreting them as instants can shift the day for users west of UTC.
  const civil = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (civil) {
    const year = Number(civil[1]), month = Number(civil[2]) - 1, day = Number(civil[3]);
    const result = new Date(year, month, day);
    return result.getFullYear() === year && result.getMonth() === month && result.getDate() === day ? result : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) : null;
}

export function projectBoardTimelineRows(rows: BoardViewRow[], firstWeek: Date, dayCount = 84) {
  const dayMs = 24 * 60 * 60 * 1000;
  const civilDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs;
  const projected = rows.map((row) => {
    const start = timelineDate(row.card.startDate);
    const end = timelineDate(row.card.dueDate);
    if (!start && !end) return { ...row, scheduled: false, visible: false, left: 0, width: 0, reversed: false };
    const reversed = Boolean(start && end && start.getTime() > end.getTime());
    const earlier = start && end ? (start <= end ? start : end) : (start || end)!;
    const later = start && end ? (start >= end ? start : end) : (end || start)!;
    const from = civilDay(earlier) - civilDay(firstWeek);
    const until = civilDay(later) - civilDay(firstWeek) + 1;
    const left = Math.max(0, from);
    const right = Math.min(dayCount, until);
    return { ...row, scheduled: true, visible: right > left, left: left / dayCount * 100, width: Math.max(0, right - left) / dayCount * 100, reversed };
  });
  return {
    scheduled: projected.filter((row) => row.visible),
    undated: projected.filter((row) => !row.scheduled),
    outOfRange: projected.filter((row) => row.scheduled && !row.visible).length,
  };
}

import { boardCivilDate } from "./board-civil-date";
import type { BoardViewRow } from "./BoardAlternativeViews";

/** A view-only calculation; the canonical Board Card remains the source of truth. */
export function timelineWeekStart(value: Date) {
  const mondayOffset = (value.getDay() + 6) % 7;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() - mondayOffset);
}


export function projectBoardTimelineRows(rows: BoardViewRow[], firstWeek: Date, dayCount = 84) {
  const dayMs = 24 * 60 * 60 * 1000;
  const civilDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs;
  const projected = rows.map((row) => {
    const start = boardCivilDate(row.card.startDate);
    const end = boardCivilDate(row.card.dueDate);
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

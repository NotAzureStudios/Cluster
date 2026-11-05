/**
 * Board Card planning dates are civil dates, not exact-time appointments.
 * PostgreSQL may serialize them as UTC-midnight ISO strings; parsing those
 * as local instants shifts a date backwards west of UTC. Interpret the
 * YYYY-MM-DD prefix consistently across the Kanban, list, table, Calendar
 * and Timeline lenses. Real datetime fallback remains for older inputs.
 */
export function boardCivilDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate()) : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    // A UI projection must never normalize invalid dates into a different day.
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : null;
}

export function boardCivilDateKey(value: string | Date | null | undefined): string {
  const date = boardCivilDate(value);
  if (!date) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatBoardCivilDate(value: string | Date | null | undefined): string {
  return boardCivilDate(value)?.toLocaleDateString() || "";
}

export function boardCardOverdue(value: string | null | undefined, now: Date | number = Date.now()): boolean {
  const date = boardCivilDate(value);
  if (!date) return false;
  const today = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(today.getTime())) return false;
  // Date-only deadlines expire at the end of their *local civil date*.
  return date.getFullYear() < today.getFullYear()
    || (date.getFullYear() === today.getFullYear()
      && (date.getMonth() < today.getMonth()
        || (date.getMonth() === today.getMonth() && date.getDate() < today.getDate())));
}

/** Completed-column cards retain their due date, but no longer demand
 * deadline attention. The column state comes from the canonical Board List. */
export function boardCardDeadlineNeedsAttention(
  dueDate: string | null | undefined,
  listDone: boolean,
  now: Date | number = Date.now(),
): boolean {
  return !listDone && boardCardOverdue(dueDate, now);
}

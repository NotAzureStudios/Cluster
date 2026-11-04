import { boardCivilDateKey } from "./board-civil-date";

/** Present authorized, already-loaded Board cards by civil due date.
 * Cards with missing or invalid dates stay available in the unscheduled list. */
export function projectBoardCalendarRows<Row extends { card: { dueDate?: string | null } }>(rows: readonly Row[]) {
  const dueByDay = new Map<string, Row[]>();
  const undated: Row[] = [];
  let invalidDueCount = 0;
  for (const row of rows) {
    const raw = row.card.dueDate;
    const key = boardCivilDateKey(raw);
    if (!key) {
      undated.push(row);
      if (raw) invalidDueCount += 1;
      continue;
    }
    const bucket = dueByDay.get(key);
    if (bucket) bucket.push(row);
    else dueByDay.set(key, [row]);
  }
  return { dueByDay, undated, invalidDueCount };
}

/** Avoid mounting thousands of buttons when many Cards share a due date.
 * Expansion is local and explicitly requested by the user. */
export function boardCalendarPage<Row>(rows: readonly Row[], limit: number): Row[] {
  return rows.slice(0, Number.isSafeInteger(limit) ? Math.max(0, limit) : 0);
}

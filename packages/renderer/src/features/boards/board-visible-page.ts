/** UI-only bounded mounting of already-authorized Board rows.
 * Reused by List, Table and Calendar lenses. It is not server pagination:
 * no records are dropped from selection, search or canonical mutations. */
export function boardVisiblePage<Row>(rows: readonly Row[], limit: number): Row[] {
  return rows.slice(0, Number.isSafeInteger(limit) ? Math.max(0, limit) : 0);
}

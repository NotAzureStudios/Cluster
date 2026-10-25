/** Shared progress and partial-failure semantics for existing per-card Board mutations.
 * The server continues to authorize every card separately; this is NOT a transaction.
 */
export type BoardBulkResult = { queued?: boolean };
export type BoardBulkOutcome = {
  attempted: number;
  applied: number;
  queued: number;
  skipped: number;
  cancelled: number;
  appliedIds: string[];
  queuedIds: string[];
  skippedIds: string[];
  remainingIds: string[];
  failures: Array<{ id: string; title: string; error: string }>;
};
export async function executeBoardBulk<T extends { id: string; title: string }>(
  items: readonly T[],
  apply: (item: T) => Promise<BoardBulkResult | "skip">,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BoardBulkOutcome> {
  const outcome: BoardBulkOutcome = { attempted: items.length, applied: 0, queued: 0, skipped: 0, cancelled: 0, appliedIds: [], queuedIds: [], skippedIds: [], remainingIds: [], failures: [] };
  for (const [index, item] of items.entries()) {
    // In-flight server operations cannot be rolled back by closing a dialog.
    // Cancellation deliberately stops *new* mutations only.
    if (signal?.aborted) {
      outcome.remainingIds = items.slice(index).map((row) => row.id);
      outcome.cancelled = outcome.remainingIds.length;
      break;
    }
    try {
      const result = await apply(item);
      if (result === "skip") { outcome.skipped += 1; outcome.skippedIds.push(item.id); }
      else if (result.queued) { outcome.queued += 1; outcome.queuedIds.push(item.id); }
      else { outcome.applied += 1; outcome.appliedIds.push(item.id); }
    } catch (error) {
      outcome.failures.push({ id: item.id, title: item.title, error: error instanceof Error ? error.message : "Operation failed." });
    }
    onProgress?.(index + 1, items.length);
  }
  return outcome;
}

export function describeBoardBulkOutcome(outcome: BoardBulkOutcome): string {
  const results = [`${outcome.applied} applied`];
  if (outcome.queued) results.push(`${outcome.queued} queued for reconnect`);
  if (outcome.skipped) results.push(`${outcome.skipped} skipped (already matching)`);
  if (outcome.cancelled) results.push(`${outcome.cancelled} not started (cancelled)`);
  if (outcome.failures.length) results.push(`${outcome.failures.length} failed (${outcome.failures.slice(0, 2).map((item) => `${item.title}: ${item.error}`).join("; ")}${outcome.failures.length > 2 ? "; more failures remain selected" : ""})`);
  return `Bulk change: ${results.join(" · ")}.`;
}

/**
 * Async Inbox results are session- and mutation-scoped. A delayed failed
 * request must not replace a newer success, and a pre-mutation snapshot
 * must never overwrite an acknowledged/read/dismissed item.
 * This counter is intentionally per mounted account Inbox, not global state.
 */
export function createInboxRequestOwnership() {
  let generation = 0;
  return {
    beginRead() { return ++generation; },
    isCurrent(sequence: number) { return sequence === generation; },
    invalidate() { generation += 1; },
  };
}

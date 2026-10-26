/** Identity epochs distinguish A → B → A from an uninterrupted A session.
 * A user ID alone cannot prove ownership of a delayed Search response. */
export type SearchSessionEpoch = Readonly<{ scope: string; generation: number }>;

export function advanceSearchSessionEpoch(previous: SearchSessionEpoch, currentScope: string): SearchSessionEpoch {
  if (previous.scope === currentScope) return previous;
  return { scope: currentScope, generation: previous.generation + 1 };
}

export function searchSessionFingerprint(epoch: SearchSessionEpoch): string {
  return JSON.stringify([epoch.scope, epoch.generation]);
}

export function canExposeSearchResult(requested: string, current: string, aborted = false): boolean {
  return !aborted && requested === current;
}

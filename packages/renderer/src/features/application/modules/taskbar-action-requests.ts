/**
 * The taskbar has several independent async owners (Inbox preview, presence, etc.).
 * A React `busy` render is not a concurrency fence: a second click can arrive
 * before that render commits. This small, synchronous gate also invalidates
 * out-of-order preview reads whenever a mutation begins.
 */
export function createTaskbarActionRequestGate() {
  let readSequence = 0;
  let mutationVersion = 0;
  let pending = false;
  return {
    beginRead() {
      return { sequence: ++readSequence, mutationVersion };
    },
    currentRead(token: { sequence: number; mutationVersion: number }) {
      return token.sequence === readSequence && token.mutationVersion === mutationVersion;
    },
    snapshotVersion() { return mutationVersion; },
    versionUnchanged(version: number) { return version === mutationVersion; },
    invalidateReads() { readSequence++; },
    beginMutation() {
      if (pending) return false;
      pending = true;
      mutationVersion++;
      readSequence++;
      return true;
    },
    endMutation() { pending = false; },
    isMutating() { return pending; },
  };
}

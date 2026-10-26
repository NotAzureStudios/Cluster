/**
 * A synchronous, surface-wide mutation gate. React's rendered busy state is
 * feedback, not a lock: two click handlers can run before the next render.
 * Releasing with a different operation ID must never release its owner.
 */
export function createClusterActionFlight() {
  let owner: string | null = null;
  return {
    enter(id: string): boolean {
      if (!id.trim() || owner !== null) return false;
      owner = id;
      return true;
    },
    leave(id: string): boolean {
      if (owner !== id || owner === null) return false;
      owner = null;
      return true;
    },
    current(): string | null { return owner; },
    isActive(): boolean { return owner !== null; },
  };
}

/** Discard responses from superseded requests, including after unmount. */
export function createClusterLatestResponse() {
  let version = 0;
  return {
    next(): number { return ++version; },
    isCurrent(token: number): boolean { return token === version; },
    invalidate(): void { ++version; },
  };
}

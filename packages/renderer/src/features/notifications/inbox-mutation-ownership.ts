/**
 * One in-flight Inbox mutation per mounted account. Unlike a debounce this
 * keeps ownership until the server has answered, including its failure path.
 * Concurrent read state, dismiss, restore, acknowledge and per-project settings
 * updates otherwise race to overwrite locally optimistic state. The server
 * remains authoritative; this gate does not claim server idempotency.
 */
export function createInboxMutationOwnership() {
  let active: number | null = null;
  let next = 0;
  return {
    begin(): number | null {
      if (active !== null) return null;
      active = ++next;
      return active;
    },
    isPending(): boolean { return active !== null; },
    end(ticket: number): boolean {
      if (ticket !== active) return false;
      active = null;
      return true;
    },
  };
}

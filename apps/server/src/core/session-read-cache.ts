/**
 * Single-flight coalescing for the session + user authority read that every
 * authenticated API request performs.
 *
 * That read joins the user with employment, department, job role, manager,
 * workforce status, working pattern, skills and team memberships. Home fires
 * about a dozen requests at once, so each page load ran the same join a dozen
 * times in parallel.
 *
 * Concurrent reads for the same token now share one in-flight query. Nothing is
 * kept once it settles, so no request can observe a row older than one it could
 * have read itself: sessions are written from many places (MFA step-up, policy
 * acceptance, revocation), and a TTL cache would let those writes go unseen.
 * Mutating requests never join a shared read, and every request still applies
 * all validity checks to the row it receives.
 */

export type SessionRow = { id: string; userId: string; user?: Record<string, unknown> | null } & Record<string, unknown>;

type Entry = { value: Promise<SessionRow | null> };

const inFlight = new Map<string, Entry>();

/** Callers mutate the returned row (e.g. deviceId); never hand out the shared copy. */
function copy(row: SessionRow | null): SessionRow | null {
  if (!row) return row;
  return { ...row, user: row.user ? { ...row.user } : row.user };
}

export function readSessionRow(
  tokenHash: string,
  options: { fresh: boolean },
  load: () => Promise<SessionRow | null>,
): Promise<SessionRow | null> {
  if (!options.fresh) {
    const shared = inFlight.get(tokenHash);
    if (shared) return shared.value.then(copy);
  }
  const value = load();
  const entry: Entry = { value };
  if (!options.fresh) {
    inFlight.set(tokenHash, entry);
    const settle = () => { if (inFlight.get(tokenHash) === entry) inFlight.delete(tokenHash); };
    value.then(settle, settle);
  }
  return value.then(copy);
}

export function sessionReadsInFlight() {
  return inFlight.size;
}

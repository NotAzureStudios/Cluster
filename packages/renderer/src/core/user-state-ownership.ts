/** Account switches invalidate pending client-state reads, retries and queued writes,
 * even when a user signs out and signs back into the same account (A → B → A).
 */
export type UserStateOwner = Readonly<{ scope: string; generation: number }>;

export function sameUserStateOwner(start: UserStateOwner, current: UserStateOwner): boolean {
  return start.scope !== "anonymous" && start.scope === current.scope && start.generation === current.generation;
}

export function mayApplyClientState(scope: "user" | "studio", origin: UserStateOwner, current: UserStateOwner): boolean {
  // Studio configuration is shared across people, but the permission to
  // mutate it belongs to the account which initiated the operation.
  return sameUserStateOwner(origin, current);
}

/** Generic mutations may begin on public surfaces; they still must not queue
 * their payload under a different account/session after awaiting the network. */
export function sameOfflineRequestContext(start: UserStateOwner, current: UserStateOwner): boolean {
  return start.scope === current.scope && start.generation === current.generation;
}

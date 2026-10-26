import { getOfflineScopeIdentity } from "./offline-storage";
import { sameUserStateOwner, type UserStateOwner } from "./user-state-ownership";

/** In-app transient intents may contain Project, person, or private search
 * context. Never deliver them to a different login, even A → B → A. Native
 * pre-login protocol links remain a separate, authorization-gated queue. */
export type SessionBoundHandoff<T> = Readonly<{ owner: UserStateOwner; value: T }>;

export function bindSessionHandoff<T>(value: T): SessionBoundHandoff<T> | null {
  const owner = getOfflineScopeIdentity();
  return owner.scope === "anonymous" ? null : { owner, value };
}

export function unwrapSessionHandoff<T>(handoff: SessionBoundHandoff<T> | null): T | null {
  if (!handoff || !sameUserStateOwner(handoff.owner, getOfflineScopeIdentity())) return null;
  return handoff.value;
}

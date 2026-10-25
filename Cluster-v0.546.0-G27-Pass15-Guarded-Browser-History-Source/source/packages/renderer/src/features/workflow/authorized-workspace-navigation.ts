import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/**
 * A cross-tool navigation target is only a hint. Resolve the current owning
 * workspace from a permission-checked server projection before changing the
 * selected Project/Board/Whiteboard, URL, or inspector. Unlike Recent history,
 * a move to another authorized Project follows the live record.
 */
export type AuthorizedWorkspaceKind = "project" | "board" | "whiteboard";
export type AuthorizedWorkspaceRead = { id?: string; projectId?: string | null } | null;

const usableId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id);

export function exactWorkspaceNavigationIdentity(
  target: ClusterWorkNavigationTarget,
): { kind: AuthorizedWorkspaceKind; id: string } | null {
  if (target.screen === "project" && usableId(target.projectId)) return { kind: "project", id: target.projectId };
  if (target.screen === "board" && usableId(target.boardId)) return { kind: "board", id: target.boardId };
  if (target.screen === "whiteboard" && usableId(target.whiteboardId)) return { kind: "whiteboard", id: target.whiteboardId };
  return null;
}

export async function resolveAuthorizedWorkspaceNavigation(
  target: ClusterWorkNavigationTarget,
  input: {
    read: (kind: AuthorizedWorkspaceKind, id: string) => Promise<AuthorizedWorkspaceRead>;
    isCurrent: () => boolean;
  },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent()) return null;
  const identity = exactWorkspaceNavigationIdentity(target);
  if (!identity) return null;
  try {
    const snapshot = await input.read(identity.kind, identity.id);
    if (!input.isCurrent() || !snapshot) return null;
    if (identity.kind === "project") {
      // Project snapshots use { projectId }, not { id }.
      return snapshot.projectId === identity.id ? { ...target, projectId: identity.id } : null;
    }
    if (snapshot.id !== identity.id || (snapshot.projectId !== null && !usableId(snapshot.projectId))) return null;
    // Project placement in a notification or deep link becomes stale when a
    // Board/Whiteboard is moved. Only the authorized current parent wins.
    return { ...target, projectId: snapshot.projectId || null };
  } catch {
    // Authentication, permission denial, timeout and transport failure are
    // indistinguishable to the caller. Never reuse a cached grant or location.
    return null;
  }
}

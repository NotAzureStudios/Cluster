/**
 * A Recent workspace is a navigation hint, not a cached authorization grant.
 * An online Project/Board/Whiteboard opener must recheck an exact resource and
 * its placement. Plain application screens retain their route-level gate.
 */
export type RecentWorkspaceAddress = {
  route: string;
  context: { projectId: string | null; boardId: string | null; whiteboardId: string | null };
};

export type RecentWorkspaceRead = { id?: string; projectId?: string | null } | null;

export function recentWorkspaceIdentity(target: RecentWorkspaceAddress): { kind: "project" | "board" | "whiteboard"; id: string; projectId: string | null } | null {
  if (target.route === "project" && target.context.projectId)
    return { kind: "project", id: target.context.projectId, projectId: target.context.projectId };
  if (target.route === "board" && target.context.boardId)
    return { kind: "board", id: target.context.boardId, projectId: target.context.projectId };
  if (target.route === "whiteboard" && target.context.whiteboardId)
    return { kind: "whiteboard", id: target.context.whiteboardId, projectId: target.context.projectId };
  return null;
}

export async function admitRecentWorkspace(input: {
  target: RecentWorkspaceAddress;
  isCurrent: () => boolean;
  online: boolean;
  /** Offline path is explicitly local, never represented as server-authorized. */
  hasOfflineCopy: (target: RecentWorkspaceAddress) => boolean;
  load: (kind: "project" | "board" | "whiteboard", id: string) => Promise<RecentWorkspaceRead>;
  navigate: (resolved: RecentWorkspaceAddress) => void | boolean | Promise<void | boolean>;
}): Promise<boolean> {
  if (!input.isCurrent()) return false;
  const target = input.target;
  let resolved = target;
  if (["project", "board", "whiteboard"].includes(target.route) && !recentWorkspaceIdentity(target)) return false;
  const resource = recentWorkspaceIdentity(target);
  if (resource && (!resource.id.trim() || resource.id.length > 200 ||
    (resource.projectId != null && (!resource.projectId.trim() || resource.projectId.length > 200)))) return false;
  if (resource) {
    if (!input.online) {
      if (!input.hasOfflineCopy(target)) return false;
    } else {
      try {
        const fresh = await input.load(resource.kind, resource.id);
        if (!input.isCurrent() || !fresh) return false;
        if (resource.kind === "project") {
          // Project snapshot is shaped { projectId }, unlike Board/Whiteboard.
          if (fresh.projectId !== resource.id) return false;
        } else {
          if (fresh.id !== resource.id || !Object.prototype.hasOwnProperty.call(fresh, "projectId")) return false;
          const currentProjectId = fresh.projectId;
          if (currentProjectId != null && (typeof currentProjectId !== "string" || !currentProjectId.trim() || currentProjectId.length > 200)) return false;
          if ((currentProjectId || null) !== resource.projectId) {
            // The ID is still authoritative, but a Recent route's old Project
            // is only a historical locator. Move to the fresh placement.
            resolved = { ...target, context: { ...target.context, projectId: currentProjectId || null } };
          }
        }
      } catch {
        return false;
      }
    }
  }
  if (!input.isCurrent()) return false;
  try { return await input.navigate(resolved) !== false; } catch { return false; }
}

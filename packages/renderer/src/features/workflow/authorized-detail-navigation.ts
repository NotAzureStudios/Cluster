import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/**
 * A location/inspector token is not an access grant. These resource kinds
 * expose existing per-record authenticated readers, so the renderer resolves
 * exactly one current record before writing an inspector, Project or URL.
 * Index-only navigation is deliberately not intercepted.
 */
export type DetailNavigationRead = {
  id?: unknown;
  projectId?: unknown;
  workItemKind?: unknown;
  approval?: { id?: unknown } | null;
  list?: { board?: { id?: unknown; projectId?: unknown } | null } | null;
} | null;

type DetailRoute = {
  screen: string;
  scope: string | null;
  idField: "whiteboardId" | "inspectId";
  endpoint: string;
  hasProjectPlacement: boolean;
};

const DETAIL_ROUTES: readonly DetailRoute[] = [
  { screen: "whiteboard", scope: null, idField: "whiteboardId", endpoint: "/api/whiteboards", hasProjectPlacement: true },
  { screen: "calendar", scope: "calendar-event", idField: "inspectId", endpoint: "/api/calendar/events", hasProjectPlacement: true },
  { screen: "scheduler", scope: "schedule-block", idField: "inspectId", endpoint: "/api/schedule/blocks", hasProjectPlacement: true },
  { screen: "timeline", scope: "timeline-item", idField: "inspectId", endpoint: "/api/timeline/items", hasProjectPlacement: true },
  { screen: "library", scope: "library-item", idField: "inspectId", endpoint: "/api/library", hasProjectPlacement: true },
  { screen: "people", scope: "person", idField: "inspectId", endpoint: "/api/users", hasProjectPlacement: false },
  { screen: "tickets", scope: "ticket", idField: "inspectId", endpoint: "/api/cards", hasProjectPlacement: true },
  { screen: "admin", scope: "approval", idField: "inspectId", endpoint: "/api/admin/approvals", hasProjectPlacement: false },
];

function detailRoute(target: ClusterWorkNavigationTarget): DetailRoute | null {
  return DETAIL_ROUTES.find((route) => route.screen === target.screen &&
    (route.scope === null ? Boolean(target.whiteboardId) : target.inspectScope === route.scope)) || null;
}

export function requiresAuthorizedDetailNavigation(target: ClusterWorkNavigationTarget): boolean {
  return detailRoute(target) !== null;
}

export async function resolveAuthorizedDetailNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (path: string) => Promise<DetailNavigationRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent()) return null;
  const route = detailRoute(target);
  if (!route) return null;
  const id = target[route.idField];
  if (typeof id !== "string" || !id.trim() || id.length > 200) return null;
  try {
    const suffix = route.screen === "people" ? "/profile" : "";
    const result = await input.read(`${route.endpoint}/${encodeURIComponent(id)}${suffix}`);
    if (!input.isCurrent() || !result || typeof result !== "object") return null;
    if ((route.screen === "admin" ? result.approval?.id : result.id) !== id) return null;
    if (!route.hasProjectPlacement) {
      // Global People and administrative approval records do not inherit
      // the last visited Project's workspace context.
      return { ...target, projectId: null };
    }
    // Tickets use the existing per-Card authorization endpoint. In addition
    // to the ID, require the Ticket kind and its actual containing Project.
    // A generic Card is not a Ticket just because a URL claims it is.
    if (route.screen === "tickets") {
      if (result.workItemKind !== "ticket" || typeof result.list?.board?.id !== "string" || !result.list.board.id.trim()) return null;
      if (!Object.prototype.hasOwnProperty.call(result.list.board, "projectId")) return null;
    } else if (!Object.prototype.hasOwnProperty.call(result, "projectId")) return null;
    // Missing or malformed placement is not evidence of a standalone object.
    const projectId = route.screen === "tickets" ? result.list?.board?.projectId : result.projectId;
    if (route.screen === "tickets" && projectId == null) return null;
    if (projectId != null && (typeof projectId !== "string" || !projectId.trim() || projectId.length > 200)) return null;
    return { ...target, projectId: (projectId as string | null | undefined) || null };
  } catch {
    return null;
  }
}

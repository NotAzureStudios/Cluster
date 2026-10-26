import type { ClusterWorkNavigationTarget } from "./work-navigation-types";
import { openDesktopWorkspaceWindow } from "../../core/desktop";

const SAFE_SEGMENT = /^[A-Za-z0-9._:-]{1,128}$/;
const DETACHABLE_SCREENS = new Set<ClusterWorkNavigationTarget["screen"]>([
  "project",
  "board",
  "whiteboard",
  "tickets",
  "timeline",
  "calendar",
  "scheduler",
  "library",
]);

function segment(value?: string | null) {
  const normalized = String(value || "").trim();
  return normalized && SAFE_SEGMENT.test(normalized) ? normalized : null;
}

export function desktopWorkspaceRoute(target?: ClusterWorkNavigationTarget | null) {
  if (!target || !DETACHABLE_SCREENS.has(target.screen)) return null;
  const projectId = segment(target.projectId);
  const boardId = segment(target.boardId);
  const whiteboardId = segment(target.whiteboardId);
  const inspectScope = segment(target.inspectScope);
  const inspectId = segment(target.inspectId);
  const projectTab = segment(target.projectTab);
  const parts: string[] = [];

  if (target.screen === "project") {
    if (!projectId) return null;
    parts.push("project", projectId);
  } else if (target.screen === "board") {
    if (!boardId) return null;
    parts.push("board");
    if (projectId) parts.push(projectId);
    parts.push(boardId);
  } else if (target.screen === "whiteboard") {
    if (!whiteboardId) return null;
    parts.push("whiteboard");
    if (projectId) parts.push(projectId);
    parts.push(whiteboardId);
  } else {
    parts.push(target.screen);
  }

  if (projectId) parts.push("workProject", projectId);
  if (projectTab) parts.push("projectTab", projectTab);
  if (inspectScope && inspectId) parts.push("inspect", inspectScope, inspectId);
  return parts.join("/");
}

export function desktopWorkspaceRouteFromCurrentLocation(currentRoute?: string | null) {
  if (typeof window === "undefined") return null;
  const rawRoute = String(currentRoute || window.location.hash.replace(/^#/, "")).trim().replace(/^#/, "");
  if (!rawRoute) return null;
  const screen = rawRoute.split("/")[0] as ClusterWorkNavigationTarget["screen"];
  if (!DETACHABLE_SCREENS.has(screen)) return null;
  const url = new URL(window.location.href);
  const parts = rawRoute.split("/").filter(Boolean);
  const workProject = segment(url.searchParams.get("workProject"));
  const projectTab = screen === "project" ? segment(url.searchParams.get("projectTab")) : null;
  const inspect = String(url.searchParams.get("inspect") || "");
  const separator = inspect.indexOf(":");
  const inspectScope = separator > 0 ? segment(inspect.slice(0, separator)) : null;
  const inspectId = separator > 0 ? segment(inspect.slice(separator + 1)) : null;
  const allowedInspectScopes: Partial<Record<ClusterWorkNavigationTarget["screen"], Set<string>>> = {
    project: new Set(["build-artifact", "release", "qa-plan", "qa-session", "project-control", "project-asset", "review-asset"]),
    board: new Set(["card"]),
    tickets: new Set(["ticket"]),
    timeline: new Set(["timeline-item"]),
    calendar: new Set(["calendar-event"]),
    scheduler: new Set(["schedule-block"]),
    library: new Set(["library-item"]),
  };
  const inspectAllowed = Boolean(inspectScope && inspectId && allowedInspectScopes[screen]?.has(inspectScope));
  if (workProject) parts.push("workProject", workProject);
  if (projectTab) parts.push("projectTab", projectTab);
  if (inspectAllowed) parts.push("inspect", inspectScope!, inspectId!);
  return parts.every((part) => SAFE_SEGMENT.test(part)) ? parts.join("/") : null;
}

export async function openCurrentWorkInDesktopWindow(currentRoute?: string | null, title?: string | null) {
  const route = desktopWorkspaceRouteFromCurrentLocation(currentRoute);
  if (!route) return false;
  return openDesktopWorkspaceWindow(route, String(title || "Cluster workspace").slice(0, 120));
}

export function canOpenDesktopWorkspaceTarget(target?: ClusterWorkNavigationTarget | null) {
  return typeof window !== "undefined" && Boolean(window.clusterDesktop?.openWorkspaceWindow && desktopWorkspaceRoute(target));
}

export async function openWorkInDesktopWindow(target: ClusterWorkNavigationTarget, title?: string | null) {
  const route = desktopWorkspaceRoute(target);
  if (!route) return false;
  return openDesktopWorkspaceWindow(route, String(title || "Cluster workspace").slice(0, 120));
}

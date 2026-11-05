import type { ProjectWorkspaceTabId } from "./project-workspace-registry";

/**
 * Project page request budget. Snapshot is required for the shared header,
 * readiness and tab badges. Users are shared by many collaboration panels.
 * The remaining payloads are requested only by tabs that consume them.
 *
 * This limits initial requests and project-event refreshes without adding
 * server endpoints, duplicate data models or cross-account cache state.
 */
export type ProjectWorkspaceRequestPlan = {
  media: boolean;
  dashboard: boolean;
  controlCenter: boolean;
  intelligence: boolean;
};

export function projectWorkspaceRequestPlan(tab: ProjectWorkspaceTabId): ProjectWorkspaceRequestPlan {
  return {
    media: tab === "overview" || tab === "viewer" || tab === "assets"
      || tab === "access" || tab === "closeout",
    dashboard: tab === "overview",
    controlCenter: tab === "overview" || tab === "control",
    intelligence: tab === "intelligence",
  };
}

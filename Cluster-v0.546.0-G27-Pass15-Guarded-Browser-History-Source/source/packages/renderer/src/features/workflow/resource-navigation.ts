import type { ClusterWorkNavigationTarget } from "./work-navigation-types";
import type { ClusterResourceAddress } from "@cluster/shared";

/** Renderer-owned placement policy for stable resource addresses. */
export function clusterResourceNavigation(resource?: ClusterResourceAddress | null): ClusterWorkNavigationTarget | null {
  if (!resource) return null;
  const { kind, id, projectId = null } = resource;
  if (kind === "ticket") return { screen: "tickets", projectId, inspectScope: "ticket", inspectId: id };
  if (kind === "card") return { screen: "board", projectId, inspectScope: "card", inspectId: id };
  if (kind === "board") return { screen: "board", projectId, boardId: id };
  if (kind === "whiteboard") return { screen: "whiteboard", projectId, whiteboardId: id };
  if (kind === "build") return { screen: "project", projectId, projectTab: "builds", inspectScope: "build-artifact", inspectId: id };
  if (kind === "qa_session") return { screen: "project", projectId, projectTab: "qa", inspectScope: "qa-session", inspectId: id };
  if (kind === "qa_plan") return { screen: "project", projectId, projectTab: "qa", inspectScope: "qa-plan", inspectId: id };
  if (kind === "release") return { screen: "project", projectId, projectTab: "builds", inspectScope: "release", inspectId: id };
  if (kind === "review_asset") return { screen: "project", projectId, projectTab: "viewer", inspectScope: "review-asset", inspectId: id };
  if (kind === "meeting") return { screen: "calendar", projectId, inspectScope: "meeting", inspectId: id };
  if (kind === "control") return { screen: "project", projectId, projectTab: "control", inspectScope: "project-control", inspectId: id };
  if (kind === "calendar") return { screen: "calendar", projectId, inspectScope: "calendar-event", inspectId: id };
  if (kind === "scheduler") return { screen: "scheduler", projectId, inspectScope: "schedule-block", inspectId: id };
  if (kind === "timeline") return { screen: "timeline", projectId, inspectScope: "timeline-item", inspectId: id };
  if (kind === "library") return { screen: "library", projectId, inspectScope: "library-item", inspectId: id };
  if (kind === "packet") return { screen: "packets", packetId: id };
  if (kind === "policy") return { screen: "packets", policyId: id };
  if (kind === "file") return projectId ? { screen: "project", projectId, projectTab: "assets", inspectScope: "project-asset", inspectId: id } : null;
  if (kind === "user") return { screen: "people", inspectScope: "person", inspectId: id };
  if (kind === "source_repository") return projectId ? { screen: "project", projectId, projectTab: "source", inspectScope: "source-repository", inspectId: id } : null;
  if (kind === "source_review") return projectId ? { screen: "project", projectId, projectTab: "source", inspectScope: "source-review", inspectId: id } : null;
  if (kind === "source_commit") return projectId ? { screen: "project", projectId, projectTab: "source", inspectScope: "source-commit", inspectId: id } : null;
  if (kind === "studio_form") return { screen: "studioSettings", inspectScope: "studio-form", inspectId: id };
  if (kind === "form_submission") return { screen: "studioSettings", inspectScope: "form-submission", inspectId: id };
  if (kind === "approval") return { screen: "admin", inspectScope: "approval", inspectId: id };
  if (kind === "project") return { screen: "project", projectId: id };
  return null;
}

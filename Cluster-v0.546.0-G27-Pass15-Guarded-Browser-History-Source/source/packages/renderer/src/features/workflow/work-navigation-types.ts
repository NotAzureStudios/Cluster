import type { ClusterAppRouteId } from "@cluster/shared";

/**
 * Renderer-owned navigation vocabulary for Cluster workspaces.
 *
 * Domain and server contracts must use ClusterResourceAddress instead. This
 * type describes presentation/navigation state and therefore belongs only to
 * the renderer.
 */
export const CLUSTER_WORK_NAVIGATION_SCREENS = [
  "projects",
  "project",
  "board",
  "whiteboard",
  "tickets",
  "inbox",
  "timeline",
  "calendar",
  "scheduler",
  "library",
  "packets",
  "people",
  "myRecords",
  "activity",
] as const;

/** Work deep-links can open any authorized tool route. The original list
 * remains the set of contextual Work-specific shortcuts. */
export type ClusterWorkNavigationScreen = ClusterAppRouteId;

export type ClusterWorkNavigationTarget = {
  screen: ClusterWorkNavigationScreen;
  projectId?: string | null;
  boardId?: string | null;
  whiteboardId?: string | null;
  projectTab?: string | null;
  packetId?: string | null;
  policyId?: string | null;
  inspectScope?: string | null;
  inspectId?: string | null;
};

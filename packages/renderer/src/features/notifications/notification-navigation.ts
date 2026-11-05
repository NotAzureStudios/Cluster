import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { clusterResourceAddressFromEntity, type ClusterResourceAddress, type ClusterWorkSource, type NotificationItem } from "@cluster/shared";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { incidentIdFromInspect } from "../admin/incident-link";

export type NotificationNavigationItem = Pick<NotificationItem, "category" | "projectId" | "boardId" | "cardId" | "entityType" | "entityId" | "resource" | "metadata">;

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function notificationWorkSource(item: NotificationNavigationItem): ClusterWorkSource | null {
  if (item.resource?.kind && item.resource.id) {
    return { ...item.resource, label: null };
  }
  const resource = clusterResourceAddressFromEntity({
    entityType: item.entityType,
    entityId: item.entityId || item.cardId,
    projectId: item.projectId,
  });
  return resource ? { ...resource, label: null } : null;
}

export function notificationWorkNavigation(item: NotificationNavigationItem): ClusterWorkNavigationTarget | null {
  // Published announcements are delivered as recipient-specific Inbox
  // projections. Their canonical author record is admin-only; never open an
  // administrative draft or navigate to unrelated Activity for recipients.
  if (item.entityType === "announcement" || item.resource?.kind === "announcement") return { screen: "inbox" };
  // Onboarding links must resolve to the member's own authorized projection,
  // even if a resource-address normalizer learns a more generic route later.
  if (item.entityType === "studio_onboarding_assignment" && stringValue(item.entityId))
    return { screen: "mywork", inspectScope: "onboarding", inspectId: stringValue(item.entityId) };
  // Operations creates real incident-linked Inbox alerts. Resolve their
  // administered destination before the generic resource navigator, which
  // deliberately does not have an OperationsIncident resource contract.
  if (item.entityType === "operations_incident" || String(item.resource?.kind || "") === "operations_incident") {
    const incidentId = incidentIdFromInspect("operations-incident:" + String(item.entityId || item.resource?.id || ""));
    return incidentId ? { screen: "admin", inspectScope: "operations-incident", inspectId: incidentId } : null;
  }
  const source = notificationWorkSource(item) as ClusterResourceAddress | null;
  const target = clusterResourceNavigation(source);
  if (source?.kind === "card" && target?.screen === "board") {
    // A Card ID does not identify its owning Board. Reusing the last-opened
    // Board displays the wrong workspace and can discard the intended Card.
    // Only an explicit source Board is sufficient to restore card context.
    const boardId = stringValue(item.boardId);
    if (boardId && boardId.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(boardId)) return { ...target, boardId };
    // An absent/invalid source Board no longer guesses from UI state. The
    // global Card link admission will fetch the current authorized Board;
    // the native Desktop route remains Inbox when no Board path is known.
    return { ...target, boardId: null };
  }
  if (target) return target;
  // Applications are reviewed only in authorized Studio Settings. Linking to
  // the exact submission avoids dropping an admin on the wrong list page.
  if (item.entityType === "studio_application" && stringValue(item.entityId))
    return { screen: "studioSettings", inspectScope: "studio-application", inspectId: stringValue(item.entityId) };
  // A supplied object identity must resolve to that exact destination. Do
  // not silently substitute its Project for unknown or unsupported objects.
  if (source || stringValue(item.entityId) || stringValue(item.cardId)) return null;
  const projectId = stringValue(item.projectId);
  if (projectId) return { screen: "project", projectId };
  if (item.category === "schedule") return { screen: "calendar" };
  if (item.category === "work") return { screen: "tickets" };
  return null;
}

function desktopSegment(value?: string | null) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(text) ? text : null;
}

export function notificationDesktopRoute(target: ClusterWorkNavigationTarget | null) {
  if (!target) return "inbox";
  const scope = desktopSegment(target.inspectScope?.replace(/-/g, "_"));
  const inspectId = desktopSegment(target.inspectId);
  const inspect = scope && inspectId ? `/inspect/${scope}/${inspectId}` : "";
  const projectId = desktopSegment(target.projectId);
  const projectContext = projectId ? `/workProject/${projectId}` : "";
  const boardId = desktopSegment(target.boardId);
  const whiteboardId = desktopSegment(target.whiteboardId);
  if (target.screen === "project" && projectId) return `project/${projectId}${inspect}`;
  if (target.screen === "board" && projectId && boardId) return `board/${projectId}/${boardId}${inspect}`;
  if (target.screen === "whiteboard" && projectId && whiteboardId) return `whiteboard/${projectId}/${whiteboardId}${inspect}`;
  if (target.screen === "mywork") return `mywork${inspect}`;
  if (target.screen === "inbox") return "inbox";
  // Native route dispatch understands workspaces, not renderer query state.
  // Never encode a Packet ID as a fake path segment with undefined semantics.
  if (target.screen === "packets") return "packets";
  if (target.screen === "studioSettings") return `studioSettings${inspect}`;
  if (target.screen === "admin") return `admin${inspect}`;
  if (target.screen === "tickets") return `tickets${projectContext}${inspect}`;
  if (target.screen === "timeline") return `timeline${projectContext}${inspect}`;
  if (target.screen === "calendar") return `calendar${projectContext}${inspect}`;
  if (target.screen === "scheduler") return `scheduler${projectContext}${inspect}`;
  if (target.screen === "library") return `library${projectContext}${inspect}`;
  if (target.screen === "people") return `people${inspect}`;
  if (target.screen === "activity") return `activity${projectContext}${inspect}`;
  return "inbox";
}

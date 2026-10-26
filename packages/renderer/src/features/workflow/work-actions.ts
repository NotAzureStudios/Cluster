import type { ClusterWorkNavigationTarget } from "./work-navigation-types";
import {
  serializeClusterDeepLink,
  type ClusterDeepLinkTarget,
  type ClusterResourceAddress,
  type ClusterWorkSource,
  type ClusterWorkSourceKind,
  type ClusterWorkflowRelationship,
  type ClusterWorkActionId,
} from "@cluster/shared";
import { createNavigationState, navigationHash } from "../../core/navigation";
import { copyClusterText } from "../../core/clipboard";
import type { CommandSearchResult, QuickCreateMode } from "../application/application-models";
import { openContextualCreate } from "../create/shared-create-handoff";
import { openClusterWorkNavigation } from "./work-navigation";
import { clusterResourceNavigation } from "./resource-navigation";

export const CLUSTER_MANAGE_LINKED_WORK_EVENT = "cluster:manage-linked-work";
export const CLUSTER_WORK_ACTION_ASSIGN_EVENT = "cluster:work-action-assign";
export const CLUSTER_WORK_ACTION_MENTION_EVENT = "cluster:work-action-mention";

export type ClusterWorkActionContext = {
  source: ClusterWorkSource;
  navigation?: ClusterWorkNavigationTarget | null;
  projectId?: string | null;
  boardId?: string | null;
  assigneeId?: string | null;
  attendeeIds?: string[];
  date?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueDate?: string | null;
  relationship?: ClusterWorkflowRelationship;
  targetKind?: ClusterWorkSourceKind | "all";
  mentionText?: string | null;
  relatedCreateMode?: QuickCreateMode;
};

export type ClusterWorkActionRequest = {
  action: ClusterWorkActionId;
  context: ClusterWorkActionContext;
};

export function workActionProjectId(context: ClusterWorkActionContext) {
  return context.projectId || context.source.projectId || context.navigation?.projectId || null;
}

export function workActionBoardId(context: ClusterWorkActionContext) {
  return context.boardId || context.navigation?.boardId || null;
}

function relatedMode(context: ClusterWorkActionContext): QuickCreateMode {
  if (context.relatedCreateMode) return context.relatedCreateMode;
  if (context.source.kind === "build" || context.source.kind === "qa_plan" || context.source.kind === "qa_session") return "bug";
  if (context.source.kind === "user") return "calendar";
  return "card";
}

export function createRelatedWork(context: ClusterWorkActionContext) {
  const mode = relatedMode(context);
  openContextualCreate(mode, {
    source: context.source,
    relationship: context.relationship || (mode === "calendar" || mode === "scheduler" ? "scheduled_by" : "relates_to"),
    projectId: workActionProjectId(context) || undefined,
    boardId: workActionBoardId(context) || undefined,
    assigneeId: context.assigneeId || undefined,
    attendeeIds: context.attendeeIds,
    date: context.date || undefined,
    startsAt: context.startsAt || undefined,
    endsAt: context.endsAt || undefined,
    dueDate: context.dueDate || undefined,
    title: context.source.label ? `Follow up: ${context.source.label}` : undefined,
  });
}

export function scheduleWork(context: ClusterWorkActionContext) {
  openContextualCreate("calendar", {
    source: context.source,
    relationship: "scheduled_by",
    projectId: workActionProjectId(context) || undefined,
    boardId: workActionBoardId(context) || undefined,
    assigneeId: context.assigneeId || undefined,
    attendeeIds: context.attendeeIds,
    date: context.date || undefined,
    startsAt: context.startsAt || undefined,
    endsAt: context.endsAt || undefined,
    title: context.source.label || undefined,
  });
}

export function requestLinkedWorkManager(context: ClusterWorkActionContext) {
  if (context.navigation) openClusterWorkNavigation(context.navigation);
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(CLUSTER_MANAGE_LINKED_WORK_EVENT, { detail: context })), 0);
}

export function requestWorkAssignment(context: ClusterWorkActionContext) {
  if (context.navigation) openClusterWorkNavigation(context.navigation);
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(CLUSTER_WORK_ACTION_ASSIGN_EVENT, { detail: context })), 0);
}

export async function mentionWork(context: ClusterWorkActionContext) {
  if (context.mentionText) {
    if (!await copyClusterText(context.mentionText)) throw new Error("Could not copy the mention to the clipboard.");
    return;
  }
  if (context.navigation) openClusterWorkNavigation(context.navigation);
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(CLUSTER_WORK_ACTION_MENTION_EVENT, { detail: context })), 0);
}

function navigationState(target: ClusterWorkNavigationTarget) {
  if (target.screen === "project") return createNavigationState("project", { projectId: target.projectId });
  if (target.screen === "board") return createNavigationState("board", { projectId: target.projectId, boardId: target.boardId });
  if (target.screen === "whiteboard") return createNavigationState("whiteboard", { projectId: target.projectId, whiteboardId: target.whiteboardId });
  return createNavigationState(target.screen);
}

export function clusterWorkPermalink(target: ClusterWorkNavigationTarget) {
  const url = new URL(window.location.href);
  url.searchParams.delete("inspect");
  url.searchParams.delete("workProject");
  url.searchParams.delete("workPacket");
  url.searchParams.delete("workPolicy");
  if (target.projectId) url.searchParams.set("workProject", target.projectId);
  if (target.projectTab) url.searchParams.set("projectTab", target.projectTab);
  else url.searchParams.delete("projectTab");
  if (target.packetId) url.searchParams.set("workPacket", target.packetId);
  if (target.policyId) url.searchParams.set("workPolicy", target.policyId);
  if (target.inspectScope && target.inspectId) url.searchParams.set("inspect", `${target.inspectScope}:${target.inspectId}`);
  url.hash = navigationHash(navigationState(target));
  return url.toString();
}

function clusterWorkDeepLink(context: ClusterWorkActionContext) {
  const source = context.source as ClusterResourceAddress;
  const target: ClusterDeepLinkTarget = {
    type: "resource", resource: source,
    ...(source.kind === "card" && (context.boardId || context.navigation?.boardId)
      ? { boardId: context.boardId || context.navigation?.boardId || undefined } : {}),
  };
  return serializeClusterDeepLink(target);
}

export async function copyWorkLink(context: ClusterWorkActionContext) {
  if (!context.navigation) return false;
  // Card-only desktop links resolve their current Board through the
  // authoritative Card reader. A historical Board ID is not a prerequisite.
  const desktop = typeof window !== "undefined" && new URL(window.location.href).searchParams.get("clusterDesktop") === "1";
  const deepLink = desktop ? clusterWorkDeepLink(context) : null;
  return copyClusterText(deepLink || clusterWorkPermalink(context.navigation));
}

/** Resource identities are copied verbatim; no derived/legacy address aliases. */
export async function copyWorkId(context: ClusterWorkActionContext) {
  const id = context.source.id?.trim();
  if (!id) return false;
  return copyClusterText(id);
}

export function viewWorkActivity(context: ClusterWorkActionContext) {
  const projectId = workActionProjectId(context);
  openClusterWorkNavigation({
    screen: "activity",
    projectId,
    inspectScope: "activity-source",
    inspectId: `${context.source.kind}.${context.source.id}`,
  });
}


export function searchResultWorkContext(result: CommandSearchResult): ClusterWorkActionContext | null {
  const resource = result.resource || null;
  if (!resource) return null;
  const source: ClusterWorkSource = { ...resource, label: result.title };
  const navigation = clusterResourceNavigation(resource);
  if (!navigation) return null;
  if (resource.kind === "card" && result.boardId) navigation.boardId = result.boardId;
  return {
    source,
    navigation,
    projectId: resource.projectId || result.projectId || null,
    boardId: result.boardId || null,
    assigneeId: result.assigneeId || null,
    dueDate: result.dueDate || null,
    mentionText: source.kind === "user" ? `@${result.title.replace(/^@/, "")}` : null,
  };
}

export function workSourceFromNavigation(target: ClusterWorkNavigationTarget, label?: string | null): ClusterWorkSource | null {
  const id = target.inspectId || target.packetId || target.policyId || target.boardId || target.whiteboardId || target.projectId;
  if (!id) return null;
  let kind: ClusterWorkSource["kind"] = "project";
  const scope = target.inspectScope || "";
  if (scope === "ticket") kind = "ticket";
  else if (scope === "card") kind = "card";
  else if (scope === "build-artifact") kind = "build";
  else if (scope === "qa-plan") kind = "qa_plan";
  else if (scope === "qa-session") kind = "qa_session";
  else if (scope === "release") kind = "release";
  else if (scope === "source-review") kind = "source_review";
  else if (scope === "source-repository") kind = "source_repository";
  else if (scope === "source-commit") kind = "source_commit";
  else if (scope === "studio-form") kind = "studio_form";
  else if (scope === "form-submission") kind = "form_submission";
  else if (scope === "approval") kind = "approval";
  else if (scope === "calendar-event") kind = "calendar";
  else if (scope === "schedule-block") kind = "scheduler";
  else if (scope === "timeline-item") kind = "timeline";
  else if (target.policyId) kind = "policy";
  else if (target.packetId) kind = "packet";
  else if (scope === "library-item" || target.screen === "packets") kind = "library";
  else if (scope === "project-asset" || scope === "video-asset") kind = "file";
  else if (scope === "project-control") kind = "control";
  else if (scope === "person") kind = "user";
  else if (target.screen === "board") kind = "board";
  else if (target.screen === "whiteboard") kind = "whiteboard";
  return { kind, id, projectId: target.projectId || null, label: label || null };
}

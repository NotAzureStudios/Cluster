import type { ClusterWorkActionId } from "@cluster/shared";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import type { ClusterMenuAction } from "../../components/cluster-menu-action-outcome";
import { resolveClusterResourceActions, type ClusterResourceAction } from "../../core/resource-action-registry";
import type { ClusterIconName } from "../../components/ClusterIcon";
import {
  copyWorkId,
  copyWorkLink,
  createRelatedWork,
  mentionWork,
  requestLinkedWorkManager,
  requestWorkAssignment,
  scheduleWork,
  type ClusterWorkActionContext,
  viewWorkActivity,
} from "./work-actions";
import { openClusterWorkNavigation } from "./work-navigation";
import { canOpenDesktopWorkspaceTarget, openWorkInDesktopWindow } from "./workspace-window";

const ACTION_META: Record<ClusterWorkActionId, { label: string; description: string; icon: ClusterIconName }> = {
  open: { label: "Open", description: "Open the exact work item.", icon: "chevron-right" },
  open_window: { label: "Open in window", description: "Open this exact workspace in a separate Cluster Desktop window.", icon: "project" },
  create_related: { label: "Create related", description: "Create follow-up work with this context preserved.", icon: "plus" },
  link_work: { label: "Link work", description: "Manage durable relationships for this item.", icon: "work" },
  schedule: { label: "Schedule", description: "Create a calendar commitment linked to this work.", icon: "calendar" },
  assign: { label: "Assign", description: "Open the assignment control for this work.", icon: "user" },
  mention: { label: "Mention", description: "Mention this person or work context.", icon: "comment" },
  copy_link: { label: "Copy link", description: "Copy a durable link to this exact work.", icon: "work" },
  copy_id: { label: "Copy ID", description: "Copy the canonical resource identifier.", icon: "work" },
  view_activity: { label: "View activity", description: "Open activity filtered to this work item.", icon: "activity" },
};

export function WorkActionMenu({
  context,
  label = "Work actions",
  triggerLabel = "Actions",
  iconOnly = false,
  allowAssign = false,
  allowMention = false,
  exclude = [],
  onAssign,
  onMention,
}: {
  context: ClusterWorkActionContext;
  label?: string;
  triggerLabel?: string;
  iconOnly?: boolean;
  allowAssign?: boolean;
  allowMention?: boolean;
  exclude?: ClusterWorkActionId[];
  onAssign?: () => void | Promise<void>;
  onMention?: () => void | Promise<void>;
}) {
  const hidden = new Set(exclude);
  const projectId = context.projectId || context.source.projectId || context.navigation?.projectId || null;
  const actions: ClusterResourceAction[] = [];
  const push = (id: ClusterWorkActionId, onSelect: ClusterMenuAction, disabled = false) => {
    if (hidden.has(id)) return;
    const meta = ACTION_META[id];
    actions.push({ id, label: meta.label, description: meta.description, icon: meta.icon, resourceKinds: [context.source.kind], allowed: () => true, available: () => !disabled, onSelect });
  };
  if (context.navigation) {
    push("open", () => { openClusterWorkNavigation(context.navigation); });
    if (canOpenDesktopWorkspaceTarget(context.navigation)) push("open_window", () => openWorkInDesktopWindow(context.navigation!, context.source.label));
  }
  push("create_related", () => createRelatedWork(context));
  if (projectId) push("link_work", () => requestLinkedWorkManager(context));
  if (context.source.kind !== "user") push("schedule", () => scheduleWork(context));
  if (allowAssign) push("assign", () => onAssign ? onAssign() : requestWorkAssignment(context));
  if (allowMention || context.mentionText) push("mention", () => onMention ? onMention() : mentionWork(context));
  if (context.navigation) push("copy_link", () => copyWorkLink(context));
  push("copy_id", () => copyWorkId(context));
  push("view_activity", () => viewWorkActivity(context));
  const items = resolveClusterResourceActions({ kind: context.source.kind, id: context.source.id, projectId }, actions);
  return <ClusterActionMenu label={label} triggerLabel={triggerLabel} iconOnly={iconOnly} items={items} />;
}

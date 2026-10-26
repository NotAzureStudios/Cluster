import { bindSessionHandoff, unwrapSessionHandoff, type SessionBoundHandoff } from "../../core/session-bound-handoff";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

export const CLUSTER_TICKET_WORKSPACE_EVENT = "cluster:open-ticket-workspace";

export type ClusterTicketWorkspaceContext = {
  assigneeId?: string | null;
  projectId?: string | null;
  query?: string | null;
};

let pendingTicketWorkspaceContext: SessionBoundHandoff<ClusterTicketWorkspaceContext> | null = null;

function normalizeContext(context: ClusterTicketWorkspaceContext): ClusterTicketWorkspaceContext {
  return {
    assigneeId: context.assigneeId?.trim() || null,
    projectId: context.projectId?.trim() || null,
    query: context.query?.trim().slice(0, 240) || null,
  };
}

export function openTicketWorkspace(context: ClusterTicketWorkspaceContext = {}) {
  const normalized = normalizeContext(context);
  const handoff = bindSessionHandoff(normalized);
  pendingTicketWorkspaceContext = handoff;
  openClusterWorkNavigation({ screen: "tickets", projectId: normalized.projectId || null });
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      // A delayed event must not restore another account's filters.
      if (handoff && unwrapSessionHandoff(handoff))
        window.dispatchEvent(new CustomEvent<ClusterTicketWorkspaceContext>(CLUSTER_TICKET_WORKSPACE_EVENT, { detail: normalized }));
    }, 0);
  }
}

export function readPendingTicketWorkspaceContext(): ClusterTicketWorkspaceContext | null {
  const pending = pendingTicketWorkspaceContext;
  pendingTicketWorkspaceContext = null;
  return unwrapSessionHandoff(pending);
}

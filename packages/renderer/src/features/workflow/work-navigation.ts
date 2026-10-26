import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

export const CLUSTER_OPEN_WORK_SOURCE_EVENT = "cluster:open-work-source";
export const CLUSTER_WORK_NAVIGATION_RECOVERY_EVENT = "cluster:work-navigation-recovery";
export const CLUSTER_WORK_PROJECT_QUERY_KEY = "workProject";
export const CLUSTER_WORK_PROJECT_TAB_QUERY_KEY = "projectTab";
export const CLUSTER_WORK_PACKET_QUERY_KEY = "workPacket";
export const CLUSTER_WORK_POLICY_QUERY_KEY = "workPolicy";

// A native protocol link can arrive before authentication or React mounts.
// Keep just one bounded navigation intent in memory and authorize it when the
// owning application becomes ready. No record data or credentials are cached.
let pendingDesktopWork: { target: ClusterWorkNavigationTarget; receivedAt: number } | null = null;
const DESKTOP_WORK_HANDOFF_TTL_MS = 120_000;
export const CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT = "cluster:desktop-source-commit";
export type PendingDesktopSourceCommit = { repositoryId: string; revision: string };
let pendingDesktopSourceCommit: { target: PendingDesktopSourceCommit; receivedAt: number } | null = null;

export function readPendingDesktopSourceCommit(): PendingDesktopSourceCommit | null {
  if (!pendingDesktopSourceCommit) return null;
  if (Date.now() - pendingDesktopSourceCommit.receivedAt > DESKTOP_WORK_HANDOFF_TTL_MS) {
    pendingDesktopSourceCommit = null;
    return null;
  }
  return pendingDesktopSourceCommit.target;
}

export function clearPendingDesktopSourceCommit(target: PendingDesktopSourceCommit) {
  if (pendingDesktopSourceCommit?.target === target) pendingDesktopSourceCommit = null;
}

export function queueDesktopSourceCommit(target: PendingDesktopSourceCommit) {
  // Last explicit link wins. Do not query protected API endpoints from the
  // signed-out shell or persist a cross-account source-control identifier.
  pendingDesktopWork = null;
  pendingDesktopSourceCommit = { target, receivedAt: Date.now() };
  window.dispatchEvent(new CustomEvent(CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT));
}


export function readPendingDesktopWorkNavigation(): ClusterWorkNavigationTarget | null {
  if (!pendingDesktopWork) return null;
  if (Date.now() - pendingDesktopWork.receivedAt > DESKTOP_WORK_HANDOFF_TTL_MS) {
    pendingDesktopWork = null;
    return null;
  }
  return pendingDesktopWork.target;
}

export function clearPendingDesktopWorkNavigation(target: ClusterWorkNavigationTarget) {
  if (pendingDesktopWork?.target === target) pendingDesktopWork = null;
}

export function queueDesktopWorkNavigation(target: ClusterWorkNavigationTarget) {
  pendingDesktopSourceCommit = null;
  pendingDesktopWork = { target, receivedAt: Date.now() };
  return openClusterWorkNavigation(target);
}

export type ClusterWorkNavigationRecovery = {
  title: string;
  message: string;
  tone?: "info" | "warning" | "success";
};

export function openClusterWorkNavigation(target?: ClusterWorkNavigationTarget | null) {
  if (!target) return false;
  window.dispatchEvent(new CustomEvent<ClusterWorkNavigationTarget>(CLUSTER_OPEN_WORK_SOURCE_EVENT, { detail: target }));
  return true;
}

export function readClusterWorkProjectContext() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(CLUSTER_WORK_PROJECT_QUERY_KEY) || null;
}

export function readClusterWorkProjectTab() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(CLUSTER_WORK_PROJECT_TAB_QUERY_KEY) || null;
}

export function readClusterWorkPacketContext() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(CLUSTER_WORK_PACKET_QUERY_KEY) || null;
}

export function readClusterWorkPolicyContext() {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(CLUSTER_WORK_POLICY_QUERY_KEY) || null;
}

export function reportClusterWorkNavigationRecovery(recovery: ClusterWorkNavigationRecovery) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ClusterWorkNavigationRecovery>(CLUSTER_WORK_NAVIGATION_RECOVERY_EVENT, { detail: recovery }));
}

export function recoverClusterDetailNavigation(scope: string, recovery: ClusterWorkNavigationRecovery) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const inspect = url.searchParams.get("inspect");
  if (inspect?.startsWith(`${scope}:`)) {
    url.searchParams.delete("inspect");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  window.dispatchEvent(new CustomEvent("cluster:inspector-state-changed", { detail: { scope, id: null } }));
  reportClusterWorkNavigationRecovery(recovery);
}

import type { OfflineOperationalSnapshot } from "../core/offline-runtime";
import type { ClusterInteractionState } from "./interaction-state";

export const CLUSTER_OPERATIONAL_STATES = [
  "online",
  "syncing",
  "pending",
  "offline",
  "reconnecting",
  "server_unreachable",
  "auth_expired",
  "read_only",
  "degraded",
  "maintenance",
  "recovery",
  "draining",
  "incompatible",
  "compatibility_pending",
  "conflict",
] as const;

export type ClusterOperationalState = (typeof CLUSTER_OPERATIONAL_STATES)[number];

export type ClusterOperationalStatusModel = {
  state: ClusterOperationalState;
  interactionState: ClusterInteractionState;
  label: string;
  detail: string;
  actionLabel?: string;
  pendingCount?: number;
  conflictCount?: number;
  lastCheckedAt?: number | string | Date | null;
};

export function operationalInteractionState(state: ClusterOperationalState): ClusterInteractionState {
  if (state === "online") return "success";
  if (state === "syncing" || state === "reconnecting") return "loading";
  if (state === "pending") return "stale";
  if (state === "offline") return "offline";
  if (state === "server_unreachable" || state === "auth_expired") return "error";
  if (["read_only", "degraded", "maintenance", "recovery", "draining"].includes(state)) return "warning";
  return "conflict";
}

const changes = (count: number) => `${count} change${count === 1 ? "" : "s"}`;

export function deriveSyncOperationalStatus(snapshot: OfflineOperationalSnapshot): ClusterOperationalStatusModel {
  const pendingCount = snapshot.pending + snapshot.queuedUploads;
  const serverAttentionConflicts = snapshot.serverOpenConflicts + snapshot.serverQuarantinedConflicts;
  const conflictCount = Math.max(snapshot.conflicts, serverAttentionConflicts) + snapshot.failed + snapshot.failedUploads;
  const busy = snapshot.syncing || snapshot.uploading || snapshot.pulling;
  if (!snapshot.online) {
    return { state: "offline", interactionState: "offline", label: "Offline", detail: pendingCount ? `${changes(pendingCount)} will sync when you reconnect.` : "Showing saved data.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (!snapshot.serverReachable) {
    const reconnecting = snapshot.consecutiveFailures > 0 && snapshot.nextSyncAt != null;
    const state: ClusterOperationalState = reconnecting ? "reconnecting" : "server_unreachable";
    return { state, interactionState: operationalInteractionState(state), label: reconnecting ? "Reconnecting" : "Can't reach server", detail: snapshot.lastError || "The server isn't responding.", actionLabel: "Retry", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "compatibility-check-pending") {
    return { state: "compatibility_pending", interactionState: "warning", label: "Checking server", detail: pendingCount ? `${changes(pendingCount)} held until the check finishes.` : "Editing is paused until the check finishes.", actionLabel: "Review", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "incompatible") {
    return { state: "incompatible", interactionState: "conflict", label: "Update required", detail: pendingCount ? `This version doesn't match the server. ${changes(pendingCount)} held.` : "This version doesn't match the server. Refresh to update.", actionLabel: "Review", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "recovery") {
    return { state: "recovery", interactionState: "warning", label: "Server recovering", detail: pendingCount ? `${changes(pendingCount)} held until recovery finishes.` : "Access resumes when recovery finishes.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "maintenance") {
    return { state: "maintenance", interactionState: "warning", label: "Maintenance", detail: pendingCount ? `${changes(pendingCount)} held until maintenance ends.` : "Access resumes when maintenance ends.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "draining") {
    return { state: "draining", interactionState: "warning", label: "Server restarting", detail: pendingCount ? `${changes(pendingCount)} held until it's back.` : "Syncing resumes when it's back.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "read-only" || (snapshot.readAccessAllowed && !snapshot.mutationReplayAllowed)) {
    return { state: "read_only", interactionState: "warning", label: "Read-only", detail: pendingCount ? `${changes(pendingCount)} held until editing is back.` : "You can view, but not edit.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "degraded") {
    return { state: "degraded", interactionState: "warning", label: "Server degraded", detail: snapshot.mutationReplayAllowed ? "Some services are unhealthy." : "Changes are held until the server recovers.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (conflictCount > 0) {
    return { state: "conflict", interactionState: "conflict", label: "Conflicts", detail: `${conflictCount} item${conflictCount === 1 ? " needs" : "s need"} review.`, actionLabel: "Review", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (busy) {
    const label = snapshot.uploading ? "Uploading" : snapshot.syncing ? "Syncing" : "Checking";
    return { state: "syncing", interactionState: "loading", label, detail: pendingCount ? `${pendingCount} left.` : "Catching up with the server.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (pendingCount > 0) {
    return { state: "pending", interactionState: "stale", label: `${pendingCount} pending`, detail: "Saved here, sending automatically.", actionLabel: "Sync now", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  return { state: "online", interactionState: "success", label: "Online", detail: "Up to date.", pendingCount: 0, conflictCount: 0, lastCheckedAt: snapshot.lastCheckedAt };
}

export function deriveServerOperationalStatus(input: { reachable: boolean | null; refreshing?: boolean; mismatched?: boolean; ready?: boolean; state?: "starting" | "healthy" | "degraded" | "unavailable" | "draining" | null; lastCheckedAt?: Date | null }): ClusterOperationalStatusModel {
  if (input.refreshing || input.reachable == null || input.state === "starting") return { state: "reconnecting", interactionState: "loading", label: input.refreshing ? "Checking server" : "Server starting", detail: "Checking readiness.", lastCheckedAt: input.lastCheckedAt };
  if (input.reachable === false || input.state === "unavailable") return { state: "server_unreachable", interactionState: "error", label: "Server unreachable", detail: "No response to the last check.", actionLabel: "Retry", lastCheckedAt: input.lastCheckedAt };
  if (input.mismatched) return { state: "conflict", interactionState: "conflict", label: "Version mismatch", detail: "Client and server versions differ.", lastCheckedAt: input.lastCheckedAt };
  if (input.state === "degraded") return { state: "degraded", interactionState: "warning", label: "Degraded", detail: "Some services are unhealthy.", lastCheckedAt: input.lastCheckedAt };
  if (input.state === "draining") return { state: "degraded", interactionState: "warning", label: "Server draining", detail: "Finishing current work before restarting.", lastCheckedAt: input.lastCheckedAt };
  if (input.ready === false) return { state: "degraded", interactionState: "warning", label: "Server not ready", detail: "Some features aren't available yet.", lastCheckedAt: input.lastCheckedAt };
  return { state: "online", interactionState: "success", label: "Healthy", detail: "All checks passing.", lastCheckedAt: input.lastCheckedAt };
}

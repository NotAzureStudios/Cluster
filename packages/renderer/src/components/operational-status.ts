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

export function deriveSyncOperationalStatus(snapshot: OfflineOperationalSnapshot): ClusterOperationalStatusModel {
  const pendingCount = snapshot.pending + snapshot.queuedUploads;
  const serverAttentionConflicts = snapshot.serverOpenConflicts + snapshot.serverQuarantinedConflicts;
  const conflictCount = Math.max(snapshot.conflicts, serverAttentionConflicts) + snapshot.failed + snapshot.failedUploads;
  const busy = snapshot.syncing || snapshot.uploading || snapshot.pulling;
  if (!snapshot.online) {
    return { state: "offline", interactionState: "offline", label: "Offline", detail: pendingCount ? `${pendingCount} local change${pendingCount === 1 ? "" : "s"} will sync when the network returns.` : "Workspace data remains available from this device where cached.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (!snapshot.serverReachable) {
    const reconnecting = snapshot.consecutiveFailures > 0 && snapshot.nextSyncAt != null;
    const state: ClusterOperationalState = reconnecting ? "reconnecting" : "server_unreachable";
    return { state, interactionState: operationalInteractionState(state), label: reconnecting ? "Reconnecting" : "Server unreachable", detail: snapshot.lastError || "Cluster cannot currently reach the configured server.", actionLabel: "Retry connection", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "compatibility-check-pending") {
    return { state: "compatibility_pending", interactionState: "warning", label: "Checking server compatibility", detail: pendingCount ? `${pendingCount} local item${pendingCount === 1 ? " is" : "s are"} safely held until the server confirms compatibility.` : "Cluster can reach the server, but could not verify compatibility yet. Writes and queued sync remain paused while it retries.", actionLabel: "Review sync", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "incompatible") {
    return { state: "incompatible", interactionState: "conflict", label: "Client update required", detail: pendingCount ? `This client is incompatible with the server. ${pendingCount} local item${pendingCount === 1 ? " is" : "s are"} held and will not replay until compatibility is restored.` : "This client is incompatible with the server. Refresh or update Cluster before making changes.", actionLabel: "Review sync", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "recovery") {
    return { state: "recovery", interactionState: "warning", label: "Server recovery in progress", detail: pendingCount ? `Workspace access is held while recovery runs. ${pendingCount} local item${pendingCount === 1 ? " remains" : "s remain"} safely queued.` : "Workspace access is temporarily held while the server restores or verifies authoritative data.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "maintenance") {
    return { state: "maintenance", interactionState: "warning", label: "Server maintenance", detail: pendingCount ? `Workspace access is paused for maintenance. ${pendingCount} local item${pendingCount === 1 ? " remains" : "s remain"} safely queued.` : "The server is intentionally holding workspace traffic while maintenance is in progress.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "draining") {
    return { state: "draining", interactionState: "warning", label: "Server restarting", detail: pendingCount ? `The server is draining active work before restart. ${pendingCount} local item${pendingCount === 1 ? " remains" : "s remain"} queued.` : "The server is finishing active work before shutdown or restart. New synchronization is temporarily held.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "read-only" || (snapshot.readAccessAllowed && !snapshot.mutationReplayAllowed)) {
    return { state: "read_only", interactionState: "warning", label: "Server is read only", detail: pendingCount ? `Reads remain available, but ${pendingCount} local item${pendingCount === 1 ? " is" : "s are"} held until writes are enabled.` : "Workspace data can be viewed, but server writes and queued mutation replay are temporarily disabled.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (snapshot.serverState === "degraded") {
    return { state: "degraded", interactionState: "warning", label: "Server degraded", detail: snapshot.mutationReplayAllowed ? "The server is reachable, but one or more runtime health signals need attention." : "The server is degraded and queued writes are being held until replay is safe.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (conflictCount > 0) {
    return { state: "conflict", interactionState: "conflict", label: "Conflict requires review", detail: `${conflictCount} synchronization item${conflictCount === 1 ? "" : "s"} need attention before Cluster can fully reconcile this workspace.`, actionLabel: "Review sync", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (busy) {
    const label = snapshot.uploading ? "Uploading files" : snapshot.syncing ? "Syncing changes" : "Checking for updates";
    return { state: "syncing", interactionState: "loading", label, detail: pendingCount ? `${pendingCount} queued item${pendingCount === 1 ? "" : "s"} remain.` : "Cluster is reconciling this workspace with the server.", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  if (pendingCount > 0) {
    return { state: "pending", interactionState: "stale", label: `${pendingCount} pending`, detail: "Changes are stored locally and will be sent automatically.", actionLabel: "Sync now", pendingCount, conflictCount, lastCheckedAt: snapshot.lastCheckedAt };
  }
  return { state: "online", interactionState: "success", label: "Online", detail: "Workspace data is current.", pendingCount: 0, conflictCount: 0, lastCheckedAt: snapshot.lastCheckedAt };
}

export function deriveServerOperationalStatus(input: { reachable: boolean | null; refreshing?: boolean; mismatched?: boolean; ready?: boolean; state?: "starting" | "healthy" | "degraded" | "unavailable" | "draining" | null; lastCheckedAt?: Date | null }): ClusterOperationalStatusModel {
  if (input.refreshing || input.reachable == null || input.state === "starting") return { state: "reconnecting", interactionState: "loading", label: input.refreshing ? "Checking server" : "Server starting", detail: "Cluster is checking server readiness.", lastCheckedAt: input.lastCheckedAt };
  if (input.reachable === false || input.state === "unavailable") return { state: "server_unreachable", interactionState: "error", label: "Server unreachable", detail: "The server did not answer the latest health check.", actionLabel: "Retry", lastCheckedAt: input.lastCheckedAt };
  if (input.mismatched) return { state: "conflict", interactionState: "conflict", label: "Version conflict", detail: "The client and server versions do not match.", lastCheckedAt: input.lastCheckedAt };
  if (input.state === "degraded") return { state: "degraded", interactionState: "warning", label: "Service degraded", detail: "The server is reachable, but one or more health signals need attention.", lastCheckedAt: input.lastCheckedAt };
  if (input.state === "draining") return { state: "degraded", interactionState: "warning", label: "Server draining", detail: "The server is reducing or stopping new work while it prepares to shut down or restart.", lastCheckedAt: input.lastCheckedAt };
  if (input.ready === false) return { state: "degraded", interactionState: "warning", label: "Server not ready", detail: "The server is reachable but not ready to serve all Cluster operations.", lastCheckedAt: input.lastCheckedAt };
  return { state: "online", interactionState: "success", label: "Server healthy", detail: "Server health and readiness checks are passing.", lastCheckedAt: input.lastCheckedAt };
}

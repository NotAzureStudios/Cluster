import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useVisibleTicker } from "../core/visible-ticker";
import { useVisibleRefresh } from "../core/visible-refresh";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton } from "./ClusterButton";
import { ClusterStatus } from "./ClusterStatus";
import "./sync-status-indicator.css";
import { deriveSyncOperationalStatus } from "./operational-status";
import { ClusterInput } from "./ClusterNativeControls";
import {
  discardOfflineMutation,
  discardOfflineUpload,
  getOfflineResourceSyncState,
  getOfflineSyncSnapshot,
  pauseOfflineMutation,
  pauseOfflineUpload,
  refreshOfflineSyncState,
  resolveQueuedConflict,
  resumeOfflineMutation,
  resumeOfflineUpload,
  retryAllOfflineFailures,
  retryOfflineMutation,
  mayRetryFailedMutation,
  retryOfflineUpload,
  subscribeOfflineSync,
} from "../core/offline-runtime";
import {
  buildOfflineConflictFields,
  formatOfflineConflictValue,
  offlineConflictAllowedActions,
  offlineConflictExplanation,
  offlineConflictValuesDiffer,
  type OfflineConflictFieldChoice,
} from "../core/offline-conflicts";
import {
  cancelNativeTransfer,
  getDesktopOfflineCacheStatus,
  getNativeTransfers,
  pauseNativeTransfer,
  resumeNativeTransfer,
  retryAllNativeTransfers,
  retryNativeTransfer,
  subscribeNativeTransfers,
  type ClusterNativeTransfer,
} from "../core/desktop";
import type { ClusterDesktopOfflineCacheStatus } from "../core/desktop-types";
import {
  readDetachedWorkspaceRecoverySnapshots,
  readWorkspaceRecoverySnapshot,
  restoreDetachedWorkspaceRecoverySnapshots,
  restoreWorkspaceRecoverySnapshot,
  type WorkspaceRecoverySnapshot,
} from "../core/workspace-recovery";

function nextCheckLabel(nextSyncAt: number | null) {
  if (!nextSyncAt) return null;
  const seconds = Math.max(0, Math.ceil((nextSyncAt - Date.now()) / 1_000));
  if (seconds < 2) return "Checking shortly";
  if (seconds < 60) return `Next check in ${seconds}s`;
  return `Next check in ${Math.ceil(seconds / 60)}m`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatSyncTime(value: number | string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function nativeTransferLabel(transfer: ClusterNativeTransfer) {
  const title = transfer.title || transfer.fileName || `${transfer.direction} transfer`;
  const total = Number(transfer.totalBytes || 0);
  const done = Number(transfer.transferredBytes || 0);
  if (total > 0) return `${title} · ${formatBytes(done)} / ${formatBytes(total)}`;
  return title;
}

type QueueFilter = "all" | "attention" | "pending" | "paused";

function SyncStatusWorkspace({ embedded = false }: { embedded?: boolean }) {
  const state = useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
  const [open, setOpen] = useState(embedded);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, OfflineConflictFieldChoice>>({});
  const [resolving, setResolving] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);
  const [, refreshClock] = useState(0);
  const [desktopCache, setDesktopCache] = useState<ClusterDesktopOfflineCacheStatus | null>(null);
  const [nativeTransfers, setNativeTransfers] = useState<ClusterNativeTransfer[]>([]);
  const [recoverySnapshot, setRecoverySnapshot] = useState<WorkspaceRecoverySnapshot | null>(null);
  const [detachedRecovery, setDetachedRecovery] = useState<WorkspaceRecoverySnapshot[]>([]);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  useEffect(() => {
    let active = true;
    const refreshDesktop = async () => {
      const [cache, transfers, recovery, detached] = await Promise.all([
        getDesktopOfflineCacheStatus().catch(() => null),
        getNativeTransfers().catch(() => [] as ClusterNativeTransfer[]),
        readWorkspaceRecoverySnapshot().catch(() => null),
        readDetachedWorkspaceRecoverySnapshots().catch(() => [] as WorkspaceRecoverySnapshot[]),
      ]);
      if (!active) return;
      if (cache) setDesktopCache(cache);
      setNativeTransfers(transfers || []);
      setRecoverySnapshot(recovery);
      setDetachedRecovery(detached || []);
    };
    void refreshDesktop();
    const unsubscribeCache = window.clusterDesktop?.onOfflineCacheChanged?.(() => void refreshDesktop());
    const unsubscribeTransfers = subscribeNativeTransfers((event) => {
      // Native emits the data directly; don't bridge back to Qt for every
      // incremental progress notification.
      if (active) setNativeTransfers(event.items || []);
    });
    return () => { active = false; unsubscribeCache?.(); unsubscribeTransfers(); };
  }, []);

  useVisibleRefresh(
    () => getNativeTransfers().then((items) => setNativeTransfers(items || [])).catch(() => undefined),
    { enabled: embedded || open, intervalMs: 60_000, requireOnline: false, minimumGapMs: 2_000 },
  );

  useVisibleTicker(() => refreshClock((value) => value + 1), 1_000, embedded || open);
  useEffect(() => {
    if (embedded) {
      setOpen(true);
      return;
    }
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".sync-status-v273")) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [embedded, open]);

  const reviewMutation = state.mutations.find((item) => item.id === reviewId && item.status === "conflict") || null;
  const conflictFields = useMemo(() => reviewMutation ? buildOfflineConflictFields(reviewMutation).filter(offlineConflictValuesDiffer) : [], [reviewMutation]);
  const allowedActions = reviewMutation ? offlineConflictAllowedActions(reviewMutation) : [];
  const operational = deriveSyncOperationalStatus(state);
  const nativeFailed = nativeTransfers.filter((item) => item.state === "failed").length;
  const retryableFailures = state.failed + state.failedUploads + nativeFailed;
  const serverAttentionConflicts = state.serverOpenConflicts + state.serverQuarantinedConflicts;
  const attention = Math.max(state.conflicts, serverAttentionConflicts) + retryableFailures + state.authPaused + state.authPausedUploads;
  const queued = state.pending + state.paused + state.queuedUploads + state.pausedUploads + nativeTransfers.filter((item) => ["queued", "running", "paused", "verifying"].includes(item.state)).length;
  const label = operational.label;
  const nextCheck = nextCheckLabel(state.nextSyncAt);
  const syncBusy = state.syncing || state.pulling || state.uploading;
  const interactionState = operational.interactionState;
  const detail = state.lastPullChanges && operational.state === "online"
    ? `${state.lastPullChanges} remote change${state.lastPullChanges === 1 ? "" : "s"} applied.`
    : state.mode === "background" && operational.state === "online"
      ? "Background synchronization is using a reduced cadence."
      : state.mode === "data-saver" && operational.state === "online"
        ? "Synchronization is reducing network use for this connection."
        : operational.detail;

  const filteredMutations = useMemo(() => state.mutations.filter((mutation) => {
    if (queueFilter === "attention") return mutation.status === "conflict" || mutation.status === "failed" || (mutation.status === "paused" && mutation.pauseReason !== "manual");
    if (queueFilter === "pending") return mutation.status === "pending" || mutation.status === "replaying";
    if (queueFilter === "paused") return mutation.status === "paused";
    return true;
  }), [state.mutations, queueFilter]);
  const filteredUploads = useMemo(() => state.uploads.filter((upload) => {
    if (queueFilter === "attention") return upload.status === "failed" || (upload.status === "paused" && upload.pauseReason !== "manual");
    if (queueFilter === "pending") return upload.status === "pending" || upload.status === "uploading";
    if (queueFilter === "paused") return upload.status === "paused";
    return true;
  }), [state.uploads, queueFilter]);
  const filteredNativeTransfers = useMemo(() => nativeTransfers.filter((transfer) => {
    if (queueFilter === "attention") return transfer.state === "failed";
    if (queueFilter === "pending") return ["queued", "running", "verifying"].includes(transfer.state);
    if (queueFilter === "paused") return transfer.state === "paused";
    return true;
  }), [nativeTransfers, queueFilter]);

  async function resolve(action: "keep_mine" | "keep_server" | "merge" | "discard") {
    if (!reviewMutation || resolving) return;
    setResolving(true);
    setReviewFeedback(null);
    try {
      await resolveQueuedConflict(reviewMutation.id, action, choices);
      setReviewId(null);
      setChoices({});
    } catch (error) {
      setReviewFeedback(error instanceof Error ? error.message : "Could not resolve this queued edit; your local copy is retained.");
    } finally {
      setResolving(false);
    }
  }

  async function copyQueuedMutation(mutation: { method: string; path: string; body?: unknown } | null = reviewMutation) {
    if (!mutation) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ method: mutation.method, path: mutation.path, body: mutation.body }, null, 2));
      const feedback = "Queued change copied. It has not been saved on the server.";
      if (reviewMutation) setReviewFeedback(feedback); else setQueueFeedback(feedback);
    } catch {
      const feedback = "Clipboard access is unavailable. Your queued change is still retained on this device.";
      if (reviewMutation) setReviewFeedback(feedback); else setQueueFeedback(feedback);
    }
  }

  async function discardQueuedMutation(mutation: { id: string; label: string }) {
    if (!window.confirm(`Discard the queued local change “${mutation.label}”? This cannot be undone. Copy the pending change first if you need to preserve it.`)) return;
    setQueueFeedback(null);
    try {
      await discardOfflineMutation(mutation.id);
      setQueueFeedback("Queued change discarded after server confirmation, when required.");
    } catch (error) {
      setQueueFeedback(error instanceof Error ? error.message : "Could not discard the queued change. It remains on this device.");
    }
  }

  async function retryFailures() {
    await Promise.allSettled([retryAllOfflineFailures(), retryAllNativeTransfers()]);
    setNativeTransfers(await getNativeTransfers().catch(() => nativeTransfers));
  }

  return (
    <div data-cluster-state={interactionState} className={`sync-status-v273 ${embedded ? "embedded" : ""}`}>
      {!embedded && <ClusterButton unstyled
        type="button"
        className={`taskbar-action-v073 taskbar-icon-button-v081 sync-status-trigger-v273 ${!state.online || !state.serverReachable ? "offline" : ""} ${attention ? "attention" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={`Synchronization status: ${label}`}
        aria-expanded={open}
        aria-pressed={open}
        data-cluster-state={interactionState}
      >
        <ClusterIcon name={state.syncing || state.pulling || state.uploading ? "sync" : state.online && state.serverReachable ? "cloud" : "cloud-off"} className={state.syncing || state.pulling || state.uploading ? "sync-spin-v273" : ""} />
        {(queued || attention) > 0 && <span className="sync-status-count-v273">{attention || queued}</span>}
      </ClusterButton>}

      {(embedded || open) && (
        <section data-cluster-state={interactionState} className={`sync-status-popover-v273 ${embedded ? "embedded" : ""}`} role="dialog" aria-label="Offline synchronization" aria-live="polite">
          <header>
            <div>
              <strong>{label}</strong>
              <span>{detail}{nextCheck ? ` ${nextCheck}.` : ""}</span>
              {desktopCache && <small>Desktop native cache · {formatBytes(desktopCache.sizeBytes)}</small>}
            </div>
            <div className="sync-status-header-actions-v426">
              <ClusterStatus state={interactionState} compact dot>{label}</ClusterStatus>
              {(state.mutations.some(mayRetryFailedMutation) || state.failedUploads + nativeFailed > 0) && <ClusterButton variant="secondary" size="compact" onClick={() => void retryFailures()}>Retry eligible failures</ClusterButton>}
              <ClusterButton size="compact" busy={syncBusy} busyLabel="Syncing…" onClick={() => void refreshOfflineSyncState({ flush: true, pull: true })}>Sync now</ClusterButton>
            </div>
          </header>

          {queueFeedback && <p className="status-box" role="status">{queueFeedback}</p>}
          {embedded && (
            <>
              <div className="sync-center-metrics-v385" aria-label="Offline synchronization device status">
                <div><span>Connection</span><strong>{state.online && state.serverReachable ? "Connected" : state.online ? "Server unavailable" : "Offline"}</strong></div>
                <div><span>Device</span><strong title={state.deviceId || ""}>{state.deviceId ? `${state.deviceId.slice(0, 8)}…` : "Registering"}</strong></div>
                <div><span>Pending</span><strong>{state.pending + state.queuedUploads}</strong></div>
                <div><span>Paused</span><strong>{state.paused + state.pausedUploads + nativeTransfers.filter((item) => item.state === "paused").length}</strong></div>
                <div><span>Waiting for sign-in</span><strong>{state.authPaused + state.authPausedUploads}</strong></div>
                <div><span>Dependency blocked</span><strong>{state.blockedDependencies}</strong></div>
                <div><span>Queue pressure</span><strong>{state.queuePressure === "normal" ? "Normal" : state.queuePressure === "busy" ? "Busy" : "Saturated"}</strong></div>
                <div><span>Queued uploads</span><strong>{formatBytes(state.queuedUploadBytes)}{state.queuedUploadByteLimit ? ` / ${formatBytes(state.queuedUploadByteLimit)}` : ""}</strong></div>
                <div><span>Sync leader</span><strong>{state.leadership === "leader" ? "This window" : state.leadership === "follower" ? "Another window" : "Idle"}</strong></div>
                <div><span>Coalesced checks</span><strong>{state.coalescedRefreshes}</strong></div>
                <div><span>Idle catch-up</span><strong>{state.catchUpCyclesRemaining ? `${state.catchUpCyclesRemaining} paced drain${state.catchUpCyclesRemaining === 1 ? "" : "s"}` : "Idle"}</strong></div>
                <div><span>Last hidden</span><strong>{state.lastHiddenDurationMs ? `${Math.round(state.lastHiddenDurationMs / 60_000)} min` : "—"}</strong></div>
                <div><span>Last mutation drain</span><strong>{state.lastMutationDrainAt ? `${state.lastMutationDrainCount}${state.lastMutationDrainLimit ? ` / ${state.lastMutationDrainLimit}` : ""} · ${Math.round(state.lastMutationDrainDurationMs || 0)} ms` : "—"}</strong></div>
                <div><span>Conflicts</span><strong>{Math.max(state.conflicts, serverAttentionConflicts)}</strong></div>
                <div><span>Last sync</span><strong>{formatSyncTime(state.lastSyncedAt || state.lastPulledAt)}</strong></div>
                <div><span>Server seen</span><strong>{formatSyncTime(state.registeredDevice?.lastSeenAt)}</strong></div>
                <div><span>Native cache</span><strong>{desktopCache ? formatBytes(desktopCache.sizeBytes) : "Browser cache"}</strong></div>
                <div><span>Retry posture</span><strong>{state.consecutiveFailures ? `${state.consecutiveFailures} failed check${state.consecutiveFailures === 1 ? "" : "s"}` : "Healthy"}</strong></div>
                <div><span>24h replays</span><strong>{state.serverReplay24h}{state.serverReplayFailures24h ? ` · ${state.serverReplayFailures24h} failed` : ""}</strong></div>
                <div><span>Oldest conflict</span><strong>{state.serverOldestOpenConflictAt ? formatSyncTime(state.serverOldestOpenConflictAt) : "None"}</strong></div>
              </div>
              <div className="sync-center-toolbar-v495" aria-label="Sync queue filters">
                <div className="sync-center-filter-v495">
                  {(["all", "attention", "pending", "paused"] as QueueFilter[]).map((filter) => <ClusterButton unstyled key={filter} type="button" className={queueFilter === filter ? "active" : ""} aria-pressed={queueFilter === filter} onClick={() => setQueueFilter(filter)}>{filter === "all" ? "All work" : filter === "attention" ? "Needs attention" : filter[0].toUpperCase() + filter.slice(1)}</ClusterButton>)}
                </div>
                {(recoverySnapshot || detachedRecovery.length > 0) && <div className="sync-recovery-v495">
                  <span>Recovery · {recoverySnapshot ? `main workspace ${formatSyncTime(recoverySnapshot.capturedAt)}` : "no main snapshot"}{detachedRecovery.length ? ` · ${detachedRecovery.length} detached window${detachedRecovery.length === 1 ? "" : "s"}` : ""}</span>
                  <div className="sync-recovery-actions-v495">
                    {recoverySnapshot && <ClusterButton variant="secondary" size="compact" onClick={() => void restoreWorkspaceRecoverySnapshot(recoverySnapshot)}>Restore workspace</ClusterButton>}
                    {detachedRecovery.length > 0 && window.clusterDesktop?.openWorkspaceWindow && <ClusterButton variant="secondary" size="compact" onClick={() => void restoreDetachedWorkspaceRecoverySnapshots(detachedRecovery)}>Restore windows</ClusterButton>}
                  </div>
                </div>}
              </div>
            </>
          )}

          {reviewMutation ? (
            <div data-cluster-state="conflict" className="sync-conflict-review-v304">
              <div className="sync-conflict-review-heading-v304">
                <ClusterButton variant="quiet" size="compact" onClick={() => setReviewId(null)}>Back</ClusterButton>
                <div>
                  <strong>{reviewMutation.label}</strong>
                  <span>{offlineConflictExplanation(reviewMutation)}</span>
                  {reviewMutation.lastError && <small>{reviewMutation.lastError}</small>}
                </div>
              </div>
              {conflictFields.length ? (
                <div className="sync-conflict-fields-v304">
                  {conflictFields.map((field) => {
                    const choice = choices[field.key] || field.choice;
                    return (
                      <fieldset key={field.key}>
                        <legend>{field.key}</legend>
                        <label data-cluster-state={choice === "local" ? "selected" : "default"} className={choice === "local" ? "selected" : ""}>
                          <ClusterInput type="radio" name={`${reviewMutation.id}-${field.key}`} checked={choice === "local"} onChange={() => setChoices((current) => ({ ...current, [field.key]: "local" }))} />
                          <span><strong>This device</strong><code>{formatOfflineConflictValue(field.localValue)}</code></span>
                        </label>
                        <label data-cluster-state={choice === "server" ? "selected" : "default"} className={choice === "server" ? "selected" : ""}>
                          <ClusterInput type="radio" name={`${reviewMutation.id}-${field.key}`} checked={choice === "server"} onChange={() => setChoices((current) => ({ ...current, [field.key]: "server" }))} />
                          <span><strong>Server</strong><code>{formatOfflineConflictValue(field.serverValue)}</code></span>
                        </label>
                      </fieldset>
                    );
                  })}
                </div>
              ) : <p className="muted tight">No safe field-level merge is available. Your queued change remains on this device until you explicitly discard it.</p>}
              {reviewFeedback && <p className="status-box" role="status">{reviewFeedback}</p>}
              <div className="sync-conflict-actions-v304">
                <ClusterButton variant="secondary" size="compact" onClick={() => void copyQueuedMutation()} title="Copy the queued request before discarding or resolving it">Copy local change</ClusterButton>
                {allowedActions.includes("merge") && conflictFields.length > 0 && <ClusterButton variant="primary" busy={resolving} busyLabel="Resolving…" onClick={() => void resolve("merge")}>Merge selected fields</ClusterButton>}
                {allowedActions.includes("keep_mine") && <ClusterButton disabled={resolving} onClick={() => void resolve("keep_mine")}>Keep this device</ClusterButton>}
                {allowedActions.includes("keep_server") && <ClusterButton disabled={resolving} onClick={() => void resolve("keep_server")}>Keep server</ClusterButton>}
                {allowedActions.includes("discard") && <ClusterButton variant="danger" disabled={resolving} onClick={() => void resolve("discard")}>Discard</ClusterButton>}
              </div>
            </div>
          ) : (
            <>
              {embedded && filteredNativeTransfers.length > 0 && (
                <div className="sync-status-list-v273 sync-native-transfer-list-v495">
                  {filteredNativeTransfers.slice(0, 12).map((transfer) => (
                    <article key={transfer.id} data-status={transfer.state} data-cluster-state={transfer.state === "failed" ? "error" : transfer.state === "running" || transfer.state === "verifying" ? "loading" : "stale"}>
                      <div>
                        <strong>{nativeTransferLabel(transfer)}</strong>
                        <span>Desktop {transfer.direction} · {transfer.stage === "linking-evidence" ? "file saved, linking evidence" : transfer.stage === "evidence-link-failed" ? "file saved, evidence link failed" : transfer.stage === "evidence-link-paused" ? "file saved, evidence link paused" : transfer.stage === "evidence-link-queued" ? "file saved, evidence link queued" : transfer.stage === "evidence-link-cancelled" ? "file saved, evidence linking stopped" : transfer.stage === "finalizing-file" ? "finalizing Project file" : transfer.state}{transfer.resumable ? " · resumable" : ""}</span>
                        {transfer.fileSaved && transfer.evidenceStatus && transfer.evidenceStatus !== "linked" ? <small>{transfer.evidenceStatus === "cancelled" ? "The Project file was saved; linking was stopped." : "The Project file is retained. Only relationship linking remains."}</small> : null}
                        {transfer.error && <small>{typeof transfer.error === "string" ? transfer.error : transfer.error.message}</small>}
                        {transfer.recoveryNote && <small>{transfer.recoveryNote}</small>}
                      </div>
                      <div className="sync-status-row-actions-v273">
                        {transfer.canPause && <ClusterButton variant="quiet" size="compact" onClick={() => void pauseNativeTransfer(transfer.id)}>Pause</ClusterButton>}
                        {transfer.canResume && transfer.state === "paused" && <ClusterButton size="compact" onClick={() => void resumeNativeTransfer(transfer.id)}>Resume</ClusterButton>}
                        {transfer.canRetry && transfer.state === "failed" && <ClusterButton size="compact" onClick={() => void retryNativeTransfer(transfer.id)}>{transfer.fileSaved && transfer.evidenceStatus === "failed" ? "Retry link" : "Retry"}</ClusterButton>}
                        {!(["complete", "cancelled"].includes(transfer.state)) && <ClusterButton variant="quiet" size="compact" onClick={() => void cancelNativeTransfer(transfer.id)}>Cancel</ClusterButton>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {filteredUploads.length > 0 && (
                <div className="sync-status-list-v273 sync-upload-list-v304">
                  {filteredUploads.slice(0, embedded ? 20 : 8).map((upload) => (
                    <article key={upload.id} data-status={upload.status} data-cluster-state={upload.status === "uploading" ? "loading" : upload.status === "failed" ? "error" : "stale"}>
                      <div>
                        <strong>{upload.fileName}</strong>
                        <span>{upload.status === "uploading" ? "Uploading" : upload.status === "paused" ? upload.pauseReason === "auth" ? "Waiting for sign-in" : upload.pauseReason === "compatibility" || upload.pauseReason === "server" ? "Held for server safety" : "Paused" : upload.status === "failed" ? "Upload failed" : `Queued · ${formatBytes(upload.sizeBytes)}`}{upload.attempts ? ` · ${upload.attempts} attempt${upload.attempts === 1 ? "" : "s"}` : ""}</span>
                        {upload.lastError && <small>{upload.lastError}</small>}
                      </div>
                      <div className="sync-status-row-actions-v273">
                        {upload.status === "pending" && <ClusterButton variant="quiet" size="compact" onClick={() => void pauseOfflineUpload(upload.id)}>Pause</ClusterButton>}
                        {upload.status === "paused" && upload.pauseReason === "manual" && <ClusterButton size="compact" onClick={() => void resumeOfflineUpload(upload.id)}>Resume</ClusterButton>}
                        {upload.status === "failed" && <ClusterButton size="compact" onClick={() => void retryOfflineUpload(upload.id)}>Retry</ClusterButton>}
                        {upload.status !== "uploading" && <ClusterButton variant="quiet" size="compact" onClick={() => void discardOfflineUpload(upload.id)}>Discard</ClusterButton>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {filteredMutations.length > 0 && (
                <div className="sync-status-list-v273">
                  {filteredMutations.slice(0, embedded ? 40 : 12).map((mutation) => (
                    <article key={mutation.id} data-status={mutation.status} data-cluster-state={mutation.status === "replaying" ? "loading" : mutation.status === "conflict" ? "conflict" : mutation.status === "failed" ? "error" : "stale"}>
                      <div>
                        <strong>{mutation.label}</strong>
                        <span>{mutation.status === "pending" ? (mutation.dependsOn || []).some((dependency) => state.mutations.some((candidate) => candidate.id === dependency)) ? "Waiting for dependency" : "Pending" : mutation.status === "paused" ? mutation.pauseReason === "auth" ? "Waiting for sign-in" : mutation.pauseReason === "compatibility" || mutation.pauseReason === "server" ? "Held for server safety" : "Paused" : mutation.status === "replaying" ? "Syncing" : mutation.status === "conflict" ? "Needs review" : "Failed"}{mutation.resourceKind && mutation.resourceId ? ` · ${mutation.resourceKind} ${mutation.resourceId.slice(0, 8)}` : ""}{mutation.attempts ? ` · ${mutation.attempts} attempt${mutation.attempts === 1 ? "" : "s"}` : ""}</span>
                        {mutation.lastError && <small>{mutation.lastError}</small>}
                      </div>
                      <div className="sync-status-row-actions-v273">
                        {mutation.status === "pending" && <ClusterButton variant="quiet" size="compact" onClick={() => void pauseOfflineMutation(mutation.id)}>Pause</ClusterButton>}
                        {mutation.status === "paused" && mutation.pauseReason === "manual" && <ClusterButton size="compact" onClick={() => void resumeOfflineMutation(mutation.id)}>Resume</ClusterButton>}
                        {mutation.status === "conflict" && <ClusterButton state="conflict" size="compact" onClick={() => { setReviewId(mutation.id); setChoices({}); setReviewFeedback(null); }}>Review</ClusterButton>}
                        {mayRetryFailedMutation(mutation) && <ClusterButton size="compact" onClick={() => void retryOfflineMutation(mutation.id)}>Retry</ClusterButton>}
                        <ClusterButton variant="quiet" size="compact" onClick={() => void copyQueuedMutation(mutation)}>Copy</ClusterButton>
                        {mutation.status !== "replaying" && <ClusterButton variant="quiet" size="compact" onClick={() => void discardQueuedMutation(mutation)}>Discard</ClusterButton>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {embedded && !filteredMutations.length && !filteredUploads.length && !filteredNativeTransfers.length && <div className="sync-queue-empty-v495"><ClusterIcon name="check" /><strong>No queued sync work</strong><span>Changes are synchronized and there is nothing waiting for this device.</span></div>}
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function SyncStatusIndicator() {
  return <SyncStatusWorkspace />;
}

export function SyncSettingsPanel() {
  return <SyncStatusWorkspace embedded />;
}

export function ResourceSyncBadge({ resourceKind, resourceId }: { resourceKind: string | null | undefined; resourceId: string | null | undefined }) {
  useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
  const resource = getOfflineResourceSyncState(resourceKind, resourceId);
  if (!resourceKind || !resourceId || resource.state === "synced") return null;
  const label = resource.state === "pending" ? "Pending sync" : resource.state === "paused" ? "Sync paused" : resource.state === "syncing" ? "Syncing" : resource.state === "conflict" ? "Sync conflict" : "Sync failed";
  const state = resource.state === "syncing" ? "loading" : resource.state === "conflict" ? "conflict" : resource.state === "failed" ? "error" : resource.state === "paused" ? "stale" : "warning";
  return <ClusterStatus compact dot state={state} title={resource.lastError || label}>{label}</ClusterStatus>;
}

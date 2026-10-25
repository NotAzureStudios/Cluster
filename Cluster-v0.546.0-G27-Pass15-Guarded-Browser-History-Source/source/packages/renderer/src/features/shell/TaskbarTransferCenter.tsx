import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { transferProgressSummary } from "./transfer-progress-summary";
import { ClusterFloatingSurface } from "../../components/ClusterFloatingSurface";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useClusterActionFlight } from "../../components/useClusterActionFlight";
import { createClusterLatestResponse } from "../../components/cluster-action-flight";
import {
  discardOfflineUpload,
  getOfflineSyncSnapshot,
  pauseOfflineUpload,
  resumeOfflineUpload,
  retryAllOfflineFailures,
  retryOfflineUpload,
  subscribeOfflineSync,
} from "../../core/offline-runtime";
import { getBrowserDownloadSnapshot, removeBrowserDownloadHandoff, subscribeBrowserDownloads } from "../../core/browser-download-transfers";
import {
  cancelNativeTransfer,
  getNativeTransfers,
  getNativeTransferQueueStatus,
  claimNativeTransferQueue,
  openNativeTransferResult,
  pauseNativeTransfer,
  resumeNativeTransfer,
  retryAllNativeTransfers,
  retryNativeTransfer,
  removeNativeTransfer,
  subscribeNativeTransfers,
  type ClusterNativeTransfer,
  type ClusterNativeTransferQueueStatus,
} from "../../core/desktop";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function nativeLabel(transfer: ClusterNativeTransfer) {
  return transfer.title || transfer.fileName || `${transfer.direction === "upload" ? "Upload" : "Download"} transfer`;
}

function nativeStageLabel(transfer: ClusterNativeTransfer) {
  const stage = transfer.stage || transfer.state;
  switch (stage) {
    case "finalizing-file": return "Finalizing Project file";
    case "linking-evidence": return "File saved · linking evidence";
    case "evidence-link-queued": return "File saved · evidence link queued";
    case "evidence-link-paused": return "File saved · evidence link paused";
    case "evidence-link-failed": return "File saved · evidence link needs attention";
    case "evidence-link-cancelled": return "File saved · evidence linking stopped";
    case "verifying": return "Verifying file integrity";
    case "committing": return "Committing transfer";
    case "complete": return transfer.evidenceStatus === "linked" ? "File saved · evidence linked" : "Complete";
    default: return stage;
  }
}

export function TaskbarTransferCenter() {
  const offline = useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
  const browserDownloads = useSyncExternalStore(subscribeBrowserDownloads, getBrowserDownloadSnapshot, getBrowserDownloadSnapshot);
  const [nativeTransfers, setNativeTransfers] = useState<ClusterNativeTransfer[]>([]);
  const [nativeQueueStatus, setNativeQueueStatus] = useState<ClusterNativeTransferQueueStatus | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nativeRefreshGeneration = useRef(createClusterLatestResponse());
  const { pending: actionPending, begin: beginAction, finish: finishAction, isExecuting } = useClusterActionFlight();
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const request = nativeRefreshGeneration.current.next();
      void getNativeTransfers().then((items) => {
        if (active && nativeRefreshGeneration.current.isCurrent(request)) setNativeTransfers(items || []);
      }).catch(() => {
        // An unavailable native bridge should not affect browser-only transfers.
      });
      void getNativeTransferQueueStatus().then((status) => {
        if (active && nativeRefreshGeneration.current.isCurrent(request)) setNativeQueueStatus(status || null);
      }).catch(() => {
        if (active && nativeRefreshGeneration.current.isCurrent(request)) setNativeQueueStatus(null);
      });
    };
    refresh();
    const unsubscribe = subscribeNativeTransfers((event) => {
      // The native broker pushes the authoritative snapshot with each change.
      // A fresh list+status request per progress event caused avoidable native
      // bridge churn, and its late reply could overwrite a newer push.
      nativeRefreshGeneration.current.invalidate();
      if (!active) return;
      setNativeTransfers(event.items || []);
      if (event.queueStatus) setNativeQueueStatus(event.queueStatus);
    });
    return () => {
      active = false;
      nativeRefreshGeneration.current.invalidate();
      unsubscribe();
    };
  }, []);

  const browserUploads = offline.uploads;
  const activeNative = nativeTransfers.filter((item) => !["complete", "cancelled"].includes(item.state)
    || (item.state === "cancelled" && item.fileSaved && item.evidenceStatus === "cancelled"));
  const completedNative = nativeTransfers.filter((item) => item.state === "complete");
  const { activeCount, failedCount, pausedCount, verifyingCount, uploadingCount, downloadingCount, percentage: nativeProgress } =
    transferProgressSummary(browserUploads, nativeTransfers);

  const nativeJournalInvalid = nativeQueueStatus?.blockedReason === "journal-invalid";
  const nativeJournalWriteFailed = nativeQueueStatus?.blockedReason === "journal-write-failed";
  const nativeStandby = nativeQueueStatus?.blockedReason === "owned-by-another-window" || nativeTransfers.some((item) => item.ownedByAnotherWindow);
  const serverHeld = !offline.online || !offline.serverReachable || ["maintenance", "draining", "restarting", "restoring", "recovery", "read-only", "offline", "unreachable", "incompatible"].includes(String(offline.serverState || "").toLowerCase());
  const label = failedCount
    ? `${failedCount} transfer${failedCount === 1 ? "" : "s"} need attention`
    : activeCount
      ? `${activeCount} moving or queued transfer${activeCount === 1 ? "" : "s"}${nativeProgress !== null ? `, ${nativeProgress}% of bytes` : ", progress unavailable"}${verifyingCount ? `, ${verifyingCount} verifying` : ""}`
      : pausedCount ? `${pausedCount} paused transfer${pausedCount === 1 ? "" : "s"}` : "Transfer Center";

  async function runAction(id: string, action: () => void | Promise<unknown>) {
    if (!beginAction(id)) return;
    setActionError("");
    try {
      // The callback executes in the original user gesture, including OS actions.
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The transfer action failed. Please retry.");
    } finally {
      finishAction(id);
    }
  }

  async function retryAll() {
    // Browser-only sessions must not call Desktop capabilities just because an
    // offline upload failed. Each transport retries only its own failures.
    const attempts: Array<Promise<unknown>> = [];
    if (browserUploads.some((item) => item.status === "failed")) attempts.push(retryAllOfflineFailures());
    if (activeNative.some((item) => item.state === "failed")) attempts.push(retryAllNativeTransfers());
    const results = await Promise.allSettled(attempts);
    const failures = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failures.length) throw new Error(failures.map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason)).join(" · "));
  }

  return (
    <div className="cluster-transfer-center">
      <ClusterButton
        ref={triggerRef}
        unstyled
        type="button"
        className={`cluster-taskbar-action cluster-taskbar-action--icon cluster-transfer-trigger ${open ? "is-active" : ""} ${failedCount ? "has-error" : ""}`}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { if (!isExecuting()) setOpen((value) => !value); }}
      >
        <ClusterIcon name="upload" className="cluster-taskbar-action__icon" />
        {activeCount ? <span className="cluster-transfer-trigger__counts" aria-hidden="true">↑{uploadingCount} ↓{downloadingCount}</span> : null}
        {nativeProgress !== null && activeCount ? <span className="cluster-transfer-trigger__progress" aria-hidden="true"><i style={{ width: `${nativeProgress}%` }} /></span> : null}
      </ClusterButton>
      <ClusterFloatingSurface open={open} anchorRef={triggerRef} placement="bottom-end" mobileMode="sheet" className="cluster-transfer-popover" label="Transfer Center" onDismiss={() => setOpen(false)} canDismiss={() => !isExecuting()} aria-busy={Boolean(actionPending)}>
        <header className="cluster-transfer-popover__header">
          <div>
            <strong>Transfer Center</strong>
            <span>{serverHeld && activeCount ? "Transfers are held until the server is writable and reachable." : activeCount ? `${activeCount} active or queued${pausedCount ? ` · ${pausedCount} paused` : ""}` : pausedCount ? `${pausedCount} paused` : "No active transfers"}</span>
          </div>
          {nativeStandby ? <ClusterButton size="compact" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void runAction("claim-native-queue", async () => {
            const result = await claimNativeTransferQueue();
            if (!result?.writable) throw new Error(result?.blockedReason === "journal-invalid"
              ? "The local transfer journal is invalid. Cluster has preserved the file for manual repair and will not overwrite it."
              : "Another Desktop process still owns this transfer queue. Its transfers have not been interrupted.");
            setNativeTransfers(await getNativeTransfers());
          })}>Take over</ClusterButton> : null}
          {failedCount && !nativeStandby ? <ClusterButton size="compact" variant="secondary" busy={actionPending === "retry-all"} disabled={Boolean(actionPending)} onClick={() => void runAction("retry-all", retryAll)}>Retry failed</ClusterButton> : null}
        </header>
        {nativeJournalWriteFailed ? <p className="cluster-transfer-action-error" role="alert">The Desktop could not save transfer progress. All native transfers are held. Your previous journal and retained files have not been deleted. Check disk space and permissions, then choose Retry journal to reload the last saved queue. Resume unfinished transfers manually and verify uncertain remote outcomes.</p> : null}
        {nativeJournalWriteFailed ? <ClusterButton size="compact" variant="secondary" disabled={Boolean(actionPending)} onClick={() => void runAction("retry-native-journal", async () => {
          const result = await claimNativeTransferQueue();
          if (!result?.writable) throw new Error("The journal still cannot be reopened safely. Check local storage before retrying.");
          setNativeQueueStatus(await getNativeTransferQueueStatus());
          setNativeTransfers(await getNativeTransfers());
        })}>Retry journal</ClusterButton> : null}
        {nativeJournalInvalid ? <p className="cluster-transfer-action-error" role="alert">The local Desktop transfer journal is invalid or unreadable. The original file has been preserved and the queue is read-only. Repair the journal from a trusted backup before retrying. Do not delete the retained transfer files.</p> : null}
        {actionError ? <p className="cluster-transfer-action-error" role="alert">{actionError}</p> : null}
        <div className="cluster-transfer-list">
          {browserUploads.map((upload) => (
            <article key={`browser-${upload.id}`} data-state={upload.status}>
              <div className="cluster-transfer-list__body">
                <strong>{upload.fileName}</strong>
                <span>Browser upload · {upload.status === "pending" && serverHeld ? "held" : upload.status} · {formatBytes(upload.sizeBytes)}</span>
                {upload.lastError ? <small>{upload.lastError}</small> : null}
              </div>
              <div className="cluster-transfer-list__actions">
                {upload.status === "pending" ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`pause-upload:${upload.id}`, () => pauseOfflineUpload(upload.id))}>Pause</ClusterButton> : null}
                {upload.status === "paused" && upload.pauseReason === "manual" ? <ClusterButton size="compact" disabled={Boolean(actionPending)} onClick={() => void runAction(`resume-upload:${upload.id}`, () => resumeOfflineUpload(upload.id))}>Resume</ClusterButton> : null}
                {upload.status === "failed" ? <ClusterButton size="compact" disabled={Boolean(actionPending)} onClick={() => void runAction(`retry-upload:${upload.id}`, () => retryOfflineUpload(upload.id))}>Retry</ClusterButton> : null}
                {upload.status !== "uploading" ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`discard-upload:${upload.id}`, () => discardOfflineUpload(upload.id))}>Remove</ClusterButton> : null}
              </div>
            </article>
          ))}
          {activeNative.map((transfer) => {
            const total = Number(transfer.totalBytes || 0);
            const done = Number(transfer.transferredBytes || 0);
            const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : null;
            return (
              <article key={`native-${transfer.id}`} data-state={transfer.state}>
                <div className="cluster-transfer-list__body">
                  <strong>{nativeLabel(transfer)}</strong>
                  <span>Desktop {transfer.direction} · {nativeStageLabel(transfer)}{total > 0 ? ` · ${formatBytes(done)} / ${formatBytes(total)}` : ""}</span>
                  {transfer.fileSaved && transfer.evidenceStatus && transfer.evidenceStatus !== "linked" ? <small className="cluster-transfer-list__note">{transfer.evidenceStatus === "cancelled" ? "The Project file remains saved. Evidence linking was stopped; this entry can be dismissed without deleting the file." : "The Project file is already saved. Retrying resumes only the evidence relationship; it will not upload the file again."}</small> : null}
                  {transfer.ownedByAnotherWindow ? <small className="cluster-transfer-list__note">Managed by another Desktop window. This window is read-only.</small> : null}
                  {percent !== null ? <progress value={percent} max={100} aria-label={`${percent}% of file bytes transferred${["verifying", "committing"].includes(transfer.state) ? ", processing is not yet complete" : ""}`} /> : null}
                  {transfer.error ? <small>{typeof transfer.error === "string" ? transfer.error : transfer.error.message}</small> : null}
                </div>
                <div className="cluster-transfer-list__actions">
                  {transfer.canPause ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`pause-native:${transfer.id}`, () => pauseNativeTransfer(transfer.id))}>Pause</ClusterButton> : null}
                  {transfer.canResume && transfer.state === "paused" ? <ClusterButton size="compact" disabled={Boolean(actionPending)} onClick={() => void runAction(`resume-native:${transfer.id}`, () => resumeNativeTransfer(transfer.id))}>Resume</ClusterButton> : null}
                  {transfer.canRetry && transfer.state === "failed" ? <ClusterButton size="compact" disabled={Boolean(actionPending)} onClick={() => void runAction(`retry-native:${transfer.id}`, () => retryNativeTransfer(transfer.id))}>{transfer.fileSaved && transfer.evidenceStatus === "failed" ? "Retry link" : "Retry"}</ClusterButton> : null}
                  {!['complete', 'cancelled'].includes(transfer.state) ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`cancel-native:${transfer.id}`, () => cancelNativeTransfer(transfer.id))}>{transfer.fileSaved && transfer.evidenceStatus && transfer.evidenceStatus !== "linked" ? "Stop linking" : "Cancel"}</ClusterButton> : null}
                  {transfer.state === "cancelled" && transfer.fileSaved ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`dismiss-native:${transfer.id}`, () => removeNativeTransfer(transfer.id))}>Dismiss</ClusterButton> : null}
                </div>
              </article>
            );
          })}
          {browserDownloads.map((download) => (
            <article key={`browser-download-${download.id}`} data-state={download.state}>
              <div className="cluster-transfer-list__body">
                <strong>{download.fileName}</strong>
                <span>Browser download · handed to browser</span>
                <small className="cluster-transfer-list__note">Browser-managed progress is not available to Cluster.</small>
              </div>
              <div className="cluster-transfer-list__actions">
                <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => removeBrowserDownloadHandoff(download.id)}>Remove</ClusterButton>
              </div>
            </article>
          ))}
          {!browserUploads.length && !activeNative.length && !browserDownloads.length ? (
            <div className="cluster-transfer-empty">
              <ClusterIcon name="check" />
              <strong>Nothing moving</strong>
              <span>Uploads and downloads from Cluster will appear here.</span>
            </div>
          ) : null}
        </div>
        {completedNative.length || browserDownloads.length ? (
          <footer className="cluster-transfer-popover__footer">
            <span>{completedNative.length ? `${completedNative.length} completed Desktop transfer${completedNative.length === 1 ? "" : "s"}` : ""}{completedNative.length && browserDownloads.length ? " · " : ""}{browserDownloads.length ? `${browserDownloads.length} recent browser handoff${browserDownloads.length === 1 ? "" : "s"}` : ""}</span>
            {completedNative[0]?.canOpen ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(actionPending)} onClick={() => void runAction(`open-native:${completedNative[0].id}`, () => openNativeTransferResult(completedNative[0].id))}>Open latest</ClusterButton> : null}
          </footer>
        ) : null}
      </ClusterFloatingSurface>
    </div>
  );
}

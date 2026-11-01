import { clusterApiFetch } from "@cluster/api-client";
import { API_URL } from "./api/config";
import { getOfflineScopeIdentity } from "./offline-storage";
import { sameOfflineRequestContext } from "./user-state-ownership";
import type { ClusterDownloadSink } from "./browser-download-stream";
import { downloadWithVerifiedResume } from "./transfer-resume";
import { browserDiskTransferQueue, browserDownloadByteLimiter, getTransferPolicy } from "./transfer-policy";
export type ClusterBrowserDownloadHandoff = {
  id: string;
  fileName: string;
  url: string;
  state: "handed-off" | "saved" | "queued" | "saving" | "paused" | "retrying" | "verifying" | "completed" | "failed" | "cancelled";
  startedAt: number;
  receivedBytes?: number;
  totalBytes?: number | null;
  error?: string;
  integrity?: "sha256" | "size" | "unverified";
  retryCount?: number;
};

let snapshot: ClusterBrowserDownloadHandoff[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getBrowserDownloadSnapshot() {
  return snapshot;
}

export function subscribeBrowserDownloads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordBrowserDownloadHandoff(input: { fileName: string; url: string; state?: ClusterBrowserDownloadHandoff["state"] }) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  snapshot = [{ id, fileName: input.fileName, url: input.url, state: input.state || "handed-off", startedAt: Date.now() }, ...snapshot].slice(0, 12);
  emit();
  return id;
}

type ActiveBrowserStream = { controller: AbortController; paused: boolean; waiters: Set<() => void> };
const activeStreamControllers = new Map<string, ActiveBrowserStream>();

export function cancelBrowserDownload(id: string) {
  const job = activeStreamControllers.get(id);
  if (!job) return false;
  job.controller.abort();
  return true;
}
export function pauseBrowserDownload(id: string) {
  const job = activeStreamControllers.get(id);
  if (!job || job.paused) return false;
  job.paused = true;
  updateBrowserDownload(id, { state: "paused" });
  return true;
}
export function resumeBrowserDownload(id: string) {
  const job = activeStreamControllers.get(id);
  if (!job || !job.paused) return false;
  job.paused = false;
  for (const resume of [...job.waiters]) resume();
  updateBrowserDownload(id, { state: "saving" });
  return true;
}
function waitIfPaused(job: ActiveBrowserStream): Promise<void> {
  if (!job.paused) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      job.waiters.delete(resume);
      job.controller.signal.removeEventListener("abort", abort);
    };
    const resume = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(new DOMException("Download cancelled.", "AbortError")); };
    job.waiters.add(resume);
    job.controller.signal.addEventListener("abort", abort, { once: true });
    if (job.controller.signal.aborted) abort();
    else if (!job.paused) resume();
  });
}

function updateBrowserDownload(id: string, patch: Partial<ClusterBrowserDownloadHandoff>) {
  snapshot = snapshot.map((row) => row.id === id ? { ...row, ...patch } : row);
  emit();
}

export function removeBrowserDownloadHandoff(id: string) {
  if (activeStreamControllers.has(id)) return;
  const next = snapshot.filter((item) => item.id !== id);
  if (next.length === snapshot.length) return;
  snapshot = next;
  emit();
}

/** Authenticated download with optional disk streaming, bounded Blob fallback
 * and an unverified browser-managed handoff for files known to be large.
 * Disk streaming uses one HTTP request and only reports completion after
 * the writable file stream closes successfully.
 */
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
const MAX_OUTSTANDING_BLOBS = 4;
const BLOB_REVOKE_DELAY_MS = 60_000;
const pendingBlobUrls = new Map<string, number>();

type ClusterSaveHandle = { createWritable(): Promise<ClusterDownloadSink> };
type ClusterSavePicker = (options: { suggestedName: string }) => Promise<ClusterSaveHandle>;

export async function downloadAuthenticatedClusterFile(input: {
  url: string;
  fileName: string;
  sizeBytes?: number | null;
  expectedSha256?: string | null;
  preferDiskStreaming?: boolean;
}): Promise<{ state: "saved" | "handed-off" | "completed"; transferId: string }> {
  if (typeof document === "undefined") throw new Error("Downloads require an active browser window.");
  const expectedOrigin = new URL(API_URL || window.location.origin, window.location.origin).origin;
  const resolved = new URL(input.url, API_URL || window.location.origin);
  if (resolved.origin !== expectedOrigin || !resolved.pathname.startsWith("/api/")) {
    throw new Error("Only authenticated Cluster API downloads are supported.");
  }
  const fileName = input.fileName.replace(/[\\/\r\n]/g, "_").trim() || "cluster-download";
  const apiPath = resolved.pathname + resolved.search;
  const ownerAtStart = getOfflineScopeIdentity();
  const picker = input.preferDiskStreaming
    ? (window as Window & { showSaveFilePicker?: ClusterSavePicker }).showSaveFilePicker
    : undefined;
  // Invoke the picker before the first await so the browser still has the
  // user gesture. Do not silently fall back after the user cancels the dialog.
  const chosenFile = typeof picker === "function" ? picker.call(window, { suggestedName: fileName }) : null;

  const clickLink = (href: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  };
  const browserHandoff = () => {
    clickLink(resolved.href);
    return { state: "handed-off" as const, transferId: recordBrowserDownloadHandoff({ fileName, url: apiPath, state: "handed-off" }) };
  };
  const checkResponse = async (response: Response) => {
    const actual = new URL(response.url || resolved.href, resolved.href);
    if (response.status !== 200 || actual.origin !== expectedOrigin || !actual.pathname.startsWith("/api/")
      || response.headers.get("content-range")
      || response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      const message = response.status !== 200
        ? "Download failed: server returned HTTP " + response.status + "."
        : "The download response was incomplete or redirected. Verify your session and server address.";
      await response.body?.cancel().catch(() => undefined);
      throw new Error(message);
    }
  };

  if (chosenFile) {
    const handle = await chosenFile;
    if (!sameOfflineRequestContext(ownerAtStart, getOfflineScopeIdentity())) {
      throw new Error("Account or server changed while choosing the destination. No file was written.");
    }
    const controller = new AbortController();
    const control: ActiveBrowserStream = { controller, paused: false, waiters: new Set() };
    const policy = getTransferPolicy();
    browserDiskTransferQueue.setLimit(policy.concurrentDiskDownloads);
    const transferId = recordBrowserDownloadHandoff({ fileName, url: apiPath, state: "queued" });
    activeStreamControllers.set(transferId, control);
    let releaseSlot: (() => void) | null = null;
    let sink: ClusterDownloadSink | null = null;
    let writerOwnedByStream = false;
    let lastPublished = 0;
    const ensureCurrent = () => {
      if (!sameOfflineRequestContext(ownerAtStart, getOfflineScopeIdentity())) {
        controller.abort();
        throw new Error("Account or server changed during download. The incomplete file was discarded.");
      }
    };
    try {
      releaseSlot = await browserDiskTransferQueue.acquire(policy.priority, controller.signal);
      ensureCurrent();
      if (!control.paused) updateBrowserDownload(transferId, { state: "saving" });
      await waitIfPaused(control);
      ensureCurrent();
      sink = await handle.createWritable();
      const fetcher = async (range: { start: number; etag: string } | null, signal?: AbortSignal) => {
        ensureCurrent();
        const headers: Record<string, string> = { Accept: "application/octet-stream, application/pdf, application/zip, */*" };
        if (range) {
          headers.Range = `bytes=${range.start}-`;
          headers["If-Range"] = range.etag;
        }
        const response = await clusterApiFetch(apiPath, { credentials: "include", cache: "no-store", signal, headers });
        const actual = new URL(response.url || resolved.href, resolved.href);
        if (actual.origin !== expectedOrigin || !actual.pathname.startsWith("/api/")) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error("The download redirected outside the authenticated Cluster API.");
        }
        return response;
      };
      writerOwnedByStream = true;
      const result = await downloadWithVerifiedResume(fetcher, sink, {
        signal: controller.signal,
        ensureCurrent,
        beforeRead: () => waitIfPaused(control),
        maxRetries: policy.maxRetries,
        expectedSha256: input.expectedSha256,
        expectedTotalBytes: input.sizeBytes,
        onRateLimit: (bytes, signal) => browserDownloadByteLimiter.wait(bytes, policy.maxDownloadMiBPerSecond, signal),
        onRetry(attempt, offset) {
          if (!control.paused) updateBrowserDownload(transferId, { state: "retrying", retryCount: attempt, receivedBytes: offset });
        },
        onVerifying() { updateBrowserDownload(transferId, { state: "verifying" }); },
        onProgress(receivedBytes, totalBytes) {
          const now = Date.now();
          if (now - lastPublished < 160 && totalBytes !== receivedBytes) return;
          lastPublished = now;
          if (!control.paused) updateBrowserDownload(transferId, { state: "saving", receivedBytes, totalBytes });
        },
      });
      updateBrowserDownload(transferId, {
        state: "completed", receivedBytes: result.bytesWritten, totalBytes: result.totalBytes,
        integrity: result.verified ? "sha256" : result.totalBytes !== null ? "size" : "unverified",
      });
      return { state: "completed", transferId };
    } catch (error) {
      if (!writerOwnedByStream && sink) await sink.abort(error).catch(() => undefined);
      updateBrowserDownload(transferId, {
        state: controller.signal.aborted ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : "Download failed.",
      });
      throw error;
    } finally {
      activeStreamControllers.delete(transferId);
      releaseSlot?.();
    }
  }

  // A known-large file is passed directly to the browser. Do not issue a
  // duplicate full GET merely to obtain a Content-Length we already know.
  if (input.sizeBytes != null && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes > MAX_BUFFERED_BYTES) {
    return browserHandoff();
  }
  const response = await clusterApiFetch(apiPath, { credentials: "include", cache: "no-store",
    headers: { Accept: "application/octet-stream, application/pdf, application/zip, */*" } });
  if (!response.ok) {
    const details = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null) as { message?: string; error?: string } | null : null;
    await response.body?.cancel().catch(() => undefined);
    throw new Error(details?.message || details?.error || "Download failed: server returned HTTP " + response.status + ".");
  }
  await checkResponse(response);
  const handoff = async (reader?: ReadableStreamDefaultReader<Uint8Array>) => {
    // A browser-managed download is a new request; its final disk state is unknown.
    if (reader) await reader.cancel().catch(() => undefined);
    else await response.body?.cancel().catch(() => undefined);
    return browserHandoff();
  };
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > MAX_BUFFERED_BYTES || !response.body || pendingBlobUrls.size >= MAX_OUTSTANDING_BLOBS) {
    return handoff();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BUFFERED_BYTES) return await handoff(reader);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    clickLink(blobUrl);
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    throw error;
  }
  const timer = window.setTimeout(() => {
    pendingBlobUrls.delete(blobUrl);
    URL.revokeObjectURL(blobUrl);
  }, BLOB_REVOKE_DELAY_MS);
  pendingBlobUrls.set(blobUrl, timer);
  return { state: "saved", transferId: recordBrowserDownloadHandoff({ fileName, url: apiPath, state: "saved" }) };
}

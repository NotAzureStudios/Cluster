import { getOfflineScopeIdentity, listOfflineUploads, queueOfflineUpload, removeOfflineUpload, updateOfflineUpload, type OfflineUploadRecord } from "../offline-storage";
import { sameOfflineRequestContext } from "../user-state-ownership";
import { queuedWorkMatchesServerBinding, readOfflineServerBinding } from "../offline-server-binding";
import { recordPerformanceMetric } from "../performance";
import { ApiError, isApiNetworkFailure, isOnline } from "./errors";
import { mutationIdempotencyKey } from "./config";
import { retryDelay } from "./offline-replay";
import { persistentMutationHeaders } from "./mutation-support";

export type QueueableUploadOptions<T> = {
  method?: "POST" | "PUT";
  file: File | Blob;
  fileName?: string;
  body: Record<string, unknown>;
  label: string;
  headers?: HeadersInit;
  queueWhenOffline?: boolean;
  invalidate?: string[];
  onUploadSession?: (session: { id: string | null; transferMode: "cluster" | "direct" | null }) => Promise<void> | void;
  onProgress?: import("./upload-session-transport").UploadSessionPersistence["onProgress"];
  /** Skip the IndexedDB Blob copy before an online transfer. Network failures are still queued durably. */
  persistBeforeTransfer?: boolean;
};

export type QueueableUploadResult<T> = { queued: boolean; result?: T; upload?: OfflineUploadRecord };

import { discardUploadSession, finalizeStagedUpload } from "./upload-session-transport";

export { discardUploadSession } from "./upload-session-transport";

/** Upload backpressure is retryable; the staged session and local Blob remain authoritative. */
function isUploadBackpressure(error: unknown) {
  return error instanceof ApiError && (error.status === 429 || (error.status === 503 &&
    ["SERVER_SATURATED", "UPLOAD_CHUNK_ADMISSION_BUSY"].includes(error.code)));
}
function uploadRetryDelay(error: unknown, attempts: number) {
  const hint = error instanceof ApiError && Number.isFinite(error.retryAfterSeconds)
    ? Math.max(0, Number(error.retryAfterSeconds)) * 1_000 : 0;
  return Math.min(10 * 60_000, Math.max(retryDelay(attempts), hint));
}

function uploadFileName(file: File | Blob, explicit?: string) {
  const requested = String(explicit || "").trim();
  if (requested) return requested;
  if (typeof File !== "undefined" && file instanceof File && file.name.trim()) return file.name.trim();
  return "upload.bin";
}

export async function uploadApi<T>(path: string, options: QueueableUploadOptions<T>): Promise<QueueableUploadResult<T>> {
  const origin = getOfflineScopeIdentity();
  const isCurrent = () => sameOfflineRequestContext(origin, getOfflineScopeIdentity());
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error("Authentication context changed during the upload. Review the original account's transfer history before retrying.");
  };
  const progress = options.onProgress ? async (value: Parameters<NonNullable<QueueableUploadOptions<T>["onProgress"]>>[0]) => {
    if (isCurrent()) await options.onProgress?.(value);
  } : undefined;
  const fileName = uploadFileName(options.file, options.fileName);
  const headers = new Headers(options.headers || {});
  const idempotencyKey = mutationIdempotencyKey(headers);
  const queue = async () => {
    ensureCurrent();
    const binding = readOfflineServerBinding(origin.scope);
    return queueOfflineUpload({
    scope: origin.scope,
    serverInstanceId: binding?.serverInstanceId || null,
    serverDataEpoch: binding?.serverDataEpoch || null,
    serverVersion: binding?.serverVersion || null,
    contractVersion: binding?.contractVersion || null,
    mutationSchemaVersion: binding?.mutationSchemaVersion || null,
    path,
    method: options.method || "POST",
    headers: persistentMutationHeaders(headers),
    label: options.label,
    fileName,
    mimeType: options.file.type || "application/octet-stream",
    sizeBytes: options.file.size,
    file: options.file,
    body: options.body,
    invalidatePaths: options.invalidate,
    idempotencyKey,
    uploadSessionId: null,
    uploadTransferMode: null,
    uploadSessionStartedAt: null,
  }, isCurrent);
  };

  if (options.persistBeforeTransfer === false && isOnline() && options.queueWhenOffline !== false) {
    let directSession: { id: string | null; transferMode: "cluster" | "direct" | null } = { id: null, transferMode: null };
    try {
      ensureCurrent();
      const result = await finalizeStagedUpload<T>(path, {
        method: options.method || "POST",
        file: options.file,
        fileName,
        body: options.body,
        headers,
        invalidate: options.invalidate,
        onUploadSession: async (session) => { ensureCurrent(); directSession = session; await options.onUploadSession?.(session); },
        onProgress: progress,
        ensureCurrent,
      });
      ensureCurrent();
      return { queued: false, result };
    } catch (error) {
      ensureCurrent();
      if (!isApiNetworkFailure(error) && !isUploadBackpressure(error)) throw error;
      const durable = await queue();
      ensureCurrent();
      if (directSession.id || isUploadBackpressure(error)) await updateOfflineUpload(durable.id, {
        ...(directSession.id ? { uploadSessionId: directSession.id, uploadTransferMode: directSession.transferMode, uploadSessionStartedAt: Date.now() } : {}),
        lastError: error instanceof Error ? error.message : "Upload interrupted.",
        nextAttemptAt: Date.now() + uploadRetryDelay(error, 1),
      });
      ensureCurrent();
      return { queued: true, upload: durable };
    }
  }

  if (options.queueWhenOffline === false) {
    ensureCurrent();
    if (!isOnline()) throw new ApiError("This upload requires a connection.", 503);
    const result = await finalizeStagedUpload<T>(path, {
      method: options.method || "POST",
      file: options.file,
      fileName,
      body: options.body,
      headers,
      invalidate: options.invalidate,
      onUploadSession: async (session) => { ensureCurrent(); await options.onUploadSession?.(session); },
      onProgress: progress,
      ensureCurrent,
    });
    ensureCurrent();
    return { queued: false, result };
  }

  let durable: OfflineUploadRecord | null = null;
  try {
    durable = await queue();
  } catch (error) {
    ensureCurrent();
    if (!isOnline()) throw error;
    const result = await finalizeStagedUpload<T>(path, {
      method: options.method || "POST",
      file: options.file,
      fileName,
      body: options.body,
      headers,
      invalidate: options.invalidate,
      onUploadSession: async (session) => { ensureCurrent(); await options.onUploadSession?.(session); },
      onProgress: progress,
      ensureCurrent,
    });
    ensureCurrent();
    return { queued: false, result };
  }
  ensureCurrent();
  if (!isOnline()) return { queued: true, upload: durable };
  await updateOfflineUpload(durable.id, { status: "uploading", attempts: 1, lastAttemptAt: Date.now(), lastError: null });
  try {
    const result = await finalizeStagedUpload<T>(path, {
      method: options.method || "POST",
      file: options.file,
      fileName,
      body: options.body,
      headers,
      invalidate: options.invalidate,
      uploadSessionId: durable.uploadSessionId,
      onUploadSession: async ({ id, transferMode }) => {
        ensureCurrent();
        await updateOfflineUpload(durable.id, {
          uploadSessionId: id,
          uploadTransferMode: transferMode,
          uploadSessionStartedAt: id ? Date.now() : null,
        });
        ensureCurrent();
        await options.onUploadSession?.({ id, transferMode });
      },
      onProgress: progress,
      ensureCurrent,
    });
    ensureCurrent();
    await removeOfflineUpload(durable.id);
    return { queued: false, result };
  } catch (error) {
    ensureCurrent();
    if (isApiNetworkFailure(error) || isUploadBackpressure(error)) {
      const upload = await updateOfflineUpload(durable.id, {
        status: "pending",
        lastError: error instanceof Error ? error.message : "Upload interrupted.",
        nextAttemptAt: Date.now() + uploadRetryDelay(error, 1),
      });
      return { queued: true, upload: upload || durable };
    }
    // A non-network rejection does not authorize deleting the only local Blob.
    // Keep failed work visible in Sync Center until the user reviews it.
    await updateOfflineUpload(durable.id, {
      status: error instanceof ApiError && [401, 409].includes(error.status) ? "paused" : "failed",
      pausedAt: Date.now(),
      pauseReason: error instanceof ApiError && error.status === 401 ? "auth" : "manual",
      lastError: error instanceof Error ? error.message : "Upload requires review.",
      nextAttemptAt: Date.now() + retryDelay(1),
    });
    throw error;
  }
}

const OFFLINE_UPLOADS_PER_FLUSH = 8;
type ActiveQueuedUpload = { controller: AbortController; pauseRequested: boolean; owner: ReturnType<typeof getOfflineScopeIdentity> };
const activeQueuedUploads = new Map<string, ActiveQueuedUpload>();

/** Stop the network, not the saved upload Blob or its server session.
 * A resumed job must re-inspect the authoritative server offset. */
export function requestPauseActiveOfflineUpload(id: string) {
  const running = activeQueuedUploads.get(id);
  if (!running || !sameOfflineRequestContext(running.owner, getOfflineScopeIdentity())) return false;
  running.pauseRequested = true;
  running.controller.abort();
  return true;
}
let uploadFlushPromise: Promise<OfflineUploadRecord[]> | null = null;
let uploadFlushOwner: ReturnType<typeof getOfflineScopeIdentity> | null = null;
export async function flushApiUploads(options: { maxUploads?: number } = {}) {
  const owner = getOfflineScopeIdentity();
  const isCurrent = () => sameOfflineRequestContext(owner, getOfflineScopeIdentity());
  if (uploadFlushPromise) {
    // A signed-in account never inherits another account's in-flight queue or results.
    if (!uploadFlushOwner || !sameOfflineRequestContext(owner, uploadFlushOwner)) return [];
    return uploadFlushPromise.then((rows) => isCurrent() ? rows : []);
  }
  uploadFlushOwner = owner;
  uploadFlushPromise = (async () => {
    if (!isOnline() || !isCurrent()) return isCurrent() ? listOfflineUploads(owner.scope) : [];
    const maxUploads = Math.max(1, Math.min(OFFLINE_UPLOADS_PER_FLUSH, Math.floor(options.maxUploads || OFFLINE_UPLOADS_PER_FLUSH)));
    const binding = readOfflineServerBinding(owner.scope);
    const queue = await listOfflineUploads(owner.scope);
    if (!isCurrent()) return [];
    for (const item of queue) {
      if (!isCurrent()) return [];
      if (item.status !== "pending") continue;
      const compatibility = queuedWorkMatchesServerBinding(item, binding);
      if (!compatibility.ok) await updateOfflineUpload(item.id, { status: "paused", pausedAt: Date.now(), pauseReason: "compatibility", lastError: compatibility.reason });
    }
    const ready = (await listOfflineUploads(owner.scope)).filter((item) => item.status === "pending" && item.nextAttemptAt <= Date.now()).slice(0, maxUploads);
    if (!isCurrent()) return [];
    for (const item of ready) {
      if (!isCurrent()) return [];
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await updateOfflineUpload(item.id, { status: "uploading", attempts: item.attempts + 1, lastAttemptAt: Date.now(), lastError: null });
      const control: ActiveQueuedUpload = { controller: new AbortController(), pauseRequested: false, owner };
      activeQueuedUploads.set(item.id, control);
      try {
        if (control.pauseRequested) throw new Error("Upload paused by the user.");
        const headers = new Headers(item.headers || {});
        headers.set("X-Cluster-Idempotency-Key", item.idempotencyKey);
        await finalizeStagedUpload(item.path, {
          method: item.method,
          file: item.file,
          fileName: item.fileName,
          body: item.body,
          headers,
          invalidate: item.invalidatePaths,
          uploadSessionId: item.uploadSessionId || null,
          signal: control.controller.signal,
          ensureCurrent: () => {
            if (control.pauseRequested) throw new Error("Upload paused by the user.");
            if (!isCurrent()) throw new Error("Upload context changed; original transfer remains queued for review.");
          },
          onUploadSession: async ({ id, transferMode }) => {
            if (!isCurrent()) throw new Error("Upload session changed; the original transfer remains queued for review.");
            await updateOfflineUpload(item.id, {
              uploadSessionId: id,
              uploadTransferMode: transferMode,
              uploadSessionStartedAt: id ? (item.uploadSessionStartedAt || Date.now()) : null,
            });
          },
        });
        if (!isCurrent()) return [];
        await removeOfflineUpload(item.id);
        recordPerformanceMetric({ name: `offline upload ${item.path}`, category: "sync", durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt, startedAt: Date.now(), detail: { sizeBytes: item.sizeBytes, success: true } });
      } catch (error) {
        if (!isCurrent()) return [];
        if (control.pauseRequested) {
          await updateOfflineUpload(item.id, {
            status: "paused", pausedAt: Date.now(), pauseReason: "manual", lastError: null,
          });
          break;
        }
        const status = error instanceof ApiError ? error.status : 0;
        const authPaused = status === 401;
        const reviewPaused = status === 409;
        const terminal = error instanceof ApiError && [400, 403, 404, 405, 413, 415, 422].includes(error.status);
        await updateOfflineUpload(item.id, {
          status: authPaused || reviewPaused ? "paused" : terminal ? "failed" : "pending",
          pausedAt: authPaused || reviewPaused ? Date.now() : null,
          pauseReason: authPaused ? "auth" : reviewPaused ? "manual" : null,
          lastError: authPaused ? "Sign in again to resume this upload." : error instanceof Error ? error.message : "Upload failed.",
          nextAttemptAt: Date.now() + uploadRetryDelay(error, item.attempts + 1),
        });
        recordPerformanceMetric({ name: `offline upload ${item.path}`, category: "sync", durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt, startedAt: Date.now(), detail: { sizeBytes: item.sizeBytes, success: false, authPaused } });
        if (authPaused || reviewPaused || !terminal) break;
      } finally {
        activeQueuedUploads.delete(item.id);
      }
    }
    return isCurrent() ? listOfflineUploads(owner.scope) : [];
  })().finally(() => { uploadFlushPromise = null; uploadFlushOwner = null; });
  return uploadFlushPromise.then((rows) => isCurrent() ? rows : []);
}

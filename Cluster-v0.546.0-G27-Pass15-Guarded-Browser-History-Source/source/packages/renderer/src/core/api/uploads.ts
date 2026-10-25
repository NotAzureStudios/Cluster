import { getOfflineScope, listOfflineUploads, queueOfflineUpload, removeOfflineUpload, updateOfflineUpload, type OfflineUploadRecord } from "../offline-storage";
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

function uploadFileName(file: File | Blob, explicit?: string) {
  const requested = String(explicit || "").trim();
  if (requested) return requested;
  if (typeof File !== "undefined" && file instanceof File && file.name.trim()) return file.name.trim();
  return "upload.bin";
}

export async function uploadApi<T>(path: string, options: QueueableUploadOptions<T>): Promise<QueueableUploadResult<T>> {
  const fileName = uploadFileName(options.file, options.fileName);
  const headers = new Headers(options.headers || {});
  const idempotencyKey = mutationIdempotencyKey(headers);
  const queue = async () => {
    const binding = readOfflineServerBinding(getOfflineScope());
    return queueOfflineUpload({
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
  });
  };

  if (options.persistBeforeTransfer === false && isOnline() && options.queueWhenOffline !== false) {
    let directSession: { id: string | null; transferMode: "cluster" | "direct" | null } = { id: null, transferMode: null };
    try {
      const result = await finalizeStagedUpload<T>(path, {
        method: options.method || "POST",
        file: options.file,
        fileName,
        body: options.body,
        headers,
        invalidate: options.invalidate,
        onUploadSession: async (session) => { directSession = session; await options.onUploadSession?.(session); },
        onProgress: options.onProgress,
      });
      return { queued: false, result };
    } catch (error) {
      if (!isApiNetworkFailure(error)) throw error;
      const durable = await queue();
      if (directSession.id) await updateOfflineUpload(durable.id, {
        uploadSessionId: directSession.id,
        uploadTransferMode: directSession.transferMode,
        uploadSessionStartedAt: Date.now(),
        lastError: error instanceof Error ? error.message : "Upload interrupted.",
      });
      return { queued: true, upload: durable };
    }
  }

  if (options.queueWhenOffline === false) {
    if (!isOnline()) throw new ApiError("This upload requires a connection.", 503);
    const result = await finalizeStagedUpload<T>(path, {
      method: options.method || "POST",
      file: options.file,
      fileName,
      body: options.body,
      headers,
      invalidate: options.invalidate,
      onUploadSession: options.onUploadSession,
      onProgress: options.onProgress,
    });
    return { queued: false, result };
  }

  let durable: OfflineUploadRecord | null = null;
  try {
    durable = await queue();
  } catch (error) {
    if (!isOnline()) throw error;
    const result = await finalizeStagedUpload<T>(path, {
      method: options.method || "POST",
      file: options.file,
      fileName,
      body: options.body,
      headers,
      invalidate: options.invalidate,
      onUploadSession: options.onUploadSession,
      onProgress: options.onProgress,
    });
    return { queued: false, result };
  }
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
        await updateOfflineUpload(durable.id, {
          uploadSessionId: id,
          uploadTransferMode: transferMode,
          uploadSessionStartedAt: id ? Date.now() : null,
        });
        await options.onUploadSession?.({ id, transferMode });
      },
      onProgress: options.onProgress,
    });
    await removeOfflineUpload(durable.id);
    return { queued: false, result };
  } catch (error) {
    if (isApiNetworkFailure(error)) {
      const upload = await updateOfflineUpload(durable.id, {
        status: "pending",
        lastError: error instanceof Error ? error.message : "Upload interrupted.",
        nextAttemptAt: Date.now() + retryDelay(1),
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
let uploadFlushPromise: Promise<OfflineUploadRecord[]> | null = null;
export async function flushApiUploads(options: { maxUploads?: number } = {}) {
  if (uploadFlushPromise) return uploadFlushPromise;
  uploadFlushPromise = (async () => {
    if (!isOnline()) return listOfflineUploads();
    const maxUploads = Math.max(1, Math.min(OFFLINE_UPLOADS_PER_FLUSH, Math.floor(options.maxUploads || OFFLINE_UPLOADS_PER_FLUSH)));
    const binding = readOfflineServerBinding(getOfflineScope());
    const queue = await listOfflineUploads();
    for (const item of queue) {
      if (item.status !== "pending") continue;
      const compatibility = queuedWorkMatchesServerBinding(item, binding);
      if (!compatibility.ok) await updateOfflineUpload(item.id, { status: "paused", pausedAt: Date.now(), pauseReason: "compatibility", lastError: compatibility.reason });
    }
    const ready = (await listOfflineUploads()).filter((item) => item.status === "pending" && item.nextAttemptAt <= Date.now()).slice(0, maxUploads);
    for (const item of ready) {
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await updateOfflineUpload(item.id, { status: "uploading", attempts: item.attempts + 1, lastAttemptAt: Date.now(), lastError: null });
      try {
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
          onUploadSession: async ({ id, transferMode }) => {
            await updateOfflineUpload(item.id, {
              uploadSessionId: id,
              uploadTransferMode: transferMode,
              uploadSessionStartedAt: id ? (item.uploadSessionStartedAt || Date.now()) : null,
            });
          },
        });
        await removeOfflineUpload(item.id);
        recordPerformanceMetric({ name: `offline upload ${item.path}`, category: "sync", durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt, startedAt: Date.now(), detail: { sizeBytes: item.sizeBytes, success: true } });
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 0;
        const authPaused = status === 401;
        const reviewPaused = status === 409;
        const terminal = error instanceof ApiError && [400, 403, 404, 405, 413, 415, 422].includes(error.status);
        await updateOfflineUpload(item.id, {
          status: authPaused || reviewPaused ? "paused" : terminal ? "failed" : "pending",
          pausedAt: authPaused || reviewPaused ? Date.now() : null,
          pauseReason: authPaused ? "auth" : reviewPaused ? "manual" : null,
          lastError: authPaused ? "Sign in again to resume this upload." : error instanceof Error ? error.message : "Upload failed.",
          nextAttemptAt: Date.now() + retryDelay(item.attempts + 1),
        });
        recordPerformanceMetric({ name: `offline upload ${item.path}`, category: "sync", durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt, startedAt: Date.now(), detail: { sizeBytes: item.sizeBytes, success: false, authPaused } });
        if (authPaused || reviewPaused || !terminal) break;
      }
    }
    return listOfflineUploads();
  })().finally(() => { uploadFlushPromise = null; });
  return uploadFlushPromise;
}

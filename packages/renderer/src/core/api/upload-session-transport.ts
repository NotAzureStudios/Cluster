import { api } from "./transport";
import { ApiError } from "./errors";
import { invalidateMutationCache } from "./mutation-cache";
import { invalidateMutationQueries } from "./mutation-support";

type UploadSessionStart = {
  ok: true;
  uploadId: string;
  receivedBytes: number;
  chunkSize: number;
  transferMode?: "cluster" | "direct";
  totalParts?: number;
  browserUploadCapability?: { state: string; detail?: string } | null;
};
type UploadSessionInspection = {
  ok: true;
  upload: {
    id: string;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    completedAt?: string;
    checksumSha256?: string;
    mode: "cluster" | "direct";
    status: string;
  };
  transferMode: "cluster" | "direct";
  chunkSize: number;
  totalParts?: number | null;
};
type UploadSessionProgress = { ok: true; receivedBytes: number };
type UploadSessionComplete = { ok: true; uploadId: string; checksumSha256: string; sizeBytes: number; transferMode?: "cluster" | "direct" };
type DirectPartAuthorization = { ok: true; completed: boolean; partNumber: number; sizeBytes: number; etag?: string; url?: string; expiresAt?: string };

export type UploadSessionProgressEvent = {
  uploadId: string;
  transferMode: "cluster" | "direct";
  phase: "staging" | "verifying";
  receivedBytes: number;
  totalBytes: number;
  percent: number;
};

export type UploadSessionPersistence = {
  uploadSessionId?: string | null;
  onUploadSession?: (session: { id: string | null; transferMode: "cluster" | "direct" | null }) => Promise<void> | void;
  onProgress?: (progress: UploadSessionProgressEvent) => Promise<void> | void;
  /** Reject stale account/server context between staged requests. */
  ensureCurrent?: () => void;
  signal?: AbortSignal;
};

export async function discardUploadSession(uploadId: string) {
  // Called by explicit user disposal only. A failed acknowledgement must not
  // erase the local queued Blob or hide a staged server session.
  await api(`/api/uploads/${uploadId}`, { method: "DELETE", skipCacheInvalidation: true });
}

async function stageClusterUpload(file: File | Blob, session: UploadSessionStart, options: UploadSessionPersistence) {
  const { onProgress, ensureCurrent, signal } = options;
  let offset = Math.max(0, Number(session.receivedBytes || 0));
  const chunkSize = Math.max(256 * 1024, Math.min(8 * 1024 * 1024, Number(session.chunkSize || 4 * 1024 * 1024)));
  await onProgress?.({ uploadId: session.uploadId, transferMode: "cluster", phase: "staging", receivedBytes: offset, totalBytes: file.size, percent: file.size ? Math.round(offset / file.size * 100) : 100 });
  while (offset < file.size) {
    ensureCurrent?.();
    const endExclusive = Math.min(file.size, offset + chunkSize);
    const chunk = file.slice(offset, endExclusive);
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Range": `bytes ${offset}-${endExclusive - 1}/${file.size}`,
    });
    const progress = await api<UploadSessionProgress>(`/api/uploads/${session.uploadId}/chunks`, {
      method: "PUT",
      headers,
      body: chunk,
      signal,
      skipCacheInvalidation: true,
    });
    ensureCurrent?.();
    const nextOffset = Number(progress.receivedBytes || 0);
    if (nextOffset <= offset || nextOffset > file.size) throw new ApiError("The server returned an invalid upload offset.", 409, progress, null, "UPLOAD_OFFSET_INVALID");
    offset = nextOffset;
    await onProgress?.({ uploadId: session.uploadId, transferMode: "cluster", phase: "staging", receivedBytes: offset, totalBytes: file.size, percent: file.size ? Math.round(offset / file.size * 100) : 100 });
  }
}

async function stageDirectUpload(file: File | Blob, session: UploadSessionStart, options: UploadSessionPersistence) {
  const { onProgress, ensureCurrent, signal } = options;
  const partSize = Math.max(5 * 1024 * 1024, Number(session.chunkSize || 16 * 1024 * 1024));
  const totalParts = Math.max(1, Number(session.totalParts || Math.ceil(file.size / partSize)));
  await onProgress?.({ uploadId: session.uploadId, transferMode: "direct", phase: "staging", receivedBytes: Math.max(0, Number(session.receivedBytes || 0)), totalBytes: file.size, percent: file.size ? Math.round(Math.max(0, Number(session.receivedBytes || 0)) / file.size * 100) : 100 });
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    ensureCurrent?.();
    const authorization = await api<DirectPartAuthorization>(`/api/uploads/${session.uploadId}/parts/${partNumber}/url`, {
      method: "GET",
      signal,
      skipCacheInvalidation: true,
    });
    ensureCurrent?.();
    if (authorization.completed) {
      const receivedBytes = Math.min(file.size, partNumber * partSize);
      await onProgress?.({ uploadId: session.uploadId, transferMode: "direct", phase: "staging", receivedBytes, totalBytes: file.size, percent: file.size ? Math.round(receivedBytes / file.size * 100) : 100 });
      continue;
    }
    if (!authorization.url) throw new ApiError("The server did not return a direct upload URL.", 503, authorization, null, "UPLOAD_DIRECT_URL_MISSING");
    const start = (partNumber - 1) * partSize;
    const endExclusive = Math.min(file.size, start + Number(authorization.sizeBytes || partSize));
    const chunk = file.slice(start, endExclusive);
    const response = await fetch(authorization.url, { method: "PUT", body: chunk, signal });
    ensureCurrent?.();
    if (!response.ok) throw new ApiError(`Object storage rejected upload part ${partNumber}.`, response.status, null, null, "UPLOAD_DIRECT_PART_FAILED");
    const etag = String(response.headers.get("etag") || "").trim();
    if (!etag) {
      throw new ApiError(
        "Object storage completed the part but did not expose its ETag. Configure the storage CORS policy to expose the ETag response header.",
        502,
        null,
        null,
        "UPLOAD_DIRECT_ETAG_UNAVAILABLE",
      );
    }
    await api<UploadSessionProgress>(`/api/uploads/${session.uploadId}/parts/${partNumber}/complete`, {
      method: "POST",
      signal,
      body: JSON.stringify({ etag, sizeBytes: chunk.size }),
      skipCacheInvalidation: true,
    });
    const receivedBytes = Math.min(file.size, endExclusive);
    await onProgress?.({ uploadId: session.uploadId, transferMode: "direct", phase: "staging", receivedBytes, totalBytes: file.size, percent: file.size ? Math.round(receivedBytes / file.size * 100) : 100 });
  }
}

async function recoverUploadSession(uploadId: string, file: File | Blob, fileName: string, options: UploadSessionPersistence) {
  try {
    options.ensureCurrent?.();
    const inspected = await api<UploadSessionInspection>(`/api/uploads/${uploadId}`, { method: "GET", signal: options.signal, skipCacheInvalidation: true });
    options.ensureCurrent?.();
    if (inspected.upload.totalBytes !== file.size || inspected.upload.fileName !== fileName) {
      throw new ApiError("Saved transfer does not match the selected file. Review it before choosing a different upload.", 409, null, null, "UPLOAD_SESSION_CONTENT_CONFLICT");
    }
    if (!["OPEN", "COMPLETED"].includes(inspected.upload.status)) {
      const ambiguous = ["FINALIZING", "REVIEW_REQUIRED", "ABORTING", "CLEANING"].includes(inspected.upload.status);
      throw new ApiError(ambiguous
        ? "Object-storage delivery may be incomplete or its response was lost. Cluster retained the server record and local file. Do not discard the transfer; an administrator must reconcile the provider state."
        : "Saved transfer is paused or requires recovery. Review the transfer before resuming.", 409, null, null,
        ambiguous ? "UPLOAD_RECONCILIATION_REQUIRED" : "UPLOAD_STATE_INVALID");
    }
    if (inspected.upload.completedAt && inspected.upload.checksumSha256) {
      return {
        session: {
          ok: true as const,
          uploadId,
          receivedBytes: inspected.upload.totalBytes,
          chunkSize: inspected.chunkSize,
          transferMode: inspected.transferMode,
          totalParts: inspected.totalParts || undefined,
        },
        completed: {
          ok: true as const,
          uploadId,
          checksumSha256: inspected.upload.checksumSha256,
          sizeBytes: inspected.upload.totalBytes,
          transferMode: inspected.transferMode,
        } satisfies UploadSessionComplete,
      };
    }
    return {
      session: {
        ok: true as const,
        uploadId,
        receivedBytes: inspected.upload.receivedBytes,
        chunkSize: inspected.chunkSize,
        transferMode: inspected.transferMode,
        totalParts: inspected.totalParts || undefined,
      },
      completed: null,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function stageUpload(
  file: File | Blob,
  fileName: string,
  options: UploadSessionPersistence & { clientSessionKey?: string | null } = {},
) {
  options.ensureCurrent?.();
  const recovered = options.uploadSessionId ? await recoverUploadSession(options.uploadSessionId, file, fileName, options) : null;
  let session: UploadSessionStart | null = recovered?.session ?? null;
  if (!session) {
    options.ensureCurrent?.();
    session = await api<UploadSessionStart>("/api/uploads", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({ fileName, totalBytes: file.size, contentType: file.type || "application/octet-stream", clientKey: options.clientSessionKey || undefined }),
      skipCacheInvalidation: true,
    });
    options.ensureCurrent?.();
    await options.onUploadSession?.({ id: session.uploadId, transferMode: session.transferMode || "cluster" });
  }
  options.ensureCurrent?.();
  if (recovered?.completed) return recovered.completed;
  if (!session) throw new Error("Upload session could not be initialized.");
  const activeSession = session;
  if (activeSession.transferMode === "direct") await stageDirectUpload(file, activeSession, options);
  else await stageClusterUpload(file, activeSession, options);
  options.ensureCurrent?.();
  await options.onProgress?.({ uploadId: activeSession.uploadId, transferMode: activeSession.transferMode || "cluster", phase: "verifying", receivedBytes: file.size, totalBytes: file.size, percent: 100 });
  // Do not discard staged data on any error. A lost commit acknowledgement,
  // revision conflict or temporary outage can be reconciled on next retry.
  return api<UploadSessionComplete>(`/api/uploads/${activeSession.uploadId}/complete`, {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({}),
    skipCacheInvalidation: true,
  });
}

export async function finalizeStagedUpload<T>(path: string, options: {
  method: "POST" | "PUT";
  file: File | Blob;
  fileName: string;
  body: Record<string, unknown>;
  headers: Headers;
  invalidate?: string[];
} & UploadSessionPersistence) {
  const staged = await stageUpload(options.file, options.fileName, {
    uploadSessionId: options.uploadSessionId,
    onUploadSession: options.onUploadSession,
    onProgress: options.onProgress,
    ensureCurrent: options.ensureCurrent,
    signal: options.signal,
    clientSessionKey: options.headers.get("X-Cluster-Idempotency-Key"),
  });
  options.ensureCurrent?.();
  const result = await api<T>(path, {
    method: options.method,
    headers: options.headers,
    signal: options.signal,
    body: JSON.stringify({ ...options.body, uploadId: staged.uploadId }),
    skipCacheInvalidation: true,
  });
  options.ensureCurrent?.();
  invalidateMutationCache(path);
  invalidateMutationQueries(options.invalidate);
  return result;
}

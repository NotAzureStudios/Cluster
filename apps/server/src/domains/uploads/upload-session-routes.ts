import { sendStoredResource, sendStorageResource } from "../media/resource-delivery.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createBufferedUploadAdmission, preflightBufferedChunkHeaders, type BufferedUploadRange } from "./upload-chunk-admission.js";

import {
  MAX_UPLOAD_CHUNK_BYTES,
  acknowledgeDirectPart,
  abortUploadSession,
  appendClusterChunk,
  authorizeDirectPart,
  completeUploadSession,
  createUploadSession,
  expectedPartSize,
  getUploadSession,
  pauseUploadSession,
  resumeUploadSession,
  resolveCompletedUpload,
  serializeUploadSession,
  uploadPressureSnapshot,
  uploadStagingTopology,
  workspaceByteRateLimit,
  type UploadRuntimeDependencies,
} from "./upload-session-runtime.js";

type UploadSessionDependencies = UploadRuntimeDependencies & {
  app: FastifyInstance;
  getCurrentUser: (request: FastifyRequest) => Promise<any | null>;
  decorateUserForClient: (user: any) => Promise<any>;
  byteRateLimiter: {
    consumeCost: (key: string, limit: number, windowMs: number, cost: number) => Promise<{
      allowed: boolean;
      retryAfterSeconds: number;
      remaining: number;
      resetAt: number;
    }>;
  };
};

function statusFor(error: unknown, fallback = 400) {
  const status = Number((error as any)?.statusCode || fallback);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function codeFor(error: unknown, fallback = "UPLOAD_ERROR") {
  return String((error as any)?.code || fallback);
}

function sendUploadError(reply: FastifyReply, error: unknown, fallback = "Upload operation failed.") {
  const body: Record<string, unknown> = {
    code: codeFor(error),
    message: error instanceof Error ? error.message : fallback,
  };
  if (Number.isFinite(Number((error as any)?.receivedBytes))) body.receivedBytes = Number((error as any).receivedBytes);
  if ((error as any)?.browserUploadCapability) body.browserUploadCapability = (error as any).browserUploadCapability;
  return reply.code(statusFor(error)).send(body);
}

async function requireOwner(request: FastifyRequest, reply: FastifyReply, deps: UploadSessionDependencies, id: string, includeParts = true) {
  const user = await deps.getCurrentUser(request);
  if (!user) {
    reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    return null;
  }
  const session = await getUploadSession(deps, id, user.id, Boolean(user.isAdmin), includeParts);
  if (!session) {
    reply.code(404).send({ code: "UPLOAD_NOT_FOUND", message: "Upload session was not found." });
    return null;
  }
  return { user, session };
}

async function consumeWorkspaceByteBudget(deps: UploadSessionDependencies, session: any, bytes: number, reply: FastifyReply) {
  const scope = session.workspaceId || "unscoped";
  const decision = await deps.byteRateLimiter.consumeCost(`upload-bytes:${scope}`, workspaceByteRateLimit(), 60_000, Math.max(1, bytes));
  if (decision.allowed) return true;
  reply.header("Retry-After", String(decision.retryAfterSeconds));
  reply.code(429).send({
    code: "UPLOAD_BYTE_RATE_LIMITED",
    message: "Workspace upload throughput is temporarily at its safe limit.",
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  return false;
}

export {
  resolveCompletedUpload,
  uploadPressureSnapshot,
  uploadStagingTopology,
} from "./upload-session-runtime.js";

export function registerUploadSessionRoutes(deps: UploadSessionDependencies) {
  const { app } = deps;
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD_CHUNK_BYTES },
      (_request, body, done) => done(null, body),
    );
  }

  app.post("/api/uploads", async (request, reply) => {
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const body = z.object({
      fileName: z.string().trim().min(1).max(500),
      totalBytes: z.number().int().nonnegative().max(20 * 1024 * 1024 * 1024),
      contentType: z.string().trim().min(1).max(200).optional().nullable(),
      clientKey: z.string().trim().min(8).max(200).optional().nullable(),
    }).parse(request.body || {});
    try {
      const decorated = await deps.decorateUserForClient(user);
      const workspaceId = decorated?.workspaceId ? String(decorated.workspaceId) : null;
      const created = await createUploadSession(deps, {
        ownerId: user.id,
        workspaceId,
        fileName: body.fileName,
        totalBytes: body.totalBytes,
        contentType: body.contentType || null,
        browserOrigin: String(request.headers.origin || "").trim() || null,
        clientKey: body.clientKey || null,
      });
      reply.code(201);
      return { ...created.response, staging: uploadStagingTopology(deps).mode };
    } catch (error) {
      return sendUploadError(reply, error, "Unable to create upload session.");
    }
  });

  app.get("/api/uploads/:uploadId", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    return serializeUploadSession(resolved.session);
  });

  // Keep the existing eight-MiB content parser, but admit requests before it
  // buffers a chunk. This bounds in-process chunk memory under upload bursts
  // and rejects unauthenticated, oversized and byte-quota-denied traffic early.
  const chunkAdmission = createBufferedUploadAdmission();
  const admittedChunks = new WeakMap<FastifyRequest, {
    session: any;
    range: BufferedUploadRange;
    release: () => void;
  }>();
  const releaseChunk = (request: FastifyRequest) => {
    const entry = admittedChunks.get(request);
    if (!entry) return;
    admittedChunks.delete(request);
    entry.release();
  };

  // Local/shared-filesystem fallback. Direct-object sessions never send bytes
  // through this route.
  app.put("/api/uploads/:uploadId/chunks", {
    onRequest: async (request, reply) => {
      const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
      const resolved = await requireOwner(request, reply, deps, params.uploadId, false);
      if (!resolved) return reply;
      if (resolved.session.mode === "direct") {
        return reply.code(409).send({
          code: "UPLOAD_DIRECT_REQUIRED",
          message: "This upload session uses direct object-storage parts.",
        });
      }
      if (resolved.session.mode !== "cluster" || resolved.session.status !== "OPEN") {
        return reply.code(409).send({
          code: "UPLOAD_STATE_INVALID",
          message: "Upload session is not accepting Cluster-proxied chunks.",
        });
      }
      const preflight = preflightBufferedChunkHeaders(request.headers, MAX_UPLOAD_CHUNK_BYTES);
      if (!preflight.ok) return reply.code(preflight.status).send({ code: preflight.code, message: preflight.message });
      // The durable writer repeats these checks under its local mutation lock
      // against fresh DB state. Early admission rejects provably stale offsets
      // and wrong totals before they consume a body buffer or workspace quota.
      if (preflight.range.total !== Number(resolved.session.totalBytes)) {
        return reply.code(400).send({ code: "UPLOAD_RANGE_INVALID", message: "Upload chunk range is invalid." });
      }
      const receivedBytes = Number(resolved.session.receivedBytes || 0);
      if (preflight.range.start !== receivedBytes) {
        return reply.code(409).send({
          code: "UPLOAD_OFFSET_CONFLICT",
          message: "Upload offset conflict.",
          receivedBytes,
        });
      }
      const release = chunkAdmission.acquire(resolved.session.id);
      if (!release) {
        reply.header("Retry-After", "1");
        return reply.code(503).send({
          code: "UPLOAD_CHUNK_ADMISSION_BUSY",
          message: "Buffered upload capacity is temporarily occupied. Retry this chunk.",
        });
      }
      const cleanup = () => releaseChunk(request);
      admittedChunks.set(request, { session: resolved.session, range: preflight.range, release });
      request.raw.once("aborted", cleanup);
      reply.raw.once("close", cleanup);
      try {
        if (!(await consumeWorkspaceByteBudget(deps, resolved.session, preflight.range.bytes, reply))) {
          cleanup();
          return reply;
        }
      } catch (error) {
        cleanup();
        throw error;
      }
      if (request.raw.destroyed && !request.raw.complete) {
        cleanup();
        return reply;
      }
    },
    onResponse: async (request) => { releaseChunk(request); },
  }, async (request, reply) => {
    const admitted = admittedChunks.get(request);
    if (!admitted) return reply.code(503).send({ code: "UPLOAD_CHUNK_ADMISSION_LOST", message: "Upload admission was interrupted." });
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const { start, end, total, bytes } = admitted.range;
    if (body.length !== bytes) {
      // For chunked requests without Content-Length, do not let a dishonest
      // Content-Range undercharge the workspace byte budget. This extra quota
      // read runs only on malformed requests, not legitimate upload traffic.
      if (body.length > bytes && !(await consumeWorkspaceByteBudget(deps, admitted.session, body.length - bytes, reply))) return;
      return reply.code(400).send({ code: "UPLOAD_RANGE_INVALID", message: "Upload chunk range is invalid." });
    }
    try {
      return await appendClusterChunk(deps, admitted.session, { start, end, total, body });
    } catch (error) {
      return sendUploadError(reply, error, "Unable to append upload chunk.");
    }
  });

  // Direct multipart uses short-lived provider URLs. Cluster authorizes and
  // budgets the part but never proxies the payload bytes.
  app.get("/api/uploads/:uploadId/parts/:partNumber/url", async (request, reply) => {
    const params = z.object({
      uploadId: z.string().uuid(),
      partNumber: z.coerce.number().int().min(1).max(10_000),
    }).parse(request.params);
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    if (resolved.session.mode !== "direct") {
      return reply.code(409).send({ code: "UPLOAD_CLUSTER_CHUNKS_REQUIRED", message: "This upload session uses Cluster chunk transport." });
    }
    const sizeBytes = expectedPartSize(resolved.session, params.partNumber);
    if (sizeBytes == null) return reply.code(400).send({ code: "UPLOAD_PART_INVALID", message: "Upload part number is invalid." });
    const existing = (resolved.session.parts || []).find((part: any) => Number(part.partNumber) === params.partNumber);
    const recentlyAuthorized = existing?.authorizedAt && Date.now() - new Date(existing.authorizedAt).getTime() < 10 * 60_000;
    if (!existing?.completedAt && !recentlyAuthorized) {
      if (!(await consumeWorkspaceByteBudget(deps, resolved.session, sizeBytes, reply))) return;
    }
    try {
      return { ok: true, ...(await authorizeDirectPart(deps, resolved.session, params.partNumber)) };
    } catch (error) {
      return sendUploadError(reply, error, "Unable to authorize direct upload part.");
    }
  });

  app.post("/api/uploads/:uploadId/parts/:partNumber/complete", async (request, reply) => {
    const params = z.object({
      uploadId: z.string().uuid(),
      partNumber: z.coerce.number().int().min(1).max(10_000),
    }).parse(request.params);
    const body = z.object({
      etag: z.string().trim().min(1).max(256),
      sizeBytes: z.number().int().nonnegative(),
    }).parse(request.body || {});
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    try {
      return await acknowledgeDirectPart(deps, resolved.session, {
        partNumber: params.partNumber,
        sizeBytes: body.sizeBytes,
        etag: body.etag,
      });
    } catch (error) {
      return sendUploadError(reply, error, "Unable to record direct upload part.");
    }
  });

  app.post("/api/uploads/:uploadId/pause", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    try {
      const session = await pauseUploadSession(deps, params.uploadId, resolved.user.id, Boolean(resolved.user.isAdmin));
      return session ? serializeUploadSession(session) : reply.code(404).send({ code: "UPLOAD_NOT_FOUND", message: "Upload session was not found." });
    } catch (error) { return sendUploadError(reply, error, "Unable to pause upload."); }
  });

  app.post("/api/uploads/:uploadId/resume", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    try {
      const session = await resumeUploadSession(deps, params.uploadId, resolved.user.id, Boolean(resolved.user.isAdmin));
      return session ? serializeUploadSession(session) : reply.code(404).send({ code: "UPLOAD_NOT_FOUND", message: "Upload session was not found." });
    } catch (error) { return sendUploadError(reply, error, "Unable to resume upload."); }
  });

  app.post("/api/uploads/:uploadId/complete", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const body = z.object({ checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).parse(request.body || {});
    const resolved = await requireOwner(request, reply, deps, params.uploadId);
    if (!resolved) return;
    try {
      return await completeUploadSession(deps, resolved.session, body.checksumSha256 || null);
    } catch (error) {
      return sendUploadError(reply, error, "Unable to complete upload.");
    }
  });

  app.delete("/api/uploads/:uploadId", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    await abortUploadSession(deps, params.uploadId, user.id, Boolean(user.isAdmin));
    reply.code(204).send();
  });

  app.get("/api/uploads/:uploadId/file", async (request, reply) => {
    const params = z.object({ uploadId: z.string().uuid() }).parse(request.params);
    const user = await deps.getCurrentUser(request);
    if (!user) return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authentication required." });
    const upload = await resolveCompletedUpload(deps, params.uploadId, user.id, Boolean(user.isAdmin));
    if (!upload) return reply.code(404).send({ code: "UPLOAD_FILE_MISSING", message: "Completed upload is unavailable." });
    const common = {
      mimeType: "application/octet-stream",
      originalName: upload.metadata.fileName,
      checksumSha256: upload.metadata.checksumSha256 || null,
      requestedInline: false,
      cacheControl: "private, max-age=0, must-revalidate",
      knownStat: upload.resourceStat,
    };
    // Range/If-Range/ETag/HEAD handling is centralized with Library resource
    // delivery. The uploader owns permission checks and verified storage
    // identity; HTTP streaming stays zero-copy at the application layer.
    if (upload.filePath) return sendStoredResource(request, reply, { ...common, filePath: upload.filePath });
    if (upload.storage) return sendStorageResource(request, reply, {
      ...common,
      storage: deps.storageRuntime,
      locator: upload.storage,
    });
    return reply.code(503).send({ code: "UPLOAD_STORAGE_UNAVAILABLE", message: "Completed upload storage is unavailable." });
  });
}

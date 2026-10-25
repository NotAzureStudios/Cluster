import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { currentReliabilityContext } from "./reliability-context.js";

const HEADER_NAME = "x-cluster-idempotency-key";
const MAX_KEY_LENGTH = 128;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_PROCESSING_MS = 60 * 60 * 1000;

type PrismaLike = {
  apiMutationReceipt: {
    create(args: unknown): Promise<any>;
    findFirst(args: unknown): Promise<any>;
    updateMany(args: unknown): Promise<any>;
    deleteMany(args: unknown): Promise<any>;
  };
};

type AuthenticatedRequest = FastifyRequest & {
  clusterUser?: { id?: string | null } | null;
};

type RequestIdentity = {
  userId: string;
  method: string;
  path: string;
  idempotencyKey: string;
  fingerprint: string;
};

type RequestClaim = RequestIdentity & { receiptId: string };

function mutationMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalRequestTarget(request: FastifyRequest) {
  const raw = String(request.url || "/");
  const [pathname, query = ""] = raw.split("?", 2);
  if (!query) return pathname || "/";
  const params = new URLSearchParams(query);
  const pairs = [...params.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const normalized = new URLSearchParams();
  for (const [key, value] of pairs) normalized.append(key, value);
  return `${pathname || "/"}?${normalized.toString()}`;
}

function requestPath(request: FastifyRequest) {
  return String(request.url || "/").split("?")[0] || "/";
}

/**
 * Step-up protected endpoints must execute authentication on every request.
 * A cached receipt would bypass a single-use grant and could persist a secret
 * response in ApiMutationReceipt. No idempotency replay is permitted there.
 */
export function isSensitiveMutationPath(path: string) {
  return path === "/api/context-packs/from-settings-with-secrets" ||
    // Private high-frequency respondent autosaves already use revision CAS and
    // serializable transactions. Do not accumulate opaque/uncertain mutation
    // receipts for sensitive draft writes that intentionally use no-store.
    /^\/api\/forms\/[^/]+\/draft$/.test(path) ||
    // Restricted share URLs are one-time bearer secrets. Never persist their
    // full creation response in the general mutation-receipt replay table.
    /^\/api\/projects\/[^/]+\/share-links(?:\/|$)/.test(path) ||
    /^\/api\/context-packs\/[^/]+\/(?:secret-export|apply)$/.test(path) ||
    /^\/api\/(?:security|privacy)\/[^/]*export(?:\/|$)/.test(path);
}

function idempotencyEligible(request: FastifyRequest) {
  if (!mutationMethod(request.method)) return false;
  const path = requestPath(request);
  return path.startsWith("/api/") &&
    !isSensitiveMutationPath(path) &&
    !path.startsWith("/api/auth/") &&
    !path.startsWith("/api/public/") &&
    !path.includes("/security/pin") &&
    !path.includes("/password");
}

function rawIdempotencyKey(request: FastifyRequest) {
  const raw = request.headers[HEADER_NAME];
  return String(Array.isArray(raw) ? raw[0] : raw || "").trim();
}

function validIdempotencyKey(key: string) {
  return key.length >= 8 && key.length <= MAX_KEY_LENGTH && /^[a-zA-Z0-9._:-]+$/.test(key);
}

function requestFingerprint(request: FastifyRequest) {
  const serialized = canonicalJson({
    method: request.method.toUpperCase(),
    target: canonicalRequestTarget(request),
    body: request.body ?? null,
  });
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function requestIdentity(request: FastifyRequest): RequestIdentity | null {
  if (!idempotencyEligible(request)) return null;
  const userId = String((request as AuthenticatedRequest).clusterUser?.id || "").trim();
  const idempotencyKey = rawIdempotencyKey(request);
  if (!userId || !idempotencyKey || !validIdempotencyKey(idempotencyKey)) return null;
  return {
    userId,
    method: request.method.toUpperCase(),
    path: requestPath(request),
    idempotencyKey,
    fingerprint: requestFingerprint(request),
  };
}

function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && String((error as { code?: unknown }).code || "") === "P2002");
}

function responsePayload(payload: unknown): { replayable: boolean; value: unknown } {
  if (payload === undefined || payload === null) return { replayable: true, value: null };
  let text: string;
  if (typeof payload === "string") text = payload;
  else if (Buffer.isBuffer(payload)) text = (payload as any).toString("utf8");
  else return { replayable: false, value: null };
  if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) return { replayable: false, value: null };
  try { return { replayable: true, value: JSON.parse(text) }; } catch { return { replayable: true, value: text }; }
}

function storedResponse(payload: string | null | undefined) {
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return payload; }
}

export function registerIdempotencyHooks(app: FastifyInstance, prisma: PrismaLike) {
  const claims = new WeakMap<FastifyRequest, RequestClaim>();

  app.addHook("preHandler", async (request, reply) => {
    if (reply.sent || !idempotencyEligible(request)) return;
    const supplied = rawIdempotencyKey(request);
    if (supplied && !validIdempotencyKey(supplied)) {
      return reply.code(400).send({
        ok: false,
        code: "IDEMPOTENCY_KEY_INVALID",
        error: "X-Cluster-Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen.",
      });
    }
    const identity = requestIdentity(request);
    if (!identity) return;

    try {
      const reliability = currentReliabilityContext();
      const receipt = await prisma.apiMutationReceipt.create({
        data: {
          userId: identity.userId,
          method: identity.method,
          path: identity.path,
          idempotencyKey: identity.idempotencyKey,
          requestFingerprint: identity.fingerprint,
          workspaceId: reliability?.workspaceId || null,
          correlationId: reliability?.correlationId || String(request.id),
          state: "processing",
          requestId: String(request.id),
        },
      });
      claims.set(request, { ...identity, receiptId: String(receipt.id) });
      reply.header("X-Cluster-Idempotency-Key", identity.idempotencyKey);
      return;
    } catch (error) {
      if (!isUniqueConflict(error)) {
        request.log.error({ err: error }, "idempotency claim failed");
        return reply.code(503).send({
          ok: false,
          code: "IDEMPOTENCY_UNAVAILABLE",
          error: "Cluster could not safely reserve this mutation request.",
          action: "Retry shortly with the same idempotency key.",
          retryable: true,
        });
      }
    }

    const existing = await prisma.apiMutationReceipt.findFirst({
      where: {
        userId: identity.userId,
        method: identity.method,
        path: identity.path,
        idempotencyKey: identity.idempotencyKey,
      },
    });
    if (!existing) {
      return reply.code(503).send({ ok: false, code: "IDEMPOTENCY_UNAVAILABLE", error: "Cluster could not resolve the reserved mutation request.", retryable: true });
    }
    if (String(existing.requestFingerprint || "") !== identity.fingerprint) {
      return reply.code(409).send({
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSED",
        error: "This idempotency key was already used for a different request.",
        action: "Generate a new idempotency key for a different mutation.",
        retryable: false,
      });
    }
    reply.header("X-Cluster-Idempotency-Key", identity.idempotencyKey);
    if (existing.correlationId) reply.header("X-Cluster-Original-Correlation-Id", String(existing.correlationId));
    if (existing.state === "complete" && existing.responsePayload !== null && existing.responsePayload !== undefined) {
      reply.header("X-Cluster-Idempotency-Replayed", "true");
      return reply.code(Number(existing.statusCode || 200)).send(storedResponse(existing.responsePayload));
    }
    if (existing.state === "processing") {
      reply.header("Retry-After", "1");
      return reply.code(409).send({
        ok: false,
        code: "IDEMPOTENCY_IN_PROGRESS",
        error: "An identical mutation with this idempotency key is already in progress.",
        action: "Wait briefly and retry with the same idempotency key.",
        retryable: true,
      });
    }
    return reply.code(409).send({
      ok: false,
      code: "IDEMPOTENCY_RESULT_UNKNOWN",
      error: "Cluster cannot prove whether the earlier mutation completed.",
      action: "Refresh the affected resource before deciding whether to submit a new mutation with a new key.",
      retryable: false,
      originalRequestId: existing.requestId || null,
    });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const claim = claims.get(request);
    if (!claim || reply.getHeader("X-Cluster-Idempotency-Replayed")) return payload;
    // Defense in depth: a private/no-store response must never be serialized
    // into a persistent idempotency receipt, including on an overlooked route.
    const noStore = /(?:^|,)\s*no-store(?:\s*,|\s*$)/i.test(String(reply.getHeader("Cache-Control") || ""));
    const body = noStore ? { replayable: false, value: null } : responsePayload(payload);
    const safeToReplay = reply.statusCode < 500 && body.replayable;
    try {
      await prisma.apiMutationReceipt.updateMany({
        where: { id: claim.receiptId, state: "processing", requestFingerprint: claim.fingerprint },
        data: safeToReplay ? {
          state: "complete",
          statusCode: reply.statusCode,
          responsePayload: JSON.stringify(body.value),
          completedAt: new Date(),
          failureReason: null,
        } : {
          state: "uncertain",
          statusCode: reply.statusCode,
          completedAt: new Date(),
          failureReason: noStore ? "private-response-not-stored" : !body.replayable ? "response-too-large-or-nonreplayable" : "server-error-response",
        },
      });
    } catch (error) {
      request.log.error({ err: error, receiptId: claim.receiptId }, "idempotency receipt finalization failed");
    }
    return payload;
  });

  app.addHook("onError", async (request, _reply, error) => {
    const claim = claims.get(request);
    if (!claim) return;
    await prisma.apiMutationReceipt.updateMany({
      where: { id: claim.receiptId, state: "processing" },
      data: { state: "uncertain", failureReason: String(error?.message || "request-error").slice(0, 500), completedAt: new Date() },
    }).catch((storageError: unknown) => request.log.error({ err: storageError, receiptId: claim.receiptId }, "idempotency error-state write failed"));
  });

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const retentionCutoff = new Date(Date.now() - RETENTION_MS);
  void prisma.apiMutationReceipt.updateMany({
    where: { state: "processing", updatedAt: { lt: staleCutoff } },
    data: { state: "uncertain", failureReason: "stale-processing-claim", completedAt: new Date() },
  }).catch((error: unknown) => app.log.warn({ err: error }, "stale idempotency claim recovery failed"));
  void prisma.apiMutationReceipt.deleteMany({
    where: { state: { in: ["complete", "uncertain"] }, completedAt: { lt: retentionCutoff } },
  }).catch((error: unknown) => app.log.warn({ err: error }, "idempotency receipt cleanup failed"));
}

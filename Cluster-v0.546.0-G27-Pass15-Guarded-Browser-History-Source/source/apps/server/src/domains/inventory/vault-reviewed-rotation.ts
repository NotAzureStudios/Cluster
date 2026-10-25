// G26 consolidated closeout: independent approval before standalone Vault replacement.
// Approval persists policy/actor evidence ONLY; replacement plaintext exists solely in
// the final HTTPS request and encrypted storage. A review is not a third-party revocation.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clusterSecretFingerprint } from "../../core/crypto-service.js";
import { encryptSecuritySecret, encryptionKeyConfigured } from "../../core/setting-crypto.js";

const requestInput = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().trim().min(12).max(1000) }).strict();
const decisionInput = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(8).max(1000) }).strict();
const commitInput = z.object({ value: z.string().min(1).max(16_384), expectedRevision: z.number().int().positive(),
  // This is an operator's declaration, never evidence of upstream provider state.
  externalStatus: z.enum(["updated_by_operator", "not_applicable", "pending_external_update"]),
  externalNote: z.string().trim().min(12).max(1000),
}).strict();
const idInput = z.object({ id: z.string().min(1).max(160) }).strict();
const MS_DAY = 86_400_000;
const REVIEW_LIMIT = 100;
const publicSelect = { id: true, secretId: true, expectedRevision: true, requestedById: true,
  reviewedById: true, status: true, reason: true, reviewReason: true, externalStatus: true,
  externalNote: true, expiresAt: true, requestedAt: true, reviewedAt: true, completedAt: true } as const;

export function vaultRotationDecision(input: {
  status: string; requesterId: string; actorId: string; expectedRevision: number;
  currentRevision: number; revokedAt: Date | null; expiresAt: Date; now: Date;
}, phase: "review" | "commit") {
  if (input.revokedAt || input.currentRevision !== input.expectedRevision) return "VAULT_ROTATION_STALE";
  if (input.expiresAt <= input.now) return "VAULT_ROTATION_EXPIRED";
  if (phase === "review") {
    if (input.status !== "pending") return "VAULT_REVIEW_ALREADY_RESOLVED";
    if (input.requesterId === input.actorId) return "INDEPENDENT_REVIEW_REQUIRED";
  } else {
    if (input.status !== "approved") return "VAULT_ROTATION_NOT_APPROVED";
    if (input.requesterId !== input.actorId) return "ROTATION_REQUESTER_REQUIRED";
  }
  return null;
}

export function registerVaultReviewedRotationRoutes(deps: {
  app: any; prisma: any; admin: (request: any, reply: any) => Promise<any>;
  requireConfirmation: (request: any, reply: any, confirmation: string) => boolean;
  recordSecurityInTransaction: (tx: any, input: any) => Promise<{ ok: true }>;
}) {
  const { app, prisma, admin, requireConfirmation, recordSecurityInTransaction } = deps;
  // A reviewed credential state change without durable audit evidence is not a
  // successful change. Fail the transaction rather than record the audit later.
  async function auditTransition(tx: any, request: any, actor: any, event: string, reviewId: string) {
    if (!recordSecurityInTransaction) throw Object.assign(new Error("Vault audit writer unavailable"), { code: "VAULT_AUDIT_UNAVAILABLE" });
    try {
      const evidence = await recordSecurityInTransaction(tx, {
        event, actorUserId: actor.id, targetUserId: null, result: "SUCCESS",
        reasonCode: "ADMIN_VAULT_REVIEW", requestId: request.id || null,
        requestMethod: "POST", requestPath: event === "vault.rotation_requested"
          ? "/api/admin/vault/secrets/:id/rotation-requests"
          : event === "vault.rotation_completed" ? "/api/admin/vault/rotation-reviews/:id/commit"
          : "/api/admin/vault/rotation-reviews/:id/decision",
        metadata: { reviewId },
      });
      if (evidence?.ok !== true) throw new Error("Security audit not confirmed");
    } catch {
      throw Object.assign(new Error("Vault audit persistence failed"), { code: "VAULT_AUDIT_UNAVAILABLE" });
    }
  }
  async function reviewedTransaction(run: (tx: any) => Promise<any>) {
    try { return await prisma.$transaction(run); }
    catch (error: any) {
      if (error?.code === "VAULT_AUDIT_UNAVAILABLE") return { code: "VAULT_AUDIT_UNAVAILABLE", status: 503 };
      throw error;
    }
  }
  const failure = (reply: any, code: string, status = 409) => reply.code(status).send({ ok: false, code });
  const lockSecret = async (tx: any, secretId: string) => {
    const rows = await tx.$queryRaw`SELECT "id" FROM "StudioVaultSecret" WHERE "id" = ${secretId} FOR UPDATE`;
    if (!rows.length) return null;
    return tx.studioVaultSecret.findUnique({ where: { id: secretId }, select: { id: true, revision: true, revokedAt: true } });
  };
  const unbound = async (tx: any, secretId: string) => !(await tx.studioInventoryKey.findUnique({ where: { vaultSecretId: secretId }, select: { id: true } }));

  app.get("/api/admin/vault/rotation-reviews", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const query = z.object({ status: z.enum(["pending", "approved", "rejected", "completed", "expired", "all"]).default("all") }).parse(request.query || {});
    const reviews = await prisma.studioVaultRotationReview.findMany({
      where: query.status === "all" ? {} : { status: query.status }, select: publicSelect,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: REVIEW_LIMIT + 1,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, reviews: reviews.slice(0, REVIEW_LIMIT), truncated: reviews.length > REVIEW_LIMIT, containsSecrets: false };
  });

  app.post("/api/admin/vault/secrets/:id/rotation-requests", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REQUEST VAULT ROTATION")) return;
    const { id } = idInput.parse(request.params);
    const body = requestInput.parse(request.body || {});
    const now = new Date();
    const result = await reviewedTransaction(async (tx: any) => {
      const secret = await lockSecret(tx, id);
      if (!secret || secret.revokedAt) return { code: "SECRET_UNAVAILABLE" };
      if (!(await unbound(tx, id))) return { code: "INVENTORY_KEYS_USE_POOL_LIFECYCLE" };
      if (secret.revision !== body.expectedRevision) return { code: "VAULT_REVISION_CONFLICT" };
      const active = await tx.studioVaultRotationReview.findMany({ where: { secretId: id,
        status: { in: ["pending", "approved"] }, expiresAt: { gt: now } }, select: { id: true }, take: 1 });
      if (active.length) return { code: "VAULT_ROTATION_ALREADY_OPEN" };
      const review = await tx.studioVaultRotationReview.create({ data: { id: randomUUID(), secretId: id,
        expectedRevision: body.expectedRevision, requestedById: actor.id, reason: body.reason,
        status: "pending", expiresAt: new Date(now.getTime() + MS_DAY) }, select: publicSelect });
      await auditTransition(tx, request, actor, "vault.rotation_requested", review.id);
      return { review };
    });
    if ("code" in result) return failure(reply, result.code, result.status);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, review: result.review });
  });

  app.post("/api/admin/vault/rotation-reviews/:id/decision", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVIEW VAULT ROTATION")) return;
    const { id } = idInput.parse(request.params);
    const body = decisionInput.parse(request.body || {});
    const result = await reviewedTransaction(async (tx: any) => {
      const found = await tx.studioVaultRotationReview.findUnique({ where: { id }, select: { secretId: true } });
      if (!found) return { code: "VAULT_REVIEW_NOT_FOUND" };
      const secret = await lockSecret(tx, found.secretId); // uniform lock order: secret then review
      const locks = await tx.$queryRaw`SELECT "id" FROM "StudioVaultRotationReview" WHERE "id" = ${id} FOR UPDATE`;
      if (!locks.length || !secret) return { code: "VAULT_REVIEW_NOT_FOUND" };
      const review = await tx.studioVaultRotationReview.findUnique({ where: { id } });
      if (!review || review.secretId !== found.secretId) return { code: "VAULT_REVIEW_STALE" };
      if (!(await unbound(tx, review.secretId))) return { code: "INVENTORY_KEYS_USE_POOL_LIFECYCLE" };
      const denied = vaultRotationDecision({ status: review.status, requesterId: review.requestedById,
        actorId: actor.id, expectedRevision: review.expectedRevision, currentRevision: secret.revision,
        revokedAt: secret.revokedAt, expiresAt: review.expiresAt, now: new Date() }, "review");
      if (denied) return { code: denied };
      const changed = await tx.studioVaultRotationReview.updateMany({ where: { id, status: "pending" },
        data: { status: body.decision === "approve" ? "approved" : "rejected", reviewedById: actor.id,
          reviewedAt: new Date(), reviewReason: body.reason } });
      if (!changed.count) return { code: "VAULT_REVIEW_STALE" };
      await auditTransition(tx, request, actor, body.decision === "approve" ? "vault.rotation_approved" : "vault.rotation_rejected", id);
      return { review: await tx.studioVaultRotationReview.findUnique({ where: { id }, select: publicSelect }) };
    });
    if ("code" in result) return failure(reply, result.code, result.status);
    reply.header("Cache-Control", "no-store");
    return { ok: true, review: result.review };
  });

  app.post("/api/admin/vault/rotation-reviews/:id/commit", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "ROTATE VAULT SECRET")) return;
    if (!encryptionKeyConfigured()) return failure(reply, "VAULT_KEY_UNAVAILABLE", 503);
    const { id } = idInput.parse(request.params);
    const body = commitInput.parse(request.body || {});
    const result = await reviewedTransaction(async (tx: any) => {
      const found = await tx.studioVaultRotationReview.findUnique({ where: { id }, select: { secretId: true } });
      if (!found) return { code: "VAULT_REVIEW_NOT_FOUND" };
      const secret = await lockSecret(tx, found.secretId);
      const locks = await tx.$queryRaw`SELECT "id" FROM "StudioVaultRotationReview" WHERE "id" = ${id} FOR UPDATE`;
      if (!locks.length || !secret) return { code: "VAULT_REVIEW_NOT_FOUND" };
      const review = await tx.studioVaultRotationReview.findUnique({ where: { id } });
      if (!review || review.secretId !== found.secretId) return { code: "VAULT_REVIEW_STALE" };
      if (!(await unbound(tx, found.secretId))) return { code: "INVENTORY_KEYS_USE_POOL_LIFECYCLE" };
      const denied = vaultRotationDecision({ status: review.status, requesterId: review.requestedById,
        actorId: actor.id, expectedRevision: review.expectedRevision, currentRevision: secret.revision,
        revokedAt: secret.revokedAt, expiresAt: review.expiresAt, now: new Date() }, "commit");
      if (denied || body.expectedRevision !== review.expectedRevision) return { code: denied || "VAULT_REVISION_CONFLICT" };
      // Guard accidental same-value 'rotation'. Never return or log any credential material.
      const fingerprint = clusterSecretFingerprint(body.value, `vault:record:${found.secretId}`);
      const before = await tx.studioVaultSecret.findUnique({ where: { id: found.secretId }, select: { fingerprint: true } });
      if (before?.fingerprint === fingerprint) return { code: "VAULT_REPLACEMENT_UNCHANGED" };
      const changed = await tx.studioVaultSecret.updateMany({ where: { id: found.secretId, revision: review.expectedRevision, revokedAt: null },
        data: { encryptedValue: encryptSecuritySecret(`vault:record:${found.secretId}`, body.value), fingerprint, revision: { increment: 1 } } });
      if (!changed.count) return { code: "VAULT_REVISION_CONFLICT" };
      await tx.studioVaultRotationReview.update({ where: { id }, data: { status: "completed", completedAt: new Date(),
        externalStatus: body.externalStatus, externalNote: body.externalNote } });
      await auditTransition(tx, request, actor, "vault.rotation_completed", id);
      return { secretId: found.secretId };
    });
    if ("code" in result) return failure(reply, result.code, result.status);
    reply.header("Cache-Control", "no-store");
    return { ok: true, reviewId: id, status: "completed", externalProviderIndependentlyVerified: false };
  });
}

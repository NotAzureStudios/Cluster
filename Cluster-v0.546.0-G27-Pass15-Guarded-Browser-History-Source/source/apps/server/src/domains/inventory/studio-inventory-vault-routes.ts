import { registerStudioInventoryApprovalRoutes } from "./studio-inventory-approvals.js";
import { registerInventoryKeyReadinessRoutes } from "./inventory-key-readiness.js";
import { registerVaultReviewedRotationRoutes } from "./vault-reviewed-rotation.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clusterSecretFingerprint } from "../../core/crypto-service.js";
import { decryptSecuritySecret, encryptSecuritySecret, encryptionKeyConfigured } from "../../core/setting-crypto.js";

// Inventory is the authority for assets and allocations. Vault is the authority for secret material.
// No endpoint in this module embeds Vault values inside an Inventory or directory response.
const assetInput = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(["physical", "digital", "license", "equipment"]),
  provider: z.string().trim().max(160).nullable().optional(),
  reference: z.string().trim().max(160).nullable().optional(),
  capacity: z.number().int().min(1).max(1_000_000).default(1),
}).strict();
const assetEditInput = assetInput.extend({ expectedRevision: z.number().int().positive() }).strict();
const assetLifecycleInput = z.object({ expectedRevision: z.number().int().positive(), status: z.enum(["active", "retired"]) }).strict();
const equipmentDispositionInput = z.object({ disposition: z.enum(["returned", "written_off"]), reason: z.string().trim().min(3).max(1000) }).strict();
const transferInput = z.object({ toUserId: z.string().trim().min(1).max(160), reason: z.string().trim().max(1000).default("") }).strict();
const allocationInput = z.object({
  userId: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(1_000_000).default(1),
  reason: z.string().trim().max(1000).default(""),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
const secretInput = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["game_key", "license_key", "integration", "password", "other"]),
  value: z.string().min(1).max(16_384),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
const secretMetadataUpdate = z.object({ name: z.string().trim().min(1).max(160), kind: z.enum(["game_key", "license_key", "integration", "password", "other"]), expiresAt: z.string().datetime().nullable(), expectedRevision: z.number().int().positive() }).strict();
const keyPoolInput = z.object({ title: z.string().trim().min(1).max(160), kind: z.enum(["game_key", "license_key"]), provider: z.string().trim().max(160).nullable().optional() }).strict();
const keyImportInput = z.object({ expectedRevision: z.number().int().positive(), values: z.array(z.string().trim().min(1).max(256)).min(1).max(100) }).strict();
const keyDecisionInput = z.object({ expectedRevision: z.number().int().positive(), decision: z.enum(["redeemed", "revoked"]), reason: z.string().trim().min(3).max(1000) }).strict();
const keyRevealInput = z.object({ expectedRevision: z.number().int().positive() }).strict();
const recipientKeyRevealInput = keyRevealInput.extend({ pin: z.string().min(4).max(8) }).strict();
const keyPoolLifecycle = z.object({ expectedRevision: z.number().int().positive(), status: z.enum(["active", "closed"]) }).strict();
const keyPoolSelect = { id: true, title: true, provider: true, kind: true, status: true, revision: true, createdAt: true, updatedAt: true, _count: { select: { keys: true } } } as const;
const keyPublicSelect = { id: true, poolId: true, status: true, userId: true, assignedById: true, assignedAt: true, expiresAt: true, firstRevealedAt: true, closedAt: true, closedReason: true, revision: true, createdAt: true } as const;
export function inventoryKeyFingerprint(poolId: string, value: string) { return clusterSecretFingerprint(value, `inventory:key-pool:${poolId}`); }
const paramsId = z.object({ id: z.string().min(1).max(160) });

const assetPublicSelect = { id: true, title: true, kind: true, provider: true, reference: true, capacity: true, status: true, revision: true, createdById: true, createdAt: true, updatedAt: true } as const;
const vaultPublicSelect = { id: true, name: true, kind: true, fingerprint: true, createdById: true, expiresAt: true, revokedAt: true, revision: true, createdAt: true, updatedAt: true } as const;
export function vaultEncryptionPurpose(id: string) { return `vault:record:${id}`; }

export function assertInventoryCapacity(capacity: number, allocated: number, requested: number) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || !Number.isSafeInteger(allocated) || allocated < 0 || !Number.isSafeInteger(requested) || requested <= 0 || allocated + requested > capacity)
    return false;
  return true;
}

export function inventoryDigitalKind(kind: string) { return kind === "digital" || kind === "license"; }
export function inventoryLeaseDeadline(value: string | null | undefined, now: Date, recipientExpiresAt?: Date | string | null): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const expiresAt = new Date(value);
  const max = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt > max || (recipientExpiresAt && expiresAt > new Date(recipientExpiresAt)))
    throw Object.assign(new Error("Lease must expire within 180 days and before recipient access expires."), { code: "INVALID_INVENTORY_LEASE", statusCode: 409 });
  return expiresAt;
}
export const effectiveDigitalAllocations = (now: Date) => ({ status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

export function registerStudioInventoryVaultRoutes(deps: any) {
  const { app, prisma, authorization, requireConfirmation, logSecurityEvent, getCurrentUser, verifyUserPin, auditService } = deps;
  async function admin(request: any, reply: any) { return authorization.requireAdmin(request, reply); }
  registerInventoryKeyReadinessRoutes({ app, prisma, admin });
  async function audit(request: any, actor: any, event: string, id: string) {
    await logSecurityEvent({ event, actorUserId: actor.id, targetUserId: null, result: "SUCCESS", reasonCode: "ADMIN_INVENTORY_VAULT", request, metadata: { id } });
  }
  // Generic security logging may record a write failure without throwing. That
  // contract is appropriate for telemetry, NEVER for an endpoint disclosing a
  // credential. A persisted audit event is a mandatory disclosure precondition.
  async function auditDisclosure(request: any, actorId: string, event: string, targetId: string, recipientId?: string) {
    if (!auditService?.recordSecurity) return false;
    try {
      const evidence = await auditService.recordSecurity({
        event, actorUserId: actorId, targetUserId: recipientId || null,
        result: "SUCCESS", reasonCode: recipientId ? "SELF_SERVICE_INVENTORY" : "ADMIN_INVENTORY_VAULT",
        requestId: request.id || null, requestMethod: "POST",
        requestPath: event === "vault.secret_revealed" ? "/api/admin/vault/secrets/:id/reveal" :
          recipientId ? "/api/me/inventory/keys/:id/reveal" : "/api/admin/inventory/key-pools/:id/keys/:keyId/reveal",
        metadata: event === "vault.secret_revealed" ? { secretId: targetId } : { keyId: targetId },
      });
      return evidence?.ok === true;
    } catch { return false; }
  }

  // Vault state and tamper-evident audit history are one commit boundary.
  // Unlike ordinary telemetry, a missing audit writer is a hard failure.
  async function vaultMutationAudit(tx: any, request: any, actor: any, event: string, id: string) {
    if (!auditService?.recordSecurityInTransaction)
      throw Object.assign(new Error("Vault security audit unavailable"), { code: "VAULT_AUDIT_UNAVAILABLE" });
    try {
      const persisted = await auditService.recordSecurityInTransaction(tx, {
        event, actorUserId: actor.id, targetUserId: null, result: "SUCCESS",
        reasonCode: "ADMIN_INVENTORY_VAULT", requestId: request.id || null,
        requestMethod: event === "vault.secret_metadata_updated" ? "PATCH" : "POST",
        requestPath: event === "vault.secret_created" ? "/api/admin/vault/secrets"
          : event === "vault.secret_metadata_updated" ? "/api/admin/vault/secrets/:id"
          : "/api/admin/vault/secrets/:id/revoke",
        metadata: { secretId: id },
      });
      if (persisted?.ok !== true) throw new Error("Vault audit persistence not confirmed");
    } catch {
      throw Object.assign(new Error("Vault audit persistence failed"), { code: "VAULT_AUDIT_UNAVAILABLE" });
    }
  }
  async function guardedVaultMutation(run: (tx: any) => Promise<any>) {
    try { return await prisma.$transaction(run); }
    catch (error: any) {
      if (error?.code === "VAULT_AUDIT_UNAVAILABLE") return { code: "VAULT_AUDIT_UNAVAILABLE", status: 503 };
      throw error;
    }
  }

  // The audit can take time. Reauthorize again AFTER the write, and read fresh
  // ciphertext rather than return a secret loaded before a concurrent revoke.
  async function currentKeyDisclosure(db: any, keyId: string, poolId: string, revision: number, userId?: string) {
    const key = await db.studioInventoryKey.findFirst({ where: {
      id: keyId, poolId, status: "assigned", revision, ...(userId ? { userId } : {}),
    }, select: { userId: true, vaultSecretId: true, expiresAt: true, pool: { select: { status: true } } } });
    if (!key?.userId || key.pool?.status !== "active" || (key.expiresAt && new Date(key.expiresAt) <= new Date())) return null;
    if (!(await eligibleRecipient(db, key.userId))) return null;
    const secret = await db.studioVaultSecret.findUnique({ where: { id: key.vaultSecretId },
      select: { encryptedValue: true, revokedAt: true, expiresAt: true } });
    if (!secret || secret.revokedAt || (secret.expiresAt && new Date(secret.expiresAt) <= new Date())) return null;
    return { key, secret };
  }

  async function eligibleRecipient(tx: any, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, accountState: true, archived: true, accessExpiresAt: true } });
    return Boolean(user && !user.archived && user.accountState === "ACTIVE" && (!user.accessExpiresAt || new Date(user.accessExpiresAt).getTime() > Date.now()));
  }

  async function recipientDeadline(tx: any, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { accountState: true, archived: true, accessExpiresAt: true } });
    if (!user || user.archived || user.accountState !== "ACTIVE" || (user.accessExpiresAt && new Date(user.accessExpiresAt) <= new Date())) return { eligible: false, deadline: null };
    return { eligible: true, deadline: user.accessExpiresAt };
  }
  // Caller MUST hold StudioInventoryAsset FOR UPDATE. Closed leases remain in audit history.
  async function expireDigitalSeats(tx: any, assetId: string, kind: string, now: Date) {
    if (!inventoryDigitalKind(kind)) return 0;
    const closed = await tx.studioInventoryAllocation.updateMany({
      where: { assetId, status: "active", expiresAt: { lte: now } },
      data: { status: "expired", revokedAt: now, closedReason: "Digital seat lease expired", revision: { increment: 1 } },
    });
    return closed.count;
  }

  // Studio-level, on-demand governance overview. Counts are authoritative; there
  // is no periodic browser poll and no secret-bearing key or Vault projection.
  app.get("/api/admin/inventory/attention", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const digital = { status: "active", asset: { kind: { in: ["digital", "license"] } } };
    const [digitalSeatsExpiring, digitalSeatsPastDue, physicalCustodyOpen, keysExpiring, keysPastDue, vaultExpiring, vaultPastDue] = await Promise.all([
      prisma.studioInventoryAllocation.count({ where: { ...digital, expiresAt: { gt: now, lte: soon } } }),
      prisma.studioInventoryAllocation.count({ where: { ...digital, expiresAt: { lte: now } } }),
      prisma.studioInventoryAllocation.count({ where: { status: "active", asset: { kind: { in: ["physical", "equipment"] } } } }),
      prisma.studioInventoryKey.count({ where: { status: "assigned", expiresAt: { gt: now, lte: soon } } }),
      prisma.studioInventoryKey.count({ where: { status: "assigned", expiresAt: { lte: now } } }),
      prisma.studioVaultSecret.count({ where: { revokedAt: null, expiresAt: { gt: now, lte: soon } } }),
      prisma.studioVaultSecret.count({ where: { revokedAt: null, expiresAt: { lte: now } } }),
    ]);
    return { ok: true, asOf: now.toISOString(), windowDays: 7, digitalSeatsExpiring, digitalSeatsPastDue, physicalCustodyOpen, keysExpiring, keysPastDue, vaultExpiring, vaultPastDue };
  });

  // Offboarding does not close physical custody. This drilldown is explicit,
  // bounded, secret-free, and can be reconciled via the usual disposition route.
  app.get("/api/admin/inventory/custody-outstanding", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const cases = await prisma.studioOffboardingCase.findMany({ where: { status: "completed", returnedAt: null }, select: { subjectUserId: true }, distinct: ["subjectUserId"], take: 501 });
    if (cases.length > 500) return reply.code(409).send({ ok: false, code: "INVENTORY_CUSTODY_SCOPE_LIMIT", error: "More than 500 offboarded people; narrow the scope before retrieving a complete custody report." });
    const ids = cases.map((item: any) => item.subjectUserId);
    const allocations = ids.length ? await prisma.studioInventoryAllocation.findMany({ where: { status: "active", userId: { in: ids }, asset: { kind: { in: ["physical", "equipment"] } } }, select: { id: true, assetId: true, userId: true, quantity: true, assignedAt: true, asset: { select: { title: true, kind: true } } }, orderBy: { assignedAt: "asc" }, take: 101 }) : [];
    return { ok: true, allocations: allocations.slice(0, 100), truncated: allocations.length > 100 };
  });

  app.get("/api/admin/inventory/assets", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const query = z.object({ cursor: z.string().trim().min(1).max(160).optional(), q: z.string().trim().max(160).optional() }).parse(request.query || {});
    const q = query.q || "";
    const rows = await prisma.studioInventoryAsset.findMany({
      where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { provider: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { kind: { contains: q, mode: "insensitive" } }] } : {},
      select: assetPublicSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: 101,
    });
    return { ok: true, assets: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
  });

  app.post("/api/admin/inventory/assets", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const body = assetInput.parse(request.body || {});
    const row = await prisma.studioInventoryAsset.create({ data: { ...body, createdById: actor.id }, select: assetPublicSelect });
    await audit(request, actor, "inventory.asset_created", row.id);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, asset: row });
  });

  // Updating an asset is version-qualified. Allocation capacity and state are
  // evaluated while holding the same row lock used by the allocation endpoint.
  app.patch("/api/admin/inventory/assets/:id", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = paramsId.parse(request.params);
    const body = assetEditInput.parse(request.body || {});
    const { expectedRevision, ...data } = body;
    const result = await prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) return { code: "ASSET_NOT_FOUND", status: 404 };
      const current = await tx.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
      if (!current || current.revision !== expectedRevision) return { code: "INVENTORY_REVISION_CONFLICT", status: 409 };
      await expireDigitalSeats(tx, id, current.kind, new Date());
      const occupied = await tx.studioInventoryAllocation.aggregate({ where: { assetId: id, status: "active" }, _sum: { quantity: true } });
      const activeSeats = Number(occupied._sum.quantity || 0);
      if (data.capacity < activeSeats) return { code: "CAPACITY_BELOW_ALLOCATED", status: 409 };
      if (current.kind !== data.kind && activeSeats) return { code: "KIND_CHANGE_WITH_ALLOCATIONS", status: 409 };
      const changed = await tx.studioInventoryAsset.updateMany({ where: { id, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } });
      if (!changed.count) return { code: "INVENTORY_REVISION_CONFLICT", status: 409 };
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
      return { asset };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, "inventory.asset_updated", id);
    reply.header("Cache-Control", "no-store");
    return { ok: true, asset: result.asset };
  });

  app.post("/api/admin/inventory/assets/:id/lifecycle", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "CHANGE INVENTORY LIFECYCLE")) return;
    const { id } = paramsId.parse(request.params);
    const body = assetLifecycleInput.parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) return { code: "ASSET_NOT_FOUND", status: 404 };
      const current = await tx.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
      if (!current || current.revision !== body.expectedRevision) return { code: "INVENTORY_REVISION_CONFLICT", status: 409 };
      if (current.status === body.status) return { code: "INVENTORY_ALREADY_IN_STATE", status: 409 };
      if (body.status === "retired") {
        await expireDigitalSeats(tx, id, current.kind, new Date());
        const active = await tx.studioInventoryAllocation.count({ where: { assetId: id, status: "active" } });
        if (active) return { code: "INVENTORY_ACTIVE_ALLOCATIONS", status: 409 };
      }
      const changed = await tx.studioInventoryAsset.updateMany({ where: { id, revision: body.expectedRevision }, data: { status: body.status, revision: { increment: 1 } } });
      if (!changed.count) return { code: "INVENTORY_REVISION_CONFLICT", status: 409 };
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
      return { asset };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, body.status === "retired" ? "inventory.asset_retired" : "inventory.asset_reactivated", id);
    reply.header("Cache-Control", "no-store");
    return { ok: true, asset: result.asset };
  });

  app.get("/api/admin/inventory/assets/:id/allocations", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id } = paramsId.parse(request.params);
    const asset = await prisma.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
    if (!asset) return reply.code(404).send({ ok: false, code: "ASSET_NOT_FOUND" });
    const query = z.object({ history: z.enum(["true", "false"]).optional() }).parse(request.query || {});
    const history = query.history === "true";
    const now = new Date();
    const activeWhere = inventoryDigitalKind(asset.kind) ? effectiveDigitalAllocations(now) : { status: "active" };
    const allocations = await prisma.studioInventoryAllocation.findMany({ where: { assetId: id, ...(history ? {} : activeWhere) }, select: { id: true, userId: true, quantity: true, reason: true, status: true, revision: true, expiresAt: true, assignedById: true, assignedAt: true, revokedAt: true, closedReason: true, closedById: true }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }], take: 500 });
    // History never drives capacity. It is only a bounded human audit projection.
    const occupied = await prisma.studioInventoryAllocation.aggregate({ where: { assetId: id, ...activeWhere }, _sum: { quantity: true } });
    reply.header("Cache-Control", "no-store");
    return { ok: true, asset, allocations, allocated: Number(occupied._sum.quantity || 0), history };
  });

  app.post("/api/admin/inventory/assets/:id/allocations", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = paramsId.parse(request.params);
    const body = allocationInput.parse(request.body || {});
    const kindForApproval = await prisma.studioInventoryAsset.findUnique({ where: { id }, select: { kind: true } });
    if (kindForApproval && inventoryDigitalKind(kindForApproval.kind)) return reply.code(409).send({ ok: false, code: "INVENTORY_REVIEW_REQUIRED", error: "Request a reviewed digital-seat entitlement in Inventory approvals." });
    // Serialise seat allocation by locking the owning asset before checking capacity.
    const result = await prisma.$transaction(async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${id} FOR UPDATE`;
      if (!rows.length) return { code: "ASSET_NOT_FOUND", status: 404 };
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id }, select: assetPublicSelect });
      if (!asset || asset.status !== "active") return { code: "ASSET_INACTIVE", status: 409 };
      if (inventoryDigitalKind(asset.kind)) return { code: "INVENTORY_REVIEW_REQUIRED", status: 409 };
      const recipient = await recipientDeadline(tx, body.userId);
      if (!recipient.eligible) return { code: "RECIPIENT_INACTIVE", status: 409 };
      if (!inventoryDigitalKind(asset.kind) && body.expiresAt) return { code: "PHYSICAL_CUSTODY_CANNOT_EXPIRE", status: 409 };
      const deadline = inventoryLeaseDeadline(body.expiresAt, new Date(), recipient.deadline);
      await expireDigitalSeats(tx, id, asset.kind, new Date());
      const existing = await tx.studioInventoryAllocation.findFirst({ where: { assetId: id, userId: body.userId, status: "active" }, select: { id: true } });
      if (existing) return { code: "ALLOCATION_EXISTS", status: 409 };
      const occupied = await tx.studioInventoryAllocation.aggregate({ where: { assetId: id, status: "active" }, _sum: { quantity: true } });
      if (!assertInventoryCapacity(asset.capacity, Number(occupied._sum.quantity || 0), body.quantity)) return { code: "NO_AVAILABLE_CAPACITY", status: 409 };
      const allocation = await tx.studioInventoryAllocation.create({ data: { assetId: id, userId: body.userId, quantity: body.quantity, reason: body.reason, assignedById: actor.id, expiresAt: deadline }, select: { id: true, assetId: true, userId: true, quantity: true, status: true, assignedAt: true } });
      return { allocation };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, "inventory.allocated", result.allocation!.id);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, allocation: result.allocation });
  });

  // No direct digital renewals: all extensions pass independent review.
  app.post("/api/admin/inventory/allocations/:id/renew", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    return reply.code(409).send({ ok: false, code: "INVENTORY_REVIEW_REQUIRED", error: "Request a reviewed seat extension through Inventory access reviews." });
  });

  app.post("/api/admin/inventory/allocations/:id/revoke", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVOKE ALLOCATION")) return;
    const { id } = paramsId.parse(request.params);
    const initial = await prisma.studioInventoryAllocation.findUnique({ where: { id }, select: { assetId: true } });
    if (!initial) return reply.code(404).send({ ok: false, code: "ALLOCATION_NOT_FOUND" });
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${initial.assetId} FOR UPDATE`;
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id: initial.assetId }, select: { kind: true } });
      if (!asset) return { code: "ASSET_NOT_FOUND", status: 404 };
      if (["physical", "equipment"].includes(asset.kind)) return { code: "EQUIPMENT_REQUIRES_DISPOSITION", status: 409 };
      const changed = await tx.studioInventoryAllocation.updateMany({ where: { id, assetId: initial.assetId, status: "active" }, data: { status: "revoked", revokedAt: new Date(), closedReason: "Administrative revocation", closedById: actor.id } });
      if (!changed.count) return { code: "ALLOCATION_NOT_ACTIVE", status: 409 };
      return { ok: true };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, "inventory.allocation_revoked", id);
    return { ok: true };
  });

  // Physical returns and write-offs record real custody disposition.
  // Revoking a license must never masquerade as the return of a laptop.
  app.post("/api/admin/inventory/allocations/:id/disposition", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "RECORD EQUIPMENT DISPOSITION")) return;
    const { id } = paramsId.parse(request.params);
    const body = equipmentDispositionInput.parse(request.body || {});
    const initial = await prisma.studioInventoryAllocation.findUnique({ where: { id }, select: { assetId: true } });
    if (!initial) return reply.code(404).send({ ok: false, code: "ALLOCATION_NOT_FOUND" });
    const result = await prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${initial.assetId} FOR UPDATE`;
      if (!locked.length) return { code: "ASSET_NOT_FOUND", status: 404 };
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id: initial.assetId }, select: { kind: true, capacity: true, revision: true, status: true } });
      if (!asset || !["physical", "equipment"].includes(asset.kind)) return { code: "NOT_PHYSICAL_EQUIPMENT", status: 409 };
      const allocation = await tx.studioInventoryAllocation.findUnique({ where: { id }, select: { quantity: true, status: true } });
      if (!allocation || allocation.status !== "active") return { code: "ALLOCATION_NOT_ACTIVE", status: 409 };
      let remainingCapacity = asset.capacity;
      if (body.disposition === "written_off") {
        remainingCapacity -= allocation.quantity;
        const active = await tx.studioInventoryAllocation.aggregate({ where: { assetId: initial.assetId, status: "active" }, _sum: { quantity: true } });
        if (remainingCapacity < Number(active._sum.quantity || 0) - allocation.quantity || remainingCapacity < 0)
          return { code: "DISPOSITION_CAPACITY_CONFLICT", status: 409 };
      }
      const changed = await tx.studioInventoryAllocation.updateMany({ where: { id, assetId: initial.assetId, status: "active" }, data: { status: body.disposition, revokedAt: new Date(), closedReason: body.reason, closedById: actor.id } });
      if (!changed.count) return { code: "ALLOCATION_NOT_ACTIVE", status: 409 };
      // Write-off must remove stock as well as close custody. The last lost unit
      // retires its asset instead of becoming falsely available for reissue.
      if (body.disposition === "written_off") {
        const updated = await tx.studioInventoryAsset.updateMany({ where: { id: initial.assetId, revision: asset.revision }, data: { ...(remainingCapacity === 0 ? { status: "retired" } : { capacity: remainingCapacity }), revision: { increment: 1 } } });
        if (!updated.count) throw Object.assign(new Error("Inventory changed during disposition."), { code: "INVENTORY_REVISION_CONFLICT", statusCode: 409 });
      }
      return { ok: true };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, body.disposition === "returned" ? "inventory.equipment_returned" : "inventory.equipment_written_off", id);
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  // Transfer holds the asset lock so allocation capacity and duplicate
  // assignees remain consistent with creates and retirement operations.
  app.post("/api/admin/inventory/allocations/:id/transfer", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "TRANSFER ALLOCATION")) return;
    const { id } = paramsId.parse(request.params);
    const body = transferInput.parse(request.body || {});
    // Read for the owning lock ID; re-read the allocation after acquiring it.
    const initial = await prisma.studioInventoryAllocation.findUnique({ where: { id }, select: { assetId: true } });
    if (!initial) return reply.code(404).send({ ok: false, code: "ALLOCATION_NOT_FOUND" });
    const result = await prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${initial.assetId} FOR UPDATE`;
      if (!locked.length) return { code: "ASSET_NOT_FOUND", status: 404 };
      const original = await tx.studioInventoryAllocation.findUnique({ where: { id }, select: { id: true, assetId: true, userId: true, quantity: true, status: true, expiresAt: true } });
      if (!original || original.assetId !== initial.assetId || original.status !== "active") return { code: "ALLOCATION_NOT_ACTIVE", status: 409 };
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id: original.assetId }, select: { status: true, kind: true } });
      if (asset?.status !== "active") return { code: "ASSET_INACTIVE", status: 409 };
      if (inventoryDigitalKind(asset.kind)) return { code: "INVENTORY_REVIEW_REQUIRED", status: 409 };
      if (original.userId === body.toUserId) return { code: "TRANSFER_SAME_RECIPIENT", status: 409 };
      const recipient = await recipientDeadline(tx, body.toUserId);
      if (!recipient.eligible) return { code: "RECIPIENT_INACTIVE", status: 409 };
      if (original.expiresAt && (new Date(original.expiresAt) <= new Date() || (recipient.deadline && new Date(original.expiresAt) > new Date(recipient.deadline))))
        return { code: "LEASE_TRANSFER_NOT_ALLOWED", status: 409 };
      const existing = await tx.studioInventoryAllocation.findFirst({ where: { assetId: original.assetId, userId: body.toUserId, status: "active" }, select: { id: true } });
      if (existing) return { code: "ALLOCATION_EXISTS", status: 409 };
      const changed = await tx.studioInventoryAllocation.updateMany({ where: { id, status: "active" }, data: { status: "transferred", revokedAt: new Date(), closedReason: body.reason || "Allocation transferred", closedById: actor.id } });
      if (!changed.count) return { code: "ALLOCATION_NOT_ACTIVE", status: 409 };
      const allocation = await tx.studioInventoryAllocation.create({ data: { assetId: original.assetId, userId: body.toUserId, quantity: original.quantity, reason: body.reason || `Transferred from ${original.userId}`, assignedById: actor.id, expiresAt: original.expiresAt }, select: { id: true, assetId: true, userId: true, quantity: true, status: true, assignedAt: true } });
      return { allocation };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, "inventory.allocation_transferred", id);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, allocation: result.allocation });
  });

  // Recipient custody / license-seat view. No admin-only reasons or other users'
  // assignments are projected into these responses.
  app.get("/api/me/inventory/allocations", async (request: any, reply: any) => {
    reply.header("Cache-Control", "no-store");
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    if (!(await eligibleRecipient(prisma, user.id))) return reply.code(403).send({ ok: false, code: "ACCOUNT_INACTIVE" });
    const query = z.object({ cursor: z.string().min(1).max(160).optional() }).parse(request.query || {});
    const rows = await prisma.studioInventoryAllocation.findMany({
      where: { userId: user.id },
      select: {
        id: true, quantity: true, status: true, assignedAt: true, revokedAt: true, expiresAt: true,
        asset: { select: { title: true, kind: true, provider: true, status: true } },
      },
      orderBy: { id: "asc" },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: 51,
    });
    return { ok: true, allocations: rows.slice(0, 50).map((row: any) => ({ ...row,
      effectiveStatus: row.status === "active" && inventoryDigitalKind(row.asset.kind) && row.expiresAt && new Date(row.expiresAt) <= new Date() ? "expired" : row.status,
    })), nextCursor: rows.length > 50 ? rows[49].id : null };
  });

  // A recipient may list their own allocations. Never expose ciphertext, fingerprints,
  // Vault IDs, or other people's assignments through this projection.
  app.get("/api/me/inventory/keys", async (request: any, reply: any) => {
    reply.header("Cache-Control", "no-store");
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    if (!(await eligibleRecipient(prisma, user.id))) return reply.code(403).send({ ok: false, code: "ACCOUNT_INACTIVE" });
    const query = z.object({ cursor: z.string().min(1).max(160).optional() }).parse(request.query || {});
    const rows = await prisma.studioInventoryKey.findMany({
      where: { userId: user.id },
      select: {
        id: true, revision: true, status: true, assignedAt: true, expiresAt: true, closedAt: true,
        pool: { select: { title: true, kind: true, provider: true, status: true } },
      },
      orderBy: { id: "asc" },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: 51,
    });
    return { ok: true, keys: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
  });

  // Self-service is deliberately narrower than administrative reveal: a fresh
  // security PIN, exact owner+revision, active pool, and unexpired Vault secret
  // are all required. The PIN is never persisted with a key or logged.
  app.post("/api/me/inventory/keys/:id/reveal", async (request: any, reply: any) => {
    reply.header("Cache-Control", "no-store");
    const user = await getCurrentUser(request);
    if (!user?.id) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    if (!(await eligibleRecipient(prisma, user.id))) return reply.code(403).send({ ok: false, code: "ACCOUNT_INACTIVE" });
    const { id } = paramsId.parse(request.params);
    const body = recipientKeyRevealInput.parse(request.body || {});
    const scope = { id, userId: user.id, status: "assigned", revision: body.expectedRevision };
    // Unauthorized record IDs produce the same response as missing records.
    const owned = await prisma.studioInventoryKey.findFirst({ where: scope, select: { id: true } });
    if (!owned) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    try { await verifyUserPin(user, body.pin, "reveal_assigned_inventory_key", request); }
    catch { return reply.code(403).send({ ok: false, code: "PIN_VERIFICATION_FAILED" }); }

    // Recheck ownership and revocation AFTER credential verification, so
    // changes while a PIN is entered cannot authorize a stale disclosure.
    const key = await prisma.studioInventoryKey.findFirst({
      where: scope,
      select: { poolId: true, vaultSecretId: true, expiresAt: true, pool: { select: { status: true } } },
    });
    if (!key || key.pool.status !== "active" || (key.expiresAt && new Date(key.expiresAt) <= new Date())) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    if (!(await eligibleRecipient(prisma, user.id))) return reply.code(403).send({ ok: false, code: "ACCOUNT_INACTIVE" });
    const secret = await prisma.studioVaultSecret.findUnique({
      where: { id: key.vaultSecretId },
      select: { encryptedValue: true, revokedAt: true, expiresAt: true },
    });
    if (!secret || secret.revokedAt || (secret.expiresAt && new Date(secret.expiresAt).getTime() <= Date.now()))
      return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    // No plaintext if the audit subsystem cannot confirm durable persistence.
    if (!(await auditDisclosure(request, user.id, "inventory.recipient_key_revealed", id, user.id)))
      return reply.code(503).send({ ok: false, code: "KEY_REVEAL_AUDIT_UNAVAILABLE" });
    const marked = await prisma.studioInventoryKey.updateMany({ where: { id, poolId: key.poolId, userId: user.id, status: "assigned", revision: body.expectedRevision, firstRevealedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { firstRevealedAt: new Date() } });
    if (!marked.count) {
      const stillOwned = await prisma.studioInventoryKey.findFirst({ where: { id, poolId: key.poolId, userId: user.id, status: "assigned", revision: body.expectedRevision, firstRevealedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
      if (!stillOwned) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    }
    const fresh = await currentKeyDisclosure(prisma, id, key.poolId, body.expectedRevision, user.id);
    if (!fresh || fresh.key.vaultSecretId !== key.vaultSecretId || !(await eligibleRecipient(prisma, user.id)))
      return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    return { ok: true, value: decryptSecuritySecret(vaultEncryptionPurpose(fresh.key.vaultSecretId), fresh.secret.encryptedValue), copyOnce: true };
  });

  // Key-pool records never serialize ciphertext or even per-key Vault identifiers.
  app.get("/api/admin/inventory/key-pools", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const query = z.object({ cursor: z.string().trim().min(1).max(160).optional(), q: z.string().trim().max(160).optional() }).parse(request.query || {});
    const pools = await prisma.studioInventoryKeyPool.findMany({
      where: query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { provider: { contains: query.q, mode: "insensitive" } }] } : {},
      select: keyPoolSelect,
      orderBy: { id: "asc" },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: 101,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, pools: pools.slice(0, 100), nextCursor: pools.length > 100 ? pools[99].id : null };
  });

  app.post("/api/admin/inventory/key-pools", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const body = keyPoolInput.parse(request.body || {});
    const pool = await prisma.studioInventoryKeyPool.create({ data: { ...body, createdById: actor.id }, select: keyPoolSelect });
    await audit(request, actor, "inventory.key_pool_created", pool.id);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, pool });
  });

  app.post("/api/admin/inventory/key-pools/:id/lifecycle", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "CHANGE KEY POOL STATUS")) return;
    const { id } = paramsId.parse(request.params);
    const body = keyPoolLifecycle.parse(request.body || {});
    const changed = await prisma.studioInventoryKeyPool.updateMany({ where: { id, revision: body.expectedRevision, status: body.status === "active" ? "closed" : "active" }, data: { status: body.status, revision: { increment: 1 } } });
    if (!changed.count) return reply.code(409).send({ ok: false, code: "KEY_POOL_REVISION_CONFLICT" });
    await audit(request, actor, body.status === "active" ? "inventory.key_pool_reopened" : "inventory.key_pool_closed", id);
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  app.get("/api/admin/inventory/key-pools/:id/keys", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id } = paramsId.parse(request.params);
    const query = z.object({ cursor: z.string().trim().min(1).max(160).optional() }).parse(request.query || {});
    const pool = await prisma.studioInventoryKeyPool.findUnique({ where: { id }, select: keyPoolSelect });
    if (!pool) return reply.code(404).send({ ok: false, code: "KEY_POOL_NOT_FOUND" });
    const rows = await prisma.studioInventoryKey.findMany({ where: { poolId: id }, select: keyPublicSelect, orderBy: { id: "asc" }, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 101 });
    reply.header("Cache-Control", "no-store");
    return { ok: true, pool, keys: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
  });

  app.post("/api/admin/inventory/key-pools/:id/import", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "IMPORT KEY POOL")) return;
    if (!encryptionKeyConfigured()) return reply.code(503).send({ ok: false, code: "VAULT_KEY_UNAVAILABLE" });
    const { id } = paramsId.parse(request.params);
    const body = keyImportInput.parse(request.body || {});
    // Pool-specific fingerprints detect duplicates without retaining plaintext in Inventory.
    const values = body.values.map((value: string) => ({ value, fingerprint: inventoryKeyFingerprint(id, value), secretId: randomUUID(), keyId: randomUUID() }));
    if (new Set(values.map((value: any) => value.fingerprint)).size !== values.length)
      return reply.code(409).send({ ok: false, code: "DUPLICATE_KEYS_IN_IMPORT" });
    const result = await prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryKeyPool" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) return { code: "KEY_POOL_NOT_FOUND", status: 404 };
      const pool = await tx.studioInventoryKeyPool.findUnique({ where: { id }, select: { kind: true, status: true, revision: true } });
      if (!pool || pool.status !== "active" || pool.revision !== body.expectedRevision) return { code: "KEY_POOL_REVISION_CONFLICT", status: 409 };
      const duplicate = await tx.studioInventoryKey.findFirst({ where: { poolId: id, fingerprint: { in: values.map((row: any) => row.fingerprint) } }, select: { id: true } });
      if (duplicate) return { code: "DUPLICATE_KEYS_IN_POOL", status: 409 };
      for (const row of values) {
        await tx.studioVaultSecret.create({ data: { id: row.secretId, name: `Pool ${id} key`, kind: pool.kind, encryptedValue: encryptSecuritySecret(vaultEncryptionPurpose(row.secretId), row.value), fingerprint: clusterSecretFingerprint(row.value, vaultEncryptionPurpose(row.secretId)), createdById: actor.id } });
        await tx.studioInventoryKey.create({ data: { id: row.keyId, poolId: id, vaultSecretId: row.secretId, fingerprint: row.fingerprint } });
      }
      const changed = await tx.studioInventoryKeyPool.updateMany({ where: { id, revision: body.expectedRevision, status: "active" }, data: { revision: { increment: 1 } } });
      if (!changed.count) throw new Error("Pool revision changed during import");
      return { imported: values.length };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, "inventory.key_pool_imported", id);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, imported: result.imported });
  });

  // Do not preserve a second direct key-issue authority.
  app.post("/api/admin/inventory/key-pools/:id/keys/:keyId/assign", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    return reply.code(409).send({ ok: false, code: "INVENTORY_REVIEW_REQUIRED", error: "Request independent approval before issuing a commercial key." });
  });

  app.post("/api/admin/inventory/key-pools/:id/keys/:keyId/decision", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "CLOSE INVENTORY KEY")) return;
    const { id, keyId } = z.object({ id: z.string().min(1).max(160), keyId: z.string().min(1).max(160) }).parse(request.params);
    const body = keyDecisionInput.parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "StudioInventoryKeyPool" WHERE "id" = ${id} FOR UPDATE`;
      const key = await tx.studioInventoryKey.findFirst({ where: { id: keyId, poolId: id }, select: { id: true, vaultSecretId: true, status: true, revision: true } });
      if (!key || key.revision !== body.expectedRevision || (body.decision === "redeemed" ? key.status !== "assigned" : !["available", "assigned"].includes(key.status)))
        return { code: "KEY_REVISION_OR_STATUS_CONFLICT", status: 409 };
      const changed = await tx.studioInventoryKey.updateMany({ where: { id: keyId, poolId: id, revision: body.expectedRevision, status: key.status }, data: { status: body.decision, closedReason: body.reason, closedById: actor.id, closedAt: new Date(), revision: { increment: 1 } } });
      if (!changed.count) return { code: "KEY_REVISION_OR_STATUS_CONFLICT", status: 409 };
      if (body.decision === "revoked") await tx.studioVaultSecret.updateMany({ where: { id: key.vaultSecretId, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      return { ok: true };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await audit(request, actor, body.decision === "redeemed" ? "inventory.key_marked_redeemed" : "inventory.key_revoked", keyId);
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  app.post("/api/admin/inventory/key-pools/:id/keys/:keyId/reveal", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVEAL INVENTORY KEY")) return;
    const { id, keyId } = z.object({ id: z.string().min(1).max(160), keyId: z.string().min(1).max(160) }).parse(request.params);
    const body = keyRevealInput.parse(request.body || {});
    const key = await prisma.studioInventoryKey.findFirst({ where: { id: keyId, poolId: id, status: "assigned", revision: body.expectedRevision }, select: { userId: true, vaultSecretId: true, expiresAt: true, pool: { select: { status: true } } } });
    if (!key || key.pool.status !== "active" || !key.userId || (key.expiresAt && new Date(key.expiresAt) <= new Date())) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    const recipient = await prisma.user.findUnique({ where: { id: key.userId }, select: { id: true, accountState: true, archived: true, accessExpiresAt: true } });
    if (!recipient || recipient.archived || recipient.accountState !== "ACTIVE" || (recipient.accessExpiresAt && new Date(recipient.accessExpiresAt).getTime() <= Date.now())) return reply.code(409).send({ ok: false, code: "RECIPIENT_INACTIVE" });
    const secret = await prisma.studioVaultSecret.findUnique({ where: { id: key.vaultSecretId }, select: { encryptedValue: true, revokedAt: true, expiresAt: true } });
    if (!secret || secret.revokedAt || (secret.expiresAt && new Date(secret.expiresAt).getTime() <= Date.now())) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    if (!(await auditDisclosure(request, actor.id, "inventory.key_revealed", keyId)))
      return reply.code(503).send({ ok: false, code: "KEY_REVEAL_AUDIT_UNAVAILABLE" });
    const marked = await prisma.studioInventoryKey.updateMany({ where: { id: keyId, poolId: id, status: "assigned", revision: body.expectedRevision, firstRevealedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { firstRevealedAt: new Date() } });
    if (!marked.count) {
      const stillAuthorized = await prisma.studioInventoryKey.findFirst({ where: { id: keyId, poolId: id, status: "assigned", revision: body.expectedRevision, firstRevealedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
      if (!stillAuthorized) return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    }
    const fresh = await currentKeyDisclosure(prisma, keyId, id, body.expectedRevision);
    if (!fresh || fresh.key.vaultSecretId !== key.vaultSecretId || fresh.key.userId !== key.userId || !(await admin(request, reply)))
      return reply.code(404).send({ ok: false, code: "KEY_NOT_REVEALABLE" });
    reply.header("Cache-Control", "no-store");
    return { ok: true, value: decryptSecuritySecret(vaultEncryptionPurpose(fresh.key.vaultSecretId), fresh.secret.encryptedValue), copyOnce: true };
  });

  app.get("/api/admin/vault/secrets", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    // Explicit projection: ciphertext is never loaded, serialized or cached in a list endpoint.
    const query = z.object({ cursor: z.string().trim().min(1).max(160).optional(), q: z.string().trim().max(160).optional() }).parse(request.query || {});
    const rows = await prisma.studioVaultSecret.findMany({
      where: { inventoryKey: { is: null }, ...(query.q ? { OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { kind: { contains: query.q, mode: "insensitive" } },
      ] } : {}) },
      select: vaultPublicSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 101,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true, secrets: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
  });

  app.post("/api/admin/vault/secrets", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!encryptionKeyConfigured()) return reply.code(503).send({ ok: false, code: "VAULT_KEY_UNAVAILABLE" });
    const body = secretInput.parse(request.body || {});
    const id = randomUUID();
    const encryptedValue = encryptSecuritySecret(vaultEncryptionPurpose(id), body.value);
    const fingerprint = clusterSecretFingerprint(body.value, vaultEncryptionPurpose(id));
    const result = await guardedVaultMutation(async (tx: any) => {
      const secret = await tx.studioVaultSecret.create({ data: { id, name: body.name, kind: body.kind, encryptedValue, fingerprint, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, createdById: actor.id }, select: vaultPublicSelect });
      await vaultMutationAudit(tx, request, actor, "vault.secret_created", id);
      return { secret };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ ok: true, secret: result.secret });
  });

  app.patch("/api/admin/vault/secrets/:id", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "UPDATE VAULT SECRET METADATA")) return;
    const { id } = paramsId.parse(request.params);
    const body = secretMetadataUpdate.parse(request.body || {});
    const result = await guardedVaultMutation(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioVaultSecret" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) return { code: "VAULT_REVISION_CONFLICT", status: 409 };
      if (await tx.studioInventoryKey.findUnique({ where: { vaultSecretId: id }, select: { id: true } }))
        return { code: "INVENTORY_KEYS_USE_POOL_LIFECYCLE", status: 409 };
      const changed = await tx.studioVaultSecret.updateMany({
        where: { id, revision: body.expectedRevision, revokedAt: null },
        data: { name: body.name, kind: body.kind, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null, revision: { increment: 1 } },
      });
      if (!changed.count) return { code: "VAULT_REVISION_CONFLICT", status: 409 };
      await vaultMutationAudit(tx, request, actor, "vault.secret_metadata_updated", id);
      return { secret: await tx.studioVaultSecret.findUnique({ where: { id }, select: vaultPublicSelect }) };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    reply.header("Cache-Control", "no-store");
    return { ok: true, secret: result.secret };
  });

  app.post("/api/admin/vault/secrets/:id/reveal", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVEAL VAULT SECRET")) return;
    const { id } = paramsId.parse(request.params);
    if (await prisma.studioInventoryKey.findUnique({ where: { vaultSecretId: id }, select: { id: true } }))
      return reply.code(409).send({ ok: false, code: "INVENTORY_KEYS_USE_POOL_REVEAL" });
    const secret = await prisma.studioVaultSecret.findUnique({ where: { id }, select: { ...vaultPublicSelect, encryptedValue: true } });
    if (!secret || secret.revokedAt || (secret.expiresAt && new Date(secret.expiresAt).getTime() <= Date.now())) return reply.code(404).send({ ok: false, code: "SECRET_UNAVAILABLE" });
    if (!(await auditDisclosure(request, actor.id, "vault.secret_revealed", id)))
      return reply.code(503).send({ ok: false, code: "VAULT_REVEAL_AUDIT_UNAVAILABLE" });
    // An audit write is not a durable authorization grant. A revocation, secret
    // replacement or Inventory binding during that write invalidates this read.
    if (!(await admin(request, reply)) || await prisma.studioInventoryKey.findUnique({ where: { vaultSecretId: id }, select: { id: true } }))
      return reply.code(404).send({ ok: false, code: "SECRET_UNAVAILABLE" });
    const fresh = await prisma.studioVaultSecret.findUnique({ where: { id }, select: { ...vaultPublicSelect, encryptedValue: true } });
    if (!fresh || fresh.revokedAt || fresh.revision !== secret.revision ||
        (fresh.expiresAt && new Date(fresh.expiresAt) <= new Date()))
      return reply.code(404).send({ ok: false, code: "SECRET_UNAVAILABLE" });
    const value = decryptSecuritySecret(vaultEncryptionPurpose(id), fresh.encryptedValue);
    reply.header("Cache-Control", "no-store");
    return { ok: true, id, value, copyOnce: true };
  });

  // Direct single-actor replacement was unsafe: all standalone rotations now
  // require a separate administrator's approval and a fresh final credential.
  app.post("/api/admin/vault/secrets/:id/rotate", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    return reply.code(409).send({ ok: false, code: "VAULT_INDEPENDENT_REVIEW_REQUIRED" });
  });
  registerVaultReviewedRotationRoutes({ app, prisma, admin, requireConfirmation, recordSecurityInTransaction: auditService?.recordSecurityInTransaction });

  app.post("/api/admin/vault/secrets/:id/revoke", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVOKE VAULT SECRET")) return;
    const { id } = paramsId.parse(request.params);
    const body = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(request.body || {});
    const result = await guardedVaultMutation(async (tx: any) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "StudioVaultSecret" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) return { code: "VAULT_REVISION_CONFLICT", status: 409 };
      if (await tx.studioInventoryKey.findUnique({ where: { vaultSecretId: id }, select: { id: true } }))
        return { code: "INVENTORY_KEYS_USE_POOL_LIFECYCLE", status: 409 };
      const changed = await tx.studioVaultSecret.updateMany({ where: { id, revision: body.expectedRevision, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      if (!changed.count) return { code: "VAULT_REVISION_CONFLICT", status: 409 };
      await vaultMutationAudit(tx, request, actor, "vault.secret_revoked", id);
      return { ok: true };
    });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });
  registerStudioInventoryApprovalRoutes(deps, { inventoryLeaseDeadline, assertInventoryCapacity, expireDigitalSeats });

}

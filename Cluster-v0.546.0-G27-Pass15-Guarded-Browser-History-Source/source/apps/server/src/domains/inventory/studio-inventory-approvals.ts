import { z } from "zod";

// Inventory remains the authority for stock and key custody. This layer only
// governs the decision to issue or extend a DIGITAL entitlement.
const requestSchema = z.object({
  operation: z.enum(["seat_issue", "seat_extend", "key_issue"]),
  targetId: z.string().min(1).max(160),
  userId: z.string().min(1).max(160),
  expectedRevision: z.number().int().positive(),
  expectedProfileRevision: z.number().int().positive(),
  quantity: z.number().int().min(1).max(1_000_000).default(1),
  expiresAt: z.string().datetime(),
  reason: z.string().trim().min(8).max(1000),
}).strict();
const reviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(8).max(1000) }).strict();
const idSchema = z.object({ id: z.string().min(1).max(160) });
const activeRecipient = (person: any, now: Date) => Boolean(person && !person.archived && person.accountState === "ACTIVE" && (!person.accessExpiresAt || new Date(person.accessExpiresAt) > now));
const fail = (code: string, error: string) => Object.assign(new Error(error), { code, statusCode: 409 });
const publicRequest = (row: any) => ({ id: row.id, operation: row.operation, targetId: row.targetId, userId: row.userId,
  quantity: row.quantity, expiresAt: row.expiresAt, status: row.status, reason: row.reason,
  requestedById: row.requestedById, reviewedById: row.reviewedById, reviewedAt: row.reviewedAt,
  reviewReason: row.reviewReason, resultId: row.resultId, requestedAt: row.requestedAt });

export function registerStudioInventoryApprovalRoutes(deps: any, policy: {
  inventoryLeaseDeadline: (value: string, now: Date, recipientDeadline?: Date | string | null) => Date | null;
  assertInventoryCapacity: (capacity: number, active: number, proposed: number) => boolean;
  expireDigitalSeats: (tx: any, assetId: string, kind: string, now: Date) => Promise<number>;
}) {
  const { app, prisma, authorization, getCurrentUser, logSecurityEvent } = deps;
  async function admin(request: any, reply: any) { return authorization.requireAdmin(request, reply); }
  async function withErrors(reply: any, work: () => Promise<any>) {
    try { return await work(); }
    catch (error: any) {
      if (error?.code && error?.statusCode) return reply.code(error.statusCode).send({ ok: false, code: error.code, error: error.message });
      throw error;
    }
  }
  async function lockTarget(tx: any, operation: string, targetId: string) {
    if (operation === "key_issue") {
      const key = await tx.studioInventoryKey.findUnique({ where: { id: targetId }, select: { poolId: true } });
      if (!key) throw fail("INVENTORY_KEY_NOT_FOUND", "Key no longer exists.");
      const rows = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryKeyPool" WHERE "id" = ${key.poolId} FOR UPDATE`;
      if (!rows.length) throw fail("KEY_POOL_NOT_FOUND", "Key pool is unavailable.");
      return { poolId: key.poolId };
    }
    const initial = operation === "seat_extend" ? await tx.studioInventoryAllocation.findUnique({ where: { id: targetId }, select: { assetId: true } }) : { assetId: targetId };
    if (!initial) throw fail("INVENTORY_SEAT_NOT_FOUND", "Allocation no longer exists.");
    const rows = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${initial.assetId} FOR UPDATE`;
    if (!rows.length) throw fail("INVENTORY_ASSET_NOT_FOUND", "Inventory asset is unavailable.");
    return { assetId: initial.assetId };
  }
  async function validateTarget(tx: any, body: any, now: Date, act: boolean, reviewerId?: string) {
    const lockedRecipient = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${body.userId} FOR UPDATE`;
    if (!lockedRecipient.length) throw fail("INVENTORY_RECIPIENT_INACTIVE", "Recipient no longer exists.");
    const person = await tx.user.findUnique({ where: { id: body.userId }, select: { id: true, username: true, displayName: true, accountState: true, archived: true, accessExpiresAt: true, profileRevision: true } });
    if (!activeRecipient(person, now)) throw fail("INVENTORY_RECIPIENT_INACTIVE", "Recipient no longer has active studio access.");
    if (person.profileRevision !== body.expectedProfileRevision) throw fail("INVENTORY_PROFILE_STALE", "Recipient profile changed; create a new request.");
    const expiresAt = policy.inventoryLeaseDeadline(body.expiresAt, now, person.accessExpiresAt);
    if (!expiresAt) throw fail("INVENTORY_EXPIRY_REQUIRED", "Reviewed entitlements require a finite expiration.");
    const target = await lockTarget(tx, body.operation, body.targetId);
    if (body.operation === "seat_issue") {
      const asset = await tx.studioInventoryAsset.findUnique({ where: { id: target.assetId }, select: { id: true, kind: true, status: true, revision: true, capacity: true } });
      if (!asset || !["digital", "license"].includes(asset.kind) || asset.status !== "active") throw fail("INVENTORY_NOT_DIGITAL", "Only active digital/license assets use grant review.");
      if (asset.revision !== body.expectedRevision) throw fail("INVENTORY_REVISION_CONFLICT", "Asset changed; request another review.");
      await policy.expireDigitalSeats(tx, asset.id, asset.kind, now);
      if (await tx.studioInventoryAllocation.findFirst({ where: { assetId: asset.id, userId: body.userId, status: "active" } })) throw fail("INVENTORY_ALREADY_ASSIGNED", "Recipient already holds this seat.");
      const occupied = await tx.studioInventoryAllocation.aggregate({ where: { assetId: asset.id, status: "active" }, _sum: { quantity: true } });
      if (!policy.assertInventoryCapacity(asset.capacity, Number(occupied._sum.quantity || 0), body.quantity)) throw fail("INVENTORY_NO_CAPACITY", "Not enough seats remain.");
      if (!act) return { person };
      const allocation = await tx.studioInventoryAllocation.create({ data: { assetId: asset.id, userId: body.userId, quantity: body.quantity, expiresAt, reason: body.reason, assignedById: reviewerId }, select: { id: true } });
      return { person, resultId: allocation.id };
    }
    if (body.operation === "seat_extend") {
      const allocation = await tx.studioInventoryAllocation.findUnique({ where: { id: body.targetId }, include: { asset: { select: { kind: true, status: true } } } });
      if (!allocation || allocation.userId !== body.userId || allocation.status !== "active" || allocation.revision !== body.expectedRevision || !["digital", "license"].includes(allocation.asset.kind) || allocation.asset.status !== "active") throw fail("INVENTORY_LEASE_STALE", "Seat no longer qualifies for extension.");
      if (body.quantity !== allocation.quantity) throw fail("INVENTORY_SEAT_QUANTITY_STALE", "Seat quantity changed since request.");
      if (allocation.expiresAt && new Date(allocation.expiresAt) <= now) throw fail("INVENTORY_LEASE_EXPIRED", "Expired leases cannot be renewed through a stale request.");
      if (allocation.expiresAt && expiresAt <= new Date(allocation.expiresAt)) throw fail("INVENTORY_LEASE_NOT_EXTENDED", "Expiration must extend the existing lease.");
      if (!act) return { person };
      const changed = await tx.studioInventoryAllocation.updateMany({ where: { id: body.targetId, userId: body.userId, status: "active", revision: body.expectedRevision }, data: { expiresAt, revision: { increment: 1 } } });
      if (changed.count !== 1) throw fail("INVENTORY_LEASE_STALE", "Seat was modified during review.");
      return { person, resultId: body.targetId };
    }
    const key = await tx.studioInventoryKey.findUnique({ where: { id: body.targetId }, include: { pool: { select: { status: true } } } });
    if (!key || key.status !== "available" || key.revision !== body.expectedRevision || key.pool.status !== "active") throw fail("INVENTORY_KEY_STALE", "Key has changed or is no longer available.");
    if (body.quantity !== 1) throw fail("INVENTORY_KEY_QUANTITY", "Each key request issues exactly one key.");
    if (!act) return { person };
    const changed = await tx.studioInventoryKey.updateMany({ where: { id: body.targetId, status: "available", revision: body.expectedRevision }, data: { status: "assigned", userId: body.userId, assignedById: reviewerId, assignedAt: now, expiresAt, revision: { increment: 1 } } });
    if (changed.count !== 1) throw fail("INVENTORY_KEY_STALE", "Key was assigned during review.");
    return { person, resultId: body.targetId };
  }
  async function reviewerRoster(tx: any, requesterId: string, recipientId: string, now: Date) {
    // Only admins/owners in the studio roster are candidates; reviewers must
    // still pass the live admin gate when actually reviewing.
    const rows = await tx.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } }, select: { userId: true }, take: 252 });
    if (rows.length > 251) throw fail("INVENTORY_REVIEWER_LIMIT", "Admin roster is too large for this review queue.");
    const reviewers = [...new Set(rows.map((row: any) => row.userId as string))].filter((id) => id !== requesterId && id !== recipientId);
    if (!reviewers.length) throw fail("INVENTORY_SECOND_REVIEWER_REQUIRED", "A different active administrator must review this request.");
    return reviewers;
  }
  // Cross-tool visibility, not a replacement for any tool's authorization.
  // Direct rules are labeled explicitly; inherited/effective rights require
  // the Access Explorer. No secrets, license values or credentials are selected.
  app.get("/api/admin/inventory/person-access/:id", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const { id } = idSchema.parse(request.params);
    const person = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, displayName: true, archived: true, accountState: true, accessExpiresAt: true } });
    if (!person) return reply.code(404).send({ ok: false, code: "INVENTORY_PERSON_NOT_FOUND" });
    const now = new Date();
    const [allocations, keys, packages, projectDirectRules, offboarding] = await Promise.all([
      prisma.studioInventoryAllocation.findMany({ where: { userId: id, status: "active" }, select: { id: true, quantity: true, expiresAt: true, asset: { select: { id: true, title: true, kind: true } } }, take: 101 }),
      prisma.studioInventoryKey.findMany({ where: { userId: id, status: "assigned" }, select: { id: true, expiresAt: true, pool: { select: { title: true, kind: true } } }, take: 101 }),
      prisma.managedPackageEntitlement.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: now } }, select: { id: true, packageId: true, expiresAt: true }, take: 101 }),
      prisma.accessRule.findMany({ where: { subjectKind: "member", subjectId: id, targetKind: "project", effect: "allow", status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, targetId: true, level: true, expiresAt: true }, take: 101 }),
      prisma.studioOffboardingCase.findMany({ where: { subjectUserId: id }, select: { id: true, status: true, completedAt: true, equipmentStatus: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    ]);
    const bounded = (rows: any[]) => rows.slice(0, 100);
    return { ok: true, person, eligible: activeRecipient(person, now),
      allocations: bounded(allocations).map((a: any) => ({ ...a, effectiveStatus: a.asset.kind === "physical" || a.asset.kind === "equipment" ? "custody_open" : a.expiresAt && new Date(a.expiresAt) <= now ? "expired" : activeRecipient(person, now) ? "active" : "identity_blocked" })),
      keys: bounded(keys).map((k: any) => ({ ...k, effectiveStatus: k.expiresAt && new Date(k.expiresAt) <= now ? "expired" : activeRecipient(person, now) ? "assigned" : "identity_blocked" })),
      packageEntitlements: bounded(packages), directProjectAllowRules: bounded(projectDirectRules), offboarding,
      truncated: { allocations: allocations.length > 100, keys: keys.length > 100, packages: packages.length > 100, projectDirectRules: projectDirectRules.length > 100, offboarding: offboarding.length === 6 },
      note: "Direct Project allow rules are not effective permission decisions. Physical equipment custody continues after account expiry or offboarding." };
  });
  app.get("/api/admin/inventory/access-requests/options", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const people = await prisma.user.findMany({ where: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }] }, select: { id: true, username: true, displayName: true, profileRevision: true, accessExpiresAt: true }, orderBy: { username: "asc" }, take: 501 });
    return { ok: true, people: people.slice(0, 500), truncated: people.length > 500 };
  });
  app.get("/api/admin/inventory/access-requests", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    reply.header("Cache-Control", "no-store");
    const rows = await prisma.studioInventoryAccessRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 101 });
    const shown = rows.slice(0, 100);
    const unique = (items: string[]) => [...new Set(items)];
    const [subjects, assets, allocations, keys] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: unique(shown.map((r: any) => r.userId)) } }, select: { id: true, displayName: true, username: true } }),
      prisma.studioInventoryAsset.findMany({ where: { id: { in: unique(shown.filter((r: any) => r.operation === "seat_issue").map((r: any) => r.targetId)) } }, select: { id: true, title: true } }),
      prisma.studioInventoryAllocation.findMany({ where: { id: { in: unique(shown.filter((r: any) => r.operation === "seat_extend").map((r: any) => r.targetId)) } }, select: { id: true, asset: { select: { title: true } } } }),
      prisma.studioInventoryKey.findMany({ where: { id: { in: unique(shown.filter((r: any) => r.operation === "key_issue").map((r: any) => r.targetId)) } }, select: { id: true, pool: { select: { title: true } } } }),
    ]);
    const subjectMap = new Map<string, string>();
    for (const u of subjects) subjectMap.set(u.id, u.displayName || u.username);
    const labelMap = new Map<string, string>();
    for (const a of assets) labelMap.set(a.id, a.title);
    for (const a of allocations) labelMap.set(a.id, a.asset.title);
    for (const k of keys) labelMap.set(k.id, k.pool.title);
    return { ok: true, requests: shown.map((row: any) => ({ ...publicRequest(row), subjectLabel: subjectMap.get(row.userId) || row.userId, targetLabel: labelMap.get(row.targetId) || row.targetId })), truncated: rows.length > 100 };
  });
  app.post("/api/admin/inventory/access-requests", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const body = requestSchema.parse(request.body || {});
    return withErrors(reply, async () => {
      const created = await prisma.$transaction(async (tx: any) => {
        const now = new Date();
        const evaluated = await validateTarget(tx, body, now, false);
        const pending = await tx.studioInventoryAccessRequest.findFirst({ where: { operation: body.operation, targetId: body.targetId, status: "pending", ...(body.operation === "seat_issue" ? { userId: body.userId } : {}) } });
        if (pending) throw fail("INVENTORY_REQUEST_PENDING", "This resource already has a pending access request.");
        const reviewers = await reviewerRoster(tx, actor.id, body.userId, now);
        const requestRow = await tx.studioInventoryAccessRequest.create({ data: { ...body, expiresAt: new Date(body.expiresAt), requestedById: actor.id } });
        await tx.notificationInboxItem.createMany({ data: reviewers.map((userId) => ({ userId, category: "action", priority: "high", title: "Inventory entitlement review", message: `${evaluated.person.displayName || evaluated.person.username} · ${body.operation} · ${body.reason.slice(0, 120)}`, entityType: "inventory", entityId: requestRow.id, resourceKind: "inventory", resourceId: requestRow.id, groupKey: `inventory-approval:${requestRow.id}`, tool: "inventory", signal: "inventory_review", requiresAction: true })) });
        return requestRow;
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({ ok: true, request: publicRequest(created) });
    });
  });
  app.post("/api/admin/inventory/access-requests/:id/review", async (request: any, reply: any) => {
    const reviewer = await admin(request, reply); if (!reviewer) return;
    const { id } = idSchema.parse(request.params);
    const review = reviewSchema.parse(request.body || {});
    return withErrors(reply, async () => {
      const outcome = await prisma.$transaction(async (tx: any) => {
        const first = await tx.studioInventoryAccessRequest.findUnique({ where: { id } });
        if (!first || first.status !== "pending") throw fail("INVENTORY_REVIEW_UNAVAILABLE", "The request was already decided or cannot be found.");
        if (first.requestedById === reviewer.id || first.userId === reviewer.id) throw fail("INVENTORY_SELF_APPROVAL", "A requester or recipient cannot approve their own access.");
        const now = new Date();
        // Recheck reviewer membership and live identity at decision time.
        const roster = await tx.workspaceMember.findFirst({ where: { userId: reviewer.id, role: { in: ["owner", "admin"] }, user: { archived: false, accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } }, select: { id: true } });
        if (!roster) throw fail("INVENTORY_REVIEWER_INACTIVE", "Reviewer no longer qualifies to decide Inventory access.");
        const body = { operation: first.operation, targetId: first.targetId, userId: first.userId, expectedRevision: first.expectedRevision,
          expectedProfileRevision: first.expectedProfileRevision, quantity: first.quantity, expiresAt: first.expiresAt, reason: first.reason };
        const result = review.decision === "approved" ? await validateTarget(tx, body, now, true, reviewer.id) : { resultId: null };
        const changed = await tx.studioInventoryAccessRequest.updateMany({ where: { id, status: "pending" }, data: {
          status: review.decision, reviewedById: reviewer.id, reviewedAt: now, reviewReason: review.reason, resultId: result.resultId || null,
        } });
        if (changed.count !== 1) throw fail("INVENTORY_REVIEW_STALE", "Another administrator decided this request.");
        await tx.notificationInboxItem.updateMany({ where: { groupKey: `inventory-approval:${id}`, requiresAction: true }, data: { requiresAction: false, dismissedAt: now } });
        await tx.notificationInboxItem.createMany({ data: [...new Set([first.requestedById, first.userId])].map((userId) => ({ userId, category: "notification", priority: "normal", title: `Inventory request ${review.decision}`, message: `${first.operation} · ${review.reason.slice(0, 120)}`, entityType: "inventory", entityId: id, resourceKind: "inventory", resourceId: id, groupKey: `inventory-decision:${id}`, tool: "inventory", signal: "inventory_review_decision" })) });
        return { decision: review.decision, resultId: result.resultId || null };
      });
      await logSecurityEvent?.({ event: "inventory.access_reviewed", actorUserId: reviewer.id, targetUserId: null, result: "SUCCESS", reasonCode: `INVENTORY_${review.decision.toUpperCase()}`, request, metadata: { requestId: id, operation: outcome.decision, resultId: outcome.resultId } });
      reply.header("Cache-Control", "no-store");
      return { ok: true, ...outcome };
    });
  });
}

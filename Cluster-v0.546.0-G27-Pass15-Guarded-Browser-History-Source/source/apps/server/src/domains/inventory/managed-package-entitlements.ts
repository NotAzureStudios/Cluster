import { z } from "zod";

// Package recipient authority is separate from Inventory custody, publishing,
// rollouts and device pins. Pending requests NEVER confer downloadable access.
const params = z.object({ id: z.string().min(1).max(160) });
const requestInput = z.object({ userId: z.string().trim().min(1).max(160),
  action: z.enum(["grant", "extend"]), expiresAt: z.string().datetime(),
  expectedRevision: z.number().int().min(0), reason: z.string().trim().min(8).max(1000) }).strict();
const decisionInput = z.object({ decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(8).max(1000) }).strict();
const revokeInput = z.object({ expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(8).max(1000) }).strict();
const ENTITLEMENT_MAX_DAYS = 180;

export function validatePackageEntitlementExpiry(value: Date, now: Date, identityExpiry?: Date | null) {
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) && milliseconds > now.getTime()
    && milliseconds <= now.getTime() + ENTITLEMENT_MAX_DAYS * 86400000
    && (!identityExpiry || milliseconds <= new Date(identityExpiry).getTime());
}

export function registerManagedPackageEntitlementRoutes(deps: {
  app: any; prisma: any; admin: (req: any, reply: any) => Promise<any>;
  requireConfirmation: (req: any, reply: any, phrase: string) => boolean;
  audit: (db: any, actorId: string, action: string, subjectId: string, packageId: string, details?: Record<string, unknown>) => Promise<void>;
  securityAudit: (req: any, actor: any, action: string, subjectId: string) => Promise<void>;
}) {
  const { app, prisma, admin, requireConfirmation, audit, securityAudit } = deps;
  async function lockPackage(tx: any, packageId: string) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "ManagedPackage" WHERE "id" = ${packageId} FOR UPDATE`;
    if (!rows.length) return null;
    return tx.managedPackage.findUnique({ where: { id: packageId }, select: { id: true, archivedAt: true } });
  }
  async function recipient(tx: any, userId: string) {
    const lockedRecipient = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (!lockedRecipient.length) return null;
    return tx.user.findUnique({ where: { id: userId }, select: { id: true, archived: true,
      accountState: true, accessExpiresAt: true } });
  }
  function eligible(user: any, now: Date) {
    return Boolean(user && !user.archived && user.accountState === "ACTIVE"
      && (!user.accessExpiresAt || new Date(user.accessExpiresAt) > now));
  }
  const error = (reply: any, status: number, code: string) => reply.code(status).send({ ok: false, code });

  app.get("/api/admin/packages/:id/entitlements", async (req: any, reply: any) => {
    if (!(await admin(req, reply))) return;
    const { id } = params.parse(req.params);
    const [entitlements, requests] = await Promise.all([
      prisma.managedPackageEntitlement.findMany({ where: { packageId: id },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true, revokedReason: true,
          revision: true, approvedById: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.managedPackageEntitlementRequest.findMany({ where: { packageId: id },
        select: { id: true, userId: true, action: true, requestedById: true, reviewedById: true,
          expiresAt: true, expectedRevision: true, status: true, reason: true, reviewReason: true,
          createdAt: true, reviewedAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, entitlements, requests, limit: 200 };
  });

  app.post("/api/admin/packages/:id/entitlement-requests", async (req: any, reply: any) => {
    const actor = await admin(req, reply); if (!actor) return;
    const { id } = params.parse(req.params);
    const body = requestInput.parse(req.body || {});
    if (body.userId === actor.id) return error(reply, 403, "PACKAGE_ENTITLEMENT_SELF_APPROVAL_RISK");
    const result = await prisma.$transaction(async (tx: any) => {
      const pkg = await lockPackage(tx, id);
      if (!pkg || pkg.archivedAt) return { status: 404, code: "PACKAGE_NOT_AVAILABLE" };
      const now = new Date();
      const user = await recipient(tx, body.userId);
      if (!eligible(user, now)) return { status: 409, code: "RECIPIENT_INACTIVE" };
      const expiresAt = new Date(body.expiresAt);
      if (!validatePackageEntitlementExpiry(expiresAt, now, user.accessExpiresAt))
        return { status: 409, code: "PACKAGE_ENTITLEMENT_EXPIRY_INVALID" };
      const current = await tx.managedPackageEntitlement.findUnique({
        where: { packageId_userId: { packageId: id, userId: body.userId } } });
      if ((current?.revision || 0) !== body.expectedRevision)
        return { status: 409, code: "PACKAGE_ENTITLEMENT_STALE" };
      const currentlyActive = current && !current.revokedAt && new Date(current.expiresAt) > now;
      if (body.action === "grant" && currentlyActive) return { status: 409, code: "PACKAGE_ENTITLEMENT_ALREADY_ACTIVE" };
      if (body.action === "extend" && (!currentlyActive || expiresAt <= new Date(current.expiresAt)))
        return { status: 409, code: "PACKAGE_ENTITLEMENT_NOT_EXTENDABLE" };
      const duplicate = await tx.managedPackageEntitlementRequest.findFirst({ where: {
        packageId: id, userId: body.userId, status: "pending" }, select: { id: true } });
      if (duplicate) return { status: 409, code: "PACKAGE_ENTITLEMENT_REQUEST_PENDING" };
      const administrators = await tx.workspaceMember.findMany({ where: {
        role: { in: ["owner", "admin"] }, user: { archived: false, accountState: "ACTIVE",
          OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] },
      }, select: { userId: true }, take: 501 });
      if (administrators.length > 500) return { status: 409, code: "PACKAGE_ENTITLEMENT_REVIEWER_LIMIT" };
      const reviewers = [...new Set(administrators.map((row: any) => row.userId))]
        .filter((userId) => userId !== actor.id && userId !== body.userId);
      if (!reviewers.length) return { status: 409, code: "PACKAGE_ENTITLEMENT_REVIEWER_REQUIRED" };
      const request = await tx.managedPackageEntitlementRequest.create({ data: {
        packageId: id, userId: body.userId, action: body.action,
        requestedById: actor.id, expiresAt, expectedRevision: body.expectedRevision, reason: body.reason,
      }, select: { id: true, status: true } });
      await tx.notificationInboxItem.createMany({ data: reviewers.map((userId) => ({
        userId, category: "action", priority: "high", title: "Package access needs review",
        message: `Recipient ${body.userId} · ${body.action} · Expires ${expiresAt.toISOString()}`,
        entityType: "package", entityId: id, groupKey: `package-entitlement:${request.id}`,
        tool: "packages", signal: "package_entitlement_review", requiresAction: true,
      })) });
      await audit(tx, actor.id, "entitlement_requested", request.id, id, { userId: body.userId, action: body.action, expiresAt: body.expiresAt });
      return { request };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return error(reply, result.status, result.code);
    await securityAudit(req, actor, "entitlement_requested", result.request.id);
    return reply.code(201).send({ ok: true, request: result.request });
  });

  app.post("/api/admin/packages/:id/entitlement-requests/:requestId/review", async (req: any, reply: any) => {
    const actor = await admin(req, reply); if (!actor) return;
    const { id, requestId } = z.object({ id: z.string().min(1), requestId: z.string().min(1) }).parse(req.params);
    const body = decisionInput.parse(req.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const pkg = await lockPackage(tx, id);
      if (!pkg || pkg.archivedAt) return { status: 404, code: "PACKAGE_NOT_AVAILABLE" };
      const pending = await tx.managedPackageEntitlementRequest.findUnique({ where: { id: requestId } });
      if (!pending || pending.packageId !== id || pending.status !== "pending")
        return { status: 409, code: "PACKAGE_ENTITLEMENT_REQUEST_NOT_PENDING" };
      if (actor.id === pending.requestedById || actor.id === pending.userId)
        return { status: 403, code: "PACKAGE_ENTITLEMENT_INDEPENDENT_REVIEW_REQUIRED" };
      const now = new Date();
      const current = await tx.managedPackageEntitlement.findUnique({
        where: { packageId_userId: { packageId: id, userId: pending.userId } } });
      // Never approve a decision based on superseded entitlement state.
      if ((current?.revision || 0) !== pending.expectedRevision)
        return { status: 409, code: "PACKAGE_ENTITLEMENT_STALE" };
      let entitlementId: string | null = null;
      if (body.decision === "approved") {
        const user = await recipient(tx, pending.userId);
        if (!eligible(user, now) || !validatePackageEntitlementExpiry(new Date(pending.expiresAt), now, user.accessExpiresAt))
          return { status: 409, code: "PACKAGE_ENTITLEMENT_RECIPIENT_OR_EXPIRY_CHANGED" };
        const currentlyActive = current && !current.revokedAt && new Date(current.expiresAt) > now;
        if ((pending.action === "grant" && currentlyActive)
          || (pending.action === "extend" && (!currentlyActive || new Date(pending.expiresAt) <= new Date(current.expiresAt))))
          return { status: 409, code: "PACKAGE_ENTITLEMENT_STATE_CHANGED" };
        if (current) {
          const changed = await tx.managedPackageEntitlement.updateMany({ where: {
            id: current.id, revision: pending.expectedRevision,
          }, data: { expiresAt: pending.expiresAt, revokedAt: null, revokedById: null,
            revokedReason: null, approvedById: actor.id, approvedRequestId: requestId,
            revision: { increment: 1 } } });
          if (!changed.count) return { status: 409, code: "PACKAGE_ENTITLEMENT_STALE" };
          entitlementId = current.id;
        } else {
          const granted = await tx.managedPackageEntitlement.create({ data: {
            packageId: id, userId: pending.userId, expiresAt: pending.expiresAt,
            approvedById: actor.id, approvedRequestId: requestId,
          }, select: { id: true } });
          entitlementId = granted.id;
        }
      }
      const updated = await tx.managedPackageEntitlementRequest.updateMany({
        where: { id: requestId, status: "pending" }, data: {
          status: body.decision, reviewedById: actor.id, reviewedAt: now, reviewReason: body.reason,
        } });
      if (!updated.count) throw new Error("PACKAGE_ENTITLEMENT_REVIEW_RACE");
      await tx.notificationInboxItem.updateMany({ where: {
        groupKey: `package-entitlement:${requestId}`, requiresAction: true,
      }, data: { requiresAction: false, acknowledgedAt: now, readAt: now } });
      const recipients = [...new Set([pending.userId, pending.requestedById])];
      const activeRecipients = await tx.user.findMany({ where: {
        id: { in: recipients }, archived: false, accountState: "ACTIVE",
        OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
      }, select: { id: true } });
      if (activeRecipients.length) await tx.notificationInboxItem.createMany({ data: activeRecipients.map((person: any) => ({
        userId: person.id, category: "notification", priority: "normal",
        title: `Package access ${body.decision}`, message: `A Package access review decision is available in Studio Settings.`,
        entityType: "package", entityId: id, groupKey: `package-entitlement-decision:${requestId}`,
        tool: "packages", signal: "package_entitlement_decision", requiresAction: false,
      })) });
      await audit(tx, actor.id, `entitlement_${body.decision}`, requestId, id,
        { userId: pending.userId, entitlementId, expiresAt: pending.expiresAt, reason: body.reason });
      return { requestId, decision: body.decision, entitlementId };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return error(reply, result.status, result.code);
    await securityAudit(req, actor, `entitlement_${body.decision}`, requestId);
    return { ok: true, ...result };
  });

  app.post("/api/admin/packages/:id/entitlements/:entitlementId/revoke", async (req: any, reply: any) => {
    const actor = await admin(req, reply); if (!actor) return;
    if (!requireConfirmation(req, reply, "REVOKE PACKAGE ACCESS")) return;
    const { id, entitlementId } = z.object({ id: z.string().min(1), entitlementId: z.string().min(1) }).parse(req.params);
    const body = revokeInput.parse(req.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const pkg = await lockPackage(tx, id);
      if (!pkg) return { status: 404, code: "PACKAGE_NOT_FOUND" };
      const current = await tx.managedPackageEntitlement.findUnique({ where: { id: entitlementId } });
      if (!current || current.packageId !== id || current.revokedAt || current.revision !== body.expectedRevision)
        return { status: 409, code: "PACKAGE_ENTITLEMENT_NOT_ACTIVE_OR_STALE" };
      const updated = await tx.managedPackageEntitlement.updateMany({ where: {
        id: entitlementId, revision: body.expectedRevision, revokedAt: null,
      }, data: { revokedAt: new Date(), revokedById: actor.id, revokedReason: body.reason,
        revision: { increment: 1 } } });
      if (!updated.count) return { status: 409, code: "PACKAGE_ENTITLEMENT_STALE" };
      await audit(tx, actor.id, "entitlement_revoked", entitlementId, id,
        { userId: current.userId, reason: body.reason });
      return { entitlementId };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return error(reply, result.status, result.code);
    await securityAudit(req, actor, "entitlement_revoked", entitlementId);
    return { ok: true, ...result };
  });
}

import { createHash } from "node:crypto";
import { z } from "zod";

// Fail closed: seats are a SECOND authority, never a substitute for a reviewed
// Package entitlement, an authorized device or a signed release. No Vault read.
export async function packageSeatEligibleUsers(db: any, packageId: string, userIds: string[], now = new Date()) {
  const distinct = [...new Set(userIds)];
  if (!distinct.length) return [] as string[];
  if (distinct.length > 500) throw new Error("PACKAGE_SEAT_SCOPE_EXCEEDED");
  const binding = await db.managedPackageSeatRequirement.findUnique({
    where: { packageId }, select: { assetId: true },
  });
  if (!binding) return distinct;
  const allocations = await db.studioInventoryAllocation.findMany({ where: {
    assetId: binding.assetId, userId: { in: distinct }, status: "active", quantity: { gte: 1 },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    asset: { status: "active", kind: { in: ["digital", "license"] } },
  }, select: { userId: true }, take: 2001 });
  if (allocations.length > 2000) throw new Error("PACKAGE_SEAT_ALLOCATION_SCOPE_EXCEEDED");
  const covered = new Set(allocations.map((row: any) => row.userId));
  return distinct.filter((id) => covered.has(id));
}

export async function packageSeatEligibleIds(db: any, packageIds: string[], userId: string, now = new Date()) {
  if (!packageIds.length) return [] as string[];
  if (packageIds.length > 500) throw new Error("PACKAGE_SEAT_SCOPE_EXCEEDED");
  const bindings = await db.managedPackageSeatRequirement.findMany({
    where: { packageId: { in: packageIds } }, select: { packageId: true, assetId: true },
  });
  if (!bindings.length) return packageIds;
  const assetIds = [...new Set(bindings.map((row: any) => row.assetId))];
  const allocations = await db.studioInventoryAllocation.findMany({ where: {
    assetId: { in: assetIds }, userId, status: "active", quantity: { gte: 1 },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    asset: { status: "active", kind: { in: ["digital", "license"] } },
  }, select: { assetId: true }, take: 2001 });
  if (allocations.length > 2000) throw new Error("PACKAGE_SEAT_ALLOCATION_SCOPE_EXCEEDED");
  const held = new Set(allocations.map((row: any) => row.assetId));
  const bindingByPackage = new Map(bindings.map((row: any) => [row.packageId, row.assetId]));
  return packageIds.filter((id) => !bindingByPackage.has(id) || held.has(bindingByPackage.get(id)));
}

export async function packageSeatImpact(db: any, packageId: string, assetId: string, now = new Date()) {
  const asset = await db.studioInventoryAsset.findUnique({ where: { id: assetId },
    select: { id: true, title: true, kind: true, status: true, revision: true } });
  if (!asset || asset.status !== "active" || !["digital", "license"].includes(asset.kind))
    throw new Error("PACKAGE_SEAT_ASSET_UNAVAILABLE");
  const entitlements = await db.managedPackageEntitlement.findMany({ where: {
    packageId, revokedAt: null, expiresAt: { gt: now },
  }, select: { id: true, userId: true, revision: true, expiresAt: true },
    orderBy: { id: "asc" }, take: 501 });
  if (entitlements.length > 500) throw new Error("PACKAGE_SEAT_IMPACT_SCOPE_EXCEEDED");
  const users = [...new Set(entitlements.map((item: any) => item.userId))];
  const allocations = users.length ? await db.studioInventoryAllocation.findMany({ where: {
    assetId, userId: { in: users }, status: "active", quantity: { gte: 1 },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }, select: { id: true, userId: true, revision: true, expiresAt: true }, orderBy: { id: "asc" }, take: 5001 }) : [];
  if (allocations.length > 5000) throw new Error("PACKAGE_SEAT_IMPACT_ALLOCATION_SCOPE_EXCEEDED");
  const held = new Set(allocations.map((item: any) => item.userId));
  const covered = entitlements.filter((item: any) => held.has(item.userId)).length;
  const fingerprint = createHash("sha256").update(JSON.stringify({ packageId,
    asset: [asset.id, asset.revision, asset.kind, asset.status],
    entitlements: entitlements.map((item: any) => [item.id, item.userId, item.revision, new Date(item.expiresAt).toISOString()]),
    allocations: allocations.map((item: any) => [item.id, item.userId, item.revision, item.expiresAt ? new Date(item.expiresAt).toISOString() : null]),
  })).digest("hex");
  return { asset: { id: asset.id, title: asset.title, kind: asset.kind },
    activeGrants: entitlements.length, alreadyCovered: covered,
    accessWouldPause: entitlements.length - covered, fingerprint,
    existingPackageGrantsRemainUnchanged: true, secretsIncluded: false };
}

const identify = z.object({ id: z.string().min(1).max(160) });
const previewBody = z.object({ assetId: z.string().trim().min(1).max(160) }).strict();
const exposedImpactError = (cause: unknown) => cause instanceof Error && [
  "PACKAGE_SEAT_ASSET_UNAVAILABLE", "PACKAGE_SEAT_IMPACT_SCOPE_EXCEEDED",
  "PACKAGE_SEAT_IMPACT_ALLOCATION_SCOPE_EXCEEDED",
].includes(cause.message) ? cause.message : "PACKAGE_SEAT_PREVIEW_FAILED";
const bindBody = previewBody.extend({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(12).max(1000) }).strict();

export function registerManagedPackageSeatRoutes(deps: {
  app: any; prisma: any; admin: (req: any, reply: any) => Promise<any>;
  requireConfirmation: (req: any, reply: any, phrase: string) => boolean;
  audit: (db: any, actorId: string, action: string, subjectId: string, packageId: string, details: Record<string, unknown>) => Promise<void>;
  securityAudit: (req: any, actor: any, action: string, subjectId: string) => Promise<void>;
}) {
  const { app, prisma, admin, requireConfirmation, audit, securityAudit } = deps;
  app.get("/api/admin/packages/:id/seat-requirement", async (req: any, reply: any) => {
    if (!(await admin(req, reply))) return;
    const { id } = identify.parse(req.params);
    const packageRow = await prisma.managedPackage.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
    if (!packageRow || packageRow.archivedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_NOT_AVAILABLE" });
    const requirement = await prisma.managedPackageSeatRequirement.findUnique({ where: { packageId: id },
      select: { packageId: true, assetId: true, revision: true, reason: true, configuredById: true, createdAt: true,
        asset: { select: { title: true, kind: true, status: true } } } });
    reply.header("Cache-Control", "private, no-store");
    return { ok: true, requirement };
  });
  app.post("/api/admin/packages/:id/seat-requirement/preview", async (req: any, reply: any) => {
    if (!(await admin(req, reply))) return;
    const { id } = identify.parse(req.params), { assetId } = previewBody.parse(req.body || {});
    const pkg = await prisma.managedPackage.findUnique({ where: { id }, select: { archivedAt: true } });
    if (!pkg || pkg.archivedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_NOT_AVAILABLE" });
    if (await prisma.managedPackageSeatRequirement.findUnique({ where: { packageId: id } }))
      return reply.code(409).send({ ok: false, code: "PACKAGE_SEAT_REQUIREMENT_ALREADY_BOUND" });
    try {
      const impact = await packageSeatImpact(prisma, id, assetId);
      reply.header("Cache-Control", "private, no-store");
      return { ok: true, impact };
    } catch (cause) {
      return reply.code(409).send({ ok: false, code: exposedImpactError(cause) });
    }
  });
  app.post("/api/admin/packages/:id/seat-requirement", async (req: any, reply: any) => {
    const actor = await admin(req, reply); if (!actor) return;
    if (!requireConfirmation(req, reply, "REQUIRE INVENTORY SEAT")) return;
    const { id } = identify.parse(req.params), body = bindBody.parse(req.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const rows = await tx.$queryRaw`SELECT "id" FROM "ManagedPackage" WHERE "id" = ${id} FOR UPDATE`;
      if (!rows.length) return { code: "PACKAGE_NOT_AVAILABLE", status: 404 };
      const pkg = await tx.managedPackage.findUnique({ where: { id }, select: { archivedAt: true } });
      if (!pkg || pkg.archivedAt) return { code: "PACKAGE_NOT_AVAILABLE", status: 404 };
      // Lock the Inventory asset so its status cannot change while reviewed impact is committed.
      const assetRows = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAsset" WHERE "id" = ${body.assetId} FOR UPDATE`;
      if (!assetRows.length) return { code: "PACKAGE_SEAT_ASSET_UNAVAILABLE", status: 409 };
      if (await tx.managedPackageSeatRequirement.findUnique({ where: { packageId: id } }))
        return { code: "PACKAGE_SEAT_REQUIREMENT_ALREADY_BOUND", status: 409 };
      let impact;
      try { impact = await packageSeatImpact(tx, id, body.assetId); }
      catch (cause) { return { code: exposedImpactError(cause), status: 409 }; }
      if (impact.fingerprint !== body.expectedFingerprint)
        return { code: "PACKAGE_SEAT_IMPACT_STALE", status: 409 };
      const requirement = await tx.managedPackageSeatRequirement.create({ data: {
        packageId: id, assetId: body.assetId, revision: 1, reason: body.reason, configuredById: actor.id,
      }, select: { packageId: true, assetId: true, revision: true } });
      await audit(tx, actor.id, "inventory_seat_requirement_bound", id, id,
        { assetId: body.assetId, reason: body.reason, affectedGrants: impact.accessWouldPause,
          activeGrants: impact.activeGrants, reviewedFingerprint: impact.fingerprint });
      return { requirement, affectedGrants: impact.accessWouldPause };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await securityAudit(req, actor, "inventory_seat_requirement_bound", id);
    return reply.code(201).send({ ok: true, ...result });
  });
}

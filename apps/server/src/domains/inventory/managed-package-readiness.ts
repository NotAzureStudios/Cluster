import { z } from "zod";
import { readDevicePackageTargets } from "./managed-package-device.js";
import { packageSeatEligibleUsers } from "./managed-package-seat-policy.js";

// On-demand admin explanation of *present* recipient distribution eligibility.
// A preview never confers an entitlement, authorizes an installer, or provides
// source material, grant tokens, Vault values, secrets or device proof.
export type PackageReadinessReason =
  | "account_unavailable" | "package_unavailable" | "entitlement_missing"
  | "entitlement_revoked" | "entitlement_expired" | "inventory_seat_missing"
  | "device_unverified" | "release_or_dependency_unavailable" | "ready_for_distribution";

export async function inspectPackageRecipientReadiness(db: any, input: {
  packageId: string; userId: string; deviceRegistrationId: string;
  channel: "stable" | "beta" | "testing"; platform: "windows-x64" | "linux-x64" | "macos-arm64";
}, now = new Date()) {
  const [pkg, user, entitlement, seatRule, registration] = await Promise.all([
    db.managedPackage.findUnique({ where: { id: input.packageId }, select: { id: true, archivedAt: true, key: true } }),
    db.user.findUnique({ where: { id: input.userId }, select: { id: true, archived: true, accountState: true, accessExpiresAt: true } }),
    db.managedPackageEntitlement.findUnique({ where: {
      packageId_userId: { packageId: input.packageId, userId: input.userId } },
      select: { id: true, revokedAt: true, expiresAt: true, revision: true } }),
    db.managedPackageSeatRequirement.findUnique({ where: { packageId: input.packageId },
      select: { assetId: true, asset: { select: { id: true, title: true, status: true, kind: true } } } }),
    db.deviceRegistration.findUnique({ where: { id: input.deviceRegistrationId },
      select: { id: true, userId: true, platform: true, proofStatus: true, revokedAt: true, proofKeyFingerprint: true } }),
  ]);
  const grant = entitlement ? { revision: entitlement.revision, expiresAt: entitlement.expiresAt,
    active: !entitlement.revokedAt && new Date(entitlement.expiresAt) > now } : null;
  const seat = seatRule ? { required: true, assetId: seatRule.assetId,
    assetTitle: seatRule.asset?.title || null, assetKind: seatRule.asset?.kind || null,
    assetActive: seatRule.asset?.status === "active" } : { required: false };
  const verifiedDevice = Boolean(registration && registration.userId === input.userId && !registration.revokedAt
    && registration.platform === "desktop" && registration.proofStatus === "verified" && registration.proofKeyFingerprint);
  const base = { packageId: input.packageId, userId: input.userId, registrationId: input.deviceRegistrationId,
    asOf: now.toISOString(), entitlement: grant, inventory: seat,
    deviceVerified: verifiedDevice, target: null as null | { releaseId: string; version: string;
      platform: string; channel: string; selection: string; artifactSha256: string },
    evidence: "live_authorized_database_projection" as const, osAttested: false as const,
    installerExecutionAuthorized: false as const, secretMaterialIncluded: false as const };
  const result = (reason: PackageReadinessReason, overrides: Record<string, unknown> = {}) => ({
    ...base, ...overrides, reason, canRequestDistribution: reason === "ready_for_distribution",
  });
  if (!pkg || pkg.archivedAt) return result("package_unavailable");
  if (!user || user.archived || user.accountState !== "ACTIVE"
    || (user.accessExpiresAt && new Date(user.accessExpiresAt) <= now)) return result("account_unavailable");
  if (!entitlement) return result("entitlement_missing");
  if (entitlement.revokedAt) return result("entitlement_revoked");
  if (new Date(entitlement.expiresAt) <= now) return result("entitlement_expired");
  if (seatRule) {
    const eligible = await packageSeatEligibleUsers(db, input.packageId, [input.userId], now);
    if (!eligible.includes(input.userId)) return result("inventory_seat_missing");
  }
  if (!verifiedDevice) return result("device_unverified");
  // Full resolver rechecks policy, revocations, signature trust, dependencies,
  // individual prerequisite entitlements and their Inventory seats.
  const targets = await readDevicePackageTargets(db, { userId: input.userId,
    deviceRegistrationId: input.deviceRegistrationId, packageId: input.packageId,
    channel: input.channel, platform: input.platform });
  const matched = targets.find((item: any) => item.package.id === input.packageId);
  if (!matched) return result("release_or_dependency_unavailable");
  return result("ready_for_distribution", { target: {
    releaseId: matched.release.id, version: matched.release.version,
    platform: matched.release.platform, channel: input.channel, selection: matched.selection,
    artifactSha256: matched.release.artifactSha256,
  } });
}

const inputSchema = z.object({ userId: z.string().trim().min(1).max(160),
  deviceRegistrationId: z.string().trim().min(1).max(160),
  channel: z.enum(["stable", "beta", "testing"]),
  platform: z.enum(["windows-x64", "linux-x64", "macos-arm64"]),
}).strict();
export function registerManagedPackageReadinessRoutes(deps: {
  app: any; prisma: any; admin: (req: any, reply: any) => Promise<any>;
}) {
  const { app, prisma, admin } = deps;
  app.post("/api/admin/packages/:id/recipient-readiness/inspect", async (req: any, reply: any) => {
    if (!(await admin(req, reply))) return;
    const { id } = z.object({ id: z.string().min(1).max(160) }).strict().parse(req.params || {});
    const body = inputSchema.parse(req.body || {});
    reply.header("Cache-Control", "private, no-store");
    const inspection = await inspectPackageRecipientReadiness(prisma, { packageId: id, ...body });
    return { ok: true, inspection };
  });
}

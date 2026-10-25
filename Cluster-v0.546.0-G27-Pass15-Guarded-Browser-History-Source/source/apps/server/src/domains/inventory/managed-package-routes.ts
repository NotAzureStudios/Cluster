import { createHash } from "node:crypto";
import { publishPackageArtifact, readVerifiedPackageArtifact } from "./managed-package-artifact-store.js";
import { initialPackageRange, packageSegment, packageSegmentHeaders } from "./managed-package-segments.js";
import { z } from "zod";
import { registerManagedPackageEntitlementRoutes } from "./managed-package-entitlements.js";
import { packageSeatEligibleUsers, registerManagedPackageSeatRoutes } from "./managed-package-seat-policy.js";
import { registerManagedPackageReadinessRoutes } from "./managed-package-readiness.js";
import { mintPackageDeploymentGrant, readPackageDeploymentPrivateKey } from "./managed-package-grants.js";
import { requestDeviceProof } from "../sessions/device-proof.js";
import { devicePackageQuery, readDevicePackageTargets } from "./managed-package-device.js";
import { projectPackageReconciliation } from "./managed-package-reconciliation.js";
import { newPackageReceiptChallenge, packageDeviceTransitionAllowed, packageReceiptChallengeValid, packageDeviceReportedState, PACKAGE_DEVICE_REPORT_STATES } from "./managed-package-deployments.js";
import { packageKeyFingerprint, packageSigningInput, selectPackageTarget, validatePackageDependencies, validateSignedPackage, type ClusterPackageManifest } from "./managed-package-policy.js";

const keySchema = z.object({ label: z.string().trim().min(2).max(100), publicKeyPem: z.string().min(30).max(2000) }).strict();
const packageSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{2,79}$/), title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).default("") }).strict();
const manifestSchema = z.object({ schema: z.literal(1), packageKey: z.string(), version: z.string(), platform: z.enum(["windows-x64", "linux-x64", "macos-arm64"]), artifactSha256: z.string(), artifactSize: z.number().int(), filename: z.string(),
  dependencies: z.array(z.object({ packageKey: z.string(), version: z.string(), requirement: z.enum(["content-selected", "msi-installed"]) }).strict()).max(12).optional(),
  installer: z.object({ kind: z.literal("windows-msi"), path: z.string(), sha256: z.string(), productCode: z.string(), productVersion: z.string(), scope: z.literal("user") }).strict().optional() }).strict();
const releaseSchema = z.object({ manifest: manifestSchema, artifactBase64: z.string().max(44_800_000), signatureBase64: z.string().max(160), signingKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const rolloutSchema = z.object({ channel: z.enum(["stable", "beta", "testing"]), releaseId: z.string().min(1), percentage: z.number().int().min(0).max(100), state: z.enum(["active", "paused"]), expectedRevision: z.number().int().min(0) }).strict();
const pinSchema = z.object({ deviceId: z.string().trim().min(3).max(160), releaseId: z.string().min(1), reason: z.string().trim().min(8).max(1000), expectedRevision: z.number().int().min(0) }).strict();
const unpinSchema = z.object({ deviceId: z.string().min(3).max(160), expectedRevision: z.number().int().positive() }).strict();
const archiveSchema = z.object({ reason: z.string().trim().min(8).max(1000) }).strict();
const idParam = z.object({ id: z.string().min(1).max(160) });
const pkgParam = z.object({ id: z.string().min(1).max(160), releaseId: z.string().min(1).max(160) });
const pkgPublic = { id: true, key: true, title: true, description: true, createdAt: true, archivedAt: true } as const;
const releaseArtifactSelect = { artifact: true, artifactSha256: true, artifactSize: true, artifactStorageProvider: true, artifactStorageTier: true, artifactStorageKey: true,
  revokedAt: true, manifestJson: true, signature: true, manifestSha256: true, signingKeyFingerprint: true } as const;
const releasePublic = { id: true, packageId: true, version: true, platform: true, filename: true, artifactSize: true, artifactSha256: true, manifestSha256: true, signingKeyFingerprint: true, publishedAt: true, revokedAt: true, revocationReason: true } as const;
const keyPublic = { fingerprint: true, label: true, createdAt: true, disabledAt: true } as const;

/** Signed Package distribution control plane. Device downloads are evidence of
 * delivery, NOT executable installation or an attested successful update. */
export function registerManagedPackageRoutes(deps: any) {
  const { app, prisma, storageRuntime, authorization, requireConfirmation, logSecurityEvent, getCurrentSession } = deps;
  async function admin(request: any, reply: any) {
    reply.header("Cache-Control", "private, no-store");
    return authorization.requireAdmin(request, reply);
  }
  async function audit(db: any, actorId: string, action: string, subjectId: string, packageId: string | null = null, details: Record<string, unknown> = {}) {
    await db.managedPackageAuditEvent.create({ data: { actorId, action, subjectId, packageId, detailsJson: JSON.stringify(details) } });
  }
  async function securityAudit(request: any, actor: any, action: string, subjectId: string) {
    await logSecurityEvent({ event: `package.${action}`, actorUserId: actor.id, targetUserId: null, result: "SUCCESS", reasonCode: "MANAGED_PACKAGE", request, metadata: { subjectId } });
  }
  registerManagedPackageEntitlementRoutes({ app, prisma, admin, requireConfirmation, audit, securityAudit });
  registerManagedPackageSeatRoutes({ app, prisma, admin, requireConfirmation, audit, securityAudit });
  registerManagedPackageReadinessRoutes({ app, prisma, admin });
  async function packageFor(id: string, db = prisma) {
    return db.managedPackage.findUnique({ where: { id }, select: pkgPublic });
  }
  async function releaseFor(releaseId: string, packageId: string, db = prisma) {
    return db.managedPackageRelease.findFirst({ where: { id: releaseId, packageId }, select: releasePublic });
  }
  const deviceQuerySchema = z.object({ channel: z.enum(devicePackageQuery.channels).default("stable"), platform: z.enum(devicePackageQuery.platforms) }).strict();
  const deviceDownloadBody = z.object({ channel: z.enum(devicePackageQuery.channels).default("stable"), platform: z.enum(devicePackageQuery.platforms) }).strict();
  const resumeBodySchema = z.object({
    channel: z.enum(devicePackageQuery.channels), platform: z.enum(devicePackageQuery.platforms),
    deploymentId: z.string().min(1).max(160), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    start: z.number().int().min(0), end: z.number().int().min(0),
  }).strict();
  const recoverBodySchema = z.object({
    channel: z.enum(devicePackageQuery.channels), platform: z.enum(devicePackageQuery.platforms),
    deploymentId: z.string().min(1).max(160), artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict();
  const receiptBodySchema = z.object({
    eventId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    state: z.enum(PACKAGE_DEVICE_REPORT_STATES),
    observedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    detail: z.string().trim().max(400).default(""),
  }).strict();
  async function authorizedDevice(request: any, reply: any) {
    reply.header("Cache-Control", "private, no-store");
    const session = await getCurrentSession(request);
    if (!session) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" }); return null; }
    const proof = requestDeviceProof(request);
    if (!proof?.verified || !proof.deviceId || !proof.keyFingerprint || proof.deviceId !== session.deviceId) {
      reply.code(403).send({ ok: false, code: "PACKAGE_DEVICE_PROOF_REQUIRED" }); return null;
    }
    const registration = await prisma.deviceRegistration.findUnique({
      where: { userId_deviceId: { userId: session.userId, deviceId: proof.deviceId } },
      select: { id: true, userId: true, deviceId: true, platform: true, proofStatus: true, proofKeyFingerprint: true, revokedAt: true },
    });
    if (!registration || registration.revokedAt || registration.platform !== "desktop" || registration.proofStatus !== "verified"
      || registration.proofKeyFingerprint !== proof.keyFingerprint) {
      reply.code(403).send({ ok: false, code: "PACKAGE_DEVICE_UNTRUSTED" }); return null;
    }
    return { userId: session.userId, registrationId: registration.id, fingerprint: proof.keyFingerprint };
  }

  // This feed is for cryptographically device-bound Desktop sessions, not web browsers.
  // The native agent must still enforce a separately provisioned trust root and sandboxed install policy.
  app.get("/api/me/packages/targets", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const query = deviceQuerySchema.parse(request.query || {});
    const targets = await readDevicePackageTargets(prisma, { userId: device.userId, deviceRegistrationId: device.registrationId, ...query });
    return { ok: true, targets, nativeInstallationAvailable: process.env.CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL === "true", nativeRepairAvailable: process.env.CLUSTER_ALLOW_SUPERVISED_MSI_REPAIR === "true", nativeUninstallAvailable: process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UNINSTALL === "true", nativeUpgradeAvailable: process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS === "true" && process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION === "true", nativeRollbackAvailable: process.env.CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_GRANTS === "true" && process.env.CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION === "true", executionReceiptsSupported: false };
  });

  // POST rather than URL query secrets. We always re-evaluate the *current* rollout,
  // device pin, key trust and release revocation before returning signed ZIP bytes.
  app.post("/api/me/packages/:id/releases/:releaseId/download", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const query = deviceDownloadBody.parse(request.body || {});
    // A ranged first request creates exactly one deployment offer and lease.
    // Invalid ranges are rejected before any offer or audit record is created.
    const rawRange = request.headers.range;
    if (rawRange !== undefined && (typeof rawRange !== "string" || !/^bytes=0-\d{1,12}$/.test(rawRange)))
      return reply.code(416).send({ ok: false, code: "PACKAGE_SEGMENT_INVALID" });
    const outcome = await prisma.$transaction(async (tx: any) => {
      // Prevent delivery after a device has been revoked during the request.
      const registration = await tx.deviceRegistration.findUnique({ where: { id: device.registrationId },
        select: { revokedAt: true, proofStatus: true, proofKeyFingerprint: true, userId: true } });
      if (!registration || registration.revokedAt || registration.proofStatus !== "verified" || registration.proofKeyFingerprint !== device.fingerprint || registration.userId !== device.userId)
        return { code: "PACKAGE_DEVICE_REVOKED", status: 403 };
      const targets = await readDevicePackageTargets(tx, { userId: device.userId, deviceRegistrationId: device.registrationId, packageId: id, ...query });
      const target = targets.find((item: any) => item.release.id === releaseId);
      if (!target) return { code: "PACKAGE_RELEASE_NOT_ENTITLED", status: 404 };
      const record = await tx.managedPackageRelease.findUnique({ where: { id: releaseId }, select: releaseArtifactSelect });
      if (!record || record.revokedAt) return { code: "PACKAGE_RELEASE_NOT_ENTITLED", status: 404 };
      // Ranges are validated before any offer is created. The stored CAS object
      // is streamed and fully SHA-256 verified before an authorized slice leaves.
      let initialRange = null;
      try { initialRange = initialPackageRange(rawRange, target.release.artifactSize); }
      catch { return { code: "PACKAGE_SEGMENT_INVALID", status: 416 }; }
      let verifiedBytes: Buffer;
      try { verifiedBytes = await readVerifiedPackageArtifact(storageRuntime, record, target.manifest,
        target.signingPublicKeyPem, initialRange || undefined); }
      catch { return { code: "PACKAGE_ARTIFACT_INTEGRITY_FAILED", status: 409 }; }
      // Do not swallow database failures: transaction must roll back on failed
      // audit or deployment insertion instead of persisting an untracked offer.
      // Bound per-device storage consumption even when downloads are repeated.
        // Serializable transaction protects the count/insert predicate from races.
        const recentOffers = await tx.managedPackageDeviceDeployment.count({ where: {
          deviceRegistrationId: device.registrationId, offeredAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        } });
        if (recentOffers >= 20) return { code: "PACKAGE_DEVICE_DOWNLOAD_RATE_LIMITED", status: 429 };
        const lease = newPackageReceiptChallenge();
        const deployment = await tx.managedPackageDeviceDeployment.create({ data: {
          packageId: id, releaseId, deviceRegistrationId: device.registrationId,
          userId: device.userId, channel: query.channel, state: "offered",
          challengeHash: lease.challengeHash, challengeExpiresAt: lease.expiresAt,
          artifactSha256: target.release.artifactSha256,
        }, select: { id: true } });
        await audit(tx, device.userId, "artifact_device_offered", releaseId, id,
          { deploymentId: deployment.id, registrationId: device.registrationId, sha256: target.release.artifactSha256, channel: query.channel, selection: target.selection });
        return { bytes: verifiedBytes, total: target.release.artifactSize, filename: target.release.filename,
          sha256: target.release.artifactSha256, deploymentId: deployment.id, receiptChallenge: lease.challenge };
    }, { isolationLevel: "Serializable" });
    if ("code" in outcome) return reply.code(outcome.status).send({ ok: false, code: outcome.code });
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${outcome.filename}"`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Cluster-Package-SHA256", outcome.sha256);
    // Native-only opaque challenge. Never persist or log the plaintext.
    reply.header("X-Cluster-Package-Deployment-ID", outcome.deploymentId);
    reply.header("X-Cluster-Package-Receipt-Challenge", outcome.receiptChallenge);
    if (rawRange !== undefined) {
      let range;
      try { range = initialPackageRange(rawRange, outcome.total); }
      catch { return reply.code(416).send({ ok: false, code: "PACKAGE_SEGMENT_INVALID" }); }
      if (!range) return reply.code(416).send({ ok: false, code: "PACKAGE_SEGMENT_INVALID" });
      for (const [key, value] of Object.entries(packageSegmentHeaders(range))) reply.header(key, value);
      return reply.code(206).send(outcome.bytes);
    }
    return reply.send(outcome.bytes);
  });

  // Resume an existing offered download without minting new deployment grants,
  // receipt challenges, or device-offer records. A leaked/stale lease alone is
  // not authorization: device proof and recipient entitlements are checked on
  // *every* segment. The receipt nonce is still only held in renderer memory.
  app.post("/api/me/packages/:id/releases/:releaseId/download/resume", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const body = resumeBodySchema.parse(request.body || {});
    const outcome = await prisma.$transaction(async (tx: any) => {
      const registration = await tx.deviceRegistration.findUnique({ where: { id: device.registrationId },
        select: { revokedAt: true, proofStatus: true, proofKeyFingerprint: true, userId: true } });
      if (!registration || registration.revokedAt || registration.proofStatus !== "verified"
        || registration.proofKeyFingerprint !== device.fingerprint || registration.userId !== device.userId)
        return { status: 403, code: "PACKAGE_DEVICE_REVOKED" };
      const offer = await tx.managedPackageDeviceDeployment.findUnique({ where: { id: body.deploymentId },
        select: { id: true, packageId: true, releaseId: true, userId: true, deviceRegistrationId: true,
          state: true, artifactSha256: true, challengeHash: true, challengeExpiresAt: true } });
      if (!offer || offer.userId !== device.userId || offer.deviceRegistrationId !== device.registrationId
        || offer.packageId !== id || offer.releaseId !== releaseId || offer.state !== "offered"
        || !offer.challengeHash || !offer.challengeExpiresAt
        || !packageReceiptChallengeValid(body.challenge, offer.challengeHash, offer.challengeExpiresAt))
        return { status: 403, code: "PACKAGE_DOWNLOAD_LEASE_INVALID" };
      const targets = await readDevicePackageTargets(tx, { userId: device.userId,
        deviceRegistrationId: device.registrationId, packageId: id, channel: body.channel, platform: body.platform });
      const target = targets.find((item: any) => item.release.id === releaseId);
      if (!target || target.release.artifactSha256 !== offer.artifactSha256)
        return { status: 404, code: "PACKAGE_RELEASE_NOT_ENTITLED" };
      const record = await tx.managedPackageRelease.findUnique({ where: { id: releaseId }, select: releaseArtifactSelect });
      if (!record || record.revokedAt) return { status: 404, code: "PACKAGE_RELEASE_NOT_ENTITLED" };
      let range;
      try { range = packageSegment(body.start, body.end, target.release.artifactSize); }
      catch { return { status: 416, code: "PACKAGE_SEGMENT_INVALID" }; }
      let bytes: Buffer;
      try { bytes = await readVerifiedPackageArtifact(storageRuntime, record, target.manifest, target.signingPublicKeyPem, range); }
      catch { return { status: 409, code: "PACKAGE_ARTIFACT_INTEGRITY_FAILED" }; }
      return { bytes, range, sha256: offer.artifactSha256 };
    }, { isolationLevel: "Serializable" });
    if ("code" in outcome) return reply.code(outcome.status).send({ ok: false, code: outcome.code });
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Type", "application/zip");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Cluster-Package-SHA256", outcome.sha256);
    for (const [key, value] of Object.entries(packageSegmentHeaders(outcome.range))) reply.header(key, value);
    return reply.code(206).send(outcome.bytes);
  });

  // Restart-safe reauthorization for an existing device-bound offer. The
  // workstation may persist only deployment ID/hash plus its local verified
  // disk progress, NEVER the receipt challenge. A renewed challenge revokes
  // the former one. Device identity, current entitlement and signed content
  // are all rechecked; no new deployment offer is created.
  app.post("/api/me/packages/:id/releases/:releaseId/download/recover", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const body = recoverBodySchema.parse(request.body || {});
    const outcome = await prisma.$transaction(async (tx: any) => {
      const registration = await tx.deviceRegistration.findUnique({ where: { id: device.registrationId },
        select: { revokedAt: true, proofStatus: true, proofKeyFingerprint: true, userId: true } });
      if (!registration || registration.revokedAt || registration.proofStatus !== "verified"
        || registration.proofKeyFingerprint !== device.fingerprint || registration.userId !== device.userId)
        return { status: 403, code: "PACKAGE_DEVICE_REVOKED" };
      const offer = await tx.managedPackageDeviceDeployment.findUnique({ where: { id: body.deploymentId },
        select: { packageId: true, releaseId: true, userId: true, deviceRegistrationId: true,
          state: true, artifactSha256: true, challengeHash: true, offeredAt: true, channel: true, recoveryCount: true } });
      if (!offer || offer.userId !== device.userId || offer.deviceRegistrationId !== device.registrationId
        || offer.packageId !== id || offer.releaseId !== releaseId || offer.channel !== body.channel
        || offer.artifactSha256 !== body.artifactSha256 || offer.state !== "offered"
        || !offer.challengeHash || offer.recoveryCount >= 5 ||
        Date.now() - new Date(offer.offeredAt).getTime() > 24 * 60 * 60 * 1000 ||
        new Date(offer.offeredAt).getTime() > Date.now() + 30_000)
        return { status: 403, code: "PACKAGE_DOWNLOAD_RECOVERY_DENIED" };
      const targets = await readDevicePackageTargets(tx, { userId: device.userId, deviceRegistrationId: device.registrationId,
        packageId: id, channel: body.channel, platform: body.platform });
      const target = targets.find((item: any) => item.release.id === releaseId && item.release.artifactSha256 === offer.artifactSha256);
      if (!target) return { status: 404, code: "PACKAGE_RELEASE_NOT_ENTITLED" };
      const record = await tx.managedPackageRelease.findUnique({ where: { id: releaseId }, select: releaseArtifactSelect });
      if (!record || record.revokedAt) return { status: 404, code: "PACKAGE_RELEASE_NOT_ENTITLED" };
      try { await readVerifiedPackageArtifact(storageRuntime, record, target.manifest, target.signingPublicKeyPem, { start: 0, end: 0 }); }
      catch { return { status: 409, code: "PACKAGE_ARTIFACT_INTEGRITY_FAILED" }; }
      const renewed = newPackageReceiptChallenge();
      const rotated = await tx.managedPackageDeviceDeployment.updateMany({ where: {
        id: body.deploymentId, userId: device.userId, deviceRegistrationId: device.registrationId, state: "offered",
        challengeHash: offer.challengeHash, recoveryCount: { lt: 5 },
      }, data: { challengeHash: renewed.challengeHash, challengeExpiresAt: renewed.expiresAt,
        recoveryCount: { increment: 1 } } });
      if (rotated.count !== 1) return { status: 409, code: "PACKAGE_DOWNLOAD_RECOVERY_RACE" };
      await audit(tx, device.userId, "artifact_device_transfer_reauthorized", releaseId, id,
        { deploymentId: body.deploymentId, registrationId: device.registrationId, sha256: offer.artifactSha256 });
      return { deploymentId: body.deploymentId, receiptChallenge: renewed.challenge, expiresAt: renewed.expiresAt.toISOString() };
    }, { isolationLevel: "Serializable" });
    if ("code" in outcome) return reply.code(outcome.status).send({ ok: false, code: outcome.code });
    return { ok: true, ...outcome };
  });

  // Short-lived bearer capability for an unprivileged managed-content operation.
  // This is independently signed with the deployment control key, never the
  // release publisher key. It is not OS attestation or an arbitrary installer.
  app.post("/api/me/packages/:id/releases/:releaseId/authorize-content", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const body = z.object({ channel: z.enum(devicePackageQuery.channels),
      platform: z.enum(devicePackageQuery.platforms), operation: z.enum(["deploy", "rollback", "install", "repair", "uninstall", "upgrade", "msi-rollback"]), priorReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), priorMsiSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), upgradeJournalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), successorMsiSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(request.body || {});
    if (body.operation === "install" || body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback") {
      // OS installation is opt-in, and must never reuse a content-only grant.
      if (body.operation === "msi-rollback" ? (process.env.CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_GRANTS !== "true" || process.env.CLUSTER_ALLOW_SUPERVISED_MSI_ROLLBACK_EXECUTION !== "true")
        : body.operation === "upgrade" ? (process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS !== "true" || process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION !== "true")
        : body.operation === "repair" ? process.env.CLUSTER_ALLOW_SUPERVISED_MSI_REPAIR !== "true"
        : body.operation === "uninstall" ? process.env.CLUSTER_ALLOW_SUPERVISED_MSI_UNINSTALL !== "true"
        : process.env.CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL !== "true")
        return reply.code(403).send({ ok: false, code: "PACKAGE_MSI_LIFECYCLE_DISABLED" });
      if (body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback" ? !body.priorReceiptSha256 : !!body.priorReceiptSha256)
        return reply.code(400).send({ ok: false, code: "PACKAGE_MSI_PRIOR_RECEIPT_REQUIRED" });
      if (body.operation === "upgrade" || body.operation === "msi-rollback" ? !body.priorMsiSha256 : !!body.priorMsiSha256)
        return reply.code(400).send({ ok: false, code: "PACKAGE_MSI_PRIOR_SOURCE_SHA_REQUIRED" });
      if (body.operation === "msi-rollback" ? (!body.upgradeJournalSha256 || !body.successorMsiSha256)
        : !!body.upgradeJournalSha256 || !!body.successorMsiSha256)
        return reply.code(400).send({ ok: false, code: "PACKAGE_MSI_ROLLBACK_CUSTODY_REQUIRED" });
      if (!(await admin(request, reply))) return;
    }
    let controlPrivateKey: string | undefined;
    try { controlPrivateKey = readPackageDeploymentPrivateKey(); }
    catch { return reply.code(503).send({ ok: false, code: "PACKAGE_DEPLOYMENT_AUTHORITY_UNAVAILABLE" }); }
    if (!controlPrivateKey)
      return reply.code(503).send({ ok: false, code: "PACKAGE_DEPLOYMENT_AUTHORITY_UNCONFIGURED" });
    const result = await prisma.$transaction(async (tx: any) => {
      const registration = await tx.deviceRegistration.findUnique({ where: { id: device.registrationId },
        select: { userId: true, revokedAt: true, proofStatus: true, proofKeyFingerprint: true } });
      if (!registration || registration.revokedAt || registration.userId !== device.userId || registration.proofStatus !== "verified"
        || registration.proofKeyFingerprint !== device.fingerprint)
        return { status: 403, code: "PACKAGE_DEVICE_REVOKED" };
      const targets = await readDevicePackageTargets(tx, { userId: device.userId, deviceRegistrationId: device.registrationId,
        packageId: id, channel: body.channel, platform: body.platform });
      const target = targets.find((item: any) => item.release.id === releaseId);
      if (!target) return { status: 409, code: "PACKAGE_DEPLOYMENT_NOT_ENTITLED" };
      if (body.operation === "install" || body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback") {
        const installer = target.manifest.installer;
        if (!installer || installer.kind !== "windows-msi" || installer.scope !== "user"
          || target.release.platform !== "windows-x64")
          return { status: 409, code: "PACKAGE_MSI_MANIFEST_UNAVAILABLE" };
      }
      // Avoid indefinite token minting from an authenticated but malfunctioning client.
      const issuedRecently = await tx.managedPackageAuditEvent.count({ where: {
        actorId: device.userId, action: "deployment_grant_issued", packageId: id,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      } });
      if (issuedRecently >= 5) return { status: 429, code: "PACKAGE_DEPLOYMENT_GRANT_RATE_LIMITED" };
      let grant: ReturnType<typeof mintPackageDeploymentGrant>;
      try {
        grant = mintPackageDeploymentGrant({ operation: body.operation, packageKey: target.package.key,
          version: target.release.version, platform: target.release.platform,
          artifactSha256: target.release.artifactSha256, signingKeySha256: target.release.signingKeyFingerprint,
          ...(body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback" ? { priorReceiptSha256: body.priorReceiptSha256 } : {}),
          ...(body.operation === "upgrade" || body.operation === "msi-rollback" ? { priorMsiSha256: body.priorMsiSha256 } : {}),
          ...(body.operation === "msi-rollback" ? { upgradeJournalSha256: body.upgradeJournalSha256, successorMsiSha256: body.successorMsiSha256 } : {}),
          releaseId: target.release.id, registrationId: device.registrationId, userId: device.userId },
          controlPrivateKey);
      } catch { return { status: 503, code: "PACKAGE_DEPLOYMENT_AUTHORITY_UNAVAILABLE" }; }
      await audit(tx, device.userId, "deployment_grant_issued", releaseId, id,
        { operation: body.operation, deviceRegistrationId: device.registrationId, expiresAt: grant.expiresAt,
          ...(body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback" ? { priorReceiptSha256: body.priorReceiptSha256 } : {}),
          ...(body.operation === "upgrade" || body.operation === "msi-rollback" ? { priorMsiSha256: body.priorMsiSha256 } : {}),
          ...(body.operation === "msi-rollback" ? { upgradeJournalSha256: body.upgradeJournalSha256, successorMsiSha256: body.successorMsiSha256 } : {}),
          artifactSha256: target.release.artifactSha256, controlKeyFingerprint: grant.controlKeyFingerprint });
      return { grant };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    return reply.send({ ok: true, grant: result.grant, purpose: body.operation === "repair" ? "supervised_user_msi_repair" : body.operation === "uninstall" ? "supervised_user_msi_uninstall" : body.operation === "msi-rollback" ? "supervised_user_msi_rollback" : body.operation === "upgrade" ? "supervised_user_msi_upgrade" : body.operation === "install" ? "supervised_user_msi_install" : "managed_content_only",
      osAttested: false, executableInstallationAllowed: body.operation === "install" || body.operation === "repair" || body.operation === "uninstall" || body.operation === "upgrade" || body.operation === "msi-rollback" });
  });

  // A device can report its own progress; it cannot attest OS install success.
  // Every transition consumes a single-use, expiring challenge and a revision.
  app.post("/api/me/packages/deployments/:deploymentId/receipts", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const { deploymentId } = z.object({ deploymentId: z.string().min(1).max(160) }).parse(request.params || {});
    const body = receiptBodySchema.parse(request.body || {});
    const outcome = await prisma.$transaction(async (tx: any) => {
      const registration = await tx.deviceRegistration.findUnique({ where: { id: device.registrationId },
        select: { userId: true, proofKeyFingerprint: true, proofStatus: true, revokedAt: true } });
      if (!registration || registration.revokedAt || registration.proofStatus !== "verified" || registration.userId !== device.userId || registration.proofKeyFingerprint !== device.fingerprint)
        return { code: "PACKAGE_DEVICE_REVOKED", status: 403 };
      const deployment = await tx.managedPackageDeviceDeployment.findUnique({ where: { id: deploymentId } });
      if (!deployment || deployment.deviceRegistrationId !== device.registrationId || deployment.userId !== device.userId)
        return { code: "PACKAGE_DEPLOYMENT_NOT_FOUND", status: 404 };
      if (deployment.revision !== body.expectedRevision || !packageReceiptChallengeValid(body.challenge, deployment.challengeHash, deployment.challengeExpiresAt))
        return { code: "PACKAGE_RECEIPT_EXPIRED_OR_REPLAYED", status: 409 };
      if (!packageDeviceTransitionAllowed(deployment.state, body.state))
        return { code: "PACKAGE_RECEIPT_INVALID_TRANSITION", status: 409 };
      if (body.observedSha256 !== deployment.artifactSha256)
        return { code: "PACKAGE_RECEIPT_ARTIFACT_MISMATCH", status: 409 };
      // A release withdrawn since download may receive a failure/rollback report,
      // but never a new positive-stage report.
      if (!["failed", "rolled_back"].includes(body.state)) {
        const targets = await readDevicePackageTargets(tx, { userId: device.userId, deviceRegistrationId: device.registrationId,
          packageId: deployment.packageId, platform: (await tx.managedPackageRelease.findUnique({ where: { id: deployment.releaseId }, select: { platform: true } }))?.platform || "", channel: deployment.channel });
        if (!targets.some((item: any) => item.release.id === deployment.releaseId))
          return { code: "PACKAGE_RELEASE_NO_LONGER_ENTITLED", status: 409 };
      }
      const next = newPackageReceiptChallenge();
      const changed = await tx.managedPackageDeviceDeployment.updateMany({ where: {
        id: deploymentId, revision: body.expectedRevision, challengeHash: deployment.challengeHash, state: deployment.state,
      }, data: { state: body.state, revision: { increment: 1 }, challengeHash: next.challengeHash,
        challengeExpiresAt: next.expiresAt, lastReportedAt: new Date() } });
      if (!changed.count) return { code: "PACKAGE_RECEIPT_REVISION_CONFLICT", status: 409 };
      await tx.managedPackageDeviceReceipt.create({ data: { deploymentId, eventId: body.eventId,
        sequence: body.expectedRevision + 1, state: body.state, reportedArtifactSha256: body.observedSha256, detail: body.detail } });
      await audit(tx, device.userId, "device_installation_state_reported", deploymentId, deployment.packageId,
        { registrationId: device.registrationId, releaseId: deployment.releaseId, state: body.state, evidence: "device_report" });
      return { ok: true, deploymentId, revision: body.expectedRevision + 1, nextChallenge: next.challenge,
        report: packageDeviceReportedState(body.state) };
    }, { isolationLevel: "Serializable" });
    if ("code" in outcome) return reply.code(outcome.status).send({ ok: false, code: outcome.code });
    return reply.send(outcome);
  });

  // Recipient-safe projection of its own reports. No challenge hashes, actor
  // credentials, or artifact bytes are returned in any catalogue.
  app.get("/api/me/packages/deployments", async (request: any, reply: any) => {
    const device = await authorizedDevice(request, reply); if (!device) return;
    const deployments = await prisma.managedPackageDeviceDeployment.findMany({
      where: { deviceRegistrationId: device.registrationId, userId: device.userId },
      select: { id: true, packageId: true, releaseId: true, state: true, revision: true, artifactSha256: true,
        offeredAt: true, lastReportedAt: true }, orderBy: { offeredAt: "desc" }, take: 50,
    });
    return { ok: true, deployments: deployments.map((entry: any) => ({ ...entry, evidence: "device_report", osAttested: false })) };
  });

  // On-demand paginated rollout reconciliation. This is an operator-facing
  // sample of authenticated registrations and self-reported progress, NOT
  // installation attestation. No ZIP bytes, challenges or private keys leave.
  app.get("/api/admin/packages/:id/reconciliation", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id } = idParam.parse(request.params || {});
    const query = z.object({ channel: z.enum(devicePackageQuery.channels).default("stable"),
      platform: z.enum(devicePackageQuery.platforms),
      cursor: z.string().min(1).max(160).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().parse(request.query || {});
    const pkg = await packageFor(id);
    if (!pkg || pkg.archivedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_NOT_FOUND" });
    const registrations = await prisma.deviceRegistration.findMany({
      where: { platform: "desktop", proofStatus: "verified", revokedAt: null,
        proofKeyFingerprint: { not: null }, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      select: { id: true, userId: true, label: true, lastSeenAt: true },
      orderBy: { id: "asc" }, take: query.limit + 1,
    });
    const hasMore = registrations.length > query.limit;
    const page = registrations.slice(0, query.limit);
    if (!page.length) return { ok: true, channel: query.channel, platform: query.platform,
      ...projectPackageReconciliation({ pkg, policy: null, pins: [], releases: [], signingKeys: [],
        registrations: [], deployments: [], channel: query.channel, platform: query.platform }),
      nextCursor: null, sampledDeploymentRows: 0, evidenceTruncated: false,
      scope: "verified-desktop-registration-page", platformIsDeviceAttested: false };
    const registrationIds = page.map((row: any) => row.id);
    const activeEntitlements = await prisma.managedPackageEntitlement.findMany({ where: {
      packageId: id, userId: { in: page.map((row: any) => row.userId) },
      revokedAt: null, expiresAt: { gt: new Date() },
    }, select: { userId: true } });
    const entitledUsers = new Set(activeEntitlements.map((row: any) => row.userId));
    const entitlementEligibleUsers = await prisma.user.findMany({ where: {
      id: { in: [...entitledUsers] }, archived: false,
      accountState: "ACTIVE",
      OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: new Date() } }],
    }, select: { id: true } });
    const seatEligible = await packageSeatEligibleUsers(prisma, id, entitlementEligibleUsers.map((row: any) => row.id), new Date());
    const eligibleUsers = new Set(seatEligible);
    const [policy, pins] = await Promise.all([
      prisma.managedPackageRollout.findUnique({ where: { packageId_channel: { packageId: id, channel: query.channel } },
        select: { packageId: true, releaseId: true, state: true, percentage: true } }),
      prisma.managedPackagePin.findMany({ where: { packageId: id, active: true, deviceId: { in: registrationIds } },
        select: { packageId: true, deviceId: true, releaseId: true, active: true } }),
    ]);
    const releaseIds = [...new Set([...(policy ? [policy.releaseId] : []), ...pins.map((row: any) => row.releaseId)])];
    const releases = releaseIds.length ? await prisma.managedPackageRelease.findMany({
      where: { id: { in: releaseIds }, packageId: id, revokedAt: null },
      select: { id: true, packageId: true, version: true, platform: true, filename: true,
        artifactSize: true, artifactSha256: true, manifestJson: true, manifestSha256: true,
        signature: true, signingKeyFingerprint: true, publishedAt: true, revokedAt: true },
    }) : [];
    const signingKeys = releases.length ? await prisma.managedPackageSigningKey.findMany({
      where: { fingerprint: { in: [...new Set(releases.map((row: any) => row.signingKeyFingerprint))] }, disabledAt: null },
      select: { fingerprint: true, publicKeyPem: true, disabledAt: true },
    }) : [];
    // Bound the query even if one device repeatedly downloads packages.
    const deployments = await prisma.managedPackageDeviceDeployment.findMany({
      where: { packageId: id, deviceRegistrationId: { in: registrationIds } },
      select: { deviceRegistrationId: true, releaseId: true, state: true, lastReportedAt: true, offeredAt: true },
      orderBy: [{ offeredAt: "desc" }, { id: "desc" }], take: 1001,
    });
    const projection = projectPackageReconciliation({ pkg, policy, pins, releases, signingKeys,
      registrations: page, entitledUserIds: [...eligibleUsers], deployments: deployments.slice(0, 1000), channel: query.channel, platform: query.platform });
    return { ok: true, channel: query.channel, platform: query.platform, ...projection,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      sampledDeploymentRows: Math.min(deployments.length, 1000), evidenceTruncated: deployments.length > 1000,
      scope: "verified-desktop-registration-page", platformIsDeviceAttested: false };
  });

  app.get("/api/admin/packages/:id/deployments", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id } = idParam.parse(request.params || {});
    const deployments = await prisma.managedPackageDeviceDeployment.findMany({ where: { packageId: id },
      select: { id: true, releaseId: true, deviceRegistrationId: true, userId: true, channel: true, state: true,
        revision: true, artifactSha256: true, offeredAt: true, lastReportedAt: true,
        reports: { select: { eventId: true, sequence: true, state: true, detail: true, reportedAt: true },
          orderBy: { sequence: "asc" }, take: 20 } },
      orderBy: { offeredAt: "desc" }, take: 100 });
    return { ok: true, evidence: "device_report", osAttested: false, deployments };
  });

  app.get("/api/admin/packages", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const packages = await prisma.managedPackage.findMany({ select: { ...pkgPublic, releases: { select: { ...releasePublic, manifestJson: true }, orderBy: { publishedAt: "desc" }, take: 25 }, policies: { select: { channel: true, releaseId: true, state: true, percentage: true, revision: true } } }, where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
    // Admin gets signed dependency identifiers, not the full signed manifest or artifact.
    return { ok: true, packages: packages.map((pkg: any) => ({ ...pkg, releases: pkg.releases.map(({ manifestJson, ...release }: any) => {
      let dependencies: { packageKey: string; version: string; requirement: "content-selected" | "msi-installed" }[] = [];
      let dependencyMetadataValid = true;
      try {
        const manifest = JSON.parse(manifestJson) as ClusterPackageManifest;
        if (manifest.packageKey !== pkg.key || manifest.version !== release.version || manifest.platform !== release.platform)
          throw new Error("PACKAGE_MANIFEST_IDENTITY_MISMATCH");
        dependencies = validatePackageDependencies(manifest);
        const computedHash = createHash("sha256").update(packageSigningInput(manifest)).digest("hex");
        if (computedHash !== release.manifestSha256) throw new Error("PACKAGE_MANIFEST_HASH_MISMATCH");
      } catch { dependencyMetadataValid = false; dependencies = []; }
      return { ...release, dependencies, dependencyMetadataValid };
    }) })) };
  });
  app.get("/api/admin/packages/signing-keys", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    return { ok: true, keys: await prisma.managedPackageSigningKey.findMany({ select: keyPublic, orderBy: { createdAt: "desc" }, take: 100 }) };
  });
  app.post("/api/admin/packages/signing-keys", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "TRUST PACKAGE KEY")) return;
    const body = keySchema.parse(request.body || {});
    let fingerprint: string;
    try { fingerprint = packageKeyFingerprint(body.publicKeyPem); } catch { return reply.code(400).send({ ok: false, code: "PACKAGE_KEY_INVALID" }); }
    const record = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.managedPackageSigningKey.findUnique({ where: { fingerprint }, select: { fingerprint: true } });
      if (existing) return null;
      const key = await tx.managedPackageSigningKey.create({ data: { fingerprint, label: body.label, publicKeyPem: body.publicKeyPem }, select: keyPublic });
      await audit(tx, actor.id, "key_trusted", fingerprint);
      return key;
    });
    if (!record) return reply.code(409).send({ ok: false, code: "PACKAGE_KEY_ALREADY_TRUSTED" });
    await securityAudit(request, actor, "key_trusted", fingerprint);
    return reply.code(201).send({ ok: true, key: record });
  });
  app.post("/api/admin/packages/signing-keys/:id/disable", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "DISABLE PACKAGE KEY")) return;
    const { id } = idParam.parse(request.params || {});
    const { reason } = archiveSchema.parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.managedPackageSigningKey.updateMany({ where: { fingerprint: id, disabledAt: null }, data: { disabledAt: new Date() } });
      if (!changed.count) return false;
      const affected = await tx.managedPackageRelease.findMany({ where: { signingKeyFingerprint: id, revokedAt: null }, select: { id: true } });
      await tx.managedPackageRelease.updateMany({ where: { signingKeyFingerprint: id, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: `Signing key disabled: ${reason}` } });
      if (affected.length) {
        await tx.managedPackageRollout.updateMany({ where: { releaseId: { in: affected.map((r: any) => r.id) } }, data: { state: "paused", revision: { increment: 1 } } });
        await tx.managedPackagePin.updateMany({ where: { releaseId: { in: affected.map((r: any) => r.id) }, active: true }, data: { active: false, revision: { increment: 1 } } });
      }
      await audit(tx, actor.id, "key_disabled", id, null, { reason, affectedReleases: affected.length });
      return true;
    });
    if (!result) return reply.code(404).send({ ok: false, code: "PACKAGE_KEY_NOT_ACTIVE" });
    await securityAudit(request, actor, "key_disabled", id);
    return { ok: true };
  });
  app.post("/api/admin/packages", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const body = packageSchema.parse(request.body || {});
    const record = await prisma.$transaction(async (tx: any) => {
      const row = await tx.managedPackage.create({ data: { ...body, createdById: actor.id }, select: pkgPublic });
      await audit(tx, actor.id, "package_created", row.id, row.id);
      return row;
    });
    await securityAudit(request, actor, "created", record.id);
    return reply.code(201).send({ ok: true, package: record });
  });
  app.post("/api/admin/packages/:id/releases", { bodyLimit: 46_000_000 }, async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = idParam.parse(request.params || {});
    const body = releaseSchema.parse(request.body || {});
    const pkg = await packageFor(id);
    if (!pkg || pkg.archivedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_NOT_FOUND" });
    if (body.manifest.packageKey !== pkg.key) return reply.code(400).send({ ok: false, code: "PACKAGE_IDENTITY_MISMATCH" });
    const key = await prisma.managedPackageSigningKey.findUnique({ where: { fingerprint: body.signingKeyFingerprint }, select: { publicKeyPem: true, disabledAt: true } });
    if (!key || key.disabledAt) return reply.code(403).send({ ok: false, code: "PACKAGE_SIGNING_KEY_UNTRUSTED" });
    let checked: ReturnType<typeof validateSignedPackage>;
    try { checked = validateSignedPackage({ ...body, manifest: body.manifest as ClusterPackageManifest, publicKeyPem: key.publicKeyPem }); }
    catch (err) { return reply.code(400).send({ ok: false, code: err instanceof Error ? err.message : "PACKAGE_INVALID" }); }
    if (checked.keyFingerprint !== body.signingKeyFingerprint) return reply.code(403).send({ ok: false, code: "PACKAGE_SIGNING_KEY_MISMATCH" });
    // Persist immutable verified bytes before publishing the row. Failure to
    // commit can leave an unreferenced hash-object; never delete it here.
    let blobFields: { artifactStorageProvider: string; artifactStorageTier: string; artifactStorageKey: string } | null = null;
    if (storageRuntime) {
      try { blobFields = await publishPackageArtifact(storageRuntime, checked.bytes, body.manifest.artifactSha256); }
      catch { return reply.code(503).send({ ok: false, code: "PACKAGE_BLOB_STORAGE_UNAVAILABLE" }); }
    }
    const row = await prisma.$transaction(async (tx: any) => {
      const liveKey = await tx.managedPackageSigningKey.findUnique({ where: { fingerprint: body.signingKeyFingerprint } });
      const livePkg = await tx.managedPackage.findUnique({ where: { id } });
      if (!liveKey || liveKey.disabledAt || !livePkg || livePkg.archivedAt) return null;
      // A signed dependency cannot point at an unavailable, archived, or revoked release.
      // Target resolution later rechecks the full graph and recipient entitlement.
      for (const dep of body.manifest.dependencies || []) {
        const required = await tx.managedPackage.findUnique({ where: { key: dep.packageKey }, select: { id: true, archivedAt: true } });
        if (!required || required.archivedAt) return null;
        const available = await tx.managedPackageRelease.findFirst({ where: {
          packageId: required.id, version: dep.version, platform: body.manifest.platform, revokedAt: null,
        }, select: { id: true, manifestJson: true } });
        if (!available) return null;
        if (dep.requirement === "msi-installed") {
          // The prerequisite is a separately signed Windows MSI release. A
          // managed-content-only prerequisite cannot satisfy this contract.
          let requiredManifest: ClusterPackageManifest;
          try { requiredManifest = JSON.parse(available.manifestJson); }
          catch { return null; }
          if (!requiredManifest.installer || requiredManifest.installer.kind !== "windows-msi"
            || requiredManifest.installer.scope !== "user"
            || requiredManifest.packageKey !== dep.packageKey || requiredManifest.version !== dep.version
            || requiredManifest.platform !== "windows-x64") return null;
        }
      }
      const release = await tx.managedPackageRelease.create({ data: { packageId: id, version: body.manifest.version, platform: body.manifest.platform, filename: body.manifest.filename, artifactSize: checked.bytes.length, artifact: blobFields ? null : checked.bytes, ...(blobFields || {}), artifactSha256: body.manifest.artifactSha256, manifestJson: checked.manifestJson, manifestSha256: checked.manifestSha256, signature: body.signatureBase64, signingKeyFingerprint: body.signingKeyFingerprint, publishedById: actor.id }, select: releasePublic });
      await audit(tx, actor.id, "release_published", release.id, id, { version: release.version, platform: release.platform, sha256: release.artifactSha256 });
      return release;
    });
    if (!row) return reply.code(409).send({ ok: false, code: "PACKAGE_DEPENDENCY_UNAVAILABLE_OR_REVOKED" });
    await securityAudit(request, actor, "release_published", row.id);
    return reply.code(201).send({ ok: true, release: row });
  });
  app.post("/api/admin/packages/:id/releases/:releaseId/revoke", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!requireConfirmation(request, reply, "REVOKE PACKAGE RELEASE")) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const { reason } = archiveSchema.parse(request.body || {});
    const changed = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.managedPackageRelease.updateMany({ where: { id: releaseId, packageId: id, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: reason } });
      if (!updated.count) return false;
      await tx.managedPackageRollout.updateMany({ where: { releaseId }, data: { state: "paused", revision: { increment: 1 } } });
      await tx.managedPackagePin.updateMany({ where: { releaseId, active: true }, data: { active: false, revision: { increment: 1 } } });
      await audit(tx, actor.id, "release_revoked", releaseId, id, { reason });
      return true;
    });
    if (!changed) return reply.code(404).send({ ok: false, code: "PACKAGE_RELEASE_UNAVAILABLE" });
    await securityAudit(request, actor, "release_revoked", releaseId);
    return { ok: true };
  });
  app.put("/api/admin/packages/:id/rollouts", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = idParam.parse(request.params || {});
    const body = rolloutSchema.parse(request.body || {});
    // One serializable decision per package/channel. An observed revision is mandatory.
    const result = await prisma.$transaction(async (tx: any) => {
      const release = await releaseFor(body.releaseId, id, tx);
      const pkg = await packageFor(id, tx);
      const key = release && await tx.managedPackageSigningKey.findUnique({ where: { fingerprint: release.signingKeyFingerprint }, select: { disabledAt: true } });
      if (!release || !pkg || pkg.archivedAt || release.revokedAt || !key || key.disabledAt) return { status: 409, code: "PACKAGE_RELEASE_UNAVAILABLE" };
      const where = { packageId_channel: { packageId: id, channel: body.channel } };
      const previous = await tx.managedPackageRollout.findUnique({ where });
      if (Number(previous?.revision || 0) !== body.expectedRevision) return { status: 409, code: "PACKAGE_ROLLOUT_REVISION_CONFLICT" };
      let rollout: any;
      if (previous) {
        const count = await tx.managedPackageRollout.updateMany({ where: { id: previous.id, revision: body.expectedRevision }, data: { releaseId: release.id, percentage: body.percentage, state: body.state, revision: { increment: 1 }, changedById: actor.id } });
        if (!count.count) return { status: 409, code: "PACKAGE_ROLLOUT_REVISION_CONFLICT" };
        rollout = await tx.managedPackageRollout.findUnique({ where });
      } else {
        rollout = await tx.managedPackageRollout.create({ data: { packageId: id, channel: body.channel, releaseId: release.id, percentage: body.percentage, state: body.state, changedById: actor.id } });
      }
      await audit(tx, actor.id, "rollout_changed", rollout.id, id, { fromRelease: previous?.releaseId || null, toRelease: release.id, state: rollout.state, percentage: rollout.percentage, revision: rollout.revision });
      return { rollout };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await securityAudit(request, actor, "rollout_changed", result.rollout.id);
    return { ok: true, ...result };
  });
  app.get("/api/admin/packages/:id/targets/:deviceId", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id, deviceId } = z.object({ id: z.string().min(1), deviceId: z.string().min(3).max(160) }).parse(request.params || {});
    const pkg = await packageFor(id);
    if (!pkg || pkg.archivedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_NOT_FOUND" });
    const query = z.object({ platform: z.enum(["windows-x64", "linux-x64", "macos-arm64"]), channel: z.enum(["stable", "beta", "testing"]).default("stable") }).parse(request.query || {});
    const [policy, pin, device] = await Promise.all([
      prisma.managedPackageRollout.findUnique({ where: { packageId_channel: { packageId: id, channel: query.channel } }, include: { release: { select: releasePublic } } }),
      prisma.managedPackagePin.findUnique({ where: { packageId_deviceId: { packageId: id, deviceId } }, include: { release: { select: releasePublic } } }),
      prisma.deviceRegistration.findUnique({ where: { id: deviceId }, select: { revokedAt: true, proofStatus: true } }),
    ]);
    const selectedReleaseId = selectPackageTarget({ packageId: id, deviceId, platform: query.platform, policy, release: policy?.release || null, pinned: pin?.active && !pin.release.revokedAt ? pin.release : null });
    const selected = selectedReleaseId && await prisma.managedPackageRelease.findUnique({ where: { id: selectedReleaseId }, select: releasePublic });
    const signingKey = selected && await prisma.managedPackageSigningKey.findUnique({ where: { fingerprint: selected.signingKeyFingerprint }, select: { disabledAt: true } });
    // Admin preview only; this endpoint cannot be used as an unauthenticated installer feed.
    const trustedDevice = device?.proofStatus === "verified" && !device?.revokedAt;
    return { ok: true, selected: trustedDevice && signingKey && !signingKey.disabledAt ? selected : null, trustedDevice: Boolean(trustedDevice), policy: policy ? { state: policy.state, percentage: policy.percentage, revision: policy.revision } : null, pinned: pin ? { active: pin.active, revision: pin.revision, releaseId: pin.releaseId, reason: pin.reason } : null, nativeInstallationAvailable: false };
  });
  app.put("/api/admin/packages/:id/pins", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = idParam.parse(request.params || {});
    const body = pinSchema.parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const release = await releaseFor(body.releaseId, id, tx);
      const key = release && await tx.managedPackageSigningKey.findUnique({ where: { fingerprint: release.signingKeyFingerprint }, select: { disabledAt: true } });
      if (!release || release.revokedAt || !key || key.disabledAt) return { status: 409, code: "PACKAGE_RELEASE_UNAVAILABLE" };
      // Pins are tied to a verified per-user DeviceRegistration primary key, not an arbitrary caller string.
      const registration = await tx.deviceRegistration.findUnique({ where: { id: body.deviceId }, select: { revokedAt: true, proofStatus: true } });
      if (!registration || registration.revokedAt || registration.proofStatus !== "verified") return { status: 409, code: "PACKAGE_DEVICE_NOT_VERIFIED" };
      const where = { packageId_deviceId: { packageId: id, deviceId: body.deviceId } };
      const previous = await tx.managedPackagePin.findUnique({ where });
      if (Number(previous?.revision || 0) !== body.expectedRevision) return { status: 409, code: "PACKAGE_PIN_REVISION_CONFLICT" };
      let pin: any;
      if (previous) {
        const changed = await tx.managedPackagePin.updateMany({ where: { id: previous.id, revision: body.expectedRevision }, data: { releaseId: release.id, reason: body.reason, active: true, changedById: actor.id, revision: { increment: 1 } } });
        if (!changed.count) return { status: 409, code: "PACKAGE_PIN_REVISION_CONFLICT" };
        pin = await tx.managedPackagePin.findUnique({ where });
      } else pin = await tx.managedPackagePin.create({ data: { packageId: id, deviceId: body.deviceId, releaseId: release.id, reason: body.reason, changedById: actor.id } });
      await audit(tx, actor.id, "pin_changed", pin.id, id, { deviceId: body.deviceId, fromRelease: previous?.releaseId || null, toRelease: release.id, revision: pin.revision });
      return { pin };
    }, { isolationLevel: "Serializable" });
    if ("code" in result) return reply.code(result.status).send({ ok: false, code: result.code });
    await securityAudit(request, actor, "pin_changed", result.pin.id);
    return { ok: true, ...result };
  });
  app.post("/api/admin/packages/:id/pins/remove", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id } = idParam.parse(request.params || {});
    const body = unpinSchema.parse(request.body || {});
    const result = await prisma.$transaction(async (tx: any) => {
      const changed = await tx.managedPackagePin.updateMany({ where: { packageId: id, deviceId: body.deviceId, active: true, revision: body.expectedRevision }, data: { active: false, revision: { increment: 1 } } });
      if (!changed.count) return false;
      await audit(tx, actor.id, "pin_removed", body.deviceId, id);
      return true;
    });
    if (!result) return reply.code(409).send({ ok: false, code: "PACKAGE_PIN_REVISION_CONFLICT" });
    await securityAudit(request, actor, "pin_removed", body.deviceId);
    return { ok: true };
  });
  app.get("/api/admin/packages/:id/audit", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const { id } = idParam.parse(request.params || {});
    const events = await prisma.managedPackageAuditEvent.findMany({ where: { packageId: id }, select: { action: true, subjectId: true, actorId: true, detailsJson: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return { ok: true, events: events.map((event: any) => ({ ...event, details: JSON.parse(event.detailsJson), detailsJson: undefined })) };
  });
  app.get("/api/admin/packages/:id/releases/:releaseId/artifact", async (request: any, reply: any) => {
    const actor = await admin(request, reply); if (!actor) return;
    const { id, releaseId } = pkgParam.parse(request.params || {});
    const release = await prisma.managedPackageRelease.findFirst({ where: { id: releaseId, packageId: id }, select: { ...releasePublic, ...releaseArtifactSelect } });
    if (!release || release.revokedAt) return reply.code(404).send({ ok: false, code: "PACKAGE_RELEASE_UNAVAILABLE" });
    const key = await prisma.managedPackageSigningKey.findUnique({ where: { fingerprint: release.signingKeyFingerprint }, select: { publicKeyPem: true, disabledAt: true } });
    if (!key || key.disabledAt) return reply.code(403).send({ ok: false, code: "PACKAGE_SIGNING_KEY_UNTRUSTED" });
    const manifest = JSON.parse(release.manifestJson) as ClusterPackageManifest;
    let verifiedBytes: Buffer;
    try { verifiedBytes = await readVerifiedPackageArtifact(storageRuntime, release, manifest, key.publicKeyPem); }
    catch { return reply.code(409).send({ ok: false, code: "PACKAGE_ARTIFACT_INTEGRITY_FAILED" }); }
    await audit(prisma, actor.id, "artifact_admin_downloaded", release.id, id, { releaseId: release.id });
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${release.filename}"`);
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(verifiedBytes);
  });
}

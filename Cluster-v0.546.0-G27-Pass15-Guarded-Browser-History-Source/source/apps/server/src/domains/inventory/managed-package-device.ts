import { packageSeatEligibleIds } from "./managed-package-seat-policy.js";
import { createHash, createPublicKey, verify } from "node:crypto";
import { packageKeyFingerprint, packageSigningInput, selectPackageTarget, validatePackageDependencies, validatePackageInstaller, type ClusterPackageManifest } from "./managed-package-policy.js";

export const devicePackageQuery = {
  channels: ["stable", "beta", "testing"],
  platforms: ["windows-x64", "linux-x64", "macos-arm64"],
} as const;

type Source = {
  packages: any[];
  policies: any[];
  pins: any[];
  releases: any[];
  signingKeys: any[];
};

/** A device's allow-list is computed from canonical active rollouts and pins.
 * Only signed, unrevoked, unarchived, platform-matched releases are exposed.
 * No source package bytes or private signing key material enter this projection.
 */
export function projectDevicePackageTargets(source: Source, input: { deviceRegistrationId: string; platform: string; channel: string }) {
  const policies = new Map(source.policies.map((row) => [row.packageId, row]));
  const pins = new Map(source.pins.filter((row) => row.active).map((row) => [row.packageId, row]));
  const releases = new Map(source.releases.map((row) => [row.id, row]));
  const keys = new Map(source.signingKeys.map((row) => [row.fingerprint, row]));
  const targets = [] as any[];
  for (const pkg of source.packages) {
    if (pkg.archivedAt) continue;
    const policy = policies.get(pkg.id);
    const pin = pins.get(pkg.id);
    const selectedId = selectPackageTarget({
      packageId: pkg.id, deviceId: input.deviceRegistrationId, platform: input.platform,
      policy, release: policy ? releases.get(policy.releaseId) || null : null,
      pinned: pin ? releases.get(pin.releaseId) || null : null,
    });
    const release = selectedId ? releases.get(selectedId) : null;
    if (!release || release.packageId !== pkg.id || release.revokedAt) continue;
    const signingKey = keys.get(release.signingKeyFingerprint);
    if (!signingKey || signingKey.disabledAt) continue;
    let manifest: ClusterPackageManifest;
    try {
      manifest = JSON.parse(release.manifestJson);
      if (manifest.schema !== 1 || manifest.packageKey !== pkg.key || manifest.version !== release.version || manifest.platform !== release.platform
        || manifest.artifactSha256 !== release.artifactSha256 || manifest.artifactSize !== release.artifactSize
        || manifest.filename !== release.filename || manifest.artifactSize > (manifest.installer ? 32 : 4) * 1024 * 1024) continue;
      validatePackageDependencies(manifest);
      validatePackageInstaller(manifest);
      const signingInput = packageSigningInput(manifest);
      if (createHash("sha256").update(signingInput).digest("hex") !== release.manifestSha256) continue;
      if (packageKeyFingerprint(signingKey.publicKeyPem) !== release.signingKeyFingerprint) continue;
      const key = createPublicKey(signingKey.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519" || !verify(null, signingInput, key, Buffer.from(release.signature, "base64"))) continue;
    } catch { continue; }
    targets.push({
      package: { id: pkg.id, key: pkg.key, title: pkg.title, description: pkg.description },
      release: { id: release.id, version: release.version, platform: release.platform, filename: release.filename,
        artifactSize: release.artifactSize, artifactSha256: release.artifactSha256, manifestSha256: release.manifestSha256,
        signingKeyFingerprint: release.signingKeyFingerprint, publishedAt: release.publishedAt },
      manifest, signatureBase64: release.signature, signingPublicKeyPem: signingKey.publicKeyPem,
      channel: input.channel, selection: pin && pin.releaseId === release.id ? "device_pin" : "rollout",
      installationState: "unknown", // No workstation attestation or fake installed receipt.
    });
  }
  // Dependency graph must be fulfilled entirely by the recipient's own
  // currently signed, unrevoked and entitled targets. Cycles fail closed.
  const byKey = new Map(targets.map((target) => [target.package.key, target]));
  const accepted = new Map<string, boolean>();
  const visiting = new Set<string>();
  const allowed = (key: string): boolean => {
    if (accepted.has(key)) return accepted.get(key)!;
    if (visiting.has(key)) return false;
    const target = byKey.get(key);
    if (!target) return false;
    visiting.add(key);
    const ready = (target.manifest.dependencies || []).every((dep: { packageKey: string; version: string; requirement: "content-selected" | "msi-installed" }) => {
      const dependency = byKey.get(dep.packageKey);
      return dependency?.release.version === dep.version
        && (dep.requirement !== "msi-installed" || (target.release.platform === "windows-x64"
          && dependency?.manifest.installer?.kind === "windows-msi"
          && dependency?.manifest.installer?.scope === "user"))
        && allowed(dep.packageKey);
    });
    visiting.delete(key);
    accepted.set(key, ready);
    return ready;
  };
  // Present prerequisites before dependents so Desktop can guide deliberate,
  // one-release-at-a-time staging. This is NOT an auto-installer or a grant.
  const ordered: typeof targets = [];
  const emitted = new Set<string>();
  const visit = (target: (typeof targets)[number]) => {
    if (emitted.has(target.package.key) || !allowed(target.package.key)) return;
    for (const dep of target.manifest.dependencies || []) {
      const prerequisite = byKey.get(dep.packageKey);
      if (prerequisite) visit(prerequisite);
    }
    emitted.add(target.package.key);
    ordered.push(target);
  };
  for (const target of targets) visit(target);
  return ordered;
}

/** Read a bounded collection. Fetch only metadata, never artifact bytes, for catalogue requests. */
export async function readDevicePackageTargets(db: any, input: { userId: string; deviceRegistrationId: string; platform: string; channel: string; packageId?: string }) {
  const now = new Date();
  const user = await db.user.findUnique({ where: { id: input.userId },
    select: { archived: true, accountState: true, accessExpiresAt: true } });
  if (!user || user.archived || user.accountState !== "ACTIVE"
    || (user.accessExpiresAt && new Date(user.accessExpiresAt) <= now)) return [];
  const entitlements = await db.managedPackageEntitlement.findMany({ where: {
    userId: input.userId, revokedAt: null, expiresAt: { gt: now },
  }, select: { packageId: true }, take: 501 });
  const rawIds = [...new Set(entitlements.map((row: any) => row.packageId))];
  if (entitlements.length > 500) throw new Error("PACKAGE_DEVICE_ENTITLEMENT_SCOPE_EXCEEDED");
  const eligibleIds = await packageSeatEligibleIds(db, rawIds, input.userId, now);
  if (!eligibleIds.length) return [];
  const packages = await db.managedPackage.findMany({
    where: { archivedAt: null, id: { in: eligibleIds } },
    select: { id: true, key: true, title: true, description: true, archivedAt: true },
    orderBy: { key: "asc" }, take: 500,
  });
  if (!packages.length) return [];
  const ids = packages.map((p: any) => p.id);
  const [policies, pins] = await Promise.all([
    db.managedPackageRollout.findMany({ where: { packageId: { in: ids }, channel: input.channel }, select: { packageId: true, releaseId: true, percentage: true, state: true } }),
    db.managedPackagePin.findMany({ where: { packageId: { in: ids }, deviceId: input.deviceRegistrationId, active: true }, select: { packageId: true, releaseId: true, active: true } }),
  ]);
  const releaseIds = [...new Set([...policies.map((p: any) => p.releaseId), ...pins.map((p: any) => p.releaseId)])];
  if (!releaseIds.length) return [];
  const releases = await db.managedPackageRelease.findMany({
    where: { id: { in: releaseIds }, revokedAt: null },
    select: { id: true, packageId: true, version: true, platform: true, filename: true, artifactSize: true,
      artifactSha256: true, manifestJson: true, manifestSha256: true, signature: true, signingKeyFingerprint: true,
      publishedAt: true, revokedAt: true },
  });
  const signingKeys = releases.length ? await db.managedPackageSigningKey.findMany({
    where: { fingerprint: { in: [...new Set(releases.map((r: any) => r.signingKeyFingerprint))] }, disabledAt: null },
    select: { fingerprint: true, publicKeyPem: true, disabledAt: true },
  }) : [];
  const targets = projectDevicePackageTargets({ packages, policies, pins, releases, signingKeys }, input);
  if (!targets.length) return targets;
  // Device reports are diagnostic hints only, NEVER trusted OS installation
  // state. Read recent entries in one bounded query, not a query per Package.
  const recent = await db.managedPackageDeviceDeployment.findMany({
    where: { deviceRegistrationId: input.deviceRegistrationId, packageId: { in: targets.map((t: any) => t.package.id) } },
    select: { packageId: true, releaseId: true, state: true, lastReportedAt: true, offeredAt: true },
    orderBy: { offeredAt: "desc" }, take: 100,
  });
  const latest = new Map<string, any>();
  for (const row of recent) if (!latest.has(row.packageId)) latest.set(row.packageId, row);
  return targets.filter((item: any) => !input.packageId || item.package.id === input.packageId).map((item: any) => {
    const reported = latest.get(item.package.id);
    return { ...item, deviceReported: reported ? {
      releaseId: reported.releaseId, state: reported.state, reportedAt: reported.lastReportedAt,
      evidence: "device_report", osAttested: false,
    } : null };
  });
}

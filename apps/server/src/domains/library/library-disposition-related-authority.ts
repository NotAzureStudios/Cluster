import { createHash } from "node:crypto";

/** R65: Correlated authority from OTHER storage domains. A matching content
 * checksum indicates related bytes, not an identical storage object, and is
 * NEVER proof that a Library object can be quarantined or reclaimed. */
export const LIBRARY_RELATED_AUTHORITY_LIMITS = {
  contentDigests: 128, matchesPerModel: 256, publishedReleases: 256,
} as const;

type DigestEvidence = { source: string; id: string; checksum: unknown };
function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export async function inspectRelatedLibraryStorageAuthority(input: {
  prisma: any; itemId: string; content: DigestEvidence[]; check: () => Promise<void>;
}) {
  const { prisma, itemId, check } = input;
  if (input.content.length > LIBRARY_RELATED_AUTHORITY_LIMITS.contentDigests)
    throw new Error("LIBRARY_RELATED_DIGEST_LIMIT: no complete report produced");
  const digests = [...new Set(input.content.filter((entry) => validDigest(entry.checksum))
    .map((entry) => String(entry.checksum).toLowerCase()))].sort();
  const missingDigest = input.content.some((entry) => !validDigest(entry.checksum));
  const scan = async (model: "managedBlob" | "uploadSession", select: Record<string, boolean>) => {
    await check();
    if (!digests.length) return [];
    const result = await prisma[model].findMany({
      where: { checksumSha256: { in: digests, mode: "insensitive" } },
      select, orderBy: { id: "asc" }, take: LIBRARY_RELATED_AUTHORITY_LIMITS.matchesPerModel + 1,
    });
    if (result.length > LIBRARY_RELATED_AUTHORITY_LIMITS.matchesPerModel)
      throw new Error("LIBRARY_RELATED_MATCH_LIMIT: no complete report produced");
    return result;
  };
  const managed = await scan("managedBlob", {
    id: true, checksumSha256: true, storageProvider: true, storageTier: true,
    referenceCount: true, gcState: true, updatedAt: true,
  });
  const uploads = await scan("uploadSession", {
    id: true, checksumSha256: true, status: true, storageProvider: true,
    storageTier: true, expiresAt: true, updatedAt: true,
  });
  await check();
  // Packet derivatives are immutable Bytes in PostgreSQL, not local Library
  // paths. Do not mistake a published source reference for a file-system owner.
  const releases = await prisma.packetRelease.findMany({
    where: { manifestJson: { contains: `"sourceId":"${itemId}"` } },
    select: { id: true, versionLabel: true, revokedAt: true, manifestSha256: true },
    orderBy: { id: "asc" }, take: LIBRARY_RELATED_AUTHORITY_LIMITS.publishedReleases + 1,
  });
  if (releases.length > LIBRARY_RELATED_AUTHORITY_LIMITS.publishedReleases)
    throw new Error("LIBRARY_RELATED_RELEASE_LIMIT: no complete report produced");
  await check();
  const derivativeCount = releases.length ? await prisma.packetReleaseDerivative.count({
    where: { releaseId: { in: releases.map((row: any) => row.id) } },
  }) : 0;
  const blockers = new Set<string>([
    "MANAGED_STORAGE_GENERATIONS_UNVERIFIED", "ACTIVE_UPLOAD_ADMISSION_UNFENCED",
    "PACKET_PUBLICATION_FRESHNESS_UNFENCED", "BACKUP_SNAPSHOT_RETENTION_UNVERIFIED",
  ]);
  if (missingDigest) blockers.add("CONTENT_CHECKSUM_INCOMPLETE");
  if (managed.length) blockers.add("CORRELATED_MANAGED_BLOB_CONTENT");
  if (uploads.length) blockers.add("CORRELATED_UPLOAD_SESSION_CONTENT");
  if (releases.length) blockers.add("IMMUTABLE_PACKET_SOURCE_REFERENCE");
  const evidence = {
    correlation: "content-sha256-only-not-storage-location-ownership",
    knownDigests: digests.length, contentPointersWithoutVerifiedDigest: input.content.filter((row) => !validDigest(row.checksum)).length,
    managedBlobs: managed.map((row: any) => ({ id: row.id, checksumSha256: String(row.checksumSha256).toLowerCase(),
      provider: row.storageProvider, tier: row.storageTier, referenceCount: row.referenceCount,
      gcState: row.gcState, updatedAt: row.updatedAt })),
    uploadSessions: uploads.map((row: any) => ({ id: row.id,
      checksumSha256: String(row.checksumSha256).toLowerCase(), status: row.status,
      provider: row.storageProvider, tier: row.storageTier,
      expiresAt: row.expiresAt, updatedAt: row.updatedAt })),
    publishedReleases: releases.map((row: any) => ({ id: row.id, versionLabel: row.versionLabel,
      manifestSha256: row.manifestSha256, revokedAt: row.revokedAt })),
    publishedDerivativeRows: derivativeCount,
  };
  return {
    ...evidence, fingerprint: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    blockers: [...blockers].sort(),
    // Matched SQL records are evidence, not proof that the *provider* or its
    // snapshots, object generations, multipart uploads and GC leases are safe.
    correlatedRecordsCompleteWithinLimits: true, providerGenerationVerified: false,
    uploadAdmissionFenced: false, backupRetentionVerified: false,
    quarantineAllowed: false, physicalDisposalAllowed: false,
  };
}

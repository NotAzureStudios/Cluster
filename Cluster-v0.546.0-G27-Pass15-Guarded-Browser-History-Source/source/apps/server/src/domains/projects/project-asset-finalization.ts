import { recordEfficiencyMetric } from "../../core/efficiency-metrics.js";
import { acquireTransactionAdvisoryLock } from "../../core/postgres-advisory-lock.js";

const VERSION_LABEL_PATTERN = /^v\d+$/i;

export type AssetDuplicatePolicy = "keep" | "reuse" | "reject";

type FinalizeProjectAssetInput = {
  projectId: string;
  title: string;
  description?: string | null;
  category: string;
  assetRole: string;
  status: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  versionGroupId?: string | null;
  versionLabel?: string | null;
  derivedFromId?: string | null;
  proxyOfId?: string | null;
  exportOfId?: string | null;
  duplicatePolicy: AssetDuplicatePolicy;
  checksumSha256: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById?: string | null;
  ingestSessionId?: string | null;
  managedBlob?: {
    workspaceId: string;
    storageProvider: string;
    storageTier: string;
    storageKey: string;
    reused?: boolean;
  } | null;
};

type FinalizeProjectAssetResult = {
  file: any;
  duplicateReused: boolean;
  duplicateRejected: boolean;
  idempotentReplay: boolean;
};

async function advisoryLock(tx: any, key: string) {
  await acquireTransactionAdvisoryLock(tx, key);
}

function normalizedVersionLabel(input: string | null | undefined, versionNumber: number) {
  const trimmed = String(input || "").trim();
  if (!trimmed || VERSION_LABEL_PATTERN.test(trimmed)) return `v${versionNumber}`;
  return trimmed.slice(0, 80);
}

export async function finalizeProjectAssetRecord(prisma: any, input: FinalizeProjectAssetInput): Promise<FinalizeProjectAssetResult> {
  const result = await prisma.$transaction(async (tx: any) => {
    if (input.ingestSessionId) {
      await advisoryLock(tx, `cluster-asset-ingest:${input.ingestSessionId}`);
      const existing = await tx.projectFile.findUnique({ where: { ingestSessionId: input.ingestSessionId } });
      if (existing) return { file: existing, duplicateReused: false, duplicateRejected: false, idempotentReplay: true };
    }

    await advisoryLock(tx, `cluster-asset-checksum:${input.projectId}:${input.checksumSha256}`);
    const duplicate = await tx.projectFile.findFirst({
      where: { projectId: input.projectId, archived: false, checksumSha256: input.checksumSha256 },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (duplicate && input.duplicatePolicy === "reuse") return { file: duplicate, duplicateReused: true, duplicateRejected: false, idempotentReplay: false };
    if (duplicate && input.duplicatePolicy === "reject") return { file: duplicate, duplicateReused: false, duplicateRejected: true, idempotentReplay: false };

    let managedBlob: any = null;
    if (input.managedBlob) {
      await advisoryLock(tx, `cluster-managed-blob:${input.managedBlob.workspaceId}:${input.checksumSha256}`);
      const existingBlob = await tx.managedBlob.findUnique({
        where: { workspaceId_checksumSha256: { workspaceId: input.managedBlob.workspaceId, checksumSha256: input.checksumSha256 } },
      });
      if (existingBlob) {
        const locked = await tx.managedBlob.updateMany({
          where: { id: existingBlob.id, gcState: "ACTIVE" },
          data: {
            sizeBytes: BigInt(Math.max(0, Math.trunc(input.sizeBytes))),
            mimeType: input.mimeType,
            updatedAt: new Date(),
          },
        });
        if (locked.count !== 1) {
          throw Object.assign(new Error("Managed source content is being reclaimed. Retry the upload finalization."), { code: "MANAGED_BLOB_GC_BUSY", statusCode: 409 });
        }
        managedBlob = await tx.managedBlob.findUnique({ where: { id: existingBlob.id } });
      } else {
        managedBlob = await tx.managedBlob.create({
          data: {
            workspaceId: input.managedBlob.workspaceId,
            checksumSha256: input.checksumSha256,
            sizeBytes: BigInt(Math.max(0, Math.trunc(input.sizeBytes))),
            mimeType: input.mimeType,
            storageProvider: input.managedBlob.storageProvider,
            storageTier: input.managedBlob.storageTier,
            storageKey: input.managedBlob.storageKey,
            referenceCount: 0,
            gcState: "ACTIVE",
          },
        });
      }
    }

    let versionGroupId = input.versionGroupId || null;
    let versionNumber = 1;
    if (versionGroupId) {
      const requestedGroupId = versionGroupId;
      const anchor = await tx.projectFile.findFirst({
        where: { projectId: input.projectId, OR: [{ id: requestedGroupId }, { versionGroupId: requestedGroupId }] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, versionGroupId: true },
      });
      if (!anchor) throw Object.assign(new Error("The requested asset version family no longer exists."), { code: "ASSET_VERSION_FAMILY_MISSING", statusCode: 409 });
      versionGroupId = anchor.versionGroupId || anchor.id;
      await advisoryLock(tx, `cluster-asset-version:${input.projectId}:${versionGroupId}`);
      const aggregate = await tx.projectFile.aggregate({
        where: { projectId: input.projectId, OR: [{ id: versionGroupId }, { versionGroupId }] },
        _max: { versionNumber: true },
      });
      versionNumber = Math.max(1, Number(aggregate?._max?.versionNumber || 1) + 1);
    }

    let file = await tx.projectFile.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description || null,
        category: input.category,
        assetRole: input.assetRole,
        status: input.status,
        tags: JSON.stringify([...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 40)),
        metadata: JSON.stringify(input.metadata || {}),
        versionGroupId: versionGroupId || undefined,
        versionNumber,
        versionLabel: normalizedVersionLabel(input.versionLabel, versionNumber),
        derivedFromId: input.derivedFromId || null,
        proxyOfId: input.proxyOfId || null,
        exportOfId: input.exportOfId || null,
        duplicateOfId: duplicate?.id || null,
        checksumSha256: input.checksumSha256,
        managedBlobId: managedBlob?.id || null,
        ingestSessionId: input.ingestSessionId || null,
        fileName: input.fileName,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(Math.max(0, Math.trunc(input.sizeBytes))),
        uploadedById: input.uploadedById || null,
      },
    });
    if (!versionGroupId) {
      versionGroupId = file.id;
      file = await tx.projectFile.update({ where: { id: file.id }, data: { versionGroupId } });
    }
    for (const [relationship, targetId] of [["derived_from", file.derivedFromId], ["proxy_of", file.proxyOfId], ["export_of", file.exportOfId], ["duplicate_of", file.duplicateOfId]] as const) {
      if (!targetId) continue;
      await tx.projectRelationship.upsert({
        where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: input.projectId, sourceType: "file", sourceId: file.id, targetType: "file", targetId, relationship } },
        update: { createdById: input.uploadedById || null },
        create: { projectId: input.projectId, sourceType: "file", sourceId: file.id, targetType: "file", targetId, relationship, description: `Project asset ${relationship.replace(/_/g, " ")}.`, createdById: input.uploadedById || null },
      });
    }
    return { file, duplicateReused: false, duplicateRejected: false, idempotentReplay: false };
  });
  if (input.managedBlob?.reused && !result.idempotentReplay) {
    void recordEfficiencyMetric(prisma, "managed_source_dedup", input.sizeBytes, 1).catch(() => undefined);
  }
  return result;
}

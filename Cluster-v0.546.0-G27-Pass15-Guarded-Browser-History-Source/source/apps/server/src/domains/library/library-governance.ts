export type LibraryClassification = "public" | "internal" | "confidential" | "restricted";
export type LibraryLifecycleState = "active" | "in-review" | "approved" | "deprecated" | "trashed" | "destroyed";

export function normalizeLibraryClassification(value: unknown): LibraryClassification {
  const normalized = String(value || "internal").trim().toLowerCase();
  return (["public", "internal", "confidential", "restricted"] as const).includes(normalized as LibraryClassification)
    ? normalized as LibraryClassification
    : "internal";
}

export function normalizeLibraryLifecycleState(value: unknown): LibraryLifecycleState {
  const normalized = String(value || "active").trim().toLowerCase();
  return (["active", "in-review", "approved", "deprecated", "trashed", "destroyed"] as const).includes(normalized as LibraryLifecycleState)
    ? normalized as LibraryLifecycleState
    : "active";
}

export function libraryObjectIdentity(item: { id: string }) {
  return { resourceKind: "library", resourceId: String(item.id) } as const;
}

export function libraryRetentionDecision(item: any, now = new Date()) {
  const retentionUntil = item?.retentionUntil ? new Date(item.retentionUntil) : null;
  if (item?.legalHold) return { eligible: false, code: "LEGAL_HOLD", reason: "This Library object is under administrative or legal hold." } as const;
  if (retentionUntil && retentionUntil.getTime() > now.getTime()) {
    return { eligible: false, code: "RETENTION_ACTIVE", reason: `Retention prevents destruction until ${retentionUntil.toISOString()}.` } as const;
  }
  if (String(item?.lifecycleState || "") !== "trashed") {
    return { eligible: false, code: "NOT_TRASHED", reason: "Move this Library object to Trash before permanent destruction." } as const;
  }
  return { eligible: true, code: "ELIGIBLE", reason: "Retention and hold policy allow permanent destruction." } as const;
}

export async function createLibraryVersionSnapshot(prisma: any, item: any, input: { actorId?: string | null; note?: string | null } = {}) {
  const aggregate = await prisma.libraryVersion.aggregate({ where: { itemId: item.id }, _max: { versionNumber: true } });
  const versionNumber = Math.max(0, Number(aggregate?._max?.versionNumber || 0)) + 1;
  return prisma.libraryVersion.create({
    data: {
      itemId: item.id,
      versionNumber,
      actorId: input.actorId || null,
      note: input.note?.trim().slice(0, 2000) || null,
      title: item.title,
      body: item.body || null,
      status: item.status,
      lifecycleState: normalizeLibraryLifecycleState(item.lifecycleState),
      classification: normalizeLibraryClassification(item.classification),
      visibility: item.visibility,
      fileName: item.fileName || null,
      originalName: item.originalName || null,
      mimeType: item.mimeType || null,
      sizeBytes: item.sizeBytes ?? null,
      checksumSha256: item.checksumSha256 || null,
      extension: item.extension || null,
      metadata: item.metadata || "{}",
      source: item.source,
    },
  });
}

export async function recordLibraryBacklink(prisma: any, input: {
  itemId: string;
  sourceResourceKind: string;
  sourceResourceId: string;
  relationKind?: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const relationKind = String(input.relationKind || "uses").slice(0, 80);
  return prisma.libraryBacklink.upsert({
    where: { itemId_sourceResourceKind_sourceResourceId_relationKind: {
      itemId: input.itemId,
      sourceResourceKind: String(input.sourceResourceKind).slice(0, 80),
      sourceResourceId: String(input.sourceResourceId).slice(0, 240),
      relationKind,
    } },
    create: {
      itemId: input.itemId,
      sourceResourceKind: String(input.sourceResourceKind).slice(0, 80),
      sourceResourceId: String(input.sourceResourceId).slice(0, 240),
      relationKind,
      label: input.label?.slice(0, 240) || null,
      metadata: JSON.stringify(input.metadata || {}),
    },
    update: {
      label: input.label?.slice(0, 240) || null,
      metadata: JSON.stringify(input.metadata || {}),
    },
  });
}

export function libraryGovernanceView(item: any) {
  return {
    identity: libraryObjectIdentity(item),
    creatorId: item.creatorId || null,
    uploaderId: item.uploaderId || null,
    lastEditorId: item.lastEditorId || null,
    generatedForUserId: item.generatedForUserId || null,
    classification: normalizeLibraryClassification(item.classification),
    lifecycleState: normalizeLibraryLifecycleState(item.lifecycleState),
    retentionPolicyKey: item.retentionPolicyKey || null,
    retentionUntil: item.retentionUntil || null,
    legalHold: Boolean(item.legalHold),
    deletedAt: item.deletedAt || null,
    deletedById: item.deletedById || null,
    integrityState: item.integrityState || (item.checksumSha256 ? "verified" : "unverified"),
    integrityCheckedAt: item.integrityCheckedAt || null,
    origin: {
      kind: item.originKind,
      ref: item.originRef || null,
      generatedByKind: item.generatedByKind || null,
      generatedById: item.generatedById || null,
    },
  };
}

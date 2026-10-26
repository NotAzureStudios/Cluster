import { createHash } from "node:crypto";

/** A converter can embed companion textures and other assets into a GLB.
 * Authorization on the primary model never grants access to those assets.
 * Keep all missing, denied, records-governed and inactive references opaque.
 */
export class LibraryModelPreviewError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LibraryModelPreviewError";
  }
}

export type LibraryModelCompanionReference = { id: string; name: string };
export type LibraryModelCompanionRecord = {
  id: string;
  fileName?: string | null;
  revision?: number;
  checksumSha256?: string | null;
  updatedAt?: Date | string | null;
  type?: string;
  deletedAt?: Date | string | null;
  status?: string;
  lifecycleState?: string;
};

export function resolveAuthorizedModelCompanions<T extends LibraryModelCompanionRecord>(
  references: readonly LibraryModelCompanionReference[],
  records: readonly T[],
  canRead: (record: T) => boolean,
  isRecordsGoverned: (id: string) => boolean,
): Array<{ reference: LibraryModelCompanionReference; record: T }> {
  if (references.length > 128) throw new LibraryModelPreviewError("MODEL_PREVIEW_DEPENDENCY_DENIED", "A model dependency is not available for preview.");
  const byId = new Map(records.map((record) => [record.id, record]));
  const result: Array<{ reference: LibraryModelCompanionReference; record: T }> = [];
  for (const reference of references) {
    const record = byId.get(reference.id);
    if (!record || !record.fileName || record.type === "folder" || Boolean(record.deletedAt) ||
        ["trashed", "archived", "destroyed"].includes(record.status || "") ||
        ["trashed", "destroyed"].includes(record.lifecycleState || "") ||
        isRecordsGoverned(reference.id) || !canRead(record)) {
      // Do not disclose which referenced item exists or why it cannot be read.
      throw new LibraryModelPreviewError("MODEL_PREVIEW_DEPENDENCY_DENIED", "A model dependency is not available for preview.");
    }
    result.push({ reference, record });
  }
  return result;
}

export type ModelPreviewFingerprintFile = {
  id: string;
  revision?: number;
  checksumSha256?: string | null;
  updatedAt?: Date | string | null;
  fileName?: string | null;
  size?: number;
  modifiedMs?: number;
  name?: string;
};

/** One cache identity for the exact source/companion *set*, names and revisions.
 * Hashing prevents truncated path-based keys from colliding and does not expose
 * private filenames in on-disk cache filenames or HTTP ETags.
 */
export function modelPreviewFingerprint(source: ModelPreviewFingerprintFile,
  companions: readonly ModelPreviewFingerprintFile[], sourceRelativeName: string, maxBytes: number): string {
  return createHash("sha256").update(JSON.stringify({
    schema: 2, source, companions, sourceRelativeName, maxBytes,
  })).digest("hex");
}


/** Revision and policy evidence retained across slow model conversion.
 * These fields are deliberately not persisted as a public ETag or diagnostic:
 * identity and permission changes invalidate a pending response.
 */
export function modelPreviewAuthorizationSnapshot(
  source: Record<string, any>,
  companions: ReadonlyArray<{ reference: LibraryModelCompanionReference; record: Record<string, any> }>,
): string {
  const policy = (record: Record<string, any>) => ({
    id: record.id, revision: record.revision, updatedAt: record.updatedAt,
    deletedAt: record.deletedAt, lifecycleState: record.lifecycleState,
    status: record.status, classification: record.classification,
    visibility: record.visibility, projectId: record.projectId, parentId: record.parentId,
    ownerId: record.ownerId, fileName: record.fileName,
    checksumSha256: record.checksumSha256, metadata: record.metadata,
  });
  return createHash("sha256").update(JSON.stringify({
    source: policy(source),
    companions: companions.map(({ reference, record }) => ({ name: reference.name, ...policy(record) })),
  })).digest("hex");
}

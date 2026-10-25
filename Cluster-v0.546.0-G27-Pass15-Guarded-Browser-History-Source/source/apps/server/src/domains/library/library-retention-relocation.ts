import { resolveLibraryEffectiveRetention, type LibraryRetentionEvidence } from "./library-effective-retention.js";

/** A move must not weaken an active hold or retention deadline just by changing
 * the parent chain. Compute both policies in the SAME Serializable write
 * transaction. No cached or preview-side retention snapshot is authoritative.
 */
export class LibraryRetentionMutationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "LibraryRetentionMutationError"; }
}

export function isLibraryRetentionActive(evidence: Pick<LibraryRetentionEvidence, "legalHold" | "retentionUntil">, now = new Date()) {
  return evidence.legalHold || Boolean(evidence.retentionUntil && evidence.retentionUntil.getTime() > now.getTime());
}

export async function assertLibraryMovePreservesRetention(tx: any, item: {
  id: string; parentId?: string | null; projectId?: string | null;
  revision?: number; legalHold?: boolean; retentionUntil?: Date | string | null;
}, nextParentId: string | null, now = new Date()) {
  const before = await resolveLibraryEffectiveRetention(tx, item);
  const after = await resolveLibraryEffectiveRetention(tx, { ...item, parentId: nextParentId });
  if (before.legalHold && !after.legalHold) {
    throw new LibraryRetentionMutationError("LIBRARY_MOVE_WEAKENS_HOLD", "Moving this item would remove an inherited legal hold.");
  }
  if (before.retentionUntil && before.retentionUntil > now &&
    (!after.retentionUntil || after.retentionUntil < before.retentionUntil)) {
    throw new LibraryRetentionMutationError("LIBRARY_MOVE_WEAKENS_RETENTION", "Moving this item would shorten inherited active retention.");
  }
  return { before, after };
}

/** Direct metadata PATCH is not a lifecycle, retention override or relocation
 * authority. Separate APIs enforce permissions, reason, preview and atomicity.
 */
export function libraryMetadataMutationDenial(existing: any, body: any): { code: string; message: string } | null {
  if (body.legalHold !== undefined || body.retentionUntil !== undefined || body.retentionPolicyKey !== undefined) {
    return { code: "LIBRARY_RETENTION_ENDPOINT_REQUIRED", message: "Use the dedicated retention workflow for hold and retention changes." };
  }
  if (body.parentId !== undefined && (body.parentId || null) !== (existing.parentId || null)) {
    return { code: "LIBRARY_MOVE_WORKFLOW_REQUIRED", message: "Use a transactionally checked Library move for relocation." };
  }
  if (body.projectId !== undefined && (body.projectId || null) !== (existing.projectId || null)) {
    return { code: "LIBRARY_PROJECT_TRANSFER_WORKFLOW_REQUIRED", message: "Project ownership cannot be reassigned through a metadata edit." };
  }
  if (body.status === "trashed" ||
      (body.status !== undefined && (existing.status === "trashed" || existing.lifecycleState === "trashed") && body.status !== existing.status) ||
      (body.lifecycleState !== undefined && body.lifecycleState !== existing.lifecycleState &&
        (body.lifecycleState === "trashed" || existing.lifecycleState === "trashed"))) {
    return { code: "LIBRARY_LIFECYCLE_WORKFLOW_REQUIRED", message: "Trash and restore require their dedicated lifecycle operations." };
  }
  return null;
}

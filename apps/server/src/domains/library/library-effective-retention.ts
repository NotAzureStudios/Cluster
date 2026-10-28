// G26 source-closeout: effective parent protection is resolved at read/commit
// time; it is NOT copied into child fields or silently removed by moving a file.
// This is an advisory/protective decision, never a physical disposal permit.
export const LIBRARY_RETENTION_ANCESTOR_LIMIT = 128;
export class LibraryRetentionLineageError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "LibraryRetentionLineageError"; }
}
export type LibraryRetentionEvidence = {
  legalHold: boolean; retentionUntil: Date | null; governingIds: string[];
  // Full revision chain makes a changed ancestor invalidate a disposition digest.
  lineage: Array<{ id: string; parentId: string | null; revision: number; legalHold: boolean; retentionUntil: string | null }>;
};
export async function resolveLibraryEffectiveRetention(tx: any, item: {
  id: string; parentId?: string | null; revision?: number; legalHold?: boolean;
  retentionUntil?: Date | string | null; projectId?: string | null;
}): Promise<LibraryRetentionEvidence> {
  const visited = new Set<string>();
  let current: typeof item | null = item;
  let maxDate: Date | null = null, legalHold = false;
  const governingIds: string[] = [], lineage: LibraryRetentionEvidence["lineage"] = [];
  const project = item.projectId ?? null;
  for (let depth = 0; current; depth++) {
    if (depth >= LIBRARY_RETENTION_ANCESTOR_LIMIT) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_ANCESTOR_LIMIT", "Retention ancestry too deep to verify.");
    if (!current.id || visited.has(current.id)) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_CYCLE", "Retention ancestry contains a cycle.");
    if ((current.projectId ?? null) !== project) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_PROJECT_BOUNDARY", "Retention ancestry crosses a Project boundary.");
    visited.add(current.id);
    const hold = Boolean(current.legalHold);
    const raw = current.retentionUntil;
    let deadline: Date | null = null;
    if (raw != null) {
      deadline = new Date(raw);
      if (!Number.isFinite(deadline.getTime())) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_INVALID_DATE", "Invalid parent retention deadline.");
    }
    if (hold || deadline) governingIds.push(current.id);
    if (hold) legalHold = true;
    if (deadline && (!maxDate || deadline > maxDate)) maxDate = deadline;
    lineage.push({ id: current.id, parentId: current.parentId || null, revision: Number(current.revision || 0),
      legalHold: hold, retentionUntil: deadline?.toISOString() || null });
    if (!current.parentId) break;
    const parent: typeof item | null = await tx.libraryItem.findUnique({ where: { id: current.parentId },
      select: { id: true, parentId: true, projectId: true, revision: true, legalHold: true, retentionUntil: true } });
    if (!parent) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_PARENT_MISSING", "Retention ancestor is missing.");
    current = parent;
  }
  return { legalHold, retentionUntil: maxDate, governingIds, lineage };
}

// G26 source-closeout: effective parent protection is resolved at read/commit
// time; it is NOT copied into child fields or silently removed by moving a file.
// This is an advisory/protective decision, never a physical disposal permit.
// Project is not part of lineage: an item moved into a project folder joins
// that project (see adoptLibraryProject) and inherits its chain's protection.
export const LIBRARY_RETENTION_ANCESTOR_LIMIT = 128;
export class LibraryRetentionLineageError extends Error {
  // A refused move or write, not a server fault: answer 409 with the reason.
  readonly statusCode = 409;
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
  for (let depth = 0; current; depth++) {
    if (depth >= LIBRARY_RETENTION_ANCESTOR_LIMIT) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_ANCESTOR_LIMIT", "Retention ancestry too deep to verify.");
    if (!current.id || visited.has(current.id)) throw new LibraryRetentionLineageError("LIBRARY_RETENTION_CYCLE", "Retention ancestry contains a cycle.");
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

/** Give a moved subtree its new folder's project (null at the Library root). */
export async function adoptLibraryProject(tx: any, rootIds: string[], parentId: string | null) {
  if (!rootIds.length) return;
  const parent = parentId ? await tx.libraryItem.findUnique({ where: { id: parentId }, select: { projectId: true } }) : null;
  const projectId = parent?.projectId ?? null;
  // Walk down a level at a time; folders are shallow and this stays inside
  // the caller's transaction.
  const seen = new Set<string>(rootIds);
  for (let level = rootIds; level.length;) {
    await tx.libraryItem.updateMany({ where: { id: { in: level } }, data: { projectId } });
    const children: Array<{ id: string }> = await tx.libraryItem.findMany({ where: { parentId: { in: level } }, select: { id: true } });
    level = children.map((child) => child.id).filter((id) => !seen.has(id));
    level.forEach((id) => seen.add(id));
  }
}

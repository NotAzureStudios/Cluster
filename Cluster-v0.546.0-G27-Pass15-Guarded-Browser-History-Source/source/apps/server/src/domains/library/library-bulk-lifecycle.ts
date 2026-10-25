/** Shared source-level eligibility for background Library lifecycle commands.
 * These commands change only a standalone item's archive status. They do not
 * traverse folders, modify blobs, restore Trash, or destroy retained content.
 * The worker MUST independently check item ACLs, locks, children, and revision.
 */
export type LibraryBackgroundAction = "tag" | "untag" | "pin" | "archive" | "unarchive";
export type LibraryLifecycleCandidate = {
  type: string;
  status: string;
  lifecycleState: string;
  deletedAt?: Date | string | null;
};

export function libraryBackgroundLifecycleEligible(item: LibraryLifecycleCandidate, action: LibraryBackgroundAction): boolean {
  if (item.deletedAt || item.status === "trashed" || ["trashed", "destroyed"].includes(item.lifecycleState)) return false;
  if (action === "archive" || action === "unarchive") {
    if (item.type === "folder") return false;
    return action === "archive" ? item.status !== "archived" : item.status === "archived";
  }
  return true;
}

/** Preview/queue reject parent-bearing records before presenting an exact count.
 * Re-evaluated independently by the worker in each Serializable write chunk.
 */
export async function filterLibraryBackgroundCandidates<T extends LibraryLifecycleCandidate & { id: string }>(
  rows: readonly T[],
  action: LibraryBackgroundAction,
  findParentIdsWithChildren: (ids: string[]) => Promise<readonly string[]>,
): Promise<T[]> {
  const eligible = rows.filter((item) => libraryBackgroundLifecycleEligible(item, action));
  if ((action !== "archive" && action !== "unarchive") || !eligible.length) return eligible;
  const parents = new Set(await findParentIdsWithChildren(eligible.map((item) => item.id)));
  return eligible.filter((item) => !parents.has(item.id));
}

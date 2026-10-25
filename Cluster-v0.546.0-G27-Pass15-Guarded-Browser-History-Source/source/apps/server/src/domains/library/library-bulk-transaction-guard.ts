import { inspectLibraryBulkScope, LibraryBulkScopeLimitError } from "./library-bulk-scope.js";
import { libraryLockIsActive } from "./library-platform-9e2.js";
import { resolveLibraryEffectiveRetention } from "./library-effective-retention.js";
import { assertLibraryMovePreservesRetention, isLibraryRetentionActive, LibraryRetentionMutationError } from "./library-retention-relocation.js";

/** Source-of-truth authorization and tree validation in the SAME Serializable
 * transaction as a bounded interactive Library hierarchy mutation. Preview
 * checks are useful for the UI, but must never become write authority.
 */
export class LibraryBulkGuardError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

type GuardAction = "move" | "archive" | "trash" | "restore";
type GuardInput = {
  tx: any;
  actorId: string;
  ids: string[];
  expectedRevisions: Record<string, number>;
  action: GuardAction;
  parentId?: string | null;
  itemInclude: Record<string, unknown>;
  access: {
    contextForUser: (user: any, tx: any) => Promise<any>;
    visibleFor: (context: any, item: any, action: "contribute") => boolean;
  };
  isManagedFolder: (item: any) => boolean;
};

/** Read a destination's ancestor chain rather than materializing the entire
 * Library tree. Detect both requested cycles and pre-existing broken links.
 */
export async function assertLibraryMoveDestination(input: {
  destinationId: string;
  selectedIds: readonly string[];
  fetch: (id: string) => Promise<any | null>;
  canContribute: (item: any) => boolean;
  maximumDepth?: number;
}): Promise<void> {
  const selected = new Set(input.selectedIds);
  const visited = new Set<string>();
  let cursor: string | null = input.destinationId;
  const maximumDepth = input.maximumDepth ?? 256;
  for (let depth = 0; cursor; depth++) {
    if (depth >= maximumDepth || visited.has(cursor)) throw new LibraryBulkGuardError("LIBRARY_BULK_TREE_INVALID", "The destination's parent chain is too deep or cyclic. No items were moved.");
    if (selected.has(cursor)) throw new LibraryBulkGuardError("LIBRARY_BULK_CYCLE", "A Library folder cannot be moved into itself or its descendants.");
    visited.add(cursor);
    const folder = await input.fetch(cursor);
    if (!folder || folder.type !== "folder" || folder.deletedAt || ["trashed", "destroyed"].includes(folder.lifecycleState) || ["trashed", "archived"].includes(folder.status) || !input.canContribute(folder)) {
      throw new LibraryBulkGuardError("LIBRARY_BULK_DESTINATION_DENIED", "The destination folder or one of its parents is unavailable or not editable.", 403);
    }
    cursor = folder.parentId || null;
  }
}

export async function revalidateLibraryBulkTreeWrite(input: GuardInput): Promise<{ selected: any[]; descendants: any[] }> {
  const { tx, ids, actorId, itemInclude, action, access } = input;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.archived || actor.accountState !== "ACTIVE" || (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date())) {
    throw new LibraryBulkGuardError("LIBRARY_BULK_ACTOR_INACTIVE", "The initiating account is no longer active.", 403);
  }
  const context = await access.contextForUser(actor, tx);
  const canContribute = (item: any) => access.visibleFor(context, item, "contribute");
  const selected = await tx.libraryItem.findMany({ where: { id: { in: ids } }, include: itemInclude });
  if (selected.length !== ids.length || selected.some((item: any) => !canContribute(item) || item.revision !== input.expectedRevisions[item.id])) {
    throw new LibraryBulkGuardError("LIBRARY_BULK_STALE_ACCESS", "Selected items or edit permissions changed. Refresh and preview again.");
  }
  if (selected.some((item: any) => ["move", "archive", "trash"].includes(action) && input.isManagedFolder(item))) {
    throw new LibraryBulkGuardError("MANAGED_LIBRARY_FOLDER", "A managed project or Packet folder cannot be moved or archived.");
  }
  if (action === "move") {
    // Folder-tree topology and destination ACL are re-read inside this transaction.
    if (input.parentId) await assertLibraryMoveDestination({
      destinationId: input.parentId, selectedIds: ids,
      fetch: (id) => tx.libraryItem.findUnique({ where: { id }, include: itemInclude }), canContribute,
    });
    if (selected.some((item: any) => item.deletedAt || item.lifecycleState === "destroyed" || item.status === "trashed")) {
      throw new LibraryBulkGuardError("LIBRARY_BULK_LIFECYCLE_CONFLICT", "Trashed or destroyed Library items cannot be moved.");
    }
  }
  if (action === "archive" && selected.some((item: any) => item.deletedAt || ["trashed", "destroyed"].includes(item.lifecycleState) || item.status === "trashed")) {
    throw new LibraryBulkGuardError("LIBRARY_BULK_LIFECYCLE_CONFLICT", "Restore trashed items before archiving them.");
  }
  let descendants: any[] = [];
  if (selected.some((item: any) => item.type === "folder")) {
    try {
      const scope = await inspectLibraryBulkScope(selected,
        (parents, take) => tx.libraryItem.findMany({ where: { parentId: { in: parents } }, include: itemInclude, take }),
        canContribute, input.isManagedFolder);
      if (scope.hasRestrictedDescendants || scope.hasProtectedDescendants) {
        throw new LibraryBulkGuardError("LIBRARY_BULK_NESTED_ACCESS", "The folder contents changed or contain protected/inaccessible items. Nothing was updated.", 403);
      }
      descendants = scope.descendants;
    } catch (error) {
      if (error instanceof LibraryBulkScopeLimitError) throw new LibraryBulkGuardError("LIBRARY_BULK_SCOPE_LIMIT", error.message);
      throw error;
    }
  }
  // These read the current parent chain inside the same Serializable snapshot
  // used by the write. A stale preview or a move out of a held folder must not
  // silently bypass retention. Selected roots cover inherited ancestry;
  // descendants are checked for their own more restrictive local policy.
  if (action === "move") {
    for (const root of selected) {
      if ((root.parentId || null) !== (input.parentId || null)) {
        try { await assertLibraryMovePreservesRetention(tx, root, input.parentId || null); }
        catch (error) {
          if (error instanceof LibraryRetentionMutationError) throw new LibraryBulkGuardError(error.code, error.message, 403);
          throw error;
        }
      }
    }
  }
  if (action === "trash") {
    const now = new Date();
    for (const root of selected) {
      const evidence = await resolveLibraryEffectiveRetention(tx, root);
      if (isLibraryRetentionActive(evidence, now)) throw new LibraryBulkGuardError("LIBRARY_INHERITED_RETENTION_ACTIVE", "An effective legal hold or retention deadline prevents Trash.", 403);
    }
    for (const child of descendants) {
      if (child.legalHold || (child.retentionUntil && new Date(child.retentionUntil) > now)) {
        throw new LibraryBulkGuardError("LIBRARY_DESCENDANT_RETENTION_ACTIVE", "A descendant has an active legal hold or retention deadline. Nothing may be trashed.", 403);
      }
    }
  }
  const impacted = [...new Set([...ids, ...descendants.map((item: any) => item.id)])];
  // A protected file may be in a regular folder, not just a Records root.
  const [protectedRefs, locks] = await Promise.all([
    tx.personnelRecordAttachment.findMany({ where: { libraryItemId: { in: impacted } }, select: { libraryItemId: true }, take: 1 }),
    tx.libraryAssetLock.findMany({ where: { itemId: { in: impacted } } }),
  ]);
  if (protectedRefs.length) throw new LibraryBulkGuardError("PERSONNEL_RECORD_POLICY_REQUIRED", "Personnel Records attachments cannot be moved through Library bulk actions.", 403);
  if (locks.some((lock: any) => libraryLockIsActive(lock))) throw new LibraryBulkGuardError("LIBRARY_BULK_LOCK_CONFLICT", "An impacted item has an active edit lock. Release it and review again.");
  return { selected, descendants };
}

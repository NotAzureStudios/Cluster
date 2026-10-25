import { libraryCollectionCan, libraryCollectionRole } from "./library-collection-access.js";
import { collectLibraryMatchingSelection } from "./library-matching-selection.js";
import { librarySmartCollectionDescendantFolders, librarySmartCollectionWhere } from "./library-platform-9e2.js";
import { libraryBulkSelectionDigest } from "./library-bulk-job-contract.js";
import { filterLibraryBackgroundCandidates, type LibraryBackgroundAction } from "./library-bulk-lifecycle.js";

export class LibraryBulkCollectionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

/** Resolve a collection into immutable ID/revision targets inside the caller's
 * repeatable-read transaction. Collection grants do NOT confer item access. */
export async function resolveLibraryBulkCollectionSelection(input: {
  tx: any; context: any; actorId: string; collectionId: string; expectedRevision: number;
  canContribute: (context: any, item: any) => boolean; action?: LibraryBackgroundAction;
}) {
  const { tx, context, actorId, collectionId, expectedRevision, canContribute, action = "tag" } = input;
  const collection = await tx.libraryCollection.findUnique({
    where: { id: collectionId },
    include: { grants: { where: { userId: actorId }, select: { userId: true, role: true } } },
  });
  if (!collection || collection.archived || !libraryCollectionCan(
    libraryCollectionRole(collection, actorId, Boolean(context.decorated?.isAdmin)), "edit"
  )) throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_DENIED", "Collection editing access is unavailable. Refresh the collection before queuing.", 403);
  if (collection.revision !== expectedRevision) throw new LibraryBulkCollectionError(
    "LIBRARY_BULK_COLLECTION_STALE", "The collection changed since preview. Refresh and review its current members.");

  const include = { project: { include: { memberships: { where: { status: "active" } } } } };
  let smartWhere: any = null;
  if (collection.kind === "smart") {
    let config: unknown;
    try { config = JSON.parse(collection.queryJson || "{}"); }
    catch { throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_INVALID", "The collection query is invalid."); }
    let compiled: ReturnType<typeof librarySmartCollectionWhere>;
    try { compiled = librarySmartCollectionWhere(config); }
    catch { throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_INVALID", "The collection query cannot be evaluated."); }
    const clauses: any[] = [compiled.where];
    if (collection.projectId) clauses.push({ projectId: collection.projectId });
    if (compiled.query.folderScope) {
      const anchor = await tx.libraryItem.findUnique({ where: { id: compiled.query.folderScope.folderId }, include });
      if (!anchor || anchor.type !== "folder" || anchor.lifecycleState === "destroyed" || ["archived", "trashed"].includes(anchor.status) || !canContribute(context, anchor)) {
        throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_FOLDER_DENIED", "The Smart Collection folder scope is not editable.", 403);
      }
      let folderIds: string[];
      try {
        folderIds = await librarySmartCollectionDescendantFolders(anchor.id, (parents, take) => tx.libraryItem.findMany({
          where: { type: "folder", parentId: { in: parents }, status: { notIn: ["trashed", "archived"] }, lifecycleState: { not: "destroyed" } },
          select: { id: true }, take,
        }));
      } catch { throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_SCOPE_LIMIT", "The Smart Collection folder tree exceeds safe limits."); }
      clauses.push({ parentId: { in: folderIds } });
    }
    smartWhere = { AND: clauses };
  } else if (collection.kind !== "manual") {
    throw new LibraryBulkCollectionError("LIBRARY_BULK_COLLECTION_INVALID", "Unknown collection type.");
  }

  const targets = await collectLibraryMatchingSelection({
    maximumSelected: 1000,
    fetchPage: async (skip, take) => {
      if (collection.kind === "smart") return tx.libraryItem.findMany({
        where: smartWhere, include, orderBy: [{ id: "asc" }], skip, take,
      });
      const memberships = await tx.libraryCollectionMembership.findMany({
        where: { collectionId }, include: { item: { include } },
        orderBy: [{ addedAt: "desc" }, { itemId: "asc" }], skip, take,
      });
      if (memberships.some((entry: any) => !entry.item)) throw new LibraryBulkCollectionError(
        "LIBRARY_BULK_COLLECTION_INVALID", "A collection member is missing. No job was queued.");
      return memberships.map((entry: any) => entry.item);
    },
    filterVisible: async (rows) => {
      if (!rows.length) return [];
      const refs = await tx.personnelRecordAttachment.findMany({
        where: { libraryItemId: { in: rows.map((row: any) => row.id) } }, select: { libraryItemId: true },
      });
      const protectedIds = new Set(refs.map((row: any) => row.libraryItemId));
      const permitted = rows.filter((row: any) => !protectedIds.has(row.id) && canContribute(context, row));
      return filterLibraryBackgroundCandidates(permitted, action, async (ids) => {
        const parents = await tx.libraryItem.findMany({ where: { parentId: { in: ids } }, select: { parentId: true }, distinct: ["parentId"] });
        return parents.map((entry: any) => entry.parentId).filter(Boolean);
      });
    },
  });
  const normalized = targets.map((item: any) => ({ id: item.id, revision: item.revision }));
  return { targets: normalized, digest: libraryBulkSelectionDigest(normalized), collection: { id: collectionId, revision: expectedRevision } };
}

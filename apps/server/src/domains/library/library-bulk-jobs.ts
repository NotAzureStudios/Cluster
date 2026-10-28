import { z } from "zod";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import type { LibraryAccessService } from "./library-access-service.js";
import { applyLibraryBulkTagChange } from "./library-bulk-tags.js";
import { parseJsonArray } from "./library-item-serialization.js";
import { libraryLockIsActive } from "./library-platform-9e2.js";
import { libraryCollectionCan, libraryCollectionRole } from "./library-collection-access.js";
import { libraryBackgroundLifecycleEligible } from "./library-bulk-lifecycle.js";

const payloadSchema = z.object({
  actorId: z.string().min(1).max(200),
  action: z.enum(["tag", "untag", "pin", "archive", "unarchive"]),
  tag: z.string().trim().min(1).max(80).optional(),
  pinned: z.boolean().optional(),
  collection: z.object({ id: z.string().min(1).max(240), revision: z.number().int().positive() }).optional(),
  targets: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive() })).min(1).max(1000),
}).superRefine((value, ctx) => {
  if ((value.action === "tag" || value.action === "untag") && !value.tag) ctx.addIssue({ code: "custom", path: ["tag"], message: "Tag is required." });
  if (value.action === "pin" && value.pinned === undefined) ctx.addIssue({ code: "custom", path: ["pinned"], message: "Pinned state is required." });
});

export const LIBRARY_ASYNC_BULK_BATCH = 20;

/** A single chunk's item writes, operation cursor, and activity evidence commit atomically.
 * Lease expiry, cancellation, retries and process crashes cannot apply a committed chunk twice.
 * Items which changed or lost authorization are counted, not overwritten.
 */
export function registerLibraryBulkJobHandler(input: {
  worker: DurableJobWorker;
  prisma: any;
  libraryAccess: LibraryAccessService;
}) {
  const { prisma, libraryAccess, worker } = input;
  worker.register("library.bulk.metadata", async ({ job, payload, throwIfCancelled, throwIfToolUnavailable, updateProgress }) => {
    const command = payloadSchema.parse(payload);
    if (job.createdById !== command.actorId) throw new Error("The bulk job actor does not match its creator.");
    if (new Set(command.targets.map((item) => item.id)).size !== command.targets.length) throw new Error("Duplicate bulk job targets are prohibited.");

    // Initial creation has no external side effect. Concurrent workers converge on the one row.
    await prisma.libraryBulkCheckpoint.upsert({
      where: { jobId: job.id },
      update: {},
      create: { jobId: job.id },
    });
    for (;;) {
      const progress = await prisma.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
      // A completed checkpoint is authoritative even if cancellation or tool
      // disable arrived just after the final transaction committed.
      if (progress.nextIndex >= command.targets.length) {
        return { total: command.targets.length, processed: progress.nextIndex, changed: progress.changed, conflicted: progress.conflicted, denied: progress.denied, blocked: progress.blocked, skipped: progress.skipped };
      }
      await throwIfCancelled();
      await throwIfToolUnavailable();
      // The item snapshot is immutable. A new transaction checks the current
      // identity and grants before every chunk; a prior approval is not durable authority.
      const next = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
        const start = current.nextIndex;
        if (start >= command.targets.length) return current;
        const batch = command.targets.slice(start, start + LIBRARY_ASYNC_BULK_BATCH);
        const actor = await tx.user.findUnique({ where: { id: command.actorId } });
        if (!actor || actor.archived || actor.accountState !== "ACTIVE" || (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date())) {
          throw new Error("The initiating account is no longer active. No further Library items were updated.");
        }
        const context = await libraryAccess.contextForUser(actor, tx);
        // A Collection is only a selection scope, not a durable permission.
        // Revoked grants, archived collections, or revised membership/query
        // block all later chunks even if the original item ACL still permits an edit.
        let collectionAllowed = true;
        if (command.collection) {
          const collection = await tx.libraryCollection.findUnique({
            where: { id: command.collection.id },
            include: { grants: { where: { userId: actor.id }, select: { userId: true, role: true } } },
          });
          collectionAllowed = Boolean(collection && !collection.archived &&
            collection.revision === command.collection.revision &&
            libraryCollectionCan(libraryCollectionRole(collection, actor.id, Boolean(context.decorated?.isAdmin)), "edit"));
        }
        const ids = batch.map((entry) => entry.id);
        const lifecycleAction = command.action === "archive" || command.action === "unarchive";
        const [rows, protectedRefs, locks, childReferences, activeHierarchyEntries] = await Promise.all([
          tx.libraryItem.findMany({
            where: { id: { in: ids } },
            include: { project: { include: { memberships: { where: { status: "active" } } } } },
          }),
          tx.personnelRecordAttachment.findMany({ where: { libraryItemId: { in: ids } }, select: { libraryItemId: true } }),
          tx.libraryAssetLock.findMany({ where: { itemId: { in: ids } } }),
          // Any child (even a trashed one) makes this a tree operation and
          // requires a separate hierarchy-wide lifecycle workflow.
          lifecycleAction ? tx.libraryItem.findMany({ where: { parentId: { in: ids } }, select: { parentId: true }, distinct: ["parentId"] }) : Promise.resolve([]),
          lifecycleAction ? tx.libraryHierarchyLifecycleEntry.findMany({ where: { itemId: { in: ids }, restoredAt: null }, select: { itemId: true } }) : Promise.resolve([]),
        ]);
        const byId = new Map<string, any>(rows.map((row: any) => [row.id, row]));
        const protectedIds = new Set(protectedRefs.map((entry: any) => entry.libraryItemId));
        const lockedIds = new Set(locks.filter((lock: any) => libraryLockIsActive(lock)).map((lock: any) => lock.itemId));
        const parentsWithChildren = new Set(childReferences.map((child: any) => child.parentId));
        const activeHierarchyIds = new Set(activeHierarchyEntries.map((entry: any) => entry.itemId));
        const counts = { changed: 0, conflicted: 0, denied: 0, blocked: 0, skipped: 0 };
        for (const target of batch) {
          const row = byId.get(target.id);
          // Never report hidden resource data or grant authority from the initial snapshot.
          if (!collectionAllowed || !row || protectedIds.has(target.id) || !libraryAccess.visibleFor(context, row, "contribute")) { counts.denied++; continue; }
          if (row.deletedAt || row.status === "trashed" || ["trashed", "destroyed"].includes(String(row.lifecycleState))) { counts.blocked++; continue; }
          if (lockedIds.has(target.id)) { counts.blocked++; continue; }
          if (lifecycleAction && (row.type === "folder" || parentsWithChildren.has(target.id) || activeHierarchyIds.has(target.id))) { counts.blocked++; continue; }
          if (row.revision !== target.revision) { counts.conflicted++; continue; }
          const data: Record<string, unknown> = {};
          if (command.action === "pin") {
            if (Boolean(row.pinned) === command.pinned) { counts.skipped++; continue; }
            data.pinned = command.pinned;
          } else if (lifecycleAction) {
            if (!libraryBackgroundLifecycleEligible(row, command.action)) { counts.skipped++; continue; }
            data.status = command.action === "archive" ? "archived" : "active";
          } else {
            const tags = parseJsonArray(row.tags);
            const nextTags = applyLibraryBulkTagChange(tags, command.tag!, command.action as "tag" | "untag");
            if (JSON.stringify(nextTags) === JSON.stringify(tags)) { counts.skipped++; continue; }
            data.tags = JSON.stringify(nextTags);
          }
          const updated = await tx.libraryItem.updateMany({
            where: { id: target.id, revision: target.revision },
            data: { ...data, lastEditorId: command.actorId, revision: { increment: 1 } },
          });
          if (updated.count !== 1) { counts.conflicted++; continue; }
          counts.changed++;
        }
        const claimed = await tx.libraryBulkCheckpoint.updateMany({
          where: { jobId: job.id, nextIndex: start },
          data: {
            nextIndex: start + batch.length,
            changed: { increment: counts.changed },
            conflicted: { increment: counts.conflicted },
            denied: { increment: counts.denied },
            blocked: { increment: counts.blocked },
            skipped: { increment: counts.skipped },
          },
        });
        if (claimed.count !== 1) throw new Error("Library bulk checkpoint moved concurrently; retry after the lease is recovered.");
        // Evidence is written inside the same transaction, not after a potentially
        // successful commit. Every durable chunk has one attributable activity record.
        await tx.activityEvent.create({ data: {
          userId: command.actorId, type: lifecycleAction ? "library.bulk.lifecycle.chunk" : "library.bulk.metadata.chunk", entityType: "library", entityId: null,
          title: lifecycleAction ? "Library background archive transition" : "Library background bulk edit",
          message: `${command.action}: ${batch.length} reviewed; ${counts.changed} changed`,
          metadata: JSON.stringify({ jobId: job.id, range: [start, start + batch.length], action: command.action, collection: command.collection || null, counts }),
        } });
        return {
          nextIndex: start + batch.length,
          changed: current.changed + counts.changed,
          conflicted: current.conflicted + counts.conflicted,
          denied: current.denied + counts.denied,
          blocked: current.blocked + counts.blocked,
          skipped: current.skipped + counts.skipped,
        };
      }, { isolationLevel: "Serializable", timeout: 15_000 });
      await updateProgress(Math.min(99, Math.floor((next.nextIndex / command.targets.length) * 99)),
        `${next.nextIndex}/${command.targets.length} reviewed · ${next.changed} changed · ${next.conflicted + next.denied + next.blocked} need attention`);
    }
  });
}

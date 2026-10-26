import { createHash } from "node:crypto";
import { z } from "zod";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import type { LibraryAccessService } from "./library-access-service.js";
import { resolveLibraryEffectiveRetention } from "./library-effective-retention.js";
import { revalidateLibraryBulkTreeWrite, assertLibraryMoveDestination, LibraryBulkGuardError } from "./library-bulk-transaction-guard.js";

// The hierarchy job intentionally does not rewrite every descendant. Parent
// pointers are canonical, so a root move relocates its subtree atomically.
// Filesystem paths are repaired by a durable *existing* reconciliation job.
export const LIBRARY_HIERARCHY_ROOT_LIMIT = 24;
export const LIBRARY_HIERARCHY_IMPACT_LIMIT = 5000;

const rootSchema = z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive() });
const hierarchyMoveBaseSchema = z.object({
  roots: z.array(rootSchema).min(1).max(LIBRARY_HIERARCHY_ROOT_LIMIT),
  parentId: z.string().min(1).max(200).nullable(),
});
function validateMoveRoots(value: z.infer<typeof hierarchyMoveBaseSchema>, ctx: z.RefinementCtx) {
  if (new Set(value.roots.map((root) => root.id)).size !== value.roots.length)
    ctx.addIssue({ code: "custom", message: "Duplicate Library move roots are not allowed." });
}
// Zod 3's superRefine returns ZodEffects, which cannot be extended. Build
// both variants from the base object, then apply the same root validator.
export const hierarchyMoveSchema = hierarchyMoveBaseSchema.superRefine(validateMoveRoots);
export const hierarchyMoveSubmitSchema = hierarchyMoveBaseSchema.extend({
  digest: z.string().regex(/^[0-9a-f]{64}$/), requestKey: z.string().uuid(),
}).superRefine(validateMoveRoots);

const persistedRootSchema = rootSchema.extend({
  parentId: z.string().nullable(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
const payloadSchema = z.object({
  actorId: z.string().min(1).max(200), parentId: z.string().nullable(),
  destinationFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  targets: z.array(persistedRootSchema).min(1).max(LIBRARY_HIERARCHY_ROOT_LIMIT),
});
export type LibraryHierarchyRequest = z.infer<typeof hierarchyMoveSchema>;

export const libraryHierarchyItemInclude = {
  project: { include: { memberships: { where: { status: "active" } } } },
  folderPermissions: { select: { userId: true, access: true } },
};

function digest(input: unknown) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
function rowIdentity(item: any) {
  return [item.id, item.parentId || null, item.projectId || null, item.revision, item.type, item.status, item.lifecycleState, item.deletedAt ? new Date(item.deletedAt).toISOString() : null,
    !!item.legalHold, item.retentionUntil ? new Date(item.retentionUntil).toISOString() : null];
}
export function libraryHierarchyFingerprint(rows: readonly any[]): string {
  return digest(rows.map(rowIdentity).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

/** The authorized destination and every ancestor are part of the preview.
 * Revising or moving an ancestor changes the target's meaning and invalidates
 * the queued move, instead of silently choosing a new effective path.
 */
async function destinationFingerprint(tx: any, parentId: string | null, context: any, access: LibraryAccessService) {
  if (!parentId) return digest([]);
  const chain: any[] = [];
  await assertLibraryMoveDestination({
    destinationId: parentId, selectedIds: [],
    fetch: async (id) => {
      const row = await tx.libraryItem.findUnique({ where: { id }, include: libraryHierarchyItemInclude });
      if (row) chain.push(row);
      return row;
    },
    canContribute: (row) => access.visibleFor(context, row, "contribute"),
  });
  return digest(chain.map(rowIdentity));
}

/** A read-only, bounded, authorization-aware snapshot. Must be invoked within
 * one repeatable-read or serializable transaction. The same validator is run
 * again per root inside every write transaction by the worker.
 */
export async function inspectLibraryHierarchyMove(input: {
  tx: any; actorId: string; roots: LibraryHierarchyRequest["roots"];
  parentId: string | null; access: LibraryAccessService;
}) {
  const { tx, actorId, roots, parentId, access } = input;
  if (roots.length < 1 || roots.length > LIBRARY_HIERARCHY_ROOT_LIMIT || new Set(roots.map(r => r.id)).size !== roots.length)
    throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_ROOT_LIMIT", "Select 1–24 distinct roots for a durable hierarchy move.");
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.archived || actor.accountState !== "ACTIVE" || (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date()))
    throw new LibraryBulkGuardError("LIBRARY_BULK_ACTOR_INACTIVE", "The initiating account is no longer active.", 403);
  const context = await access.contextForUser(actor, tx, { strict: true });
  const destination = parentId ? await tx.libraryItem.findUnique({ where: { id: parentId }, include: libraryHierarchyItemInclude }) : null;
  const destFingerprint = await destinationFingerprint(tx, parentId, context, access);
  const rootIds = roots.map((root) => root.id);
  if (parentId) await assertLibraryMoveDestination({
    destinationId: parentId, selectedIds: rootIds,
    fetch: (id) => tx.libraryItem.findUnique({ where: { id }, include: libraryHierarchyItemInclude }),
    canContribute: (row) => access.visibleFor(context, row, "contribute"),
  });
  const expectedRevisions = Object.fromEntries(roots.map(root => [root.id, root.revision]));
  const visited = new Set<string>();
  const targets: Array<z.infer<typeof persistedRootSchema>> = [];
  let affected = 0;
  for (const root of roots) {
    const scope = await revalidateLibraryBulkTreeWrite({
      tx, actorId, ids: [root.id], expectedRevisions, action: "move", parentId,
      itemInclude: libraryHierarchyItemInclude, access,
      isManagedFolder: (row: any) => row.type === "folder" && ["packets-root", "project-folder"].includes(String(row.source || "")),
    });
    const current = scope.selected[0];
    const tree = [...scope.selected, ...scope.descendants];
    affected += tree.length;
    if (affected > LIBRARY_HIERARCHY_IMPACT_LIMIT) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_SCOPE_LIMIT", "The selected hierarchy contains more than 5,000 records. Split the operation.");
    if (tree.some(row => visited.has(row.id))) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_OVERLAP", "Selected roots overlap; select parent folders only.");
    for (const row of tree) visited.add(row.id);
    if (tree.some(row => row.deletedAt || ["trashed", "destroyed"].includes(row.lifecycleState) || row.status === "trashed"))
      throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_TRASHED_CHILD", "Restore separately trashed descendants before relocating the hierarchy.");
    if (tree.some(row => (row.projectId || null) !== (current.projectId || null)) || (destination && (destination.projectId || null) !== (current.projectId || null)))
      throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_PROJECT_BOUNDARY", "Hierarchy moves cannot silently cross Project ownership boundaries.", 403);
    // A parent's hold/deadline may change without revising the moved item.
    // Pin its full source ancestry in the durable move fingerprint.
    const sourceRetention = await resolveLibraryEffectiveRetention(tx, current);
    targets.push({ id: root.id, revision: root.revision, parentId: current.parentId || null,
      fingerprint: digest([libraryHierarchyFingerprint(tree), sourceRetention.lineage]) });
  }
  const selectionDigest = digest([actorId, parentId, destFingerprint, targets]);
  return { targets, affected, destinationFingerprint: destFingerprint, digest: selectionDigest };
}

/** Each root move, checkpoint advance, audit, and physical-repair job record
 * commits in one Serializable transaction. A crash or lost acknowledgment
 * cannot leave committed DB changes without a durable repair obligation.
 */
export function registerLibraryHierarchyMoveJob(input: { worker: DurableJobWorker; prisma: any; access: LibraryAccessService; coordination?: { publish: (topic: string, payload: unknown) => Promise<boolean> } }) {
  const { worker, prisma, access } = input;
  worker.register("library.hierarchy.move", async ({ job, payload, throwIfCancelled, throwIfToolUnavailable, updateProgress }) => {
    const command = payloadSchema.parse(payload);
    if (job.createdById !== command.actorId || new Set(command.targets.map(t => t.id)).size !== command.targets.length)
      throw new Error("The hierarchy move job has an invalid initiating actor or duplicate roots.");
    await prisma.libraryBulkCheckpoint.upsert({ where: { jobId: job.id }, update: {}, create: { jobId: job.id } });
    for (;;) {
      const checkpoint = await prisma.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
      if (checkpoint.nextIndex >= command.targets.length) return {
        moved: checkpoint.changed, skipped: checkpoint.skipped, roots: command.targets.length,
        reconciliationJobs: checkpoint.changed, committed: true,
      };
      await throwIfCancelled();
      await throwIfToolUnavailable();
      const next = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
        if (current.nextIndex >= command.targets.length) return current;
        const target = command.targets[current.nextIndex];
        // Inspect all selected roots again, not just one, so destination cycles
        // created by other moves cannot cause a later iteration to relocate a
        // folder underneath another selected root.
        const checked = await inspectLibraryHierarchyMove({
          tx, actorId: command.actorId, roots: [target], parentId: command.parentId, access,
        });
        if (checked.destinationFingerprint !== command.destinationFingerprint ||
            checked.targets[0].fingerprint !== target.fingerprint ||
            checked.targets[0].parentId !== target.parentId || checked.targets[0].revision !== target.revision)
          throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_PREVIEW_STALE", "Library hierarchy, destination or permissions changed since preview. Earlier committed roots are preserved; review remaining work.");
        const unchanged = (target.parentId || null) === command.parentId;
        if (!unchanged) {
          const updated = await tx.libraryItem.updateMany({
            where: { id: target.id, revision: target.revision, parentId: target.parentId },
            data: { parentId: command.parentId, revision: { increment: 1 }, lastEditorId: command.actorId },
          });
          if (updated.count !== 1) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_PREVIEW_STALE", "The source moved concurrently; refresh before retrying.");
          // This uses the existing queue table and existing storage job owner.
          // The repair intent is in the *same* transaction as the moved root;
          // merely enqueueing after commit would lose it on crash/cancellation.
          await tx.backgroundJob.create({ data: {
            queue: "default", type: "library.storage.reconcile", costUnits: 2,
            maxAttempts: 5, createdById: null,
            payload: JSON.stringify({ scope: "library", reason: "bulk-move", originJobId: job.id, rootId: target.id }),
          } });
        }
        const advanced = await tx.libraryBulkCheckpoint.updateMany({
          where: { jobId: job.id, nextIndex: current.nextIndex },
          data: { nextIndex: current.nextIndex + 1, changed: { increment: unchanged ? 0 : 1 }, skipped: { increment: unchanged ? 1 : 0 } },
        });
        if (advanced.count !== 1) throw new Error("Concurrent hierarchy checkpoint advance; retry after lease recovery.");
        await tx.activityEvent.create({ data: {
          userId: command.actorId, type: "library.hierarchy.move.chunk", entityType: "library", entityId: target.id,
          title: "Library hierarchy relocation", message: unchanged ? "Already in destination" : "Folder or item moved",
          metadata: JSON.stringify({ jobId: job.id, sourceParentId: target.parentId, destinationId: command.parentId,
            rootId: target.id, index: current.nextIndex, repairQueued: !unchanged, affectedFingerprint: target.fingerprint }),
        } });
        return { nextIndex: current.nextIndex + 1, changed: current.changed + (unchanged ? 0 : 1), skipped: current.skipped + (unchanged ? 1 : 0) };
      }, { isolationLevel: "Serializable", timeout: 30_000 });
      // UI context caches subscribe to the existing cross-node invalidation
      // bus. Best effort notification is not transaction authority; the 15s
      // TTL is the safety fallback when the coordination transport is offline.
      try { await input.coordination?.publish("library.context.invalidate", { jobId: job.id, at: Date.now() }); }
      catch { /* durable move and repair intent already committed */ }
      await updateProgress(Math.min(99, Math.floor(next.nextIndex / command.targets.length * 99)),
        `${next.nextIndex}/${command.targets.length} roots reviewed · ${next.changed} moved`);
    }
  });
}

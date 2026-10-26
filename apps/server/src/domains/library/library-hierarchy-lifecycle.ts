import { createHash } from "node:crypto";
import { resolveLibraryEffectiveRetention } from "./library-effective-retention.js";
import { z } from "zod";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import type { LibraryAccessService } from "./library-access-service.js";
import { LibraryBulkGuardError, revalidateLibraryBulkTreeWrite } from "./library-bulk-transaction-guard.js";
import { libraryHierarchyFingerprint, libraryHierarchyItemInclude, LIBRARY_HIERARCHY_IMPACT_LIMIT, LIBRARY_HIERARCHY_ROOT_LIMIT } from "./library-hierarchy-move.js";

const hierarchyLifecycleBaseSchema = z.object({
  action: z.enum(["archive", "trash", "restore"]),
  roots: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive() }))
    .min(1).max(LIBRARY_HIERARCHY_ROOT_LIMIT),
});
function validateLifecycleRoots(value: z.infer<typeof hierarchyLifecycleBaseSchema>, ctx: z.RefinementCtx) {
  if (new Set(value.roots.map(root => root.id)).size !== value.roots.length)
    ctx.addIssue({ code: "custom", message: "Duplicate hierarchy roots are not allowed." });
}
export const hierarchyLifecycleSchema = hierarchyLifecycleBaseSchema.superRefine(validateLifecycleRoots);
export const hierarchyLifecycleSubmitSchema = hierarchyLifecycleBaseSchema.extend({
  digest: z.string().regex(/^[0-9a-f]{64}$/), requestKey: z.string().uuid(),
}).superRefine(validateLifecycleRoots);

export type LibraryHierarchyLifecycleRequest = z.infer<typeof hierarchyLifecycleSchema>;
const targetSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), fingerprint: z.string(),
  originJobId: z.string().nullable(), affected: z.number().int().nonnegative(),
});
const payloadSchema = z.object({
  actorId: z.string(), action: z.enum(["archive", "trash", "restore"]),
  targets: z.array(targetSchema).min(1).max(LIBRARY_HIERARCHY_ROOT_LIMIT),
});
function sha(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function managed(item: any) { return item.type === "folder" && ["packets-root", "project-folder"].includes(String(item.source || "")); }
function isTrashed(row: any) { return row.status === "trashed" || row.lifecycleState === "trashed" || !!row.deletedAt; }
function isProtectedFromTrash(row: any, now: Date) {
  return Boolean(row.legalHold || (row.retentionUntil && new Date(row.retentionUntil) > now));
}
function sortedIds(rows: readonly any[]) { return rows.map(row => row.id).sort(); }

/** Single snapshot in a repeatable-read transaction. Restoration depends on
 * operation provenance, not on simply inheriting a parent's current status.
 * A record independently trashed before the operation has no provenance mark
 * and will therefore never be revived by restoring the parent.
 */
export async function inspectLibraryHierarchyLifecycle(input: {
  tx: any; actorId: string; action: LibraryHierarchyLifecycleRequest["action"];
  roots: LibraryHierarchyLifecycleRequest["roots"]; access: LibraryAccessService;
}) {
  const { tx, actorId, roots, action, access } = input;
  if (!roots.length || roots.length > LIBRARY_HIERARCHY_ROOT_LIMIT || new Set(roots.map(x => x.id)).size !== roots.length)
    throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_ROOT_LIMIT", "Select 1–24 distinct hierarchy roots.");
  const seen = new Set<string>();
  const targets: Array<z.infer<typeof targetSchema>> = [];
  let affected = 0;
  let preserved = 0;
  for (const root of roots) {
    const scope = await revalidateLibraryBulkTreeWrite({
      tx, actorId, ids: [root.id], expectedRevisions: { [root.id]: root.revision },
      action, itemInclude: libraryHierarchyItemInclude, access, isManagedFolder: managed,
    });
    const rows = [...scope.selected, ...scope.descendants];
    affected += rows.length;
    if (affected > LIBRARY_HIERARCHY_IMPACT_LIMIT) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_SCOPE_LIMIT", "More than 5,000 affected records. Select a smaller hierarchy.");
    if (rows.some(row => seen.has(row.id))) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_OVERLAP", "Selected hierarchies overlap. Select parent folders only.");
    rows.forEach(row => seen.add(row.id));
    if (rows.some(row => managed(row))) throw new LibraryBulkGuardError("MANAGED_LIBRARY_FOLDER", "Managed folder contents cannot be changed by hierarchy lifecycle jobs.", 403);
    const rootRow = scope.selected[0];
    // Inherited holds/deadlines above the selected subtree are a binding
    // protection. Include the ancestor revisions in the durable preview hash.
    const ancestorProtection = await resolveLibraryEffectiveRetention(tx, rootRow);
    if (action === "trash" && (ancestorProtection.legalHold ||
        (ancestorProtection.retentionUntil && ancestorProtection.retentionUntil > new Date())))
      throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_INHERITED_RETENTION",
        "An ancestor protects this hierarchy from Trash.", 403);
    if (rows.some(row => (row.projectId || null) !== (rootRow.projectId || null)))
      throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_PROJECT_BOUNDARY", "A hierarchy spans multiple Project ownership scopes.", 403);
    let originJobId: string | null = null;
    if (action === "restore") {
      const rootMark = await tx.libraryHierarchyLifecycleEntry.findFirst({
        where: { itemId: root.id, rootId: root.id, restoredAt: null }, orderBy: { createdAt: "desc" },
      });
      if (!rootMark) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_RESTORE_PROVENANCE_REQUIRED", "No active hierarchy lifecycle record exists for this root. Use the individual restore workflow when appropriate.");
      originJobId = rootMark.jobId;
      const marks = await tx.libraryHierarchyLifecycleEntry.findMany({ where: { jobId: originJobId, rootId: root.id, restoredAt: null } });
      const rowById = new Map(rows.map(row => [row.id, row]));
      if (marks.length === 0 || marks.some((mark: any) => {
        const current = rowById.get(mark.itemId);
        return !current || (mark.action === "trash"
          ? (current.status !== "trashed" || current.lifecycleState !== "trashed" ||
            !current.deletedAt || new Date(current.deletedAt).getTime() !== new Date(mark.appliedDeletedAt).getTime() ||
            current.deletedById !== mark.appliedDeletedById)
          : current.status !== "archived");
      })) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_RESTORE_CONFLICT", "One or more affected records changed since this hierarchy operation. Nothing was restored.");
      preserved += rows.length - marks.length;
    } else {
      // Disallow layered operations on unresolved marks. Stacking Trash on top
      // of a tree-wide Archive would otherwise leave the earlier restore
      // snapshot with a stale revision and create irrecoverable ambiguity.
      const outstanding = await tx.libraryHierarchyLifecycleEntry.findFirst({
        where: { itemId: { in: sortedIds(rows) }, restoredAt: null }, select: { itemId: true },
      });
      if (outstanding) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_OPERATION_ACTIVE", "Restore or resolve the existing hierarchy operation before applying another lifecycle change.");
      if (isTrashed(rootRow)) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_ROOT_TRASHED", "Restore the selected root before archiving or trashing it.");
      if (action === "archive" && rootRow.status === "archived") throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_ALREADY_ARCHIVED", "The selected root is already archived.");
      if (action === "trash" && rows.some(row => !isTrashed(row) && isProtectedFromTrash(row, new Date())))
        throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_RETENTION_HOLD", "A descendant has an active legal hold or retention deadline. Nothing may be trashed.", 403);
      preserved += rows.filter(row => isTrashed(row) || (action === "archive" && row.status === "archived")).length;
    }
    // Include topology, revisions, hold/retention data and current provenance
    // markers. A later worker transaction must match this exact snapshot.
    const fingerprint = sha([libraryHierarchyFingerprint(rows),
      rows.map(row => [row.id, !!row.legalHold, row.retentionUntil ? new Date(row.retentionUntil).toISOString() : null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      originJobId, ancestorProtection.lineage]);
    targets.push({ id: root.id, revision: root.revision, fingerprint, originJobId, affected: rows.length });
  }
  return { targets, affected, preserved, digest: sha([actorId, action, targets]) };
}

/** Each root, provenance marks, checkpoint and audit commit in one transaction.
 * A failure leaves that root wholly untouched, while earlier roots remain
 * committed and can be restored independently using their provenance.
 */
export function registerLibraryHierarchyLifecycleJob(input: {
  worker: DurableJobWorker; prisma: any; access: LibraryAccessService;
  coordination?: { publish: (topic: string, payload: unknown) => Promise<boolean> };
}) {
  const { worker, prisma, access } = input;
  worker.register("library.hierarchy.lifecycle", async ({ job, payload, throwIfCancelled, throwIfToolUnavailable, updateProgress }) => {
    const command = payloadSchema.parse(payload);
    if (job.createdById !== command.actorId || new Set(command.targets.map(t => t.id)).size !== command.targets.length)
      throw new Error("Invalid hierarchy lifecycle actor or duplicate roots.");
    await prisma.libraryBulkCheckpoint.upsert({ where: { jobId: job.id }, update: {}, create: { jobId: job.id } });
    for (;;) {
      const checkpoint = await prisma.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
      if (checkpoint.nextIndex >= command.targets.length) return {
        changed: checkpoint.changed, unchanged: checkpoint.skipped, roots: command.targets.length, committed: true,
      };
      await throwIfCancelled();
      await throwIfToolUnavailable();
      const next = await prisma.$transaction(async (tx: any) => {
        const current = await tx.libraryBulkCheckpoint.findUniqueOrThrow({ where: { jobId: job.id } });
        if (current.nextIndex >= command.targets.length) return current;
        const target = command.targets[current.nextIndex];
        const checked = await inspectLibraryHierarchyLifecycle({ tx, actorId: command.actorId,
          action: command.action, roots: [{ id: target.id, revision: target.revision }], access });
        const snapshot = checked.targets[0];
        if (snapshot.fingerprint !== target.fingerprint || snapshot.originJobId !== target.originJobId || snapshot.affected !== target.affected)
          throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_PREVIEW_STALE", "Hierarchy or permissions changed. Earlier committed roots remain committed; re-preview outstanding roots.");
        const scope = await revalidateLibraryBulkTreeWrite({
          tx, actorId: command.actorId, ids: [target.id], expectedRevisions: { [target.id]: target.revision },
          action: command.action, itemInclude: libraryHierarchyItemInclude, access, isManagedFolder: managed,
        });
        const rows = [...scope.selected, ...scope.descendants];
        const now = new Date();
        let modifications: any[];
        if (command.action === "restore") {
          const marks = await tx.libraryHierarchyLifecycleEntry.findMany({
            where: { jobId: target.originJobId, rootId: target.id, restoredAt: null },
          });
          const markById = new Map(marks.map((m: any) => [m.itemId, m]));
          modifications = rows.filter(row => markById.has(row.id)).map(row => ({ row, mark: markById.get(row.id) }));
          if (modifications.length !== marks.length) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_RESTORE_CONFLICT", "Hierarchy provenance changed before commit.");
        } else {
          modifications = rows.filter(row => !isTrashed(row) && (command.action !== "archive" || row.status !== "archived")).map(row => ({ row }));
        }
        // Provenance is written before the mass update, within the *same*
        // Serializable transaction. A failed write rolls back both.
        if (command.action !== "restore" && modifications.length) {
          await tx.libraryHierarchyLifecycleEntry.createMany({ data: modifications.map(({ row }) => ({
            jobId: job.id, rootId: target.id, itemId: row.id, action: command.action,
            priorStatus: row.status, priorLifecycleState: row.lifecycleState,
            priorDeletedAt: row.deletedAt || null, priorDeletedById: row.deletedById || null,
            appliedRevision: row.revision + 1,
            appliedDeletedAt: command.action === "trash" ? now : null,
            appliedDeletedById: command.action === "trash" ? command.actorId : null,
          })) });
        }
        if (modifications.length) {
          // Group equal-revision records to avoid thousands of individual SQL
          // updates while retaining an exact affected-ID and revision CAS.
          const groups = new Map<number, string[]>();
          for (const { row } of modifications) groups.set(row.revision, [...(groups.get(row.revision) || []), row.id]);
          for (const [revision] of groups) {
            // Restore groups also share a source operation, but their prior
            // state can differ. These require per-prior-state update groups.
            const stateGroups = new Map<string, any[]>();
            for (const item of modifications.filter((m: any) => m.row.revision === revision)) {
              const key = command.action === "restore" ? JSON.stringify([
                item.mark.priorStatus, item.mark.priorLifecycleState, item.mark.priorDeletedAt, item.mark.priorDeletedById,
              ]) : "apply";
              stateGroups.set(key, [...(stateGroups.get(key) || []), item]);
            }
            for (const group of stateGroups.values()) {
              const data = command.action === "trash" ? {
                status: "trashed", lifecycleState: "trashed", deletedAt: now, deletedById: command.actorId,
              } : command.action === "archive" ? { status: "archived" } : {
                status: group[0].mark.priorStatus,
                lifecycleState: group[0].mark.priorLifecycleState,
                deletedAt: group[0].mark.priorDeletedAt,
                deletedById: group[0].mark.priorDeletedById,
              };
              const ids = group.map((entry: any) => entry.row.id);
              const updated = await tx.libraryItem.updateMany({
                where: { id: { in: ids }, revision },
                data: { ...data, lastEditorId: command.actorId, revision: { increment: 1 } },
              });
              if (updated.count !== ids.length) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_WRITE_CONFLICT", "A descendant changed during the commit.");
            }
          }
          if (command.action === "restore") {
            const changed = await tx.libraryHierarchyLifecycleEntry.updateMany({
              where: { jobId: target.originJobId, rootId: target.id, restoredAt: null }, data: { restoredAt: now },
            });
            if (changed.count !== modifications.length) throw new LibraryBulkGuardError("LIBRARY_HIERARCHY_RESTORE_CONFLICT", "Restore provenance changed during commit.");
          }
        }
        const checkpointWrite = await tx.libraryBulkCheckpoint.updateMany({
          where: { jobId: job.id, nextIndex: current.nextIndex },
          data: { nextIndex: current.nextIndex + 1, changed: { increment: modifications.length }, skipped: { increment: rows.length - modifications.length } },
        });
        if (checkpointWrite.count !== 1) throw new Error("Concurrent hierarchy lifecycle checkpoint advance.");
        await tx.activityEvent.create({ data: {
          userId: command.actorId, projectId: scope.selected[0].projectId,
          type: `library.hierarchy.${command.action}.chunk`, entityType: "library", entityId: target.id,
          title: `Library hierarchy ${command.action}`, message: `${modifications.length} records changed`,
          metadata: JSON.stringify({ jobId: job.id, originJobId: target.originJobId,
            rootId: target.id, changed: modifications.length, preserved: rows.length - modifications.length }),
        } });
        return { nextIndex: current.nextIndex + 1, changed: current.changed + modifications.length,
          skipped: current.skipped + rows.length - modifications.length };
      }, { isolationLevel: "Serializable", timeout: 60_000 });
      try { await input.coordination?.publish("library.context.invalidate", { jobId: job.id, at: Date.now() }); }
      catch { /* committed state is authoritative */ }
      await updateProgress(Math.min(99, Math.floor(next.nextIndex / command.targets.length * 99)),
        `${next.nextIndex}/${command.targets.length} roots committed · ${next.changed} changed`);
    }
  });
}

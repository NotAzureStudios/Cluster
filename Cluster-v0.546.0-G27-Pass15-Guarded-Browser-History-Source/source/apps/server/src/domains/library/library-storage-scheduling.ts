import type { BackgroundJobQueue } from "../jobs/job-queue-service.js";

/**
 * A Library hierarchy mutation has already committed by the time this is
 * called. Queue failure must never be presented as a failed/rolled-back edit.
 * Each committed mutation MUST enqueue a new scan, including if an earlier
 * scan is still running. Coalescing by actor can miss newly changed items
 * whose IDs were already visited by the earlier worker's pagination cursor.
 * A future operation-specific idempotency key may deduplicate the *same*
 * committed mutation, never unrelated later mutations.
 */
export async function scheduleCommittedLibraryStorageRepair(
  queue: Pick<BackgroundJobQueue, "enqueue">,
  actorId: string,
  reason: "bulk-move" | "item-move" | "folder-rename" | "mounted-folder-rename" | "admin-repair",
): Promise<{ committed: true; reconciled: false; reconciliationQueued: boolean; reconciliationJobId?: string; reconciliationJobStatus?: string; warning: string }> {
  try {
    const job = await queue.enqueue({
      type: "library.storage.reconcile",
      queue: "default",
      costUnits: 2,
      maxAttempts: 5,
      createdById: actorId,
      payload: { scope: "library", reason },
    });
    return {
      committed: true, reconciled: false, reconciliationQueued: true,
      reconciliationJobId: job.id, reconciliationJobStatus: job.status,
      warning: "The Library change was saved. Stored-file reconciliation is queued; do not repeat the edit.",
    };
  } catch {
    return {
      committed: true, reconciled: false, reconciliationQueued: false,
      warning: "The Library change was saved, but storage repair could not be queued. An administrator must start reconciliation. Do not repeat the edit.",
    };
  }
}

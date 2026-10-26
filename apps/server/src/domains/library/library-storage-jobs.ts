import type { DurableJobWorker } from "../jobs/job-worker.js";
import { reconcileLibraryStoredFiles, type ClusterDataLayout } from "../../core/data-layout.js";

const BATCH_SIZE = 50;

/**
 * System maintenance, scheduled only after an authorized Library mutation has
 * committed (or by an administrator). It never changes item ownership or
 * content. Restarting a job re-scans from the beginning, which is safe because
 * each file uses an exclusive destination and a CAS pointer update.
 */
export function registerLibraryStorageReconciliationJob(input: {
  worker: DurableJobWorker;
  prisma: any;
  dataLayout: ClusterDataLayout;
}) {
  const { worker, prisma, dataLayout } = input;
  worker.register("library.storage.reconcile", async ({ payload, updateProgress, throwIfCancelled, throwIfToolUnavailable }) => {
    if (!payload || typeof payload !== "object" || (payload as any).scope !== "library") {
      throw new Error("Invalid Library storage-reconciliation job payload.");
    }
    const total = await prisma.libraryItem.count({ where: { fileName: { not: null } } });
    let inspected = 0;
    let normalized = 0;
    let unresolved = 0;
    let lastId: string | null = null;
    for (;;) {
      await throwIfCancelled();
      await throwIfToolUnavailable();
      const rows: any[] = await prisma.libraryItem.findMany({
        where: { fileName: { not: null }, ...(lastId ? { id: { gt: lastId } } : {}) },
        select: { id: true, parentId: true, fileName: true, checksumSha256: true },
        orderBy: { id: "asc" }, take: BATCH_SIZE,
      });
      if (!rows.length) break;
      const result = await reconcileLibraryStoredFiles(prisma, dataLayout, rows);
      inspected += result.inspected;
      normalized += result.normalized;
      unresolved += result.unresolved;
      lastId = rows[rows.length - 1].id;
      await updateProgress(Math.min(99, Math.floor(inspected * 99 / Math.max(total, 1))),
        `${inspected} checked · ${normalized} reconciled · ${unresolved} unresolved`);
    }
    // Partial completion is not a silent green status: a warning remains in
    // result/progress so Operations can inspect and retry after the conflict is fixed.
    return { inspected, normalized, unresolved, needsAttention: unresolved > 0 };
  });
}

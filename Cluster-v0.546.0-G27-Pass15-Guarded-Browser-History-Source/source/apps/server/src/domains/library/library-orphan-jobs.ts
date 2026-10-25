import type { DurableJobWorker } from "../jobs/job-worker.js";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { auditLibraryOrphanFiles, canonicalLibraryStorageReference, LIBRARY_ORPHAN_AUDIT_LIMITS } from "./library-orphan-audit.js";

/** Collect all known Library-root source and revision pointers. Never infer
 * absence from a single model or truncate a large result silently. */
export async function collectLibraryStorageReferences(prisma: any, root: string, check: () => Promise<void>) {
  const refs = new Set<string>();
  let observed = 0;
  const PAGE = 500;
  const owners = [
    { model: "libraryItem", field: "fileName" },
    { model: "libraryVersion", field: "fileName" },
    { model: "libraryDerivative", field: "storagePath" },
  ] as const;
  for (const owner of owners) {
    let lastId: string | null = null;
    for (;;) {
      await check();
      const rows: Array<{ id: string; [key: string]: unknown }> = await prisma[owner.model].findMany({
        where: { [owner.field]: { not: null }, ...(lastId ? { id: { gt: lastId } } : {}) },
        select: { id: true, [owner.field]: true }, orderBy: { id: "asc" }, take: PAGE,
      });
      if (!rows.length) break;
      observed += rows.length;
      if (observed > LIBRARY_ORPHAN_AUDIT_LIMITS.referenceLimit) throw new Error("Library orphan audit reference limit exceeded. No complete report was produced.");
      for (const record of rows) {
        const reference = canonicalLibraryStorageReference(root, record[owner.field]);
        if (reference) refs.add(reference);
      }
      lastId = rows[rows.length - 1].id;
    }
  }
  return { references: refs, observed };
}

export function registerLibraryOrphanAuditJob(input: { worker: DurableJobWorker; prisma: any; dataLayout: ClusterDataLayout }) {
  const { worker, prisma, dataLayout } = input;
  worker.register("library.storage.orphan-audit", async ({ payload, updateProgress, throwIfCancelled, throwIfToolUnavailable }) => {
    if (!payload || typeof payload !== "object" || (payload as any).scope !== "library") throw new Error("Invalid Library orphan-audit payload.");
    const check = async () => { await throwIfCancelled(); await throwIfToolUnavailable(); };
    const { references, observed } = await collectLibraryStorageReferences(prisma, dataLayout.libraryRoot, check);
    await updateProgress(10, `${observed} database file references inspected; scanning Library storage (read-only)`);
    const result = await auditLibraryOrphanFiles({
      root: dataLayout.libraryRoot, references, check,
      reportProgress: async (entries) => updateProgress(Math.min(90, 10 + Math.floor(entries * 80 / LIBRARY_ORPHAN_AUDIT_LIMITS.entryLimit)), `${entries} storage entries inspected (read-only)`),
    });
    await updateProgress(100, `Audit complete: ${result.agedUnreferenced} aged unreferenced candidates; nothing deleted`);
    return { ...result, databaseReferencesInspected: observed };
  });
}

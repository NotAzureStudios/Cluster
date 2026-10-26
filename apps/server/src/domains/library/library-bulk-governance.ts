/** G26 WS9: bounded, permission-independent evidence for additive Library retention.
 * Preview is not authorization; the API re-evaluates this snapshot, actor rights,
 * dependencies and each revision inside the Serializable write transaction.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { libraryLockIsActive } from "./library-platform-9e2.js";

export const libraryBulkGovernanceSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(200)
    .refine((ids) => new Set(ids).size === ids.length, "Select distinct Library objects."),
  expectedRevisions: z.record(z.number().int().positive()),
  action: z.enum(["place-hold", "extend-retention"]),
  retentionUntil: z.string().max(80).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "extend-retention" && (!value.retentionUntil || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value.retentionUntil) ||
    !/(?:Z|[+-]\d\d:\d\d)$/.test(value.retentionUntil) || !Number.isFinite(Date.parse(value.retentionUntil)))) ctx.addIssue({ code: "custom", path: ["retentionUntil"], message: "Provide a valid ISO retention date." });
  if (value.action === "extend-retention" && value.retentionUntil && Number.isFinite(Date.parse(value.retentionUntil)) &&
    Date.parse(value.retentionUntil) <= Date.now()) ctx.addIssue({ code: "custom", path: ["retentionUntil"], message: "Retention must end in the future." });
});
export type LibraryBulkGovernanceCommand = z.infer<typeof libraryBulkGovernanceSchema>;

const readableDate = (date: unknown) => date ? new Date(date as string).toISOString() : null;
const countFor = (rows: any[], key: string) => new Map(rows.map((row) => [String(row[key]), Number(row._count?._all ?? row._count?._id ?? 0)]));
export type LibraryGovernanceImpact = {
  ok: true; action: LibraryBulkGovernanceCommand["action"]; retentionUntil: string | null;
  digest: string; selectedCount: number; changeCount: number; unchangedCount: number;
  blockedCount: number; references: Record<string, number>; coverage: string;
  items: Array<{ id: string; title: string; revision: number; outcome: "change" | "unchanged" | "blocked";
    reason: string | null; current: { legalHold: boolean; retentionUntil: string | null };
    links: { backlinks: number; versions: number; derivatives: number; personnelAttachments: number; childItems: number; packetDefinitions: number } }>;
};

/** Reference counts are intentionally summaries, never permissions or an exhaustive dependency graph. */
export async function inspectLibraryBulkGovernance(input: {
  tx: any; command: LibraryBulkGovernanceCommand;
  canManage: (item: any) => boolean;
  itemInclude: Record<string, unknown>;
  hierarchyMode?: boolean;
}): Promise<LibraryGovernanceImpact> {
  const { tx, command, canManage, itemInclude } = input;
  const ids = command.ids;
  const where = { itemId: { in: ids } };
  const [allItems, backlinks, versions, derivatives, personnel, children, packetDefs, locks, hierarchy, dispositions] = await Promise.all([
    tx.libraryItem.findMany({ where: { id: { in: ids } }, include: itemInclude }),
    tx.libraryBacklink.groupBy({ by: ["itemId"], where, _count: { _all: true } }),
    tx.libraryVersion.groupBy({ by: ["itemId"], where, _count: { _all: true } }),
    tx.libraryDerivative.groupBy({ by: ["itemId"], where, _count: { _all: true } }),
    tx.personnelRecordAttachment.groupBy({ by: ["libraryItemId"], where: { libraryItemId: { in: ids } }, _count: { _all: true } }),
    tx.libraryItem.groupBy({ by: ["parentId"], where: { parentId: { in: ids } }, _count: { _all: true } }),
    tx.packetDefinition.findMany({ where: { libraryFolderId: { in: ids } }, select: { libraryFolderId: true } }),
    tx.libraryAssetLock.findMany({ where: { itemId: { in: ids } } }),
    tx.libraryHierarchyLifecycleEntry.findMany({ where: { itemId: { in: ids }, restoredAt: null }, select: { itemId: true } }),
    tx.libraryDispositionRequest.findMany({ where: { itemId: { in: ids }, status: { in: ["PENDING_REVIEW", "REVIEW_APPROVED"] } }, select: { itemId: true } }),
  ]);
  const itemById = new Map<string, any>(allItems.map((item: any) => [item.id, item]));
  // A missing/inaccessible item invalidates the whole preview. Never reveal how many were hidden.
  if (allItems.length !== ids.length || allItems.some((item: any) => !canManage(item)))
    throw Object.assign(new Error("The selected Library objects are unavailable or not authorized for governance."), { code: "LIBRARY_GOVERNANCE_ACCESS", statusCode: 403 });
  const backlinkById = countFor(backlinks, "itemId");
  const versionById = countFor(versions, "itemId");
  const derivativeById = countFor(derivatives, "itemId");
  const personnelById = countFor(personnel, "libraryItemId");
  const childrenById = countFor(children, "parentId");
  const packetById = new Map<string, number>();
  for (const entry of packetDefs) packetById.set(entry.libraryFolderId, (packetById.get(entry.libraryFolderId) || 0) + 1);
  const locked = new Set<string>(locks.filter((lock: any) => libraryLockIsActive(lock)).map((lock: any) => lock.itemId));
  const marked = new Set<string>(hierarchy.map((entry: any) => entry.itemId));
  const pendingDispositions = new Set<string>(dispositions.map((entry: any) => entry.itemId));
  const targetDate = command.action === "extend-retention" ? new Date(command.retentionUntil!).toISOString() : null;
  const items = [...ids].sort().map((id) => {
    const item = itemById.get(id)!;
    const links = {
      backlinks: backlinkById.get(id) || 0, versions: versionById.get(id) || 0,
      derivatives: derivativeById.get(id) || 0, personnelAttachments: personnelById.get(id) || 0,
      childItems: childrenById.get(id) || 0, packetDefinitions: packetById.get(id) || 0,
    };
    const current = { legalHold: Boolean(item.legalHold), retentionUntil: readableDate(item.retentionUntil) };
    let reason: string | null = null;
    if (!input.hierarchyMode && (item.type === "folder" || links.childItems > 0 || links.packetDefinitions > 0))
      reason = "Folder and tree-wide retention require a separate governed hierarchy workflow.";
    else if (links.personnelAttachments > 0) reason = "Personnel Records controls retention for this attachment.";
    else if (item.status === "trashed" || item.deletedAt || ["trashed", "destroyed"].includes(String(item.lifecycleState)))
      reason = "Trashed or destroyed records are excluded from this additive workflow.";
    else if (locked.has(id)) reason = "An active Library edit lock must be released first.";
    else if (marked.has(id)) reason = "An active hierarchy lifecycle mark blocks independent edits.";
    else if (pendingDispositions.has(id)) reason = "An unresolved disposition request requires independent review.";
    // Invariant: a bulk operation may only add a hold or extend a deadline.
    // Lifting holds, clearing or shortening deadlines stays in the single-item audited API.
    const unchanged = command.action === "place-hold" ? current.legalHold :
      Boolean(current.retentionUntil && targetDate && current.retentionUntil >= targetDate);
    return { id, title: String(item.title), revision: Number(item.revision),
      outcome: (reason ? "blocked" : unchanged ? "unchanged" : "change") as "blocked" | "unchanged" | "change",
      reason, current, links };
  });
  const references = { backlinks: 0, versions: 0, derivatives: 0, personnelAttachments: 0, childItems: 0, packetDefinitions: 0 };
  for (const entry of items) for (const key of Object.keys(references) as Array<keyof typeof references>) references[key] += entry.links[key];
  const digest = createHash("sha256").update(JSON.stringify({
    version: 1, action: command.action, date: targetDate, items,
    // Caller-submitted expected revisions are checked independently by route and transaction.
  })).digest("hex");
  return { ok: true, action: command.action, retentionUntil: targetDate, digest,
    selectedCount: ids.length, changeCount: items.filter((x) => x.outcome === "change").length,
    unchangedCount: items.filter((x) => x.outcome === "unchanged").length,
    blockedCount: items.filter((x) => x.outcome === "blocked").length,
    references, coverage: "Indexed Library backlinks, versions, derivatives, personnel attachments, direct children and Packet definitions only. Other references, mounted storage and backups are not an exhaustive dependency scan.", items };
}

/** Shared compare-and-swap authority. Audit evidence is written by the caller
 * within the same Serializable transaction, or all edits must roll back. */
export async function commitLibraryGovernanceStrengthening(tx: any, impact: LibraryGovernanceImpact, actorId: string) {
  for (const entry of impact.items.filter((item) => item.outcome === "change")) {
    const updated = await tx.libraryItem.updateMany({
      where: { id: entry.id, revision: entry.revision },
      data: { ...(impact.action === "place-hold" ? { legalHold: true } : { retentionUntil: new Date(impact.retentionUntil!) }),
        lastEditorId: actorId, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw Object.assign(new Error("The Library hierarchy changed during commit; no protection was saved."),
      { code: "GOVERNANCE_REVISION_CONFLICT", statusCode: 409 });
  }
}

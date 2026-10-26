/** G26 Batch C: additive, bounded hierarchy retention and hold governance.
 * This is a transactional metadata operation, not a storage deletion authority.
 * Tree discovery and every permission/revision check are repeated in the same
 * Serializable transaction that commits the individual changes and audit.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { inspectLibraryBulkScope, LibraryBulkScopeLimitError } from "./library-bulk-scope.js";
import { LibraryBulkGuardError } from "./library-bulk-transaction-guard.js";
import { inspectLibraryBulkGovernance, libraryBulkGovernanceSchema } from "./library-bulk-governance.js";

export const LIBRARY_GOVERNANCE_TREE_ROOT_LIMIT = 8;
export const LIBRARY_GOVERNANCE_TREE_ITEM_LIMIT = 160;
const baseSchema = z.object({
  roots: z.array(z.object({ id: z.string().min(1).max(200), revision: z.number().int().positive() }))
    .min(1).max(LIBRARY_GOVERNANCE_TREE_ROOT_LIMIT),
  action: z.enum(["place-hold", "extend-retention"]),
  retentionUntil: z.string().max(80).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.string().trim().max(1000).optional(),
});
export const libraryHierarchyGovernanceSchema = baseSchema.superRefine((value, ctx) => {
  if (new Set(value.roots.map((entry) => entry.id)).size !== value.roots.length)
    ctx.addIssue({ code: "custom", path: ["roots"], message: "Select distinct Library folders." });
  if (value.action === "extend-retention" && (!value.retentionUntil ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value.retentionUntil) ||
    !/(?:Z|[+-]\d\d:\d\d)$/.test(value.retentionUntil) ||
    !Number.isFinite(Date.parse(value.retentionUntil)) || Date.parse(value.retentionUntil) <= Date.now()))
    ctx.addIssue({ code: "custom", path: ["retentionUntil"], message: "Provide a future ISO retention deadline." });
});
export type LibraryHierarchyGovernanceCommand = z.infer<typeof libraryHierarchyGovernanceSchema>;

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function managedFolder(item: any) {
  return item.type === "folder" && ["packets-root", "project-folder"].includes(String(item.source || ""));
}
function rowFingerprint(item: any) {
  return [item.id, item.parentId || null, item.projectId || null, item.revision, item.type,
    item.source, item.status, item.lifecycleState, item.deletedAt ? new Date(item.deletedAt).toISOString() : null];
}

export async function inspectLibraryHierarchyGovernance(input: {
  tx: any; actorId: string; command: LibraryHierarchyGovernanceCommand;
  itemInclude: Record<string, unknown>;
  access: { contextForUser: (actor: any, tx: any, options?: any) => Promise<any>;
    visibleFor: (context: any, item: any, permission: "manage") => boolean };
}) {
  const { tx, actorId, command, itemInclude, access } = input;
  const roots = command.roots;
  if (!roots.length || roots.length > LIBRARY_GOVERNANCE_TREE_ROOT_LIMIT ||
    new Set(roots.map((row) => row.id)).size !== roots.length)
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_ROOTS", "Select up to eight distinct Library folders.");
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.archived || actor.accountState !== "ACTIVE" ||
    (actor.accessExpiresAt && new Date(actor.accessExpiresAt) <= new Date()))
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_ACCESS", "Active administrator access is required.", 403);
  const context = await access.contextForUser(actor, tx, { strict: true });
  if (!context.decorated?.isAdmin)
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_ACCESS", "Administrator authority is required.", 403);
  const canManage = (item: any) => access.visibleFor(context, item, "manage");
  const rootRows = await tx.libraryItem.findMany({ where: { id: { in: roots.map((row) => row.id) } }, include: itemInclude });
  const expected = new Map(roots.map((row) => [row.id, row.revision]));
  if (rootRows.length !== roots.length || rootRows.some((row: any) =>
    row.type !== "folder" || managedFolder(row) || !canManage(row) || expected.get(row.id) !== row.revision))
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_ACCESS", "Selected folders, permissions, or revisions changed. Preview again.", 403);
  let scope: Awaited<ReturnType<typeof inspectLibraryBulkScope<any>>>;
  try {
    scope = await inspectLibraryBulkScope(rootRows,
      (parents, take) => tx.libraryItem.findMany({ where: { parentId: { in: parents } }, include: itemInclude, take }),
      canManage, managedFolder, LIBRARY_GOVERNANCE_TREE_ITEM_LIMIT - rootRows.length);
  } catch (error) {
    if (error instanceof LibraryBulkScopeLimitError)
      throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_LIMIT", "More than 160 objects are in this selection. Choose smaller folders.");
    throw error;
  }
  if (scope.hasRestrictedDescendants || scope.hasProtectedDescendants)
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_ACCESS", "A descendant is inaccessible or managed by another workflow.", 403);
  const rows = [...rootRows, ...scope.descendants];
  const rootIds = new Set(roots.map((row) => row.id));
  const allById = new Map<string, any>(rows.map((row) => [row.id, row]));
  if (allById.size !== rows.length || rows.length > LIBRARY_GOVERNANCE_TREE_ITEM_LIMIT)
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_OVERLAP", "The hierarchy is overlapping or incomplete. Select parent folders only.");
  // Roots may not overlap even if the scope traversal deduplicates an inner root.
  for (const root of rootRows) {
    const seen = new Set<string>([root.id]);
    let cursor = root.parentId;
    while (cursor && allById.has(cursor)) {
      if (seen.has(cursor) || rootIds.has(cursor))
        throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_TREE_OVERLAP", "Selected folders overlap or form a cycle.");
      seen.add(cursor);
      cursor = allById.get(cursor).parentId;
    }
  }
  if (rows.some((row) => (row.projectId || null) !== (rootRows[0].projectId || null)))
    throw new LibraryBulkGuardError("LIBRARY_GOVERNANCE_PROJECT_BOUNDARY", "Hierarchy governance cannot cross Project boundaries.", 403);
  const ids = rows.map((row) => row.id);
  const flatCommand = libraryBulkGovernanceSchema.parse({
    ids, expectedRevisions: Object.fromEntries(rows.map((row) => [row.id, row.revision])),
    action: command.action, retentionUntil: command.retentionUntil,
  });
  const impact = await inspectLibraryBulkGovernance({ tx, command: flatCommand, itemInclude, canManage, hierarchyMode: true });
  // Parent pointers, Project scope, and managed-folder identity affect the
  // actual selection. A change to any of these invalidates the submitted digest.
  const topology = rows.map(rowFingerprint).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const digest = hash({ version: 1, actorId, roots: [...roots].sort((a, b) => a.id.localeCompare(b.id)),
    topology, impactDigest: impact.digest });
  return { ...impact, digest, scope: "hierarchy" as const, rootCount: roots.length,
    coverage: `${impact.coverage} This preview covers exactly ${rows.length} current items under ${roots.length} selected roots; it does not establish physical-disposal eligibility.` };
}

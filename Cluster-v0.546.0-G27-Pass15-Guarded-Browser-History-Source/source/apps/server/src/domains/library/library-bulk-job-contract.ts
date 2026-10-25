import { createHash } from "node:crypto";
import { z } from "zod";

// Metadata-only operations can be batched independently without relocating blobs,
// altering folder trees, or bypassing lifecycle/retention workflows.
export const libraryBulkMetadataRequestSchema = z.object({
  action: z.enum(["tag", "untag", "pin", "archive", "unarchive"]),
  tag: z.string().trim().min(1).max(80).optional(),
  pinned: z.boolean().optional(),
  query: z.record(z.unknown()).refine((value) => typeof value.section === "string" && typeof value.scope === "string", "Explicit Library scope is required.").optional(),
  collectionId: z.string().trim().min(1).max(240).optional(),
  expectedCollectionRevision: z.number().int().positive().optional(),
}).superRefine((input, context) => {
  if (Boolean(input.query) === Boolean(input.collectionId)) context.addIssue({ code: "custom", message: "Specify either a workspace query or a collection, not both." });
  if (Boolean(input.collectionId) !== Boolean(input.expectedCollectionRevision)) context.addIssue({ code: "custom", message: "A collection revision is required for collection operations." });
  if ((input.action === "tag" || input.action === "untag") && !input.tag) context.addIssue({ code: "custom", path: ["tag"], message: "A tag is required." });
  if (input.action === "pin" && input.pinned === undefined) context.addIssue({ code: "custom", path: ["pinned"], message: "A pin state is required." });
});

export type LibraryBulkTarget = { id: string; revision: number };

export function libraryBulkSelectionDigest(targets: readonly LibraryBulkTarget[]): string {
  return createHash("sha256").update(JSON.stringify(targets.map((target) => [target.id, target.revision]))).digest("hex");
}

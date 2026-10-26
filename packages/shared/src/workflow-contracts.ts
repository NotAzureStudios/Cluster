import { z } from "zod";
import { clusterResourceAddressSchema, type ClusterResourceAddress, type ClusterResourceKind } from "./resource-address.js";
import { CLUSTER_RELATABLE_RESOURCE_KINDS } from "./cluster-manifest.js";

export const CLUSTER_WORK_SOURCE_KINDS = CLUSTER_RELATABLE_RESOURCE_KINDS;
export type ClusterWorkSourceKind = (typeof CLUSTER_WORK_SOURCE_KINDS)[number];

export const CLUSTER_WORKFLOW_RELATIONSHIPS = [
  "relates_to",
  "blocks",
  "blocked_by",
  "depends_on",
  "parent_of",
  "supports",
  "references",
  "evidence_for",
  "ships_in",
  "tracks",
  "tests",
  "fixes",
  "reviews",
  "scheduled_by",
  "owned_by",
  "implements",
  "validates",
  "delivers",
  "informs",
  "approves",
  "supersedes",
  "duplicates",
] as const;

export type ClusterWorkflowRelationship = (typeof CLUSTER_WORKFLOW_RELATIONSHIPS)[number];

export type ClusterWorkSource = ClusterResourceAddress & {
  label?: string | null;
};

export const clusterWorkSourceSchema = clusterResourceAddressSchema.extend({
  kind: z.enum(CLUSTER_WORK_SOURCE_KINDS as [ClusterWorkSourceKind, ...ClusterWorkSourceKind[]]),
  label: z.string().trim().max(240).optional().nullable(),
});

export const workflowLinkInputSchema = z.object({
  source: clusterWorkSourceSchema,
  target: clusterWorkSourceSchema,
  relationship: z.enum(CLUSTER_WORKFLOW_RELATIONSHIPS),
  description: z.string().trim().max(1000).optional().nullable(),
  critical: z.boolean().optional().default(false),
});

export const workflowLinkPatchSchema = z.object({
  relationship: z.enum(CLUSTER_WORKFLOW_RELATIONSHIPS).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  critical: z.boolean().optional(),
});

export type WorkflowLinkPatch = z.infer<typeof workflowLinkPatchSchema>;

export const CLUSTER_WORKFLOW_RELATIONSHIP_META: Record<ClusterWorkflowRelationship, {
  outgoing: string;
  incoming: string;
  category: "general" | "dependency" | "hierarchy" | "delivery" | "reference" | "ownership" | "quality";
  blocking?: boolean;
}> = {
  relates_to: { outgoing: "Related to", incoming: "Related to", category: "general" },
  blocks: { outgoing: "Blocks", incoming: "Blocked by", category: "dependency", blocking: true },
  blocked_by: { outgoing: "Blocked by", incoming: "Blocks", category: "dependency", blocking: true },
  depends_on: { outgoing: "Depends on", incoming: "Required by", category: "dependency", blocking: true },
  parent_of: { outgoing: "Parent of", incoming: "Child of", category: "hierarchy" },
  supports: { outgoing: "Supports", incoming: "Supported by", category: "reference" },
  references: { outgoing: "References", incoming: "Referenced by", category: "reference" },
  evidence_for: { outgoing: "Evidence for", incoming: "Evidence attached", category: "quality" },
  ships_in: { outgoing: "Ships in", incoming: "Contains", category: "delivery" },
  tracks: { outgoing: "Tracks", incoming: "Tracked by", category: "general" },
  tests: { outgoing: "Tests", incoming: "Tested by", category: "quality" },
  fixes: { outgoing: "Fixes", incoming: "Fixed by", category: "delivery" },
  reviews: { outgoing: "Reviews", incoming: "Reviewed by", category: "quality" },
  scheduled_by: { outgoing: "Scheduled by", incoming: "Schedules", category: "general" },
  owned_by: { outgoing: "Owned by", incoming: "Owns", category: "ownership" },
  implements: { outgoing: "Implements", incoming: "Implemented by", category: "delivery" },
  validates: { outgoing: "Validates", incoming: "Validated by", category: "quality" },
  delivers: { outgoing: "Delivers", incoming: "Delivered by", category: "delivery" },
  informs: { outgoing: "Informs", incoming: "Informed by", category: "reference" },
  approves: { outgoing: "Approves", incoming: "Approved by", category: "quality" },
  supersedes: { outgoing: "Supersedes", incoming: "Superseded by", category: "general" },
  duplicates: { outgoing: "Duplicates", incoming: "Duplicated by", category: "general" },
};

export type WorkflowLinkInput = z.infer<typeof workflowLinkInputSchema>;

export const CLUSTER_WORK_ACTIONS = [
  "open",
  "open_window",
  "create_related",
  "link_work",
  "schedule",
  "assign",
  "mention",
  "copy_link",
  "copy_id",
  "view_activity",
] as const;

export type ClusterWorkActionId = (typeof CLUSTER_WORK_ACTIONS)[number];

export type ClusterWorkSourceView = ClusterWorkSource & {
  label: string;
  context?: string | null;
};

export type ClusterWorkflowLinkView = {
  id: string;
  projectId: string;
  relationship: string;
  description?: string | null;
  critical: boolean;
  createdAt: string;
  direction: "incoming" | "outgoing";
  source: ClusterWorkSourceView;
  target: ClusterWorkSourceView;
};

export type ClusterWorkflowLinksPayload = {
  projectId: string;
  subject: ClusterWorkSourceView;
  links: ClusterWorkflowLinkView[];
  canEdit?: boolean;
};

export type ClusterWorkflowLinkCandidatePayload = {
  projectId: string;
  candidates: ClusterWorkSourceView[];
};

export type ClusterWorkflowRelationshipSummary = {
  total: number;
  blockers: number;
  critical: number;
  labels: string[];
};

export const SHARED_CREATE_COMPLETED_EVENT = "cluster:shared-create-completed";


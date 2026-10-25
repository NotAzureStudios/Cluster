import {
  CLUSTER_RESOURCE_KINDS,
  type ClusterResourceKind,
} from "./resource-address.js";
import type { ClusterCustomFieldDefinition, ClusterCustomFieldValue } from "./custom-field-contracts.js";
import type { ClusterStudioAutomationAction, ClusterStudioAutomationEvent } from "./automation-contracts.js";
import {
  CLUSTER_WORKFLOW_RELATIONSHIPS,
  type ClusterWorkflowLinkView,
  type ClusterWorkflowRelationship,
  type ClusterWorkSource,
} from "./workflow-contracts.js";

/**
 * Shared Work is an interoperability layer over Cluster's existing resource and
 * workflow authorities. It must not create a second resource or relationship
 * taxonomy.
 */
export const SHARED_WORK_ENTITY_KINDS = [...CLUSTER_RESOURCE_KINDS, "workspace"] as const;
export type SharedWorkEntityKind = ClusterResourceKind | "workspace";

export type SharedWorkReference = Omit<ClusterWorkSource, "kind"> & {
  kind: SharedWorkEntityKind;
  href?: string | null;
};

/** Relationships remain owned by the canonical project workflow-link system. */
export const SHARED_WORK_RELATIONSHIPS = CLUSTER_WORKFLOW_RELATIONSHIPS;
export type SharedWorkRelationshipKind = ClusterWorkflowRelationship;
export type SharedWorkRelationship = ClusterWorkflowLinkView;

export const SHARED_WORK_ATTACHMENT_ROLES = ["attachment", "evidence", "reference", "artifact"] as const;
export type SharedWorkAttachmentRole = (typeof SHARED_WORK_ATTACHMENT_ROLES)[number];
export const SHARED_WORK_ATTACHMENT_RELATIONSHIPS = ["references", "supports", "validates", "delivers", "informs"] as const satisfies readonly ClusterWorkflowRelationship[];
export type SharedWorkAttachment = {
  id: string;
  owner: SharedWorkReference;
  resource: SharedWorkReference;
  role: SharedWorkAttachmentRole;
  relationship: ClusterWorkflowRelationship;
  direction: "incoming" | "outgoing";
  caption?: string | null;
  critical: boolean;
  createdAt: string;
};

export const SHARED_WORK_EVIDENCE_RESOURCE_KINDS = ["file", "library", "review_asset"] as const;
export type SharedWorkEvidenceResourceKind = (typeof SHARED_WORK_EVIDENCE_RESOURCE_KINDS)[number];

export type SharedWorkEvidenceMetadata = {
  title: string;
  context?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  status?: string | null;
  reviewState?: string | null;
  versionLabel?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  uploadedAt?: string | null;
  updatedAt?: string | null;
};

export type SharedWorkEvidenceItem = SharedWorkAttachment & {
  resource: SharedWorkReference & { kind: SharedWorkEvidenceResourceKind };
  metadata: SharedWorkEvidenceMetadata;
};

export type SharedWorkEvidencePayload = {
  projectId: string;
  subject: SharedWorkReference;
  items: SharedWorkEvidenceItem[];
  canEdit: boolean;
  canUpload: boolean;
};

export type SharedWorkEvidenceCandidate = {
  resource: SharedWorkReference & { kind: SharedWorkEvidenceResourceKind };
  metadata: SharedWorkEvidenceMetadata;
};

export type SharedWorkEvidenceCandidatePayload = {
  projectId: string;
  candidates: SharedWorkEvidenceCandidate[];
};

export function sharedWorkAttachmentFromLink(owner: SharedWorkReference, link: ClusterWorkflowLinkView): SharedWorkAttachment | null {
  const relationship = link.relationship as ClusterWorkflowRelationship;
  if (!(SHARED_WORK_ATTACHMENT_RELATIONSHIPS as readonly string[]).includes(relationship)) return null;
  const related = link.direction === "outgoing" ? link.target : link.source;
  const role: SharedWorkAttachmentRole = relationship === "delivers"
    ? "artifact"
    : relationship === "supports" || relationship === "validates"
      ? "evidence"
      : relationship === "informs"
        ? "reference"
        : ["file", "library", "review_asset"].includes(related.kind)
          ? "attachment"
          : "reference";
  return {
    id: link.id,
    owner,
    resource: related,
    role,
    relationship,
    direction: link.direction,
    caption: link.description || null,
    critical: Boolean(link.critical),
    createdAt: link.createdAt,
  };
}

export const SHARED_WORK_WATCH_ENTITY_KINDS = [
  "project",
  "board",
  "card",
  "ticket",
  "whiteboard",
  "build",
  "qa_plan",
  "qa_session",
  "timeline",
  "control",
  "library",
  "source_review",
  "workspace",
] as const satisfies readonly SharedWorkEntityKind[];
export type SharedWorkWatchEntityKind = (typeof SHARED_WORK_WATCH_ENTITY_KINDS)[number];
export type SharedWorkWatchReference = Omit<SharedWorkReference, "kind"> & { kind: SharedWorkWatchEntityKind };

export const SHARED_WORK_WATCH_SCOPES = ["all", "status", "comments", "files", "approvals"] as const;
export type SharedWorkWatchScope = (typeof SHARED_WORK_WATCH_SCOPES)[number];
export type SharedWorkWatcher = {
  id: string;
  entity: SharedWorkWatchReference;
  userId: string;
  scope: SharedWorkWatchScope;
  muted: boolean;
  createdAt: string;
  updatedAt?: string | null;
};

export type SharedWorkCommentAnchor = {
  kind: string;
  ids?: string[];
  label?: string;
  x?: number;
  y?: number;
  [key: string]: unknown;
};

export type SharedWorkCommentReactionMap = Record<string, string[]>;

export type SharedWorkCommentEvidenceLink = {
  kind: string;
  id: string;
  label?: string | null;
  href?: string | null;
};

export type SharedWorkComment = {
  id: string;
  /** Monotonic write revision. Mutations must supply the observed revision. */
  revision: number;
  entity: SharedWorkReference;
  userId?: string | null;
  body: string;
  mentionedUserIds?: string[];
  assigneeId?: string | null;
  parentCommentId?: string | null;
  threadRootId?: string | null;
  reactions?: SharedWorkCommentReactionMap;
  evidenceLinks?: SharedWorkCommentEvidenceLink[];
  pinned: boolean;
  resolved: boolean;
  resolvedAt?: string | null;
  resolvedById?: string | null;
  anchor?: SharedWorkCommentAnchor | null;
  createdAt: string;
  updatedAt: string;
};

export type SharedWorkActivity = {
  id: string;
  entity: SharedWorkReference;
  actorId?: string | null;
  type: string;
  title: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type SharedWorkFieldDefinition = ClusterCustomFieldDefinition;
export type SharedWorkFieldValue = ClusterCustomFieldValue["value"];

export const SHARED_WORK_SAVED_VIEW_VISIBILITIES = ["personal", "studio"] as const;
export type SharedWorkSavedViewVisibility = (typeof SHARED_WORK_SAVED_VIEW_VISIBILITIES)[number];
export type SharedWorkSavedView = {
  id: string;
  scope: string;
  name: string;
  values: Record<string, string>;
  ownerId?: string | null;
  visibility: SharedWorkSavedViewVisibility;
  createdAt: string;
  updatedAt?: string | null;
};

/** Studio automation remains the execution authority for Shared Work events/actions. */
export type SharedWorkEvent = ClusterStudioAutomationEvent;
export type SharedWorkAction = ClusterStudioAutomationAction;

export function sharedWorkReference(input: SharedWorkReference): SharedWorkReference {
  return {
    ...input,
    id: String(input.id).trim(),
    label: input.label == null ? null : String(input.label).trim(),
    projectId: input.projectId == null ? null : String(input.projectId).trim() || null,
    href: input.href == null ? null : String(input.href).trim() || null,
  };
}

export function isSharedWorkEntityKind(value: string): value is SharedWorkEntityKind {
  return (SHARED_WORK_ENTITY_KINDS as readonly string[]).includes(value);
}

export function normalizeSharedWorkWatchScopes(scopes: readonly SharedWorkWatchScope[]): SharedWorkWatchScope[] {
  const unique = [...new Set(scopes)];
  if (unique.includes("all")) return ["all"];
  return SHARED_WORK_WATCH_SCOPES.filter((scope) => scope !== "all" && unique.includes(scope));
}

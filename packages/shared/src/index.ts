import type { ClusterResourceKind } from "./cluster-manifest.js";
export * from "./cluster-manifest.js";
export * from "./tool-settings-contract.js";
export * from "./project-tool-setting-contract.js";
export * from "./command-registry.js";
export * from "./project-types.js";
export * from "./resource-address.js";
export * from "./resource-change.js";
export * from "./platform-spine-contracts.js";
export * from "./workstation-source-control-contracts.js";
export * from "./resource-graph-contracts.js";
export * from "./change-set-contracts.js";
export * from "./effective-state-contracts.js";
export * from "./explainability-contracts.js";
export * from "./lifecycle-contracts.js";
export * from "./domain-event-registry.js";
export * from "./decision-contracts.js";
export * from "./assignment-contracts.js";
export * from "./notification-contracts.js";
export * from "./notification-quiet-hours.js";
export * from "./delivery-contracts.js";
export * from "./external-portal-contracts.js";
export const CLUSTER_SHARED_VERSION = "1.2.1";

export type ClusterEntityKind = ClusterResourceKind | "milestone" | "comment" | "notification" | "approval" | "time";
export type ClusterLifecycleStatus =
  | "draft"
  | "active"
  | "in-review"
  | "approved"
  | "needs-update"
  | "deprecated"
  | "archived";
export type ClusterVisibility = "internal" | "external" | "public" | "private";
export const CLUSTER_ACCESS_TARGET_KINDS = ["project", "library", "file", "board", "whiteboard", "review_asset"] as const;
export type ClusterAccessTargetKind = (typeof CLUSTER_ACCESS_TARGET_KINDS)[number];
export type ClusterAccessSubjectKind = "member" | "team" | "external" | "all";
export type ClusterAccessEffect = "allow" | "deny";
export type ClusterAccessLevel = "none" | "view" | "contribute" | "manage";
export type ClusterAttachmentReviewState =
  | "draft"
  | "needs-review"
  | "approved"
  | "changes"
  | "archived";

export type ClusterEntityReference = {
  kind: ClusterEntityKind;
  id?: string | null;
  label: string;
  projectId?: string | null;
};

export type ClusterLink = {
  id: string;
  projectId?: string | null;
  source: ClusterEntityReference;
  target: ClusterEntityReference;
  relationship: string;
  createdAt: string;
  updatedAt?: string;
};

export type ClusterAttachmentReference = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  linkedEntity: ClusterEntityReference;
  projectId?: string | null;
  visibility: ClusterVisibility;
  versionLabel?: string | null;
  reviewState: ClusterAttachmentReviewState;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt?: string;
};

export type ClusterPersistenceKind =
  | "dependency"
  | "recurring"
  | "watcher"
  | "timeCorrection"
  | "timeRule"
  | "breakLedger"
  | "closeout"
  | "externalPortal"
  | "accessRule"
  | "attachment"
  | "maintenance"
  | "diagnostic"
  | "automationRule"
  | "controlSignal"
  | "approvalRequest"
  | "projectBudget"
  | "projectRole"
  | "meeting"
  | "versionSnapshot"
  | "boardView"
  | "whiteboardComponent"
  | "customFieldValue";

export type ClusterPersistenceValidationState =
  | "unchecked"
  | "pass"
  | "warn"
  | "fail";

export type ClusterPersistenceIntegrityIssue = {
  recordId?: string;
  kind?: ClusterPersistenceKind | string;
  severity: "info" | "warn" | "fail";
  code: string;
  message: string;
};

export type ClusterPersistenceValidationResult = {
  state: ClusterPersistenceValidationState;
  checksum: string;
  schemaVersion: number;
  issues: ClusterPersistenceIntegrityIssue[];
  warnings: ClusterPersistenceIntegrityIssue[];
};

export type ClusterPersistenceRecord = {
  id: string;
  kind: ClusterPersistenceKind;
  title: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  userId?: string | null;
  ownerId?: string | null;
  status?: string | null;
  visibility?: ClusterVisibility | string | null;
  sourceKey?: string | null;
  schemaVersion?: number;
  checksum?: string | null;
  validationState?: ClusterPersistenceValidationState | string | null;
  validationSummary?: string | null;
  lastValidatedAt?: string | null;
  locked?: boolean;
  deletedAt?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string | null;
  archived?: boolean;
  revision?: number;
};

export type ClusterPersistenceSummary = {
  version: string;
  generatedAt: string;
  totalRecords: number;
  archivedRecords: number;
  countsByKind: Partial<Record<ClusterPersistenceKind, number>>;
  localStorageBridges: Array<{
    kind: ClusterPersistenceKind;
    key: string;
    label: string;
  }>;
};

export { SCHEDULING_CONTRACT } from "./scheduling-contracts.js";
export type {
  CalendarEventInput,
  CalendarRangeQuery,
  TimelineItemInput,
  TimelineRangeQuery,
  ScheduleResourceType,
  ScheduleResourceStatus,
  ScheduleBlockStatus,
  ScheduleWindowKind,
  ScheduleResourceRequest,
  ScheduleBlockPlanningInput,
  SchedulePlacementConflict,
} from "./scheduling-contracts.js";

export * from "./api-contracts.js";

export * from "./api-schemas.js";

export * from "./search-operators.js";

export * from "./error-codes.js";

export * from "./workflow-contracts.js";

export * from "./people-contracts.js";

export * from "./kiosk-contracts.js";

export * from "./review-domain.js";

export * from "./viewable-resource.js";

export * from "./viewer-hardening.js";

export * from "./product-language.js";

export * from "./studio-systems-contracts.js";

export * from "./custom-field-contracts.js";
export * from "./automation-contracts.js";

export * from "./shared-work-contracts.js";

export * from "./board-planning-contracts.js";

export * from "./data-view-contracts.js";
export * from "./domain-data-fields.js";
export * from "./data-export-contracts.js";
export * from "./data-import-contracts.js";

export * from "./metric-contracts.js";

export * from "./project-snapshot-contracts.js";

export * from "./permission-bundle-contracts.js";

export * from "./project-role-policy.js";

export * from "./studio-form-visibility.js";

export * from "./ticket-stage-contract.js";

import type { ClusterResourceKind } from "./cluster-manifest.js";
import type { ClusterChangeSetPreview } from "./change-set-contracts.js";
import type { ClusterDataFieldType, ClusterDataScalar } from "./data-view-contracts.js";

export const CLUSTER_DATA_IMPORT_FORMATS = ["csv", "json", "xlsx"] as const;
export type ClusterDataImportFormat = (typeof CLUSTER_DATA_IMPORT_FORMATS)[number];

export const CLUSTER_DATA_IMPORT_CONFLICT_POLICIES = ["reject", "skip", "update"] as const;
export type ClusterDataImportConflictPolicy = (typeof CLUSTER_DATA_IMPORT_CONFLICT_POLICIES)[number];

export const CLUSTER_DATA_IMPORT_ROW_ACTIONS = ["created", "updated", "skipped", "already_applied", "failed"] as const;
export type ClusterDataImportRowAction = (typeof CLUSTER_DATA_IMPORT_ROW_ACTIONS)[number];

export type ClusterDataImportField = {
  fieldId: string;
  label: string;
  type: ClusterDataFieldType;
  required: boolean;
  aliases?: string[];
  enumValues?: string[];
};

export type ClusterDataImportIdentityEvidence = {
  fieldIds: string[];
  description: string;
  deterministicFallback: boolean;
};

export type ClusterDataImportSchema = {
  resourceKind: ClusterResourceKind;
  fields: ClusterDataImportField[];
  conflictPolicies: ClusterDataImportConflictPolicy[];
  /** Domain-owned identity semantics used to reconcile imported rows with existing resources. */
  identity?: ClusterDataImportIdentityEvidence | null;
  maxPreviewRows: number;
  maxApplyRows?: number;
  applySupported?: boolean;
};

export type ClusterDataImportColumn = {
  source: string;
  fieldId: string | null;
};

export type ClusterDataImportPreviewRequest = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataImportFormat;
  columns: ClusterDataImportColumn[];
  rows: Record<string, ClusterDataScalar>[];
  conflictPolicy?: ClusterDataImportConflictPolicy;
  sourceName?: string | null;
};

export type ClusterDataImportStage = {
  id: string;
  fingerprint: string;
  stagedAt: string;
  requiresConfirmation: true;
  changeSet: ClusterChangeSetPreview;
};

export type ClusterDataImportApplyRequest = ClusterDataImportPreviewRequest & {
  stageId: string;
  stageFingerprint: string;
  confirmed: true;
};

export type ClusterDataImportCellIssue = {
  row: number;
  source: string;
  fieldId?: string | null;
  code: string;
  message: string;
};

export type ClusterDataImportPreviewRow = {
  row: number;
  values: Record<string, ClusterDataScalar>;
  valid: boolean;
};

export type ClusterDataImportPreviewEvidence = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataImportFormat;
  conflictPolicy: ClusterDataImportConflictPolicy;
  sourceRowCount: number;
  columns: ClusterDataImportColumn[];
  mappedFieldIds: string[];
  ignoredColumns: string[];
  validRows: number;
  invalidRows: number;
  rows: ClusterDataImportPreviewRow[];
  issues: ClusterDataImportCellIssue[];
  dryRun: true;
  truncated: boolean;
  maxPreviewRows: number;
  stage?: ClusterDataImportStage;
};

export type ClusterDataImportQueued = {
  mode: "background";
  jobId: string;
  status: "queued";
  resourceKind: ClusterResourceKind;
  sourceArtifactId: string;
  sourceFingerprint: string;
  requestedAt: string;
};

export type ClusterDataImportRowOutcome = {
  row: number;
  action: ClusterDataImportRowAction;
  resourceId?: string | null;
  identity?: string | null;
  code?: string | null;
  message?: string | null;
};

export type ClusterDataImportApplyEvidence = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataImportFormat;
  conflictPolicy: ClusterDataImportConflictPolicy;
  sourceFingerprint: string;
  sourceArtifactId: string;
  sourceRowCount: number;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  alreadyAppliedRows: number;
  failedRows: number;
  partialFailure: boolean;
  rollbackAvailable: false;
  recovery: "rerun_safe";
  startedAt: string;
  finishedAt: string;
};

export type ClusterDataImportArtifact = {
  libraryItemId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
};

export type ClusterDataImportJobStatus = {
  jobId: string;
  status: string;
  progress: number;
  progressMessage?: string | null;
  evidence?: ClusterDataImportApplyEvidence | null;
  sourceArtifact?: ClusterDataImportArtifact | null;
  reportArtifact?: ClusterDataImportArtifact | null;
  error?: string | null;
};

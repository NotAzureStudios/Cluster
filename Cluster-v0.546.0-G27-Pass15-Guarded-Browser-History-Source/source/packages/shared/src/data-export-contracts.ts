import type { ClusterDataQuery } from "./data-view-contracts.js";
import type { ClusterResourceKind } from "./cluster-manifest.js";

export const CLUSTER_DATA_EXPORT_FORMATS = ["csv", "json", "xlsx"] as const;
export type ClusterDataExportFormat = (typeof CLUSTER_DATA_EXPORT_FORMATS)[number];

export const CLUSTER_DATA_EXPORT_SCOPES = ["view", "selection"] as const;
export type ClusterDataExportScope = (typeof CLUSTER_DATA_EXPORT_SCOPES)[number];

export const CLUSTER_DATA_EXPORT_DELIVERIES = ["download", "library"] as const;
export type ClusterDataExportDelivery = (typeof CLUSTER_DATA_EXPORT_DELIVERIES)[number];

export type ClusterDataExportRequest = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery?: ClusterDataExportDelivery;
  fieldIds?: string[];
  query?: ClusterDataQuery;
  selectedIds?: string[];
  fileName?: string | null;
};

export type ClusterDataExportEvidence = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery?: ClusterDataExportDelivery;
  rowCount: number;
  fieldIds: string[];
  omittedFieldIds: string[];
  generatedAt: string;
  truncated: boolean;
  maxRows: number;
};

export type ClusterDataExportArtifact = {
  libraryItemId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  evidence: ClusterDataExportEvidence;
};

export type ClusterDataExportJobReceipt = {
  mode: "background";
  jobId: string;
  status: "queued";
  resourceKind: ClusterResourceKind;
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery: "library";
  requestedAt: string;
};

export type ClusterDataExportJobStatus = {
  jobId: string;
  status: string;
  progress: number;
  progressMessage?: string | null;
  artifact?: ClusterDataExportArtifact | null;
  error?: string | null;
};

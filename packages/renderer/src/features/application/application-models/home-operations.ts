import type { EntityKind } from "./identity";
import type { ProjectCloseoutChecklistKey } from "./workflow-access";
import type { ReactNode } from "react";
import type { ClusterDashboardWidgetGroup, ClusterDashboardWidgetKey } from "@cluster/shared";

export type DashboardWidgetKey = ClusterDashboardWidgetKey;
export type DashboardWidgetGroup = ClusterDashboardWidgetGroup;

export type DashboardWidgetDefinition = {
  key: DashboardWidgetKey;
  label: string;
  detail: string;
  group: DashboardWidgetGroup;
  tool?: string;
  adminOnly?: boolean;
  desktopOnly?: boolean;
  configurable?: boolean;
};

export type AttachmentVisibility = "internal" | "external" | "private" | "public";

export type AttachmentReviewState = "draft" | "needs-review" | "approved" | "changes" | "archived";

export type AttachmentRecord = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  sizeLabel?: string | null;
  url?: string | null;
  linkedKind: EntityKind;
  linkedLabel: string;
  projectId?: string | null;
  visibility: AttachmentVisibility;
  versionLabel?: string | null;
  reviewState: AttachmentReviewState;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt?: string;
  notes?: string | null;
};

export type DiagnosticTone = "pass" | "warn" | "fail" | "info";

export type OpsDiagnosticCheck = {
  key: string;
  label: string;
  status: DiagnosticTone;
  detail: string;
  owner?: string;
};

export type ControlDomainKey = "command" | "workflow" | "time" | "qa" | "external" | "files" | "team";

export type PersistenceKind = "dependency" | "recurring" | "watcher" | "timeCorrection" | "timeRule" | "breakLedger" | "closeout" | "externalPortal" | "accessRule" | "attachment" | "maintenance" | "diagnostic" | "automationRule" | "controlSignal";

export type PersistenceSummary = {
  version: string;
  generatedAt: string;
  totalRecords: number;
  archivedRecords: number;
  countsByKind: Partial<Record<PersistenceKind, number>>;
};

export type PersistenceIntegrityIssue = {
  recordId?: string;
  kind?: string;
  severity: "info" | "warn" | "fail";
  code: string;
  message: string;
};

export type PersistenceIntegritySummary = {
  ok: boolean;
  version: string;
  generatedAt: string;
  scanned: number;
  lockedCount: number;
  checksumMismatches: number;
  countsByKind: Record<string, number>;
  countsByValidationState: Record<string, number>;
  issueCounts: { fail: number; warn: number; info: number };
  issues: PersistenceIntegrityIssue[];
};

export type PersistenceRecord = {
  id: string;
  kind: PersistenceKind;
  title: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  userId?: string | null;
  ownerId?: string | null;
  status?: string | null;
  visibility?: string | null;
  sourceKey?: string | null;
  schemaVersion?: number;
  checksum?: string | null;
  validationState?: "unchecked" | "pass" | "warn" | "fail" | string | null;
  validationSummary?: string | null;
  locked?: boolean;
  deletedAt?: string | null;
  payload: Record<string, unknown>;
  archived?: boolean;
  syncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CloseoutCheckSource = "auto" | "manual" | "lead";

export type CloseoutCheckEvaluation = {
  key: ProjectCloseoutChecklistKey;
  label: string;
  detail: string;
  done: boolean;
  source: CloseoutCheckSource;
  sourceLabel: string;
  evidence: string;
  locked?: boolean;
};

export type DetailDrawerItem = {
  kind: string;
  title: string;
  subtitle?: string;
  description?: string;
  fields?: Array<{ label: string; value?: ReactNode }>;
  actions?: Array<{
    label: string;
    tone?: "primary" | "secondary" | "danger";
    onClick: () => void;
  }>;
};

export type InboxWorkflowAction = {
  id: string;
  notificationId: string;
  action: "done" | "snoozed" | "approved" | "assigned" | "commented";
  note?: string;
  createdAt: string;
};

export type NotificationApprovalAction = {
  type: "avatar" | "time";
  auditId?: string;
  userId?: string;
  start?: string;
  end?: string;
};

export type NotificationSeverity = "info" | "good" | "important" | "critical";

export type NotificationWorkflowItem = {
  id: string;
  kind: string;
  title: string;
  message?: string;
  projectName?: string;
  projectId?: string | null;
  actor?: string;
  createdAt: string;
  sourceKey?: string;
  entityType?: string;
  entityId?: string | null;
  approval?: NotificationApprovalAction;
  severity?: NotificationSeverity;
};

export type DiagnosticsPayload = {
  ok: boolean;
  version: string;
  generatedAt: string;
  nodeEnv?: string;
  dataRoot?: string;
  uploadRoot?: string;
  databaseUrl?: string;
  configFile?: string;
  counts: {
    projects: number;
    boards: number;
    cards: number;
    users: number;
    sessions: number;
    whiteboards: number;
    timelineItems: number;
    libraryItems: number;
    timeEntries: number;
    uploads: number;
    attachments?: number;
    backups: number;
    exports: number;
    logs: number;
  };
  features: Record<string, boolean>;
  runtime?: {
    readiness?: { ok?: boolean; latencyMs?: number; checkedAt?: string; cached?: boolean } | null;
    performance?: {
      requests?: { total?: number; errors?: number; errorRate?: number; inFlight?: number; averageMs?: number; p50Ms?: number; p95Ms?: number; p99Ms?: number; maxMs?: number; slow?: number };
      eventLoop?: { meanMs?: number; p95Ms?: number; maxMs?: number };
      memory?: { rssMiB?: number; heapUsedMiB?: number; heapTotalMiB?: number; heapLimitMiB?: number; externalMiB?: number };
      routes?: Array<{ route: string; count: number; errors: number; averageMs: number; p50Ms?: number; p95Ms: number; p99Ms?: number; maxMs: number }>;
    };
  };
  folders: Array<{ key: string; path: string; exists: boolean; files: number }>;
  healthChecks?: OpsDiagnosticCheck[];
  notes: string[];
};

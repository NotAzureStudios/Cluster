import type { ClusterResourceAddress } from "./resource-address.js";

/**
 * Shared reliability metadata carried by commands, events, and long-running
 * operations. Correlation groups one logical flow; causation identifies the
 * immediate parent action/event/job when one exists.
 */
export type ClusterTraceContext = {
  correlationId: string;
  causationId?: string | null;
  requestId?: string | null;
};

export type ClusterActorReference = {
  userId?: string | null;
  sessionId?: string | null;
  source?: "user" | "automation" | "system" | "integration" | "worker";
};

export type ClusterCommandEnvelope<TPayload = unknown> = {
  id: string;
  type: string;
  schemaVersion: number;
  requestedAt: string;
  workspaceId?: string | null;
  projectId?: string | null;
  resource?: ClusterResourceAddress | null;
  actor?: ClusterActorReference | null;
  trace: ClusterTraceContext;
  idempotencyKey?: string | null;
  dryRun?: boolean;
  payload: TPayload;
};

export type ClusterCommandIssueSeverity = "info" | "warning" | "error";

export type ClusterCommandIssue = {
  code: string;
  message: string;
  severity: ClusterCommandIssueSeverity;
  field?: string | null;
  resource?: ClusterResourceAddress | null;
  action?: string | null;
};

export const CLUSTER_IMPACT_CHANGE_KINDS = ["create", "update", "delete", "action"] as const;
export type ClusterImpactChangeKind = (typeof CLUSTER_IMPACT_CHANGE_KINDS)[number];

export type ClusterImpactChange = {
  kind: ClusterImpactChangeKind;
  resource: ClusterResourceAddress;
  field?: string | null;
  label?: string | null;
  before?: unknown;
  after?: unknown;
};

export type ClusterImpactPreview = {
  summary: string;
  affectedResources: ClusterResourceAddress[];
  issues: ClusterCommandIssue[];
  changes?: ClusterImpactChange[];
  metadata?: Record<string, unknown>;
};

export type ClusterCommandSuccess<TResult = unknown> = {
  ok: true;
  commandId: string;
  commandType: string;
  correlationId: string;
  dryRun: boolean;
  result: TResult;
  impact?: ClusterImpactPreview | null;
  emittedEventIds?: string[];
  operationIds?: string[];
};

export type ClusterCommandFailure = {
  ok: false;
  commandId: string;
  commandType: string;
  correlationId: string;
  dryRun: boolean;
  error: ClusterCommandIssue;
  issues?: ClusterCommandIssue[];
  impact?: ClusterImpactPreview | null;
};

export type ClusterCommandResult<TResult = unknown> = ClusterCommandSuccess<TResult> | ClusterCommandFailure;

export type ClusterCommandAuditEvidence = {
  commandId: string;
  commandType: string;
  correlationId: string;
  causationId?: string | null;
  actorUserId?: string | null;
  resource?: ClusterResourceAddress | null;
  dryRun: boolean;
  outcome: "succeeded" | "rejected" | "failed" | "dry-run";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  issueCodes?: string[];
};

/** Durable event envelope shared by the outbox and all event consumers. */
export type ClusterDomainEvent<TPayload = unknown> = {
  id: string;
  type: string;
  schemaVersion?: number;
  workspaceId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  occurredAt: Date;
  actorUserId?: string | null;
  projectId?: string | null;
  resource?: ClusterResourceAddress | null;
  resourceRevision?: string | null;
  payload: TPayload;
};

export const CLUSTER_OPERATION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead-letter",
  "cancelled",
] as const;

export type ClusterOperationStatus = (typeof CLUSTER_OPERATION_STATUSES)[number];

export type ClusterOperationAttempt = {
  attempt: number;
  workerId?: string | null;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  error?: string | null;
};

export type ClusterOperation = {
  id: string;
  type: string;
  queue: string;
  status: ClusterOperationStatus;
  workspaceId?: string | null;
  createdById?: string | null;
  trace: ClusterTraceContext;
  priority: number;
  costUnits: number;
  progress: number;
  progressMessage?: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  cancelRequestedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  payload?: unknown;
  result?: unknown;
  attemptHistory?: ClusterOperationAttempt[];
};

export type ClusterOperationAuthorizationRequirement = {
  actorUserId?: string | null;
  action: "view" | "contribute" | "manage" | "admin" | "subscribe" | "disclose-private";
  resource:
    | { kind: "workspace" }
    | { kind: "tool"; tool: string }
    | { kind: "project"; projectId: string }
    | { kind: "target"; targetKind: string; targetId: string; projectId?: string | null }
    | { kind: "user"; ownerUserId?: string | null; tool: string; allowUnowned?: boolean };
  minimum?: "view" | "contribute" | "manage" | string;
  tool?: string | null;
};

export type ClusterOperationRequest<TPayload = unknown> = {
  type: string;
  queue?: string;
  workspaceId?: string | null;
  trace?: Partial<ClusterTraceContext>;
  payload?: TPayload;
  priority?: number;
  costUnits?: number;
  maxAttempts?: number;
  runAfter?: string | Date;
  dedupeKey?: string | null;
  createdById?: string | null;
  authorization?: ClusterOperationAuthorizationRequirement | null;
};

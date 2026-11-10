import type { ClusterLifecycleDefinition, ClusterSemanticField } from "@cluster/shared";
import { assertLifecycleTransition, lifecycleTransitionMap } from "../../core/state-machine.js";

export const BACKGROUND_JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"] as const;
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number];

export const BACKGROUND_JOB_DATA_FIELDS = [
  { id: "id", label: "Job ID", type: "text", sortable: true, filterable: true, exportable: true, sensitivity: "internal" },
  { id: "status", label: "Status", type: "status", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "queue", label: "Queue", type: "text", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "type", label: "Type", type: "text", sortable: true, filterable: true, groupable: true, facet: true, exportable: true },
  { id: "correlationId", label: "Correlation ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "causationId", label: "Causation ID", type: "text", filterable: true, exportable: true, sensitivity: "internal" },
  { id: "priority", label: "Priority", type: "number", sortable: true, filterable: true, groupable: true, aggregatable: true, exportable: true, display: { format: "integer" } },
  { id: "attempts", label: "Attempts", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "integer" } },
  { id: "maxAttempts", label: "Max attempts", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "integer" } },
  { id: "progress", label: "Progress", type: "number", sortable: true, filterable: true, aggregatable: true, exportable: true, display: { format: "percent", precision: 0 } },
  { id: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true, groupable: true, exportable: true },
  { id: "updatedAt", label: "Updated", type: "datetime", sortable: true, filterable: true, groupable: true, exportable: true },
  { id: "startedAt", label: "Started", type: "datetime", sortable: true, exportable: true },
  { id: "finishedAt", label: "Finished", type: "datetime", sortable: true, exportable: true },
  { id: "lastError", label: "Last error", type: "text", filterable: true, exportable: false, sensitivity: "internal" },
] as const satisfies readonly ClusterSemanticField[];

export const BACKGROUND_JOB_LIFECYCLE = {
  id: "background-job",
  label: "Background job",
  states: BACKGROUND_JOB_STATUSES,
  initialState: "QUEUED",
  terminalStates: ["SUCCEEDED"],
  transitions: {
    QUEUED: [
      { to: "RUNNING", label: "Start" },
      { to: "CANCELLED", label: "Cancel", risk: "destructive" },
      { to: "DEAD_LETTER", label: "Dead-letter", risk: "sensitive" },
    ],
    RUNNING: [
      { to: "QUEUED", label: "Retry", description: "Return the job to the durable queue for another attempt.", risk: "sensitive" },
      { to: "SUCCEEDED", label: "Complete" },
      { to: "DEAD_LETTER", label: "Dead-letter", risk: "sensitive" },
      { to: "CANCELLED", label: "Cancel", risk: "destructive" },
    ],
    SUCCEEDED: [],
    FAILED: [{ to: "QUEUED", label: "Retry", risk: "sensitive" }],
    DEAD_LETTER: [{ to: "QUEUED", label: "Retry", risk: "sensitive" }],
    CANCELLED: [{ to: "QUEUED", label: "Retry", risk: "sensitive" }],
  },
} as const satisfies ClusterLifecycleDefinition<BackgroundJobStatus>;

export const BACKGROUND_JOB_TRANSITIONS = lifecycleTransitionMap(BACKGROUND_JOB_LIFECYCLE);

export function assertBackgroundJobTransition(from: BackgroundJobStatus, to: BackgroundJobStatus) {
  assertLifecycleTransition(BACKGROUND_JOB_LIFECYCLE, from, to);
}

export class BackgroundJobCancelledError extends Error {
  readonly code = "BACKGROUND_JOB_CANCELLED";
  constructor(message = "Background job was cancelled.") { super(message); this.name = "BackgroundJobCancelledError"; }
}

export class BackgroundJobLeaseLostError extends Error {
  readonly code = "BACKGROUND_JOB_LEASE_LOST";
  constructor(message = "Background job lease is no longer owned by this worker.") { super(message); this.name = "BackgroundJobLeaseLostError"; }
}

export class BackgroundJobRetryError extends Error {
  readonly code = "BACKGROUND_JOB_RETRY";
  constructor(message: string, readonly retryDelayMs: number, readonly cause?: unknown) { super(message); this.name = "BackgroundJobRetryError"; }
}

/** The owning feature was suspended before work began; preserve durable
 * work without burning its retry budget or reporting a false success. */
export class BackgroundJobDeferredError extends Error {
  constructor(message = "Job owner is disabled.") { super(message); this.name = "BackgroundJobDeferredError"; }
}

export class BackgroundJobAuthorizationError extends Error {
  readonly terminalJobFailure = true;
  constructor(message: string, readonly code = "BACKGROUND_JOB_AUTHORIZATION_REVOKED") { super(message); this.name = "BackgroundJobAuthorizationError"; }
}

export type BackgroundJobRecord = {
  id: string;
  queue: string;
  type: string;
  workspaceId: string | null;
  correlationId: string | null;
  causationId: string | null;
  status: BackgroundJobStatus;
  priority: number;
  costUnits: number;
  payload: string;
  result: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  progress: number;
  progressMessage: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  createdById: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BackgroundJobAttemptRecord = {
  id: string;
  jobId: string;
  attempt: number;
  workerId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
};


export const BACKGROUND_JOB_AUTHORIZATION_PAYLOAD_KEY = "__clusterAuthorization" as const;

export type BackgroundJobAuthorizationRequirement = {
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

export type BackgroundJobExecutionAuthorizationResult = { allowed: boolean; code?: string | null; reason?: string | null };
export type BackgroundJobExecutionAuthorizer = (input: { job: BackgroundJobRecord; requirement: BackgroundJobAuthorizationRequirement }) => Promise<BackgroundJobExecutionAuthorizationResult>;

export type EnqueueBackgroundJobInput = {
  type: string;
  queue?: string;
  workspaceId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  payload?: unknown;
  priority?: number;
  costUnits?: number;
  maxAttempts?: number;
  runAfter?: Date;
  dedupeKey?: string | null;
  createdById?: string | null;
  authorization?: BackgroundJobAuthorizationRequirement | null;
};

export type BackgroundJobQueueCounts = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  total: number;
};

export type BackgroundJobHandlerContext<TPayload = unknown> = {
  job: BackgroundJobRecord;
  payload: TPayload;
  updateProgress: (progress: number, message?: string | null) => Promise<void>;
  enqueue: (input: EnqueueBackgroundJobInput) => Promise<BackgroundJobRecord>;
  cancellationRequested: () => Promise<boolean>;
  signal: AbortSignal;
  throwIfCancelled: () => Promise<void>;
  /** Recheck current authoritative tool availability at a safe, retryable
   * boundary. Owned work is deferred without consuming a retry attempt.
   * Never call after an irreversible commit merely to pause the job: finish
   * that commit safely and let future work observe the disabled tool. */
  throwIfToolUnavailable: () => Promise<void>;
};

export type BackgroundJobHandler<TPayload = unknown> = (context: BackgroundJobHandlerContext<TPayload>) => Promise<unknown>;

/**
 * Canonical local workstation source-control contract.
 *
 * This protocol is intentionally SCM-shaped instead of Git-shaped so Unreal and
 * future editor integrations do not become independent Git implementations.
 * Cluster Desktop/Workstation owns local repository execution and credentials.
 */
export const CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL = 1 as const;

export const CLUSTER_WORKSTATION_SOURCE_CONTROL_ACTIONS = [
  "runtime.status",
  "repository.resolve",
  "repository.status",
  "repository.sync",
  "repository.history",
  "files.status",
  "files.checkout",
  "files.add",
  "files.delete",
  "files.revert",
  "changes.commit",
  "locks.list",
  "locks.acquire",
  "locks.release",
  "diff.read",
  "revision.materialize",
  "operation.start",
  "operation.status",
  "operation.cancel",
  "cluster.open",
] as const;

export type ClusterWorkstationSourceControlAction = (typeof CLUSTER_WORKSTATION_SOURCE_CONTROL_ACTIONS)[number];

export const CLUSTER_WORKSTATION_FILE_STATES = [
  "clean",
  "untracked",
  "added",
  "modified",
  "deleted",
  "renamed",
  "conflicted",
  "ignored",
] as const;
export type ClusterWorkstationFileStateKind = (typeof CLUSTER_WORKSTATION_FILE_STATES)[number];

export type ClusterWorkstationSourceControlRuntime = {
  schema: 1;
  protocol: typeof CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL;
  available: boolean;
  desktopVersion?: string | null;
  serviceVersion?: string | null;
  authenticatedLocalIpc: boolean;
  rawPathExposure: false;
  capabilities: ClusterWorkstationSourceControlAction[];
};

export type ClusterWorkstationRepositoryResolution = {
  schema: 1;
  repositoryId: string;
  workspaceId: string;
  displayName: string;
  provider: "git";
  projectRelativePrefix: string;
  trusted: true;
};

export type ClusterWorkstationRepositoryStatus = {
  schema: 1;
  repositoryId: string;
  workspaceId?: string | null;
  displayName: string;
  provider: "git";
  branch: string;
  detached: boolean;
  upstream?: string | null;
  ahead: number;
  behind: number;
  changedFiles: number;
  conflicts: number;
  clean: boolean;
  lfsAvailable: boolean;
  lockablePatterns: string[];
  remotes: Array<{ name: string; url?: string | null }>;
  updatedAt: string;
};

export type ClusterWorkstationSourceControlLock = {
  id?: string | null;
  path: string;
  owner?: string | null;
  lockedAt?: string | null;
  ownership: "ours" | "theirs" | "unknown";
};

export type ClusterWorkstationFileState = {
  path: string;
  state: ClusterWorkstationFileStateKind;
  staged: boolean;
  tracked: boolean;
  ignored: boolean;
  binary: boolean;
  lockable: boolean;
  lock?: ClusterWorkstationSourceControlLock | null;
  headRevision?: string | null;
  modifiedAt?: string | null;
};

export type ClusterWorkstationSourceControlHistoryEntry = {
  revision: string;
  shortRevision: string;
  summary: string;
  author?: string | null;
  authoredAt?: string | null;
};

export type ClusterWorkstationSourceControlRequest<TInput extends Record<string, unknown> = Record<string, unknown>> = {
  schema: 1;
  protocol: typeof CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL;
  requestId: string;
  action: ClusterWorkstationSourceControlAction;
  repositoryId?: string | null;
  paths?: string[];
  input?: TInput;
};

export type ClusterWorkstationSourceControlError = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ClusterWorkstationSourceControlResponse<T = unknown> = {
  schema: 1;
  protocol: typeof CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL;
  requestId: string;
  ok: boolean;
  result?: T;
  error?: ClusterWorkstationSourceControlError;
};


export type ClusterWorkstationSourceControlOperationState = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";

export type ClusterWorkstationSourceControlOperation = {
  schema: 2;
  id: string;
  kind: string;
  state: ClusterWorkstationSourceControlOperationState;
  stage: string;
  repositoryId: string;
  targetLabel?: string | null;
  progress: number;
  progressMessage?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  lastError?: string | null;
  result?: unknown;
};

export type ClusterWorkstationOperationStartInput = {
  action: "repository.sync" | "changes.commit";
  mode?: "fetch" | "pull" | "push";
  message?: string;
  push?: boolean;
};

export type ClusterWorkstationOperationLookupInput = { operationId: string };

export type ClusterWorkstationHistoryInput = {
  limit?: number;
};

export type ClusterWorkstationDiffInput = {
  staged?: boolean;
  baseRevision?: string;
  targetRevision?: string;
};


export type ClusterWorkstationRevisionMaterializeInput = {
  revision: string;
};

export type ClusterWorkstationRevisionMaterializeResult = {
  revision: string;
  path: string;
  materializedPath: string;
  size: number;
  cached: boolean;
};

export type ClusterWorkstationCommitInput = {
  message: string;
  paths?: string[];
  push?: boolean;
};

export type ClusterWorkstationCheckoutInput = {
  lock?: boolean;
};

export function isClusterWorkstationSourceControlAction(value: unknown): value is ClusterWorkstationSourceControlAction {
  return typeof value === "string" && (CLUSTER_WORKSTATION_SOURCE_CONTROL_ACTIONS as readonly string[]).includes(value);
}

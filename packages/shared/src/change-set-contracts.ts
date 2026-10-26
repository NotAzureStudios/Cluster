import type {
  ClusterCommandEnvelope,
  ClusterCommandIssue,
  ClusterCommandResult,
  ClusterImpactPreview,
  ClusterTraceContext,
} from "./platform-spine-contracts.js";

/**
 * Change sets intentionally do not imply a distributed transaction. `none`
 * means commands execute independently. `domain` is reserved for a caller
 * that can prove all items share one transactional authority.
 */
export const CLUSTER_CHANGE_SET_ATOMICITY = ["none", "domain"] as const;
export type ClusterChangeSetAtomicity = (typeof CLUSTER_CHANGE_SET_ATOMICITY)[number];

export type ClusterChangeSetItem = {
  key: string;
  label?: string | null;
  command: ClusterCommandEnvelope;
};

export type ClusterChangeSetPlan = {
  id: string;
  title?: string | null;
  description?: string | null;
  trace: ClusterTraceContext;
  atomicity: ClusterChangeSetAtomicity;
  stopOnFailure: boolean;
  items: ClusterChangeSetItem[];
};

export type ClusterChangeSetItemPreview = {
  key: string;
  commandId: string;
  commandType: string;
  impact?: ClusterImpactPreview | null;
  issues: ClusterCommandIssue[];
};

export type ClusterChangeSetPreview = {
  id: string;
  title?: string | null;
  atomicity: ClusterChangeSetAtomicity;
  executable: boolean;
  impact: ClusterImpactPreview;
  items: ClusterChangeSetItemPreview[];
};

export type ClusterChangeSetExecution = {
  id: string;
  atomicity: ClusterChangeSetAtomicity;
  completed: number;
  failed: number;
  stoppedEarly: boolean;
  results: Array<{ key: string; result: ClusterCommandResult }>;
};

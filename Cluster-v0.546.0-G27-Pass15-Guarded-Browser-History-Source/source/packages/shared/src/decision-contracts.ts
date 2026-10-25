import type { ClusterLifecycleDefinition } from "./lifecycle-contracts.js";
import type { ClusterResourceAddress } from "./resource-address.js";

export const CLUSTER_DECISION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ClusterDecisionStatus = (typeof CLUSTER_DECISION_STATUSES)[number];

export const CLUSTER_DECISION_LIFECYCLE = {
  id: "decision",
  label: "Decision",
  states: CLUSTER_DECISION_STATUSES,
  initialState: "pending",
  terminalStates: ["approved", "rejected", "cancelled"],
  transitions: {
    pending: [
      { to: "approved", label: "Approve", risk: "sensitive" },
      { to: "rejected", label: "Reject", risk: "sensitive" },
      { to: "cancelled", label: "Cancel", risk: "destructive" },
    ],
    approved: [],
    rejected: [],
    cancelled: [],
  },
} as const satisfies ClusterLifecycleDefinition<ClusterDecisionStatus>;

export type ClusterDecisionRequest = {
  id: string;
  type: string;
  title: string;
  status: ClusterDecisionStatus;
  projectId?: string | null;
  resource?: ClusterResourceAddress | null;
  requestedById?: string | null;
  requestedByName?: string | null;
  reason?: string | null;
  note?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  payload: Record<string, unknown>;
  sourceKey?: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string | null;
  decidedById?: string | null;
  decisionNote?: string | null;
};

export type ClusterDecisionRequestInput = {
  id?: string;
  type: string;
  title: string;
  projectId?: string | null;
  resource?: ClusterResourceAddress | null;
  requestedById?: string | null;
  requestedByName?: string | null;
  reason?: string | null;
  sourceKey?: string | null;
  payload?: Record<string, unknown>;
  storageData?: Record<string, unknown>;
  upsert?: boolean;
};

export type ClusterDecisionOutcome = "approved" | "rejected";

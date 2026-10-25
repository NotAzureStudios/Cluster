import type { ClusterResourceAddress } from "./resource-address.js";

export const CLUSTER_ASSIGNMENT_SUBJECT_KINDS = ["user", "team", "department", "job_role"] as const;
export type ClusterAssignmentSubjectKind = (typeof CLUSTER_ASSIGNMENT_SUBJECT_KINDS)[number];

export const CLUSTER_ASSIGNMENT_KINDS = [
  "assignee",
  "owner",
  "reviewer",
  "tester",
  "participant",
  "responsible",
  "accountable",
  "consulted",
  "informed",
  "approver",
] as const;
export type ClusterAssignmentKind = (typeof CLUSTER_ASSIGNMENT_KINDS)[number];

export const CLUSTER_ASSIGNMENT_STATES = ["active", "completed", "cancelled"] as const;
export const CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE = "work_assignment_changed";
export const CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT = "cluster:work-assignment-changed";
export type ClusterAssignmentState = (typeof CLUSTER_ASSIGNMENT_STATES)[number];

export type ClusterAssignmentSubject = {
  kind: ClusterAssignmentSubjectKind;
  id: string;
  label?: string | null;
};

/**
 * Canonical representation of responsibility in Cluster. Individual domains
 * may keep native storage during convergence, but adapters and events should
 * expose assignments through this contract instead of inventing new shapes.
 */
export type ClusterAssignment = {
  id: string;
  resource: ClusterResourceAddress;
  subject: ClusterAssignmentSubject;
  kind: ClusterAssignmentKind;
  state: ClusterAssignmentState;
  projectId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
};

export type ClusterAssignmentChange = {
  resource: ClusterResourceAddress;
  kind: ClusterAssignmentKind;
  subject?: ClusterAssignmentSubject | null;
  previousSubject?: ClusterAssignmentSubject | null;
  projectId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  actorUserId?: string | null;
  sourceLabel?: string | null;
};

export function clusterAssignmentIdentity(input: {
  resource: ClusterResourceAddress;
  kind: ClusterAssignmentKind;
  subject: ClusterAssignmentSubject;
}) {
  const project = input.resource.projectId ? `:${input.resource.projectId}` : "";
  return `${input.resource.kind}:${input.resource.id}${project}:${input.kind}:${input.subject.kind}:${input.subject.id}`;
}

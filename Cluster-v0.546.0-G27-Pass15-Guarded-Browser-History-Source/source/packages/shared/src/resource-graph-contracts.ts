import type { ClusterResourceAddress } from "./resource-address.js";
import type { ClusterWorkflowRelationship } from "./workflow-contracts.js";

export const CLUSTER_RESOURCE_GRAPH_DIRECTIONS = ["both", "incoming", "outgoing"] as const;
export type ClusterResourceGraphDirection = (typeof CLUSTER_RESOURCE_GRAPH_DIRECTIONS)[number];
export const CLUSTER_RESOURCE_GRAPH_CATEGORIES = ["general", "dependency", "hierarchy", "delivery", "reference", "ownership", "quality"] as const;
export type ClusterResourceGraphCategory = (typeof CLUSTER_RESOURCE_GRAPH_CATEGORIES)[number];

export type ClusterResourceGraphNode = {
  resource: ClusterResourceAddress;
  depth: number;
  /** Display metadata is hydrated only after both endpoints pass access checks. */
  label?: string;
  context?: string | null;
};

export type ClusterResourceGraphEdge = {
  id: string;
  projectId: string;
  source: ClusterResourceAddress;
  target: ClusterResourceAddress;
  relationship: ClusterWorkflowRelationship;
  category: ClusterResourceGraphCategory;
  critical: boolean;
  blocking: boolean;
  description?: string | null;
  createdAt?: string | null;
};

export type ClusterResourceGraphNeighborhood = {
  subject: ClusterResourceAddress;
  projectId: string;
  direction: ClusterResourceGraphDirection;
  requestedDepth: number;
  nodes: ClusterResourceGraphNode[];
  edges: ClusterResourceGraphEdge[];
  truncated: boolean;
};

export type ClusterResourceGraphQuery = {
  subject: ClusterResourceAddress;
  projectId?: string | null;
  direction?: ClusterResourceGraphDirection;
  depth?: number;
  maxEdges?: number;
  /** Applied in SQL before the bounded traversal so filters do not exhaust the scan budget. */
  category?: ClusterResourceGraphCategory;
  criticalOnly?: boolean;
  blockingOnly?: boolean;
};

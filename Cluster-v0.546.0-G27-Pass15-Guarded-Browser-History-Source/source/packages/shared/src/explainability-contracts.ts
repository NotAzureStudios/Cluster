import type { ClusterResourceAddress } from "./resource-address.js";

export type ClusterExplanationEvidence = {
  kind: string;
  label: string;
  detail?: string | null;
  resource?: ClusterResourceAddress | null;
  metadata?: Record<string, unknown>;
};

export type ClusterExplanation = {
  code: string;
  title: string;
  summary: string;
  outcome?: string | number | boolean | null;
  reasons: string[];
  evidence: ClusterExplanationEvidence[];
  metadata?: Record<string, unknown>;
};

export function createClusterExplanation(input: ClusterExplanation): ClusterExplanation {
  return {
    ...input,
    reasons: [...input.reasons],
    evidence: [...input.evidence],
  };
}

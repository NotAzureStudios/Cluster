import type { ClusterDataDisplayMetadata, ClusterDataFilterGroup, ClusterDataQuery, ClusterDataScalar } from "./data-view-contracts.js";
import type { ClusterResourceKind } from "./resource-address.js";

export const CLUSTER_METRIC_KINDS = ["count", "sum", "average", "ratio", "duration"] as const;
export type ClusterMetricKind = (typeof CLUSTER_METRIC_KINDS)[number];

export const CLUSTER_METRIC_DIRECTIONS = ["higher_better", "lower_better", "neutral"] as const;
export type ClusterMetricDirection = (typeof CLUSTER_METRIC_DIRECTIONS)[number];

export type ClusterMetricThreshold = {
  id: string;
  label: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number;
  severity: "info" | "warning" | "critical";
};

export type ClusterMetricDefinition = {
  id: string;
  label: string;
  description: string;
  resourceKind: ClusterResourceKind;
  kind: ClusterMetricKind;
  direction?: ClusterMetricDirection;
  fieldId?: string | null;
  dimensions?: string[];
  timeFieldId?: string | null;
  display?: ClusterDataDisplayMetadata;
  defaultThresholds?: ClusterMetricThreshold[];
  drilldown?: { presentation?: "list" | "table" | "cards" | "timeline" | "matrix" | "chart"; query?: ClusterDataQuery } | null;
};

export type ClusterMetricReadRequest = {
  metricId: string;
  query?: ClusterDataQuery;
  compare?: { from: string; to: string } | null;
};

export type ClusterMetricBreakdownRow = {
  keys: ClusterDataScalar[];
  value: number | null;
  count: number;
  drilldownFilters?: ClusterDataFilterGroup | null;
};

export type ClusterMetricReadModel = {
  metricId: string;
  value: number | null;
  count: number;
  previousValue?: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
  generatedAt: string;
  scope: "authorized_query";
  complete: boolean;
  breakdown?: ClusterMetricBreakdownRow[];
  drilldownQuery?: ClusterDataQuery | null;
};

export type ClusterInsight = {
  id: string;
  metricId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  explanation: string;
  observedValue: number | null;
  threshold?: ClusterMetricThreshold | null;
  generatedAt: string;
  drilldownQuery?: ClusterDataQuery | null;
};

export type ClusterMetricRegistrySnapshot = {
  schemaVersion: 1;
  metrics: ClusterMetricDefinition[];
};

export function clusterMetricThresholdMatches(threshold: ClusterMetricThreshold, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return false;
  if (threshold.operator === "gt") return value > threshold.value;
  if (threshold.operator === "gte") return value >= threshold.value;
  if (threshold.operator === "lt") return value < threshold.value;
  if (threshold.operator === "lte") return value <= threshold.value;
  return value === threshold.value;
}

export function clusterMetricInsights(definition: ClusterMetricDefinition, read: ClusterMetricReadModel): ClusterInsight[] {
  return (definition.defaultThresholds || []).flatMap((threshold) => clusterMetricThresholdMatches(threshold, read.value) ? [{
    id: `${definition.id}:${threshold.id}`,
    metricId: definition.id,
    severity: threshold.severity,
    title: threshold.label,
    explanation: `${definition.label} is ${read.value == null ? "unavailable" : read.value.toLocaleString()} and meets the ${threshold.label.toLowerCase()} threshold (${threshold.operator} ${threshold.value.toLocaleString()}).`,
    observedValue: read.value,
    threshold,
    generatedAt: read.generatedAt,
    drilldownQuery: read.drilldownQuery || definition.drilldown?.query || null,
  } satisfies ClusterInsight] : []);
}

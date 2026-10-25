import type { ClusterDataFilterGroup, ClusterDataQuery, ClusterSemanticField } from "@cluster/shared";
import { CLUSTER_DATA_AGGREGATIONS, clusterDataDerivedSemanticFields, clusterDataFilterOperatorsForType, clusterDataTimeRangeFilterGroup, compileClusterDataDerivedLinearExpressions, mergeClusterDataFilterGroups, normalizeClusterDataSorts, planClusterDataDerivedFields } from "@cluster/shared";

export type ClusterDataQueryPolicy = {
  fields: readonly ClusterSemanticField[];
  defaultLimit?: number;
  maxLimit?: number;
};

export type NormalizedClusterDataQuery = ClusterDataQuery & {
  page: { cursor?: string | null; limit: number };
};

function normalizeFilterGroup(input: ClusterDataFilterGroup | null | undefined, fields: ReadonlyMap<string, ClusterSemanticField>, depth = 0): ClusterDataFilterGroup | null {
  if (!input || depth > 3) return null;
  const conditions = (input.conditions || []).flatMap((condition) => {
    const field = fields.get(String(condition?.fieldId || ""));
    if (!field || field.filterable === false) return [];
    const allowedOperators = clusterDataFilterOperatorsForType(field.type);
    if (!allowedOperators.includes(condition.operator)) return [];
    return [{
      ...(condition.id ? { id: String(condition.id).slice(0, 120) } : {}),
      fieldId: field.id,
      operator: condition.operator,
      ...(["is_empty", "is_not_empty"].includes(condition.operator) ? {} : { value: condition.value }),
    }];
  }).slice(0, 24);
  const groups = (input.groups || []).flatMap((group) => {
    const normalized = normalizeFilterGroup(group, fields, depth + 1);
    return normalized ? [normalized] : [];
  }).slice(0, 8);
  if (!conditions.length && !groups.length) return null;
  return { ...(input.id ? { id: String(input.id).slice(0, 120) } : {}), logic: input.logic === "or" ? "or" : "and", conditions, ...(groups.length ? { groups } : {}) };
}

export function normalizeClusterDataQuery(input: ClusterDataQuery | null | undefined, policy: ClusterDataQueryPolicy): NormalizedClusterDataQuery {
  const fields = new Map(policy.fields.map((field) => [field.id, field] as const));
  const derivedPlan = planClusterDataDerivedFields(input?.derivedFields || [], policy.fields, 12);
  const derivedFields = clusterDataDerivedSemanticFields(derivedPlan.fields);
  const derivedIds = new Set(derivedFields.map((field) => field.id));
  const derivedAggregateIds = new Set(compileClusterDataDerivedLinearExpressions(derivedPlan.fields, policy.fields).expressions.keys());
  const aggregationFields = new Map([...policy.fields, ...derivedFields].map((field) => [field.id, field] as const));
  const allowedSorts = new Set(policy.fields.filter((field) => field.sortable !== false).map((field) => field.id));
  const maxLimit = Math.max(1, Math.min(10_000, Math.round(policy.maxLimit || 250)));
  const defaultLimit = Math.max(1, Math.min(maxLimit, Math.round(policy.defaultLimit || 100)));
  const requestedLimit = Number(input?.page?.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(maxLimit, Math.round(requestedLimit))) : defaultLimit;
  const facets = [...new Set((input?.facets || []).filter((id) => Boolean(fields.get(id)?.facet)))].slice(0, 12);
  const groups = (input?.groups || []).filter((group) => Boolean(fields.get(group.fieldId)?.groupable)).slice(0, 8);
  const aggregationKinds = new Set<string>(CLUSTER_DATA_AGGREGATIONS);
  const aggregations = (input?.aggregations || []).filter((aggregation) => {
    if (!aggregationKinds.has(aggregation.kind)) return false;
    if (aggregation.kind === "count" && !aggregation.fieldId) return true;
    if (!aggregation.fieldId) return false;
    if (!aggregationFields.get(aggregation.fieldId)?.aggregatable) return false;
    return !derivedIds.has(aggregation.fieldId) || (derivedAggregateIds.has(aggregation.fieldId) && ["sum", "average", "count"].includes(aggregation.kind));
  }).slice(0, 16);
  const projections = (input?.projections || []).flatMap((projection) => {
    const id = String(projection?.id || "").trim().slice(0, 120);
    if (!id || !["grouped", "matrix"].includes(projection.kind)) return [];
    const dimensions = [...new Set((projection.dimensions || []).filter((fieldId) => Boolean(fields.get(fieldId)?.groupable)))].slice(0, projection.kind === "matrix" ? 2 : 1);
    if (!dimensions.length || (projection.kind === "matrix" && dimensions.length < 2)) return [];
    const measures = (projection.measures || []).filter((aggregation) => {
      if (!aggregationKinds.has(aggregation.kind)) return false;
      if (aggregation.kind === "count" && !aggregation.fieldId) return true;
      if (!aggregation.fieldId || !aggregationFields.get(aggregation.fieldId)?.aggregatable) return false;
      return !derivedIds.has(aggregation.fieldId) || (derivedAggregateIds.has(aggregation.fieldId) && ["sum", "average", "count"].includes(aggregation.kind));
    }).slice(0, 8);
    if (!measures.length) measures.push({ id: `${id}.count`, kind: "count", label: "Count" });
    const drilldownFields = (projection.drilldown?.fieldIds?.length ? projection.drilldown.fieldIds : dimensions)
      .filter((fieldId) => Boolean(fields.get(fieldId)?.filterable))
      .slice(0, dimensions.length);
    const drilldown = projection.drilldown?.mode === "filter" && drilldownFields.length === dimensions.length
      ? {
          mode: "filter" as const,
          fieldIds: drilldownFields,
          ...(projection.drilldown.presentation && ["list", "table", "cards", "timeline", "matrix", "chart"].includes(projection.drilldown.presentation)
            ? { presentation: projection.drilldown.presentation }
            : {}),
        }
      : undefined;
    return [{ id, kind: projection.kind, dimensions, measures, limit: Math.max(1, Math.min(200, Math.round(Number(projection.limit) || 50))), ...(drilldown ? { drilldown } : {}) }];
  }).slice(0, 4);
  const requestedTimeRange = input?.timeRange;
  const timeField = requestedTimeRange?.fieldId ? fields.get(requestedTimeRange.fieldId) : undefined;
  const timeRange = timeField && timeField.filterable !== false && ["date", "datetime"].includes(timeField.type)
    ? { fieldId: timeField.id, ...(requestedTimeRange?.from ? { from: String(requestedTimeRange.from).slice(0, 80) } : {}), ...(requestedTimeRange?.to ? { to: String(requestedTimeRange.to).slice(0, 80) } : {}) }
    : null;
  const search = String(input?.search || "").trim().slice(0, 500);
  const normalizedFilters = normalizeFilterGroup(input?.filters, fields);
  const normalizedTimeFilters = normalizeFilterGroup(clusterDataTimeRangeFilterGroup(timeRange), fields);
  return {
    ...(search ? { search } : {}),
    filters: mergeClusterDataFilterGroups(normalizedFilters, normalizedTimeFilters),
    sorts: normalizeClusterDataSorts(input?.sorts, allowedSorts),
    groups,
    aggregations,
    projections,
    derivedFields: derivedPlan.fields,
    facets,
    timeRange,
    page: { cursor: input?.page?.cursor || null, limit },
  };
}

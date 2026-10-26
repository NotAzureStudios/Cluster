import {
  PEOPLE_DATA_FIELDS,
  evaluateClusterDataDerivedFields,
  type ClusterDataAggregation,
  type ClusterDataAnalyticsEvidence,
  type ClusterDataFilterCondition,
  type ClusterDataFilterGroup,
  type ClusterDataProjection,
  type ClusterDataProjectionResult,
  type ClusterDataQuery,
  type ClusterDataScalar,
  type ClusterDataSort,
} from "@cluster/shared";
import { clusterDataGroupSummaryProjections, clusterDataProjectionGroupSummaries } from "../../core/data-query-analytics.js";

declare const Buffer: any;

const FIELD_IDS = new Set(PEOPLE_DATA_FIELDS.map((field: { id: string }) => field.id));
const NUMERIC_FIELDS = new Set(["capacityHours", "minimumHours"]);
const GROUP_FIELDS = new Set(["title", "department", "teamName", "status"]);

function scalar(row: Record<string, any>, fieldId: string): ClusterDataScalar {
  const value = row[fieldId];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function comparable(value: unknown) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "boolean") return value;
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? new Date(String(value)) : null;
  if (date && Number.isFinite(date.getTime())) return date.getTime();
  return normalizedText(value);
}

function equalScalar(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
  return normalizedText(left) === normalizedText(right);
}

function conditionMatches(row: Record<string, any>, condition: ClusterDataFilterCondition) {
  if (!FIELD_IDS.has(condition.fieldId) && !Object.prototype.hasOwnProperty.call(row, condition.fieldId)) return true;
  const left = scalar(row, condition.fieldId);
  const value: any = condition.value;
  const list = Array.isArray(value) ? value : [value];
  const text = normalizedText(left);
  switch (condition.operator) {
    case "equals": return equalScalar(left, value);
    case "not_equals": return !equalScalar(left, value);
    case "contains": return text.includes(normalizedText(value));
    case "not_contains": return !text.includes(normalizedText(value));
    case "starts_with": return text.startsWith(normalizedText(value));
    case "ends_with": return text.endsWith(normalizedText(value));
    case "greater_than": return comparable(left)! > comparable(value)!;
    case "greater_or_equal": return comparable(left)! >= comparable(value)!;
    case "less_than": return comparable(left)! < comparable(value)!;
    case "less_or_equal": return comparable(left)! <= comparable(value)!;
    case "between": {
      const range = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const current = comparable(left);
      if (current == null) return false;
      if (range.from != null && current < comparable(range.from)!) return false;
      if (range.to != null && current > comparable(range.to)!) return false;
      return true;
    }
    case "in": return list.some((entry) => equalScalar(left, entry));
    case "not_in": return !list.some((entry) => equalScalar(left, entry));
    case "is_empty": return left == null || String(left) === "";
    case "is_not_empty": return left != null && String(left) !== "";
    default: return true;
  }
}

function groupMatches(row: Record<string, any>, group: ClusterDataFilterGroup | null | undefined): boolean {
  if (!group) return true;
  const checks = [
    ...(group.conditions || []).map((condition: ClusterDataFilterCondition) => conditionMatches(row, condition)),
    ...(group.groups || []).map((child: ClusterDataFilterGroup) => groupMatches(row, child)),
  ];
  if (!checks.length) return true;
  return group.logic === "or" ? checks.some(Boolean) : checks.every(Boolean);
}

function rowSearchText(row: Record<string, any>) {
  return [row.displayName, row.username, row.title, row.department, row.teamName, row.status, row.managerName, row.workLocation, ...(Array.isArray(row.skills) ? row.skills : [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function withDerived(row: Record<string, any>, query: ClusterDataQuery) {
  if (!query.derivedFields?.length) return row;
  const baseValues = Object.fromEntries(PEOPLE_DATA_FIELDS.map((field: { id: string }) => [field.id, scalar(row, field.id)]));
  return { ...row, ...evaluateClusterDataDerivedFields(query.derivedFields, baseValues, PEOPLE_DATA_FIELDS) };
}

export function filterPeopleDataRows(rows: Record<string, any>[], query: ClusterDataQuery, options: { department?: string | null } = {}) {
  const search = normalizedText(query.search);
  return rows
    .map((row) => withDerived(row, query))
    .filter((row) => !options.department || normalizedText(row.department) === normalizedText(options.department))
    .filter((row) => !search || rowSearchText(row).includes(search))
    .filter((row) => groupMatches(row, query.filters));
}

export function sortPeopleDataRows(rows: Record<string, any>[], query: ClusterDataQuery) {
  const requested = (query.sorts || []).filter((sort: ClusterDataSort) => FIELD_IDS.has(sort.fieldId) || Object.prototype.hasOwnProperty.call(rows[0] || {}, sort.fieldId));
  const sorts = requested.length ? requested : [{ fieldId: "updatedAt", direction: "desc" as const }];
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const a = comparable(left[sort.fieldId]);
      const b = comparable(right[sort.fieldId]);
      if (a == null && b == null) continue;
      if (a == null) return sort.direction === "asc" ? -1 : 1;
      if (b == null) return sort.direction === "asc" ? 1 : -1;
      if (a < b) return sort.direction === "asc" ? -1 : 1;
      if (a > b) return sort.direction === "asc" ? 1 : -1;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function cursorSignature(query: ClusterDataQuery) {
  return JSON.stringify({ search: query.search || "", filters: query.filters || null, sorts: query.sorts || [] });
}

export function decodePeopleCursor(value: string | null | undefined, query: ClusterDataQuery) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed?.v !== 3 || parsed?.signature !== cursorSignature(query)) return null;
    const offset = Number(parsed?.offset);
    return Number.isInteger(offset) && offset >= 0 ? offset : null;
  } catch {
    return null;
  }
}

export function encodePeopleCursor(offset: number, query: ClusterDataQuery) {
  return Buffer.from(JSON.stringify({ v: 3, offset, signature: cursorSignature(query) }), "utf8").toString("base64url");
}

function aggregationValue(rows: Record<string, any>[], aggregation: ClusterDataAggregation): number | null {
  if (aggregation.kind === "count" && !aggregation.fieldId) return rows.length;
  if (!aggregation.fieldId) return null;
  const values = rows.map((row) => row[aggregation.fieldId!]).filter((value) => value != null);
  if (aggregation.kind === "count") return values.length;
  if (aggregation.kind === "count_distinct") return new Set(values.map((value) => JSON.stringify(value))).size;
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  if (aggregation.kind === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation.kind === "average") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (aggregation.kind === "min") return Math.min(...numbers);
  if (aggregation.kind === "max") return Math.max(...numbers);
  return null;
}

function projectionKey(values: readonly unknown[]) {
  return JSON.stringify(values.map((value) => value ?? null));
}

function projectionForRows(rows: Record<string, any>[], projection: ClusterDataProjection): ClusterDataProjectionResult | null {
  if (!projection.dimensions.length || projection.dimensions.some((fieldId: string) => !GROUP_FIELDS.has(fieldId))) return null;
  const groups = new Map<string, { keys: ClusterDataScalar[]; rows: Record<string, any>[] }>();
  for (const row of rows) {
    const keys = projection.dimensions.map((fieldId: string) => scalar(row, fieldId));
    const key = projectionKey(keys);
    const bucket: { keys: ClusterDataScalar[]; rows: Record<string, any>[] } = groups.get(key) || { keys, rows: [] };
    bucket.rows.push(row);
    groups.set(key, bucket);
  }
  const allRows = [...groups.values()].map((bucket) => ({
    keys: bucket.keys,
    count: bucket.rows.length,
    values: Object.fromEntries(projection.measures.map((measure: ClusterDataAggregation) => [measure.id, aggregationValue(bucket.rows, measure)])),
  })).sort((a, b) => b.count - a.count || String(a.keys).localeCompare(String(b.keys)));
  const limit = Math.max(1, Math.min(200, Math.round(Number(projection.limit) || 50)));
  const result: ClusterDataProjectionResult = {
    id: projection.id,
    kind: projection.kind,
    dimensions: projection.dimensions,
    measures: projection.measures,
    ...(projection.drilldown ? { drilldown: projection.drilldown } : {}),
    rows: allRows.slice(0, limit),
    scope: "authorized_query",
    complete: true,
    truncated: allRows.length > limit,
  };
  if (projection.kind === "matrix" && projection.dimensions.length === 2) {
    const rowProjection = projectionForRows(rows, { ...projection, id: `${projection.id}.__rows`, kind: "grouped", dimensions: [projection.dimensions[0]], limit: 200 });
    const columnProjection = projectionForRows(rows, { ...projection, id: `${projection.id}.__columns`, kind: "grouped", dimensions: [projection.dimensions[1]], limit: 200 });
    result.rowTotals = rowProjection?.rows || [];
    result.columnTotals = columnProjection?.rows || [];
    result.grandTotal = { keys: [], count: rows.length, values: Object.fromEntries(projection.measures.map((measure: ClusterDataAggregation) => [measure.id, aggregationValue(rows, measure)])) };
  }
  return result;
}

export function peopleDataQueryAnalytics(rows: Record<string, any>[], query: ClusterDataQuery): ClusterDataAnalyticsEvidence {
  const facets = (query.facets || []).filter((fieldId: string) => GROUP_FIELDS.has(fieldId)).map((fieldId: string) => {
    const counts = new Map<string, { value: ClusterDataScalar; count: number }>();
    for (const row of rows) {
      const value = scalar(row, fieldId);
      const key = JSON.stringify(value);
      const bucket = counts.get(key) || { value, count: 0 };
      bucket.count += 1;
      counts.set(key, bucket);
    }
    return { fieldId, buckets: [...counts.values()].sort((a, b) => b.count - a.count || String(a.value ?? "").localeCompare(String(b.value ?? ""))).slice(0, 50) };
  });
  const aggregations = Object.fromEntries((query.aggregations || []).map((aggregation: ClusterDataAggregation) => [aggregation.id, aggregationValue(rows, aggregation)]));
  const projections = (query.projections || []).flatMap((projection: ClusterDataProjection) => { const result = projectionForRows(rows, projection); return result ? [result] : []; });
  const groupProjections = clusterDataGroupSummaryProjections(query.groups || [], query.aggregations || [], 2, 100);
  const groupResults = groupProjections.flatMap((projection: ClusterDataProjection) => { const result = projectionForRows(rows, projection); return result ? [result] : []; });
  const groupedSummaries = clusterDataProjectionGroupSummaries(groupResults, { count: rows.length, values: aggregations });
  return { total: rows.length, facets, aggregations, projections, groupedSummaries, scope: "authorized_query", complete: true };
}

export const PEOPLE_DATA_VIEW_AGGREGATIONS: readonly ClusterDataAggregation[] = [
  { id: "count", kind: "count", label: "People" },
  { id: "capacity", kind: "sum", fieldId: "capacityHours", label: "Total capacity" },
  { id: "average_capacity", kind: "average", fieldId: "capacityHours", label: "Average capacity" },
];

import type { ClusterResourceKind } from "./cluster-manifest.js";

export const CLUSTER_DATA_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "duration",
  "status",
  "enum",
  "resource",
  "person",
  "json",
] as const;
export type ClusterDataFieldType = (typeof CLUSTER_DATA_FIELD_TYPES)[number];

export const CLUSTER_DATA_SENSITIVITIES = ["standard", "internal", "sensitive", "restricted"] as const;
export type ClusterDataSensitivity = (typeof CLUSTER_DATA_SENSITIVITIES)[number];

export const CLUSTER_DATA_FILTER_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "between",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
] as const;
export type ClusterDataFilterOperator = (typeof CLUSTER_DATA_FILTER_OPERATORS)[number];

export const CLUSTER_DATA_AGGREGATIONS = ["count", "count_distinct", "sum", "average", "min", "max"] as const;
export type ClusterDataAggregationKind = (typeof CLUSTER_DATA_AGGREGATIONS)[number];

export const CLUSTER_DATA_VIEW_PRESENTATIONS = ["list", "table", "cards", "timeline", "matrix", "chart"] as const;
export type ClusterDataViewPresentation = (typeof CLUSTER_DATA_VIEW_PRESENTATIONS)[number];

export const CLUSTER_DATA_VIEW_DENSITIES = ["comfortable", "compact", "dense"] as const;
export type ClusterDataViewDensity = (typeof CLUSTER_DATA_VIEW_DENSITIES)[number];

export const CLUSTER_DATA_VALUE_FORMATS = ["number", "integer", "percent", "bytes", "duration_ms", "currency"] as const;
export type ClusterDataValueFormat = (typeof CLUSTER_DATA_VALUE_FORMATS)[number];

export type ClusterDataDisplayMetadata = {
  format?: ClusterDataValueFormat;
  precision?: number;
  unit?: string | null;
  currency?: string | null;
};

export type ClusterDataScalar = string | number | boolean | null;
export type ClusterDataFilterValue = ClusterDataScalar | ClusterDataScalar[] | { from?: ClusterDataScalar; to?: ClusterDataScalar };

export type ClusterSemanticField = {
  id: string;
  label: string;
  description?: string | null;
  type: ClusterDataFieldType;
  sensitivity?: ClusterDataSensitivity;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  aggregatable?: boolean;
  facet?: boolean;
  exportable?: boolean;
  editable?: boolean;
  computed?: boolean;
  resourceKind?: ClusterResourceKind | null;
  enumValues?: readonly string[];
  display?: ClusterDataDisplayMetadata;
};

export type ClusterDataFilterCondition = {
  id?: string;
  fieldId: string;
  operator: ClusterDataFilterOperator;
  value?: ClusterDataFilterValue;
};

export type ClusterDataFilterGroup = {
  id?: string;
  logic: "and" | "or";
  conditions: ClusterDataFilterCondition[];
  groups?: ClusterDataFilterGroup[];
};

export type ClusterDataSort = {
  fieldId: string;
  direction: "asc" | "desc";
};

export type ClusterDataGroup = {
  fieldId: string;
  direction?: "asc" | "desc";
  collapsed?: boolean;
};

export type ClusterDataAggregation = {
  id: string;
  kind: ClusterDataAggregationKind;
  fieldId?: string | null;
  label?: string | null;
  display?: ClusterDataDisplayMetadata;
};

export const CLUSTER_DATA_PROJECTION_KINDS = ["grouped", "matrix"] as const;
export type ClusterDataProjectionKind = (typeof CLUSTER_DATA_PROJECTION_KINDS)[number];

export type ClusterDataProjectionDrilldown = {
  /** Apply the clicked analytical keys as semantic equals filters. */
  mode: "filter";
  /** Optional target fields when a projection dimension needs an explicit drilldown mapping. */
  fieldIds?: string[];
  /** Optional presentation to restore when drilling into the records behind a cell/bar. */
  presentation?: ClusterDataViewPresentation;
};

export type ClusterDataProjection = {
  id: string;
  kind: ClusterDataProjectionKind;
  dimensions: string[];
  measures: ClusterDataAggregation[];
  limit?: number;
  drilldown?: ClusterDataProjectionDrilldown | null;
};

export const CLUSTER_DATA_DERIVED_OPERATIONS = ["add", "subtract", "multiply", "divide", "concat", "coalesce"] as const;
export type ClusterDataDerivedOperation = (typeof CLUSTER_DATA_DERIVED_OPERATIONS)[number];

export type ClusterDataFormulaOperand =
  | { kind: "field"; fieldId: string }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string };

/** Safe, non-executable formula column definition persisted with a Data View. */
export type ClusterDataDerivedField = {
  id: string;
  label: string;
  type: "number" | "text";
  operation: ClusterDataDerivedOperation;
  left: ClusterDataFormulaOperand;
  right: ClusterDataFormulaOperand;
  display?: ClusterDataDisplayMetadata;
};

export type ClusterDataDerivedFieldIssue = {
  fieldId: string;
  code: "duplicate_id" | "unknown_dependency" | "invalid_dependency" | "self_reference" | "cycle" | "type_mismatch";
  message: string;
};

export type ClusterDataDerivedFieldPlan = {
  fields: ClusterDataDerivedField[];
  order: string[];
  dependencies: Record<string, string[]>;
  issues: ClusterDataDerivedFieldIssue[];
  valid: boolean;
};

/** Semantic analytical selection shared by charts, matrices, tables, and drilldowns. */
export type ClusterDataSelection = {
  source: "projection" | "table";
  projectionId?: string | null;
  conditions: ClusterDataFilterCondition[];
};

export type ClusterDataSelectionSet = {
  logic: "and" | "or";
  selections: ClusterDataSelection[];
};

export type ClusterDataProjectionRow = {
  keys: ClusterDataScalar[];
  count: number;
  values: Record<string, number | null>;
};

export type ClusterDataProjectionResult = {
  id: string;
  kind: ClusterDataProjectionKind;
  dimensions: string[];
  measures: ClusterDataAggregation[];
  drilldown?: ClusterDataProjectionDrilldown | null;
  rows: ClusterDataProjectionRow[];
  /** Exact one-dimensional rollups for matrix rows when the domain can reproduce them authoritatively. */
  rowTotals?: ClusterDataProjectionRow[];
  /** Exact one-dimensional rollups for matrix columns when the domain can reproduce them authoritatively. */
  columnTotals?: ClusterDataProjectionRow[];
  /** Exact full-query rollup for this projection. */
  grandTotal?: ClusterDataProjectionRow | null;
  scope: "authorized_query";
  complete: boolean;
  truncated: boolean;
};

export type ClusterDataTimeRange = {
  fieldId: string;
  from?: string | null;
  to?: string | null;
};

export type ClusterDataPageRequest = {
  cursor?: string | null;
  limit?: number;
};

export type ClusterDataPageResult = {
  nextCursor: string | null;
  hasMore: boolean;
  cursorSupported: boolean;
};

export type ClusterDataQuery = {
  search?: string;
  filters?: ClusterDataFilterGroup | null;
  sorts?: ClusterDataSort[];
  groups?: ClusterDataGroup[];
  aggregations?: ClusterDataAggregation[];
  projections?: ClusterDataProjection[];
  /** Local safe formula columns. They are durable view state but never executable server code. */
  derivedFields?: ClusterDataDerivedField[];
  facets?: string[];
  timeRange?: ClusterDataTimeRange | null;
  page?: ClusterDataPageRequest;
};

export type ClusterDataViewLayout = {
  visibleFieldIds: string[];
  fieldOrder: string[];
  pinnedFieldIds: string[];
  fieldWidths: Record<string, number>;
  collapsedGroupKeys?: string[];
};

export type ClusterDataViewVisibility = "personal" | "studio" | "project";

export type ClusterDataViewDefinition = {
  id: string;
  name: string;
  resourceKind?: ClusterResourceKind | null;
  visibility: ClusterDataViewVisibility;
  ownerId?: string | null;
  projectId?: string | null;
  presentation: ClusterDataViewPresentation;
  density: ClusterDataViewDensity;
  query: ClusterDataQuery;
  layout: ClusterDataViewLayout;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/** Durable named Data View owned by the Data Platform. */
export type ClusterSavedDataView = ClusterDataViewDefinition & {
  scope: string;
  description?: string | null;
  schemaVersion: number;
  revision: number;
  isDefault: boolean;
  archived?: boolean;
};

export type ClusterSavedDataViewDraft = Omit<ClusterSavedDataView, "id" | "ownerId" | "schemaVersion" | "revision" | "createdAt" | "updatedAt" | "archived"> & {
  id?: string;
};

export type ClusterDataFacetBucket = {
  value: ClusterDataScalar;
  count: number;
};

export type ClusterDataFacetResult = {
  fieldId: string;
  buckets: ClusterDataFacetBucket[];
};

export type ClusterDataGroupSummaryRow = {
  keys: ClusterDataScalar[];
  count: number;
  values: Record<string, number | null>;
};

export type ClusterDataGroupSummaryResult = {
  dimensions: string[];
  aggregations: ClusterDataAggregation[];
  rows: ClusterDataGroupSummaryRow[];
  grandTotal?: ClusterDataGroupSummaryRow | null;
  scope: "authorized_query";
  complete: boolean;
  truncated: boolean;
};

export type ClusterDataAnalyticsEvidence = {
  /** Exact record count for the complete authorized semantic query. */
  total: number;
  facets: ClusterDataFacetResult[];
  aggregations: Record<string, number | null>;
  projections?: ClusterDataProjectionResult[];
  groupedSummaries?: ClusterDataGroupSummaryResult[];
  scope: "authorized_query";
  complete: boolean;
};

export type ClusterDataQueryPage<T> = {
  rows: T[];
  nextCursor?: string | null;
  total?: number | null;
  facets?: ClusterDataFacetResult[];
  aggregations?: Record<string, number | null>;
};

export function clusterDataDerivedDependencies(field: ClusterDataDerivedField) {
  return [...new Set([field.left, field.right].flatMap((operand) => operand.kind === "field" ? [operand.fieldId] : []))];
}

export function planClusterDataDerivedFields(
  input: readonly ClusterDataDerivedField[] | null | undefined,
  baseFields: readonly Pick<ClusterSemanticField, "id" | "type">[] = [],
  max = 12,
): ClusterDataDerivedFieldPlan {
  const issues: ClusterDataDerivedFieldIssue[] = [];
  const baseIds = new Set(baseFields.map((field) => field.id));
  const baseTypes = new Map(baseFields.map((field) => [field.id, field.type] as const));
  const fields: ClusterDataDerivedField[] = [];
  const byId = new Map<string, ClusterDataDerivedField>();
  for (const raw of (input || []).slice(0, Math.max(1, Math.min(32, max)))) {
    const id = String(raw?.id || "").trim().slice(0, 160);
    if (!id) continue;
    if (byId.has(id) || baseIds.has(id)) {
      issues.push({ fieldId: id, code: "duplicate_id", message: `Formula field ${id} duplicates an existing field identifier.` });
      continue;
    }
    const label = String(raw.label || id).trim().slice(0, 160) || id;
    const operation: ClusterDataDerivedOperation = CLUSTER_DATA_DERIVED_OPERATIONS.includes(raw.operation) ? raw.operation : "coalesce";
    const type: "number" | "text" = raw.type === "text" ? "text" : "number";
    const normalizeOperand = (operand: ClusterDataFormulaOperand): ClusterDataFormulaOperand => {
      if (operand?.kind === "field") return { kind: "field", fieldId: String(operand.fieldId || "").trim().slice(0, 160) };
      if (operand?.kind === "text") return { kind: "text", value: String(operand.value ?? "").slice(0, 2000) };
      return { kind: "number", value: Number.isFinite(Number((operand as { value?: unknown })?.value)) ? Number((operand as { value?: unknown }).value) : 0 };
    };
    const field: ClusterDataDerivedField = { id, label, type, operation, left: normalizeOperand(raw.left), right: normalizeOperand(raw.right), ...(raw.display ? { display: raw.display } : {}) };
    fields.push(field);
    byId.set(id, field);
  }

  const dependencies: Record<string, string[]> = {};
  for (const field of fields) {
    const refs = clusterDataDerivedDependencies(field);
    dependencies[field.id] = refs.filter((ref) => byId.has(ref));
    for (const ref of refs) {
      if (ref === field.id) issues.push({ fieldId: field.id, code: "self_reference", message: `${field.label} cannot reference itself.` });
      else if (!baseIds.has(ref) && !byId.has(ref)) issues.push({ fieldId: field.id, code: "unknown_dependency", message: `${field.label} references unknown field ${ref}.` });
    }
    const numericOperation = ["add", "subtract", "multiply", "divide"].includes(field.operation);
    if (numericOperation && field.type !== "number") issues.push({ fieldId: field.id, code: "type_mismatch", message: `${field.label} uses a numeric operation but is not a numeric formula.` });
    const operandTypes = [field.left, field.right].flatMap((operand) => operand.kind === "field" ? [baseTypes.get(operand.fieldId) || byId.get(operand.fieldId)?.type] : operand.kind === "number" ? ["number"] : ["text"]);
    if (numericOperation && operandTypes.some((type) => type && !["number", "duration"].includes(type))) issues.push({ fieldId: field.id, code: "type_mismatch", message: `${field.label} uses a numeric operation with a non-numeric dependency.` });
  }

  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleIds = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = Math.max(0, trail.indexOf(id));
      for (const cycleId of trail.slice(start)) cycleIds.add(cycleId);
      cycleIds.add(id);
      return;
    }
    visiting.add(id);
    for (const dependency of dependencies[id] || []) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const field of fields) visit(field.id, []);
  for (const id of cycleIds) {
    const field = byId.get(id);
    issues.push({ fieldId: id, code: "cycle", message: `${field?.label || id} is part of a formula dependency cycle.` });
  }
  const invalid = new Set(issues.map((issue) => issue.fieldId));
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const field of fields) {
      if (invalid.has(field.id)) continue;
      const invalidDependency = (dependencies[field.id] || []).find((dependency) => invalid.has(dependency));
      if (!invalidDependency) continue;
      invalid.add(field.id);
      issues.push({ fieldId: field.id, code: "invalid_dependency", message: `${field.label} depends on invalid formula ${invalidDependency}.` });
      propagated = true;
    }
  }
  const validFields = fields.filter((field) => !invalid.has(field.id));
  const validIds = new Set(validFields.map((field) => field.id));
  return {
    fields: validFields,
    order: order.filter((id) => validIds.has(id)),
    dependencies: Object.fromEntries(validFields.map((field) => [field.id, (dependencies[field.id] || []).filter((id) => validIds.has(id))])),
    issues,
    valid: issues.length === 0,
  };
}

export type ClusterDataLinearExpression = {
  constant: number;
  coefficients: Record<string, number>;
};

function scaleClusterDataLinearExpression(expression: ClusterDataLinearExpression, factor: number): ClusterDataLinearExpression {
  return { constant: expression.constant * factor, coefficients: Object.fromEntries(Object.entries(expression.coefficients).map(([fieldId, coefficient]) => [fieldId, coefficient * factor]).filter(([, coefficient]) => coefficient !== 0)) };
}

function combineClusterDataLinearExpressions(left: ClusterDataLinearExpression, right: ClusterDataLinearExpression, rightFactor = 1): ClusterDataLinearExpression {
  const coefficients: Record<string, number> = { ...left.coefficients };
  for (const [fieldId, coefficient] of Object.entries(right.coefficients)) {
    const next = (coefficients[fieldId] || 0) + coefficient * rightFactor;
    if (next) coefficients[fieldId] = next; else delete coefficients[fieldId];
  }
  return { constant: left.constant + right.constant * rightFactor, coefficients };
}

/**
 * Compiles the numeric subset of the safe formula graph into affine expressions.
 * These expressions can be aggregated exactly from authoritative row counts and
 * base-field sums without executing arbitrary code or dynamic SQL expressions.
 */
export function compileClusterDataDerivedLinearExpressions(
  fields: readonly ClusterDataDerivedField[],
  baseFields: readonly Pick<ClusterSemanticField, "id" | "type">[] = [],
) {
  const plan = planClusterDataDerivedFields(fields, baseFields);
  const baseTypes = new Map(baseFields.map((field) => [field.id, field.type] as const));
  const expressions = new Map<string, ClusterDataLinearExpression>();
  const unsupported = new Set<string>();
  const byId = new Map(plan.fields.map((field) => [field.id, field] as const));
  const operandExpression = (operand: ClusterDataFormulaOperand): ClusterDataLinearExpression | null => {
    if (operand.kind === "number") return { constant: operand.value, coefficients: {} };
    if (operand.kind !== "field") return null;
    const derived = expressions.get(operand.fieldId);
    if (derived) return derived;
    if (["number", "duration"].includes(baseTypes.get(operand.fieldId) || "")) return { constant: 0, coefficients: { [operand.fieldId]: 1 } };
    return null;
  };
  for (const id of plan.order) {
    const field = byId.get(id);
    if (!field || field.type !== "number") { unsupported.add(id); continue; }
    const left = operandExpression(field.left);
    const right = operandExpression(field.right);
    if (!left || !right) { unsupported.add(id); continue; }
    let expression: ClusterDataLinearExpression | null = null;
    if (field.operation === "add") expression = combineClusterDataLinearExpressions(left, right);
    else if (field.operation === "subtract") expression = combineClusterDataLinearExpressions(left, right, -1);
    else if (field.operation === "multiply") {
      const leftConstant = Object.keys(left.coefficients).length === 0;
      const rightConstant = Object.keys(right.coefficients).length === 0;
      if (leftConstant) expression = scaleClusterDataLinearExpression(right, left.constant);
      else if (rightConstant) expression = scaleClusterDataLinearExpression(left, right.constant);
    } else if (field.operation === "divide" && Object.keys(right.coefficients).length === 0 && right.constant !== 0) expression = scaleClusterDataLinearExpression(left, 1 / right.constant);
    if (expression && Number.isFinite(expression.constant) && Object.values(expression.coefficients).every(Number.isFinite)) expressions.set(id, expression);
    else unsupported.add(id);
  }
  return { plan, expressions, unsupported };
}

export function evaluateClusterDataLinearAggregate(expression: ClusterDataLinearExpression, baseSums: Readonly<Record<string, number | null | undefined>>, rowCount: number) {
  let value = expression.constant * rowCount;
  for (const [fieldId, coefficient] of Object.entries(expression.coefficients)) value += Number(baseSums[fieldId] || 0) * coefficient;
  return Number.isFinite(value) ? value : null;
}

export function clusterDataDerivedSemanticFields(fields: readonly ClusterDataDerivedField[]): ClusterSemanticField[] {
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    sortable: true,
    filterable: false,
    groupable: false,
    aggregatable: field.type === "number",
    exportable: true,
    computed: true,
    ...(field.display ? { display: field.display } : {}),
  }));
}

export function evaluateClusterDataDerivedField(field: ClusterDataDerivedField, values: Readonly<Record<string, ClusterDataScalar>>): ClusterDataScalar {
  const resolve = (operand: ClusterDataFormulaOperand): ClusterDataScalar => operand.kind === "field" ? (values[operand.fieldId] ?? null) : operand.value;
  const left = resolve(field.left);
  const right = resolve(field.right);
  if (field.operation === "coalesce") return left == null || left === "" ? right : left;
  if (field.operation === "concat") return `${left ?? ""}${right ?? ""}`;
  const leftNumber = typeof left === "number" ? left : Number(left);
  const rightNumber = typeof right === "number" ? right : Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return null;
  if (field.operation === "add") return leftNumber + rightNumber;
  if (field.operation === "subtract") return leftNumber - rightNumber;
  if (field.operation === "multiply") return leftNumber * rightNumber;
  if (field.operation === "divide") return rightNumber === 0 ? null : leftNumber / rightNumber;
  return null;
}

export function evaluateClusterDataDerivedFields(
  fields: readonly ClusterDataDerivedField[],
  values: Readonly<Record<string, ClusterDataScalar>>,
  baseFields: readonly Pick<ClusterSemanticField, "id" | "type">[] = [],
) {
  const plan = planClusterDataDerivedFields(fields, baseFields);
  const resolved: Record<string, ClusterDataScalar> = { ...values };
  const byId = new Map(plan.fields.map((field) => [field.id, field] as const));
  for (const id of plan.order) {
    const field = byId.get(id);
    if (field) resolved[id] = evaluateClusterDataDerivedField(field, resolved);
  }
  return { values: resolved, plan };
}

export function materializeClusterDataDerivedRow(
  row: Readonly<Record<string, unknown>>,
  fields: readonly ClusterDataDerivedField[],
  baseFields: readonly Pick<ClusterSemanticField, "id" | "type">[] = [],
) {
  const scalarValues = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : value instanceof Date ? value.toISOString() : String(value)])) as Record<string, ClusterDataScalar>;
  const evaluated = evaluateClusterDataDerivedFields(fields, scalarValues, baseFields);
  return { ...row, ...Object.fromEntries(fields.map((field) => [field.id, evaluated.values[field.id] ?? null])), plan: evaluated.plan };
}


export function clusterDataTimeRangeFilterGroup(range: ClusterDataTimeRange | null | undefined): ClusterDataFilterGroup | null {
  if (!range?.fieldId) return null;
  const conditions: ClusterDataFilterCondition[] = [];
  if (range.from) conditions.push({ fieldId: range.fieldId, operator: "greater_or_equal", value: range.from });
  if (range.to) conditions.push({ fieldId: range.fieldId, operator: "less_or_equal", value: range.to });
  return conditions.length ? { logic: "and", conditions } : null;
}

export function mergeClusterDataFilterGroups(
  ...groups: Array<ClusterDataFilterGroup | null | undefined>
): ClusterDataFilterGroup | null {
  const retained = groups.filter((group): group is ClusterDataFilterGroup => Boolean(group && (group.conditions.length || group.groups?.length)));
  if (!retained.length) return null;
  if (retained.length === 1) return retained[0];
  return { logic: "and", conditions: [], groups: retained };
}

export function clusterDataSelectionSetFilterGroup(set: ClusterDataSelectionSet | null | undefined): ClusterDataFilterGroup | null {
  const selections = (set?.selections || []).filter((selection) => selection.conditions.length);
  if (!selections.length) return null;
  if (selections.length === 1) return { logic: "and", conditions: selections[0].conditions };
  return {
    logic: set?.logic === "and" ? "and" : "or",
    conditions: [],
    groups: selections.map((selection) => ({ logic: "and", conditions: selection.conditions })),
  };
}

export function toggleClusterDataSelection(
  set: ClusterDataSelectionSet | null | undefined,
  selection: ClusterDataSelection,
  equals: (left: ClusterDataSelection, right: ClusterDataSelection) => boolean,
  max = 24,
): ClusterDataSelectionSet {
  const current = set?.selections || [];
  const exists = current.some((candidate) => equals(candidate, selection));
  const selections = exists ? current.filter((candidate) => !equals(candidate, selection)) : [...current, selection].slice(-Math.max(1, Math.min(64, max)));
  return { logic: set?.logic === "and" ? "and" : "or", selections };
}

export function normalizeClusterDataSorts(input: readonly ClusterDataSort[] | null | undefined, allowedFieldIds?: ReadonlySet<string>, max = 8): ClusterDataSort[] {
  const seen = new Set<string>();
  const output: ClusterDataSort[] = [];
  for (const candidate of input || []) {
    const fieldId = String(candidate?.fieldId || "").trim();
    if (!fieldId || seen.has(fieldId) || (allowedFieldIds && !allowedFieldIds.has(fieldId))) continue;
    seen.add(fieldId);
    output.push({ fieldId, direction: candidate.direction === "desc" ? "desc" : "asc" });
    if (output.length >= max) break;
  }
  return output;
}

export function createClusterDataViewLayout(fieldIds: readonly string[], visibleFieldIds: readonly string[] = fieldIds): ClusterDataViewLayout {
  const known = new Set(fieldIds);
  return {
    visibleFieldIds: [...new Set(visibleFieldIds.filter((id) => known.has(id)))],
    fieldOrder: [...fieldIds],
    pinnedFieldIds: [],
    fieldWidths: {},
    collapsedGroupKeys: [],
  };
}


export function clusterDataFilterOperatorsForType(type: ClusterDataFieldType): readonly ClusterDataFilterOperator[] {
  if (type === "text" || type === "json") return ["contains", "not_contains", "starts_with", "ends_with", "equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"];
  if (type === "number" || type === "duration") return ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "between", "in", "not_in", "is_empty", "is_not_empty"];
  if (type === "date" || type === "datetime") return ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "between", "is_empty", "is_not_empty"];
  if (type === "boolean") return ["equals", "not_equals", "is_empty", "is_not_empty"];
  return ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"];
}

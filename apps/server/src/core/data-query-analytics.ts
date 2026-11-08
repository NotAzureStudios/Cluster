import { compileClusterDataDerivedLinearExpressions, evaluateClusterDataLinearAggregate, type ClusterDataAggregation, type ClusterDataAnalyticsEvidence, type ClusterDataDerivedField, type ClusterDataFacetResult, type ClusterDataGroup, type ClusterDataGroupSummaryResult, type ClusterDataProjection, type ClusterDataProjectionResult, type ClusterSemanticField } from "@cluster/shared";

export async function runPrismaScalarAnalytics(input: {
  model: any;
  where: Record<string, unknown>;
  facets: readonly string[];
  aggregations: readonly ClusterDataAggregation[];
  facetFields: ReadonlyMap<string, string>;
  numericFields?: ReadonlyMap<string, string>;
  derivedFields?: readonly ClusterDataDerivedField[];
  semanticFields?: readonly Pick<ClusterSemanticField, "id" | "type">[];
}): Promise<ClusterDataAnalyticsEvidence> {
  const numericFields = input.numericFields || new Map<string, string>();
  const derived = compileClusterDataDerivedLinearExpressions(input.derivedFields || [], input.semanticFields || []);
  const total = await input.model.count({ where: input.where });
  const facets: ClusterDataFacetResult[] = [];

  for (const fieldId of input.facets) {
    const prismaField = input.facetFields.get(fieldId);
    if (!prismaField) continue;
    const grouped = await input.model.groupBy({ by: [prismaField], where: input.where, _count: { _all: true } });
    const buckets = grouped.map((row: any) => ({ value: row[prismaField] ?? null, count: Number(row?._count?._all || 0) })).sort((a: any, b: any) => b.count - a.count || String(a.value ?? "").localeCompare(String(b.value ?? ""))).slice(0, 50);
    facets.push({ fieldId, buckets });
  }

  const aggregations: Record<string, number | null> = {};
  // Several presentation measures may count distinct values of the same field.
  // The authorized grouping is identical, so issue one database query per field.
  const scalarDistinctCounts = new Map<string, number>();
  const aggregateRequest: Record<string, Record<string, boolean>> = {};
  for (const aggregation of input.aggregations) {
    if (aggregation.kind === "count" && !aggregation.fieldId) {
      aggregations[aggregation.id] = total;
      continue;
    }
    const prismaField = aggregation.fieldId ? numericFields.get(aggregation.fieldId) : undefined;
    if (!prismaField) continue;
    if (aggregation.kind === "sum") (aggregateRequest._sum ||= {})[prismaField] = true;
    else if (aggregation.kind === "average") (aggregateRequest._avg ||= {})[prismaField] = true;
    else if (aggregation.kind === "min") (aggregateRequest._min ||= {})[prismaField] = true;
    else if (aggregation.kind === "max") (aggregateRequest._max ||= {})[prismaField] = true;
    else if (aggregation.kind === "count") (aggregateRequest._count ||= {})[prismaField] = true;
  }
  const derivedBaseIds = new Set<string>();
  for (const aggregation of input.aggregations) {
    if (!aggregation.fieldId) continue;
    const expression = derived.expressions.get(aggregation.fieldId);
    if (!expression || !["sum", "average", "count"].includes(aggregation.kind)) continue;
    for (const fieldId of Object.keys(expression.coefficients)) {
      const prismaField = numericFields.get(fieldId);
      if (prismaField) { (aggregateRequest._sum ||= {})[prismaField] = true; derivedBaseIds.add(fieldId); }
    }
  }
  const aggregateResult = Object.keys(aggregateRequest).length ? await input.model.aggregate({ where: input.where, ...aggregateRequest }) : {};
  const derivedBaseSums = Object.fromEntries([...derivedBaseIds].map((fieldId) => { const prismaField = numericFields.get(fieldId)!; const value = aggregateResult?._sum?.[prismaField]; return [fieldId, value == null ? 0 : Number(value)]; }));

  for (const aggregation of input.aggregations) {
    if (Object.prototype.hasOwnProperty.call(aggregations, aggregation.id)) continue;
    if (aggregation.fieldId && derived.expressions.has(aggregation.fieldId)) {
      const expression = derived.expressions.get(aggregation.fieldId)!;
      const sum = evaluateClusterDataLinearAggregate(expression, derivedBaseSums, total);
      if (aggregation.kind === "sum") aggregations[aggregation.id] = sum;
      else if (aggregation.kind === "average") aggregations[aggregation.id] = total > 0 && sum != null ? sum / total : null;
      else if (aggregation.kind === "count") aggregations[aggregation.id] = total;
      continue;
    }
    const prismaField = aggregation.fieldId ? numericFields.get(aggregation.fieldId) : undefined;
    if (!prismaField) continue;
    if (aggregation.kind === "count_distinct") {
      let distinct = scalarDistinctCounts.get(prismaField);
      if (distinct === undefined) {
        const grouped = await input.model.groupBy({ by: [prismaField], where: input.where });
        distinct = Number(grouped.filter((row: any) => row[prismaField] != null).length);
        scalarDistinctCounts.set(prismaField, distinct);
      }
      aggregations[aggregation.id] = distinct;
      continue;
    }
    const key = aggregation.kind === "average" ? "_avg" : `_${aggregation.kind}`;
    const value = aggregateResult?.[key]?.[prismaField];
    aggregations[aggregation.id] = value == null ? null : Number(value);
  }

  return { total, facets, aggregations, scope: "authorized_query", complete: true };
}


function projectionKey(values: readonly unknown[]) {
  return JSON.stringify(values.map((value) => value ?? null));
}

export function clusterDataCountProjectionRollups(projection: ClusterDataProjection, rows: readonly { keys: readonly unknown[]; count: number; values: Record<string, number | null> }[]) {
  if (projection.kind !== "matrix" || projection.dimensions.length !== 2 || projection.measures.some((measure) => measure.kind !== "count" || measure.fieldId)) return {};
  const rowBuckets = new Map<string, { key: any; count: number }>();
  const columnBuckets = new Map<string, { key: any; count: number }>();
  let grandCount = 0;
  for (const row of rows) {
    grandCount += Number(row.count || 0);
    const rowKey = projectionKey([row.keys[0]]);
    const columnKey = projectionKey([row.keys[1]]);
    const rowBucket = rowBuckets.get(rowKey) || { key: row.keys[0] ?? null, count: 0 }; rowBucket.count += Number(row.count || 0); rowBuckets.set(rowKey, rowBucket);
    const columnBucket = columnBuckets.get(columnKey) || { key: row.keys[1] ?? null, count: 0 }; columnBucket.count += Number(row.count || 0); columnBuckets.set(columnKey, columnBucket);
  }
  const valuesFor = (count: number) => Object.fromEntries(projection.measures.map((measure) => [measure.id, count]));
  // Match the grouped projection ordering before applying its 200-row total cap.
  const ordered = (buckets: Map<string, { key: any; count: number }>) =>
    [...buckets.values()]
      .map((bucket) => ({ keys: [bucket.key], count: bucket.count, values: valuesFor(bucket.count) }))
      .sort((a, b) => b.count - a.count || String(a.keys).localeCompare(String(b.keys)));
  return {
    rowTotals: ordered(rowBuckets),
    columnTotals: ordered(columnBuckets),
    grandTotal: { keys: [], count: grandCount, values: valuesFor(grandCount) },
  };
}

export async function runPrismaGroupedProjections(input: {
  model: any;
  where: Record<string, unknown>;
  projections: readonly ClusterDataProjection[];
  dimensionFields: ReadonlyMap<string, string>;
  numericFields?: ReadonlyMap<string, string>;
  derivedFields?: readonly ClusterDataDerivedField[];
  semanticFields?: readonly Pick<ClusterSemanticField, "id" | "type">[];
}): Promise<ClusterDataProjectionResult[]> {
  const numericFields = input.numericFields || new Map<string, string>();
  const derived = compileClusterDataDerivedLinearExpressions(input.derivedFields || [], input.semanticFields || []);
  const results: ClusterDataProjectionResult[] = [];

  for (const projection of input.projections) {
    const dimensions = projection.dimensions.map((fieldId) => input.dimensionFields.get(fieldId));
    if (!dimensions.length || dimensions.some((field) => !field)) continue;
    const by = dimensions as string[];
    const aggregateRequest: Record<string, Record<string, boolean>> = {};
    for (const measure of projection.measures) {
      const expression = measure.fieldId ? derived.expressions.get(measure.fieldId) : undefined;
      if (expression && ["sum", "average", "count"].includes(measure.kind)) {
        for (const fieldId of Object.keys(expression.coefficients)) { const prismaField = numericFields.get(fieldId); if (prismaField) (aggregateRequest._sum ||= {})[prismaField] = true; }
        continue;
      }
      const prismaField = measure.fieldId ? numericFields.get(measure.fieldId) : undefined;
      if (!prismaField) continue;
      if (measure.kind === "sum") (aggregateRequest._sum ||= {})[prismaField] = true;
      else if (measure.kind === "average") (aggregateRequest._avg ||= {})[prismaField] = true;
      else if (measure.kind === "min") (aggregateRequest._min ||= {})[prismaField] = true;
      else if (measure.kind === "max") (aggregateRequest._max ||= {})[prismaField] = true;
      else if (measure.kind === "count") (aggregateRequest._count ||= {})[prismaField] = true;
    }
    const grouped = await input.model.groupBy({ by, where: input.where, _count: { _all: true }, ...aggregateRequest });
    const distinctByMeasure = new Map<string, Map<string, number>>();
    const distinctCountsByField = new Map<string, Map<string, number>>();
    for (const measure of projection.measures) {
      if (measure.kind !== "count_distinct" || !measure.fieldId) continue;
      const prismaField = numericFields.get(measure.fieldId) || input.dimensionFields.get(measure.fieldId);
      if (!prismaField) continue;
      let counts = distinctCountsByField.get(prismaField);
      if (!counts) {
        const distinctRows = await input.model.groupBy({ by: [...new Set([...by, prismaField])], where: input.where });
        counts = new Map<string, number>();
        for (const row of distinctRows) {
          if (row[prismaField] == null) continue;
          const key = projectionKey(by.map((field) => row[field]));
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        distinctCountsByField.set(prismaField, counts);
      }
      distinctByMeasure.set(measure.id, counts);
    }
    const rows = grouped.map((row: any) => {
      const keys = by.map((field) => row[field] ?? null);
      const key = projectionKey(keys);
      const values: Record<string, number | null> = {};
      for (const measure of projection.measures) {
        if (measure.kind === "count" && !measure.fieldId) { values[measure.id] = Number(row?._count?._all || 0); continue; }
        if (measure.kind === "count_distinct") { values[measure.id] = distinctByMeasure.get(measure.id)?.get(key) || 0; continue; }
        const expression = measure.fieldId ? derived.expressions.get(measure.fieldId) : undefined;
        if (expression && ["sum", "average", "count"].includes(measure.kind)) {
          const baseSums = Object.fromEntries(Object.keys(expression.coefficients).map((fieldId) => { const prismaField = numericFields.get(fieldId); const value = prismaField ? row?._sum?.[prismaField] : 0; return [fieldId, value == null ? 0 : Number(value)]; }));
          const count = Number(row?._count?._all || 0);
          const sum = evaluateClusterDataLinearAggregate(expression, baseSums, count);
          values[measure.id] = measure.kind === "average" ? (count > 0 && sum != null ? sum / count : null) : measure.kind === "count" ? count : sum;
          continue;
        }
        const prismaField = measure.fieldId ? numericFields.get(measure.fieldId) : undefined;
        if (!prismaField) { values[measure.id] = null; continue; }
        const aggregateKey = measure.kind === "average" ? "_avg" : `_${measure.kind}`;
        const value = row?.[aggregateKey]?.[prismaField];
        values[measure.id] = value == null ? null : Number(value);
      }
      return { keys, count: Number(row?._count?._all || 0), values };
    }).sort((a: any, b: any) => b.count - a.count || String(a.keys).localeCompare(String(b.keys)));
    const limit = Math.max(1, Math.min(200, Math.round(Number(projection.limit) || 50)));
    let rowTotals: ClusterDataProjectionResult["rowTotals"] = undefined;
    let columnTotals: ClusterDataProjectionResult["columnTotals"] = undefined;
    let grandTotal: ClusterDataProjectionResult["grandTotal"] = undefined;
    if (projection.kind === "matrix" && projection.dimensions.length === 2) {
      // Count-only matrices already read every authorized group before truncating
      // the visible cells. Derive exact totals locally instead of three more
      // database round trips (two groupBys + one count).
      const countRollups = clusterDataCountProjectionRollups(projection, rows);
      if (countRollups.rowTotals && countRollups.columnTotals && countRollups.grandTotal) {
        rowTotals = countRollups.rowTotals.slice(0, 200);
        columnTotals = countRollups.columnTotals.slice(0, 200);
        grandTotal = countRollups.grandTotal;
      } else {
        // Non-additive measures (averages, distinct counts, etc.) must retain
        // their independently aggregated totals, not sum truncated cells.
        const [rowRollup, columnRollup, scalarRollup] = await Promise.all([
          runPrismaGroupedProjections({ ...input, projections: [{ ...projection, id: `${projection.id}.__row_totals`, kind: "grouped", dimensions: [projection.dimensions[0]], limit: 200 }] }),
          runPrismaGroupedProjections({ ...input, projections: [{ ...projection, id: `${projection.id}.__column_totals`, kind: "grouped", dimensions: [projection.dimensions[1]], limit: 200 }] }),
          runPrismaScalarAnalytics({ model: input.model, where: input.where, facets: [], aggregations: projection.measures, facetFields: new Map(), numericFields, derivedFields: input.derivedFields, semanticFields: input.semanticFields }),
        ]);
        rowTotals = rowRollup[0]?.rows || [];
        columnTotals = columnRollup[0]?.rows || [];
        grandTotal = { keys: [], count: scalarRollup.total, values: scalarRollup.aggregations };
      }
    }
    results.push({
      id: projection.id,
      kind: projection.kind,
      dimensions: projection.dimensions,
      measures: projection.measures,
      ...(projection.drilldown ? { drilldown: projection.drilldown } : {}),
      rows: rows.slice(0, limit),
      ...(rowTotals ? { rowTotals } : {}),
      ...(columnTotals ? { columnTotals } : {}),
      ...(grandTotal ? { grandTotal } : {}),
      scope: "authorized_query",
      complete: true,
      truncated: rows.length > limit,
    });
  }
  return results;
}

export function clusterDataGroupSummaryProjections(
  groups: readonly ClusterDataGroup[],
  aggregations: readonly ClusterDataAggregation[],
  maxDepth = 2,
  maxRows = 100,
): ClusterDataProjection[] {
  const dimensions = groups.map((group) => group.fieldId).slice(0, Math.max(1, Math.min(2, maxDepth)));
  const measures = aggregations.length ? [...aggregations] : [{ id: "count", kind: "count", label: "Rows" } satisfies ClusterDataAggregation];
  return dimensions.map((_, index) => ({
    id: `group_summary_${index + 1}`,
    kind: index === 0 ? "grouped" : "matrix",
    dimensions: dimensions.slice(0, index + 1),
    measures,
    limit: Math.max(1, Math.min(200, maxRows)),
  }));
}

export function clusterDataProjectionGroupSummaries(
  results: readonly ClusterDataProjectionResult[],
  grandTotal?: { count: number; values: Record<string, number | null> } | null,
): ClusterDataGroupSummaryResult[] {
  return results.map((result) => ({
    dimensions: [...result.dimensions],
    aggregations: [...result.measures],
    rows: [...result.rows],
    ...(grandTotal ? { grandTotal: { keys: [], count: grandTotal.count, values: { ...grandTotal.values } } } : {}),
    scope: "authorized_query",
    complete: result.complete,
    truncated: result.truncated,
  }));
}

export async function runPrismaGroupedSummaries(input: {
  model: any;
  where: Record<string, unknown>;
  groups: readonly ClusterDataGroup[];
  aggregations: readonly ClusterDataAggregation[];
  dimensionFields: ReadonlyMap<string, string>;
  numericFields?: ReadonlyMap<string, string>;
  maxDepth?: number;
  maxRows?: number;
  derivedFields?: readonly ClusterDataDerivedField[];
  semanticFields?: readonly Pick<ClusterSemanticField, "id" | "type">[];
}): Promise<ClusterDataGroupSummaryResult[]> {
  const supportedGroups = input.groups.filter((group) => input.dimensionFields.has(group.fieldId)).slice(0, Math.max(1, Math.min(2, input.maxDepth || 2)));
  if (!supportedGroups.length || supportedGroups.length !== Math.min(input.groups.length, 2)) return [];
  const projections = clusterDataGroupSummaryProjections(supportedGroups, input.aggregations, input.maxDepth, input.maxRows);
  const [results, grandAnalytics] = await Promise.all([
    runPrismaGroupedProjections({
      model: input.model,
      where: input.where,
      projections,
      dimensionFields: input.dimensionFields,
      numericFields: input.numericFields,
      derivedFields: input.derivedFields,
      semanticFields: input.semanticFields,
    }),
    runPrismaScalarAnalytics({
      model: input.model,
      where: input.where,
      facets: [],
      aggregations: input.aggregations,
      facetFields: new Map(),
      numericFields: input.numericFields,
      derivedFields: input.derivedFields,
      semanticFields: input.semanticFields,
    }),
  ]);
  return clusterDataProjectionGroupSummaries(results, { count: grandAnalytics.total, values: grandAnalytics.aggregations });
}

import { useState, type ReactNode } from "react";
import { planClusterDataDerivedFields, toggleClusterDataSelection, type ClusterDataAggregation, type ClusterDataDerivedField, type ClusterDataDerivedOperation, type ClusterDataDisplayMetadata, type ClusterDataFacetResult, type ClusterDataGroup, type ClusterDataProjection, type ClusterDataProjectionDrilldown, type ClusterDataProjectionResult, type ClusterDataScalar, type ClusterDataSelection, type ClusterDataSelectionSet, type ClusterSemanticField } from "@cluster/shared";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterActionGroup, ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterNativeSelect } from "./ClusterNativeControls";
import { ClusterMetricStrip } from "./ClusterMetricStrip";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterToolbar } from "./ClusterToolbar";

export function DataViewGroupControl({
  fields,
  groups,
  onChange,
  label = "Group by",
  maxLevels = 3,
}: {
  fields: readonly ClusterSemanticField[];
  groups: readonly ClusterDataGroup[];
  onChange: (groups: ClusterDataGroup[]) => void;
  label?: string;
  maxLevels?: number;
}) {
  const groupable = fields.filter((field) => field.groupable);
  if (!groupable.length) return null;
  const bounded = groups.slice(0, Math.max(1, Math.min(maxLevels, 4)));
  function update(index: number, patch: Partial<ClusterDataGroup>) { onChange(bounded.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group)); }
  function remove(index: number) { onChange(bounded.filter((_, groupIndex) => groupIndex !== index)); }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= bounded.length) return;
    const next = [...bounded];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  const used = new Set(bounded.map((group) => group.fieldId));
  const available = groupable.filter((field) => !used.has(field.id));
  return <div className="cluster-data-group-controls-v504" aria-label={label}>
    {bounded.map((group, index) => <div key={`${group.fieldId}:${index}`} className="cluster-data-group-control-v504">
      <label><span>{index ? `Then by ${index + 1}` : label}</span><ClusterNativeSelect value={group.fieldId} onChange={(event) => update(index, { fieldId: event.target.value })}>{groupable.filter((field) => field.id === group.fieldId || !used.has(field.id)).map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</ClusterNativeSelect></label>
      <ClusterButton size="compact" variant="quiet" onClick={() => update(index, { direction: group.direction === "desc" ? "asc" : "desc" })}>{group.direction === "desc" ? "Descending" : "Ascending"}</ClusterButton>
      <ClusterButton size="compact" variant="quiet" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move group ${index + 1} earlier`}><ClusterIcon name="chevron-up" /></ClusterButton>
      <ClusterButton size="compact" variant="quiet" disabled={index === bounded.length - 1} onClick={() => move(index, 1)} aria-label={`Move group ${index + 1} later`}><ClusterIcon name="chevron-down" /></ClusterButton>
      <ClusterButton size="compact" variant="quiet" onClick={() => remove(index)} aria-label={`Remove group ${index + 1}`}>Remove</ClusterButton>
    </div>)}
    {bounded.length < Math.min(maxLevels, groupable.length) && available.length ? <label className="cluster-data-group-add-v504"><span>Add group</span><ClusterNativeSelect value="" onChange={(event) => { if (event.target.value) onChange([...bounded, { fieldId: event.target.value, direction: "asc" }]); }}><option value="">Choose field…</option>{available.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</ClusterNativeSelect></label> : null}
  </div>;
}


function dataScalarKey(value: ClusterDataScalar) { return `${typeof value}:${String(value)}`; }
function defaultFacetLabel(value: ClusterDataScalar) {
  if (value == null || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function DataViewFacetBar({
  facets,
  fields,
  selectedValues = {},
  onToggle,
  label = "Data view facets",
  maxBuckets = 8,
  formatValue,
}: {
  facets: readonly ClusterDataFacetResult[];
  fields: readonly ClusterSemanticField[];
  selectedValues?: Readonly<Record<string, readonly ClusterDataScalar[]>>;
  onToggle: (fieldId: string, value: ClusterDataScalar) => void;
  label?: string;
  maxBuckets?: number;
  formatValue?: (field: ClusterSemanticField | undefined, value: ClusterDataScalar) => ReactNode;
}) {
  const fieldMap = new Map(fields.map((field) => [field.id, field] as const));
  const visible = facets.filter((facet) => fieldMap.get(facet.fieldId)?.facet !== false && facet.buckets.length);
  if (!visible.length) return null;
  return (
    <div className="cluster-data-facet-bar-v504" aria-label={label}>
      {visible.map((facet) => {
        const field = fieldMap.get(facet.fieldId);
        const selected = new Set((selectedValues[facet.fieldId] || []).map(dataScalarKey));
        return (
          <div key={facet.fieldId} className="cluster-data-facet-group-v504" role="group" aria-label={field?.label || facet.fieldId}>
            <span className="cluster-data-facet-label-v504">{field?.label || facet.fieldId}</span>
            <div className="cluster-data-facet-values-v504">
              {facet.buckets.slice(0, Math.max(1, maxBuckets)).map((bucket) => {
                const active = selected.has(dataScalarKey(bucket.value));
                return <ClusterButton key={dataScalarKey(bucket.value)} size="compact" variant="quiet" selected={active} aria-pressed={active} onClick={() => onToggle(facet.fieldId, bucket.value)}><span>{formatValue ? formatValue(field, bucket.value) : defaultFacetLabel(bucket.value)}</span><small>{bucket.count.toLocaleString()}</small></ClusterButton>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDataMetric(value: number | null | undefined, display: ClusterDataDisplayMetadata | undefined, kind: ClusterDataAggregation["kind"]) {
  if (value == null || !Number.isFinite(value)) return "—";
  const precision = Math.max(0, Math.min(6, display?.precision ?? (kind === "average" ? 1 : 0)));
  const format = display?.format || (kind === "count" || kind === "count_distinct" ? "integer" : "number");
  if (format === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: precision, minimumFractionDigits: precision })}%`;
  if (format === "bytes") {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let scaled = Math.abs(value); let unit = 0;
    while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
    const signed = value < 0 ? -scaled : scaled;
    return `${signed.toLocaleString(undefined, { maximumFractionDigits: unit ? Math.max(1, precision) : 0 })} ${units[unit]}`;
  }
  if (format === "duration_ms") {
    if (Math.abs(value) < 1000) return `${Math.round(value)} ms`;
    const seconds = value / 1000;
    if (Math.abs(seconds) < 60) return `${seconds.toLocaleString(undefined, { maximumFractionDigits: Math.max(1, precision) })} s`;
    const minutes = seconds / 60;
    return `${minutes.toLocaleString(undefined, { maximumFractionDigits: Math.max(1, precision) })} min`;
  }
  if (format === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: display?.currency || "USD", maximumFractionDigits: precision }).format(value);
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: format === "integer" ? 0 : precision, minimumFractionDigits: format === "integer" ? 0 : Math.min(precision, 1) });
  return display?.unit ? `${formatted} ${display.unit}` : formatted;
}

export function DataViewAggregationStrip({
  aggregations,
  values,
  fields,
  label = "Data view summary",
  className = "",
  details = {},
}: {
  aggregations: readonly ClusterDataAggregation[];
  values: Readonly<Record<string, number | null>>;
  fields: readonly ClusterSemanticField[];
  label?: string;
  className?: string;
  details?: Readonly<Record<string, ReactNode>>;
}) {
  const fieldMap = new Map(fields.map((field) => [field.id, field] as const));
  const items = aggregations.filter((aggregation) => Object.prototype.hasOwnProperty.call(values, aggregation.id)).map((aggregation) => {
    const field = aggregation.fieldId ? fieldMap.get(aggregation.fieldId) : undefined;
    const display = aggregation.display || field?.display;
    const fallbackLabel = aggregation.kind === "count" && !field ? "Count" : `${aggregation.kind.replace(/_/g, " ")} ${field?.label || aggregation.fieldId || "records"}`;
    return { key: aggregation.id, label: aggregation.label || fallbackLabel.replace(/^./, (letter) => letter.toUpperCase()), value: formatDataMetric(values[aggregation.id], display, aggregation.kind), detail: details[aggregation.id] };
  });
  if (!items.length) return null;
  return <ClusterMetricStrip className={className} label={label} items={items} />;
}


export function selectedDataRows<T>(rows: readonly T[], selectedIds: ReadonlySet<string> | readonly string[], rowKey: (row: T) => string = (row) => String((row as { id?: unknown })?.id || "")) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return rows.filter((row) => selected.has(rowKey(row)));
}

export function selectedDataSummary<T>(rows: readonly T[], selectedIds: ReadonlySet<string> | readonly string[], metrics: Readonly<Record<string, (rows: readonly T[]) => number | null>>, rowKey?: (row: T) => string) {
  const selectedRows = selectedDataRows(rows, selectedIds, rowKey);
  return { scope: "selected" as const, count: selectedRows.length, rows: selectedRows, values: Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, metric(selectedRows)])) };
}


function projectionScalarLabel(value: ClusterDataScalar) {
  return defaultFacetLabel(value);
}

function projectionMeasureValue(result: ClusterDataProjectionResult, row: ClusterDataProjectionResult["rows"][number], measureId?: string) {
  if (measureId && Object.prototype.hasOwnProperty.call(row.values, measureId)) return row.values[measureId];
  const first = result.measures[0];
  if (first && Object.prototype.hasOwnProperty.call(row.values, first.id)) return row.values[first.id];
  return row.count;
}

function selectionConditionKey(condition: ClusterDataSelection["conditions"][number]) {
  return `${condition.fieldId}:${condition.operator}:${JSON.stringify(condition.value ?? null)}`;
}

export function dataProjectionSelection(result: ClusterDataProjectionResult, row: ClusterDataProjectionResult["rows"][number]): ClusterDataSelection | null {
  if (result.drilldown?.mode !== "filter") return null;
  const fieldIds = result.drilldown.fieldIds?.length === result.dimensions.length ? result.drilldown.fieldIds : result.dimensions;
  if (fieldIds.length !== row.keys.length) return null;
  return {
    source: "projection",
    projectionId: result.id,
    conditions: fieldIds.map((fieldId, index) => ({ fieldId, operator: row.keys[index] == null ? "is_empty" : "equals", ...(row.keys[index] == null ? {} : { value: row.keys[index] }) })),
  };
}

export function clusterDataSelectionsEqual(left: ClusterDataSelection | null | undefined, right: ClusterDataSelection | null | undefined) {
  if (!left || !right || left.source !== right.source || left.projectionId !== right.projectionId || left.conditions.length !== right.conditions.length) return false;
  return left.conditions.map(selectionConditionKey).sort().join("|") === right.conditions.map(selectionConditionKey).sort().join("|");
}

type ProjectionInteractionProps = {
  selection?: ClusterDataSelection | null;
  selectionSet?: ClusterDataSelectionSet | null;
  onSelectionChange?: (selection: ClusterDataSelection | null) => void;
  onSelectionSetChange?: (selectionSet: ClusterDataSelectionSet) => void;
  onDrilldown?: (selection: ClusterDataSelection, drilldown: ClusterDataProjectionDrilldown | null | undefined) => void;
};

export function DataViewChartProjection({
  result,
  fields,
  measureId,
  label = "Data view chart",
  selection,
  selectionSet,
  onSelectionChange,
  onSelectionSetChange,
  onDrilldown,
}: {
  result: ClusterDataProjectionResult;
  fields: readonly ClusterSemanticField[];
  measureId?: string;
  label?: string;
} & ProjectionInteractionProps) {
  if (result.kind !== "grouped" || result.dimensions.length !== 1 || !result.rows.length) return null;
  const field = fields.find((candidate) => candidate.id === result.dimensions[0]);
  const values = result.rows.map((row) => Number(projectionMeasureValue(result, row, measureId) || 0));
  const maximum = Math.max(1, ...values.map((value) => Math.abs(value)));
  return <section className="cluster-data-projection-v504 cluster-data-chart-v504" aria-label={label}>
    <div className="cluster-data-projection-head-v504"><strong>{field?.label || result.dimensions[0]}</strong><small>{result.truncated ? `Top ${result.rows.length} groups` : `${result.rows.length} groups`} · full authorized query{result.drilldown ? " · select to drill down" : ""}</small></div>
    <div className="cluster-data-chart-rows-v504">
      {result.rows.map((row, index) => {
        const value = values[index];
        const nextSelection = dataProjectionSelection(result, row);
        const selected = nextSelection ? (selectionSet?.selections.some((candidate) => clusterDataSelectionsEqual(candidate, nextSelection)) || clusterDataSelectionsEqual(selection, nextSelection)) : false;
        const content = <><span>{projectionScalarLabel(row.keys[0])}</span><progress max={maximum} value={Math.abs(value)} aria-label={`${projectionScalarLabel(row.keys[0])}: ${value.toLocaleString()}`} /><strong>{value.toLocaleString()}</strong></>;
        return nextSelection ? <ClusterButton unstyled key={`${projectionScalarLabel(row.keys[0])}:${index}`} type="button" className="cluster-data-chart-row-v504 cluster-data-projection-action-v504" aria-pressed={selected} onClick={(event) => { if (event.shiftKey && onSelectionSetChange) { onSelectionSetChange(toggleClusterDataSelection(selectionSet, nextSelection, clusterDataSelectionsEqual)); return; } const next = selected ? null : nextSelection; onSelectionChange?.(next); if (next) onDrilldown?.(next, result.drilldown); }}>{content}</ClusterButton> : <div key={`${projectionScalarLabel(row.keys[0])}:${index}`} className="cluster-data-chart-row-v504">{content}</div>;
      })}
    </div>
  </section>;
}

export function DataViewMatrixProjection({
  result,
  fields,
  measureId,
  label = "Data view matrix",
  selection,
  selectionSet,
  onSelectionChange,
  onSelectionSetChange,
  onDrilldown,
}: {
  result: ClusterDataProjectionResult;
  fields: readonly ClusterSemanticField[];
  measureId?: string;
  label?: string;
} & ProjectionInteractionProps) {
  if (result.kind !== "matrix" || result.dimensions.length !== 2 || !result.rows.length) return null;
  const rowField = fields.find((candidate) => candidate.id === result.dimensions[0]);
  const columnField = fields.find((candidate) => candidate.id === result.dimensions[1]);
  const rowKeys = [...new Map(result.rows.map((row) => [dataScalarKey(row.keys[0]), row.keys[0]] as const)).values()];
  const columnKeys = [...new Map(result.rows.map((row) => [dataScalarKey(row.keys[1]), row.keys[1]] as const)).values()];
  const cells = new Map(result.rows.map((row) => [`${dataScalarKey(row.keys[0])}|${dataScalarKey(row.keys[1])}`, row] as const));
  const rowTotals = new Map((result.rowTotals || []).map((row) => [dataScalarKey(row.keys[0]), row] as const));
  const columnTotals = new Map((result.columnTotals || []).map((row) => [dataScalarKey(row.keys[0]), row] as const));
  const hasExactRollups = Boolean(result.rowTotals?.length || result.columnTotals?.length || result.grandTotal);
  return <section className="cluster-data-projection-v504 cluster-data-matrix-v504" aria-label={label}>
    <div className="cluster-data-projection-head-v504"><strong>{rowField?.label || result.dimensions[0]} × {columnField?.label || result.dimensions[1]}</strong><small>{result.truncated ? "Largest groups shown" : "Full grouped projection"} · full authorized query{hasExactRollups ? " · exact totals" : ""}{result.drilldown ? " · select to drill down" : ""}</small></div>
    <div className="cluster-data-matrix-scroll-v504"><table><thead><tr><th scope="col">{rowField?.label || result.dimensions[0]}</th>{columnKeys.map((key) => <th scope="col" key={dataScalarKey(key)}>{projectionScalarLabel(key)}</th>)}{result.rowTotals?.length ? <th scope="col">Total</th> : null}</tr></thead><tbody>{rowKeys.map((rowKey) => <tr key={dataScalarKey(rowKey)}><th scope="row">{projectionScalarLabel(rowKey)}</th>{columnKeys.map((columnKey) => { const row = cells.get(`${dataScalarKey(rowKey)}|${dataScalarKey(columnKey)}`); const value = row ? projectionMeasureValue(result, row, measureId) : null; const nextSelection = row ? dataProjectionSelection(result, row) : null; const selected = nextSelection ? (selectionSet?.selections.some((candidate) => clusterDataSelectionsEqual(candidate, nextSelection)) || clusterDataSelectionsEqual(selection, nextSelection)) : false; return <td key={dataScalarKey(columnKey)}>{nextSelection ? <ClusterButton unstyled type="button" className="cluster-data-matrix-action-v504" aria-pressed={selected} onClick={(event) => { if (event.shiftKey && onSelectionSetChange) { onSelectionSetChange(toggleClusterDataSelection(selectionSet, nextSelection, clusterDataSelectionsEqual)); return; } const next = selected ? null : nextSelection; onSelectionChange?.(next); if (next) onDrilldown?.(next, result.drilldown); }}>{typeof value === "number" ? value.toLocaleString() : "—"}</ClusterButton> : typeof value === "number" ? value.toLocaleString() : "—"}</td>; })}{result.rowTotals?.length ? <td className="cluster-data-matrix-total-v504"><strong>{(() => { const total = rowTotals.get(dataScalarKey(rowKey)); const value = total ? projectionMeasureValue(result, total, measureId) : null; return typeof value === "number" ? value.toLocaleString() : "—"; })()}</strong></td> : null}</tr>)}</tbody>{result.columnTotals?.length || result.grandTotal ? <tfoot><tr><th scope="row">Total</th>{columnKeys.map((columnKey) => <td key={dataScalarKey(columnKey)} className="cluster-data-matrix-total-v504"><strong>{(() => { const total = columnTotals.get(dataScalarKey(columnKey)); const value = total ? projectionMeasureValue(result, total, measureId) : null; return typeof value === "number" ? value.toLocaleString() : "—"; })()}</strong></td>)}{result.rowTotals?.length ? <td className="cluster-data-matrix-total-v504"><strong>{(() => { const value = result.grandTotal ? projectionMeasureValue(result, result.grandTotal, measureId) : null; return typeof value === "number" ? value.toLocaleString() : "—"; })()}</strong></td> : null}</tr></tfoot> : null}</table></div>
  </section>;
}

export function DataViewProjection({ result, fields, measureId, label, selection, selectionSet, onSelectionChange, onSelectionSetChange, onDrilldown }: { result: ClusterDataProjectionResult; fields: readonly ClusterSemanticField[]; measureId?: string; label?: string } & ProjectionInteractionProps) {
  const props = { result, fields, measureId, label, selection, selectionSet, onSelectionChange, onSelectionSetChange, onDrilldown };
  return result.kind === "matrix" ? <DataViewMatrixProjection {...props} /> : <DataViewChartProjection {...props} />;
}


const DERIVED_OPERATION_LABELS: Record<ClusterDataDerivedOperation, string> = {
  add: "Add",
  subtract: "Subtract",
  multiply: "Multiply",
  divide: "Divide",
  concat: "Join text",
  coalesce: "Use fallback",
};

export function DataViewDerivedFieldBuilder({
  fields,
  derivedFields,
  onChange,
  label = "Formula columns",
}: {
  fields: readonly ClusterSemanticField[];
  derivedFields: readonly ClusterDataDerivedField[];
  onChange: (fields: ClusterDataDerivedField[]) => void;
  label?: string;
}) {
  const formulaFields = fields.filter((field) => ["number", "duration", "text", "status", "enum"].includes(field.type));
  const plan = planClusterDataDerivedFields(derivedFields, fields);
  const derivedOperands: ClusterSemanticField[] = plan.fields.map((field) => ({ id: field.id, label: field.label, type: field.type, computed: true }));
  const allOperands = [...formulaFields, ...derivedOperands];
  const numericOperands = allOperands.filter((field) => ["number", "duration"].includes(field.type));
  const [name, setName] = useState("");
  const [leftFieldId, setLeftFieldId] = useState(formulaFields[0]?.id || "");
  const [rightFieldId, setRightFieldId] = useState(formulaFields[1]?.id || formulaFields[0]?.id || "");
  const [operation, setOperation] = useState<ClusterDataDerivedOperation>("add");
  if (!formulaFields.length) return null;
  const numericOperation = ["add", "subtract", "multiply", "divide"].includes(operation);
  const operandChoices = numericOperation ? numericOperands : allOperands;
  const effectiveLeft = operandChoices.some((field) => field.id === leftFieldId) ? leftFieldId : operandChoices[0]?.id || "";
  const effectiveRight = operandChoices.some((field) => field.id === rightFieldId) ? rightFieldId : operandChoices[1]?.id || operandChoices[0]?.id || "";
  function addDerivedField() {
    const left = allOperands.find((field) => field.id === effectiveLeft);
    const right = allOperands.find((field) => field.id === effectiveRight);
    if (!left || !right || (numericOperation && (!["number", "duration"].includes(left.type) || !["number", "duration"].includes(right.type)))) return;
    const textOperation = operation === "concat" || operation === "coalesce";
    const derived: ClusterDataDerivedField = {
      id: `derived_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      label: name.trim() || `${left.label} ${DERIVED_OPERATION_LABELS[operation].toLowerCase()} ${right.label}`,
      type: textOperation ? "text" : "number",
      operation,
      left: { kind: "field", fieldId: left.id },
      right: { kind: "field", fieldId: right.id },
      ...(textOperation ? {} : { display: { format: "number", precision: 2 } }),
    };
    const next = [...derivedFields, derived].slice(0, 12);
    const nextPlan = planClusterDataDerivedFields(next, fields);
    if (nextPlan.issues.length) return;
    onChange(next);
    setName("");
  }
  return <section className="cluster-data-derived-builder-v504" aria-label={label}>
    <div className="cluster-data-derived-head-v504"><div><strong>{label}</strong><small>Safe dependency-aware formulas. Formula columns may reference earlier formulas; cycles and invalid references are rejected.</small></div></div>
    <div className="cluster-data-derived-create-v504">
      <ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Column label" aria-label="Formula column label" />
      <ClusterNativeSelect value={effectiveLeft} onChange={(event) => setLeftFieldId(event.target.value)} aria-label="Formula left field">{operandChoices.map((field) => <option key={field.id} value={field.id}>{field.label}{field.computed ? " · formula" : ""}</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={operation} onChange={(event) => setOperation(event.target.value as ClusterDataDerivedOperation)} aria-label="Formula operation">{Object.entries(DERIVED_OPERATION_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={effectiveRight} onChange={(event) => setRightFieldId(event.target.value)} aria-label="Formula right field">{operandChoices.map((field) => <option key={field.id} value={field.id}>{field.label}{field.computed ? " · formula" : ""}</option>)}</ClusterNativeSelect>
      <ClusterButton size="compact" disabled={!effectiveLeft || !effectiveRight} onClick={addDerivedField}>Add column</ClusterButton>
    </div>
    {plan.issues.length ? <ul className="cluster-data-derived-issues-v504">{plan.issues.slice(0, 6).map((issue, index) => <li key={`${issue.fieldId}:${issue.code}:${index}`}>{issue.message}</li>)}</ul> : null}
    {derivedFields.length ? <div className="cluster-data-derived-list-v504">{derivedFields.map((field) => { const dependencies = (plan.dependencies[field.id] || []).map((id) => plan.fields.find((candidate) => candidate.id === id)?.label || id); return <span key={field.id}><strong>{field.label}</strong><small>{field.operation.replace(/_/g, " ")}{dependencies.length ? ` · depends on ${dependencies.join(", ")}` : ""}</small><ClusterIconButton size="compact" variant="quiet" label={`Remove ${field.label}`} onClick={() => onChange(derivedFields.filter((candidate) => candidate.id !== field.id))}><ClusterIcon name="close" /></ClusterIconButton></span>; })}</div> : <small className="muted">No formula columns in this view.</small>}
  </section>;
}

export function useDataViewDrilldownHistory<T>(current: T, restore: (snapshot: T) => void, maxDepth = 12) {
  const [history, setHistory] = useState<T[]>([]);
  function capture() { setHistory((items) => [...items, current].slice(-Math.max(1, Math.min(32, maxDepth)))); }
  function back() {
    setHistory((items) => {
      if (!items.length) return items;
      const previous = items[items.length - 1];
      restore(previous);
      return items.slice(0, -1);
    });
  }
  function exit() {
    setHistory((items) => {
      if (items.length) restore(items[0]);
      return [];
    });
  }
  function reset() { setHistory([]); }
  return { depth: history.length, capture, back, exit, reset };
}

export function DataViewSelectionBar({
  selection,
  fields,
  onClear,
  onBack,
  onExit,
  historyDepth = 0,
  label = "Analytical selection",
}: {
  selection: ClusterDataSelection | null | undefined;
  fields: readonly ClusterSemanticField[];
  onClear: () => void;
  onBack?: () => void;
  onExit?: () => void;
  historyDepth?: number;
  label?: string;
}) {
  if (!selection?.conditions.length) return null;
  const fieldMap = new Map(fields.map((field) => [field.id, field.label] as const));
  return <ClusterToolbar label={label} className="cluster-data-selection-bar-v504">
    <strong>{label}</strong>
    {selection.conditions.map((condition, index) => <span className="cluster-data-selection-chip-v504" key={`${condition.fieldId}:${index}`}>{fieldMap.get(condition.fieldId) || condition.fieldId}: {condition.operator === "is_empty" ? "Empty" : String(condition.value ?? "")}</span>)}
    {historyDepth > 0 && onBack ? <ClusterButton size="compact" variant="quiet" onClick={onBack}>Back{historyDepth > 1 ? ` (${historyDepth})` : ""}</ClusterButton> : null}
    {historyDepth > 0 && onExit ? <ClusterButton size="compact" variant="quiet" onClick={onExit}>Exit drilldown</ClusterButton> : <ClusterButton size="compact" variant="quiet" onClick={onClear}>Clear selection</ClusterButton>}
  </ClusterToolbar>;
}


export function DataViewSelectionSetBar({
  selectionSet,
  fields,
  onChange,
  label = "Analytical selection set",
}: {
  selectionSet: ClusterDataSelectionSet | null | undefined;
  fields: readonly ClusterSemanticField[];
  onChange: (selectionSet: ClusterDataSelectionSet) => void;
  label?: string;
}) {
  if (!selectionSet?.selections.length) return null;
  const fieldMap = new Map(fields.map((field) => [field.id, field.label] as const));
  return <ClusterToolbar label={label} className="cluster-data-selection-bar-v504">
    <strong>{label}</strong>
    <ClusterNativeSelect value={selectionSet.logic} onChange={(event) => onChange({ ...selectionSet, logic: event.target.value === "and" ? "and" : "or" })} aria-label={`${label} composition`}>
      <option value="or">Match any selection</option>
      <option value="and">Match all selections</option>
    </ClusterNativeSelect>
    {selectionSet.selections.map((selection, index) => <span className="cluster-data-selection-chip-v504" key={`${selection.projectionId || selection.source}:${index}`}>{selection.conditions.map((condition) => `${fieldMap.get(condition.fieldId) || condition.fieldId}: ${condition.operator === "is_empty" ? "Empty" : String(condition.value ?? "")}`).join(" + ")}<ClusterIconButton size="compact" variant="quiet" label={`Remove analytical selection ${index + 1}`} onClick={() => onChange({ ...selectionSet, selections: selectionSet.selections.filter((_, candidateIndex) => candidateIndex !== index) })}><ClusterIcon name="close" /></ClusterIconButton></span>)}
    <ClusterButton size="compact" variant="quiet" onClick={() => onChange({ ...selectionSet, selections: [] })}>Clear all</ClusterButton>
  </ClusterToolbar>;
}

export function DataViewProjectionComposer({
  fields,
  projections,
  onChange,
  label = "Analytical projections",
}: {
  fields: readonly ClusterSemanticField[];
  projections: readonly ClusterDataProjection[];
  onChange: (projections: ClusterDataProjection[]) => void;
  label?: string;
}) {
  const dimensions = fields.filter((field) => field.groupable);
  const measures = fields.filter((field) => field.aggregatable && ["number", "duration"].includes(field.type));
  const [kind, setKind] = useState<"grouped" | "matrix">("grouped");
  const [dimensionA, setDimensionA] = useState(dimensions[0]?.id || "");
  const [dimensionB, setDimensionB] = useState(dimensions[1]?.id || dimensions[0]?.id || "");
  const [measure, setMeasure] = useState("count");
  if (!dimensions.length) return null;
  function addProjection() {
    const selectedDimensions = kind === "matrix" ? [dimensionA, dimensionB].filter(Boolean) : [dimensionA].filter(Boolean);
    if (!selectedDimensions.length || new Set(selectedDimensions).size !== selectedDimensions.length) return;
    const selectedMeasure = measures.find((field) => field.id === measure);
    const projection: ClusterDataProjection = {
      id: `projection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      kind,
      dimensions: selectedDimensions,
      measures: selectedMeasure ? [{ id: `average_${selectedMeasure.id}`, kind: "average", fieldId: selectedMeasure.id, label: `Average ${selectedMeasure.label}`, display: selectedMeasure.display }] : [{ id: "count", kind: "count", label: "Count" }],
      limit: kind === "matrix" ? 64 : 24,
      drilldown: { mode: "filter", fieldIds: selectedDimensions, presentation: "table" },
    };
    onChange([...projections, projection].slice(0, 4));
  }
  return <section className="cluster-data-projection-composer-v504" aria-label={label}>
    <div className="cluster-data-derived-head-v504"><div><strong>{label}</strong><small>Compose grouped charts and pivot-style matrices from canonical semantic fields.</small></div></div>
    <div className="cluster-data-derived-create-v504">
      <ClusterNativeSelect value={kind} onChange={(event) => setKind(event.target.value as "grouped" | "matrix")} aria-label="Projection type"><option value="grouped">Grouped chart</option><option value="matrix">Pivot matrix</option></ClusterNativeSelect>
      <ClusterNativeSelect value={dimensionA} onChange={(event) => setDimensionA(event.target.value)} aria-label="Primary projection dimension">{dimensions.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</ClusterNativeSelect>
      {kind === "matrix" ? <ClusterNativeSelect value={dimensionB} onChange={(event) => setDimensionB(event.target.value)} aria-label="Secondary projection dimension">{dimensions.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</ClusterNativeSelect> : <span className="muted">One dimension</span>}
      <ClusterNativeSelect value={measure} onChange={(event) => setMeasure(event.target.value)} aria-label="Projection measure"><option value="count">Record count</option>{measures.map((field) => <option key={field.id} value={field.id}>Average {field.label}</option>)}</ClusterNativeSelect>
      <ClusterButton size="compact" disabled={projections.length >= 4 || (kind === "matrix" && dimensionA === dimensionB)} onClick={addProjection}>Add projection</ClusterButton>
    </div>
    {projections.length ? <div className="cluster-data-derived-list-v504">{projections.map((projection) => <span key={projection.id}><strong>{projection.kind === "matrix" ? "Matrix" : "Chart"}</strong><small>{projection.dimensions.map((id) => fields.find((field) => field.id === id)?.label || id).join(" × ")}</small><ClusterIconButton size="compact" variant="quiet" label={`Remove ${projection.id}`} onClick={() => onChange(projections.filter((candidate) => candidate.id !== projection.id))}><ClusterIcon name="close" /></ClusterIconButton></span>)}</div> : <small className="muted">No analytical projections in this view.</small>}
  </section>;
}

import type { ClusterDataFilterCondition, ClusterDataFilterGroup, ClusterDataFilterOperator, ClusterDataFilterValue, ClusterSemanticField } from "@cluster/shared";
import { clusterDataFilterOperatorsForType } from "@cluster/shared";
import { ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterCombobox } from "./ClusterCombobox";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterInput } from "./ClusterNativeControls";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterSegmentedControl } from "./ClusterSegmentedControl";
import { ClusterToolbar } from "./ClusterToolbar";

export type ClusterFilterOption = { value: string; label: string; meta?: string; disabled?: boolean };
export type ClusterFilterField = ClusterSemanticField & { options?: readonly ClusterFilterOption[] };

const OPERATOR_LABELS: Record<ClusterDataFilterOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  greater_than: "is after / greater than",
  greater_or_equal: "is on or after / at least",
  less_than: "is before / less than",
  less_or_equal: "is on or before / at most",
  between: "is between",
  in: "is any of",
  not_in: "is none of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

function ruleId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function emptyValue(field: ClusterFilterField, operator: ClusterDataFilterOperator): ClusterDataFilterValue | undefined {
  if (["is_empty", "is_not_empty"].includes(operator)) return undefined;
  if (["in", "not_in"].includes(operator)) return [];
  if (operator === "between") return { from: null, to: null };
  if (field.type === "boolean") return false;
  return "";
}

export function ClusterFilterBuilder({
  fields,
  filters,
  onChange,
  label = "Filters",
  disabled = false,
  maxRules = 12,
}: {
  fields: readonly ClusterFilterField[];
  filters: ClusterDataFilterGroup;
  onChange: (filters: ClusterDataFilterGroup) => void;
  label?: string;
  disabled?: boolean;
  maxRules?: number;
}) {
  const rules = filters.conditions || [];
  function setRules(conditions: ClusterDataFilterCondition[]) { onChange({ ...filters, conditions }); }
  function patchRule(id: string, patch: Partial<ClusterDataFilterCondition>) { setRules(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule)); }
  function removeRule(id: string) { setRules(rules.filter((rule) => rule.id !== id)); }
  function addRule() {
    const field = fields.find((candidate) => candidate.filterable !== false);
    if (!field || rules.length >= maxRules) return;
    const operator = clusterDataFilterOperatorsForType(field.type)[0];
    setRules([...rules, { id: ruleId(), fieldId: field.id, operator, value: emptyValue(field, operator) }]);
  }

  return <section className="cluster-field-v425" aria-label={label}>
    <ClusterToolbar label={`${label} controls`}>
      <strong>{label}</strong>
      {rules.length > 1 ? <ClusterSegmentedControl value={filters.logic} onChange={(logic) => onChange({ ...filters, logic })} label={`${label} match mode`} options={[{ value: "and", label: "Match all" }, { value: "or", label: "Match any" }]} /> : null}
      <ClusterButton size="compact" onClick={addRule} disabled={disabled || !fields.length || rules.length >= maxRules}><ClusterIcon name="plus" /> Add filter</ClusterButton>
      {rules.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setRules([])} disabled={disabled}>Clear filters</ClusterButton> : null}
    </ClusterToolbar>
    {rules.map((rule, index) => {
      const field = fields.find((candidate) => candidate.id === rule.fieldId) || fields[0];
      if (!field) return null;
      const operators = clusterDataFilterOperatorsForType(field.type);
      const operator = operators.includes(rule.operator) ? rule.operator : operators[0];
      const needsValue = !["is_empty", "is_not_empty"].includes(operator);
      return <ClusterToolbar key={rule.id || `${rule.fieldId}-${index}`} label={`${label} rule ${index + 1}`}>
        <ClusterCombobox value={field.id} onChange={(fieldId) => { const next = fields.find((candidate) => candidate.id === fieldId) || field; const nextOperator = clusterDataFilterOperatorsForType(next.type)[0]; patchRule(rule.id || "", { fieldId, operator: nextOperator, value: emptyValue(next, nextOperator) }); }} ariaLabel={`Filter ${index + 1} field`} options={fields.filter((candidate) => candidate.filterable !== false).map((candidate) => ({ value: candidate.id, label: candidate.label }))} disabled={disabled} />
        <ClusterCombobox value={operator} onChange={(value) => { const nextOperator = value as ClusterDataFilterOperator; patchRule(rule.id || "", { operator: nextOperator, value: emptyValue(field, nextOperator) }); }} ariaLabel={`Filter ${index + 1} operator`} options={operators.map((value) => ({ value, label: OPERATOR_LABELS[value] }))} disabled={disabled} />
        {needsValue ? <FilterValue field={field} operator={operator} value={rule.value} disabled={disabled} onChange={(value) => patchRule(rule.id || "", { value })} /> : null}
        <ClusterIconButton label={`Remove filter ${index + 1}`} size="compact" variant="quiet" disabled={disabled} onClick={() => removeRule(rule.id || "")}><ClusterIcon name="close" /></ClusterIconButton>
      </ClusterToolbar>;
    })}
  </section>;
}

function scalar(value: ClusterDataFilterValue | undefined) {
  return Array.isArray(value) || (value && typeof value === "object") ? "" : value == null ? "" : String(value);
}

function FilterValue({ field, operator, value, disabled, onChange }: { field: ClusterFilterField; operator: ClusterDataFilterOperator; value?: ClusterDataFilterValue; disabled: boolean; onChange: (value: ClusterDataFilterValue) => void }) {
  if (operator === "between") {
    const range = value && !Array.isArray(value) && typeof value === "object" ? value : { from: null, to: null };
    const inputType = field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "number" || field.type === "duration" ? "number" : "text";
    return <>
      <ClusterInput type={inputType} value={range.from == null ? "" : String(range.from)} onChange={(event) => onChange({ ...range, from: event.target.value })} aria-label={`${field.label} filter start`} disabled={disabled} />
      <ClusterInput type={inputType} value={range.to == null ? "" : String(range.to)} onChange={(event) => onChange({ ...range, to: event.target.value })} aria-label={`${field.label} filter end`} disabled={disabled} />
    </>;
  }
  if (["in", "not_in"].includes(operator) && field.options?.length) return <ClusterMultiSelect values={Array.isArray(value) ? value.map(String) : []} onChange={onChange} options={[...field.options]} ariaLabel={`${field.label} filter values`} placeholder="Choose values" searchPlaceholder={`Search ${field.label.toLowerCase()}`} disabled={disabled} />;
  if ((field.type === "enum" || field.type === "status" || field.type === "boolean") && !["contains", "not_contains", "starts_with", "ends_with"].includes(operator)) {
    const options = field.type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.options?.length ? [...field.options] : [...(field.enumValues || [])].map((entry) => ({ value: entry, label: entry }));
    return <ClusterCombobox value={scalar(value)} onChange={onChange} options={options} ariaLabel={`${field.label} filter value`} placeholder="Choose value" disabled={disabled} />;
  }
  const inputType = field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "number" || field.type === "duration" ? "number" : "text";
  return <ClusterInput type={inputType} value={scalar(value)} onChange={(event) => onChange(event.target.value)} aria-label={`${field.label} filter value`} disabled={disabled} />;
}

import { useMemo, useState } from "react";
import { SharedWorkFieldEditor } from "../../components/SharedWorkFieldEditor";
import type { CustomFieldEntity, CustomFieldValueRecord as ValueRecord, StudioCustomFieldDefinition as Definition } from "../application/application-models";
import {
  normalizeServerCustomFieldDefinition,
  useServerCustomFieldDefinitions,
  useServerCustomFieldValues,
} from "./custom-field-storage";

function visible(field: Definition, values: Record<string, string | boolean>) {
  if (!field.showWhenFieldId) return true;
  return String(values[field.showWhenFieldId] ?? "").trim().toLowerCase() === String(field.showWhenValue ?? "").trim().toLowerCase();
}
export function EntityCustomFields({ entity, entityId, entityLabel, projectId, title = "Custom fields", compact = true, readOnly = false }: {
  entity: CustomFieldEntity; entityId: string; entityLabel?: string; projectId?: string | null; title?: string; compact?: boolean; readOnly?: boolean;
}) {
  const definitionsStore = useServerCustomFieldDefinitions(normalizeServerCustomFieldDefinition);
  const valuesStore = useServerCustomFieldValues(entity, entityId, projectId || (entity === "project" ? entityId : null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const definitions = definitionsStore.definitions.filter((field) => field.entity === entity && field.enabled !== false && !field.archivedAt);
  const values = useMemo(() => Object.fromEntries(valuesStore.values.map((record) => [record.fieldId, record.value])) as Record<string, string | boolean>, [valuesStore.values]);
  const visibleFieldIds = new Set<string>(valuesStore.visibleFieldIds);
  const editableFieldIds = new Set<string>(valuesStore.editableFieldIds);
  const shown = definitions.filter((field) => visibleFieldIds.has(field.id) && visible(field, values));

  function validate(field: Definition, value: string | boolean) {
    if (field.required && (value === undefined || (typeof value === "string" && value.trim() === ""))) return `${field.label} is required.`;
    if (["number", "duration"].includes(field.fieldType) && String(value).trim() && (!Number.isFinite(Number(value)) || (field.fieldType === "duration" && Number(value) < 0))) return "Enter a valid number.";
    if (field.fieldType === "url" && String(value).trim()) { try { new URL(String(value)); } catch { return "Enter a valid URL."; } }
    return "";
  }
  function save(field: Definition, value: string | boolean) {
    if (readOnly || !editableFieldIds.has(field.id)) return;
    const error = validate(field, value);
    setErrors((current) => ({ ...current, [field.id]: error }));
    if (error) return;
    const next: ValueRecord = {
      id: `${entity}:${entityId}:${field.id}`,
      entity,
      entityId,
      projectId: projectId || (entity === "project" ? entityId : null),
      fieldId: field.id,
      value,
      updatedAt: new Date().toISOString(),
    };
    void valuesStore.save(next);
  }

  if (!definitions.length && !definitionsStore.loading) return null;
  return <section className={`custom-field-values-v195 custom-field-values-v199 ${compact ? "compact" : "project-overview-panel-v147"}`}>
    {(definitionsStore.error || valuesStore.error) && <div className="inline-status danger">{definitionsStore.error || valuesStore.error}</div>}
    <div className="settings-card-head-v092"><h3>{title}</h3><span>{definitionsStore.loading || valuesStore.loading ? "Loading server fields…" : `${shown.length} visible · ${definitions.length} configured${valuesStore.pending ? " · saving" : ""}`}</span></div>
    <div className="custom-field-values-grid-v195">{shown.map((field) => {
      const value = values[field.id] ?? field.defaultValue ?? "";
      const editable: boolean = !readOnly && editableFieldIds.has(field.id);
      return <SharedWorkFieldEditor
        key={field.id}
        field={field}
        value={value}
        editable={editable}
        error={errors[field.id]}
        onChange={(nextValue) => save(field, nextValue)}
      />;
    })}</div>
  </section>;
}

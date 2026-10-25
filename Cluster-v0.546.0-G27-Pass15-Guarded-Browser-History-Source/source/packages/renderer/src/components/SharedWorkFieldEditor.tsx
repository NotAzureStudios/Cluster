import type { ClusterCustomFieldDefinition } from "@cluster/shared";
import { ClusterField } from "./ClusterField";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterInput } from "./ClusterNativeControls";
import { ClusterSelect } from "./ClusterSelect";
import { ClusterTextInput } from "./ClusterTextInput";

function selectedValues(value: string | boolean) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function SharedWorkFieldEditor({
  field,
  value,
  editable,
  error,
  onChange,
}: {
  field: ClusterCustomFieldDefinition;
  value: string | boolean;
  editable: boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const description = field.helpText || undefined;
  const common = {
    label: field.label,
    required: Boolean(field.required),
    description,
    error: error || undefined,
  };

  if (field.fieldType === "boolean") {
    return (
      <ClusterField {...common}>
        <label className={`tool-check compact ${!editable ? "disabled" : ""}`}>
          <ClusterInput
            type="checkbox"
            disabled={!editable}
            checked={Boolean(value)}
            aria-label={field.label}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{Boolean(value) ? "Yes" : "No"}</span>
        </label>
      </ClusterField>
    );
  }

  if (["select", "department", "user"].includes(field.fieldType)) {
    return (
      <ClusterField {...common}>
        <ClusterSelect
          ariaLabel={field.label}
          disabled={!editable}
          value={String(value || "")}
          placeholder={field.placeholder || "Not set"}
          onChange={onChange}
          options={[
            { value: "", label: field.placeholder || "Not set" },
            ...(field.options || []).map((option) => ({ value: option, label: option })),
          ]}
        />
      </ClusterField>
    );
  }

  if (field.fieldType === "multi-select") {
    const values = selectedValues(value);
    return (
      <ClusterField {...common}>
        <ClusterMultiSelect
          ariaLabel={field.label}
          disabled={!editable}
          values={values}
          placeholder={field.placeholder || "Not set"}
          options={(field.options || []).map((option) => ({ value: option, label: option }))}
          onChange={(next) => onChange(next.join(", "))}
        />
      </ClusterField>
    );
  }

  const type = ["number", "duration"].includes(field.fieldType)
    ? "number"
    : field.fieldType === "date"
      ? "date"
      : field.fieldType === "url"
        ? "url"
        : "text";

  return (
    <ClusterField {...common}>
      <ClusterTextInput
        disabled={!editable}
        type={type}
        min={field.fieldType === "duration" ? "0" : undefined}
        value={String(value || "")}
        placeholder={field.placeholder || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </ClusterField>
  );
}

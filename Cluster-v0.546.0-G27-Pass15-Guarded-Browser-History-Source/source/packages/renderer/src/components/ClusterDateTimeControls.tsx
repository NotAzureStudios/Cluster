import { useId, type ReactNode } from "react";
import { ClusterField } from "./ClusterField";
import { ClusterInput } from "./ClusterNativeControls";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterSegmentedControl } from "./ClusterSegmentedControl";

export function ClusterDateTimeField({
  label,
  value,
  onChange,
  mode = "datetime-local",
  description,
  min,
  max,
  disabled = false,
  required = false,
  className = "",
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "time" | "datetime-local";
  description?: ReactNode;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  return <ClusterField label={label} htmlFor={id} description={description} required={required} className={className}><ClusterInput id={id} type={mode} value={value} min={min} max={max} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value)} /></ClusterField>;
}

export function ClusterDateRangeField({
  start,
  end,
  onChange,
  label = "Date range",
  startLabel = "Start",
  endLabel = "End",
  disabled = false,
  required = false,
  allowOpenEnd = true,
  className = "",
}: {
  start: string;
  end: string;
  onChange: (value: { start: string; end: string }) => void;
  label?: string;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
  required?: boolean;
  allowOpenEnd?: boolean;
  className?: string;
}) {
  const invalid = Boolean(start && end && end < start);
  const startId = useId();
  const endId = useId();
  return <fieldset className={`cluster-field-v425 ${className}`.trim()} aria-label={label} disabled={disabled}>
    <legend className="cluster-field-label-v425"><span>{label}</span>{required ? <em>Required</em> : null}</legend>
    <div className="cluster-action-group-v425">
      <ClusterField label={startLabel} htmlFor={startId} required={required}><ClusterInput id={startId} type="date" value={start} max={end || undefined} invalid={invalid} required={required} onChange={(event) => onChange({ start: event.target.value, end })} /></ClusterField>
      <ClusterField label={endLabel} htmlFor={endId} required={required && !allowOpenEnd} error={invalid ? "End date must be on or after the start date." : undefined}><ClusterInput id={endId} type="date" value={end} min={start || undefined} invalid={invalid} required={required && !allowOpenEnd} onChange={(event) => onChange({ start, end: event.target.value })} /></ClusterField>
    </div>
  </fieldset>;
}

const WEEKDAYS = [
  { value: "1", label: "Mon" }, { value: "2", label: "Tue" }, { value: "3", label: "Wed" }, { value: "4", label: "Thu" }, { value: "5", label: "Fri" }, { value: "6", label: "Sat" }, { value: "0", label: "Sun" },
];

export type ClusterRecurrenceValue = { frequency: "none" | "daily" | "weekly" | "monthly"; interval: number; weekdays: string[] };

export function ClusterRecurrenceBuilder({ value, onChange, label = "Recurrence", disabled = false }: { value: ClusterRecurrenceValue; onChange: (value: ClusterRecurrenceValue) => void; label?: string; disabled?: boolean }) {
  const frequency = value.frequency;
  const interval = Number.isFinite(value.interval) ? Math.max(1, Math.min(99, Math.floor(value.interval))) : 1;
  return <div className="cluster-field-v425" aria-label={label}>
    <span className="cluster-field-label-v425"><span>{label}</span></span>
    <ClusterSegmentedControl value={frequency} disabled={disabled} label={`${label} frequency`} onChange={(next) => onChange({ ...value, frequency: next })} options={[{ value: "none", label: "Never" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
    {frequency !== "none" ? <ClusterField label="Repeat every"><ClusterInput type="number" inputMode="numeric" min={1} max={99} value={interval} disabled={disabled} onChange={(event) => onChange({ ...value, interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })} aria-label="Recurrence interval" /></ClusterField> : null}
    {frequency === "weekly" ? <ClusterMultiSelect values={value.weekdays} onChange={(weekdays) => onChange({ ...value, weekdays })} options={WEEKDAYS} ariaLabel="Repeat on weekdays" placeholder="Choose weekdays" searchPlaceholder="Search weekdays" disabled={disabled} /> : null}
  </div>;
}

import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton } from "./ClusterButton";

type ClusterAssetName = "chevron-up" | "chevron-down" | "plus" | "minus" | "spark";

export function ClusterAssetIcon({ name }: { name: ClusterAssetName }) {
  return <ClusterIcon className="cluster-asset-icon-v110" name={name} />;
}

type NumberStepperProps = {
  value: string | number;
  onValueChange: (value: string) => void;
  min?: number; max?: number; step?: number; placeholder?: string; ariaLabel?: string; className?: string; disabled?: boolean;
};

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

function numberPrecision(value: number) {
  const [, decimals = ""] = String(value).split(".");
  return decimals.length;
}

function normalizeNumberInput(raw: string) {
  const value = raw.replace(/[^0-9.-]/g, "");
  if (!value || value === "-" || value === "." || value === "-.") return value;
  const parts = value.split(".");
  const signed = parts[0].replace(/(?!^)-/g, "");
  return parts.length > 1 ? `${signed}.${parts.slice(1).join("")}` : signed;
}

export function NumberStepper({ value, onValueChange, min, max, step = 1, placeholder, ariaLabel, className = "", disabled = false }: NumberStepperProps) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  const stepSize = Number.isFinite(step) && step > 0 ? step : 1;
  const precision = numberPrecision(stepSize);
  const commitValue = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = clampNumber(parsed, min, max);
    onValueChange(String(Number(next.toFixed(precision))));
  };
  const bump = (direction: 1 | -1) => {
    const parsed = Number(stringValue);
    const base = Number.isFinite(parsed) ? parsed : (typeof min === "number" ? min : 0);
    const next = clampNumber(base + stepSize * direction, min, max);
    onValueChange(String(Number(next.toFixed(precision))));
  };
  return <div className={`number-stepper-v110 ${className}`.trim()}>
    <ClusterTextInput type="text" inputMode={precision ? "decimal" : "numeric"} value={stringValue} placeholder={placeholder} aria-label={ariaLabel || "Number value"} disabled={disabled}
      onChange={(event) => onValueChange(normalizeNumberInput(event.target.value))}
      onBlur={(event) => commitValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); bump(1); } if (event.key === "ArrowDown") { event.preventDefault(); bump(-1); } }} />
    <div className="number-stepper-controls-v110" aria-hidden="true">
      <ClusterButton unstyled type="button" tabIndex={-1} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => bump(1)} aria-label="Increase"><ClusterAssetIcon name="chevron-up" /></ClusterButton>
      <ClusterButton unstyled type="button" tabIndex={-1} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => bump(-1)} aria-label="Decrease"><ClusterAssetIcon name="chevron-down" /></ClusterButton>
    </div>
  </div>;
}

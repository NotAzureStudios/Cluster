import { type Ref } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterTextInput } from "./ClusterTextInput";
import "./cluster-pin-entry.css";

/** One keyboard/touch accessible PIN entry used by authenticated and signed-out actions. */
export function ClusterPinEntry({ value, onChange, disabled = false, inputRef, label = "Security PIN", onEnter }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  label?: string;
  onEnter?: () => void;
}) {
  const append = (digit: string) => onChange((value + digit).slice(0, 8));
  return <div className="cluster-pin-entry-v124">
    <ClusterTextInput
      ref={inputRef} className="cluster-pin-physical-input-v124"
      type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
      aria-label={label} disabled={disabled} value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
      onKeyDown={(event) => { if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); } }}
    />
    <div className="cluster-pin-dots-v124" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} className={index < value.length ? "filled" : ""} />)}
    </div>
    <div className="cluster-pin-keypad-v124" role="group" aria-label="PIN keypad">
      {Array.from({ length: 9 }, (_, index) => <ClusterButton unstyled key={index} type="button" disabled={disabled || value.length >= 8} onClick={() => append(String(index + 1))}>{index + 1}</ClusterButton>)}
      <ClusterButton unstyled type="button" className="cluster-pin-secondary-v124" disabled={disabled || !value.length} onClick={() => onChange("")} aria-label="Clear PIN">Clear</ClusterButton>
      <ClusterButton unstyled type="button" disabled={disabled || value.length >= 8} onClick={() => append("0")}>0</ClusterButton>
      <ClusterButton unstyled type="button" className="cluster-pin-secondary-v124" disabled={disabled || !value.length} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit">⌫</ClusterButton>
    </div>
  </div>;
}

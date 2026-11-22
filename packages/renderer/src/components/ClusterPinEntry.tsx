import { useEffect, useRef, type Ref } from "react";
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
  const physicalInput = useRef<HTMLInputElement>(null);
  const assignInputRef = (node: HTMLInputElement | null) => {
    physicalInput.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };
  const focusInput = () => physicalInput.current?.focus({ preventScroll: true });
  const append = (digit: string) => {
    if (disabled || value.length >= 8) return;
    onChange((value + digit).slice(0, 8));
    focusInput();
  };
  const erase = () => {
    if (!disabled) onChange(value.slice(0, -1));
    focusInput();
  };
  const clear = () => {
    if (!disabled) onChange("");
    focusInput();
  };
  // Digits typed anywhere in the dialog edit the PIN: focus may sit on a
  // keypad key or the close button, and a hardware keyboard should still work.
  const latest = useRef({ append, erase, clear, disabled });
  latest.current = { append, erase, clear, disabled };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const { disabled: off, append: add, erase: back, clear: wipe } = latest.current;
      const target = event.target as HTMLElement | null;
      if (off || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target === physicalInput.current) return;
      if (target && (target.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && target !== physicalInput.current))) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); add(event.key); }
      else if (event.key === "Backspace") { event.preventDefault(); back(); }
      else if (event.key === "Delete") { event.preventDefault(); wipe(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  // Show at least four places, growing with the PIN up to eight.
  const places = Math.min(8, Math.max(4, value.length + (value.length >= 4 && value.length < 8 ? 1 : 0)));
  return <div className="cluster-pin-entry-v124">
    <ClusterTextInput
      ref={assignInputRef} className="cluster-pin-physical-input-v124"
      type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off"
      aria-label={label} disabled={disabled} value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
      onKeyDown={(event) => { if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); } }}
    />
    <div className="cluster-pin-dots-v124" aria-hidden="true">
      {Array.from({ length: places }, (_, index) => <span key={index} className={index < value.length ? "filled" : ""} />)}
    </div>
    <div className="cluster-pin-keypad-v124" role="group" aria-label="PIN keypad">
      {Array.from({ length: 9 }, (_, index) => <ClusterButton unstyled key={index} type="button" disabled={disabled || value.length >= 8} onClick={() => append(String(index + 1))}>{index + 1}</ClusterButton>)}
      <ClusterButton unstyled type="button" className="cluster-pin-secondary-v124" disabled={disabled || !value.length} onClick={clear} aria-label="Clear PIN">Clear</ClusterButton>
      <ClusterButton unstyled type="button" disabled={disabled || value.length >= 8} onClick={() => append("0")}>0</ClusterButton>
      <ClusterButton unstyled type="button" className="cluster-pin-secondary-v124" disabled={disabled || !value.length} onClick={erase} aria-label="Delete last digit">⌫</ClusterButton>
    </div>
  </div>;
}

import { useEffect, useId, useRef, useState } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { ClusterIcon } from "./ClusterIcon";
import { edgeClusterActiveValue, moveClusterActiveValue, resolveClusterActiveValue } from "./cluster-listbox-navigation";

export type ClusterSelectOption = { value: string; label: string; disabled?: boolean; meta?: string };

export function ClusterSelect({ value, options, onChange, ariaLabel, placeholder = "Select", disabled = false, className = "" }: { value: string; options: ClusterSelectOption[]; onChange: (value: string) => void; ariaLabel: string; placeholder?: string; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const optionIdPrefix = useId();
  const selected = options.find((option) => option.value === value);
  const activeIndex = options.findIndex((option) => option.value === activeValue && !option.disabled);
  const hasEnabled = options.some((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    if (disabled || !hasEnabled) { setOpen(false); return; }
    const resolved = resolveClusterActiveValue(options, activeValue, value);
    if (resolved !== activeValue) setActiveValue(resolved);
  }, [open, disabled, hasEnabled, options, activeValue, value]);

  function closeAndRestore() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeAndRestore();
  }

  function openFromTrigger(direction?: 1 | -1, edge?: "first" | "last") {
    if (disabled || !hasEnabled) return;
    const initial = resolveClusterActiveValue(options, null, value);
    setActiveValue(edge ? edgeClusterActiveValue(options, edge) : direction ? moveClusterActiveValue(options, initial, direction) : initial);
    setOpen(true);
  }

  return <div data-cluster-state={disabled ? "disabled" : open ? "selected" : "default"} className={`cluster-select-v227 ${open ? "open" : ""} ${className}`.trim()}>
    <ClusterButton unstyled
      ref={triggerRef}
      type="button"
      className="cluster-select-trigger-v227"
      disabled={disabled || !hasEnabled}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      data-cluster-state={disabled ? "disabled" : open ? "selected" : "default"}
      onClick={() => open ? setOpen(false) : openFromTrigger()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); open ? setActiveValue((current) => moveClusterActiveValue(options, current, 1)) : openFromTrigger(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); open ? setActiveValue((current) => moveClusterActiveValue(options, current, -1)) : openFromTrigger(-1); }
        if (event.key === "Home") { event.preventDefault(); openFromTrigger(undefined, "first"); }
        if (event.key === "End") { event.preventDefault(); openFromTrigger(undefined, "last"); }
      }}
    >
      <span>{selected?.label || placeholder}</span>{selected?.meta && <em>{selected.meta}</em>}<ClusterIcon name="chevron-down" aria-hidden="true" />
    </ClusterButton>
    <ClusterFloatingSurface
      open={open}
      anchorRef={triggerRef}
      surfaceRef={listRef}
      id={listId}
      role="listbox"
      label={ariaLabel}
      placement="bottom-start"
      mobileMode="sheet"
      matchAnchorWidth
      autoFocus="surface"
      className="cluster-select-menu-v227"
      aria-activedescendant={activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined}
      onDismiss={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActiveValue((current) => moveClusterActiveValue(options, current, 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActiveValue((current) => moveClusterActiveValue(options, current, -1)); }
        if (event.key === "Home") { event.preventDefault(); setActiveValue(edgeClusterActiveValue(options, "first")); }
        if (event.key === "End") { event.preventDefault(); setActiveValue(edgeClusterActiveValue(options, "last")); }
        if ((event.key === "Enter" || event.key === " ") && activeIndex >= 0) { event.preventDefault(); choose(activeIndex); }
        if (event.key === "Tab") setOpen(false);
      }}
    >
      {options.map((option, index) => <div
        id={`${optionIdPrefix}-${index}`}
        key={option.value}
        role="option"
        aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        data-cluster-state={option.disabled ? "disabled" : option.value === value ? "selected" : index === activeIndex ? "focus" : "default"}
        className={`cluster-select-option-v370 ${option.value === value ? "active" : ""} ${index === activeIndex ? "highlighted" : ""} ${option.disabled ? "disabled" : ""}`.trim()}
        onPointerMove={() => !option.disabled && setActiveValue(option.value)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}
      ><span>{option.label}</span>{option.meta && <em>{option.meta}</em>}{option.value === value && <ClusterIcon name="check" aria-hidden="true" />}</div>)}
    </ClusterFloatingSurface>
  </div>;
}

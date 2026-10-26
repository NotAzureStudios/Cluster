import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterInput } from "./ClusterNativeControls";
import { edgeClusterActiveValue, moveClusterActiveValue, resolveClusterActiveValue } from "./cluster-listbox-navigation";

export type ClusterComboboxOption = {
  value: string;
  label: string;
  meta?: string;
  disabled?: boolean;
  group?: string;
};

export function ClusterCombobox({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select",
  searchPlaceholder = "Search options",
  emptyMessage = "No matching options",
  disabled = false,
  allowClear = false,
  clearLabel = "Clear selection",
  className = "",
  renderSelection,
  onSearchChange,
}: {
  value: string;
  options: readonly ClusterComboboxOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  className?: string;
  renderSelection?: (option: ClusterComboboxOption | undefined) => ReactNode;
  onSearchChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const optionId = useId();
  const resultsId = useId();
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => !normalized || `${option.label} ${option.meta || ""} ${option.group || ""}`.toLowerCase().includes(normalized));
  }, [options, query]);
  const activeIndex = visible.findIndex((option) => option.value === activeValue && !option.disabled);
  const hasEnabled = options.some((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); setQuery(""); onSearchChange?.(""); return; }
    const resolved = resolveClusterActiveValue(visible, activeValue, value);
    if (resolved !== activeValue) setActiveValue(resolved);
  }, [open, disabled, visible, activeValue, value, onSearchChange]);

  function close() {
    setOpen(false);
    setQuery("");
    onSearchChange?.("");
    window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }

  function choose(option: ClusterComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    close();
  }

  function move(direction: 1 | -1) {
    setActiveValue((current) => moveClusterActiveValue(visible, current, direction));
  }

  function openFromTrigger(direction?: 1 | -1, edge?: "first" | "last") {
    if (disabled || (!hasEnabled && !onSearchChange)) return;
    const initial = resolveClusterActiveValue(visible, null, value);
    setActiveValue(edge ? edgeClusterActiveValue(visible, edge) : direction ? moveClusterActiveValue(visible, initial, direction) : initial);
    setOpen(true);
  }

  return (
    <div data-cluster-state={disabled ? "disabled" : open ? "selected" : "default"} className={`cluster-select-v227 ${open ? "open" : ""} ${className}`.trim()}>
      <ClusterButton
        unstyled
        ref={triggerRef}
        className="cluster-select-trigger-v227"
        disabled={disabled || (!hasEnabled && !onSearchChange)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => open ? close() : openFromTrigger()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); open ? move(1) : openFromTrigger(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); open ? move(-1) : openFromTrigger(-1); }
          if (event.key === "Home") { event.preventDefault(); openFromTrigger(undefined, "first"); }
          if (event.key === "End") { event.preventDefault(); openFromTrigger(undefined, "last"); }
        }}
      >
        <span>{renderSelection ? renderSelection(selected) : selected?.label || placeholder}</span>
        {!renderSelection && selected?.meta ? <em>{selected.meta}</em> : null}
        <ClusterIcon name="chevron-down" aria-hidden="true" />
      </ClusterButton>
      <ClusterFloatingSurface
        open={open}
        anchorRef={triggerRef}
        surfaceRef={surfaceRef}
        id={listId}
        label={ariaLabel}
        role="dialog"
        placement="bottom-start"
        mobileMode="sheet"
        matchAnchorWidth
        autoFocus="first"
        className="cluster-select-menu-v227"
        onDismiss={() => { setOpen(false); setQuery(""); onSearchChange?.(""); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
          if (event.key === "Home" && event.target !== searchRef.current) { event.preventDefault(); setActiveValue(edgeClusterActiveValue(visible, "first")); }
          if (event.key === "End" && event.target !== searchRef.current) { event.preventDefault(); setActiveValue(edgeClusterActiveValue(visible, "last")); }
          if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && activeIndex >= 0) {
            event.preventDefault();
            const option = visible[activeIndex];
            if (option) choose(option);
          }
        }}
      >
        <div className="cluster-field-v425">
          <ClusterInput ref={searchRef} type="search" role="combobox" aria-expanded="true" aria-controls={resultsId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 ? `${optionId}-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); onSearchChange?.(event.target.value); }} placeholder={searchPlaceholder} aria-label={`Search ${ariaLabel.toLowerCase()}`} autoComplete="off" />
        </div>
        <div id={resultsId} role="listbox" aria-label={ariaLabel}>
          {visible.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                id={`${optionId}-${index}`}
                key={option.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-cluster-state={option.disabled ? "disabled" : isSelected ? "selected" : index === activeIndex ? "focus" : "default"}
                className={`cluster-select-option-v370 ${isSelected ? "active" : ""} ${index === activeIndex ? "highlighted" : ""} ${option.disabled ? "disabled" : ""}`.trim()}
                onPointerMove={() => !option.disabled && setActiveValue(option.value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>{option.meta ? <em>{option.meta}</em> : null}{isSelected ? <ClusterIcon name="check" aria-hidden="true" /> : null}
              </div>
            );
          })}
          {!visible.length ? <div className="cluster-select-option-v370" aria-disabled="true">{emptyMessage}</div> : null}
        </div>
        {allowClear && value ? <ClusterButton size="compact" variant="quiet" onClick={() => { onChange(""); close(); }}>{clearLabel}</ClusterButton> : null}
      </ClusterFloatingSurface>
    </div>
  );
}

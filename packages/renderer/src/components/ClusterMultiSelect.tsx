import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterInput } from "./ClusterNativeControls";
import { edgeClusterActiveValue, moveClusterActiveValue, resolveClusterActiveValue } from "./cluster-listbox-navigation";

export type ClusterMultiSelectOption = {
  value: string;
  label: string;
  meta?: string;
  disabled?: boolean;
  group?: string;
};

export function ClusterMultiSelect({
  values,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select",
  searchPlaceholder = "Search options",
  disabled = false,
  searchable = true,
  className = "",
}: {
  values: readonly string[];
  options: readonly ClusterMultiSelectOption[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
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
  const selected = useMemo(() => new Set(values), [values]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => !normalized || `${option.label} ${option.meta || ""} ${option.group || ""}`.toLowerCase().includes(normalized));
  }, [options, query]);
  const activeIndex = visible.findIndex((option) => option.value === activeValue && !option.disabled);
  const hasEnabled = options.some((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); setQuery(""); return; }
    const resolved = resolveClusterActiveValue(visible, activeValue);
    if (resolved !== activeValue) setActiveValue(resolved);
  }, [open, disabled, visible, activeValue]);

  function move(direction: 1 | -1) {
    setActiveValue((current) => moveClusterActiveValue(visible, current, direction));
  }

  function close() {
    setOpen(false);
    setQuery("");
    window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }

  function toggle(option: ClusterMultiSelectOption) {
    if (option.disabled) return;
    onChange(selected.has(option.value) ? values.filter((value) => value !== option.value) : [...values, option.value]);
  }

  const selectedOptions = options.filter((option) => selected.has(option.value));
  const triggerLabel = selectedOptions.length === 0
    ? placeholder
    : selectedOptions.length <= 2
      ? selectedOptions.map((option) => option.label).join(", ")
      : `${selectedOptions[0]?.label || "Selected"} +${selectedOptions.length - 1}`;

  return (
    <div data-cluster-state={disabled ? "disabled" : open ? "selected" : "default"} className={`cluster-select-v227 ${open ? "open" : ""} ${className}`.trim()}>
      <ClusterButton
        unstyled
        ref={triggerRef}
        type="button"
        className="cluster-select-trigger-v227"
        disabled={disabled || (!options.length && !values.length)}
        aria-label={`${ariaLabel}${selectedOptions.length ? `, ${selectedOptions.length} selected` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-cluster-state={disabled ? "disabled" : open ? "selected" : "default"}
        onClick={() => { if (open) close(); else { setActiveValue(resolveClusterActiveValue(visible, null)); setOpen(true); } }}
      >
        <span>{triggerLabel}</span>
        <em>{selectedOptions.length ? `${selectedOptions.length} selected` : undefined}</em>
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
        autoFocus={searchable ? "first" : "surface"}
        className="cluster-select-menu-v227"
        onDismiss={() => { setOpen(false); setQuery(""); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
          if (event.key === "Home" && event.target !== searchRef.current) { event.preventDefault(); setActiveValue(edgeClusterActiveValue(visible, "first")); }
          if (event.key === "End" && event.target !== searchRef.current) { event.preventDefault(); setActiveValue(edgeClusterActiveValue(visible, "last")); }
          if ((event.key === "Enter" || (event.key === " " && document.activeElement !== searchRef.current)) && !(event.target instanceof HTMLButtonElement) && activeIndex >= 0) {
            event.preventDefault();
            const option = visible[activeIndex];
            if (option) toggle(option);
          }
        }}
      >
        {searchable ? (
          <div className="cluster-field-v425">
            <ClusterInput ref={searchRef} type="search" role="combobox" aria-expanded="true" aria-controls={resultsId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 ? `${optionId}-${activeIndex}` : undefined} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`Search ${ariaLabel.toLowerCase()}`} autoComplete="off" />
          </div>
        ) : null}
        <div id={resultsId} role="listbox" aria-label={ariaLabel} aria-multiselectable="true">
          {visible.map((option, index) => {
            const isSelected = selected.has(option.value);
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
                onClick={() => toggle(option)}
              >
                <span>{option.label}</span>{option.meta && <em>{option.meta}</em>}{isSelected && <ClusterIcon name="check" aria-hidden="true" />}
              </div>
            );
          })}
          {!visible.length ? <div className="cluster-select-option-v370" aria-disabled="true">No matching options</div> : null}
        </div>
        <div className="cluster-action-group-v425" role="group" aria-label={`${ariaLabel} actions`}>
          {values.length ? <ClusterButton size="compact" variant="quiet" onClick={() => onChange([])}>Clear selection</ClusterButton> : null}
          <ClusterButton size="compact" variant="secondary" onClick={close}>Done</ClusterButton>
        </div>
      </ClusterFloatingSurface>
    </div>
  );
}

import { useRef, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { ClusterActionGroup, ClusterIconButton } from "./ClusterButton";
import { ClusterFilterBar } from "./ClusterFilterBar";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterToolbar } from "./ClusterToolbar";

export type ClusterTableToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  countLabel: string;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  onSearchKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  searchLabel?: string;
  clearLabel?: string;
  shortcut?: string;
  label?: string;
};

export function ClusterTableToolbar({
  query,
  onQueryChange,
  placeholder,
  countLabel,
  filters,
  actions,
  className = "",
  inputRef,
  onSearchKeyDown,
  searchLabel = "Search",
  clearLabel = "Clear search",
  shortcut,
  label = "Table controls",
}: ClusterTableToolbarProps) {
  const searchRootRef = useRef<HTMLLabelElement>(null);
  const focusSearch = () => searchRootRef.current?.querySelector("input")?.focus({ preventScroll: true });
  return (
    <ClusterToolbar label={label} role="search" className={`cluster-data-toolbar-v289 cluster-table-toolbar-v537 cluster-toolbar-v391 ${className}`.trim()}>
      <label ref={searchRootRef} className="cluster-data-search-v289">
        <span className="sr-only-v204">{searchLabel}</span>
        <ClusterIcon name="search" />
        <ClusterTextInput
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            onSearchKeyDown?.(event);
            if (!event.defaultPrevented && event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              onQueryChange("");
            }
          }}
          placeholder={placeholder}
          aria-label={searchLabel}
          autoComplete="off"
          spellCheck={false}
        />
        {query ? <ClusterIconButton label={clearLabel} size="compact" onClick={() => { onQueryChange(""); focusSearch(); }}><ClusterIcon name="close" /></ClusterIconButton> : shortcut ? <kbd className="cluster-data-shortcut-v495" aria-hidden="true">{shortcut}</kbd> : null}
      </label>
      {filters ? <ClusterFilterBar label={`${label} filters`}>{filters}</ClusterFilterBar> : null}
      <output className="cluster-data-count-v289" aria-live="polite">{countLabel}</output>
      {actions ? <ClusterActionGroup label={`${label} actions`} className="cluster-data-actions-v289">{actions}</ClusterActionGroup> : null}
    </ClusterToolbar>
  );
}

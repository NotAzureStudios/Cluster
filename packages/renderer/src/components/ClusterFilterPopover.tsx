import { useId, useRef, useState, type ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { ClusterIcon } from "./ClusterIcon";

/** A scoped, body-portaled filter panel. Unlike inline <details>, its layer, Escape,
 * outside click, mobile sheet and focus return follow Cluster's overlay authority. */
export function ClusterFilterPopover({
  label,
  count = 0,
  children,
  className = "",
  panelClassName = "",
}: {
  label: string;
  count?: number;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return <div className={`cluster-filter-popover-v547 ${className}`.trim()}>
    <ClusterButton unstyled ref={triggerRef} type="button" className="cluster-filter-popover-trigger-v547"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen((current) => !current)}>
      <span>{label}</span>{count > 0 ? <span className="cluster-filter-count-v547" aria-label={`${count} additional filters active`}>{count}</span> : null}
      <ClusterIcon name="chevron-down" aria-hidden="true" />
    </ClusterButton>
    <ClusterFloatingSurface open={open} anchorRef={triggerRef} id={id}
      label={`${label} controls`} placement="bottom-end" mobileMode="sheet"
      autoFocus="first" autoFocusSelector="select:not(:disabled), input:not(:disabled), button:not(:disabled)" className={`cluster-filter-popover-panel-v547 ${panelClassName}`.trim()}
      onDismiss={() => setOpen(false)}>
      {children}
      <div className="cluster-filter-popover-actions-v547"><ClusterButton variant="quiet" size="compact" onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }}>Close filters</ClusterButton></div>
    </ClusterFloatingSurface>
  </div>;
}

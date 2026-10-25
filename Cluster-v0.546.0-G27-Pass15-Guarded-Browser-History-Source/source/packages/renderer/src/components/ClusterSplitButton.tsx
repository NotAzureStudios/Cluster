import { useEffect, useId, useRef, useState } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { focusMenuItem } from "./cluster-menu-navigation";
import { ClusterIcon } from "./ClusterIcon";
import { useClusterMenuExecution } from "./useClusterMenuExecution";
import type { ClusterMenuAction } from "./cluster-menu-action-outcome";

export type ClusterSplitButtonAction = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect: ClusterMenuAction;
};

export function ClusterSplitButton({
  label,
  onPrimary,
  actions,
  disabled = false,
  variant = "primary",
  size = "default",
}: {
  label: string;
  onPrimary: ClusterMenuAction;
  actions: readonly ClusterSplitButtonAction[];
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "default" | "compact";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionExecution = useClusterMenuExecution();
  useEffect(() => { if (disabled || actions.length === 0) setOpen(false); }, [disabled, actions.length]);
  return (
    <div className="cluster-action-group-v425" role="group" aria-label={`${label} actions`}>
      <ClusterButton variant={variant} size={size} disabled={disabled || actionExecution.busy} aria-busy={actionExecution.pendingId === "__primary__"} onClick={() => actionExecution.execute("__primary__", onPrimary, () => undefined)}>{label}</ClusterButton>
      <ClusterButton ref={triggerRef} variant={variant} size={size} disabled={disabled || actionExecution.busy || actions.length === 0} aria-label={`More ${label} options`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!actionExecution.isExecuting()) setOpen((current) => !current); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}><ClusterIcon name="chevron-down" /></ClusterButton>
      <ClusterFloatingSurface open={open} anchorRef={triggerRef} surfaceRef={menuRef} id={id} role="menu" label={`${label} options`} placement="bottom-end" mobileMode="sheet" autoFocus="first" autoFocusSelector={'button[role="menuitem"]:not(:disabled)'} className="cluster-action-menu-panel-v428" onKeyDown={(event) => { if (focusMenuItem(menuRef.current, event.key)) event.preventDefault(); }} canDismiss={() => !actionExecution.isExecuting()} onDismiss={() => { if (!actionExecution.busy && !actionExecution.isExecuting()) setOpen(false); }}>
        {actions.map((action) => <div key={action.id} className="cluster-action-menu-entry-v428"><ClusterButton unstyled role="menuitem" disabled={action.disabled || actionExecution.busy} aria-busy={actionExecution.pendingId === action.id} onClick={() => actionExecution.execute(action.id, action.onSelect, () => setOpen(false))}><span><strong>{action.label}</strong>{action.description ? <small>{action.description}</small> : null}</span></ClusterButton></div>)}
        {actionExecution.error ? <p role="alert" className="cluster-menu-execution-error">{actionExecution.error}</p> : null}
      </ClusterFloatingSurface>
      {!open && actionExecution.error ? <span role="alert" className="cluster-menu-execution-error">{actionExecution.error}</span> : null}
    </div>
  );
}

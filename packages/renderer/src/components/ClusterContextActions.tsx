import { useId, useRef, useState, type ReactNode } from "react";
import { ClusterActionGroup, ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import { ClusterToolbar } from "./ClusterToolbar";
import { confirmCluster } from "./cluster-dialog-service";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { focusMenuItem, actionMenuSeparatorBefore } from "./cluster-menu-navigation";
import { useClusterMenuExecution } from "./useClusterMenuExecution";
import type { ClusterMenuAction } from "./cluster-menu-action-outcome";
import { useClusterHistoryExecution } from "./useClusterHistoryExecution";

export type ClusterActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ClusterIconName;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: ClusterMenuAction;
};

export function ClusterActionMenu({
  label,
  items,
  triggerLabel = "More",
  iconOnly = false,
  align = "end",
  className = "",
}: {
  label: string;
  items: ClusterActionMenuItem[];
  triggerLabel?: string;
  iconOnly?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actionExecution = useClusterMenuExecution();

  const triggerProps = {
    ref: triggerRef,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    onClick: () => { if (!actionExecution.isExecuting()) setOpen((value) => !value); },
  };

  return (
    <div className={`cluster-action-menu-v428 align-${align} ${className}`.trim()}>
      {iconOnly ? (
        <ClusterIconButton {...triggerProps} disabled={actionExecution.busy} label={label} size="compact"><ClusterIcon name="more" /></ClusterIconButton>
      ) : (
        <ClusterButton {...triggerProps} disabled={actionExecution.busy} variant="secondary" size="compact"><ClusterIcon name="more" />{triggerLabel}</ClusterButton>
      )}
      <ClusterFloatingSurface
        open={open}
        anchorRef={triggerRef}
        surfaceRef={menuRef}
        id={id}
        role="menu"
        label={label}
        placement={align === "end" ? "bottom-end" : "bottom-start"}
        mobileMode="sheet"
        autoFocus="first"
        autoFocusSelector={'button[role="menuitem"]:not(:disabled)'}
        className="cluster-action-menu-panel-v428"
        canDismiss={() => !actionExecution.isExecuting()}
        onDismiss={() => { if (!actionExecution.busy && !actionExecution.isExecuting()) setOpen(false); }}
        onKeyDown={(event) => { if (focusMenuItem(menuRef.current, event.key)) event.preventDefault(); }}
      >
        {items.map((item, index) => (
          <div key={item.id} className="cluster-action-menu-entry-v428">
            {actionMenuSeparatorBefore(items, index) ? <div role="separator" className="cluster-action-menu-separator-v428" /> : null}
            <ClusterButton unstyled
              type="button"
              role="menuitem"
              disabled={item.disabled || actionExecution.busy}
              aria-busy={actionExecution.pendingId === item.id}
              className={item.danger ? "danger" : ""}
              onClick={() => actionExecution.execute(item.id, item.onSelect, () => setOpen(false))}
            >
              {item.icon ? <ClusterIcon name={item.icon} /> : null}
              <span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
            </ClusterButton>
          </div>
        ))}
        {actionExecution.error ? <p role="alert" className="cluster-menu-execution-error">{actionExecution.error}</p> : null}
      </ClusterFloatingSurface>
    </div>
  );
}

export function ClusterBulkActionBar({ selectionCount, label, onClear, className = "", children }: { selectionCount: number; label: string; onClear?: () => void; className?: string; children: ReactNode }) {
  if (selectionCount <= 0) return null;
  return (
    <ClusterToolbar label={label} className={`cluster-bulk-action-bar-v428 ${className}`.trim()}>
      <div className="cluster-bulk-selection-v428" aria-live="polite"><strong>{selectionCount}</strong><span>selected</span></div>
      <ClusterActionGroup label={label} className="cluster-bulk-actions-v428">{children}</ClusterActionGroup>
      {onClear ? <ClusterButton variant="quiet" size="compact" onClick={onClear}>Clear selection</ClusterButton> : null}
    </ClusterToolbar>
  );
}

export function ClusterUndoBar({ message, onUndo, onDismiss, className = "" }: { message: string; onUndo: () => void | Promise<void>; onDismiss?: () => void; className?: string }) {
  const history = useClusterHistoryExecution();
  return (
    <div className={`cluster-undo-bar-v428 ${className}`.trim()} role="status">
      <span>{message}</span>
      <ClusterActionGroup label="Recovery actions">
        <ClusterButton size="compact" busy={history.busy} onClick={() => history.execute(onUndo)}>Undo</ClusterButton>
        {onDismiss ? <ClusterIconButton label="Dismiss recovery message" size="compact" disabled={history.busy} onClick={() => { if (!history.isExecuting()) onDismiss(); }}><ClusterIcon name="close" /></ClusterIconButton> : null}
      </ClusterActionGroup>
      {history.error ? <span role="alert" className="cluster-history-error-v547">{history.error}</span> : null}
    </div>
  );
}

export function ClusterHistoryActions({
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  className = "",
}: {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
  className?: string;
}) {
  const history = useClusterHistoryExecution();
  return (
    <div className="cluster-history-action-shell-v547">
    <ClusterActionGroup label="History actions" className={className}>
      <ClusterButton variant="quiet" size="compact" disabled={!canUndo || history.busy} title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"} onClick={() => history.execute(onUndo)}>Undo</ClusterButton>
      <ClusterButton variant="quiet" size="compact" disabled={!canRedo || history.busy} title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"} onClick={() => history.execute(onRedo)}>Redo</ClusterButton>
    </ClusterActionGroup>
    {history.error ? <span role="alert" className="cluster-history-error-v547">{history.error}</span> : null}
    </div>
  );
}


export type ClusterBulkActionResult = {
  applied: number;
  skipped?: number;
  failed?: number;
  message?: string;
};

export function ClusterBulkActionFeedback({ result, className = "" }: { result: ClusterBulkActionResult | null; className?: string }) {
  if (!result) return null;
  const skipped = Math.max(0, result.skipped || 0);
  const failed = Math.max(0, result.failed || 0);
  const summary = result.message || `${result.applied} updated${skipped ? ` · ${skipped} skipped` : ""}${failed ? ` · ${failed} failed` : ""}.`;
  return <div className={`cluster-undo-bar-v428 ${className}`.trim()} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}><span>{summary}</span></div>;
}

export function ClusterRowActions({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <ClusterActionGroup label={label} className={`cluster-row-actions-v428 ${className}`.trim()}>{children}</ClusterActionGroup>;
}

export async function confirmDestructiveAction({
  title,
  message,
  confirmLabel = "Delete",
}: {
  title: string;
  message: string;
  confirmLabel?: string;
}) {
  return confirmCluster({
    title,
    message,
    confirmLabel,
    tone: "danger",
  });
}

export function ClusterRecoveryNotice({
  message,
  actionLabel = "Undo",
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel?: string;
  onAction: () => void | Promise<void>;
  onDismiss?: () => void;
}) {
  const history = useClusterHistoryExecution();
  return (
    <div className="cluster-undo-bar-v428 cluster-recovery-notice-v496" role="status" aria-live="polite">
      <span>{message}</span>
      <ClusterActionGroup label="Recovery actions">
        <ClusterButton size="compact" busy={history.busy} disabled={history.busy} onClick={() => history.execute(onAction)}>{actionLabel}</ClusterButton>
        {onDismiss ? <ClusterIconButton label="Dismiss recovery message" size="compact" disabled={history.busy} onClick={() => { if (!history.isExecuting()) onDismiss(); }}><ClusterIcon name="close" /></ClusterIconButton> : null}
      </ClusterActionGroup>
      {history.error ? <span role="alert" className="cluster-history-error-v547">{history.error}</span> : null}
    </div>
  );
}

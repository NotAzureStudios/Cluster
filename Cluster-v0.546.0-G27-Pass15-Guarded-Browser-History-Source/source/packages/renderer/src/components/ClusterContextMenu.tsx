import { useEffect, useId, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { focusMenuItem, actionMenuSeparatorBefore, movedBeyondLongPress } from "./cluster-menu-navigation";
import { ClusterIcon } from "./ClusterIcon";
import { useClusterMenuExecution } from "./useClusterMenuExecution";
import type { ClusterActionMenuItem } from "./ClusterContextActions";

export function useClusterContextMenu<T extends HTMLElement = HTMLElement>({ disabled = false, longPressMs = 560 }: { disabled?: boolean; longPressMs?: number } = {}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<T | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);
  const id = useId();
  const clearLongPress = () => {
    if (longPressRef.current != null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
    longPressOriginRef.current = null;
  };
  const resetClickSuppression = () => {
    suppressNextClickRef.current = false;
    if (suppressResetTimerRef.current != null) window.clearTimeout(suppressResetTimerRef.current);
    suppressResetTimerRef.current = null;
  };
  useEffect(() => {
    if (disabled) { clearLongPress(); resetClickSuppression(); }
    return () => { clearLongPress(); resetClickSuppression(); };
  }, [disabled]);
  const openMenu = () => { if (!disabled) setOpen(true); };
  const targetProps: Pick<HTMLAttributes<T>, "onContextMenu" | "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onPointerMove" | "onPointerLeave" | "onKeyDown" | "onClickCapture"> & Record<string, unknown> = {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    onContextMenu: (event) => { if (!disabled) { event.preventDefault(); openMenu(); } },
    onPointerDown: (event: ReactPointerEvent<T>) => {
      clearLongPress();
      resetClickSuppression();
      if (disabled || event.pointerType === "mouse") return;
      longPressOriginRef.current = { x: event.clientX, y: event.clientY };
      longPressRef.current = window.setTimeout(() => {
        clearLongPress();
        // Browsers can synthesize a click after the long-press pointerup.
        // That click must not also open the underlying card or table row.
        suppressNextClickRef.current = true;
        suppressResetTimerRef.current = window.setTimeout(resetClickSuppression, 900);
        openMenu();
      }, Math.max(300, longPressMs));
    },
    onPointerUp: clearLongPress,
    onPointerCancel: () => { clearLongPress(); resetClickSuppression(); },
    onPointerLeave: clearLongPress,
    onPointerMove: (event: ReactPointerEvent<T>) => {
      if (event.pointerType === "mouse" || longPressRef.current == null || !longPressOriginRef.current) return;
      if (movedBeyondLongPress(longPressOriginRef.current, { x: event.clientX, y: event.clientY })) clearLongPress();
    },
    onClickCapture: (event) => {
      if (!suppressNextClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      resetClickSuppression();
    },
    onKeyDown: (event: ReactKeyboardEvent<T>) => { if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); event.stopPropagation(); openMenu(); } },
  };
  return { id, open, setOpen, openMenu, anchorRef, surfaceRef, targetProps };
}

export function ClusterContextMenuSurface({
  id,
  open,
  label,
  items,
  anchorRef,
  surfaceRef,
  onDismiss,
}: {
  id: string;
  open: boolean;
  label: string;
  items: readonly ClusterActionMenuItem[];
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}) {
  const actionExecution = useClusterMenuExecution();
  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (focusMenuItem(surfaceRef.current, event.key)) event.preventDefault();
  }
  return <ClusterFloatingSurface
    open={open}
    anchorRef={anchorRef}
    surfaceRef={surfaceRef}
    id={id}
    role="menu"
    label={label}
    placement="bottom-start"
    mobileMode="sheet"
    autoFocus="first"
    autoFocusSelector={'button[role="menuitem"]:not(:disabled)'}
    className="cluster-action-menu-panel-v428"
    canDismiss={() => !actionExecution.isExecuting()}
    onDismiss={() => { if (!actionExecution.busy && !actionExecution.isExecuting()) onDismiss(); }}
    onKeyDown={moveFocus}
  >
    {items.map((item, index) => <div key={item.id} className="cluster-action-menu-entry-v428">
      {actionMenuSeparatorBefore(items, index) ? <div role="separator" className="cluster-action-menu-separator-v428" /> : null}
      <ClusterButton unstyled type="button" role="menuitem" disabled={item.disabled || actionExecution.busy} aria-busy={actionExecution.pendingId === item.id} className={item.danger ? "danger" : ""} onClick={() => actionExecution.execute(item.id, item.onSelect, onDismiss)}>
        {item.icon ? <ClusterIcon name={item.icon} /> : null}
        <span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
      </ClusterButton>
    </div>)}
    {actionExecution.error ? <p role="alert" className="cluster-menu-execution-error">{actionExecution.error}</p> : null}
  </ClusterFloatingSurface>;
}

export function ClusterContextMenuRegion({
  label,
  items,
  children,
  className = "",
  disabled = false,
  longPressMs = 560,
}: {
  label: string;
  items: readonly ClusterActionMenuItem[];
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  longPressMs?: number;
}) {
  const menu = useClusterContextMenu<HTMLDivElement>({ disabled: disabled || !items.some((item) => !item.disabled), longPressMs });
  return <div ref={menu.anchorRef} className={className} data-cluster-context-region="true" tabIndex={0} {...menu.targetProps}>
    {children}
    <ClusterContextMenuSurface id={menu.id} open={menu.open} label={label} items={items} anchorRef={menu.anchorRef} surfaceRef={menu.surfaceRef} onDismiss={() => menu.setOpen(false)} />
  </div>;
}

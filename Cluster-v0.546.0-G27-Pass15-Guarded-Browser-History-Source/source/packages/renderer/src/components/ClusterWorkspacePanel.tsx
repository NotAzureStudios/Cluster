import { useRef, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { ClusterActionGroup, ClusterIconButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterResizableSplit } from "./ClusterResizableSplit";
import { useClusterDialogInteraction } from "./useClusterDialogInteraction";

type ClusterPanelElementProps = Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "aria-label">;

export function ClusterPanelHeader({ title, detail, onClose, onDetach, detachLabel = "Open in new window", className = "" }: { title: ReactNode; detail?: ReactNode; onClose?: () => void; onDetach?: () => void; detachLabel?: string; className?: string }) {
  return <header className={`cluster-viewer-drawer-header ${className}`.trim()}>
    <div><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</div>
    {(onDetach || onClose) ? <ClusterActionGroup label="Panel actions">
      {onDetach ? <ClusterIconButton label={detachLabel} size="compact" variant="quiet" onClick={onDetach}><ClusterIcon name="forward" /></ClusterIconButton> : null}
      {onClose ? <ClusterIconButton label="Close panel" size="compact" variant="quiet" onClick={onClose}><ClusterIcon name="close" /></ClusterIconButton> : null}
    </ClusterActionGroup> : null}
  </header>;
}

export function ClusterInspectorPanel({ label, title, detail, onClose, onDetach, detachLabel, className = "", panelProps, children }: { label: string; title: ReactNode; detail?: ReactNode; onClose?: () => void; onDetach?: () => void; detachLabel?: string; className?: string; panelProps?: ClusterPanelElementProps; children: ReactNode }) {
  return <aside {...panelProps} className={`cluster-viewer-drawer ${className}`.trim()} aria-label={label} data-motion-purpose="surface">
    <ClusterPanelHeader title={title} detail={detail} onClose={onClose} onDetach={onDetach} detachLabel={detachLabel} />
    {children}
  </aside>;
}

export function ClusterDrawerPanel({ open, label, title, detail, onClose, onDetach, className = "", panelProps, children }: { open: boolean; label: string; title: ReactNode; detail?: ReactNode; onClose: () => void; onDetach?: () => void; className?: string; panelProps?: ClusterPanelElementProps; children: ReactNode }) {
  if (!open) return null;
  return <section {...panelProps} className={`cluster-viewer-drawer ${className}`.trim()} role="dialog" aria-modal="false" aria-label={label} data-motion-purpose="surface">
    <ClusterPanelHeader title={title} detail={detail} onClose={onClose} onDetach={onDetach} />
    {children}
  </section>;
}

export function ClusterOverlayDrawer({ open, label, onClose, className = "", backdropClassName = "", panelClassName = "", closeOnBackdrop = true, closeOnEscape = true, panelProps, children }: { open: boolean; label: string; onClose: () => void; className?: string; backdropClassName?: string; panelClassName?: string; closeOnBackdrop?: boolean; closeOnEscape?: boolean; panelProps?: ClusterPanelElementProps; children: ReactNode }) {
  const panelRef = useRef<HTMLElement | null>(null);
  useClusterDialogInteraction({
    active: open,
    dialogRef: panelRef,
    onEscape: closeOnEscape ? onClose : undefined,
    escapeDisabled: !closeOnEscape,
  });
  if (!open) return null;
  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop || event.target !== event.currentTarget) return;
    onClose();
  };
  return <aside className={className || undefined} data-motion-purpose="surface">
    <div className={backdropClassName || undefined} role="presentation" onMouseDown={handleBackdrop} />
    <section {...panelProps} ref={panelRef} className={panelClassName || undefined} role="dialog" aria-modal="false" aria-label={label}>
      {children}
    </section>
  </aside>;
}

export function ClusterDockedInspector({ label, persistKey, side = "end", inspector, children, className = "", minWidth = 280, maxWidth = 560, defaultWidth = 360 }: { label: string; persistKey: string; side?: "start" | "end"; inspector: ReactNode; children: ReactNode; className?: string; minWidth?: number; maxWidth?: number; defaultWidth?: number }) {
  return <ClusterResizableSplit className={className} label={label} persistKey={persistKey} side={side} minWidth={minWidth} maxWidth={maxWidth} defaultWidth={defaultWidth}>{children}{inspector}</ClusterResizableSplit>;
}

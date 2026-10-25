import { type HTMLAttributes, type PointerEvent, type ReactNode, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useClusterDialogInteraction } from "./useClusterDialogInteraction";
import { topFloatingForClusterDialog } from "../core/dialog-focus";

type ClusterModalDataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type ClusterModalProps = {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  backdropClassName?: string;
  includeDefaultBackdropClass?: boolean;
  className?: string;
  id?: string;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  labelledBy?: string;
  describedBy?: string;
  portal?: boolean;
  dialogProps?: Omit<
    HTMLAttributes<HTMLElement>,
    | "children"
    | "className"
    | "id"
    | "role"
    | "aria-label"
    | "aria-labelledby"
    | "aria-describedby"
    | "aria-modal"
    | "aria-busy"
  > & ClusterModalDataAttributes;
};

export function ClusterModal({
  open,
  children,
  onClose,
  busy = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  backdropClassName = "",
  includeDefaultBackdropClass = true,
  className = "modal panel",
  id,
  role = "dialog",
  ariaLabel,
  labelledBy,
  describedBy,
  portal = true,
  dialogProps,
}: ClusterModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const modalId = id || `cluster-modal-${generatedId.replace(/:/g, "")}`;
  const canClose = Boolean(onClose) && !busy;
  useClusterDialogInteraction({
    active: open,
    dialogRef,
    onEscape: canClose && closeOnEscape ? onClose : undefined,
    escapeDisabled: !canClose || !closeOnEscape,
  });

  if (!open || typeof document === "undefined") return null;

  const handleBackdrop = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !canClose || !closeOnBackdrop) return;
    // Dismiss a body-portaled menu first. A single click must not close both
    // an open menu and its parent modal.
    if (dialogRef.current && topFloatingForClusterDialog(dialogRef.current)) return;
    onClose?.();
  };

  const backdropClasses = [includeDefaultBackdropClass ? "modal-backdrop" : "", backdropClassName].filter(Boolean).join(" ");

  const modal = (
    <div className={backdropClasses || undefined} role="presentation" onPointerDown={handleBackdrop}>
      <section
        {...dialogProps}
        ref={dialogRef}
        id={modalId}
        className={className}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
      >
        {children}
      </section>
    </div>
  );

  return portal ? createPortal(modal, document.body) : modal;
}

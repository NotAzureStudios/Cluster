import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { resolveClusterInteractionState, type ClusterInteractionState } from "./interaction-state";
import type { ClusterMotionPurpose } from "./cluster-motion";

export type ClusterButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ClusterButtonSize = "default" | "compact";

type ClusterButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ClusterButtonVariant;
  size?: ClusterButtonSize;
  busy?: boolean;
  busyLabel?: string;
  selected?: boolean;
  state?: ClusterInteractionState;
  unstyled?: boolean;
  motionPurpose?: ClusterMotionPurpose;
};

export const ClusterButton = forwardRef<HTMLButtonElement, ClusterButtonProps>(function ClusterButton({
  variant = "secondary", size = "default", busy = false, busyLabel, selected = false, state = "default", unstyled = false, motionPurpose = "feedback", disabled, className = "", children, type = "button", ...props
}, ref) {
  const resolvedState = resolveClusterInteractionState({ state, selected, disabled: Boolean(disabled), busy });
  const ariaPressed = props["aria-pressed"] ?? (selected || undefined);
  return (
    <button {...props} ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      aria-pressed={ariaPressed} data-cluster-state={resolvedState} data-motion-purpose={motionPurpose}
      className={`${unstyled ? "" : `cluster-button-v425 ${variant} ${size === "compact" ? "compact" : ""}`} ${className}`.trim()}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
});


type ClusterLinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ClusterButtonVariant;
  size?: ClusterButtonSize;
  selected?: boolean;
  state?: ClusterInteractionState;
};

export const ClusterLinkButton = forwardRef<HTMLAnchorElement, ClusterLinkButtonProps>(function ClusterLinkButton({
  variant = "secondary", size = "default", selected = false, state = "default", className = "", children, ...props
}, ref) {
  const inert = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const resolvedState = resolveClusterInteractionState({ state, selected, disabled: inert, busy: false });
  return (
    <a {...props} ref={ref} aria-current={selected ? "page" : props["aria-current"]} tabIndex={inert ? -1 : props.tabIndex}
      onClick={(event) => { if (inert) { event.preventDefault(); event.stopPropagation(); return; } props.onClick?.(event); }}
      data-cluster-state={resolvedState} data-motion-purpose="feedback"
      className={`cluster-button-v425 ${variant} ${size === "compact" ? "compact" : ""} ${className}`.trim()}>
      {children}
    </a>
  );
});

type ClusterIconButtonProps = Omit<ClusterButtonProps, "children" | "aria-label"> & { label: string; children: ReactNode };

export const ClusterIconButton = forwardRef<HTMLButtonElement, ClusterIconButtonProps>(function ClusterIconButton({
  label, title, variant = "quiet", className = "", children, ...props
}, ref) {
  return <ClusterButton {...props} ref={ref} variant={variant} aria-label={label} title={title || label}
    className={`cluster-icon-button-v425 ${className}`.trim()}>{children}</ClusterButton>;
});

export function ClusterActionGroup({ label, className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; children: ReactNode }) {
  return <div {...props} className={`cluster-action-group-v425 ${className}`.trim()} role="group" aria-label={label}>{children}</div>;
}

import { useId, useState, type ReactNode } from "react";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterIcon } from "./ClusterIcon";

export function ClusterDisclosureGroup({
  title,
  summary,
  badge,
  headerTrailing,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  disabled = false,
  className = "",
  contentClassName = "",
}: {
  title: ReactNode;
  summary?: ReactNode;
  badge?: ReactNode;
  headerTrailing?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const generatedId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = typeof open === "boolean";
  const expanded = controlled ? open : internalOpen;
  const contentId = `${generatedId}-content`;

  function change(next: boolean) {
    if (disabled) return;
    if (!controlled) setInternalOpen(next);
    if (next !== expanded) onOpenChange?.(next);
  }

  return (
    <details
      className={`cluster-field-v425 ${className}`.trim()}
      open={expanded}
      data-cluster-state={disabled ? "disabled" : expanded ? "selected" : "default"}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (disabled) {
          // Native <details> can toggle through keyboard/assistive technology, not just clicks.
          // Restore the actual DOM state rather than leaving a disabled control visually open.
          if (next !== expanded) event.currentTarget.open = expanded;
          return;
        }
        change(next);
      }}
    >
      <summary aria-controls={contentId} aria-disabled={disabled || undefined} onClick={(event) => { if (disabled) event.preventDefault(); }} onKeyDown={(event) => {
        if (disabled && (event.key === "Enter" || event.key === " ")) event.preventDefault();
      }}>
        <span><strong>{title}</strong>{summary ? <small className="muted">{summary}</small> : null}</span>
        {badge ? <ClusterStatus compact>{badge}</ClusterStatus> : null}
        {headerTrailing !== undefined && headerTrailing !== null ? <span className="cluster-disclosure-trailing-v546">{headerTrailing}</span> : null}
        <ClusterIcon name="chevron-right" className="cluster-disclosure-chevron-v546" />
      </summary>
      <div id={contentId} className={contentClassName}>{children}</div>
    </details>
  );
}

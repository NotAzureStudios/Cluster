import { useId, useState, type ReactNode } from "react";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterIcon } from "./ClusterIcon";
import "./cluster-disclosure.css";

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
      className={`cl-disc ${className}`.trim()}
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
        <ClusterIcon name="chevron-right" className="cl-disc__chevron" />
        <span className="cl-disc__title"><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>
        {badge ? <ClusterStatus compact>{badge}</ClusterStatus> : null}
        {headerTrailing !== undefined && headerTrailing !== null ? <span className="cl-disc__trailing">{headerTrailing}</span> : null}
      </summary>
      <div id={contentId} className={`cl-disc__body ${contentClassName}`.trim()}>{children}</div>
    </details>
  );
}

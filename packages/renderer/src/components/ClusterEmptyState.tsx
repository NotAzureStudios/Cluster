import type { ReactNode } from "react";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";

export type ClusterEmptyStateKind = "empty" | "first-use" | "filtered" | "restricted" | "offline" | "loading";

type ClusterEmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  kind?: ClusterEmptyStateKind;
  icon?: ClusterIconName;
  compact?: boolean;
  className?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
};

const DEFAULT_ICONS: Record<ClusterEmptyStateKind, ClusterIconName> = {
  empty: "folder",
  "first-use": "plus",
  filtered: "search",
  restricted: "warning",
  offline: "cloud-off",
  loading: "sync",
};

export function ClusterEmptyState({
  title,
  description,
  kind = "empty",
  icon,
  compact = false,
  className = "",
  actions,
  eyebrow,
}: ClusterEmptyStateProps) {
  return (
    <section
      className={`cluster-empty-state-v436 ${kind} ${compact ? "compact" : ""} ${className}`.trim()}
      data-empty-kind={kind}
      role={kind === "offline" || kind === "restricted" ? "status" : undefined}
    >
      <span className="cluster-empty-state-icon-v436" aria-hidden="true"><ClusterIcon name={icon || DEFAULT_ICONS[kind]} treatment="duotone" /></span>
      <div className="cluster-empty-state-copy-v436">
        {eyebrow ? <small>{eyebrow}</small> : null}
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="cluster-empty-state-actions-v436">{actions}</div> : null}
    </section>
  );
}

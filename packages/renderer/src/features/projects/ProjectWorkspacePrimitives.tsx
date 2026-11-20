import type { ReactNode } from "react";
import { ClusterEmptyState, type ClusterEmptyStateKind } from "../../components/ClusterEmptyState";
import { ClusterButton } from "../../components/ClusterButton";
import "./project-section.css";
import "../../components/cluster-segmented.css";

export type ProjectSectionMetric = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "accent";
  onClick?: () => void;
};

/* Section chrome for every project tab — styled by project-section.css only.
   The tab row already names the section, so the header is one row: the
   section's counts as indicator chips (tone dot, number, word) and its
   actions. The title stays for screen readers. */
export function ProjectSectionHeader({ eyebrow: _eyebrow, title, description: _description, actions, metrics }: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  metrics?: ProjectSectionMetric[];
  compact?: boolean;
}) {
  if (!actions && !metrics?.length) return <h2 className="ps-sr">{title}</h2>;
  return (
    <header className="ps-head">
      <h2 className="ps-sr">{title}</h2>
      {metrics?.length ? <ul className="ps-chips" aria-label={`${title} summary`}>{metrics.map((metric) => {
        const body = <><i aria-hidden="true" /><strong>{metric.value}</strong><span>{metric.label}</span></>;
        return <li key={metric.label} data-tone={metric.tone || "neutral"} title={typeof metric.detail === "string" ? metric.detail : undefined}>
          {metric.onClick ? <ClusterButton unstyled type="button" className="ps-chip" onClick={metric.onClick}>{body}</ClusterButton> : <span className="ps-chip">{body}</span>}
        </li>;
      })}</ul> : null}
      {actions ? <div className="ps-actions">{actions}</div> : null}
    </header>
  );
}

export function ProjectSectionStatus({ children, tone = "neutral" }: { children?: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  if (!children) return null;
  return <div className="ps-status" data-tone={tone} role={tone === "danger" ? "alert" : "status"}><i aria-hidden="true" /><div>{children}</div></div>;
}

export function ProjectSurface({ title, description, action, children, className = "", tone = "neutral" }: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "accent" | "warning" | "danger";
}) {
  return (
    <section className={`ps-surface ${className}`.trim()} data-tone={tone}>
      {title || action ? <header className="ps-surface__head">{title ? <h3>{title}</h3> : null}{action ? <div className="ps-surface__action">{action}</div> : null}</header> : null}
      {description && (tone === "warning" || tone === "danger") ? <p className="ps-surface__note">{description}</p> : null}
      <div className="ps-surface__body">{children}</div>
    </section>
  );
}

export function ProjectEmptyState({ title, description, action, kind = "empty" }: { title: string; description: ReactNode; action?: ReactNode; kind?: ClusterEmptyStateKind }) {
  return <ClusterEmptyState title={title} description={description} actions={action} kind={kind} compact className="ps-empty" />;
}

export function ProjectSegmentedControl<Id extends string>({ items, activeId, onChange, label }: {
  items: Array<{ id: Id; label: string; count?: number }>;
  activeId: Id;
  onChange: (id: Id) => void;
  label: string;
}) {
  return <div className="cl-seg" role="tablist" aria-label={label}>{items.map((item) => <ClusterButton unstyled key={item.id} type="button" role="tab" aria-selected={activeId === item.id} className={activeId === item.id ? "is-active" : ""} onClick={() => onChange(item.id)}><span>{item.label}</span>{typeof item.count === "number" && item.count > 0 ? <em>{item.count}</em> : null}</ClusterButton>)}</div>;
}

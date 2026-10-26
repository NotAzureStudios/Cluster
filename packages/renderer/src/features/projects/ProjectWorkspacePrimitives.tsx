import type { ReactNode } from "react";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterEmptyState, type ClusterEmptyStateKind } from "../../components/ClusterEmptyState";
import { ClusterButton } from "../../components/ClusterButton";

export type ProjectSectionMetric = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "accent";
  onClick?: () => void;
};

export function ProjectSectionHeader({ eyebrow, title, description, actions, metrics, compact = false }: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  metrics?: ProjectSectionMetric[];
  compact?: boolean;
}) {
  return (
    <header className={`project-section-shell-head-v312 cluster-workspace-section-head-v391 ${compact ? "compact" : ""}`}>
      <div className="project-section-shell-copy-v312">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description && compact ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="project-section-shell-actions-v312 cluster-workspace-actions-v391">{actions}</div> : null}
      {metrics?.length ? (
        <ClusterMetricStrip
          className="project-section-metrics-v312"
          label={`${title} summary`}
          items={metrics.map((metric) => ({
            label: metric.label,
            value: metric.value,
            detail: metric.detail,
            tone: metric.tone === "good" ? "good" : metric.tone === "warning" ? "warning" : metric.tone === "danger" ? "danger" : "neutral",
            onSelect: metric.onClick,
          }))}
        />
      ) : null}
    </header>
  );
}

export function ProjectSectionStatus({ children, tone = "neutral" }: { children?: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  if (!children) return null;
  return <div className={`project-section-status-v312 cluster-status-strip-v391 ${tone}`}>{children}</div>;
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
    <section className={`project-surface-v312 cluster-surface-v391 ${tone} ${className}`.trim()}>
      {title || description || action ? <header><div>{title ? <h3>{title}</h3> : null}{description && (tone === "warning" || tone === "danger") ? <p>{description}</p> : null}</div>{action}</header> : null}
      <div className="project-surface-body-v312">{children}</div>
    </section>
  );
}

export function ProjectEmptyState({ title, description, action, kind = "empty" }: { title: string; description: ReactNode; action?: ReactNode; kind?: ClusterEmptyStateKind }) {
  return <ClusterEmptyState title={title} description={description} actions={action} kind={kind} compact className="project-empty-v312 cluster-empty-state-v391" />;
}

export function ProjectSegmentedControl<Id extends string>({ items, activeId, onChange, label }: {
  items: Array<{ id: Id; label: string; count?: number }>;
  activeId: Id;
  onChange: (id: Id) => void;
  label: string;
}) {
  return <div className="project-segmented-v312 cluster-segmented-v391" role="tablist" aria-label={label}>{items.map((item) => <ClusterButton unstyled key={item.id} type="button" role="tab" aria-selected={activeId === item.id} className={activeId === item.id ? "active" : ""} onClick={() => onChange(item.id)}><span>{item.label}</span>{typeof item.count === "number" ? <em>{item.count}</em> : null}</ClusterButton>)}</div>;
}

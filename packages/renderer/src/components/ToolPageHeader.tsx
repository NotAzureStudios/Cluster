import type { ReactNode } from "react";
import "./tool-page-header.css";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";

export type ToolPageMetric = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
};

/* The page header. A title strip on the canvas, not a card: the page below it
   is the content, and framing the title in its own box only adds a layer.

   It renders under its own class names, owned by styles/components/page-head
   .css alone. The previous names had collected ~260 rules across eleven
   stylesheets — frames, borders and per-page geometry that fought each other —
   and a new name was the clean way out of that cascade.

   No icon is inferred from the title any more. The sidebar already shows the
   page's icon beside its name, so a second copy here was decoration; pass
   `icon` when a page genuinely has no sidebar entry to borrow one from. */
export function ToolPageHeader({
  eyebrow,
  title,
  description,
  metrics = [],
  actions,
  context,
  className = "",
  icon = null,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  metrics?: ToolPageMetric[];
  actions?: ReactNode;
  context?: ReactNode;
  className?: string;
  icon?: ClusterIconName | null;
}) {
  // One line: icon, title and counts on the left, actions on the right. The
  // description stays available to assistive tech and as the title's tooltip.
  return (
    <header className={`page-head tph ${className}`.trim()}>
      <div className="tph-main">
        {icon ? <span className="page-head-icon" aria-hidden="true"><ClusterIcon name={icon} /></span> : null}
        <div className="page-head-title">
          {eyebrow ? <p className="page-head-eyebrow">{eyebrow}</p> : null}
          <h1 title={description || undefined}>{title}</h1>
        </div>
        {description ? <p className="page-head-desc tph-sr">{description}</p> : null}
        {metrics.length > 0 ? (
          <dl className="page-head-stats" aria-label={`${title} summary`}>
            {metrics.map((metric) => (
              <div key={metric.label} className="page-head-stat" data-tone={metric.tone || "neutral"}>
                <dd>{metric.value}</dd>
                <dt>{metric.label}</dt>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? <div className="page-head-actions" role="group" aria-label={`${title} actions`}>{actions}</div> : null}
      {context ? <div className="page-head-context">{context}</div> : null}
    </header>
  );
}

import type { ReactNode } from "react";
import { ClusterActionGroup } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import { ClusterMetricStrip } from "./ClusterMetricStrip";

export type ToolPageMetric = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
};

const TITLE_ICON_RULES: Array<[RegExp, ClusterIconName]> = [
  [/\bhome\b/i, "home"],
  [/\bmy work\b|\bwork\b/i, "work"],
  [/\bproject/i, "project"],
  [/\binbox\b|notification/i, "bell"],
  [/\btimeline\b/i, "timeline"],
  [/\bticket/i, "ticket"],
  [/\bcalendar\b/i, "calendar"],
  [/\bscheduler\b|schedule/i, "clock"],
  [/\blibrary\b/i, "library"],
  [/\bpacket/i, "packet"],
  [/\bpeople\b|user/i, "users"],
  [/\boperation/i, "operations"],
  [/\bbuild/i, "tools"],
  [/\bsettings\b|configuration/i, "settings"],
  [/\badmin/i, "settings"],
];

function iconForTitle(title: string): ClusterIconName | null {
  return TITLE_ICON_RULES.find(([pattern]) => pattern.test(title))?.[1] || null;
}

export function ToolPageHeader({
  eyebrow,
  title,
  description,
  metrics = [],
  actions,
  context,
  className = "",
  icon,
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
  const resolvedIcon = icon === undefined ? iconForTitle(title) : icon;
  return (
    <header className={`cluster-tool-header-v228 cluster-workspace-header-v391 ${className}`.trim()}>
      <div className="cluster-tool-heading-v228 cluster-workspace-heading-v391">
        <div className="cluster-tool-title-shell-v448">
          {resolvedIcon ? <span className="cluster-tool-title-icon-v448" data-tool-icon={resolvedIcon}><ClusterIcon name={resolvedIcon} treatment="duotone" /></span> : null}
          <div className="cluster-tool-title-v228 cluster-workspace-title-v391">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {description ? <p className="muted cluster-workspace-description-v391">{description}</p> : null}
          </div>
        </div>
        {actions && <ClusterActionGroup label={`${title} actions`} className="cluster-tool-actions-v228 cluster-workspace-actions-v391">{actions}</ClusterActionGroup>}
      </div>
      {(metrics.length > 0 || context) && (
        <div className="cluster-tool-summary-v228 cluster-workspace-summary-v391">
          {metrics.length > 0 && (
            <ClusterMetricStrip
              className="cluster-tool-metrics-v228"
              label={`${title} summary`}
              items={metrics.map((metric) => ({
                label: metric.label,
                value: metric.value,
                tone: metric.tone === "good" ? "good" : metric.tone === "warning" ? "warning" : metric.tone === "danger" ? "danger" : "neutral",
              }))}
            />
          )}
          {context && <div className="cluster-tool-context-v228">{context}</div>}
        </div>
      )}
    </header>
  );
}

import type { ReactNode } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterButton } from "./ClusterButton";

export type ClusterMetricTone = "neutral" | "good" | "warning" | "danger";

export type ClusterMetricStripItem = {
  key?: string;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: ClusterMetricTone;
  selected?: boolean;
  progress?: number;
  onSelect?: () => void;
};

function MetricContent({ item }: { item: ClusterMetricStripItem }) {
  const progress = item.progress == null ? null : Math.max(0, Math.min(100, item.progress));
  return (
    <>
      <span className="cluster-metric-label-v427">{item.label}</span>
      <strong className="cluster-metric-value-v427">{item.value}</strong>
      {item.detail != null ? <small className="cluster-metric-detail-v427">{item.detail}</small> : null}
      {progress != null ? (
        <span className="cluster-metric-progress-v427" aria-hidden="true">
          <i style={runtimeStyle({ "--cluster-metric-progress": `${progress}%` })} />
        </span>
      ) : null}
    </>
  );
}

export function ClusterMetricStrip({
  items,
  label = "Summary",
  className = "",
}: {
  items: ClusterMetricStripItem[];
  label?: string;
  className?: string;
}) {
  return (
    <div className={`cluster-metric-strip-v427 ${className}`.trim()} role="list" aria-label={label}>
      {items.map((item, index) => {
        const key = item.key || `${item.label}-${index}`;
        const tone = item.tone || "neutral";
        if (item.onSelect) {
          return (
            <div key={key} role="listitem" className="cluster-metric-interactive-v547">
            <ClusterButton
              variant="quiet"
              size="compact"
              selected={item.selected}
              className={`cluster-metric-item-v427 ${tone}`}
              onClick={item.onSelect}
            >
              <MetricContent item={item} />
            </ClusterButton>
            </div>
          );
        }
        return (
          <div key={key} className={`cluster-metric-item-v427 ${tone}`} role="listitem">
            <MetricContent item={item} />
          </div>
        );
      })}
    </div>
  );
}

import "./metric-comparison-bars.css";

export type ComparisonMetric = { key: string; label: string; value: number | null; detail?: string; warning?: boolean };
/** Compact quantitative comparisons; null means no data, never a fabricated zero. */
export function MetricComparisonBars({ items, unit = "ms", label }: { items: readonly ComparisonMetric[]; unit?: string; label: string }) {
  const maximum = Math.max(1, ...items.map((item) => item.value != null && Number.isFinite(item.value) && item.value >= 0 ? item.value : 0));
  return <section className="cluster-metric-comparison" aria-label={label}>
    <header><strong>{label}</strong><small>{unit}</small></header>
    <div className="cluster-metric-comparison__rows">
      {items.map((item) => {
        const hasValue = item.value != null && Number.isFinite(item.value) && item.value >= 0;
        const value = hasValue ? item.value as number : 0;
        return <div className={`cluster-metric-comparison__row ${item.warning ? "is-warning" : ""}`} key={item.key}>
          <span title={item.detail}>{item.label}</span>
          <div className="cluster-metric-comparison__track" role="meter" aria-label={`${item.label}: ${hasValue ? `${Math.round(value)} ${unit}` : "no samples"}`} aria-valuemin={0} aria-valuemax={Math.ceil(maximum)} aria-valuenow={hasValue ? Math.round(value) : undefined}>
            {hasValue ? <i style={{ width: `${Math.min(100, 100 * value / maximum)}%` }} /> : null}
          </div>
          <strong>{hasValue ? `${Math.round(value)} ${unit}` : "—"}</strong>
        </div>;
      })}
    </div>
  </section>;
}

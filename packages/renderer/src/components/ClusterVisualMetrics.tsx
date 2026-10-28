import { runtimeStyle } from "../core/runtime-style";
import { boundedRatio, visualBarHeight, visualRankWidth } from "./cluster-visual-metrics-model";
import "./cluster-visual-metrics.css";

/** Small, data-driven visuals. These never fetch data, animate continuously, or infer history. */
export type VisualTone = "accent" | "good" | "warning" | "danger" | "neutral";

/** A labeled percentage ring. The center is always the exact percentage, not a rounded-up approximation. */
export function ClusterVisualRing({ label, percent, tone = "accent", compact = false }: {
  label: string; percent: number | null | undefined; tone?: VisualTone; compact?: boolean;
}) {
  const valid = typeof percent === "number" && Number.isFinite(percent);
  const value = valid ? Math.round(Math.min(100, Math.max(0, percent))) : null;
  return <div className={`cluster-visual-ring tone-${tone} ${compact ? "compact" : ""}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : value} aria-valuetext={value === null ? "Not available" : `${value}%`}>
    <svg aria-hidden="true" viewBox="0 0 52 52" focusable="false"><circle className="track" cx="26" cy="26" r="21" /><circle className="value" cx="26" cy="26" r="21" pathLength="100" strokeDasharray={`${value ?? 0} 100`} /></svg>
    <div className="cluster-visual-ring__caption"><strong>{value === null ? "—" : `${value}%`}</strong><span>{label}</span></div>
  </div>;
}

/** Capacity/stock proportions: no percentage if the denominator is unknown. */
export function ClusterVisualMeter({ label, value, total, tone = "accent", compact = false, showValues = true, formatValue = (amount: number) => amount.toLocaleString() }: {
  label: string; value: number | null | undefined; total: number | null | undefined;
  tone?: VisualTone; compact?: boolean; showValues?: boolean; formatValue?: (value: number) => string;
}) {
  const ratio = value == null || total == null ? null : boundedRatio(value, total);
  return <div className={`cluster-visual-meter tone-${tone} ${compact ? "compact" : ""}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total != null && total > 0 ? total : undefined}
    aria-valuenow={ratio !== null && value != null ? Math.max(0, Math.min(total!, value)) : undefined}
    aria-valuetext={ratio === null ? "Not available" : `${formatValue(value!)} of ${formatValue(total!)}`}>
    {showValues && <div className="cluster-visual-meter__head"><span>{label}</span><strong>{ratio === null ? "—" : `${formatValue(value!)} / ${formatValue(total!)}`}</strong></div>}
    <div className="cluster-visual-meter__track" aria-hidden="true"><span style={runtimeStyle({ width: `${(ratio ?? 0) * 100}%` })} /></div>
  </div>;
}

export type VisualBucket = { label: string; value: number };
/** Compact comparative histogram based only on the data already loaded by the owning view. */
export function ClusterVisualBars({ label, buckets, tone = "accent" }: {
  label: string; buckets: readonly VisualBucket[]; tone?: VisualTone;
}) {
  const data = buckets.filter((bucket) => Number.isFinite(bucket.value)).map((bucket) => ({
    label: bucket.label, value: Math.max(0, bucket.value),
  }));
  const max = Math.max(0, ...data.map((bucket) => bucket.value));
  return <div className={`cluster-visual-bars tone-${tone}`} role="img"
    aria-label={`${label}: ${data.length ? data.map((bucket) => `${bucket.label}: ${bucket.value}`).join(", ") : "No data"}`}>
    <div className="cluster-visual-bars__head"><strong>{label}</strong><span>{max === 0 ? "No activity" : `${data.reduce((sum, bucket) => sum + bucket.value, 0)} total`}</span></div>
    <div className="cluster-visual-bars__plot" aria-hidden="true">
      {data.map((bucket, index) => <span key={`${index}-${bucket.label}`} className="cluster-visual-bars__column" title={`${bucket.label}: ${bucket.value}`}>
        <i style={runtimeStyle({ height: `${visualBarHeight(bucket.value, max)}%` })} />
        <small>{bucket.label}</small>
      </span>)}
    </div>
  </div>;
}

/** Multiple parts of a single known total, e.g. the share of people with capacity configured. */
export function ClusterVisualComposition({ label, parts, total }: {
  label: string; parts: readonly { label: string; value: number; tone: VisualTone }[]; total: number;
}) {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeParts = parts.map((part) => ({ ...part, value: Number.isFinite(part.value) ? Math.max(0, part.value) : 0 }));
  const denominator = Math.max(safeTotal, safeParts.reduce((sum, part) => sum + part.value, 0));
  return <div className="cluster-visual-composition" role="img" aria-label={`${label}: ${safeParts.map((part) => `${part.label}: ${part.value}`).join(", ")}`}>
    <div className="cluster-visual-composition__head"><strong>{label}</strong><span>{denominator ? `${denominator} total` : "No data"}</span></div>
    <div className="cluster-visual-composition__bar" aria-hidden="true">{denominator ? safeParts.map((part, index) => <span key={`${part.label}-${index}`} className={`tone-${part.tone}`} style={runtimeStyle({ width: `${part.value / denominator * 100}%` })} />) : null}</div>
    <div className="cluster-visual-composition__legend">{safeParts.map((part, index) => <span key={`${part.label}-${index}`} className={`tone-${part.tone}`}><i aria-hidden="true" />{part.label} <b>{part.value}</b></span>)}</div>
  </div>;
}


/** Horizontal comparisons keep labels and exact values, without turning every statistic into a separate card. */
export function ClusterVisualRankedBars({ label, rows, tone = "accent", formatValue }: {
  label: string;
  rows: readonly { id: string; label: string; value: number }[];
  tone?: VisualTone;
  formatValue?: (value: number) => string;
}) {
  const safeRows = rows.filter((row) => Number.isFinite(row.value) && row.value >= 0);
  const maximum = Math.max(0, ...safeRows.map((row) => row.value));
  const renderValue = formatValue || ((value: number) => value.toLocaleString());
  return <section className={`cluster-visual-ranked tone-${tone}`} aria-label={label}>
    <strong className="cluster-visual-ranked__title">{label}</strong>
    {safeRows.length ? <div className="cluster-visual-ranked__rows">
      {safeRows.map((row) => <div key={row.id} className="cluster-visual-ranked__row"
        role="img" aria-label={`${row.label}: ${renderValue(row.value)}`}>
        <div className="cluster-visual-ranked__head"><span title={row.label}>{row.label}</span><b>{renderValue(row.value)}</b></div>
        <div className="cluster-visual-ranked__track" aria-hidden="true"><i style={runtimeStyle({ width: `${visualRankWidth(row.value, maximum)}%` })}/></div>
      </div>)}
    </div> : <span className="cluster-visual-ranked__empty">No measurements</span>}
  </section>;
}

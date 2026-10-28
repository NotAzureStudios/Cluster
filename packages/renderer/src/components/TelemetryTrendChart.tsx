import type { TrendSample } from "./telemetry-trend";
import "./telemetry-trend.css";

const plot = { x: 40, y: 12, width: 720, height: 122 };

type SeriesKey = "requestP95Ms" | "databaseP95Ms";
const series: Array<{ key: SeriesKey; label: string; className: string }> = [
  { key: "requestP95Ms", label: "Request p95", className: "requests" },
  { key: "databaseP95Ms", label: "Database p95", className: "database" },
];

function graphPath(samples: TrendSample[], key: SeriesKey, maximum: number): string {
  let started = false;
  return samples.map((sample, index) => {
    const value = sample[key];
    if (value === null) { started = false; return ""; }
    const x = plot.x + index / Math.max(1, samples.length - 1) * plot.width;
    const y = plot.y + plot.height - value / maximum * plot.height;
    const command = started ? "L" : "M";
    started = true;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function TelemetryTrendChart({ samples }: { samples: TrendSample[] }) {
  if (!samples.length) return null;
  const measurements = samples.flatMap((point) => [point.requestP95Ms, point.databaseP95Ms]).filter((value): value is number => value !== null);
  if (!measurements.length) return null;
  const maximum = Math.max(1, ...measurements);
  const scale = Math.ceil(maximum / 3) * 3;
  const first = new Date(samples[0].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const last = new Date(samples[samples.length - 1].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return <section className="cluster-telemetry-chart" aria-label="Server latency history">
    <header><strong>Latency history</strong><span>{samples.length} snapshots · this open view</span></header>
    <div className="cluster-telemetry-chart-legend">
      {series.map((item) => <span key={item.key} className={item.className}>{item.label}</span>)}
    </div>
    <svg viewBox="0 0 780 164" preserveAspectRatio="none" role="img" aria-label={`Request and database p95 response times over ${samples.length} performance snapshots; maximum ${scale} milliseconds`}>
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height * fraction} y2={plot.y + plot.height * fraction} className="grid" />
        <text x={plot.x - 6} y={plot.y + plot.height * fraction + 4} textAnchor="end">{Math.round(scale * (1 - fraction))}</text>
      </g>)}
      {series.map((item) => {
        const lastIndex = [...samples].reverse().findIndex((sample) => sample[item.key] !== null);
        const actualIndex = lastIndex < 0 ? -1 : samples.length - 1 - lastIndex;
        const value = actualIndex < 0 ? null : samples[actualIndex][item.key];
        return <g key={item.key} className={item.className}>
          <path d={graphPath(samples, item.key, scale)} />
          {value !== null ? <circle cx={plot.x + actualIndex / Math.max(1, samples.length - 1) * plot.width} cy={plot.y + plot.height - value / scale * plot.height} r="3.5" /> : null}
        </g>;
      })}
      <text x={plot.x} y="156" textAnchor="start">{first}</text>
      <text x={plot.x + plot.width} y="156" textAnchor="end">{last}</text>
    </svg>
    <small>Milliseconds · snapshots collected only while this panel is open</small>
  </section>;
}

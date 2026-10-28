import type { TransferRatePoint } from "../features/shell/transfer-telemetry";

const PLOT = { x: 46, y: 12, width: 654, height: 120 };

function linePath(points: TransferRatePoint[], key: "upBps" | "downBps", scale: number) {
  return points.map((point, index) => {
    const x = PLOT.x + index * PLOT.width / Math.max(1, points.length - 1);
    const y = PLOT.y + PLOT.height * (1 - Math.min(point[key], scale) / scale);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function speed(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB/s`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(value / 1024).toFixed(0)} KB/s`;
}

/** Native transfer network throughput. Historical samples are local to this open session. */
export function TransferRateChart({ samples }: { samples: readonly TransferRatePoint[] }) {
  const max = Math.max(1024, ...samples.flatMap((point) => [point.upBps, point.downBps]));
  const scale = Math.ceil(max / 1024) * 1024;
  return <div className="cluster-transfer-graph" role="group" aria-label="Live upload and download speed history">
    <div className="cluster-transfer-graph__legend"><strong>Transfer activity</strong><span className="download">Download</span><span className="upload">Upload</span></div>
    {samples.length < 2 ? <div className="cluster-transfer-graph__empty">Speed graph appears when native transfer progress is reported.</div> :
    <svg viewBox="0 0 720 158" role="img" aria-label={`Upload and download throughput over ${samples.length} samples; scale up to ${speed(scale)}`} preserveAspectRatio="none">
      {[0, .5, 1].map((fraction) => <g key={fraction}>
        <line className="grid" x1={PLOT.x} x2={PLOT.x + PLOT.width} y1={PLOT.y + PLOT.height * fraction} y2={PLOT.y + PLOT.height * fraction} />
        <text x={PLOT.x - 5} y={PLOT.y + PLOT.height * fraction + 4} textAnchor="end">{speed(scale * (1 - fraction))}</text>
      </g>)}
      <path className="download" d={linePath([...samples], "downBps", scale)} />
      <path className="upload" d={linePath([...samples], "upBps", scale)} />
      <text x={PLOT.x} y={152}>{new Date(samples[0].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</text>
      <text x={PLOT.x + PLOT.width} y={152} textAnchor="end">Now</text>
    </svg>}
  </div>;
}

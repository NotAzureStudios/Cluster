import "./space-meter.css";

export function formatBytes(bytes?: number | null) {
  const value = Math.max(0, Number(bytes || 0));
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

// Thin used/total bar. Turns amber past 85% and red past 95% unless a fixed
// tone (e.g. progress) is given.
export function SpaceMeter({ usedBytes, totalBytes, tone }: { usedBytes: number; totalBytes: number; tone?: "accent" }) {
  const ratio = totalBytes > 0 ? Math.min(1, Math.max(0, usedBytes / totalBytes)) : 0;
  const level = tone || (ratio >= 0.95 ? "danger" : ratio >= 0.85 ? "warning" : "normal");
  return <span className="cl-space-meter" data-level={level} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={`${Math.round(ratio * 100)}% used`}>
    <span style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
  </span>;
}

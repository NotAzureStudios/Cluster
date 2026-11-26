import "./space-meter.css";

export function formatBytes(bytes?: number | null) {
  const value = Math.max(0, Number(bytes || 0));
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

// Thin used/total bar. Its colour follows the room left: green while 40% or
// more is free, sliding through yellow and orange to red at 5% free. A fixed
// tone (e.g. progress) keeps the accent colour.
export function spaceMeterHue(freeRatio: number) {
  return Math.round(Math.min(1, Math.max(0, (freeRatio - 0.05) / 0.35)) * 135);
}

export function SpaceMeter({ usedBytes, totalBytes, tone }: { usedBytes: number; totalBytes: number; tone?: "accent" }) {
  const ratio = totalBytes > 0 ? Math.min(1, Math.max(0, usedBytes / totalBytes)) : 0;
  const level = tone || (ratio >= 0.95 ? "danger" : ratio >= 0.85 ? "warning" : "normal");
  const color = tone ? undefined : `hsl(${spaceMeterHue(1 - ratio)} 72% 52%)`;
  return <span className="cl-space-meter" data-level={level} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={`${Math.round(ratio * 100)}% used`}>
    <span style={{ width: `${(ratio * 100).toFixed(1)}%`, background: color }} />
  </span>;
}

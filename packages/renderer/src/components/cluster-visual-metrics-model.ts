/** Pure data math for passive UI charts. Unknown denominators stay unknown. */
export function boundedRatio(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(1, Math.max(0, value / total));
}

export function visualBarHeight(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.min(100, value / maximum * 100);
}

/** Relative width for comparisons sharing the same positive maximum. Invalid values do not draw a bar. */
export function visualRankWidth(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || value <= 0 || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, value / maximum * 100));
}

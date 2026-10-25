export type VisualDataState = "ready" | "loading" | "empty" | "partial" | "stale" | "unavailable" | "error";
export type VisualTone = "neutral" | "info" | "accent" | "success" | "good" | "warning" | "danger";
export type VisualDatum = { id: string; label: string; value?: number | string; detail?: string; tone?: VisualTone; state?: VisualDataState };
export type VisualSelection = { visualId: string; datumId: string; label: string };
export type VisualDensity = "compact" | "comfortable" | "spacious";
export type VisualInteractionMode = "read-only" | "select";
export const clampVisualValue = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const visualStateLabel = (state: VisualDataState) => ({ready:"Ready",loading:"Loading",empty:"No data",partial:"Partial data",stale:"Stale data",unavailable:"Unavailable",error:"Error"}[state]);
export function visualDelta(current: number, previous: number) { const delta=current-previous; return { delta, direction: delta>0?"up":delta<0?"down":"flat" as const, label:`${delta>0?"+":""}${delta}` }; }

export function visualPercent(value: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return clampVisualValue((value / total) * 100);
}
export function visualToneForPercent(value: number, thresholds = { success: 80, warning: 50 }): VisualTone {
  const normalized = clampVisualValue(value);
  return normalized >= thresholds.success ? "success" : normalized >= thresholds.warning ? "warning" : "danger";
}

/** Shared sizing rules for persisted workspace dividers. Never treat missing storage as zero. */
export function clampClusterWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), Math.round(value)));
}

export function readClusterWidth(key: string, fallback: number, min: number, max: number): number {
  const defaultWidth = clampClusterWidth(fallback, min, max);
  if (typeof window === "undefined") return defaultWidth;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return defaultWidth;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? clampClusterWidth(parsed, min, max) : defaultWidth;
  } catch {
    // Browsers can deny storage (private contexts, embedded windows, policy).
    return defaultWidth;
  }
}

export function persistClusterWidth(key: string, width: number): void {
  try { window.localStorage.setItem(key, String(width)); } catch { /* sizing still works in memory */ }
}

/** Retain the user's preference while reserving room for the main pane. */
export function availableClusterWidth(containerWidth: number, reservedMain: number, handle: number): number {
  return Number.isFinite(containerWidth) ? Math.max(0, containerWidth - reservedMain - handle) : Number.POSITIVE_INFINITY;
}

/** Shared, bounded Retry-After coordination for safe reads. Never delays writes. */
const RATE_LIMIT_BACKOFF_MAX_MS = 60_000;
const windows = new Map<string, number>();

export function readTrafficLane(path: string, method: string): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const pathname = path.split("?")[0];
  if (pathname === "/api/meta/compatibility") return "api-compatibility";
  if (["/api/notifications/summary", "/api/time/active", "/api/calendar/upcoming", "/api/library/summary", "/api/me/presence"].includes(pathname) || pathname.startsWith("/api/presence/")) return "api-live";
  if (pathname === "/api/library/workspace" || pathname.startsWith("/api/library/collections")) return "api-library";
  if (pathname.startsWith("/api/admin/inventory/") || pathname.startsWith("/api/inventory/")) return "api-inventory";
  if (pathname.startsWith("/api/timeline")) return "api-timeline";
  if (pathname.startsWith("/api/admin/")) return "api-admin";
  return "api";
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(RATE_LIMIT_BACKOFF_MAX_MS, Math.ceil(milliseconds))) : 0;
}

export function noteReadRateLimit(lane: string, retryAfter: string | null, now = Date.now()): void {
  const duration = retryAfterMilliseconds(retryAfter, now) || 1_000;
  windows.set(lane, Math.max(windows.get(lane) || 0, now + duration));
}

export function rateLimitCooldownRemaining(lane: string, now = Date.now()): number {
  const until = windows.get(lane) || 0;
  if (until <= now) { windows.delete(lane); return 0; }
  return until - now;
}

export async function readRateLimitCooldown(lane: string, signal?: AbortSignal | null): Promise<void> {
  // Recheck after wake: another response may extend the same server window.
  // Never create a spinning retry loop or swallow an abort request.
  while (true) {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const remaining = rateLimitCooldownRemaining(lane);
    if (!remaining) return;
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Request aborted", "AbortError")); };
      timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, remaining);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

export function resetReadRateLimitCooldowns(): void { windows.clear(); }

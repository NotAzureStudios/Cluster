/** Shared, bounded Retry-After coordination for safe reads. Never delays writes. */
const RATE_LIMIT_BACKOFF_MAX_MS = 60_000;
const windows = new Map<string, number>();
// Resetting a server/session window must also wake readers parked on its timer.
const pendingWakeups = new Set<() => void>();
let rateLimitGeneration = 0;

export function readRateLimitGeneration(): number { return rateLimitGeneration; }

export function readTrafficLane(path: string, method: string): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const pathname = path.split("?")[0];
  if (method === "GET" && pathname === "/api/meta/compatibility") return "api-compatibility";
  // The server admits provisioning progress independently of ordinary reads.
  if (method === "GET" && /^\/api\/projects\/provision\/[^/]+$/.test(pathname)) return "api-project-progress";
  if (method === "GET" && (["/api/notifications/summary", "/api/time/active", "/api/calendar/upcoming", "/api/library/summary", "/api/me/presence"].includes(pathname) || pathname.startsWith("/api/presence/"))) return "api-live";
  if (pathname === "/api/library/workspace" || pathname.startsWith("/api/library/collections")) return "api-library";
  if (pathname.startsWith("/api/admin/inventory/") || pathname.startsWith("/api/inventory/")) return "api-inventory";
  if (pathname.startsWith("/api/timeline")) return "api-timeline";
  if (pathname.startsWith("/api/admin/")) return "api-admin";
  return "api";
}

/** Reads may hit both their transport budget and independent user-scoped or
 * integration budgets. Delay only the quota that actually rejected a read. */
export function readTrafficLanes(path: string, method: string): string[] {
  const primary = readTrafficLane(path, method);
  if (!primary) return [];
  const pathname = path.split("?")[0];
  const lanes = [primary];
  if (method === "GET" && pathname === "/api/command/search") lanes.push("search-user");
  if (method === "GET" && /(?:\/export$|\/status-reports\/generate$)/.test(pathname)) lanes.push("export-user");
  if (pathname.startsWith("/api/admin/discord")
    || /^\/api\/projects\/[^/]+\/discord(?:\/|$)/.test(pathname)
    || pathname.startsWith("/api/integrations/discord")
    || pathname.includes("/source-control")) lanes.push("external");
  return lanes;
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
      const wake = () => {
        clearTimeout(timer);
        pendingWakeups.delete(wake);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        pendingWakeups.delete(wake);
        signal?.removeEventListener("abort", abort);
        reject(new DOMException("Request aborted", "AbortError"));
      };
      const timer = setTimeout(wake, remaining);
      pendingWakeups.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

export function resetReadRateLimitCooldowns(): void {
  rateLimitGeneration += 1;
  windows.clear();
  for (const wake of [...pendingWakeups]) wake();
}

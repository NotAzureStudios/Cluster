import { api, queryApi } from "./api";

/**
 * Starts the requests every signed-in start needs while the application shell
 * chunk is still downloading, instead of after it has mounted.
 *
 * Before: shell downloads, then setup status, then /api/me, then settings and
 * projects, each waiting for the one before. Now setup status and /api/me go
 * out together straight away, and settings and projects follow as soon as
 * /api/me names a signed-in user.
 *
 * Nothing here decides anything. The shell's own startup consumes the first
 * two results once (takePrimedClusterStartup), and its normal settings and
 * projects loads join the requests below through the query cache, because the
 * paths and options are the same as in ClusterApplication.
 */

export type PrimedStartupUser = { id?: string } & Record<string, unknown>;
export type PrimedClusterStartup = {
  setupStatus: Promise<unknown>;
  me: Promise<{ user: PrimedStartupUser | null }>;
};

let primed: PrimedClusterStartup | null = null;

export function primeClusterStartup() {
  if (primed || typeof window === "undefined") return;
  // Public share links never run the signed-in startup sequence.
  if (new URLSearchParams(window.location.search).get("share")) return;
  const setupStatus = queryApi<unknown>("/api/setup/status", { staleMs: 0, force: true });
  const me = api<{ user: PrimedStartupUser | null }>("/api/me");
  // Unconsumed failures (the shell never mounted) must not surface as
  // unhandled rejections; the shell still sees them through its own awaits.
  setupStatus.catch(() => undefined);
  me.then((result) => {
    if (!result?.user) return;
    // Same paths and options as loadAppSettings() and loadProjects().
    void queryApi("/api/settings", { staleMs: 30_000 }).catch(() => undefined);
    void queryApi("/api/projects", { staleMs: 60_000, maxAgeMs: 5 * 60_000, tags: ["projects"] }).catch(() => undefined);
  }).catch(() => undefined);
  primed = { setupStatus, me };
}

/** Hands the primed requests to the first startup attempt. Retries fetch afresh. */
export function takePrimedClusterStartup(): PrimedClusterStartup | null {
  const value = primed;
  primed = null;
  return value;
}

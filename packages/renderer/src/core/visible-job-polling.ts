import { refreshRetryDelayMs } from "./refresh-backoff.js";

/**
 * A narrowly scoped polling loop for an active background operation.
 *
 * Unlike setInterval plus a visibility guard, hidden documents have no
 * scheduled timer. A refresh completes before its next scheduled attempt.
 * The caller is still responsible for authority checks and terminal states.
 */
export function startVisibleJobPolling(
  refresh: () => Promise<unknown> | unknown,
  requestedIntervalMs: number,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  const intervalMs = Math.max(1_000, Math.round(requestedIntervalMs));
  let disposed = false;
  let timer: number | null = null;
  let inFlight = false;
  let refreshOnCompletion = false;
  let consecutiveFailures = 0;
  let retryNotBefore = 0;

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    if (disposed || document.visibilityState !== "visible") return;
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, Math.max(1, Math.round(delayMs)));
  };

  const run = async () => {
    if (disposed || document.visibilityState !== "visible") return;
    if (inFlight) {
      refreshOnCompletion = true;
      return;
    }
    // A visibility/focus recovery must not bypass an active 429 window.
    const remaining = retryNotBefore - Date.now();
    if (remaining > 0) { schedule(remaining); return; }
    clearTimer();
    inFlight = true;
    let failed = false;
    try {
      await refresh();
      consecutiveFailures = 0;
      retryNotBefore = 0;
    } catch (error) {
      failed = true;
      consecutiveFailures += 1;
      retryNotBefore = Date.now() + refreshRetryDelayMs(intervalMs, consecutiveFailures, error);
      // Callers own error presentation. Retrying at the original fixed
      // interval would amplify an existing server overload or network fault.
    } finally {
      inFlight = false;
      if (disposed || document.visibilityState !== "visible") return;
      const requestedDuringRun = refreshOnCompletion;
      refreshOnCompletion = false;
      if (failed) schedule(Math.max(1, retryNotBefore - Date.now()));
      else if (requestedDuringRun) void run();
      else schedule(intervalMs);
    }
  };

  const onVisibilityChange = () => {
    clearTimer();
    if (document.visibilityState === "visible") void run();
    else refreshOnCompletion = false;
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  void run();
  return () => {
    disposed = true;
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

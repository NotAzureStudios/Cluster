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

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const run = async () => {
    if (disposed || document.visibilityState !== "visible") return;
    if (inFlight) {
      refreshOnCompletion = true;
      return;
    }
    clearTimer();
    inFlight = true;
    try {
      await refresh();
    } catch {
      // Callers own error presentation. A failed poll should not permanently
      // disable recovery after temporary network errors.
    } finally {
      inFlight = false;
      if (disposed || document.visibilityState !== "visible") return;
      if (refreshOnCompletion) {
        refreshOnCompletion = false;
        void run();
      } else {
        clearTimer();
        timer = window.setTimeout(() => {
          timer = null;
          void run();
        }, intervalMs);
      }
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

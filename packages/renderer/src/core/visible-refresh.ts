import { useEffect, useRef } from "react";
import { refreshRetryDelayMs } from "./refresh-backoff.js";

export type VisibleRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
  requireOnline?: boolean;
  refreshOnFocus?: boolean;
  refreshOnVisible?: boolean;
  refreshOnOnline?: boolean;
  minimumGapMs?: number;
};

/**
 * Runs one bounded refresh loop for views that already have realtime transport but
 * still need a polling/recovery fallback. Hidden documents do not keep a timer
 * alive; visibility recovery restarts the loop and performs one immediate refresh.
 */
export function useVisibleRefresh(refresh: () => Promise<unknown> | unknown, options: VisibleRefreshOptions = {}) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  refreshRef.current = refresh;

  const enabled = options.enabled !== false;
  const intervalMs = Math.max(5_000, options.intervalMs ?? 20_000);
  const requireOnline = options.requireOnline !== false;
  const refreshOnFocus = options.refreshOnFocus !== false;
  const refreshOnVisible = options.refreshOnVisible !== false;
  const refreshOnOnline = options.refreshOnOnline !== false;
  const minimumGapMs = Math.max(0, Math.min(intervalMs, options.minimumGapMs ?? 750));

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;
    let cancelled = false;
    let timer = 0;
    let recoveryTimer = 0;
    let lastStartedAt = 0;
    let lastRecoveryAt = Date.now();
    // Focus and visibility can fire together, and quickly switching tabs can
    // otherwise wake every mounted workspace poller on each transition.
    const recoveryGapMs = Math.max(12_000, minimumGapMs);
    let rerunRequested = false;
    let consecutiveFailures = 0;
    let retryNotBefore = 0;

    const run = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (requireOnline && typeof navigator !== "undefined" && !navigator.onLine) return;
      if (inFlightRef.current) { rerunRequested = true; return; }
      // Focus, reconnect and regular polling share the same Retry-After budget.
      if (Date.now() < retryNotBefore) return;
      const elapsed = Date.now() - lastStartedAt;
      if (elapsed < minimumGapMs) return;
      lastStartedAt = Date.now();
      inFlightRef.current = true;
      try {
        await refreshRef.current();
        consecutiveFailures = 0;
        retryNotBefore = 0;
      } catch (error) {
        consecutiveFailures += 1;
        retryNotBefore = Date.now() + refreshRetryDelayMs(intervalMs, consecutiveFailures, error);
        // Keep the current view; the bounded fallback resumes after backoff.
      } finally {
        inFlightRef.current = false;
        if (rerunRequested && !cancelled) {
          rerunRequested = false;
          const remainingGap = Math.max(0, minimumGapMs - (Date.now() - lastStartedAt), retryNotBefore - Date.now());
          if (remainingGap === 0) void run();
          else {
            if (recoveryTimer) window.clearTimeout(recoveryTimer);
            recoveryTimer = window.setTimeout(() => { recoveryTimer = 0; void run(); }, remainingGap);
          }
        }
      }
    };
    const clearTimer = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const schedule = () => {
      clearTimer();
      if (cancelled || document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        timer = 0;
        await run();
        schedule();
      }, Math.max(intervalMs, retryNotBefore - Date.now()));
    };
    const request = () => { void run(); };
    const requestRecovery = () => {
      const now = Date.now();
      if (now - lastRecoveryAt < recoveryGapMs) return;
      lastRecoveryAt = now;
      request();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") { clearTimer(); return; }
      if (refreshOnVisible) requestRecovery();
      schedule();
    };
    const onFocus = () => { requestRecovery(); schedule(); };
    const onOnline = () => { request(); schedule(); };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    if (refreshOnFocus) window.addEventListener("focus", onFocus);
    if (refreshOnOnline) window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearTimer();
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      recoveryTimer = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      if (refreshOnFocus) window.removeEventListener("focus", onFocus);
      if (refreshOnOnline) window.removeEventListener("online", onOnline);
    };
  }, [enabled, intervalMs, minimumGapMs, requireOnline, refreshOnFocus, refreshOnVisible, refreshOnOnline]);
}

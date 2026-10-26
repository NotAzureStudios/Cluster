import { useEffect, useRef } from "react";
import type { ClusterResourceKind } from "@cluster/shared";
import { resourceChangeMatches, subscribeResourceChanges, subscribeResourceChangeFeedResets } from "./resource-change-client";

export function useResourceChangeRefresh(
  refresh: () => Promise<unknown> | unknown,
  options: {
    enabled?: boolean;
    kinds?: readonly ClusterResourceKind[];
    projectId?: string | null;
    tags?: readonly string[];
    debounceMs?: number;
    visibleOnly?: boolean;
  } = {},
) {
  const refreshRef = useRef(refresh);
  const dirtyRef = useRef(false);
  const timerRef = useRef(0);
  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (options.enabled === false || typeof window === "undefined") return;
    let stopped = false;
    const delay = Math.max(0, options.debounceMs ?? 180);
    // Resource-change events are synchronization, not decorative polling. Keep mounted
    // workspaces current while hidden unless a caller explicitly opts into visible-only work.
    const visibleOnly = options.visibleOnly === true;

    const run = async () => {
      timerRef.current = 0;
      if (stopped) return;
      if (visibleOnly && typeof document !== "undefined" && document.visibilityState !== "visible") {
        dirtyRef.current = true;
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        dirtyRef.current = true;
        return;
      }
      if (inFlightRef.current) {
        rerunRef.current = true;
        return;
      }
      dirtyRef.current = false;
      inFlightRef.current = true;
      try { await refreshRef.current(); }
      catch { dirtyRef.current = true; }
      finally {
        inFlightRef.current = false;
        if (rerunRef.current && !stopped) {
          rerunRef.current = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (stopped) return;
      dirtyRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const scheduledDelay = !visibleOnly && typeof document !== "undefined" && document.visibilityState !== "visible"
        ? Math.max(delay, 2_000)
        : delay;
      timerRef.current = window.setTimeout(() => { void run(); }, scheduledDelay);
    };

    const unsubscribe = subscribeResourceChanges((detail) => {
      if (resourceChangeMatches(detail, options)) schedule();
    });
    // The SSE cursor may advance over disabled/unavailable resources. On
    // re-enable, expiration, or transport overflow no individual event can
    // represent all missed changes; refresh mounted consumers once instead.
    const unsubscribeReset = subscribeResourceChangeFeedResets(() => schedule());
    const onVisibility = () => {
      if (document.visibilityState === "visible" && dirtyRef.current) schedule();
    };
    const onOnline = () => { if (dirtyRef.current) schedule(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      unsubscribe();
      unsubscribeReset();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [options.enabled, options.projectId, options.debounceMs, options.visibleOnly, (options.kinds || []).join("|"), (options.tags || []).join("|")]);
}

import { useEffect, useRef } from "react";

/**
 * Drives clocks/elapsed-time labels only while the document is visible. Unlike a
 * normal interval with a visibility guard, hidden tabs keep no ticking timer alive.
 */
export function useVisibleTicker(tick: () => void, intervalMs = 1_000, enabled = true) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;
    let timer = 0;
    const clear = () => { if (timer) window.clearInterval(timer); timer = 0; };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      tickRef.current();
      timer = window.setInterval(() => tickRef.current(), Math.max(250, intervalMs));
    };
    const onVisibility = () => start();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clear(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [enabled, intervalMs]);
}

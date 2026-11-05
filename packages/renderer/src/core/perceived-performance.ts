import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";

const SCROLL_PREFIX = "cluster-scroll:";
const MAX_SCROLL_TOP = 10_000_000;

function readScrollPosition(key: string) {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.sessionStorage.getItem(`${SCROLL_PREFIX}${key}`) || 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(MAX_SCROLL_TOP, value)) : 0;
  } catch {
    return 0;
  }
}

function writeScrollPosition(key: string, scrollTop: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${SCROLL_PREFIX}${key}`, String(Math.max(0, Math.min(MAX_SCROLL_TOP, Math.round(scrollTop)))));
  } catch {
    // Scroll restoration is a progressive enhancement. Storage can be unavailable in hardened/private runtimes.
  }
}

export function usePersistedScrollPosition(key: string) {
  const elementRef = useRef<HTMLDivElement>(null);
  const latestScrollTop = useRef(readScrollPosition(key));
  const frameRef = useRef<number | null>(null);
  const persistenceTimerRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(latestScrollTop.current);

  useEffect(() => {
    const restored = readScrollPosition(key);
    latestScrollTop.current = restored;
    setScrollTop(restored);
    const frame = window.requestAnimationFrame(() => {
      if (elementRef.current) elementRef.current.scrollTop = restored;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [key]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (persistenceTimerRef.current !== null) window.clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = null;
    // Always flush the latest position on unmount or route change.
    writeScrollPosition(key, latestScrollTop.current);
  }, [key]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    // Scroll events can fire several times per paint. Update consuming lists at
    // most once per animation frame, and avoid synchronous storage on each frame.
    latestScrollTop.current = event.currentTarget.scrollTop;
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setScrollTop(latestScrollTop.current);
      });
    }
    if (persistenceTimerRef.current === null) {
      persistenceTimerRef.current = window.setTimeout(() => {
        persistenceTimerRef.current = null;
        writeScrollPosition(key, latestScrollTop.current);
      }, 250);
    }
  }, [key]);

  return { elementRef, scrollTop, onScroll };
}

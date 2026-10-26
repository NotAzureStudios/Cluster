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
    writeScrollPosition(key, latestScrollTop.current);
  }, [key]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop;
    latestScrollTop.current = next;
    setScrollTop(next);
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      writeScrollPosition(key, latestScrollTop.current);
    });
  }, [key]);

  return { elementRef, scrollTop, onScroll };
}

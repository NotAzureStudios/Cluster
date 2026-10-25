import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type WhiteboardViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WhiteboardBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const VIEWPORT_OVERSCAN = 360;

export function boundsIntersectWhiteboardViewport(bounds: WhiteboardBounds, viewport: WhiteboardViewport) {
  return (
    bounds.x + bounds.width >= viewport.x - VIEWPORT_OVERSCAN &&
    bounds.y + bounds.height >= viewport.y - VIEWPORT_OVERSCAN &&
    bounds.x <= viewport.x + viewport.width + VIEWPORT_OVERSCAN &&
    bounds.y <= viewport.y + viewport.height + VIEWPORT_OVERSCAN
  );
}

export function useWhiteboardViewport(
  wrapRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const frameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<WhiteboardViewport>({ x: 0, y: 0, width: canvasWidth, height: canvasHeight });

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    setViewport({
      x: wrap.scrollLeft / Math.max(zoom, 0.05),
      y: wrap.scrollTop / Math.max(zoom, 0.05),
      width: wrap.clientWidth / Math.max(zoom, 0.05),
      height: wrap.clientHeight / Math.max(zoom, 0.05),
    });
  }, [wrapRef, zoom]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(wrap);
    wrap.addEventListener("scroll", scheduleMeasure, { passive: true });
    document.addEventListener("visibilitychange", scheduleMeasure);
    return () => {
      observer?.disconnect();
      wrap.removeEventListener("scroll", scheduleMeasure);
      document.removeEventListener("visibilitychange", scheduleMeasure);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [measure, scheduleMeasure, wrapRef]);

  useEffect(() => {
    scheduleMeasure();
  }, [zoom, canvasWidth, canvasHeight, scheduleMeasure]);

  return viewport;
}

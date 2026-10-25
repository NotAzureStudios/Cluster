import { useCallback, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";

type Point = { x: number; y: number };
type TouchNavigationState = {
  pointers: Map<number, Point>;
  starts: Map<number, Point>;
  startScrollLeft: number;
  startScrollTop: number;
  startZoom: number;
  startDistance: number;
  anchorX: number;
  anchorY: number;
  moved: boolean;
};

type WhiteboardMobileTouchOptions = {
  canvasWrapRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  onBlankTap: () => void;
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clampZoom = (value: number) => Math.min(2.5, Math.max(0.5, Number(value.toFixed(2))));

/** One-finger blank-canvas pan plus two-finger pan/zoom for coarse touch input. */
export function useWhiteboardMobileTouchNavigation({ canvasWrapRef, zoom, setZoom, onBlankTap }: WhiteboardMobileTouchOptions) {
  const stateRef = useRef<TouchNavigationState>({ pointers: new Map(), starts: new Map(), startScrollLeft: 0, startScrollTop: 0, startZoom: 1, startDistance: 0, anchorX: 0, anchorY: 0, moved: false });

  const rebase = useCallback(() => {
    const wrap = canvasWrapRef.current;
    const state = stateRef.current;
    if (!wrap) return;
    state.starts = new Map(state.pointers);
    state.startScrollLeft = wrap.scrollLeft;
    state.startScrollTop = wrap.scrollTop;
    state.startZoom = zoom;
    state.moved = false;
    const points = Array.from(state.pointers.values());
    if (points.length >= 2) {
      const mid = midpoint(points[0], points[1]);
      const rect = wrap.getBoundingClientRect();
      state.startDistance = Math.max(1, distance(points[0], points[1]));
      state.anchorX = (wrap.scrollLeft + mid.x - rect.left) / Math.max(zoom, 0.1);
      state.anchorY = (wrap.scrollTop + mid.y - rect.top) / Math.max(zoom, 0.1);
    }
  }, [canvasWrapRef, zoom]);

  const pointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "touch") return false;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    stateRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    rebase();
    return true;
  }, [rebase]);

  const pointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const state = stateRef.current;
    if (event.pointerType !== "touch" || !state.pointers.has(event.pointerId)) return false;
    const wrap = canvasWrapRef.current;
    if (!wrap) return true;
    event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(state.pointers.values());
    if (points.length >= 2 && state.startDistance > 0) {
      const nextZoom = clampZoom(state.startZoom * (distance(points[0], points[1]) / state.startDistance));
      const mid = midpoint(points[0], points[1]);
      const rect = wrap.getBoundingClientRect();
      state.moved = state.moved || Math.abs(nextZoom - state.startZoom) >= 0.02;
      setZoom(nextZoom);
      wrap.scrollTo({ left: Math.max(0, state.anchorX * nextZoom - (mid.x - rect.left)), top: Math.max(0, state.anchorY * nextZoom - (mid.y - rect.top)) });
      return true;
    }
    const start = state.starts.get(event.pointerId);
    const current = state.pointers.get(event.pointerId);
    if (start && current) {
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      if (Math.hypot(dx, dy) > 5) state.moved = true;
      wrap.scrollTo({ left: Math.max(0, state.startScrollLeft - dx), top: Math.max(0, state.startScrollTop - dy) });
    }
    return true;
  }, [canvasWrapRef, setZoom]);

  const pointerEnd = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const state = stateRef.current;
    if (event.pointerType !== "touch" || !state.pointers.has(event.pointerId)) return false;
    const wasTap = state.pointers.size === 1 && !state.moved;
    state.pointers.delete(event.pointerId);
    state.starts.delete(event.pointerId);
    if (state.pointers.size) rebase();
    else {
      state.startDistance = 0;
      state.moved = false;
      if (wasTap) onBlankTap();
    }
    return true;
  }, [onBlankTap, rebase]);

  const cancel = useCallback(() => {
    stateRef.current.pointers.clear();
    stateRef.current.starts.clear();
    stateRef.current.startDistance = 0;
    stateRef.current.moved = false;
  }, []);

  return { pointerDown, pointerMove, pointerEnd, cancel };
}

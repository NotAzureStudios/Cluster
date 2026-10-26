import { Children, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterButton } from "./ClusterButton";
import { availableClusterWidth, clampClusterWidth, persistClusterWidth, readClusterWidth } from "./cluster-resize-sizing";

const SPLIT_STORAGE_PREFIX = "cluster:workspace-split-size:";

export function ClusterResizableSplit({
  children,
  label,
  persistKey,
  side = "end",
  className = "",
  minWidth = 280,
  maxWidth = 560,
  defaultWidth = 360,
}: {
  children: ReactNode;
  label: string;
  persistKey: string;
  side?: "start" | "end";
  className?: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const items = Children.toArray(children);
  const primary = items[0] || null;
  const secondary = items[1] || null;
  const [width, setWidth] = useState(() => readClusterWidth(`${SPLIT_STORAGE_PREFIX}${persistKey}`, defaultWidth, minWidth, maxWidth));
  const [containerWidth, setContainerWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, [Boolean(secondary)]);
  useEffect(() => {
    setWidth(readClusterWidth(`${SPLIT_STORAGE_PREFIX}${persistKey}`, defaultWidth, minWidth, maxWidth));
  }, [persistKey, defaultWidth, minWidth, maxWidth]);
  const available = availableClusterWidth(containerWidth, 290, 9);
  const effectiveMin = Math.min(minWidth, available);
  const effectiveMax = Math.max(effectiveMin, Math.min(maxWidth, available));
  const visibleWidth = clampClusterWidth(width, effectiveMin, effectiveMax);

  const commitWidth = useCallback((value: number) => {
    const next = clampClusterWidth(value, minWidth, Math.min(maxWidth, available));
    setWidth(next);
    persistClusterWidth(`${SPLIT_STORAGE_PREFIX}${persistKey}`, next);
  }, [maxWidth, minWidth, available, persistKey]);

  const resize = useCallback((clientX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const raw = side === "start" ? clientX - bounds.left : bounds.right - clientX;
    commitWidth(raw);
  }, [commitWidth, side]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => resize(moveEvent.clientX);
    const finish = (upEvent: PointerEvent) => {
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }, [resize]);

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    const grows = side === "start" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
    const next = event.key === "Home" ? effectiveMin : event.key === "End" ? effectiveMax : visibleWidth + (grows ? step : -step);
    commitWidth(next);
  }, [commitWidth, side, visibleWidth, effectiveMin, effectiveMax]);

  if (!secondary) return <div className={`cluster-resizable-split-v498 single ${className}`.trim()} data-motion-purpose="layout">{primary}</div>;

  const handle = <ClusterButton unstyled type="button" className="cluster-detail-resizer-v429 cluster-resizable-split-handle-v498" role="separator" aria-orientation="vertical" aria-valuemin={effectiveMin} aria-valuemax={effectiveMax} aria-valuenow={visibleWidth} aria-label={`Resize ${label}. Use left and right arrow keys for precise sizing.`} title={`Drag or use arrow keys to resize ${label}`} onPointerDown={beginResize} onKeyDown={resizeWithKeyboard} />;

  return (
    <div ref={rootRef} className={`cluster-resizable-split-v498 ${className}`.trim()} data-side={side} data-motion-purpose="layout" style={runtimeStyle({ "--cluster-split-width": `${visibleWidth}px` })}>
      {side === "start" ? <>{secondary}{handle}{primary}</> : <>{primary}{handle}{secondary}</>}
    </div>
  );
}

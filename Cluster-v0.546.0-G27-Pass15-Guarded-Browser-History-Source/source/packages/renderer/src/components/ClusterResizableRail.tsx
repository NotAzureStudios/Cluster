import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterButton } from "./ClusterButton";
import { availableClusterWidth, clampClusterWidth, persistClusterWidth, readClusterWidth } from "./cluster-resize-sizing";

const RAIL_STORAGE_PREFIX = "cluster:workspace-rail-size:";

export function ClusterResizableRail({
  rail,
  children,
  label,
  persistKey,
  className = "",
  minWidth = 180,
  maxWidth = 420,
  defaultWidth = 230,
  collapsed = false,
}: {
  rail: ReactNode;
  children: ReactNode;
  label: string;
  persistKey: string;
  className?: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  collapsed?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => readClusterWidth(`${RAIL_STORAGE_PREFIX}${persistKey}`, defaultWidth, minWidth, maxWidth));
  const [containerWidth, setContainerWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setWidth(readClusterWidth(`${RAIL_STORAGE_PREFIX}${persistKey}`, defaultWidth, minWidth, maxWidth));
  }, [persistKey, defaultWidth, minWidth, maxWidth]);

  const available = availableClusterWidth(containerWidth, 290, 7);
  const effectiveMin = Math.min(minWidth, available);
  const effectiveMax = Math.max(effectiveMin, Math.min(maxWidth, available));
  const visibleWidth = clampClusterWidth(width, effectiveMin, effectiveMax);
  const commitWidth = useCallback((value: number) => {
    const next = clampClusterWidth(value, minWidth, Math.min(maxWidth, available));
    setWidth(next);
    persistClusterWidth(`${RAIL_STORAGE_PREFIX}${persistKey}`, next);
  }, [minWidth, maxWidth, available, persistKey]);

  const resize = useCallback((clientX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    commitWidth(clientX - bounds.left);
  }, [commitWidth]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (collapsed || window.matchMedia("(max-width: 980px)").matches) return;
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
  }, [resize, collapsed]);

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    const next = event.key === "Home" ? effectiveMin : event.key === "End" ? effectiveMax
      : visibleWidth + (event.key === "ArrowRight" ? step : -step);
    commitWidth(next);
  }, [commitWidth, visibleWidth, effectiveMin, effectiveMax]);

  return (
    <div
      ref={rootRef}
      className={`cluster-resizable-rail-v497 ${collapsed ? "rail-collapsed" : ""} ${className}`.trim()}
      style={runtimeStyle({ "--cluster-rail-width": `${visibleWidth}px` })}
      data-rail-collapsed={collapsed ? "true" : "false"}
    >
      {!collapsed ? <div className="cluster-resizable-rail-content-v497">{rail}</div> : null}
      {!collapsed ? <ClusterButton unstyled type="button" className="cluster-resizable-rail-handle-v497" role="separator" aria-orientation="vertical" aria-valuemin={effectiveMin} aria-valuemax={effectiveMax} aria-valuenow={visibleWidth} aria-label={`Resize ${label}`} title={`Drag or use arrow keys to resize ${label}`} onPointerDown={beginResize} onKeyDown={resizeWithKeyboard} /> : null}
      <div className="cluster-resizable-main-v497">{children}</div>
    </div>
  );
}

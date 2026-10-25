import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export function ClusterResizeHandle({
  label,
  value,
  min,
  max,
  step = 16,
  direction = 1,
  onChange,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  direction?: 1 | -1;
  onChange: (value: number) => void;
  className?: string;
}) {
  const startRef = useRef<{ x: number; value: number } | null>(null);
  const clamp = (candidate: number) => Math.max(min, Math.min(max, Math.round(candidate)));

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    startRef.current = { x: event.clientX, value };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(clamp(start.value + ((event.clientX - start.x) * direction)));
  }
  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    startRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") { onChange(min); return; }
    if (event.key === "End") { onChange(max); return; }
    const physicalDelta = event.key === "ArrowRight" ? step : -step;
    onChange(clamp(value + (physicalDelta * direction)));
  }

  return <div
    className={className}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={Math.round(value)}
    tabIndex={0}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerEnd}
    onPointerCancel={pointerEnd}
    onKeyDown={keyDown}
  ><span aria-hidden="true">↔</span></div>;
}

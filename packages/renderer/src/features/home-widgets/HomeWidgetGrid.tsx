import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ClusterActionMenu, type ClusterActionMenuItem } from "../../components/ClusterContextActions";
import { ClusterIcon } from "../../components/ClusterIcon";
import {
  HOME_GRID_COLUMNS,
  HOME_WIDGET_SIZES,
  HOME_WIDGET_SIZE_ORDER,
  gridRows,
  moveGridItem,
  nearestSize,
  readingOrder,
  resizeGridItem,
  type HomeWidgetSize,
} from "./home-widget-grid";
import { homeWidgetRegistryEntry, type HomeWidgetPlacement } from "./home-widget-model";

/* Below this width the grid stops being a free canvas and becomes a flow in
   reading order: two columns on a phone, four on a tablet. */
const GRID_MIN_WIDTH = 880;
const DRAG_THRESHOLD = 5;
const EDGE_SCROLL = 64;

type Gesture = {
  kind: "move" | "resize";
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  offsetX: number;
  offsetY: number;
  base: HomeWidgetPlacement[];
  active: boolean;
};

type Live = { id: string; kind: "move" | "resize"; preview: HomeWidgetPlacement[]; left?: number; top?: number };

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let current = node?.parentElement || null; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
  }
  return null;
}

export function HomeWidgetGrid({
  items,
  editMode,
  renderWidget,
  onCommit,
  onRemove,
  onOptions,
  canRemove,
  ariaLabel = "Home widgets",
}: {
  items: HomeWidgetPlacement[];
  editMode: boolean;
  renderWidget: (item: HomeWidgetPlacement) => ReactNode;
  onCommit: (items: HomeWidgetPlacement[]) => void;
  onRemove: (id: string) => void;
  onOptions: (id: string) => void;
  canRemove: (id: string) => boolean;
  ariaLabel?: string;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);
  const scrollFrameRef = useRef(0);
  const [live, setLive] = useState<Live | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const mode: "grid" | "flow" = width === 0 || width >= GRID_MIN_WIDTH ? "grid" : "flow";
  const flowColumns = width < 560 ? 2 : 4;
  const shown = live?.preview || items;
  const rows = gridRows(shown);

  const metrics = useCallback(() => {
    const node = gridRef.current!;
    const style = getComputedStyle(node);
    const gap = Number.parseFloat(style.getPropertyValue("--hw-gap")) || 12;
    const row = Number.parseFloat(style.getPropertyValue("--hw-row")) || 84;
    const rect = node.getBoundingClientRect();
    const column = (rect.width - gap * (HOME_GRID_COLUMNS - 1)) / HOME_GRID_COLUMNS;
    return { rect, gap, row, column };
  }, []);

  const update = useCallback((clientX: number, clientY: number) => {
    const gesture = gestureRef.current;
    if (!gesture || !gridRef.current) return;
    gesture.lastX = clientX;
    gesture.lastY = clientY;
    if (!gesture.active) {
      if (Math.hypot(clientX - gesture.startX, clientY - gesture.startY) < DRAG_THRESHOLD) return;
      gesture.active = true;
      document.documentElement.dataset.homeWidgetGesture = gesture.kind;
    }
    const { rect, gap, row, column } = metrics();
    const item = gesture.base.find((entry) => entry.id === gesture.id)!;
    if (gesture.kind === "move") {
      const left = clientX - rect.left - gesture.offsetX;
      const top = clientY - rect.top - gesture.offsetY;
      const x = Math.round(left / (column + gap));
      const y = Math.round(top / (row + gap));
      setLive({ id: gesture.id, kind: "move", preview: moveGridItem(gesture.base, gesture.id, x, y), left, top });
    } else {
      const cardLeft = rect.left + item.x * (column + gap);
      const cardTop = rect.top + item.y * (row + gap);
      const w = (clientX - cardLeft + gap) / (column + gap);
      const h = (clientY - cardTop + gap) / (row + gap);
      const size = nearestSize(w, h, homeWidgetRegistryEntry(item.id)?.sizes || HOME_WIDGET_SIZE_ORDER);
      setLive({ id: gesture.id, kind: "resize", preview: resizeGridItem(gesture.base, gesture.id, size) });
    }
  }, [metrics]);

  const stopEdgeScroll = () => { cancelAnimationFrame(scrollFrameRef.current); scrollFrameRef.current = 0; };
  const edgeScroll = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture?.active) { scrollFrameRef.current = 0; return; }
    const scroller = scrollParent(gridRef.current);
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const speed = gesture.lastY < top + EDGE_SCROLL ? -Math.ceil((top + EDGE_SCROLL - gesture.lastY) / 4)
      : gesture.lastY > bottom - EDGE_SCROLL ? Math.ceil((gesture.lastY - (bottom - EDGE_SCROLL)) / 4) : 0;
    if (speed) {
      if (scroller) scroller.scrollTop += speed; else window.scrollBy(0, speed);
      update(gesture.lastX, gesture.lastY);
    }
    scrollFrameRef.current = requestAnimationFrame(edgeScroll);
  }, [update]);

  const finish = useCallback((commit: boolean) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    stopEdgeScroll();
    delete document.documentElement.dataset.homeWidgetGesture;
    setLive((current) => {
      if (commit && gesture?.active && current) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        const changed = current.preview.some((entry) => {
          const before = gesture.base.find((item) => item.id === entry.id);
          return !before || before.x !== entry.x || before.y !== entry.y || before.size !== entry.size;
        });
        if (changed) onCommit(current.preview);
      }
      return null;
    });
  }, [onCommit]);

  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [Boolean(live), finish]);

  useEffect(() => () => { stopEdgeScroll(); delete document.documentElement.dataset.homeWidgetGesture; }, []);
  useEffect(() => { if (!editMode && gestureRef.current) finish(false); }, [editMode, finish]);

  function begin(event: ReactPointerEvent<HTMLElement>, item: HomeWidgetPlacement, kind: Gesture["kind"]) {
    if (!editMode || mode !== "grid" || event.button !== 0 || gestureRef.current) return;
    if (kind === "move" && (event.target as HTMLElement).closest("button, a, input, textarea, select, [data-hw-no-drag]")) return;
    const card = (event.currentTarget.closest("[data-hw-item]") || event.currentTarget) as HTMLElement;
    const cardRect = card.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind, id: item.id, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
      offsetX: event.clientX - cardRect.left, offsetY: event.clientY - cardRect.top,
      base: items, active: false,
    };
    if (!scrollFrameRef.current) scrollFrameRef.current = requestAnimationFrame(edgeScroll);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) update(event.clientX, event.clientY);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) finish(true);
  }
  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) finish(false);
  }

  function stepSize(item: HomeWidgetPlacement, delta: -1 | 1) {
    const allowed = homeWidgetRegistryEntry(item.id)?.sizes || HOME_WIDGET_SIZE_ORDER;
    const index = allowed.indexOf(item.size);
    const next = allowed[Math.max(0, Math.min(allowed.length - 1, index + delta))];
    if (next && next !== item.size) onCommit(resizeGridItem(items, item.id, next));
  }
  function moveInOrder(item: HomeWidgetPlacement, delta: -1 | 1) {
    const order = readingOrder(items);
    const neighbour = order[order.findIndex((entry) => entry.id === item.id) + delta];
    if (neighbour) onCommit(moveGridItem(items, item.id, neighbour.x, neighbour.y));
  }
  function onItemKeyDown(event: ReactKeyboardEvent<HTMLElement>, item: HomeWidgetPlacement) {
    if (!editMode || event.target !== event.currentTarget) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (step[event.key]) {
      event.preventDefault();
      if (mode === "flow") moveInOrder(item, event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
      else onCommit(moveGridItem(items, item.id, item.x + step[event.key][0] * (event.shiftKey ? 3 : 1), item.y + step[event.key][1]));
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); stepSize(item, 1); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); stepSize(item, -1); }
    else if ((event.key === "Delete" || event.key === "Backspace") && canRemove(item.id)) { event.preventDefault(); onRemove(item.id); }
  }

  function menuItems(item: HomeWidgetPlacement): ClusterActionMenuItem[] {
    const entry = homeWidgetRegistryEntry(item.id);
    const sizes = (entry?.sizes || HOME_WIDGET_SIZE_ORDER).map((size, index): ClusterActionMenuItem => ({
      id: `size-${size}`, label: HOME_WIDGET_SIZES[size].label, icon: size === item.size ? "check" : undefined,
      separatorBefore: index === 0 ? false : undefined,
      onSelect: () => onCommit(resizeGridItem(items, item.id, size)),
    }));
    const order = mode === "flow" ? readingOrder(items) : [];
    const position = order.findIndex((entry) => entry.id === item.id);
    return [
      ...sizes,
      ...(mode === "flow" ? [
        { id: "earlier", label: "Move up", icon: "chevron-up" as const, separatorBefore: true, disabled: position <= 0, onSelect: () => moveInOrder(item, -1) },
        { id: "later", label: "Move down", icon: "chevron-down" as const, disabled: position >= order.length - 1, onSelect: () => moveInOrder(item, 1) },
      ] : []),
      ...(entry?.configuration.length ? [{ id: "options", label: "Options…", icon: "settings" as const, separatorBefore: true, onSelect: () => onOptions(item.id) }] : []),
      ...(canRemove(item.id) ? [{ id: "remove", label: "Remove", icon: "minus" as const, danger: true, separatorBefore: !entry?.configuration.length, onSelect: () => onRemove(item.id) }] : []),
    ];
  }

  const ordered = mode === "flow" ? readingOrder(shown) : shown;
  const placeholder = live?.kind === "move" ? live.preview.find((entry) => entry.id === live.id) : undefined;
  const guideRows = Math.max(rows + (editMode ? 2 : 0), 1);

  return (
    <div
      ref={gridRef}
      className="hw-grid"
      data-mode={mode}
      data-editing={editMode ? "true" : "false"}
      data-gesture={live?.kind}
      role="list"
      aria-label={ariaLabel}
      style={{ "--hw-rows": String(guideRows), "--hw-flow-cols": String(flowColumns) } as CSSProperties}
    >
      {editMode && mode === "grid" && <div className="hw-guides" aria-hidden="true">{Array.from({ length: guideRows * HOME_GRID_COLUMNS }, (_, index) => <i key={index} />)}</div>}
      {placeholder && <div className="hw-slot" aria-hidden="true" style={{ "--x": placeholder.x, "--y": placeholder.y, "--w": HOME_WIDGET_SIZES[placeholder.size].w, "--h": HOME_WIDGET_SIZES[placeholder.size].h } as CSSProperties} />}
      {ordered.map((item) => {
        const { w, h } = HOME_WIDGET_SIZES[item.size];
        const entry = homeWidgetRegistryEntry(item.id);
        const dragging = live?.kind === "move" && live.id === item.id;
        const style = {
          "--x": item.x, "--y": item.y, "--w": w, "--h": h,
          "--fspan": item.size === "small" ? flowColumns / 2 : flowColumns,
          ...(dragging ? { left: `${live!.left}px`, top: `${live!.top}px` } : {}),
        } as CSSProperties;
        return (
          <div
            key={item.id}
            role="listitem"
            className="hw-item"
            data-hw-item={item.id}
            data-size={item.size}
            data-dragging={dragging ? "true" : undefined}
            data-resizing={live?.kind === "resize" && live.id === item.id ? "true" : undefined}
            style={style}
            tabIndex={editMode ? 0 : undefined}
            aria-label={editMode ? `${entry?.label || item.id}, ${HOME_WIDGET_SIZES[item.size].label}. Arrow keys move, plus and minus resize.` : undefined}
            onKeyDown={(event) => onItemKeyDown(event, item)}
            onPointerDown={(event) => begin(event, item, "move")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); } }}
          >
            <div className="hw-content" inert={editMode || undefined}>{renderWidget(item)}</div>
            {editMode && <>
              {canRemove(item.id) && <button type="button" className="hw-badge hw-remove" data-hw-no-drag aria-label={`Remove ${entry?.label || item.id}`} onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}><ClusterIcon name="minus" /></button>}
              <div className="hw-badge hw-menu" data-hw-no-drag><ClusterActionMenu iconOnly label={`${entry?.label || item.id} widget`} items={menuItems(item)} /></div>
              {mode === "grid" && (entry?.sizes.length || 0) > 1 && <span
                className="hw-resize"
                role="presentation"
                data-hw-no-drag
                onPointerDown={(event) => begin(event, item, "resize")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              />}
            </>}
          </div>
        );
      })}
    </div>
  );
}

export type { HomeWidgetSize };

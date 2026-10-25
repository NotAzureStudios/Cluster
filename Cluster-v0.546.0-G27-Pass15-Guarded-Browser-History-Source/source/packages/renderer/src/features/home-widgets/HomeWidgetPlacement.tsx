import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { HOME_WIDGET_SIZE_OPTIONS, clampHomeWidgetColumn, homeWidgetPresentationForSize, type HomeWidgetLayoutItem, type HomeWidgetSize } from "./home-widget-model";

const RESIZE_STEP_PX = 72;

function clampSizeIndex(index: number) {
  return Math.max(0, Math.min(HOME_WIDGET_SIZE_OPTIONS.length - 1, index));
}

export function HomeWidgetPlacement({
  placement,
  editMode,
  dragging,
  onSize,
  onColumn,
  onMove,
  onRemove,
  onConfigure,
  gridColumns,
  children,
}: {
  key?: string;
  placement: HomeWidgetLayoutItem;
  editMode: boolean;
  dragging?: boolean;
  onSize: (id: string, size: HomeWidgetSize) => void;
  onColumn: (id: string, column: number) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onConfigure?: (id: string) => void;
  gridColumns: number;
  children: ReactNode;
}) {
  const resizeGesture = useRef<{ startX: number; startY: number; startIndex: number; lastIndex: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<HomeWidgetSize | null>(null);
  const placementRef = useRef<HTMLDivElement | null>(null);
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDraggableNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: placement.id, disabled: !editMode, data: { type: "home-widget" } });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({ id: placement.id, disabled: !editMode, data: { type: "home-widget" } });
  const setPlacementNodeRef = useCallback((node: HTMLDivElement | null) => {
    placementRef.current = node;
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }, [setDraggableNodeRef, setDroppableNodeRef]);

  useEffect(() => { setResizePreview(null); }, [placement.size]);

  useEffect(() => {
    const placementNode = placementRef.current;
    if (!placementNode || typeof ResizeObserver === "undefined") return;
    const card = placementNode.querySelector<HTMLElement>(".home-widget-card-v484") || placementNode;
    const updateRowSpan = () => {
      const canvas = placementNode.closest<HTMLElement>(".home-widget-canvas-v484");
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      const rowUnit = Number.parseFloat(canvasStyle?.getPropertyValue("--cluster-home-grid-row") || "6") || 6;
      const rowGap = Number.parseFloat(canvasStyle?.rowGap || canvasStyle?.getPropertyValue("--cluster-home-grid-gap") || "12") || 12;
      const height = Math.max(card.getBoundingClientRect().height, card.scrollHeight);
      const span = Math.max(1, Math.ceil((height + rowGap) / (rowUnit + rowGap)));
      placementNode.style.setProperty("--cluster-home-row-span", String(span));
    };
    updateRowSpan();
    const observer = new ResizeObserver(updateRowSpan);
    observer.observe(card);
    window.addEventListener("resize", updateRowSpan);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateRowSpan); };
  }, [placement.size, editMode]);

  function previewSizeIndex(index: number) {
    const next = HOME_WIDGET_SIZE_OPTIONS[clampSizeIndex(index)]?.value;
    if (next) setResizePreview(next);
  }

  function commitSizeIndex(index: number) {
    const next = HOME_WIDGET_SIZE_OPTIONS[clampSizeIndex(index)]?.value;
    setResizePreview(null);
    if (next && next !== placement.size) onSize(placement.id, next);
  }

  function resizeByKeyboard(delta: -1 | 1) {
    const current = Math.max(0, HOME_WIDGET_SIZE_OPTIONS.findIndex((option) => option.value === placement.size));
    commitSizeIndex(current + delta);
  }

  const displaySize = resizePreview || placement.size;
  const placementStyle = {
    "--cluster-home-column": String(clampHomeWidgetColumn(placement.column, displaySize, gridColumns)),
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : {}),
  } as CSSProperties;

  return (
    <div
      ref={setPlacementNodeRef}
      className="home-widget-placement-v505"
      data-widget-size={displaySize}
      data-widget-presentation={homeWidgetPresentationForSize(displaySize)}
      data-editing={editMode ? "true" : "false"}
      data-dragging={dragging || isDragging ? "true" : "false"}
      data-resizing={resizePreview ? "true" : "false"}
      data-resize-preview={resizePreview || undefined}
      data-drop-target={editMode && isOver && !isDragging ? "true" : "false"}
      style={placementStyle}
    >
      {editMode && (
        <>
          <ClusterButton
            unstyled
            type="button"
            className="home-widget-move-handle"
            title="Drag to move widget"
            aria-label="Drag to move widget"
            ref={setActivatorNodeRef}
            {...dragAttributes}
            {...dragListeners}
          >
            <ClusterIcon name="drag" />
          </ClusterButton>
          <ClusterButton unstyled type="button" className="home-widget-remove-control" onClick={() => onRemove(placement.id)} title="Remove widget" aria-label="Remove widget">
            <ClusterIcon name="close" />
          </ClusterButton>
          {onConfigure && <ClusterButton unstyled type="button" className="home-widget-configure-control" onClick={() => onConfigure(placement.id)} title="Widget options" aria-label="Open widget options">
            <ClusterIcon name="settings" />
          </ClusterButton>}
          <ClusterButton
            unstyled
            type="button"
            className="home-widget-resize-handle"
            title="Drag to resize"
            aria-label={`Resize widget. Current size: ${placement.size}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const startIndex = Math.max(0, HOME_WIDGET_SIZE_OPTIONS.findIndex((option) => option.value === placement.size));
              resizeGesture.current = { startX: event.clientX, startY: event.clientY, startIndex, lastIndex: startIndex };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const gesture = resizeGesture.current;
              if (!gesture) return;
              event.preventDefault();
              event.stopPropagation();
              const weightedDistance = (event.clientX - gesture.startX) + ((event.clientY - gesture.startY) * 0.7);
              const nextIndex = clampSizeIndex(gesture.startIndex + Math.round(weightedDistance / RESIZE_STEP_PX));
              if (nextIndex === gesture.lastIndex) return;
              gesture.lastIndex = nextIndex;
              previewSizeIndex(nextIndex);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const gesture = resizeGesture.current;
              resizeGesture.current = null;
              if (gesture) commitSizeIndex(gesture.lastIndex);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { resizeGesture.current = null; setResizePreview(null); }}
            onLostPointerCapture={() => { resizeGesture.current = null; setResizePreview(null); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); resizeByKeyboard(1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); resizeByKeyboard(-1); }
            }}
          >
            <span aria-hidden="true" />
          </ClusterButton>
          <div className="home-widget-keyboard-layout-controls" aria-label="Widget layout controls">
            <ClusterButton variant="quiet" size="compact" onClick={() => onColumn(placement.id, placement.column - 1)} aria-label="Move widget one grid column left">←</ClusterButton>
            <ClusterButton variant="quiet" size="compact" onClick={() => onMove(placement.id, -1)} aria-label="Move widget earlier">↑</ClusterButton>
            <ClusterButton variant="quiet" size="compact" onClick={() => onMove(placement.id, 1)} aria-label="Move widget later">↓</ClusterButton>
            <ClusterButton variant="quiet" size="compact" onClick={() => onColumn(placement.id, placement.column + 1)} aria-label="Move widget one grid column right">→</ClusterButton>
          </div>
        </>
      )}
      {children}
    </div>
  );
}

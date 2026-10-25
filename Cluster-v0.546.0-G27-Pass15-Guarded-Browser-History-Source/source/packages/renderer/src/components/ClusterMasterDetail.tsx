import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ClusterIconButton, ClusterButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { availableClusterWidth, clampClusterWidth, persistClusterWidth } from "./cluster-resize-sizing";
import { createPortal } from "react-dom";
import { useClusterDialogInteraction } from "./useClusterDialogInteraction";

const DETAIL_QUERY_KEY = "inspect";
const DETAIL_SIZE_STORAGE_PREFIX = "cluster:master-detail-size:";

function readSavedDetailWidth(persistKey?: string): number | null {
  if (!persistKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${DETAIL_SIZE_STORAGE_PREFIX}${persistKey}`);
    if (!raw) return null;
    const stored = Number(raw);
    return Number.isFinite(stored) && stored >= 320 ? stored : null;
  } catch { return null; }
}

function parseSelection(value: string | null) {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  return { scope: value.slice(0, separator), id: value.slice(separator + 1) };
}

function detailUrl(scope: string, id: string | null) {
  const url = new URL(window.location.href);
  const current = parseSelection(url.searchParams.get(DETAIL_QUERY_KEY));
  if (id) url.searchParams.set(DETAIL_QUERY_KEY, `${scope}:${id}`);
  else if (current?.scope === scope) url.searchParams.delete(DETAIL_QUERY_KEY);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readClusterDetailSelection(scope: string) {
  if (typeof window === "undefined") return null;
  const selected = parseSelection(new URL(window.location.href).searchParams.get(DETAIL_QUERY_KEY));
  return selected?.scope === scope ? selected.id || null : null;
}

export function useClusterDetailHistory(scope: string, selectedId: string | null, onRestore: (id: string | null) => void) {
  const originFocusRef = useRef<HTMLElement | null>(null);
  const selectionRef = useRef<string | null>(selectedId);
  selectionRef.current = selectedId;

  const restoreOriginFocus = useCallback(() => {
    window.setTimeout(() => {
      const origin = originFocusRef.current;
      if (origin?.isConnected && !origin.hasAttribute("disabled")) {
        origin.focus();
        return;
      }
      document.querySelector<HTMLElement>('.cluster-master-pane-v429 :where(button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"]))')?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    const applyRestore = (next: string | null) => {
      const previous = selectionRef.current;
      selectionRef.current = next;
      onRestore(next);
      if (previous && !next) restoreOriginFocus();
    };
    const restore = () => applyRestore(readClusterDetailSelection(scope));
    const restoreFromInspectorEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; id?: string | null }>).detail;
      if (detail?.scope !== scope) return;
      applyRestore(detail.id || null);
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("cluster:inspector-state-changed", restoreFromInspectorEvent);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("cluster:inspector-state-changed", restoreFromInspectorEvent);
    };
  }, [scope, onRestore, restoreOriginFocus]);

  const openDetail = useCallback((id: string) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) originFocusRef.current = document.activeElement;
    const current = readClusterDetailSelection(scope);
    const state = { ...(window.history.state || {}), clusterMasterDetail: { scope, id } };
    if (current) window.history.replaceState(state, "", detailUrl(scope, id));
    else window.history.pushState(state, "", detailUrl(scope, id));
    selectionRef.current = id;
    window.dispatchEvent(new CustomEvent("cluster:inspector-state-changed", { detail: { scope, id } }));
    onRestore(id);
  }, [scope, onRestore]);

  const closeDetail = useCallback(() => {
    if (!selectedId && !readClusterDetailSelection(scope)) return;
    const state = { ...(window.history.state || {}), clusterMasterDetail: { scope, id: null } };
    window.history.pushState(state, "", detailUrl(scope, null));
    selectionRef.current = null;
    window.dispatchEvent(new CustomEvent("cluster:inspector-state-changed", { detail: { scope, id: null } }));
    onRestore(null);
    restoreOriginFocus();
  }, [scope, selectedId, onRestore, restoreOriginFocus]);

  return { openDetail, closeDetail };
}

export function ClusterMasterDetail({
  master,
  detail,
  detailOpen,
  onCloseDetail,
  label,
  masterLabel,
  detailLabel,
  className = "",
  detailSize = "medium",
  persistKey,
  resizable = true,
}: {
  master: ReactNode;
  detail: ReactNode;
  detailOpen: boolean;
  onCloseDetail?: () => void;
  label: string;
  masterLabel: string;
  detailLabel: string;
  className?: string;
  detailSize?: "narrow" | "medium" | "wide";
  persistKey?: string;
  resizable?: boolean;
}) {
  const detailRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const focusTimerRef = useRef<number | null>(null);
  const dialogId = useId().replace(/:/g, "");
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useClusterDialogInteraction({ active: compact && detailOpen, dialogRef: detailRef, onEscape: onCloseDetail });
  const [detailWidth, setDetailWidth] = useState<number | null>(() => readSavedDetailWidth(persistKey));
  useEffect(() => { setDetailWidth(readSavedDetailWidth(persistKey)); }, [persistKey]);

  const [containerWidth, setContainerWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !rootRef.current) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);
  const availableDetail = Math.min(640, containerWidth * 0.68, availableClusterWidth(containerWidth, 290, 9));
  const effectiveMin = Math.min(320, availableDetail);
  const effectiveMax = Math.max(effectiveMin, availableDetail);
  const visibleDetailWidth = clampClusterWidth(detailWidth ?? (detailSize === "wide" ? 440 : 360), effectiveMin, effectiveMax);

  const commitDetailWidth = useCallback((value: number) => {
    const next = clampClusterWidth(value, effectiveMin, effectiveMax);
    setDetailWidth(next);
    if (persistKey) persistClusterWidth(`${DETAIL_SIZE_STORAGE_PREFIX}${persistKey}`, next);
  }, [effectiveMin, effectiveMax, persistKey]);

  const resizeDetail = useCallback((clientX: number) => {
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    commitDetailWidth(bounds.right - clientX);
  }, [commitDetailWidth]);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resizable || compact) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => resizeDetail(moveEvent.clientX);
    const finish = (upEvent: PointerEvent) => {
      if (target.hasPointerCapture(upEvent.pointerId)) target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }, [resizable, resizeDetail, compact]);
  const keyboardResize = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const delta = event.shiftKey ? 32 : 16;
    const next = event.key === "Home" ? effectiveMin : event.key === "End" ? effectiveMax : visibleDetailWidth + (event.key === "ArrowLeft" ? delta : -delta);
    commitDetailWidth(next);
  }, [visibleDetailWidth, effectiveMin, effectiveMax, commitDetailWidth]);
  useEffect(() => {
    const openedNow = detailOpen && !wasOpenRef.current;
    wasOpenRef.current = detailOpen;
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    if (!openedNow) return;
    focusTimerRef.current = window.setTimeout(() => {
      const pane = detailRef.current;
      if (!pane) return;
      focusTimerRef.current = null;
      const focusTarget = pane.querySelector<HTMLElement>(':where([autofocus],button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"]))');
      (focusTarget || pane).focus();
    }, 0);
  }, [detailOpen]);
  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
  }, []);
  const dismissBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    // The mobile scrim is a CSS pseudo-element on the root. A click on
    // children is never interpreted as a request to close their inspector.
    if (compact && detailOpen && onCloseDetail && event.target === event.currentTarget) onCloseDetail();
  };

  const detailPane = <aside ref={detailRef} id={`cluster-inspector-${dialogId}`} tabIndex={-1} className="cluster-detail-pane-v429" role={compact && detailOpen ? "dialog" : undefined} aria-modal={compact && detailOpen ? "true" : undefined} aria-label={detailLabel} aria-hidden={!detailOpen}>
    {detailOpen && onCloseDetail ? (
      <ClusterIconButton className="cluster-detail-close-v429" label={`Close ${detailLabel}`} size="compact" onClick={onCloseDetail}><ClusterIcon name="close" /></ClusterIconButton>
    ) : null}
    {detailOpen ? detail : null}
  </aside>;

  return (
    <div ref={rootRef} data-cluster-master-detail="true" data-cluster-inspector-portaled={compact && detailOpen ? "true" : undefined} className={`cluster-master-detail-v429 detail-${detailSize} ${detailOpen ? "detail-open" : "detail-empty"} ${detailOpen && resizable ? "detail-resizable" : ""} ${className}`.trim()} aria-label={label} style={detailOpen && detailWidth ? { ["--cluster-detail-width" as string]: `min(${visibleDetailWidth}px, 68%)` } : undefined}>
      <div className="cluster-master-pane-v429" aria-label={masterLabel}>{master}</div>
      {detailOpen && resizable ? <ClusterButton unstyled type="button" className="cluster-detail-resizer-v429" role="separator" aria-orientation="vertical" aria-valuemin={effectiveMin} aria-valuemax={effectiveMax} aria-valuenow={visibleDetailWidth} aria-label={`Resize ${detailLabel}`} title={`Drag or use arrow keys to resize ${detailLabel}`} onPointerDown={beginResize} onKeyDown={keyboardResize} /> : null}
      {!compact ? detailPane : null}
      {compact && detailOpen && typeof document !== "undefined" ? createPortal(
        <div className={`cluster-master-detail-v429 detail-open detail-${detailSize} cluster-inspector-portal-v546 ${className}`.trim()} onMouseDown={dismissBackdrop}>
          {detailPane}
        </div>, document.body,
      ) : null}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";
import { runtimeStyle } from "../core/runtime-style";
import { resolveClusterModalOwner, topVisibleClusterDialog, visibleClusterFloatingSurfaces } from "../core/dialog-focus";

export type ClusterFloatingPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";
export type ClusterFloatingDismissReason = "escape" | "outside";

type FloatingStyle = CSSProperties & {
  "--cluster-floating-anchor-width"?: string;
};

function viewportBounds() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

function assignRef<T>(ref: RefObject<T | null> | undefined, value: T | null) {
  if (ref) ref.current = value;
}

export function ClusterFloatingSurface({
  open,
  anchorRef,
  surfaceRef,
  label,
  role = "dialog",
  placement = "bottom-end",
  mobileMode = "sheet",
  matchAnchorWidth = false,
  autoFocus = "none",
  autoFocusSelector,
  onDismiss,
  canDismiss,
  className = "",
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "role" | "autoFocus"> & {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef?: RefObject<HTMLDivElement | null>;
  label: string;
  role?: "dialog" | "menu" | "listbox";
  placement?: ClusterFloatingPlacement;
  mobileMode?: "popover" | "sheet";
  matchAnchorWidth?: boolean;
  autoFocus?: "none" | "surface" | "first";
  autoFocusSelector?: string;
  onDismiss: (reason: ClusterFloatingDismissReason) => void;
  /** Synchronous gate for in-flight actions, unlike render-state busy flags. */
  canDismiss?: () => boolean;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<FloatingStyle>({ visibility: "hidden" });
  const [resolvedPlacement, setResolvedPlacement] = useState<ClusterFloatingPlacement>(placement);
  const [mobileSheet, setMobileSheet] = useState(false);
  const modalOwner = open ? resolveClusterModalOwner(anchorRef.current) : null;
  const modalOwnerId = modalOwner?.id || undefined;

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      const surface = localRef.current;
      if (!anchor || !surface) return;
      const viewport = viewportBounds();
      const isSheet = mobileMode === "sheet" && viewport.width <= 640;
      setMobileSheet(isSheet);
      if (isSheet) {
        setResolvedPlacement("bottom-start");
        setStyle({
          left: viewport.left + 8,
          bottom: Math.max(8, window.innerHeight - (viewport.top + viewport.height) + 8),
          width: Math.max(0, viewport.width - 16),
          maxHeight: Math.min(viewport.height * 0.72, 560),
          visibility: "visible",
          "--cluster-floating-anchor-width": `${Math.round(anchor.getBoundingClientRect().width)}px`,
        });
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const edge = 8;
      const gap = 6;
      const desiredTop = placement.startsWith("top");
      const alignEnd = placement.endsWith("end");
      const spaceBelow = Math.max(0, viewport.top + viewport.height - anchorRect.bottom - gap - edge);
      const spaceAbove = Math.max(0, anchorRect.top - viewport.top - gap - edge);
      const openTop = desiredTop ? spaceAbove >= Math.min(surfaceRect.height, 180) || spaceAbove > spaceBelow : spaceBelow < Math.min(surfaceRect.height, 180) && spaceAbove > spaceBelow;
      const nextPlacement = `${openTop ? "top" : "bottom"}-${alignEnd ? "end" : "start"}` as ClusterFloatingPlacement;
      const availableHeight = Math.max(120, (openTop ? spaceAbove : spaceBelow));
      const width = Math.min(surfaceRect.width || 220, viewport.width - edge * 2);
      const rawLeft = alignEnd ? anchorRect.right - width : anchorRect.left;
      const left = Math.max(viewport.left + edge, Math.min(rawLeft, viewport.left + viewport.width - width - edge));
      const height = Math.min(surfaceRect.height || availableHeight, availableHeight);
      const top = openTop ? Math.max(viewport.top + edge, anchorRect.top - gap - height) : anchorRect.bottom + gap;
      setResolvedPlacement(nextPlacement);
      setStyle({
        left,
        top,
        minWidth: matchAnchorWidth ? Math.min(anchorRect.width, viewport.width - edge * 2) : undefined,
        maxWidth: viewport.width - edge * 2,
        maxHeight: availableHeight,
        visibility: "visible",
        "--cluster-floating-anchor-width": `${Math.round(anchorRect.width)}px`,
      });
    };

    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (localRef.current) observer?.observe(localRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, anchorRef, placement, mobileMode, matchAnchorWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const panels = visibleClusterFloatingSurfaces();
      // A parent menu must not disappear because its child/another topmost
      // floating surface was clicked. Only the highest visible layer dismisses.
      if (panels[panels.length - 1] !== localRef.current) return;
      const topModal = topVisibleClusterDialog();
      if (topModal && modalOwnerId !== topModal.id) return;
      if (anchorRef.current?.contains(target) || localRef.current?.contains(target)) return;
      if (canDismiss && !canDismiss()) return;
      onDismiss("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Only the latest floating panel may consume Escape; don't dismiss a panel
      // underneath an unrelated active modal.
      const panels = visibleClusterFloatingSurfaces();
      if (panels[panels.length - 1] !== localRef.current) return;
      const topModal = topVisibleClusterDialog();
      if (topModal && modalOwnerId !== topModal.id) return;
      // Do not swallow Escape or move focus away from a pending menu.
      if (canDismiss && !canDismiss()) return;
      event.preventDefault();
      onDismiss("escape");
      window.setTimeout(() => {
        if (!localRef.current?.isConnected) anchorRef.current?.focus({ preventScroll: true });
      }, 0);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, modalOwnerId, onDismiss, canDismiss]);

  useEffect(() => {
    if (!open || autoFocus === "none") return;
    const timer = window.setTimeout(() => {
      const surface = localRef.current;
      if (!surface || surface.hasAttribute("inert")) return;
      const topDialog = topVisibleClusterDialog();
      if (topDialog && modalOwnerId !== topDialog.id) return;
      if (autoFocus === "surface") {
        surface.focus({ preventScroll: true });
        return;
      }
      const selector = autoFocusSelector || ':where(button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])):not(:disabled)';
      surface.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, autoFocus, autoFocusSelector, modalOwnerId]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...props}
      ref={(node) => {
        localRef.current = node;
        assignRef(surfaceRef, node);
      }}
      role={role}
      aria-label={label}
      tabIndex={autoFocus === "surface" ? 0 : props.tabIndex}
      data-cluster-floating="true"
      data-cluster-modal-owner={modalOwnerId}
      data-motion-purpose="surface"
      data-placement={resolvedPlacement}
      data-mobile-sheet={mobileSheet ? "true" : "false"}
      className={`cluster-floating-surface-v504 ${className}`.trim()}
      style={runtimeStyle({ ...style, ...props.style })}
    >
      {mobileSheet ? <span className="cluster-floating-sheet-grabber-v504" aria-hidden="true" /> : null}
      {children}
    </div>,
    document.body,
  );
}

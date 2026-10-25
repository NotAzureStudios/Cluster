import { ADAPTIVE_MEDIA } from "../../../core/adaptive-layout";
import { useEffect } from "react";

const MOBILE_VIEWPORT_HEIGHT = "--cluster-mobile-viewport-height";
const MOBILE_KEYBOARD_INSET = "--cluster-mobile-keyboard-inset";

function editableElementActive() {
  const element = document.activeElement as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
}

/**
 * Mirrors the actually visible mobile viewport into CSS. `100dvh` remains the fallback, while
 * VisualViewport handles iOS keyboard/browser-chrome and standalone-PWA transitions without
 * making every feature invent its own resize listener.
 */
export function MobileViewportRuntime() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const root = document.documentElement;
    const visualViewport = window.visualViewport;
    const narrow = window.matchMedia(ADAPTIVE_MEDIA.tabletOrNarrower);
    const coarse = window.matchMedia(ADAPTIVE_MEDIA.coarsePointer);
    let frame = 0;
    let baselineHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
    let orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";

    const clearMobileState = () => {
      root.style.removeProperty(MOBILE_VIEWPORT_HEIGHT);
      root.style.removeProperty(MOBILE_KEYBOARD_INSET);
      delete root.dataset.clusterMobileKeyboard;
      delete root.dataset.clusterMobileOrientation;
    };
    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!narrow.matches && !coarse.matches) { clearMobileState(); return; }
        const nextOrientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
        if (nextOrientation !== orientation) {
          orientation = nextOrientation;
          baselineHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
        }
        const visibleHeight = Math.max(1, Math.round(visualViewport?.height || window.innerHeight));
        if (!editableElementActive()) baselineHeight = Math.max(visibleHeight, window.innerHeight);
        const viewportTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
        const keyboardInset = editableElementActive() ? Math.max(0, Math.round(baselineHeight - visibleHeight - viewportTop)) : 0;
        root.style.setProperty(MOBILE_VIEWPORT_HEIGHT, `${visibleHeight}px`);
        root.style.setProperty(MOBILE_KEYBOARD_INSET, `${keyboardInset}px`);
        root.dataset.clusterMobileKeyboard = keyboardInset >= 96 ? "true" : "false";
        root.dataset.clusterMobileOrientation = orientation;
      });
    };
    const onVisibility = () => { if (document.visibilityState === "visible") update(); };
    const onPageHide = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      delete root.dataset.clusterMobileKeyboard;
      root.style.setProperty(MOBILE_KEYBOARD_INSET, "0px");
    };
    const onResume = () => {
      baselineHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
      update();
    };
    const onOrientation = () => {
      baselineHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
      update();
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", onOrientation, { passive: true });
    window.addEventListener("pageshow", onResume, { passive: true });
    window.addEventListener("pagehide", onPageHide, { passive: true });
    document.addEventListener("freeze", onPageHide);
    document.addEventListener("resume", onResume);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("visibilitychange", onVisibility);
    narrow.addEventListener("change", update);
    coarse.addEventListener("change", update);
    visualViewport?.addEventListener("resize", update, { passive: true });
    visualViewport?.addEventListener("scroll", update, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("freeze", onPageHide);
      document.removeEventListener("resume", onResume);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("visibilitychange", onVisibility);
      narrow.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
      clearMobileState();
    };
  }, []);

  return null;
}

import { DEVICE_PERFORMANCE_CHANGED_EVENT, DEVICE_PERFORMANCE_STORAGE_KEY, readDevicePerformancePreferences, resolveDeviceRendererQuality } from "./device-performance";
import { effectiveRendererBlurPx } from "./renderer-budget";

export type RendererHost = "web" | "desktop";
export type RendererQualityTier = "full" | "balanced" | "reduced";
export type RendererPointerMode = "fine" | "coarse" | "mixed" | "unknown";
export type RendererContrastPreference = "more" | "less" | "custom" | "no-preference";

export type RendererCapabilities = Readonly<{
  host: RendererHost;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  pointer: RendererPointerMode;
  reducedMotion: boolean;
  reducedTransparency: boolean;
  contrast: RendererContrastPreference;
  forcedColors: boolean;
  viewportWidth: number;
  viewportHeight: number;
  viewportClass: "phone" | "tablet" | "desktop" | "wide" | "ultrawide";
  backdropFilter: boolean;
  viewTransitions: boolean;
  offscreenCanvas: boolean;
  webgl2: boolean;
  webgpu: boolean;
  qualityTier: RendererQualityTier;
}>;

type CapabilityListener = () => void;

type NavigatorWithCapabilities = Navigator & {
  deviceMemory?: number;
  gpu?: unknown;
};

type DocumentWithViewTransitions = Document & {
  startViewTransition?: unknown;
};

const listeners = new Set<CapabilityListener>();
let cleanupCallbacks: Array<() => void> = [];
let initialized = false;
let cachedWebGl2: boolean | null = null;
let current: RendererCapabilities = Object.freeze({
  host: "web",
  devicePixelRatio: 1,
  hardwareConcurrency: null,
  deviceMemoryGiB: null,
  pointer: "unknown",
  reducedMotion: false,
  reducedTransparency: false,
  contrast: "no-preference",
  forcedColors: false,
  viewportWidth: 1280,
  viewportHeight: 720,
  viewportClass: "desktop",
  backdropFilter: false,
  viewTransitions: false,
  offscreenCanvas: false,
  webgl2: false,
  webgpu: false,
  qualityTier: "balanced",
});

function matches(query: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function detectPointer(): RendererPointerMode {
  const coarse = matches("(any-pointer: coarse)");
  const fine = matches("(any-pointer: fine)");
  if (coarse && fine) return "mixed";
  if (coarse) return "coarse";
  if (fine) return "fine";
  return "unknown";
}

function detectContrast(): RendererContrastPreference {
  if (matches("(prefers-contrast: more)")) return "more";
  if (matches("(prefers-contrast: less)")) return "less";
  if (matches("(prefers-contrast: custom)")) return "custom";
  return "no-preference";
}

function classifyViewport(width: number): RendererCapabilities["viewportClass"] {
  if (width < 600) return "phone";
  if (width < 900) return "tablet";
  if (width < 1600) return "desktop";
  if (width < 2560) return "wide";
  return "ultrawide";
}

function detectWebGl2() {
  if (cachedWebGl2 !== null) return cachedWebGl2;
  if (typeof document === "undefined") return false;
  try {
    // Capability probing must not create a new graphics context on every resize.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    cachedWebGl2 = Boolean(context);
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cachedWebGl2 = false;
  }
  return cachedWebGl2;
}

function chooseQualityTier(input: Omit<RendererCapabilities, "qualityTier">): RendererQualityTier {
  if (input.reducedTransparency || !input.backdropFilter) return "reduced";
  if ((input.hardwareConcurrency !== null && input.hardwareConcurrency <= 2) || (input.deviceMemoryGiB !== null && input.deviceMemoryGiB <= 2)) return "reduced";
  if ((input.hardwareConcurrency !== null && input.hardwareConcurrency <= 4) || (input.deviceMemoryGiB !== null && input.deviceMemoryGiB <= 4)) return "balanced";
  return "full";
}

function readCapabilities(host: RendererHost): RendererCapabilities {
  const browserNavigator = (typeof navigator !== "undefined" ? navigator : {}) as NavigatorWithCapabilities;
  const browserDocument = (typeof document !== "undefined" ? document : {}) as DocumentWithViewTransitions;
  const hardwareConcurrency = Number(browserNavigator.hardwareConcurrency || 0) || null;
  const deviceMemoryGiB = Number(browserNavigator.deviceMemory || 0) || null;
  const viewportWidth = typeof window !== "undefined" ? Math.max(320, Math.round(window.visualViewport?.width ?? window.innerWidth)) : 1280;
  const viewportHeight = typeof window !== "undefined" ? Math.max(240, Math.round(window.visualViewport?.height ?? window.innerHeight)) : 720;
  const base = {
    host,
    devicePixelRatio: typeof window !== "undefined" ? Math.max(1, Number(window.devicePixelRatio || 1)) : 1,
    hardwareConcurrency,
    deviceMemoryGiB,
    pointer: detectPointer(),
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
    reducedTransparency: matches("(prefers-reduced-transparency: reduce)"),
    contrast: detectContrast(),
    forcedColors: matches("(forced-colors: active)"),
    viewportWidth,
    viewportHeight,
    viewportClass: classifyViewport(viewportWidth),
    backdropFilter: typeof CSS !== "undefined" && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)")),
    viewTransitions: typeof browserDocument.startViewTransition === "function",
    offscreenCanvas: typeof globalThis.OffscreenCanvas !== "undefined",
    webgl2: detectWebGl2(),
    webgpu: Boolean(browserNavigator.gpu),
  } satisfies Omit<RendererCapabilities, "qualityTier">;
  return Object.freeze({ ...base, qualityTier: resolveDeviceRendererQuality(chooseQualityTier(base), base) });
}

function applyCapabilityAttributes(capabilities: RendererCapabilities) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.rendererHost = capabilities.host;
  root.dataset.rendererQuality = capabilities.qualityTier;
  root.dataset.devicePerformanceProfile = readDevicePerformancePreferences().profile;
  // This is an inline visual customization variable, so CSS selectors alone
  // cannot cap it. Apply the same budget on profile changes and when Appearance
  // changes the preferred value.
  const preferredBlur = Number.parseFloat(root.style.getPropertyValue("--cluster-preferred-glass-blur"));
  const effectiveBlur = `${effectiveRendererBlurPx(preferredBlur, capabilities.qualityTier)}px`;
  if (root.style.getPropertyValue("--glass-blur") !== effectiveBlur) {
    root.style.setProperty("--glass-blur", effectiveBlur);
  }
  root.dataset.rendererPointer = capabilities.pointer;
  root.dataset.rendererBackdrop = capabilities.backdropFilter ? "supported" : "fallback";
  root.dataset.rendererViewTransitions = capabilities.viewTransitions ? "supported" : "fallback";
  root.dataset.rendererWebgl2 = capabilities.webgl2 ? "supported" : "fallback";
  root.dataset.rendererWebgpu = capabilities.webgpu ? "supported" : "fallback";
  root.dataset.rendererReducedTransparency = capabilities.reducedTransparency ? "true" : "false";
  root.dataset.rendererForcedColors = capabilities.forcedColors ? "true" : "false";
  root.dataset.rendererViewport = capabilities.viewportClass;
  root.style.setProperty("--cluster-viewport-width", `${capabilities.viewportWidth}px`);
  root.style.setProperty("--cluster-viewport-height", `${capabilities.viewportHeight}px`);
}

function publish(next: RendererCapabilities) {
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  const profileChanged = typeof document !== "undefined"
    && document.documentElement.dataset.devicePerformanceProfile !== readDevicePerformancePreferences().profile;
  if (!changed && !profileChanged) return;
  current = next;
  applyCapabilityAttributes(current);
  if (changed) listeners.forEach((listener) => listener());
}

function watchMedia(query: string, refresh: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const media = window.matchMedia(query);
  media.addEventListener("change", refresh);
  cleanupCallbacks.push(() => media.removeEventListener("change", refresh));
}

export function initializeRendererCapabilities(host: RendererHost) {
  if (initialized) return current;
  initialized = true;
  const refresh = () => publish(readCapabilities(host));
  publish(readCapabilities(host));
  [
    "(any-pointer: coarse)",
    "(any-pointer: fine)",
    "(prefers-reduced-motion: reduce)",
    "(prefers-reduced-transparency: reduce)",
    "(prefers-contrast: more)",
    "(prefers-contrast: less)",
    "(prefers-contrast: custom)",
    "(forced-colors: active)",
  ].forEach((query) => watchMedia(query, refresh));
  if (typeof window !== "undefined") {
    let resizeFrame = 0;
    const onResize = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        refresh();
      });
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener(DEVICE_PERFORMANCE_CHANGED_EVENT, refresh);
    const onStorage = (event: StorageEvent) => { if (event.key === DEVICE_PERFORMANCE_STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    cleanupCallbacks.push(() => {
      window.removeEventListener("resize", onResize);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    });
    cleanupCallbacks.push(() => window.removeEventListener(DEVICE_PERFORMANCE_CHANGED_EVENT, refresh));
    cleanupCallbacks.push(() => window.removeEventListener("storage", onStorage));
  }
  return current;
}

export function getRendererCapabilitiesSnapshot() {
  return current;
}

export function subscribeRendererCapabilities(listener: CapabilityListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function disposeRendererCapabilities() {
  cleanupCallbacks.forEach((cleanup) => cleanup());
  cleanupCallbacks = [];
  listeners.clear();
  cachedWebGl2 = null;
  initialized = false;
}

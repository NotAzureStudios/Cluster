export const ADAPTIVE_BREAKPOINTS = Object.freeze({
  phoneMax: 639,
  tabletMax: 899,
  compactDesktopMax: 1199,
  desktopMin: 1200,
});

export const ADAPTIVE_MEDIA = Object.freeze({
  phone: `(max-width: ${ADAPTIVE_BREAKPOINTS.phoneMax}px)`,
  tabletOrNarrower: `(max-width: ${ADAPTIVE_BREAKPOINTS.tabletMax}px)`,
  persistentNavigation: `(min-width: ${ADAPTIVE_BREAKPOINTS.tabletMax + 1}px)`,
  compactNavigation: `(max-width: ${ADAPTIVE_BREAKPOINTS.compactDesktopMax}px)`,
  desktop: `(min-width: ${ADAPTIVE_BREAKPOINTS.desktopMin}px)`,
  coarsePointer: "(any-pointer: coarse)",
  finePointer: "(any-pointer: fine)",
});

export type AdaptiveLayoutMode = "phone" | "tablet" | "compact-desktop" | "desktop";

export function adaptiveLayoutMode(width: number): AdaptiveLayoutMode {
  if (width <= ADAPTIVE_BREAKPOINTS.phoneMax) return "phone";
  if (width <= ADAPTIVE_BREAKPOINTS.tabletMax) return "tablet";
  if (width <= ADAPTIVE_BREAKPOINTS.compactDesktopMax) return "compact-desktop";
  return "desktop";
}

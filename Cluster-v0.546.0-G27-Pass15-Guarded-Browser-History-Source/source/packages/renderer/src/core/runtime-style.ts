import type { CSSProperties } from "react";

/**
 * Controlled escape hatch for values that genuinely must be calculated at runtime
 * (virtualized geometry, user-selected colors, progress, media scrub position, etc.).
 *
 * Static visual decisions belong in CSS. Runtime callers may use CSS custom properties
 * or this deliberately small property allowlist so ad-hoc JSX style objects cannot
 * quietly become a second styling system again.
 */
export type RuntimeStyleValue = string | number | undefined | null;
export type RuntimeStyleInput = CSSProperties & { [key: `--${string}`]: RuntimeStyleValue };

const ALLOWED_PROPERTIES = new Set([
  "background",
  "backgroundColor",
  "backgroundImage",
  "bottom",
  "borderColor",
  "borderLeftColor",
  "color",
  "clipPath",
  "display",
  "gridTemplateColumns",
  "height",
  "left",
  "maxHeight",
  "maxWidth",
  "minWidth",
  "mixBlendMode",
  "opacity",
  "paddingLeft",
  "position",
  "top",
  "transform",
  "visibility",
  "width",
  "zIndex",
]);

export function runtimeStyle(input: RuntimeStyleInput): CSSProperties {
  for (const key of Object.keys(input)) {
    if (!key.startsWith("--") && !ALLOWED_PROPERTIES.has(key)) {
      throw new Error(`Unsupported runtime style property: ${key}. Move static styling to CSS or extend the reviewed runtime-style contract.`);
    }
  }
  return input;
}

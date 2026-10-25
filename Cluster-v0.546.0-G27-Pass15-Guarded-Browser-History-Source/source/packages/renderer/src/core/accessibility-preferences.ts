export type AccessibilityMotionPreference = "system" | "full" | "reduced" | "none";
export type AccessibilityContrastPreference = "system" | "standard" | "high";
export type AccessibilityTransparencyPreference = "system" | "full" | "reduced" | "off";
export type AccessibilityFocusPreference = "auto" | "strong" | "always";
export type AccessibilityTextScale = "default" | "large" | "larger" | "largest";
export type AccessibilityStatusPalette = "default" | "color-vision-safe" | "monochrome";

export type AccessibilityPreferenceInput = {
  userMotionPreference?: AccessibilityMotionPreference;
  motionLevel?: "full" | "reduced" | "none";
  userContrastPreference?: AccessibilityContrastPreference;
  userTransparencyPreference?: AccessibilityTransparencyPreference;
  userFocusIndicator?: AccessibilityFocusPreference;
  userTextScale?: AccessibilityTextScale;
  userLargeClickTargets?: boolean;
  userStatusPalette?: AccessibilityStatusPalette;
};

export type AccessibilitySystemPreferences = {
  reducedMotion: boolean;
  highContrast: boolean;
  reducedTransparency: boolean;
};

export type ResolvedAccessibilityPreferences = {
  motionPreference: AccessibilityMotionPreference;
  motion: "full" | "reduced" | "none";
  contrastPreference: AccessibilityContrastPreference;
  highContrast: boolean;
  transparencyPreference: AccessibilityTransparencyPreference;
  transparency: "full" | "reduced" | "off";
  focusIndicator: AccessibilityFocusPreference;
  textScale: AccessibilityTextScale;
  largeTargets: boolean;
  statusPalette: AccessibilityStatusPalette;
};

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function readAccessibilitySystemPreferences(): AccessibilitySystemPreferences {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { reducedMotion: false, highContrast: false, reducedTransparency: false };
  }
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    highContrast: window.matchMedia("(prefers-contrast: more)").matches || window.matchMedia("(forced-colors: active)").matches,
    reducedTransparency: window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
  };
}

export function resolveAccessibilityPreferences(
  input: AccessibilityPreferenceInput,
  system: AccessibilitySystemPreferences = { reducedMotion: false, highContrast: false, reducedTransparency: false },
): ResolvedAccessibilityPreferences {
  const studioMotion = choice(input.motionLevel, ["full", "reduced", "none"] as const, "full");
  const motionPreference = choice(input.userMotionPreference, ["system", "full", "reduced", "none"] as const, input.userMotionPreference ? "system" : studioMotion);
  const contrastPreference = choice(input.userContrastPreference, ["system", "standard", "high"] as const, "system");
  const transparencyPreference = choice(input.userTransparencyPreference, ["system", "full", "reduced", "off"] as const, "system");
  const focusIndicator = choice(input.userFocusIndicator, ["auto", "strong", "always"] as const, "auto");
  const textScale = choice(input.userTextScale, ["default", "large", "larger", "largest"] as const, "default");
  const statusPalette = choice(input.userStatusPalette, ["default", "color-vision-safe", "monochrome"] as const, "default");

  // OS reduced-motion is a safety floor, even when a user previously selected Full.
  const requestedMotion = motionPreference === "system" ? (system.reducedMotion ? "reduced" : "full") : motionPreference;
  const motion = system.reducedMotion && requestedMotion === "full" ? "reduced" : requestedMotion;
  const highContrast = contrastPreference === "system" ? system.highContrast : contrastPreference === "high";
  const transparency = transparencyPreference === "system"
    ? (system.reducedTransparency ? "off" : "full")
    : transparencyPreference;

  return {
    motionPreference,
    motion,
    contrastPreference,
    highContrast,
    transparencyPreference,
    transparency,
    focusIndicator,
    textScale,
    largeTargets: input.userLargeClickTargets === true,
    statusPalette,
  };
}

export function accessibilityPreferenceDefaults(): AccessibilityPreferenceInput {
  return {
    userMotionPreference: "system",
    userContrastPreference: "system",
    userTransparencyPreference: "system",
    userFocusIndicator: "auto",
    userTextScale: "default",
    userLargeClickTargets: false,
    userStatusPalette: "default",
  };
}

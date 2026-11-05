/**
 * Device-local renderer preferences. This is intentionally separate from studio
 * resource policy: a browser must not control server-side worker admission.
 *
 * Persisted once per device/browser origin, never in a user account payload.
 * Only renderer effect quality is currently configurable; unimplemented CPU,
 * FPS and cache controls must not be presented as functional switches.
 */
export type DevicePerformanceProfile = "automatic" | "efficient" | "balanced" | "performance" | "custom";
export type DeviceRendererQuality = "full" | "balanced" | "reduced";
export type DevicePerformancePreferences = Readonly<{
  profile: DevicePerformanceProfile;
  customQuality: DeviceRendererQuality;
}>;

export const DEVICE_PERFORMANCE_STORAGE_KEY = "cluster.device-performance.v1";
export const DEVICE_PERFORMANCE_CHANGED_EVENT = "cluster:device-performance-changed";
export const DEFAULT_DEVICE_PERFORMANCE_PREFERENCES: DevicePerformancePreferences = Object.freeze({
  profile: "automatic",
  customQuality: "balanced",
});

const PROFILES: readonly DevicePerformanceProfile[] = ["automatic", "efficient", "balanced", "performance", "custom"];
const QUALITIES: readonly DeviceRendererQuality[] = ["full", "balanced", "reduced"];

export function normalizeDevicePerformancePreferences(value: unknown): DevicePerformancePreferences {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const profile = PROFILES.find((entry) => entry === input.profile) || "automatic";
  const customQuality = QUALITIES.find((entry) => entry === input.customQuality) || "balanced";
  return { profile, customQuality };
}

export function readDevicePerformancePreferences(): DevicePerformancePreferences {
  if (typeof window === "undefined") return DEFAULT_DEVICE_PERFORMANCE_PREFERENCES;
  try {
    return normalizeDevicePerformancePreferences(JSON.parse(window.localStorage.getItem(DEVICE_PERFORMANCE_STORAGE_KEY) || "null"));
  } catch {
    // Storage can be disabled by browser policy. Automatic remains safe.
    return DEFAULT_DEVICE_PERFORMANCE_PREFERENCES;
  }
}

export function writeDevicePerformancePreferences(value: DevicePerformancePreferences): boolean {
  if (typeof window === "undefined") return false;
  const normalized = normalizeDevicePerformancePreferences(value);
  try {
    window.localStorage.setItem(DEVICE_PERFORMANCE_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new Event(DEVICE_PERFORMANCE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Accessibility and unsupported backdrop effects always win over visual fidelity. */
export function resolveDeviceRendererQuality(
  detected: DeviceRendererQuality,
  options: { reducedTransparency: boolean; forcedColors: boolean; backdropFilter: boolean },
  preferences: DevicePerformancePreferences = readDevicePerformancePreferences(),
): DeviceRendererQuality {
  if (options.reducedTransparency || options.forcedColors || !options.backdropFilter) return "reduced";
  switch (preferences.profile) {
    case "efficient": return "reduced";
    case "balanced": return "balanced";
    case "performance": return "reduced";
    case "custom": return preferences.customQuality;
    default: return detected;
  }
}

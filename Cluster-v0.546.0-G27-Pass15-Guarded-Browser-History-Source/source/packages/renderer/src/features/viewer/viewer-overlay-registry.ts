import type { ReviewAssetCapabilities, ReviewMedium } from "@cluster/shared";
import {
  VIEWER_OVERLAY_PRESETS,
  VIEWER_OVERLAY_ZONES,
  type ViewerMode,
  type ViewerOverlayDefinition,
  type ViewerOverlayPreferences,
  type ViewerOverlayPreset,
  type ViewerOverlayZone,
} from "./viewer-contracts";

const DEFAULT_PREFERENCES: ViewerOverlayPreferences = { version: 1, preset: "clean", visibleIds: [], placements: [] };

function validZone(value: unknown): value is ViewerOverlayZone {
  return typeof value === "string" && (VIEWER_OVERLAY_ZONES as readonly string[]).includes(value);
}

function validPreset(value: unknown): value is ViewerOverlayPreset {
  return typeof value === "string" && (VIEWER_OVERLAY_PRESETS as readonly string[]).includes(value);
}

function preferenceKey(userId: string, medium: ReviewMedium) {
  return `cluster.viewer.overlays.v1:${encodeURIComponent(userId)}:${medium}`;
}

export function loadViewerOverlayPreferences(userId: string | null | undefined, medium: ReviewMedium): ViewerOverlayPreferences {
  if (!userId || typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(preferenceKey(userId, medium));
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ViewerOverlayPreferences>;
    return {
      version: 1,
      preset: validPreset(parsed.preset) ? parsed.preset : "clean",
      visibleIds: Array.isArray(parsed.visibleIds) ? parsed.visibleIds.map(String).filter(Boolean).slice(0, 128) : [],
      placements: Array.isArray(parsed.placements)
        ? parsed.placements
            .filter((item): item is { id: string; zone: ViewerOverlayZone } => Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string" && "zone" in item && validZone(item.zone)))
            .slice(0, 128)
        : [],
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveViewerOverlayPreferences(userId: string | null | undefined, medium: ReviewMedium, preferences: ViewerOverlayPreferences) {
  if (!userId || typeof window === "undefined") return;
  try { window.localStorage.setItem(preferenceKey(userId, medium), JSON.stringify(preferences)); } catch { /* preferences are non-critical */ }
}

export class ViewerOverlayRegistry {
  private overlays = new Map<string, ViewerOverlayDefinition>();

  replace(overlays: readonly ViewerOverlayDefinition[]) {
    const ids = new Set<string>();
    for (const overlay of overlays) {
      if (!overlay.id.trim() || ids.has(overlay.id)) throw new Error(`Viewer overlay id is invalid or duplicated: ${overlay.id}`);
      if (!validZone(overlay.zone)) throw new Error(`Viewer overlay zone is invalid: ${overlay.zone}`);
      ids.add(overlay.id);
    }
    this.overlays = new Map(overlays.map((overlay) => [overlay.id, overlay]));
  }

  available(input: { medium: ReviewMedium; mode: ViewerMode; capabilities: ReviewAssetCapabilities }) {
    return [...this.overlays.values()]
      .filter((overlay) => !overlay.media || overlay.media.includes(input.medium))
      .filter((overlay) => !overlay.modes || overlay.modes.includes(input.mode))
      .filter((overlay) => !overlay.requiredCapability || input.capabilities[overlay.requiredCapability])
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || a.label.localeCompare(b.label));
  }

  visibleIds(input: { medium: ReviewMedium; mode: ViewerMode; capabilities: ReviewAssetCapabilities; preferences: ViewerOverlayPreferences }) {
    const available = this.available(input);
    const availableIds = new Set(available.map((overlay) => overlay.id));
    if (input.preferences.preset === "custom") return input.preferences.visibleIds.filter((id) => availableIds.has(id));
    if (input.preferences.preset === "clean") return available.filter((overlay) => overlay.defaultVisible).map((overlay) => overlay.id);
    return available.filter((overlay) => overlay.presets?.includes(input.preferences.preset as Exclude<ViewerOverlayPreset, "custom">)).map((overlay) => overlay.id);
  }

  placement(id: string, preferences: ViewerOverlayPreferences) {
    const overlay = this.overlays.get(id);
    if (!overlay) return null;
    const saved = preferences.placements.find((item) => item.id === id);
    return saved?.zone || overlay.zone;
  }
}

export function createViewerOverlayRegistry(overlays: readonly ViewerOverlayDefinition[]) {
  const registry = new ViewerOverlayRegistry();
  registry.replace(overlays);
  return registry;
}

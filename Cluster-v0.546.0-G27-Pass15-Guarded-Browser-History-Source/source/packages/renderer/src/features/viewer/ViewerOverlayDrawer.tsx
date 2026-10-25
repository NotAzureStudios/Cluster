import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInspectorPanel } from "../../components/ClusterWorkspacePanel";
import { ClusterSelect } from "../../components/ClusterSelect";
import type { ViewerOverlayDefinition, ViewerOverlayPreferences, ViewerOverlayPreset, ViewerOverlayZone } from "./viewer-contracts";
import { VIEWER_OVERLAY_PRESETS, VIEWER_OVERLAY_ZONES } from "./viewer-contracts";

const PRESET_LABELS: Record<ViewerOverlayPreset, string> = {
  clean: "Clean",
  review: "Review",
  technical: "Technical",
  performance: "Performance",
  audio: "Audio",
  custom: "Custom",
};

function zoneLabel(zone: ViewerOverlayZone) {
  return zone.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function ViewerOverlayDrawer({
  overlays,
  visibleIds,
  preferences,
  onChange,
  onClose,
  onDetach,
}: {
  overlays: readonly ViewerOverlayDefinition[];
  visibleIds: readonly string[];
  preferences: ViewerOverlayPreferences;
  onChange: (preferences: ViewerOverlayPreferences) => void;
  onClose?: () => void;
  onDetach?: () => void;
}) {
  const visible = new Set(visibleIds);
  const placement = new Map(preferences.placements.map((item) => [item.id, item.zone]));

  function changePreset(value: string) {
    const preset = VIEWER_OVERLAY_PRESETS.includes(value as ViewerOverlayPreset) ? value as ViewerOverlayPreset : "clean";
    onChange({ ...preferences, preset });
  }

  function toggle(id: string) {
    const next = new Set(preferences.preset === "custom" ? preferences.visibleIds : visibleIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ ...preferences, preset: "custom", visibleIds: [...next] });
  }

  function move(id: string, zone: string) {
    if (!VIEWER_OVERLAY_ZONES.includes(zone as ViewerOverlayZone)) return;
    const next = preferences.placements.filter((item) => item.id !== id);
    next.push({ id, zone: zone as ViewerOverlayZone });
    onChange({ ...preferences, placements: next });
  }

  return <ClusterInspectorPanel className="cluster-viewer-overlay-drawer" label="Viewer overlays" title="Overlays" detail="Choose how much production data sits on top of the asset." onClose={onClose} onDetach={onDetach} detachLabel="Open viewer in new window">
    <div className="cluster-viewer-drawer-section">
      <label>Preset</label>
      <ClusterSelect value={preferences.preset} options={VIEWER_OVERLAY_PRESETS.map((preset) => ({ value: preset, label: PRESET_LABELS[preset] }))} onChange={changePreset} ariaLabel="Viewer overlay preset" />
    </div>
    <div className="cluster-viewer-overlay-list">
      {overlays.length ? overlays.map((overlay) => <article key={overlay.id} className="cluster-viewer-overlay-row">
        <ClusterButton type="button" variant="quiet" size="compact" className="cluster-viewer-overlay-toggle" selected={visible.has(overlay.id)} onClick={() => toggle(overlay.id)}>
          <span aria-hidden="true" data-on={visible.has(overlay.id) ? "true" : "false"} />
          <span><strong>{overlay.label}</strong>{overlay.description ? <small>{overlay.description}</small> : null}</span>
        </ClusterButton>
        <ClusterSelect value={placement.get(overlay.id) || overlay.zone} options={VIEWER_OVERLAY_ZONES.map((zone) => ({ value: zone, label: zoneLabel(zone) }))} onChange={(zone) => move(overlay.id, zone)} ariaLabel={`${overlay.label} placement`} />
      </article>) : <p className="muted">This adapter has no overlays available in the current mode.</p>}
    </div>
  </ClusterInspectorPanel>;
}

import { useMemo } from "react";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterButton } from "../../components/ClusterButton";
import { useServerState } from "../../core/server-state";
import type { DashboardWidgetKey } from "../application/application-models";
import {
  CORE_DASHBOARD_KEYS,
  DEFAULT_HOME_WIDGET_KEYS,
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_GROUPS,
  HOME_WIDGET_SIZE_OPTIONS,
  RESIZABLE_HOME_WIDGET_KEYS,
  TOOL_WORKSPACE_WIDGET_KEYS,
  defaultHomeWidgetLayout,
  normalizeHomeWidgetLayout,
  updateHomeWidgetLayout,
  updateHomeWidgetConfiguration,
  homeWidgetPresetKeys,
  reorderHomeWidgetLayout,
  moveHomeWidgetLayout,
  placeHomeWidgetLayout,
  syncCustomHomeWidgets,
  applyHomeWidgetGovernance,
  defaultHomeWidgetProfileState,
  normalizeHomeWidgetProfileState,
  saveHomeWidgetProfile,
  deleteHomeWidgetProfile,
  serializeHomeWidgetProfiles,
  importHomeWidgetProfiles,
  parseHomeWidgetProfileImport,
  type CustomHomeWidgetManifest,
  type HomeWidgetGovernance,
  type HomeWidgetLayoutProfileState,
  type HomeWidgetLayoutState,
  type HomeWidgetSize,
  type HomeWidgetConfig,
  type HomeWidgetPreset,
} from "./home-widget-model";
import "./home-widgets.css";

/* Home dashboard layout state and customization UI are one feature boundary. */
export function useDashboardWidgets(governance?: HomeWidgetGovernance) {
  const [layout, setLayout] = useServerState<HomeWidgetLayoutState>("user", "dashboard.layout-v2", defaultHomeWidgetLayout(), {
    merge: (serverValue, fallback) => applyHomeWidgetGovernance(normalizeHomeWidgetLayout(serverValue, fallback), governance),
  });
  const [profileState, setProfileState] = useServerState<HomeWidgetLayoutProfileState>("user", "dashboard.layout-profiles-v2", defaultHomeWidgetProfileState(), {
    merge: (serverValue) => normalizeHomeWidgetProfileState(serverValue),
  });
  function governed(next: HomeWidgetLayoutState) { return applyHomeWidgetGovernance(next, governance); }
  function update(key: DashboardWidgetKey, value: boolean) {
    if (governance?.required.includes(key) && !value) return;
    if (governance?.unavailable.includes(key) && value) return;
    setLayout((current) => governed(updateHomeWidgetLayout(current, key, { enabled: value })));
  }
  function updateById(id: string, value: boolean) {
    const builtin = DASHBOARD_WIDGETS.some((item) => item.key === id);
    if (builtin) update(id as DashboardWidgetKey, value);
    else setLayout((current) => governed(updateHomeWidgetLayout(current, id, { enabled: value })));
  }
  function applyPreset(keys: DashboardWidgetKey[]) {
    const active = new Set(keys);
    for (const key of governance?.required || []) active.add(key);
    for (const key of governance?.unavailable || []) active.delete(key);
    setLayout((current) => governed({ ...normalizeHomeWidgetLayout(current), items: normalizeHomeWidgetLayout(current).items.map((item) => ({ ...item, enabled: item.source === "custom" ? item.enabled : active.has(item.id as DashboardWidgetKey) })) }));
  }
  function setSize(key: DashboardWidgetKey, size: HomeWidgetSize) { setLayout((current) => governed(updateHomeWidgetLayout(current, key, { size }))); }
  function setSizeById(id: string, size: HomeWidgetSize) { setLayout((current) => governed(updateHomeWidgetLayout(current, id, { size }))); }
  function setColumn(id: string, column: number) { setLayout((current) => governed(updateHomeWidgetLayout(current, id, { column }))); }
  function place(id: string, options: { enabled?: boolean; column?: number; targetId?: string | null; position?: "before" | "after" }) {
    setLayout((current) => governed(placeHomeWidgetLayout(current, id, options)));
  }
  function configure(id: string, patch: Partial<HomeWidgetConfig>) { setLayout((current) => governed(updateHomeWidgetConfiguration(current, id, patch))); }
  function applyPresetByName(preset: HomeWidgetPreset) { applyPreset(homeWidgetPresetKeys(preset)); }
  function applyRecommendedWidgetSet() { applyPreset(governance?.recommended?.length ? governance.recommended : DEFAULT_HOME_WIDGET_KEYS); }
  function reorder(activeId: string, targetId: string, position: "before" | "after" = "before") { setLayout((current) => governed(reorderHomeWidgetLayout(current, activeId, targetId, position))); }
  function move(id: string, delta: -1 | 1) { setLayout((current) => governed(moveHomeWidgetLayout(current, id, delta))); }
  function syncCustom(manifests: CustomHomeWidgetManifest[]) { setLayout((current) => governed(syncCustomHomeWidgets(current, manifests))); }
  function resetLayout() {
    setLayout(governed(defaultHomeWidgetLayout()));
  }
  function resetQuietDefaults() { applyPreset(CORE_DASHBOARD_KEYS); }
  function enableCoreTools() { applyPreset([...CORE_DASHBOARD_KEYS, ...TOOL_WORKSPACE_WIDGET_KEYS]); }
  function enableEverything() { applyPreset(DASHBOARD_WIDGETS.map((item) => item.key)); }
  function saveProfile(name: string, existingId?: string) { setProfileState((current) => saveHomeWidgetProfile(current, name, governed(layout), existingId)); }
  function removeProfile(id: string) { setProfileState((current) => deleteHomeWidgetProfile(current, id)); }
  function exportProfiles(profileIds?: string[]) { return serializeHomeWidgetProfiles(profileState, profileIds); }
  function importProfiles(text: string) {
    const parsed = parseHomeWidgetProfileImport(text);
    if (!parsed) return false;
    setProfileState((current) => importHomeWidgetProfiles(current, parsed));
    return true;
  }
  function applyExternalLayout(externalLayout: HomeWidgetLayoutState, manifests: CustomHomeWidgetManifest[] = []) {
    setLayout(governed(syncCustomHomeWidgets(normalizeHomeWidgetLayout(externalLayout), manifests)));
  }
  function applyProfile(id: string, manifests: CustomHomeWidgetManifest[] = []) {
    const profile = normalizeHomeWidgetProfileState(profileState).profiles.find((item) => item.id === id);
    if (!profile) return;
    applyExternalLayout(profile.layout, manifests);
  }
  const governanceKey = `${(governance?.required || []).join(",")}|${(governance?.unavailable || []).join(",")}|${(governance?.recommended || []).join(",")}`;
  const normalized = useMemo(() => applyHomeWidgetGovernance(normalizeHomeWidgetLayout(layout), governance), [layout, governanceKey]);
  const canonicalWidgets = useMemo(() => Object.fromEntries(DASHBOARD_WIDGETS.map((widget) => [widget.key, normalized.items.find((item) => item.id === widget.key)?.enabled !== false])) as Record<DashboardWidgetKey, boolean>, [normalized]);
  const orderedEnabled = useMemo(() => normalized.items.filter((item) => item.enabled).sort((a, b) => a.order - b.order), [normalized]);
  const profiles = useMemo(() => normalizeHomeWidgetProfileState(profileState).profiles, [profileState]);
  return {
    widgets: canonicalWidgets, layout: normalized, profiles, governance,
    update, updateById, setSize, setSizeById, setColumn, place, configure, applyPresetByName, applyRecommendedWidgetSet, reorder, move, syncCustom,
    saveProfile, removeProfile, exportProfiles, importProfiles, applyProfile, applyExternalLayout, resetLayout, resetQuietDefaults, enableCoreTools, enableEverything,
    show: (key: DashboardWidgetKey) => normalized.items.find((item) => item.id === key)?.enabled !== false,
    size: (key: DashboardWidgetKey) => normalized.items.find((item) => item.id === key)?.size || "standard",
    orderedEnabled,
  };
}

export function DashboardCustomizer({ widgets, layout, onChange, onSizeChange, onResetLayout, onQuietDefaults, onCoreTools, onEnableEverything }: { widgets: Record<DashboardWidgetKey, boolean>; layout?: HomeWidgetLayoutState; onChange: (key: DashboardWidgetKey, value: boolean) => void; onSizeChange?: (key: DashboardWidgetKey, size: HomeWidgetSize) => void; onResetLayout?: () => void; onQuietDefaults: () => void; onCoreTools: () => void; onEnableEverything: () => void }) {
  const enabled = DASHBOARD_WIDGETS.filter((item) => widgets[item.key] !== false).length;
  const normalizedLayout = normalizeHomeWidgetLayout(layout || defaultHomeWidgetLayout());
  const layoutItem = (key: DashboardWidgetKey) => normalizedLayout.items.find((item) => item.id === key);
  return (
    <section className="home-widget-settings-v143">
      <div className="widget-manager-head-v143">
        <div>
          <p className="eyebrow">Home layout</p>
          <h3>Dashboard widgets</h3>
        </div>
        <span className="soft-pill">
          {enabled}/{DASHBOARD_WIDGETS.length} enabled
        </span>
      </div>
      <div className="widget-preset-row-v143" aria-label="Home widget presets">
        <ClusterButton type="button" className="" onClick={onQuietDefaults} variant="quiet" size="compact">
          Quiet
        </ClusterButton>
        <ClusterButton type="button" className="" onClick={onCoreTools} variant="quiet" size="compact">
          Core + tools
        </ClusterButton>
        <ClusterButton type="button" className="" onClick={onEnableEverything} variant="quiet" size="compact">
          Everything
        </ClusterButton>
        {onResetLayout && <ClusterButton type="button" className="" onClick={onResetLayout} variant="quiet" size="compact">Reset layout</ClusterButton>}
      </div>
      <div className="widget-manager-groups-v143">
        {DASHBOARD_WIDGET_GROUPS.map((group) => {
          const groupItems = DASHBOARD_WIDGETS.filter((item) => item.group === group.key);
          const groupEnabled = groupItems.filter((item) => widgets[item.key] !== false).length;
          return (
            <section key={group.key} className="widget-manager-group-v143">
              <div className="widget-manager-group-head-v143">
                <strong>{group.label}</strong>
                <span>
                  {groupEnabled}/{groupItems.length}
                </span>
              </div>
              <div className="widget-toggle-list-v143">
                {groupItems.map((item) => {
                  const placement = layoutItem(item.key);
                  return (
                    <div key={item.key} className={`widget-toggle-v143 widget-layout-row-v483 ${widgets[item.key] !== false ? "enabled" : ""}`} title={item.detail}>
                      <label>
                        <ClusterInput type="checkbox" checked={widgets[item.key] !== false} onChange={(event) => onChange(item.key, event.target.checked)} />
                        <span aria-hidden="true" />
                        <strong>{item.label}</strong>
                      </label>
                      {widgets[item.key] !== false && placement && RESIZABLE_HOME_WIDGET_KEYS.includes(item.key) && (
                        <div className="widget-layout-controls-v483">
                          <ClusterNativeSelect aria-label={`${item.label} size`} value={placement.size} onChange={(event) => onSizeChange?.(item.key, event.target.value as HomeWidgetSize)}>
                            {HOME_WIDGET_SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </ClusterNativeSelect>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useClusterReorder, type ClusterReorderDropPosition } from "../../components/useClusterReorder";
import { useClusterUndoStack } from "../../components/useClusterUndoStack";
import { ClusterHistoryActions, ClusterUndoBar } from "../../components/ClusterContextActions";
import type { DashboardWidgetKey } from "../application/application-models";
import type { HomeLayoutSharingController } from "./home-layout-sharing";
import type { HomeWidgetLibraryController } from "./home-widget-library";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import {
  DASHBOARD_WIDGET_GROUPS,
  DASHBOARD_WIDGETS,
  HOME_WIDGET_SIZE_OPTIONS,
  homeWidgetSizeMeetsMinimum,
  homeWidgetConfigurationCapabilities,
  type CustomHomeWidgetManifest,
  type HomeWidgetConfig,
  type HomeWidgetGovernance,
  type HomeWidgetLayoutProfile,
  type HomeWidgetLayoutState,
  type HomeWidgetMobileLayout,
  type HomeWidgetPreset,
  type HomeWidgetSize,
} from "./home-widget-model";
import "./home-widgets.css";


function widgetLabel(id: string, manifests: CustomHomeWidgetManifest[]) {
  return DASHBOARD_WIDGETS.find((item) => item.key === id)?.label || manifests.find((item) => item.id === id)?.name || id;
}

export function HomeWidgetEditor({
  open,
  onClose,
  focusWidgetId,
  isAdmin,
  layout,
  library,
  availableWidgetIds,
  onToggle,
  onSize,
  onMove,
  onReorder,
  onReset,
  onQuietDefaults,
  onCoreTools,
  onEnableEverything,
  onConfigure,
  studioDefaultPreset = "balanced",
  onStudioDefaults,
  governance,
  profiles = [],
  onSaveProfile,
  onApplyProfile,
  onRemoveProfile,
  onExportProfiles,
  onImportProfiles,
  onStudioWidgetSet,
  studioRecommendationLabel = "Studio",
  sharing,
  onApplyExternalLayout,
  density = "balanced",
  mobileLayout = "stack",
  onMobileLayout,
  projectOptions = [],
  userOptions = [],
  roleOptions = [],
  savedViewOptions = [],
}: {
  open: boolean;
  onClose: () => void;
  focusWidgetId?: string | null;
  isAdmin: boolean;
  layout: HomeWidgetLayoutState;
  library: HomeWidgetLibraryController;
  availableWidgetIds?: string[];
  onToggle: (id: string, value: boolean) => void;
  onSize: (id: string, size: HomeWidgetSize) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (activeId: string, targetId: string, position?: "before" | "after") => void;
  onReset: () => void;
  onQuietDefaults: () => void;
  onCoreTools: () => void;
  onEnableEverything: () => void;
  onConfigure: (id: string, patch: Partial<HomeWidgetConfig>) => void;
  studioDefaultPreset?: HomeWidgetPreset;
  onStudioDefaults: () => void;
  governance?: HomeWidgetGovernance;
  profiles?: HomeWidgetLayoutProfile[];
  onSaveProfile: (name: string, existingId?: string) => void;
  onApplyProfile: (id: string) => void;
  onRemoveProfile: (id: string) => void;
  onExportProfiles: (profileIds?: string[]) => string;
  onImportProfiles: (text: string) => boolean;
  onStudioWidgetSet: () => void;
  studioRecommendationLabel?: string;
  sharing: HomeLayoutSharingController;
  onApplyExternalLayout: (layout: HomeWidgetLayoutState) => void;
  density?: "compact" | "balanced" | "expanded";
  mobileLayout?: HomeWidgetMobileLayout;
  onMobileLayout?: (layout: HomeWidgetMobileLayout) => void;
  projectOptions?: Array<{ id: string; label?: string; name?: string }>;
  userOptions?: Array<{ id: string; label?: string; displayName?: string | null; username?: string }>;
  roleOptions?: Array<{ id: string; label?: string; enabled?: boolean }>;
  savedViewOptions?: Array<{ id: string; label?: string; name?: string; scope?: string }>;
}) {
  const [tab, setTab] = useState<"layout" | "catalog" | "profiles">("layout");
  const [configureId, setConfigureId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSource, setCatalogSource] = useState<"all" | "builtin" | "gallery" | "custom">("all");
  const [profileName, setProfileName] = useState("");
  const [profileTransferMessage, setProfileTransferMessage] = useState("");
  useEffect(() => {
    if (!open || !focusWidgetId) return;
    setTab("layout");
    setConfigureId(focusWidgetId);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-home-widget-editor-id="${CSS.escape(focusWidgetId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [open, focusWidgetId]);
  const availableIds = availableWidgetIds ? new Set(availableWidgetIds) : null;
  const visibleBuiltin = DASHBOARD_WIDGETS.filter((definition) => (!availableIds || availableIds.has(definition.key)) && (!definition.adminOnly || isAdmin) && (!definition.desktopOnly || library.desktop));
  const visibleManifests = library.manifests.filter((manifest) => !availableIds || availableIds.has(manifest.id));
  const visibleGalleryManifests = library.galleryManifests.filter((manifest) => !availableIds || availableIds.has(manifest.id));
  const visibleInstalledManifests = library.installedManifests.filter((manifest) => !availableIds || availableIds.has(manifest.id));
  const unavailable = new Set(governance?.unavailable || []);
  const required = new Set(governance?.required || []);
  const blockedById = new Map(library.blockedManifests.map((item) => [item.manifest.id, item.reason]));
  const visibleIds = new Set([...visibleBuiltin.filter((item) => !unavailable.has(item.key)).map((item) => item.key), ...visibleManifests.map((item) => item.id)]);
  const ordered = layout.items.filter((item) => visibleIds.has(item.id)).sort((a, b) => a.order - b.order);
  const undoStack = useClusterUndoStack({ limit: 20 });
  function reorderWithHistory(activeId: string, targetId: string, position: ClusterReorderDropPosition) {
    if (activeId === targetId) return;
    const ids = ordered.map((item) => item.id);
    const activeIndex = ids.indexOf(activeId);
    const previousId = activeIndex > 0 ? ids[activeIndex - 1] : null;
    const nextId = activeIndex >= 0 && activeIndex < ids.length - 1 ? ids[activeIndex + 1] : null;
    onReorder(activeId, targetId, position);
    undoStack.push({
      id: `home-widget-reorder-${Date.now()}-${activeId}`,
      label: `Moved ${widgetLabel(activeId, library.manifests)}`,
      undo: () => { if (nextId && nextId !== activeId) onReorder(activeId, nextId, "before"); else if (previousId && previousId !== activeId) onReorder(activeId, previousId, "after"); },
      redo: () => onReorder(activeId, targetId, position),
    });
  }
  const reorder = useClusterReorder({ ids: ordered.map((item) => item.id), onReorder: reorderWithHistory });
  const enabledCount = ordered.filter((item) => item.enabled).length;
  const needle = catalogQuery.trim().toLowerCase();
  const filteredBuiltin = ["gallery", "custom"].includes(catalogSource) ? [] : visibleBuiltin.filter((definition) => !needle || `${definition.label} ${definition.detail} ${definition.tool || ""} ${definition.group}`.toLowerCase().includes(needle));
  const matchesManifest = (manifest: CustomHomeWidgetManifest) => !needle || `${manifest.name} ${manifest.description || ""} ${manifest.id} ${(manifest.permissions || []).join(" ")} ${manifest.gallery?.category || ""} ${(manifest.gallery?.tags || []).join(" ")}`.toLowerCase().includes(needle);
  const filteredGallery = ["builtin", "custom"].includes(catalogSource) ? [] : visibleGalleryManifests.filter(matchesManifest);
  const filteredCustom = ["builtin", "gallery"].includes(catalogSource) ? [] : visibleInstalledManifests.filter(matchesManifest);

  function downloadProfiles(profileIds?: string[]) {
    const text = onExportProfiles(profileIds);
    if (!text) return;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = profileIds?.length === 1 ? "cluster-home-layout.json" : "cluster-home-layouts.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setProfileTransferMessage(profileIds?.length === 1 ? "Profile exported." : "Profiles exported.");
  }

  async function importProfilesFile(file?: File) {
    if (!file) return;
    if (file.size > 131072) { setProfileTransferMessage("Profile import is too large. Maximum size is 128 KiB."); return; }
    try {
      const imported = onImportProfiles(await file.text());
      setProfileTransferMessage(imported ? "Home profiles imported and validated." : "That file is not a valid Cluster Home profile export.");
    } catch { setProfileTransferMessage("Cluster could not read that profile file."); }
  }

  return (
    <ClusterModal open={open} onClose={onClose} backdropClassName="home-widget-editor-backdrop-v484" className="home-widget-editor-v484" labelledBy="home-widget-editor-title-v36">
        <header className="home-widget-editor-head-v484">
          <div>
            <p className="eyebrow">Home editor</p>
            <h2 id="home-widget-editor-title-v36">Home settings</h2>
            <span>{enabledCount} enabled · {density} density · advanced layout, profiles, and widget sources</span>
          </div>
          <ClusterButton variant="secondary" size="compact" onClick={onClose}>Done</ClusterButton>
        </header>

        <nav className="home-widget-editor-tabs-v484" aria-label="Home editor sections">
          <ClusterButton type="button" variant="quiet" size="compact" className={tab === "layout" ? "active" : ""} selected={tab === "layout"} onClick={() => setTab("layout")}>Advanced layout</ClusterButton>
          <ClusterButton type="button" variant="quiet" size="compact" className={tab === "catalog" ? "active" : ""} selected={tab === "catalog"} onClick={() => setTab("catalog")}>Sources & gallery</ClusterButton>
          <ClusterButton type="button" variant="quiet" size="compact" className={tab === "profiles" ? "active" : ""} selected={tab === "profiles"} onClick={() => setTab("profiles")}>Profiles</ClusterButton>
        </nav>

        {tab === "layout" ? (
          <div className="home-widget-layout-editor-v484">
            <section className={`home-widget-default-guide-v495 ${enabledCount === 0 ? "first-use" : ""}`} aria-label="Home starting layout">
              <div><strong>{enabledCount === 0 ? "Start your Home" : "Layout starting point"}</strong><span>{enabledCount === 0 ? `Your Home is empty. Start from the Studio ${studioDefaultPreset.replace("-", " ")} layout or a focused core-tool set.` : `Studio default is ${studioDefaultPreset.replace("-", " ")}. Applying it preserves Studio-required and unavailable widget policy.`}</span></div>
              <div><ClusterButton variant="primary" size="compact" onClick={onStudioDefaults}>Apply Studio default</ClusterButton><ClusterButton variant="secondary" size="compact" onClick={onCoreTools}>Use core + tools</ClusterButton></div>
            </section>
            <div className="home-widget-preset-strip-v484">
              <div className="home-widget-mobile-layout-v504"><span>Mobile layout</span><ClusterSelect ariaLabel="Mobile Home layout" value={mobileLayout} options={[{ value: "stack", label: "Stack" }, { value: "grid", label: "Grid" }, { value: "carousel", label: "Carousel" }, { value: "focus", label: "Focus" }]} onChange={(value) => onMobileLayout?.(value as HomeWidgetMobileLayout)} /></div>
              <ClusterButton variant="secondary" size="compact" onClick={onStudioDefaults}>Studio default</ClusterButton>
              <span className="home-widget-studio-default-v485">{studioDefaultPreset.replace("-", " ")}</span>
              {Boolean(governance?.recommended.length) && <ClusterButton variant="secondary" size="compact" onClick={onStudioWidgetSet}>Studio widget set · {studioRecommendationLabel}</ClusterButton>}
              {Boolean(governance?.required.length || governance?.unavailable.length) && <span className="home-widget-governance-summary-v486">{governance?.required.length || 0} required · {governance?.unavailable.length || 0} unavailable</span>}
              <ClusterButton variant="quiet" size="compact" onClick={onQuietDefaults}>Quiet</ClusterButton>
              <ClusterButton variant="quiet" size="compact" onClick={onCoreTools}>Core + tools</ClusterButton>
              <ClusterButton variant="quiet" size="compact" onClick={onEnableEverything}>Everything</ClusterButton>
              <ClusterButton variant="quiet" size="compact" onClick={onReset}>Reset</ClusterButton>
            </div>
            <div className="home-widget-order-list-v484">
              {ordered.map((item, index) => (
                <article
                  key={item.id}
                  className={`home-widget-order-row-v484 ${item.enabled ? "enabled" : ""}`}
                  data-home-widget-editor-id={item.id}
                  {...reorder.itemProps(item.id)}
                >
                  <ClusterButton unstyled type="button" className="home-widget-drag-handle-v484" aria-label={`Drag ${widgetLabel(item.id, library.manifests)}`} tabIndex={-1}><ClusterIcon name="drag" /></ClusterButton>
                  <label className="home-widget-enable-v484">
                    <ClusterInput type="checkbox" checked={item.enabled} disabled={item.source === "builtin" && required.has(item.id as DashboardWidgetKey)} onChange={(event) => onToggle(item.id, event.target.checked)} />
                    <span><strong>{widgetLabel(item.id, library.manifests)}</strong><em>{item.source === "custom" ? "Custom" : required.has(item.id as DashboardWidgetKey) ? "Studio required" : "Built in"}</em></span>
                  </label>
                  <ClusterNativeSelect aria-label={`${widgetLabel(item.id, library.manifests)} size`} value={item.size} onChange={(event) => onSize(item.id, event.target.value as HomeWidgetSize)}>
                    {HOME_WIDGET_SIZE_OPTIONS.map((option) => {
                      const minimum = item.source === "custom" ? library.manifests.find((manifest) => manifest.id === item.id)?.minSize : undefined;
                      return <option key={option.value} value={option.value} disabled={!homeWidgetSizeMeetsMinimum(option.value, minimum)}>{option.label}</option>;
                    })}
                  </ClusterNativeSelect>
                  <div className="home-widget-order-buttons-v484">
                    <ClusterButton variant="quiet" size="compact" disabled={index === 0} onClick={() => reorder.move(item.id, -1)} aria-label={`Move ${widgetLabel(item.id, library.manifests)} up`}><ClusterIcon name="chevron-up" /></ClusterButton>
                    <ClusterButton variant="quiet" size="compact" disabled={index === ordered.length - 1} onClick={() => reorder.move(item.id, 1)} aria-label={`Move ${widgetLabel(item.id, library.manifests)} down`}><ClusterIcon name="chevron-down" /></ClusterButton>
                    {homeWidgetConfigurationCapabilities(item.id).length > 0 && <ClusterButton variant="quiet" size="compact" onClick={() => setConfigureId((current) => current === item.id ? null : item.id)} aria-expanded={configureId === item.id}>{configureId === item.id ? "Hide" : "Options"}</ClusterButton>}
                  </div>
                  {configureId === item.id && (() => {
                    const capabilities = homeWidgetConfigurationCapabilities(item.id);
                    return <div className="home-widget-config-panel-v485">
                      <div><strong>Widget options</strong><span>Only settings that change this widget materially are exposed.</span></div>
                      <div className="home-widget-config-grid-v485">
                        {capabilities.includes("listLimit") && <div className="home-widget-config-field-v485"><span>Rows</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} rows`} value={String(item.config?.listLimit || 0)} options={[{ value: "0", label: "Automatic" }, { value: "2", label: "2 rows" }, { value: "4", label: "4 rows" }, { value: "6", label: "6 rows" }, { value: "8", label: "8 rows" }]} onChange={(value) => onConfigure(item.id, { listLimit: Number(value) || undefined })} /></div> || null}
                        {capabilities.includes("clockFormat") && <div className="home-widget-config-field-v485"><span>Clock content</span><ClusterSelect ariaLabel="Clock content" value={item.config?.clockFormat || "datetime"} options={[{ value: "time", label: "Time only" }, { value: "date", label: "Date only" }, { value: "datetime", label: "Time and date" }]} onChange={(value) => onConfigure(item.id, { clockFormat: value as HomeWidgetConfig["clockFormat"] })} /></div> || null}
                        {capabilities.includes("noteTitle") && <label className="wide"><span>Note heading</span><ClusterTextInput maxLength={48} value={item.config?.noteTitle || ""} placeholder="Note" onChange={(event) => onConfigure(item.id, { noteTitle: event.target.value || undefined })} /></label>}
                        {capabilities.includes("context") && <div className="home-widget-config-field-v485"><span>Context</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} context`} value={item.config?.context || "studio"} options={[{ value: "studio", label: "Studio" }, { value: "current-project", label: "Current project" }, { value: "project", label: "Specific project" }, { value: "me", label: "Me" }, { value: "user", label: "Specific user" }, { value: "my-role", label: "My role" }, { value: "role", label: "Specific role" }]} onChange={(value) => onConfigure(item.id, { context: value as HomeWidgetConfig["context"], contextId: value === "project" ? item.config?.contextId : undefined })} /></div>}
                        {capabilities.includes("context") && item.config?.context === "project" && <div className="home-widget-config-field-v485"><span>Project</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} project`} value={item.config?.contextId || ""} options={[{ value: "", label: "Choose project" }, ...projectOptions.map((project) => ({ value: project.id, label: project.label || project.name || project.id }))]} onChange={(value) => onConfigure(item.id, { contextId: value || undefined })} /></div>}
                        {capabilities.includes("context") && item.config?.context === "user" && <div className="home-widget-config-field-v485"><span>User</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} user`} value={item.config?.contextId || ""} options={[{ value: "", label: "Choose user" }, ...userOptions.map((user) => ({ value: user.id, label: user.label || user.displayName || user.username || user.id }))]} onChange={(value) => onConfigure(item.id, { contextId: value || undefined })} /></div>}
                        {capabilities.includes("context") && item.config?.context === "role" && <div className="home-widget-config-field-v485"><span>Role</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} role`} value={item.config?.contextId || ""} options={[{ value: "", label: "Choose role" }, ...roleOptions.filter((role) => role.enabled !== false).map((role) => ({ value: role.id, label: role.label || role.id }))]} onChange={(value) => onConfigure(item.id, { contextId: value || undefined })} /></div>}
                        {capabilities.includes("timeRange") && <div className="home-widget-config-field-v485"><span>Time range</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} time range`} value={item.config?.timeRange || "all"} options={[{ value: "all", label: "All" }, { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }]} onChange={(value) => onConfigure(item.id, { timeRange: value as HomeWidgetConfig["timeRange"] })} /></div>}
                        {capabilities.includes("filter") && <label className="wide"><span>Filter</span><ClusterTextInput maxLength={80} value={item.config?.filterText || ""} placeholder="Filter visible rows" onChange={(event) => onConfigure(item.id, { filterText: event.target.value || undefined })} /></label>}
                        {capabilities.includes("detailLevel") && <div className="home-widget-config-field-v485"><span>Detail</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} detail`} value={item.config?.detailLevel || "standard"} options={[{ value: "compact", label: "Compact" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" }]} onChange={(value) => onConfigure(item.id, { detailLevel: value as HomeWidgetConfig["detailLevel"] })} /></div>}
                        {capabilities.includes("savedView") && <div className="home-widget-config-field-v485"><span>Saved view</span><ClusterSelect ariaLabel={`${widgetLabel(item.id, library.manifests)} saved view`} value={item.config?.savedViewId || ""} options={[{ value: "", label: "None" }, ...savedViewOptions.map((view) => ({ value: view.id, label: view.label || view.name || view.id }))]} onChange={(value) => onConfigure(item.id, { savedViewId: value || undefined })} /></div>}
                        {capabilities.includes("actions") && <label className="toggle"><ClusterInput type="checkbox" checked={item.config?.showActions !== false} onChange={(event) => onConfigure(item.id, { showActions: event.target.checked })} /><span>Show secondary actions</span></label>}
                      </div>
                    </div>;
                  })()}
                </article>
              ))}
            </div>
            <span className="sr-only" role="status" aria-live="polite">{reorder.statusMessage}</span>
            {(undoStack.canUndo || undoStack.canRedo) ? <ClusterHistoryActions canUndo={undoStack.canUndo} canRedo={undoStack.canRedo} undoLabel={undoStack.undoLabel} redoLabel={undoStack.redoLabel} onUndo={async () => { await undoStack.undo(); }} onRedo={async () => { await undoStack.redo(); }} /> : null}
            {undoStack.canUndo ? <ClusterUndoBar message={`${undoStack.undoLabel || "Layout changed"}.`} onUndo={async () => { await undoStack.undo(); }} onDismiss={undoStack.clear} /> : null}
          </div>
        ) : tab === "profiles" ? (
          <div className="home-widget-profiles-v486">
            {sharing.loading ? <div className="home-widget-source-state-v495" role="status"><span className="skeleton-line" /><div><strong>Loading Studio layouts</strong><span>Checking templates and layouts shared with this Studio.</span></div></div> : null}
            {!sharing.loading && sharing.message ? <div className="home-widget-source-state-v495" role="status"><div><strong>Studio layout status</strong><span>{sharing.message}</span></div><ClusterButton variant="quiet" size="compact" onClick={() => void sharing.refresh()}>Refresh</ClusterButton></div> : null}
            {!sharing.loading && !sharing.state.templates.length && !sharing.state.sharedProfiles.length && !profiles.length ? <section className="home-widget-first-profile-v495"><div><strong>No saved layout starting points yet</strong><span>Save the current layout for yourself, or apply the Studio default before customizing. Admins can publish the current Home as a managed template for everyone.</span></div><div><ClusterButton variant="secondary" size="compact" onClick={onStudioDefaults}>Apply Studio default</ClusterButton>{isAdmin ? <ClusterButton variant="quiet" size="compact" disabled={sharing.busy} onClick={() => void sharing.publishTemplate("Studio Home", "Studio-managed Home starting layout", layout)}>Publish current for Studio</ClusterButton> : null}</div></section> : null}
            <section className="home-widget-profile-save-v486">
              <div><strong>Save this layout</strong><span>Profiles capture widget order, visibility, size, and widget options. Studio-required and unavailable rules are reapplied when a profile is restored.</span></div>
              <div><ClusterTextInput value={profileName} maxLength={40} placeholder="Layout name" onChange={(event) => setProfileName(event.target.value)} /><ClusterButton variant="primary" size="compact" disabled={!profileName.trim() || profiles.length >= 8} onClick={() => { onSaveProfile(profileName); setProfileName(""); }}>Save profile</ClusterButton></div>
              <small>{profiles.length}/8 saved layouts</small>
              <div className="home-widget-profile-transfer-v487"><ClusterButton variant="secondary" size="compact" disabled={!profiles.length} onClick={() => downloadProfiles()}>Export all</ClusterButton><ClusterFileButton label="Import Home profiles" accept="application/json,.json" size="compact" onChange={(event) => importProfilesFile(event.target.files?.[0])}>Import</ClusterFileButton></div>
              {profileTransferMessage && <small role="status">{profileTransferMessage}</small>}
            </section>
            <div className="home-widget-profile-list-v486">
              {profiles.map((profile) => {
                const shared = sharing.ownSharedProfile(profile);
                return <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.layout.items.filter((item) => item.enabled).length} widgets · updated {new Date(profile.updatedAt).toLocaleDateString()}{shared ? " · shared" : ""}</span></div><div><ClusterButton variant="secondary" size="compact" onClick={() => onApplyProfile(profile.id)}>Apply</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => onSaveProfile(profile.name, profile.id)}>Update</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => downloadProfiles([profile.id])}>Export</ClusterButton><ClusterButton variant="quiet" size="compact" disabled={sharing.busy} onClick={() => void sharing.shareProfile(profile)}>{shared ? "Update share" : "Share"}</ClusterButton>{shared && <ClusterButton variant="quiet" size="compact" disabled={sharing.busy} onClick={() => void sharing.unshareProfile(shared.id)}>Unshare</ClusterButton>}<ClusterButton variant="danger" size="compact" onClick={() => void (async () => { const confirmed = await confirmCluster({ title: "Delete Home profile?", message: `Delete ${profile.name}? Your current Home layout will not change.`, confirmLabel: "Delete", tone: "danger" }); if (confirmed) onRemoveProfile(profile.id); })()}>Delete</ClusterButton></div></article>;
              })}
              {!profiles.length && <div className="empty-state compact-empty"><strong>No saved Home profiles</strong><span>Save layouts for different workflows instead of rebuilding the dashboard every time your job changes shape.</span></div>}
            </div>
            <section className="home-widget-studio-templates-v488">
              <header><div><strong>Studio templates</strong><span>Named layouts published by Studio admins. Applying one still respects required/unavailable widget governance.</span></div>{isAdmin && <ClusterButton variant="primary" size="compact" disabled={sharing.busy || sharing.state.templates.length >= 12} onClick={() => void (async () => { const name = (await promptCluster({ title: "Publish Home template", message: "Name the Studio-managed Home layout template.", label: "Template name", confirmLabel: "Publish" }))?.trim(); if (name) await sharing.publishTemplate(name, "Studio-managed Home layout", layout); })()}>Publish current</ClusterButton>}</header>
              <div className="home-widget-shared-grid-v488">{sharing.state.templates.map((template) => <article key={template.id}><div><strong>{template.name}</strong><span>{template.description || `${template.layout.items.filter((item) => item.enabled).length} widgets`} · updated {new Date(template.updatedAt).toLocaleDateString()}</span></div><div><ClusterButton variant="secondary" size="compact" onClick={() => onApplyExternalLayout(template.layout)}>Apply</ClusterButton>{isAdmin && <ClusterButton variant="quiet" size="compact" disabled={sharing.busy} onClick={() => void sharing.publishTemplate(template.name, template.description, layout, template.id)}>Update from current</ClusterButton>}{isAdmin && <ClusterButton variant="danger" size="compact" disabled={sharing.busy} onClick={() => void (async () => { const confirmed = await confirmCluster({ title: "Delete Studio Home template?", message: `Delete ${template.name}? Existing personal layouts are not changed.`, confirmLabel: "Delete", tone: "danger" }); if (confirmed) await sharing.removeTemplate(template.id); })()}>Delete</ClusterButton>}</div></article>)}</div>
              {!sharing.loading && !sharing.state.templates.length && <div className="empty-state compact-empty"><strong>No Studio templates</strong><span>Admins can publish the current Home layout as a reusable Studio template.</span></div>}
            </section>
            <section className="home-widget-shared-profiles-v488">
              <header><div><strong>Shared with Studio</strong><span>Optional member-published layouts. Shared layouts contain dashboard metadata only, not credentials or account settings.</span></div><em>{sharing.state.sharedProfiles.length}</em></header>
              <div className="home-widget-shared-grid-v488">{sharing.state.sharedProfiles.map((profile) => <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.ownerLabel} · updated {new Date(profile.updatedAt).toLocaleDateString()}</span></div><div><ClusterButton variant="secondary" size="compact" onClick={() => onApplyExternalLayout(profile.layout)}>Apply</ClusterButton>{(profile.ownerUserId === sharing.currentUserId || isAdmin) && <ClusterButton variant="quiet" size="compact" disabled={sharing.busy} onClick={() => void sharing.unshareProfile(profile.id)}>Remove share</ClusterButton>}</div></article>)}</div>
              {!sharing.loading && !sharing.state.sharedProfiles.length && <div className="empty-state compact-empty"><strong>No shared layouts</strong><span>Use Share on one of your saved profiles to publish it to this Studio.</span></div>}
              {sharing.message && <small role="status">{sharing.message}</small>}
            </section>
          </div>
        ) : (
          <div className="home-widget-catalog-v484">
            <section className="home-widget-trust-summary-v495" aria-label="Widget trust and policy">
              <div><strong>Declarative widget sandbox</strong><span>Home widgets can request approved Cluster data, but manifests cannot ship or execute arbitrary plugin code.</span></div>
              <div className="home-widget-trust-badges-v495">
                <span>Built in · trusted</span>
                <span>Gallery · first party</span>
                <span>Custom · validated manifest</span>
                <span>{library.policy.mode === "allow" ? "Studio policy · extensions allowed" : library.policy.mode === "curated-only" ? "Studio policy · curated only" : "Studio policy · extensions blocked"}</span>
              </div>
            </section>
            <div className="home-widget-catalog-toolbar-v486"><ClusterTextInput type="search" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search widgets, tools, or permissions" aria-label="Search widget library" /><ClusterSelect ariaLabel="Widget source" value={catalogSource} options={[{ value: "all", label: "All widgets" }, { value: "builtin", label: "Built in" }, { value: "gallery", label: "Gallery" }, { value: "custom", label: "Installed" }]} onChange={(value) => setCatalogSource(value as typeof catalogSource)} /></div>
            {DASHBOARD_WIDGET_GROUPS.map((group) => {
              const definitions = filteredBuiltin.filter((item) => item.group === group.key);
              if (!definitions.length) return null;
              return (
                <section key={group.key} className="home-widget-catalog-group-v484">
                  <header><div><strong>{group.label}</strong><span>{group.detail}</span></div><em>{definitions.length}</em></header>
                  <div className="home-widget-catalog-grid-v484">
                    {definitions.map((definition) => {
                      const placement = layout.items.find((item) => item.id === definition.key);
                      return (
                        <article key={definition.key}>
                          <div><strong>{definition.label}</strong><span>{definition.detail}</span></div>
                          <footer>
                            {definition.tool && <em>{definition.tool}</em>}
                            {unavailable.has(definition.key) ? <span className="home-widget-managed-badge-v486">Unavailable by Studio</span> : required.has(definition.key) ? <span className="home-widget-managed-badge-v486">Required by Studio</span> : <ClusterButton variant={placement?.enabled ? "quiet" : "secondary"} size="compact" onClick={() => onToggle(definition.key, !placement?.enabled)}>{placement?.enabled ? "Remove" : "Add"}</ClusterButton>}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {catalogSource !== "builtin" && catalogSource !== "custom" && <section className="home-widget-catalog-group-v484 gallery-v487">
              <header><div><strong>Curated gallery</strong><span>First-party declarative widgets shipped with Cluster. No install or executable code.</span></div><em>{filteredGallery.length}</em></header>
              <div className="home-widget-catalog-grid-v484">
                {filteredGallery.map((manifest) => {
                  const placement = layout.items.find((item) => item.id === manifest.id);
                  const blocked = blockedById.get(manifest.id);
                  return <article key={manifest.id}><div><strong>{manifest.name}</strong><span>{manifest.description || `Curated declarative widget · v${manifest.version}`}</span>{manifest.gallery && <small className="home-widget-gallery-meta-v488">{manifest.gallery.category} · v{manifest.version} · {manifest.gallery.tags.join(" · ")}</small>}{blocked && <small>{blocked}</small>}</div><footer><em>{manifest.permissions?.length ? manifest.permissions.join(" · ") : "No data permissions"}</em><ClusterButton variant={placement?.enabled ? "quiet" : "secondary"} size="compact" disabled={Boolean(blocked)} onClick={() => onToggle(manifest.id, !placement?.enabled)}>{blocked ? "Blocked by Studio" : placement?.enabled ? "Remove from Home" : "Add to Home"}</ClusterButton></footer></article>;
                })}
                {!filteredGallery.length && <div className="empty-state compact-empty"><strong>No gallery widgets match</strong><span>Try a broader search or switch the source filter.</span></div>}
              </div>
            </section>}

            {catalogSource !== "builtin" && catalogSource !== "gallery" && <section className="home-widget-catalog-group-v484 custom">
              <header>
                <div><strong>Custom widgets</strong><span>Validated declarative manifests. No executable plugin code.</span></div>
                <em>{filteredCustom.length}</em>
              </header>
              {library.desktop ? (
                <>
                  {library.loading ? <div className="home-widget-source-state-v495" role="status"><span className="skeleton-line" /><div><strong>Scanning managed widget library</strong><span>Validating installed manifests and Studio policy before they appear in Home.</span></div></div> : null}
                  <div className="home-widget-library-actions-v484">
                    <ClusterButton variant="primary" size="compact" disabled={library.policy.mode !== "allow" || library.loading} onClick={() => void library.install()}>Install folder</ClusterButton>
                    <ClusterButton variant="secondary" size="compact" onClick={() => void library.refresh()} disabled={library.loading}>Rescan</ClusterButton>
                    <ClusterButton variant="secondary" size="compact" onClick={() => void library.openFolder()}>Open library</ClusterButton>
                    <span>{library.policy.mode === "allow" ? (library.status?.invalidCount ? `${library.status.invalidCount} invalid manifest${library.status.invalidCount === 1 ? "" : "s"} ignored` : "Managed library clean") : library.policy.mode === "curated-only" ? "Studio allows curated widgets only" : "Extension widgets disabled by Studio"}</span>
                  </div>
                  {library.message && <p className="home-widget-library-message-v484" role="status">{library.message}</p>}
                  {Boolean(library.status?.invalidWidgets?.length) && <div className="home-widget-library-message-v484" role="status"><strong>Rejected manifests</strong>{library.status!.invalidWidgets.slice(0, 5).map((item) => <span key={item.entry}>{item.entry}: {item.reason}</span>)}</div>}
                  <div className="home-widget-catalog-grid-v484">
                    {filteredCustom.map((manifest) => {
                      const placement = layout.items.find((item) => item.id === manifest.id);
                      const blocked = blockedById.get(manifest.id);
                      return (
                        <article key={manifest.id}>
                          <div><strong>{manifest.name}</strong><span>{manifest.description || `Declarative widget · v${manifest.version}`}</span><small>{manifest.publisher ? `${manifest.publisher} · ` : ""}v{manifest.version}{manifest.provenance?.digest ? ` · ${manifest.provenance.digest.slice(0, 12)}` : ""}</small>{blocked && <small>{blocked}</small>}</div>
                          <footer>
                            <em>{manifest.permissions?.length ? manifest.permissions.join(" · ") : "No data permissions"}</em>
                            <div>
                              <ClusterButton variant="quiet" size="compact" disabled={Boolean(blocked)} onClick={() => onToggle(manifest.id, !placement?.enabled)}>{blocked ? "Blocked by Studio" : placement?.enabled ? "Remove from Home" : "Add to Home"}</ClusterButton>
                              <ClusterButton variant="danger" size="compact" onClick={() => void (async () => { const confirmed = await confirmCluster({ title: "Uninstall custom widget?", message: `Remove ${manifest.name} from this Desktop widget library? Its managed manifest will be deleted.`, confirmLabel: "Uninstall", tone: "danger" }); if (confirmed) await library.remove(manifest.id); })()}>Uninstall</ClusterButton>
                            </div>
                          </footer>
                        </article>
                      );
                    })}
                    {!filteredCustom.length && <div className="empty-state compact-empty"><strong>{library.installedManifests.length ? "No matching custom widgets" : "No custom widgets installed"}</strong><span>{library.installedManifests.length ? "Try a broader search or switch the source filter." : "Install a folder containing a validated widget.json manifest."}</span></div>}
                  </div>
                </>
              ) : (
                <div className="empty-state compact-empty"><strong>Desktop-managed library</strong><span>Folder widgets are installed and validated by Cluster Desktop. Built-in Home widgets remain available on Web.</span></div>
              )}
            </section>}
            {!filteredBuiltin.length && !filteredGallery.length && !filteredCustom.length && <div className="empty-state compact-empty"><strong>No widgets match</strong><span>Search by widget name, tool, description, ID, or permission.</span></div>}
          </div>
        )}
    </ClusterModal>
  );
}

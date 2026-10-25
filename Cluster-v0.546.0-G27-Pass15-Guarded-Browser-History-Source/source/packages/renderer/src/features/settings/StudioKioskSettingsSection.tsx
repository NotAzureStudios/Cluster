import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CLUSTER_KIOSK_PROFILES,
  normalizeClusterKioskProfiles,
  type ClusterKioskProfile,
  type ClusterKioskPreset,
  type ClusterKioskSessionMode,
} from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { NumberStepper } from "../../components/NumberStepper";
import { queryApi } from "../../core/api";
import { DASHBOARD_WIDGETS } from "../home-widgets/home-widget-model";
import { KIOSK_POLICY_SCREEN_OPTIONS } from "../desktop/kiosk-policy";
import type { Settings } from "../application/application-models";

type SettingsPatch = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

type KioskPresetKey = "wallboard" | "interactive" | "operations";

const PRESET_LABELS: Record<ClusterKioskPreset, string> = {
  wallboard: "Wallboard",
  interactive: "Interactive station",
  operations: "Operations display",
  qa: "QA station",
  guest: "Guest / public",
  custom: "Custom",
};

function cloneProfiles(value: unknown) {
  return normalizeClusterKioskProfiles(value).map((profile) => ({
    ...profile,
    allowedScreens: [...profile.allowedScreens],
    allowedProjectIds: [...profile.allowedProjectIds],
    homeWidgetIds: [...profile.homeWidgetIds],
    rotationScreens: [...profile.rotationScreens],
    scheduleDays: [...profile.scheduleDays],
    publicCards: profile.publicCards.map((card) => ({ ...card })),
  }));
}

function uniqueProfileId(profiles: Array<{ id: string }>, base: string) {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "kiosk";
  if (!profiles.some((profile) => profile.id === clean)) return clean;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${clean}-${index}`;
    if (!profiles.some((profile) => profile.id === candidate)) return candidate;
  }
  return `kiosk-${Date.now().toString(36)}`;
}

function presetPatch(preset: KioskPresetKey): Partial<ClusterKioskProfile> {
  if (preset === "wallboard") return { preset, sessionMode: "signed-in", lockNavigation: true, hideNavigation: true, homeScreen: "dashboard", allowedScreens: ["dashboard", "activity", "tickets"], homeWidgetIds: ["brief", "readiness", "builds", "qa", "timeline", "clock"], idleResetMinutes: 5, readOnly: true, managedExitRequired: true, rotationSeconds: 30, rotationScreens: ["dashboard", "activity", "tickets"], hidePointerSeconds: 3, keepAwake: true, publicEnabled: false };
  if (preset === "operations") return { preset, sessionMode: "signed-in", lockNavigation: true, hideNavigation: true, homeScreen: "activity", allowedScreens: ["activity", "tickets", "projects", "builds", "qa"], homeWidgetIds: ["brief", "projects", "builds", "qa", "tickets", "opsHealth", "clock"], idleResetMinutes: 5, readOnly: true, managedExitRequired: true, rotationSeconds: 30, rotationScreens: ["activity", "tickets", "projects"], hidePointerSeconds: 3, keepAwake: true, publicEnabled: false };
  return { preset, sessionMode: "signed-in", lockNavigation: true, hideNavigation: false, homeScreen: "dashboard", allowedScreens: ["dashboard", "mywork", "projects", "project", "board", "whiteboard", "timeline", "builds", "qa", "tickets", "inbox", "people", "activity", "library"], idleResetMinutes: 15, readOnly: false, managedExitRequired: true, rotationSeconds: 0, rotationScreens: [], touchMode: false, hidePointerSeconds: 0, keepAwake: false, publicEnabled: false };
}

export function StudioKioskSettingsSection({ settings, patch }: { settings: Settings; patch: SettingsPatch }) {
  const profiles = useMemo(() => cloneProfiles(settings.desktopKioskProfiles), [settings.desktopKioskProfiles]);
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void queryApi<{ projects?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>("/api/projects", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["projects"] })
      .then((result) => { if (!cancelled) setProjectOptions(Array.isArray(result) ? result : result.projects || []); })
      .catch(() => { if (!cancelled) setProjectOptions([]); });
    return () => { cancelled = true; };
  }, []);
  const [selectedProfileId, setSelectedProfileId] = useState(() => settings.desktopKioskSignedInProfileId || profiles[0]?.id || "staff");
  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) setSelectedProfileId(profiles[0]?.id || "");
  }, [profiles, selectedProfileId]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || profiles[0] || DEFAULT_CLUSTER_KIOSK_PROFILES[0];
  const selectedDestinations = new Set(selectedProfile.allowedScreens);
  const selectedProjects = new Set(selectedProfile.allowedProjectIds);
  const selectedWidgets = new Set(selectedProfile.homeWidgetIds);
  const selectedRotationScreens = new Set(selectedProfile.rotationScreens);
  const healthIssues = [
    !selectedProfile.enabled ? "Profile is disabled." : "",
    !selectedProfile.allowedScreens.length ? "No destinations are allowed." : "",
    selectedProfile.sessionMode === "signed-out" && !selectedProfile.publicEnabled ? "Guest content is not published." : "",
    selectedProfile.sessionMode === "signed-out" && !selectedProfile.readOnly ? "Guest profiles should remain read-only." : "",
    selectedProfile.rotationSeconds > 0 && selectedProfile.rotationScreens.length < 2 ? "Rotation needs at least two screens." : "",
    selectedProfile.scheduleEnabled && !selectedProfile.scheduleDays.length ? "Scheduled kiosk has no active days." : "",
  ].filter(Boolean);
  const signedInProfiles = profiles.filter((profile) => profile.enabled && profile.sessionMode === "signed-in");
  const signedOutProfiles = profiles.filter((profile) => profile.enabled && profile.sessionMode === "signed-out");

  const patchProfiles = (nextProfiles: ClusterKioskProfile[]) => patch("desktopKioskProfiles", nextProfiles);
  const updateProfile = (updates: Partial<ClusterKioskProfile>) => {
    patchProfiles(profiles.map((profile) => profile.id === selectedProfile.id ? { ...profile, ...updates } : profile));
  };
  const updatePublicCard = (cardId: string, updates: Partial<ClusterKioskProfile["publicCards"][number]>) => {
    updateProfile({ publicCards: selectedProfile.publicCards.map((card) => card.id === cardId ? { ...card, ...updates } : card) });
  };
  const addProfile = (sessionMode: ClusterKioskSessionMode) => {
    const id = uniqueProfileId(profiles, sessionMode === "signed-out" ? "guest-display" : "station");
    const template = sessionMode === "signed-out" ? DEFAULT_CLUSTER_KIOSK_PROFILES[1] : DEFAULT_CLUSTER_KIOSK_PROFILES[0];
    const next: ClusterKioskProfile = { ...template, id, name: sessionMode === "signed-out" ? "Guest display" : "Kiosk station", preset: sessionMode === "signed-out" ? "guest" : "custom", sessionMode, publicEnabled: sessionMode === "signed-out", allowedScreens: [...template.allowedScreens], allowedProjectIds: [], homeWidgetIds: [...template.homeWidgetIds], rotationScreens: [...template.rotationScreens], scheduleDays: [...template.scheduleDays], publicCards: [] };
    patchProfiles([...profiles, next]);
    if (sessionMode === "signed-in" && !settings.desktopKioskSignedInProfileId) patch("desktopKioskSignedInProfileId", id);
    if (sessionMode === "signed-out" && !settings.desktopKioskSignedOutProfileId) patch("desktopKioskSignedOutProfileId", id);
    setSelectedProfileId(id);
  };
  const removeProfile = () => {
    if (profiles.length <= 1) return;
    const next = profiles.filter((profile) => profile.id !== selectedProfile.id);
    patchProfiles(next);
    if (settings.desktopKioskSignedInProfileId === selectedProfile.id) patch("desktopKioskSignedInProfileId", next.find((profile) => profile.enabled && profile.sessionMode === "signed-in")?.id || "");
    if (settings.desktopKioskSignedOutProfileId === selectedProfile.id) patch("desktopKioskSignedOutProfileId", next.find((profile) => profile.enabled && profile.sessionMode === "signed-out")?.id || "");
    setSelectedProfileId(next[0]?.id || "");
  };
  const applyPreset = (preset: KioskPresetKey) => {
    const next = presetPatch(preset);
    updateProfile(next);
  };

  return (
    <div className="settings-section-v092 studio-settings-section-v272">
      <div className="settings-panel-head-v092 studio-section-intro-v272">
        <div>
          <p className="eyebrow">Desktop policy</p>
          <h2>Kiosk mode</h2>
          <p className="muted tight">Build named kiosk profiles here. App Settings chooses signed-in or signed-out operation and launches the matching default profile on that Desktop.</p>
        </div>
      </div>
      <div className="settings-card-grid-v092">
        <div className="settings-card-v092 span-2 kiosk-profile-manager-v495">
          <div className="settings-card-head-v092"><h3>Kiosk profiles</h3><span>{profiles.length} configured</span></div>
          <div className="kiosk-profile-toolbar-v495">
            <ClusterNativeSelect value={selectedProfile.id} onChange={(event) => setSelectedProfileId(event.target.value)} aria-label="Kiosk profile">
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.sessionMode === "signed-out" ? "Guest" : "Signed in"}</option>)}
            </ClusterNativeSelect>
            <ClusterButton type="button" className="" onClick={() => addProfile("signed-in")} variant="secondary">Add station</ClusterButton>
            <ClusterButton type="button" className="" onClick={() => addProfile("signed-out")} variant="secondary">Add guest</ClusterButton>
            <ClusterButton type="button" className="" aria-pressed={previewOpen} onClick={() => setPreviewOpen((open) => !open)} variant="secondary">{previewOpen ? "Hide preview" : "Preview"}</ClusterButton>
            <ClusterButton type="button" className="" disabled={profiles.length <= 1} onClick={removeProfile} variant="danger">Remove</ClusterButton>
          </div>
          <div className="two-col compact-fields-v092 kiosk-profile-fields-v495">
            <div className="field"><label>Profile name</label><ClusterInput value={selectedProfile.name} maxLength={64} onChange={(event) => updateProfile({ name: event.target.value })} /></div>
            <div className="field"><label>Preset</label><ClusterNativeSelect value={selectedProfile.preset} onChange={(event) => updateProfile({ preset: event.target.value as ClusterKioskPreset })}>{Object.entries(PRESET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ClusterNativeSelect></div>
            <div className="field"><label>Session mode</label><ClusterNativeSelect value={selectedProfile.sessionMode} onChange={(event) => updateProfile({ sessionMode: event.target.value as ClusterKioskSessionMode, publicEnabled: event.target.value === "signed-out" ? selectedProfile.publicEnabled : false })}><option value="signed-in">Signed in</option><option value="signed-out">Signed out / guest</option></ClusterNativeSelect></div>
            <div className="field"><label>Status</label><ClusterNativeSelect value={selectedProfile.enabled ? "enabled" : "disabled"} onChange={(event) => updateProfile({ enabled: event.target.value === "enabled" })}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></ClusterNativeSelect></div>
          </div>
          <div className="two-col compact-fields-v092">
            <div className="field"><label>Default signed-in profile</label><ClusterNativeSelect value={settings.desktopKioskSignedInProfileId || signedInProfiles[0]?.id || ""} onChange={(event) => patch("desktopKioskSignedInProfileId", event.target.value)}>{signedInProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</ClusterNativeSelect></div>
            <div className="field"><label>Default signed-out profile</label><ClusterNativeSelect value={settings.desktopKioskSignedOutProfileId || signedOutProfiles[0]?.id || ""} onChange={(event) => patch("desktopKioskSignedOutProfileId", event.target.value)}>{signedOutProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</ClusterNativeSelect></div>
          </div>
        </div>

        {previewOpen && (
          <div className="settings-card-v092 span-2 kiosk-profile-preview-v495" aria-label={`Preview of ${selectedProfile.name}`}>
            <div className="settings-card-head-v092"><h3>Presentation preview</h3><span>{selectedProfile.sessionMode === "signed-out" ? "Guest / public" : "Signed-in station"}</span></div>
            <div className="kiosk-profile-preview-stage-v495" data-session={selectedProfile.sessionMode} data-touch={selectedProfile.touchMode ? "true" : "false"}>
              <div className="kiosk-profile-preview-topline-v495"><span>{selectedProfile.name}</span><span>{selectedProfile.readOnly ? "Read only" : "Interactive"}</span></div>
              {selectedProfile.sessionMode === "signed-out" ? (
                <div className="kiosk-profile-preview-public-v495">
                  <p className="eyebrow">Published guest display</p>
                  <h3>{selectedProfile.publicTitle || "Cluster"}</h3>
                  <p>{selectedProfile.publicMessage || "No public message configured."}</p>
                  <div className="kiosk-profile-preview-cards-v495">
                    {selectedProfile.publicCards.slice(0, 3).map((card) => <article key={card.id} data-tone={card.tone}><strong>{card.title}</strong><span>{card.body}</span></article>)}
                    {!selectedProfile.publicCards.length && <article><strong>{selectedProfile.publicShowServerStatus ? "Server status" : "Published content"}</strong><span>{selectedProfile.publicShowServerStatus ? "Public server health appears here." : "Add information cards to this guest profile."}</span></article>}
                  </div>
                </div>
              ) : (
                <div className="kiosk-profile-preview-public-v495">
                  <p className="eyebrow">Kiosk Home</p>
                  <h3>{selectedProfile.homeScreen === "dashboard" ? "Home" : selectedProfile.homeScreen}</h3>
                  <p>{selectedProfile.homeWidgetIds.length ? `${selectedProfile.homeWidgetIds.length} dedicated large-format widgets` : "Uses the signed-in user's normal Home layout."}</p>
                  <div className="kiosk-profile-preview-cards-v495">
                    {(selectedProfile.homeWidgetIds.length ? selectedProfile.homeWidgetIds.slice(0, 3) : selectedProfile.allowedScreens.slice(0, 3)).map((item) => <article key={item}><strong>{item}</strong><span>{selectedProfile.homeWidgetIds.length ? "Kiosk widget" : "Allowed destination"}</span></article>)}
                  </div>
                </div>
              )}
              <div className="kiosk-profile-preview-footer-v495"><span>{selectedProfile.hideNavigation ? "Navigation hidden" : "Navigation visible"}</span><span>{selectedProfile.rotationSeconds >= 10 ? `Rotates every ${selectedProfile.rotationSeconds}s` : "Fixed screen"}</span><span>{selectedProfile.keepAwake ? "Keep-awake" : "Normal display sleep"}</span></div>
            </div>
            <small>This is a safe settings preview, not a live kiosk session. Server permissions, monitor placement, fullscreen containment, and native shortcuts are validated separately.</small>
          </div>
        )}

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Useful starting points</h3><span>Applies to {selectedProfile.name}</span></div>
          <div className="kiosk-preset-grid-v495">
            <article><div><strong>Wallboard</strong><span>Read-only Home/status display with hidden chrome and a short idle return.</span></div><ClusterButton type="button" className="" onClick={() => applyPreset("wallboard")} variant="secondary">Use wallboard</ClusterButton></article>
            <article><div><strong>Interactive station</strong><span>Bounded production workstation with navigation visible.</span></div><ClusterButton type="button" className="" onClick={() => applyPreset("interactive")} variant="secondary">Use interactive</ClusterButton></article>
            <article><div><strong>Operations display</strong><span>Status, reports, Projects, Builds, QA, and Tickets with chrome hidden.</span></div><ClusterButton type="button" className="" onClick={() => applyPreset("operations")} variant="secondary">Use operations</ClusterButton></article>
          </div>
        </div>

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Navigation & interaction</h3><span>{selectedProfile.readOnly ? "Read-only presentation" : "Interaction allowed"}</span></div>
          <div className="studio-policy-grid-v484">
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.lockNavigation} onChange={(event) => updateProfile({ lockNavigation: event.target.checked })} /><span><strong>Lock navigation</strong><small>Redirect routes outside this profile's allowlist back to its Home screen.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.hideNavigation} onChange={(event) => updateProfile({ hideNavigation: event.target.checked })} /><span><strong>Hide app navigation</strong><small>Remove Cluster navigation chrome for wallboards and fixed displays.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.readOnly} onChange={(event) => updateProfile({ readOnly: event.target.checked })} /><span><strong>Read-only profile</strong><small>Server-enforced: unsafe data mutations are rejected while this signed-in kiosk session is active.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.managedExitRequired} onChange={(event) => updateProfile({ managedExitRequired: event.target.checked })} /><span><strong>Managed exit authentication</strong><small>Require a security PIN for signed-in exit or an administrator password/PIN for signed-out exit.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.touchMode} onChange={(event) => updateProfile({ touchMode: event.target.checked })} /><span><strong>Touch mode</strong><small>Increase minimum interactive target size and avoid pointer-only assumptions.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.keepAwake} onChange={(event) => updateProfile({ keepAwake: event.target.checked })} /><span><strong>Keep display awake</strong><small>Request the OS/browser screen wake lock while this kiosk is visible.</small></span></label>
          </div>
          <div className="two-col compact-fields-v092">
            <div className="field"><label>Kiosk Home screen</label><ClusterNativeSelect value={selectedProfile.homeScreen} onChange={(event) => updateProfile({ homeScreen: event.target.value as ClusterKioskProfile["homeScreen"] })}><option value="dashboard">Home</option><option value="projects">Projects</option><option value="mywork">My Work</option><option value="activity">Activity</option></ClusterNativeSelect></div>
            <div className="field"><label>Idle reset</label><NumberStepper value={selectedProfile.idleResetMinutes} min={0} max={120} step={1} onValueChange={(value) => updateProfile({ idleResetMinutes: Number(value) || 0 })} /><small>Minutes before an unattended kiosk returns Home. Set 0 to disable.</small></div>
          </div>
        </div>

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Kiosk Home & presentation</h3><span>{selectedProfile.homeWidgetIds.length ? `${selectedProfile.homeWidgetIds.length} dedicated widgets` : "Uses normal Home layout"}</span></div>
          <p className="muted tight">Selecting widgets creates a dedicated large-format Home for this profile without rewriting the user's normal dashboard.</p>
          <div className="kiosk-screen-grid-v484">
            {DASHBOARD_WIDGETS.filter((widget) => !widget.desktopOnly).map((widget) => <label key={widget.key} className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedWidgets.has(widget.key)} onChange={(event) => { const next = new Set(selectedProfile.homeWidgetIds); if (event.target.checked) next.add(widget.key); else next.delete(widget.key); updateProfile({ homeWidgetIds: Array.from(next).slice(0, 24) }); }} /><span><strong>{widget.label}</strong><small>{widget.detail}</small></span></label>)}
          </div>
          <div className="two-col compact-fields-v092">
            <div className="field"><label>Rotation interval</label><NumberStepper value={selectedProfile.rotationSeconds} min={0} max={600} step={5} onValueChange={(value) => updateProfile({ rotationSeconds: Number(value) || 0 })} /><small>Seconds between screens. 0 disables rotation; values under 10 do not rotate.</small></div>
            <div className="field"><label>Hide pointer after</label><NumberStepper value={selectedProfile.hidePointerSeconds} min={0} max={120} step={1} onValueChange={(value) => updateProfile({ hidePointerSeconds: Number(value) || 0 })} /><small>Seconds of pointer inactivity. 0 keeps the pointer visible.</small></div>
          </div>
          <div className="kiosk-screen-grid-v484">
            {KIOSK_POLICY_SCREEN_OPTIONS.filter((option) => selectedDestinations.has(option.value as ClusterKioskProfile["allowedScreens"][number])).map((option) => <label key={`rotation-${option.value}`} className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedRotationScreens.has(option.value as ClusterKioskProfile["rotationScreens"][number])} onChange={(event) => { const next = new Set(selectedProfile.rotationScreens); if (event.target.checked) next.add(option.value as ClusterKioskProfile["rotationScreens"][number]); else next.delete(option.value as ClusterKioskProfile["rotationScreens"][number]); updateProfile({ rotationScreens: Array.from(next).slice(0, 8) }); }} /><span><strong>{option.label}</strong><small>Include in automatic rotation</small></span></label>)}
          </div>
        </div>

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Project scope</h3><span>{selectedProfile.allowedProjectIds.length ? `${selectedProfile.allowedProjectIds.length} allowed` : "All permitted projects"}</span></div>
          <p className="muted tight">Optional extra restriction on top of the signed-in user's normal permissions. The server enforces this list for kiosk requests.</p>
          <div className="kiosk-screen-grid-v484">
            {projectOptions.map((project) => <label key={project.id} className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProjects.has(project.id)} onChange={(event) => { const next = new Set(selectedProfile.allowedProjectIds); if (event.target.checked) next.add(project.id); else next.delete(project.id); updateProfile({ allowedProjectIds: Array.from(next).slice(0, 128) }); }} /><span><strong>{project.name}</strong><small>{project.id}</small></span></label>)}
            {!projectOptions.length && <p className="muted tight">Project choices will appear when Cluster can read the project index.</p>}
          </div>
        </div>

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Startup & schedule</h3><span>{selectedProfile.autoStart ? "Automatic" : "Manual launch"}</span></div>
          <div className="studio-policy-grid-v484">
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.autoStart} onChange={(event) => updateProfile({ autoStart: event.target.checked })} /><span><strong>Auto-start this default profile</strong><small>When Cluster Desktop is running, enter/leave kiosk automatically according to the profile schedule.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.scheduleEnabled} onChange={(event) => updateProfile({ scheduleEnabled: event.target.checked })} /><span><strong>Use schedule window</strong><small>Outside the active window, scheduled kiosk mode exits automatically.</small></span></label>
          </div>
          {selectedProfile.scheduleEnabled && <><div className="two-col compact-fields-v092"><div className="field"><label>Start</label><ClusterInput type="time" value={selectedProfile.scheduleStart} onChange={(event) => updateProfile({ scheduleStart: event.target.value })} /></div><div className="field"><label>End</label><ClusterInput type="time" value={selectedProfile.scheduleEnd} onChange={(event) => updateProfile({ scheduleEnd: event.target.value })} /></div></div><div className="kiosk-day-grid-v495">{([['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']] as const).map(([value,label]) => <label key={value}><ClusterInput type="checkbox" checked={selectedProfile.scheduleDays.includes(value)} onChange={(event) => { const next = new Set(selectedProfile.scheduleDays); if (event.target.checked) next.add(value); else next.delete(value); updateProfile({ scheduleDays: Array.from(next) as ClusterKioskProfile['scheduleDays'] }); }} /><span>{label}</span></label>)}</div></>}
        </div>

        {selectedProfile.sessionMode === "signed-out" && (
          <div className="settings-card-v092 span-2 kiosk-publication-v495">
            <div className="settings-card-head-v092"><h3>Published guest content</h3><span>Explicit public DTO only</span></div>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.publicEnabled} onChange={(event) => updateProfile({ publicEnabled: event.target.checked })} /><span><strong>Publish this guest profile</strong><small>When off, the public kiosk endpoint returns no profile content.</small></span></label>
            <label className="studio-setting-toggle-v272"><ClusterInput type="checkbox" checked={selectedProfile.publicShowServerStatus} onChange={(event) => updateProfile({ publicShowServerStatus: event.target.checked })} /><span><strong>Show server status</strong><small>Display the existing public health state beside the published content.</small></span></label>
            <div className="two-col compact-fields-v092"><div className="field"><label>Offline fallback</label><ClusterNativeSelect value={selectedProfile.offlineBehavior} onChange={(event) => updateProfile({ offlineBehavior: event.target.value as ClusterKioskProfile["offlineBehavior"] })}><option value="last-known">Last-known published content</option><option value="status">Offline status only</option><option value="message">Custom offline message</option></ClusterNativeSelect></div><div className="field"><label>Offline message</label><ClusterTextarea value={selectedProfile.offlineMessage} maxLength={300} rows={2} onChange={(event) => updateProfile({ offlineMessage: event.target.value })} /></div></div>
            <div className="two-col compact-fields-v092">
              <div className="field"><label>Public title</label><ClusterInput value={selectedProfile.publicTitle} maxLength={80} onChange={(event) => updateProfile({ publicTitle: event.target.value })} /></div>
              <div className="field"><label>Public message</label><ClusterTextarea value={selectedProfile.publicMessage} maxLength={600} rows={3} onChange={(event) => updateProfile({ publicMessage: event.target.value })} /></div>
            </div>
            <div className="settings-card-head-v092 kiosk-public-card-head-v495"><h3>Information cards</h3><ClusterButton type="button" className="" disabled={selectedProfile.publicCards.length >= 12} onClick={() => { const id = uniqueProfileId(selectedProfile.publicCards, "card"); updateProfile({ publicCards: [...selectedProfile.publicCards, { id, title: "Announcement", body: "Published kiosk information", tone: "neutral" }] }); }} variant="secondary">Add card</ClusterButton></div>
            <div className="kiosk-public-card-list-v495">
              {selectedProfile.publicCards.map((card) => <article key={card.id}>
                <ClusterInput value={card.title} maxLength={80} aria-label="Public card title" onChange={(event) => updatePublicCard(card.id, { title: event.target.value })} />
                <ClusterTextarea value={card.body} maxLength={800} rows={2} aria-label="Public card body" onChange={(event) => updatePublicCard(card.id, { body: event.target.value })} />
                <ClusterNativeSelect value={card.tone} aria-label="Public card tone" onChange={(event) => updatePublicCard(card.id, { tone: event.target.value as typeof card.tone })}><option value="neutral">Neutral</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option></ClusterNativeSelect>
                <ClusterButton type="button" className="" onClick={() => updateProfile({ publicCards: selectedProfile.publicCards.filter((item) => item.id !== card.id) })} variant="secondary">Remove</ClusterButton>
              </article>)}
              {!selectedProfile.publicCards.length && <p className="muted tight">No public cards. The title, message, and optional server status are still safe to publish.</p>}
            </div>
          </div>
        )}

        <div className="settings-card-v092 span-2 kiosk-runtime-readiness-v495">
          <div className="settings-card-head-v092"><h3>Runtime safeguards</h3><span>{selectedProfile.name}</span></div>
          <div className="kiosk-runtime-grid-v495">
            <article data-state={healthIssues.length ? "notice" : "ready"}><strong>Configuration health</strong><span>{healthIssues.length ? healthIssues.join(" ") : "Profile passes the built-in kiosk configuration checks."}</span></article>
            <article data-state={selectedProfile.lockNavigation ? "ready" : "notice"}><strong>Route locking</strong><span>{selectedProfile.lockNavigation ? `Restricted routes return to ${selectedProfile.homeScreen}.` : "Navigation remains unrestricted by this profile."}</span></article>
            <article data-state={selectedProfile.idleResetMinutes > 0 ? "ready" : "notice"}><strong>Idle recovery</strong><span>{selectedProfile.idleResetMinutes > 0 ? `Returns Home after ${selectedProfile.idleResetMinutes} minute${selectedProfile.idleResetMinutes === 1 ? "" : "s"}.` : "Automatic idle reset is disabled."}</span></article>
            <article data-state={selectedProfile.sessionMode === "signed-out" && !selectedProfile.publicEnabled ? "notice" : "ready"}><strong>Guest boundary</strong><span>{selectedProfile.sessionMode === "signed-out" ? (selectedProfile.publicEnabled ? "Only explicitly published profile fields are exposed without a session." : "Guest publishing is disabled for this profile.") : "This profile retains the signed-in account's normal permissions."}</span></article>
            <article data-state="ready"><strong>Emergency exit</strong><span>The native Desktop escape shortcut remains available even when Cluster navigation is hidden.</span></article>
            <article data-state="ready"><strong>Native containment</strong><span>Secondary workspaces, App Settings, Server Profiles, and accidental window close are blocked while kiosk is active.</span></article>
          </div>
          <small className="kiosk-runtime-note-v495">Target-OS monitor geometry, sleep/wake, task switching, reconnect, and long-running kiosk stability remain part of the Desktop runtime soak matrix.</small>
        </div>

        <div className="settings-card-v092 span-2">
          <div className="settings-card-head-v092"><h3>Allowed destinations</h3><span>{selectedProfile.homeScreen} is always included</span></div>
          <div className="kiosk-screen-grid-v484">
            {KIOSK_POLICY_SCREEN_OPTIONS.map((option) => {
              const home = selectedProfile.homeScreen === option.value;
              return <label key={option.value} className={`studio-setting-toggle-v272 ${home ? "locked" : ""}`}><ClusterInput type="checkbox" checked={home || selectedDestinations.has(option.value as ClusterKioskProfile["allowedScreens"][number])} disabled={home} onChange={(event) => { const next = new Set(selectedProfile.allowedScreens); if (event.target.checked) next.add(option.value as ClusterKioskProfile["allowedScreens"][number]); else next.delete(option.value as ClusterKioskProfile["allowedScreens"][number]); updateProfile({ allowedScreens: Array.from(next) }); }} /><span><strong>{option.label}</strong><small>{home ? "Kiosk Home" : option.value}</small></span></label>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

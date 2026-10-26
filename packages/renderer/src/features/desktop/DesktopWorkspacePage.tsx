import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { ClusterInput } from "../../components/ClusterNativeControls";
import {
  clearNativeLibraryMountCache,
  getNativeGlobalShortcutStatus,
  getNativeLibraryMountStatus,
  getNativeRuntimeInfo,
  refreshNativeLibraryMount,
  setNativeGlobalShortcutsEnabled,
  startNativeLibraryMount,
  stopNativeLibraryMount,
  type ClusterNativeGlobalShortcutStatus,
  type ClusterNativeLibraryMountStatus,
  type ClusterNativeRuntimeInfo,
} from "../../core/desktop";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import type { Settings } from "../application/application-models";
import { DesktopNativeServicesPanel } from "./DesktopNativeServicesPanel";
import { DesktopWorkstationPanel } from "./DesktopWorkstationPanel";
import "./desktop-workspace.css";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";

type DesktopMountPreferences = {
  desktopLibraryMountEnabled?: boolean;
  desktopLibraryMountLayout?: "unified" | "separate";
  desktopLibraryMountOrganization?: "servers" | "libraries";
  desktopLibraryMountLocation?: string;
};

type PreferencePayload = { ok: true; preferences: DesktopMountPreferences };

function terms(platform?: string) {
  if (platform === "windows") return { feature: "Cluster Drive", unit: "drive", plural: "drives", location: "Drive letter", layout: "Drive layout", example: "L:", action: "Mount drive" };
  if (platform === "macos") return { feature: "Cluster Volume", unit: "volume", plural: "volumes", location: "Volume name", layout: "Volume layout", example: "Cluster", action: "Mount volume" };
  return { feature: "Cluster Mount", unit: "mount", plural: "mounts", location: "Mount location", layout: "Mount layout", example: "~/Cluster", action: "Mount Libraries" };
}

function ShortcutKey({ children }: { children: string }) {
  return <kbd className="desktop-shortcut-key-v482">{children}</kbd>;
}

export default function DesktopWorkspacePage({ serverSettings }: { serverSettings: Settings }) {
  const desktop = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const [runtime, setRuntime] = useState<ClusterNativeRuntimeInfo | null>(null);
  const [mountStatus, setMountStatus] = useState<ClusterNativeLibraryMountStatus | null>(null);
  const [shortcutStatus, setShortcutStatus] = useState<ClusterNativeGlobalShortcutStatus | null>(null);
  const [prefs, setPrefs] = useState<DesktopMountPreferences>({ desktopLibraryMountEnabled: false, desktopLibraryMountLayout: "unified", desktopLibraryMountOrganization: "servers", desktopLibraryMountLocation: "" });
  const [saving, setSaving] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const requiredAutoStartAttempted = useRef(false);

  const refreshNativeState = async () => {
    const [nextMount, nextShortcuts] = await Promise.allSettled([getNativeLibraryMountStatus(), getNativeGlobalShortcutStatus()]);
    if (nextMount.status === "fulfilled") setMountStatus(nextMount.value);
    if (nextShortcuts.status === "fulfilled") setShortcutStatus(nextShortcuts.value);
  };

  useEffect(() => {
    if (!desktop) return;
    void getNativeRuntimeInfo().then(setRuntime).catch(() => undefined);
    void refreshNativeState();
    void api<PreferencePayload>("/api/me/preferences")
      .then((result) => setPrefs((current) => ({ ...current, ...(result.preferences || {}) })))
      .catch(() => undefined)
      .finally(() => setPrefsLoaded(true));
  }, [desktop]);

  useVisibleRefresh(() => refreshNativeState(), { enabled: desktop, intervalMs: 30_000, minimumGapMs: 2_000 });

  const wording = terms(runtime?.platform || mountStatus?.platform);
  const mountPolicy = serverSettings.libraryDesktopMountPolicy || "user-choice";
  const isolation = serverSettings.libraryDesktopMountIsolation || "shared";
  const crossServerPolicy = serverSettings.libraryCrossServerTransferPolicy || "disabled";
  const sensitiveCachePolicy = serverSettings.librarySensitiveOfflineCachePolicy || mountStatus?.sensitiveOfflineCachePolicy || "disabled";
  const protectedCache = mountStatus?.protectedCache;
  const readOnly = Boolean(serverSettings.libraryDesktopMountReadOnly);
  const forcedSeparate = isolation === "dedicated" || isolation === "exclusive";
  const requiredMount = mountPolicy === "required";
  const mountEnabled = requiredMount ? true : Boolean(prefs.desktopLibraryMountEnabled);
  const effectiveLayout = forcedSeparate ? "separate" : (prefs.desktopLibraryMountLayout || "unified");
  const policySummary = useMemo(() => {
    if (mountPolicy === "disabled") return `${wording.feature} access is disabled by this server.`;
    if (isolation === "exclusive") return `This server requires an exclusive ${wording.unit} while mounted.`;
    if (isolation === "dedicated") return `This server requires its own ${wording.unit}.`;
    return `This server can share one ${wording.feature} with your other eligible Cluster servers.`;
  }, [isolation, mountPolicy, wording.feature, wording.unit]);

  useEffect(() => {
    if (!desktop || !prefsLoaded || !requiredMount || requiredAutoStartAttempted.current) return;
    if (!mountStatus?.engineReady || !mountStatus?.authenticated || mountStatus.running || mountStatus.refreshing || nativeBusy) return;
    requiredAutoStartAttempted.current = true;
    void startNativeLibraryMount({
      layout: effectiveLayout,
      organization: prefs.desktopLibraryMountOrganization || "servers",
      location: prefs.desktopLibraryMountLocation || "",
    }).then(setMountStatus).catch((error) => {
      setMessage(error instanceof Error ? error.message : `The required ${wording.feature} could not be mounted.`);
    });
  }, [desktop, effectiveLayout, mountStatus?.authenticated, mountStatus?.engineReady, mountStatus?.refreshing, mountStatus?.running, nativeBusy, prefs.desktopLibraryMountLocation, prefs.desktopLibraryMountOrganization, prefsLoaded, requiredMount, wording.feature]);

  async function saveMountPreferences() {
    setSaving(true);
    setMessage("");
    try {
      const next: DesktopMountPreferences = {
        ...prefs,
        desktopLibraryMountEnabled: mountPolicy === "disabled" ? false : requiredMount ? true : Boolean(prefs.desktopLibraryMountEnabled),
        desktopLibraryMountLayout: effectiveLayout,
        desktopLibraryMountOrganization: prefs.desktopLibraryMountOrganization || "servers",
        desktopLibraryMountLocation: String(prefs.desktopLibraryMountLocation || "").trim().slice(0, 180),
      };
      const result = await api<PreferencePayload>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ preferences: next }) });
      setPrefs((current) => ({ ...current, ...(result.preferences || next) }));
      setMessage("Desktop Library preferences saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save Desktop Library preferences.");
    } finally {
      setSaving(false);
    }
  }

  async function runNative(action: "start" | "stop" | "refresh" | "clear") {
    setNativeBusy(true);
    setMessage("");
    try {
      if (action === "start") {
        const next = await startNativeLibraryMount({ layout: effectiveLayout, organization: prefs.desktopLibraryMountOrganization || "servers", location: prefs.desktopLibraryMountLocation || "" });
        setMountStatus(next);
        setMessage(`${wording.feature} mounted.`);
      } else if (action === "stop") {
        setMountStatus(await stopNativeLibraryMount());
        setMessage(`${wording.feature} unmounted.`);
      } else if (action === "refresh") {
        await refreshNativeLibraryMount();
        setMessage("Library manifest refresh started.");
      } else {
        await clearNativeLibraryMountCache();
        setMessage("Mounted Library cache cleared.");
      }
      await refreshNativeState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The native Library operation failed.");
      await refreshNativeState();
    } finally {
      setNativeBusy(false);
    }
  }

  async function toggleGlobalShortcuts(enabled: boolean) {
    setNativeBusy(true);
    try { setShortcutStatus(await setNativeGlobalShortcutsEnabled(enabled)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update global shortcuts."); }
    finally { setNativeBusy(false); }
  }

  if (!desktop) return <section className="page desktop-workspace-v481"><ToolPageHeader eyebrow="Desktop" title="Desktop workspace" description="Open this workspace in Cluster Desktop to use native operating-system features." /></section>;

  return <section className="page desktop-workspace-v481">
    <ToolPageHeader eyebrow="Desktop" title="Desktop workspace" description="Device-native tools live here as real workspace features: mounted Libraries, transfers, global shortcuts, local files, and runtime health." />

    <div className="desktop-feature-grid-v482">
      <section className="desktop-mount-card-v481 desktop-feature-primary-v482" aria-label={`${wording.feature} configuration`}>
        <header>
          <div><p className="eyebrow">Mounted Libraries</p><h2>{wording.feature}</h2><p>{policySummary}</p></div>
          <span className={`desktop-mount-state-v481 ${mountStatus?.running ? "ready" : mountStatus?.engineReady ? "available" : "planned"}`}>{mountStatus?.running ? "Mounted" : mountStatus?.engineReady ? "Ready" : "Provider needed"}</span>
        </header>
        <div className="desktop-mount-policy-v481">
          <div><span>Server policy</span><strong>{mountPolicy === "disabled" ? "Disabled" : mountPolicy === "required" ? "Mount required" : "User choice"}</strong></div>
          <div><span>Isolation</span><strong>{isolation === "exclusive" ? "Exclusive" : isolation === "dedicated" ? `Separate ${wording.unit}` : "Shared allowed"}</strong></div>
          <div><span>Cross-server moves</span><strong>{crossServerPolicy.replace("trusted-only", "Trusted servers only")}</strong></div>
          <div><span>Sensitive offline cache</span><strong>{sensitiveCachePolicy === "protected" ? "Protected when device supports it" : "Disabled"}</strong></div>
          <div><span>Write access</span><strong>{readOnly ? "Read only" : "Revision protected"}</strong></div>
        </div>
        <div className="desktop-mount-grid-v481">
          <label><span>Use {wording.feature}{requiredMount ? " · required" : ""}</span><ClusterInput type="checkbox" checked={mountEnabled} disabled={mountPolicy === "disabled" || requiredMount} onChange={(event) => setPrefs((current) => ({ ...current, desktopLibraryMountEnabled: event.target.checked }))} /></label>
          <label><span>{wording.layout}</span><ClusterSelect ariaLabel="Desktop Library mount layout" value={effectiveLayout} disabled={forcedSeparate || Boolean(mountStatus?.running)} onChange={(value) => setPrefs((current) => ({ ...current, desktopLibraryMountLayout: value as "unified" | "separate" }))} options={[{ value: "unified", label: `One ${wording.feature}` }, { value: "separate", label: `Separate ${wording.plural} per server` }]} /></label>
          {effectiveLayout === "unified" && <label><span>Organization</span><ClusterSelect ariaLabel="Desktop Library organization" value={prefs.desktopLibraryMountOrganization || "servers"} disabled={Boolean(mountStatus?.running)} onChange={(value) => setPrefs((current) => ({ ...current, desktopLibraryMountOrganization: value as "servers" | "libraries" }))} options={[{ value: "servers", label: "Servers first" }, { value: "libraries", label: "Libraries first" }]} /></label>}
          <label><span>{wording.location}</span><ClusterTextInput value={prefs.desktopLibraryMountLocation || ""} disabled={Boolean(mountStatus?.running)} placeholder={wording.example} onChange={(event) => setPrefs((current) => ({ ...current, desktopLibraryMountLocation: event.target.value }))} /></label>
        </div>
        <div className="desktop-mount-runtime-v482">
          <div><span>Native session</span><strong>{mountStatus?.authenticated ? "Connected" : "Waiting for browser handoff"}</strong></div>
          <div><span>Filesystem engine</span><strong>{mountStatus?.provider || "Provider"} · {mountStatus?.adapterBuilt ? "adapter built" : "adapter not built"}</strong></div>
          <div><span>Library manifest</span><strong>{mountStatus?.entryCount || 0} entries{mountStatus?.refreshing ? " · refreshing" : ""}</strong></div>
          <div><span>Server sources</span><strong>{mountStatus?.authenticatedServerCount || 0}/{mountStatus?.serverCount || 0} authenticated · {mountStatus?.mountCount || 0} {wording.plural}</strong></div>
          <div><span>Protected cache</span><strong>{sensitiveCachePolicy !== "protected" ? "Not enabled by server" : protectedCache?.available ? `Ready · ${protectedCache.provider || "OS vault"}` : `Unavailable${protectedCache?.provider ? ` · ${protectedCache.provider}` : ""}`}</strong></div>
        </div>
        <div className="desktop-mount-footer-v481">
          <div><strong>{mountStatus?.provider || "Filesystem provider"}</strong><span>{mountStatus?.note || "Checking native provider."}</span></div>
          <div className="desktop-native-action-row-v482">
            <ClusterButton className="" type="button" disabled={saving || nativeBusy} onClick={() => void saveMountPreferences()} variant="quiet">{saving ? "Saving…" : "Save layout"}</ClusterButton>
            {mountStatus?.running ? (requiredMount ? <span className="desktop-required-mount-v482">Required by server</span> : <ClusterButton type="button" disabled={nativeBusy} onClick={() => void runNative("stop")} variant="secondary">Unmount</ClusterButton>) : <ClusterButton className="" type="button" disabled={nativeBusy || !mountEnabled || mountPolicy === "disabled" || !mountStatus?.engineReady || !mountStatus?.authenticated} onClick={() => void runNative("start")} variant="primary">{wording.action}</ClusterButton>}
          </div>
        </div>
        <div className="desktop-native-action-row-v482">{mountStatus?.running && <ClusterButton className="" type="button" disabled={nativeBusy} onClick={() => void runNative("refresh")} variant="quiet" size="compact">Refresh Libraries</ClusterButton>}{!mountStatus?.running && <ClusterButton className="" type="button" disabled={nativeBusy} onClick={() => void runNative("clear")} variant="quiet" size="compact">Clear cache</ClusterButton>}</div>
        {sensitiveCachePolicy === "protected" && protectedCache && !protectedCache.available && <p className="desktop-native-message" role="status">Sensitive Library files will not persist offline on this device. {protectedCache.error || "The protected-cache crypto or OS vault provider is unavailable."}</p>}
        {message && <p className="desktop-native-message" role="status">{message}</p>}
      </section>

      <section className="desktop-shortcuts-card-v482" aria-label="Global Desktop shortcuts">
        <header><div><p className="eyebrow">Anywhere shortcuts</p><h2>Global shortcuts</h2></div><span className={`desktop-mount-state-v481 ${shortcutStatus?.registered ? "ready" : "planned"}`}>{shortcutStatus?.registered ? "Active" : shortcutStatus?.supported ? "Available" : "Platform limited"}</span></header>
        <p>Open Cluster or jump straight into commands without focusing the app first.</p>
        <label className="desktop-shortcut-toggle-v482"><span><strong>Enable global shortcuts</strong><small>{shortcutStatus?.provider || "Native shortcut provider"}</small></span><ClusterInput type="checkbox" checked={Boolean(shortcutStatus?.enabled)} disabled={nativeBusy || !shortcutStatus?.supported} onChange={(event) => void toggleGlobalShortcuts(event.target.checked)} /></label>
        <div className="desktop-shortcut-list-v482">
          <div><span>Show Cluster</span><ShortcutKey>{shortcutStatus?.showCluster || "Ctrl+Alt+Space"}</ShortcutKey></div>
          <div><span>Search / commands</span><ShortcutKey>{shortcutStatus?.commandPalette || "Ctrl+Alt+K"}</ShortcutKey></div>
          <div><span>Quick Create</span><ShortcutKey>{shortcutStatus?.quickCreate || "Ctrl+Alt+N"}</ShortcutKey></div>
        </div>
        <small className="desktop-shortcut-note-v482">{shortcutStatus?.error || shortcutStatus?.note || "Foreground shortcuts still work normally inside Cluster."}</small>
      </section>
    </div>

    <DesktopWorkstationPanel />
    <DesktopNativeServicesPanel />
  </section>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getNativeWidgetLibraryStatus,
  installNativeWidget,
  openNativeWidgetLibrary,
  pickNativeDirectory,
  removeNativeWidget,
  rescanNativeWidgetLibrary,
  type ClusterNativeWidgetLibraryStatus,
} from "../../core/desktop";
import {
  CURATED_HOME_WIDGET_GALLERY,
  homeWidgetManifestPolicyDecision,
  validateCustomHomeWidgetManifest,
  type CustomHomeWidgetManifest,
  type HomeWidgetExtensionPolicy,
} from "./home-widget-model";

export type HomeWidgetLibraryController = {
  desktop: boolean;
  loading: boolean;
  status: ClusterNativeWidgetLibraryStatus | null;
  manifests: CustomHomeWidgetManifest[];
  allManifests: CustomHomeWidgetManifest[];
  installedManifests: CustomHomeWidgetManifest[];
  galleryManifests: CustomHomeWidgetManifest[];
  blockedManifests: Array<{ manifest: CustomHomeWidgetManifest; reason: string }>;
  policy: HomeWidgetExtensionPolicy;
  message: string;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  openFolder: () => Promise<void>;
};

function isDesktopRenderer() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
}

function validatedManifests(status: ClusterNativeWidgetLibraryStatus | null) {
  if (!status) return [];
  const manifests: CustomHomeWidgetManifest[] = [];
  for (const raw of status.widgets || []) {
    const result = validateCustomHomeWidgetManifest(raw);
    if (result.ok) manifests.push(result.manifest);
  }
  return manifests;
}

export function useHomeWidgetLibrary(policy: HomeWidgetExtensionPolicy): HomeWidgetLibraryController {
  const desktop = isDesktopRenderer();
  const [status, setStatus] = useState<ClusterNativeWidgetLibraryStatus | null>(null);
  const [loading, setLoading] = useState(desktop);
  const [message, setMessage] = useState("");
  const installedManifests = useMemo(() => validatedManifests(status), [status]);
  const galleryManifests = CURATED_HOME_WIDGET_GALLERY;
  const allManifests = useMemo(() => [...galleryManifests, ...installedManifests.filter((manifest) => !galleryManifests.some((gallery) => gallery.id === manifest.id))], [installedManifests]);
  const evaluated = useMemo(() => {
    const allowed: CustomHomeWidgetManifest[] = [];
    const blocked: Array<{ manifest: CustomHomeWidgetManifest; reason: string }> = [];
    const candidates = allManifests;
    for (const manifest of candidates) {
      const decision = homeWidgetManifestPolicyDecision(manifest, policy);
      if (decision.allowed) allowed.push(manifest);
      else blocked.push({ manifest, reason: decision.reason });
    }
    return { allowed, blocked };
  }, [allManifests, policy.mode, policy.allowedPermissions.join("|"), policy.blockedIds.join("|")]);

  const load = useCallback(async (mode: "status" | "rescan" = "status") => {
    if (!desktop) return;
    setLoading(true);
    try {
      const next = mode === "rescan" ? await rescanNativeWidgetLibrary() : await getNativeWidgetLibraryStatus();
      setStatus(next);
      setMessage(mode === "rescan" ? "Widget library rescanned." : "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget library is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => { void load(); }, [load]);

  async function install() {
    if (!desktop) return;
    if (policy.mode !== "allow") {
      setMessage(policy.mode === "disabled" ? "Studio policy disables extension widgets." : "Studio policy allows curated widgets only.");
      return;
    }
    setMessage("");
    try {
      const selected = await pickNativeDirectory({ title: "Choose Cluster widget folder" });
      if (!selected) { setMessage("No widget folder selected."); return; }
      const next = await installNativeWidget(selected.handle);
      setStatus(next);
      const operation = next.lastOperation;
      if (operation?.action === "updated") setMessage(`Widget updated from v${operation.fromVersion || "?"} to v${operation.toVersion || "?"}.`);
      else if (operation?.action === "reinstalled") setMessage(`Widget v${operation.toVersion || "?"} reinstalled.`);
      else setMessage("Widget installed into Cluster's managed library.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget installation failed.");
    }
  }

  async function remove(id: string) {
    if (!desktop) return;
    setMessage("");
    try {
      const next = await removeNativeWidget(id);
      setStatus(next);
      setMessage("Widget removed from Cluster's managed library.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget removal failed.");
    }
  }

  async function openFolder() {
    if (!desktop) return;
    try {
      await openNativeWidgetLibrary();
      setMessage("Widget library folder opened.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget library folder could not be opened.");
    }
  }

  return { desktop, loading, status, manifests: evaluated.allowed, allManifests, installedManifests, galleryManifests, blockedManifests: evaluated.blocked, policy, message, refresh: () => load("rescan"), install, remove, openFolder };
}

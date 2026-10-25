import { useCallback, useEffect, useState } from "react";
import { mutateApi, queryApi } from "../../core/api";
import { normalizeHomeWidgetLayout, type HomeLayoutSharingState, type HomeWidgetLayoutProfile, type HomeWidgetLayoutState, type SharedHomeLayoutProfile, type StudioHomeLayoutTemplate } from "./home-widget-model";

type HomeLayoutSharingResponse = { ok: true; state: HomeLayoutSharingState; currentUserId: string };

const EMPTY_HOME_LAYOUT_SHARING: HomeLayoutSharingState = { schema: 2, templates: [], sharedProfiles: [] };

export type HomeLayoutSharingController = {
  state: HomeLayoutSharingState;
  currentUserId: string;
  loading: boolean;
  busy: boolean;
  message: string;
  refresh: () => Promise<void>;
  publishTemplate: (name: string, description: string, layout: HomeWidgetLayoutState, id?: string) => Promise<boolean>;
  removeTemplate: (id: string) => Promise<boolean>;
  shareProfile: (profile: HomeWidgetLayoutProfile) => Promise<boolean>;
  unshareProfile: (id: string) => Promise<boolean>;
  ownSharedProfile: (profile: HomeWidgetLayoutProfile) => SharedHomeLayoutProfile | undefined;
};

export function useHomeLayoutSharing(enabled = true): HomeLayoutSharingController {
  const [state, setState] = useState<HomeLayoutSharingState>(EMPTY_HOME_LAYOUT_SHARING);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const result = await queryApi<HomeLayoutSharingResponse>("/api/home-layouts", { force: true, staleMs: 5_000, maxAgeMs: 60_000, tags: ["home-layouts"] });
      setState(result.state?.schema === 2 ? result.state : EMPTY_HOME_LAYOUT_SHARING);
      setCurrentUserId(result.currentUserId || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cluster could not load shared Home layouts.");
    } finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function publishTemplate(name: string, description: string, layout: HomeWidgetLayoutState, id?: string) {
    if (!name.trim()) return false;
    setBusy(true); setMessage("");
    try {
      await mutateApi<{ ok: true; template: StudioHomeLayoutTemplate }>("/api/home-layouts/templates", {
        method: "POST", body: { ...(id ? { id } : {}), name: name.trim().slice(0, 40), description: description.trim().slice(0, 180), layout: normalizeHomeWidgetLayout(layout) },
        label: id ? "Update Home template" : "Publish Home template", queueWhenOffline: false, invalidate: ["/api/home-layouts"],
      });
      setMessage(id ? "Studio Home template updated." : "Studio Home template published.");
      await refresh(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cluster could not publish the Home template."); return false; }
    finally { setBusy(false); }
  }

  async function removeTemplate(id: string) {
    setBusy(true); setMessage("");
    try {
      await mutateApi<{ ok: true }>(`/api/home-layouts/templates/${encodeURIComponent(id)}`, { method: "DELETE", label: "Delete Home template", queueWhenOffline: false, invalidate: ["/api/home-layouts"] });
      setMessage("Studio Home template removed."); await refresh(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cluster could not remove the Home template."); return false; }
    finally { setBusy(false); }
  }

  function ownSharedProfile(profile: HomeWidgetLayoutProfile) {
    return state.sharedProfiles.find((item) => item.ownerUserId === currentUserId && item.name.trim().toLowerCase() === profile.name.trim().toLowerCase());
  }

  async function shareProfile(profile: HomeWidgetLayoutProfile) {
    const existing = ownSharedProfile(profile);
    setBusy(true); setMessage("");
    try {
      await mutateApi<{ ok: true; profile: SharedHomeLayoutProfile }>("/api/home-layouts/shared", {
        method: "POST", body: { ...(existing ? { id: existing.id } : {}), name: profile.name, layout: normalizeHomeWidgetLayout(profile.layout) },
        label: existing ? "Update shared Home profile" : "Share Home profile", queueWhenOffline: false, invalidate: ["/api/home-layouts"],
      });
      setMessage(existing ? "Shared Home profile updated." : "Home profile shared with the Studio."); await refresh(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cluster could not share the Home profile."); return false; }
    finally { setBusy(false); }
  }

  async function unshareProfile(id: string) {
    setBusy(true); setMessage("");
    try {
      await mutateApi<{ ok: true }>(`/api/home-layouts/shared/${encodeURIComponent(id)}`, { method: "DELETE", label: "Unshare Home profile", queueWhenOffline: false, invalidate: ["/api/home-layouts"] });
      setMessage("Shared Home profile removed."); await refresh(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cluster could not remove the shared Home profile."); return false; }
    finally { setBusy(false); }
  }

  return { state, currentUserId, loading, busy, message, refresh, publishTemplate, removeTemplate, shareProfile, unshareProfile, ownSharedProfile };
}

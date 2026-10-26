import { useEffect, useMemo, useState } from "react";
import type { ClusterDataQuery, ClusterDataViewDensity, ClusterDataViewLayout, ClusterDataViewPresentation, ClusterDataViewVisibility, ClusterResourceKind, ClusterSavedDataView } from "@cluster/shared";
import { api } from "../core/api";
import { ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterNativeSelect } from "./ClusterNativeControls";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterTextInput } from "./ClusterTextInput";
import "./cluster-data-view.css";

type CurrentDataView = {
  presentation: ClusterDataViewPresentation;
  density: ClusterDataViewDensity;
  query: ClusterDataQuery;
  layout: ClusterDataViewLayout;
};

type SavedDataViewResponse = { ok: boolean; view: ClusterSavedDataView };
type SavedDataViewListResponse = { ok: boolean; views: ClusterSavedDataView[] };

export function ClusterDataView({
  scope,
  label,
  resourceKind,
  projectId,
  current,
  onApply,
  summary,
  allowStudio = true,
}: {
  scope: string;
  label: string;
  resourceKind: ClusterResourceKind;
  projectId?: string | null;
  current: CurrentDataView;
  onApply: (view: ClusterSavedDataView) => void;
  summary?: string;
  allowStudio?: boolean;
}) {
  const [views, setViews] = useState<ClusterSavedDataView[]>([]);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<ClusterDataViewVisibility>("personal");
  const [activeViewId, setActiveViewId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  async function loadViews(silent = false) {
    if (!silent) setStatus("Loading views…");
    try {
      const query = new URLSearchParams({ scope, resourceKind });
      if (projectId) query.set("projectId", projectId);
      const result = await api<SavedDataViewListResponse>(`/api/data-views?${query.toString()}`);
      setViews(result.views || []);
      if (!silent) setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saved views could not be loaded.");
    }
  }

  useEffect(() => { void loadViews(); }, [scope, resourceKind, projectId]);

  const activeView = useMemo(() => views.find((view) => view.id === activeViewId) || null, [views, activeViewId]);

  async function createView() {
    const trimmed = name.trim();
    if (!trimmed) { setStatus("Enter a view name first."); return; }
    setBusy(true);
    try {
      const result = await api<SavedDataViewResponse>("/api/data-views", {
        method: "POST",
        body: JSON.stringify({ scope, resourceKind, projectId: visibility === "studio" ? null : projectId || null, name: trimmed, visibility, ...current }),
      });
      setViews((existing) => [result.view, ...existing.filter((view) => view.id !== result.view.id)]);
      setActiveViewId(result.view.id);
      setName("");
      setSaveOpen(false);
      setStatus(`Saved ${result.view.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "View could not be saved.");
    } finally { setBusy(false); }
  }

  async function updateView(view: ClusterSavedDataView, patch: Partial<CurrentDataView & { isDefault: boolean; name: string }>) {
    setBusy(true);
    try {
      const result = await api<SavedDataViewResponse>(`/api/data-views/${encodeURIComponent(view.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, expectedRevision: view.revision }),
      });
      setViews((existing) => existing.map((item) => item.id === result.view.id ? result.view : item));
      setStatus(`Updated ${result.view.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saved view could not be updated.");
      await loadViews(true);
    } finally { setBusy(false); }
  }

  async function removeView(view: ClusterSavedDataView) {
    setBusy(true);
    try {
      await api(`/api/data-views/${encodeURIComponent(view.id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: view.revision }) });
      setViews((existing) => existing.filter((item) => item.id !== view.id));
      if (activeViewId === view.id) setActiveViewId("");
      setStatus(`Removed ${view.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saved view could not be removed.");
      await loadViews(true);
    } finally { setBusy(false); }
  }

  function applyView(viewId: string) {
    setActiveViewId(viewId);
    const view = views.find((candidate) => candidate.id === viewId);
    if (!view) { setStatus("Custom view"); return; }
    onApply(view);
    setStatus(`Applied ${view.name}.`);
  }

  const statusWarning = status.includes("could not") || status.includes("Enter");
  return (
    <section className="cluster-data-view-v537" aria-label={`${label} saved views`} title={summary || undefined}>
      <div className="cluster-data-view-primary-v537">
        <span className="cluster-data-view-label-v537">View</span>
        <ClusterNativeSelect value={activeViewId} onChange={(event) => applyView(event.target.value)} aria-label={`${label} saved view`}>
          <option value="">Custom</option>
          {views.map((view) => <option key={view.id} value={view.id}>{view.name}{view.isDefault ? " · Default" : ""}</option>)}
        </ClusterNativeSelect>
        {activeView ? <div className="cluster-data-view-actions-v537">
          <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void updateView(activeView, current)}>Update</ClusterButton>
          {!activeView.isDefault ? <ClusterIconButton label={`Set ${activeView.name} as default`} size="compact" variant="quiet" disabled={busy} onClick={() => void updateView(activeView, { isDefault: true })}><ClusterIcon name="pin" /></ClusterIconButton> : null}
          <ClusterIconButton label={`Delete ${activeView.name}`} size="compact" variant="quiet" disabled={busy} onClick={() => void removeView(activeView)}><ClusterIcon name="trash" /></ClusterIconButton>
        </div> : null}
        {status ? <ClusterStatus tone={statusWarning ? "warning" : "neutral"} compact>{status}</ClusterStatus> : null}
        {!saveOpen ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => setSaveOpen(true)}>Save view</ClusterButton> : null}
      </div>
      {saveOpen ? <div className="cluster-data-view-save-v537">
        <ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="View name" aria-label="Saved view name" autoFocus />
        <ClusterNativeSelect value={visibility} onChange={(event) => setVisibility(event.target.value as ClusterDataViewVisibility)} aria-label="Saved view visibility">
          <option value="personal">Personal</option>
          {allowStudio ? <option value="studio">Studio</option> : null}
          {projectId ? <option value="project">Project</option> : null}
        </ClusterNativeSelect>
        <ClusterButton size="compact" onClick={() => void createView()} disabled={busy || !name.trim()}>Save</ClusterButton>
        <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => { setSaveOpen(false); setName(""); }}>Cancel</ClusterButton>
      </div> : null}
    </section>
  );
}

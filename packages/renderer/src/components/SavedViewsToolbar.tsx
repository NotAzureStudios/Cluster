import { useEffect, useRef, useState } from "react";
import { useServerState } from "../core/server-state";
import type { SharedWorkSavedView } from "@cluster/shared";
import "./cluster-saved-views.css";
import { ClusterButton, ClusterIconButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterStatus } from "./ClusterStatus";
import { ClusterTextInput } from "./ClusterTextInput";

function stableViewValue(values: Record<string, string>) {
  return JSON.stringify(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function validViews(scope: string, value: SharedWorkSavedView[]) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || !item.values || typeof item.values !== "object") return [];
    return [{
      ...item,
      scope: typeof item.scope === "string" && item.scope.trim() ? item.scope : scope,
      visibility: item.visibility === "studio" ? "studio" : "personal",
      values: Object.fromEntries(Object.entries(item.values).map(([key, raw]) => [key, String(raw ?? "")])),
    } satisfies SharedWorkSavedView];
  });
}

export function SavedViewsToolbar({
  scope,
  label,
  current,
  onApply,
  summary,
  autoRestore = true,
}: {
  scope: string;
  label: string;
  current: Record<string, string>;
  onApply: (values: Record<string, string>) => void;
  summary?: string;
  autoRestore?: boolean;
}) {
  const [views, setViews] = useServerState<SharedWorkSavedView[]>("user", `saved-views.${scope}`, [], {
    merge: (value) => validViews(scope, value).slice(0, 12),
  });
  const [lastView, setLastView, lastViewState] = useServerState<Record<string, string> | null>("user", `last-view.${scope}`, null);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState("");
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!lastViewState.hydrated || restoredRef.current) return;
    restoredRef.current = true;
    if (!lastView || !autoRestore) return;
    onApply(lastView);
  }, [lastViewState.hydrated, lastView, onApply, autoRestore]);

  useEffect(() => {
    if (!restoreStatus) return;
    const timer = window.setTimeout(() => setRestoreStatus(""), 3500);
    return () => window.clearTimeout(timer);
  }, [restoreStatus]);

  useEffect(() => {
    if (!autoRestore) return;
    const timer = window.setTimeout(() => { void setLastView(current); }, 250);
    return () => window.clearTimeout(timer);
  }, [scope, current, setLastView, autoRestore]);

  const currentSignature = stableViewValue(current);
  const activeViewId = views.find((view) => stableViewValue(view.values) === currentSignature)?.id || "";

  function saveView() {
    const trimmed = name.trim();
    const generatedName = `${label} view ${views.length + 1}`;
    const targetName = trimmed || generatedName;
    const existing = trimmed ? views.find((view) => view.name.trim().toLowerCase() === trimmed.toLowerCase()) : undefined;
    const now = new Date().toISOString();
    const view: SharedWorkSavedView = existing
      ? { ...existing, scope, name: targetName, values: current, visibility: existing.visibility || "personal", updatedAt: now }
      : {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          scope,
          name: targetName,
          values: current,
          visibility: "personal",
          createdAt: now,
          updatedAt: now,
        };
    const nextViews = existing ? [view, ...views.filter((item) => item.id !== existing.id)] : [view, ...views];
    void setViews(nextViews.slice(0, 12));
    void setLastView(current);
    setRestoreStatus(existing ? `Updated ${existing.name}` : "Saved");
    setName("");
  }

  function deleteView(id: string) {
    void setViews(views.filter((view) => view.id !== id));
  }

  function applyView(values: Record<string, string>) {
    onApply(values);
    void setLastView(values);
    setRestoreStatus("View applied");
  }

  return (
    <section className="cl-views" aria-label={`${label}: saved views`}>
      <span className="cl-views__label">Views</span>
      {views.map((view) => <span key={view.id} className="cl-views__chip" data-active={activeViewId === view.id || undefined}>
        <ClusterButton unstyled type="button" aria-pressed={activeViewId === view.id} onClick={() => applyView(view.values)} title={summary}>{view.name}</ClusterButton>
        <ClusterButton unstyled type="button" className="cl-views__remove" aria-label={`Delete ${view.name}`} onClick={() => deleteView(view.id)}><ClusterIcon name="close" /></ClusterButton>
      </span>)}
      {naming
        ? <form className="cl-views__new" onSubmit={(event) => { event.preventDefault(); saveView(); setNaming(false); }}>
            <ClusterTextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="View name" onKeyDown={(event) => { if (event.key === "Escape") { setNaming(false); setName(""); } }} />
            <ClusterButton size="compact" type="submit">Save</ClusterButton>
          </form>
        : activeViewId ? null : <ClusterButton unstyled type="button" className="cl-views__add" onClick={() => setNaming(true)}><ClusterIcon name="plus" />Save view</ClusterButton>}
      {restoreStatus ? <span className="cl-views__status" role="status">{restoreStatus}</span> : null}
    </section>
  );
}

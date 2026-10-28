import { useEffect, useRef, useState } from "react";
import { useServerState } from "../core/server-state";
import type { SharedWorkSavedView } from "@cluster/shared";
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
  const [restoreStatus, setRestoreStatus] = useState("");
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!lastViewState.hydrated || restoredRef.current) return;
    restoredRef.current = true;
    if (!lastView || !autoRestore) return;
    onApply(lastView);
    setRestoreStatus("Last working view restored");
  }, [lastViewState.hydrated, lastView, onApply, autoRestore]);

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
    setRestoreStatus(existing ? `Updated ${existing.name}` : "Saved and set as current view");
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
    <section className="panel saved-views-toolbar-v120">
      <div>
        <p className="eyebrow">Saved views</p>
        <strong>{label}</strong>
        <span>{summary || "Save a reusable filter setup."}</span>
        {restoreStatus && <ClusterStatus tone="good" compact className="smart-view-status-v276">{restoreStatus}</ClusterStatus>}
      </div>
      <div className="saved-view-create-v120">
        <ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="View name" />
        <ClusterButton size="compact" onClick={saveView}>Save current</ClusterButton>
      </div>
      <div className="saved-view-list-v120">
        {views.length ? views.map((view) => (
          <span key={view.id}>
            <ClusterButton variant="quiet" size="compact" aria-pressed={activeViewId === view.id} className={activeViewId === view.id ? "active" : ""} onClick={() => applyView(view.values)}>{view.name}{activeViewId === view.id ? " · Current" : ""}</ClusterButton>
            <ClusterIconButton label={`Delete ${view.name}`} size="compact" onClick={() => deleteView(view.id)}><ClusterIcon name="trash" /></ClusterIconButton>
          </span>
        )) : <em>No saved views.</em>}
      </div>
    </section>
  );
}

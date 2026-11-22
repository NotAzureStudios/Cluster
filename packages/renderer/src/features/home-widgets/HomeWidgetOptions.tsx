import { useEffect, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { homeWidgetRegistryEntry, type HomeWidgetConfig, type HomeWidgetPlacement } from "./home-widget-model";

type Option = { id: string; label: string };

/** One widget's options: what it shows, never how big it is (that's the grid's job). */
export function HomeWidgetOptions({ placement, onSave, onClose, projects, users, roles }: {
  placement: HomeWidgetPlacement | null;
  onSave: (id: string, config: HomeWidgetConfig) => void;
  onClose: () => void;
  projects: Option[];
  users: Option[];
  roles: Option[];
}) {
  const [draft, setDraft] = useState<HomeWidgetConfig>({});
  useEffect(() => { setDraft({ ...(placement?.config || {}) }); }, [placement?.id]);
  const entry = placement ? homeWidgetRegistryEntry(placement.id) : undefined;
  const can = new Set(entry?.configuration || []);
  const patch = (next: Partial<HomeWidgetConfig>) => setDraft((current) => ({ ...current, ...next }));
  const contextChoices = draft.context === "project" ? projects : draft.context === "user" ? users : draft.context === "role" ? roles : null;

  return (
    <ClusterModal open={Boolean(placement && entry)} onClose={onClose} className="modal panel hw-options" ariaLabel={`${entry?.label || "Widget"} options`}>
      <header className="hw-options-head"><h2>{entry?.label}</h2></header>
      <div className="hw-options-body">
        {can.has("clockFormat") && <label><span>Shows</span><ClusterSelect ariaLabel="Clock shows" value={draft.clockFormat || "datetime"} options={[{ value: "datetime", label: "Time and date" }, { value: "time", label: "Time" }, { value: "date", label: "Date" }]} onChange={(value) => patch({ clockFormat: value as HomeWidgetConfig["clockFormat"] })} /></label>}
        {can.has("noteTitle") && <label><span>Title</span><ClusterTextInput maxLength={48} value={draft.noteTitle || ""} placeholder="Note" onChange={(event) => patch({ noteTitle: event.target.value || undefined })} /></label>}
        {can.has("context") && <label><span>Scope</span><ClusterSelect ariaLabel="Scope" value={draft.context || "studio"} options={[{ value: "studio", label: "Studio" }, { value: "current-project", label: "Current project" }, { value: "project", label: "A project" }, { value: "me", label: "Me" }, { value: "user", label: "A person" }, { value: "my-role", label: "My role" }, { value: "role", label: "A role" }]} onChange={(value) => patch({ context: value as HomeWidgetConfig["context"], contextId: undefined })} /></label>}
        {can.has("context") && contextChoices && <label><span>{draft.context === "project" ? "Project" : draft.context === "user" ? "Person" : "Role"}</span><ClusterSelect ariaLabel="Scope target" value={draft.contextId || ""} options={[{ value: "", label: "Choose…" }, ...contextChoices.map((choice) => ({ value: choice.id, label: choice.label }))]} onChange={(value) => patch({ contextId: value || undefined })} /></label>}
        {can.has("timeRange") && <label><span>Period</span><ClusterSelect ariaLabel="Period" value={draft.timeRange || "all"} options={[{ value: "all", label: "Any time" }, { value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]} onChange={(value) => patch({ timeRange: value as HomeWidgetConfig["timeRange"] })} /></label>}
        {can.has("filter") && <label><span>Filter</span><ClusterTextInput maxLength={80} value={draft.filterText || ""} placeholder="Matching text" onChange={(event) => patch({ filterText: event.target.value || undefined })} /></label>}
      </div>
      <footer className="hw-options-foot">
        <ClusterButton variant="quiet" size="compact" onClick={onClose}>Cancel</ClusterButton>
        <ClusterButton variant="primary" size="compact" onClick={() => { if (placement) onSave(placement.id, draft); onClose(); }}>Done</ClusterButton>
      </footer>
    </ClusterModal>
  );
}

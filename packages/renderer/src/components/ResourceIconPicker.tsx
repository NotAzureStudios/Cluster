import { useEffect, useState } from "react";
import { ICON_LIBRARY_SETS, libraryIconId, loadIconIndex, type IconLibrarySet } from "../core/icon-library";
import { LibraryIcon } from "./LibraryIcon";
import { ClusterButton } from "./ClusterButton";
import { PROJECT_ICON_OPTIONS, ResourceIdentityMark } from "./ResourceIdentityMark";
import "./resource-icon-picker.css";

/** Shared resource icon selector. Names stay accessible; marks never communicate warnings or permissions. */
export function ResourceIconPicker({ value, onChange, onUpload, disabled, projectId, projectType, label }: {
  value?: string | null;
  onChange: (id: string | null) => void;
  onUpload?: (file: File) => Promise<void>;
  disabled?: boolean;
  projectId?: string;
  projectType?: string | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"cluster" | IconLibrarySet>("cluster");
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!open || tab === "cluster") return;
    setNames(null);
    let live = true;
    void loadIconIndex(tab).then((index) => { if (live) setNames(index.names); }).catch(() => { if (live) setError("Icon library unavailable."); });
    return () => { live = false; };
  }, [open, tab]);
  const needle = query.trim().toLowerCase().replace(/\s+/g, "-");
  const options = PROJECT_ICON_OPTIONS.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const matches = tab === "cluster" || !names ? [] : !needle ? names : [...names.filter(name => name.startsWith(needle)), ...names.filter(name => !name.startsWith(needle) && name.includes(needle))];
  const pick = (id: string) => { onChange(id); setOpen(false); };
  return <div className="resource-icon-picker">
    <div className="resource-icon-picker-header">
      <span className="resource-icon-picker-preview"><ResourceIdentityMark iconId={value} projectId={projectId} projectType={projectType} label={label} /></span>
      <ClusterButton variant="secondary" size="compact" disabled={disabled} onClick={() => setOpen(v => !v)}>{open ? "Close icons" : "Change icon"}</ClusterButton>
      {value ? <ClusterButton variant="quiet" size="compact" disabled={disabled} onClick={() => onChange(null)}>Reset</ClusterButton> : null}
    </div>
    {open ? <div className="resource-icon-picker-panel">
      <input type="search" aria-label="Find an icon" placeholder={tab === "simple-icons" ? "Search brands (discord, steam, unreal…)" : "Search icons"} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="resource-icon-picker-tabs" role="tablist" aria-label="Icon sets">
        {([["cluster", "Cluster"], ...Object.entries(ICON_LIBRARY_SETS)] as Array<["cluster" | IconLibrarySet, string]>).map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{title}</button>)}
      </div>
      <div className="resource-icon-picker-grid" role="group" aria-label="Available icons">
        {tab === "cluster"
          ? options.map(item => <button type="button" key={item.id} aria-label={item.label} title={item.label} aria-pressed={value === item.id} disabled={disabled} onClick={() => pick(item.id)}><span><ResourceIdentityMark iconId={item.id} label={item.label} /></span><small>{item.label}</small></button>)
          : matches.slice(0, 160).map(name => { const id = libraryIconId(tab, name); return <button type="button" key={name} aria-label={name} title={name} aria-pressed={value === id} disabled={disabled} onClick={() => pick(id)}><span><LibraryIcon set={tab} name={name} /></span><small>{name.replaceAll("-", " ")}</small></button>; })}
        {tab !== "cluster" && !names ? <span className="resource-icon-picker-note">Loading…</span> : null}
        {tab !== "cluster" && names && matches.length > 160 ? <span className="resource-icon-picker-note">{matches.length - 160} more · refine the search</span> : null}
        {tab !== "cluster" && names && !matches.length ? <span className="resource-icon-picker-note">No icons match.</span> : null}
      </div>
      {onUpload ? <label className="resource-icon-picker-upload">Upload icon <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || uploading} onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return;
        setUploading(true); setError("");
        try { await onUpload(file); setOpen(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed"); } finally { setUploading(false); event.target.value=""; }
      }}/></label> : null}
      {uploading ? <span role="status">Uploading…</span> : null}
      {error ? <span role="alert" className="resource-icon-picker-error">{error}</span> : null}
    </div> : null}
  </div>;
}

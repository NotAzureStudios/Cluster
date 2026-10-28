import { useState } from "react";
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
  const options = PROJECT_ICON_OPTIONS.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="resource-icon-picker">
    <div className="resource-icon-picker-header">
      <span className="resource-icon-picker-preview"><ResourceIdentityMark iconId={value} projectId={projectId} projectType={projectType} label={label} /></span>
      <ClusterButton variant="secondary" size="compact" disabled={disabled} onClick={() => setOpen(v => !v)}>{open ? "Close icons" : "Change icon"}</ClusterButton>
      {value ? <ClusterButton variant="quiet" size="compact" disabled={disabled} onClick={() => onChange(null)}>Reset</ClusterButton> : null}
    </div>
    {open ? <div className="resource-icon-picker-panel">
      <input type="search" aria-label="Find an icon" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="resource-icon-picker-grid" role="group" aria-label="Available icons">
        {options.map(item => <button type="button" key={item.id} aria-label={item.label} title={item.label} aria-pressed={value === item.id} disabled={disabled} onClick={() => {onChange(item.id);setOpen(false);}}><span><ResourceIdentityMark iconId={item.id} label={item.label} /></span><small>{item.label}</small></button>)}
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

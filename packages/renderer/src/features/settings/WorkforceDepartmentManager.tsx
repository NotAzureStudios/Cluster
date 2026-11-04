import { useCallback, useEffect, useMemo, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { DepartmentIdentityMark } from "../../components/DepartmentIdentityMark";
import { ResourceIconPicker } from "../../components/ResourceIconPicker";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import "./workforce-department-manager.css";

type DepartmentRow = {
  id: string; workspaceId: string; name: string; description?: string | null;
  parentId?: string | null; leadUserId?: string | null;
  color?: string | null; iconId?: string | null;
  revision: number; members: number; teams: number;
};
type Draft = { name: string; description: string; parentId: string; color: string; iconId: string | null };
const emptyDraft = (): Draft => ({ name: "", description: "", parentId: "", color: "#57c1ff", iconId: null });
const fromRow = (row?: DepartmentRow): Draft => row
  ? { name: row.name, description: row.description || "", parentId: row.parentId || "", color: row.color || "#57c1ff", iconId: row.iconId || null }
  : emptyDraft();

/**
 * Canonical Workforce Department identity editor. Settings-defined department
 * access templates are NOT organizational records and cannot own appearance.
 */
export function WorkforceDepartmentManager({ canEdit, onRowsLoaded }: { canEdit: boolean; onRowsLoaded?: (rows: DepartmentRow[]) => void }) {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const selected = rows.find((row) => row.id === selectedId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(creating ? emptyDraft() : fromRow(selected));
  const { confirmDiscard } = useUnsavedChangesGuard({
    dirty,
    title: "Discard department changes?",
    message: "This department has unsaved changes. Discard them and continue?",
  });
  const visible = useMemo(() => rows.filter((row) =>
    `${row.name} ${row.description || ""}`.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const invalidParents = useMemo(() => {
    if (!selected) return new Set<string>();
    const excluded = new Set([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (row.parentId && excluded.has(row.parentId) && !excluded.has(row.id)) {
        excluded.add(row.id); changed = true;
      }
    }
    return excluded;
  }, [rows, selectedId]);

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const result = await queryApi<DepartmentRow[]>("/api/departments", {
        force: true, staleMs: 0, persist: false, tags: ["departments", "people", "workforce"],
      });
      setRows(result);
      onRowsLoaded?.(result);
      const next = result.find((row) => row.id === preferredId) || result[0];
      if (next) { setSelectedId(next.id); setDraft(fromRow(next)); setCreating(false); }
      else { setSelectedId(""); setDraft(emptyDraft()); setCreating(false); }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load departments.");
    } finally { setLoading(false); }
  }, [onRowsLoaded]);

  useEffect(() => { void load(); }, [load]);

  async function choose(id: string) {
    if (!canEdit || saving || (dirty && !(await confirmDiscard()))) return;
    const next = rows.find((row) => row.id === id);
    if (!next) return;
    setCreating(false); setSelectedId(id); setDraft(fromRow(next)); setError(""); setStatus("");
  }

  async function beginCreate() {
    if (!canEdit || saving || (dirty && !(await confirmDiscard()))) return;
    setCreating(true); setSelectedId(""); setDraft(emptyDraft()); setError(""); setStatus("");
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function save() {
    if (!canEdit || saving) return;
    const name = draft.name.trim();
    if (!name) { setError("Enter a department name."); return; }
    if (name.length > 120) { setError("Department names cannot exceed 120 characters."); return; }
    if (draft.description.trim().length > 1000) { setError("Description cannot exceed 1000 characters."); return; }
    if (rows.some((row) => row.id !== selected?.id && row.name.toLowerCase() === name.toLowerCase())) {
      setError("A department with this name already exists."); return;
    }
    setSaving(true); setError(""); setStatus("");
    const body = {
      name, description: draft.description.trim() || null,
      parentId: draft.parentId || null,
      color: draft.color, iconId: draft.iconId,
    };
    try {
      const response = creating
        ? await api<{ department: DepartmentRow }>("/api/admin/workforce/departments", { method: "POST", body: JSON.stringify(body) })
        : await api<{ department: DepartmentRow }>(`/api/admin/workforce/departments/${encodeURIComponent(selected!.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, leadUserId: selected!.leadUserId || null, expectedRevision: selected!.revision }),
        });
      const saved = { ...selected, ...response.department, members: selected?.members || 0, teams: selected?.teams || 0 } as DepartmentRow;
      setRows((current) => [...current.filter((row) => row.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(saved.id); setCreating(false); setDraft(fromRow(saved));
      setStatus(`Saved department ${saved.name}.`);
      // A committed write is successful even if the follow-up read fails.
      try { await load(saved.id); } catch { /* load() reports the fetch failure in the UI */ }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save department.";
      setError(/DEPARTMENT_REVISION_CONFLICT|409/i.test(message)
        ? "This department was edited elsewhere. Refresh and review the latest version before saving."
        : message);
    } finally { setSaving(false); }
  }

  return <section className="studio-workforce-department-manager-v11" aria-label="Canonical workforce departments">
    <div className="studio-workforce-department-heading-v11">
      <div><h3>Department directory</h3><p>Icons, colors and hierarchy are stored on the actual department and reused across Cluster.</p>{!canEdit && <p>Editing department identity requires administrator access.</p>}</div>
      <ClusterButton size="compact" variant="primary" disabled={!canEdit || loading || saving} onClick={() => void beginCreate()}>New department</ClusterButton>
    </div>
    <div className="studio-workforce-department-layout-v11">
      <aside className="studio-workforce-department-list-v11">
        <label><span>Search departments</span><ClusterTextInput type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search..." /></label>
        <div className="studio-workforce-department-list-rows-v11">
          {loading && <p role="status">Loading departments…</p>}
          {!loading && !visible.length && <p>{rows.length ? "No matching departments." : "No departments created yet."}</p>}
          {visible.map((row) => <button type="button" key={row.id} className={!creating && selectedId === row.id ? "active" : ""} aria-current={!creating && selectedId === row.id ? "true" : undefined} disabled={saving} onClick={() => void choose(row.id)}>
            <DepartmentIdentityMark department={row} size={27} />
            <span><strong>{row.name}</strong><small>{row.members} members · {row.teams} teams</small></span>
          </button>)}
        </div>
      </aside>
      <div className="studio-workforce-department-editor-v11">
        <header>
          <div>
            <span className="eyebrow">{creating ? "New department" : "Department identity"}</span>
            <h4>{creating ? "Create department" : selected?.name || "Select a department"}</h4>
          </div>
          <DepartmentIdentityMark department={{ name: draft.name || "Department", color: draft.color, iconId: draft.iconId }} size={40} />
        </header>
        <div className="studio-workforce-department-fields-v11">
          <label><span>Name</span><ClusterInput value={draft.name} maxLength={120} disabled={!canEdit || saving || loading || (!creating && !selected)} onChange={(event) => update("name", event.target.value)} /></label>
          <label><span>Parent department</span><ClusterNativeSelect value={draft.parentId} disabled={!canEdit || saving || loading || (!creating && !selected)} onChange={(event) => update("parentId", event.target.value)}>
            <option value="">No parent</option>
            {rows.filter((row) => !invalidParents.has(row.id)).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
          </ClusterNativeSelect></label>
          <label><span>Accent color</span><ClusterInput type="color" aria-label="Department accent color" value={draft.color} disabled={!canEdit || saving || loading || (!creating && !selected)} onChange={(event) => update("color", event.target.value)} /></label>
          <div className="studio-workforce-department-icon-field-v11"><span>Department icon</span><ResourceIconPicker label={draft.name || "Department"} value={draft.iconId} disabled={!canEdit || saving || loading || (!creating && !selected)} onChange={(iconId) => update("iconId", iconId)} /></div>
          <label className="studio-workforce-department-description-v11"><span>Description</span><ClusterTextarea value={draft.description} maxLength={1000} disabled={!canEdit || saving || loading || (!creating && !selected)} onChange={(event) => update("description", event.target.value)} /></label>
        </div>
        {selected && !creating && <p className="studio-workforce-department-hint-v11">Lead assignments and job roles remain managed in People → Organization. Changes here use revision checks.</p>}
        {error && <p role="alert" className="studio-workforce-department-error-v11">{error}</p>}
        {status && <p role="status" className="studio-workforce-department-status-v11">{status}</p>}
        <div className="studio-workforce-department-actions-v11">
          <span>{dirty ? "Unsaved changes" : creating ? "Enter the department details" : "Current saved version"}</span>
          <ClusterButton size="compact" variant="secondary" disabled={!canEdit || saving || loading || (!creating && !selected)} onClick={() => { void (async () => { if (dirty && !(await confirmDiscard())) return; if (creating) { setCreating(false); setSelectedId(rows[0]?.id || ""); setDraft(fromRow(rows[0])); } else setDraft(fromRow(selected)); setError(""); })(); }}>Cancel</ClusterButton>
          <ClusterButton size="compact" variant="primary" disabled={!canEdit || saving || loading || (!creating && !selected) || (!creating && !dirty)} onClick={() => void save()}>{saving ? "Saving…" : creating ? "Create department" : "Save changes"}</ClusterButton>
        </div>
      </div>
    </div>
  </section>;
}

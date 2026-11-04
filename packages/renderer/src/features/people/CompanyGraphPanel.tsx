import { useMemo, useState } from "react";
import { api } from "../../core/api";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ResourceIconPicker } from "../../components/ResourceIconPicker";
import { DepartmentIdentityMark } from "../../components/DepartmentIdentityMark";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { buildCompanyGraph, type CompanyGraphDepartment, type CompanyGraphPerson, type CompanyGraphTeam } from "./company-graph";


function DepartmentEditor({ department, departments, people, workspaceId, onChanged, onClose }: {
  department?: CompanyGraphDepartment & { revision?: number };
  departments: CompanyGraphDepartment[];
  people: CompanyGraphPerson[];
  workspaceId: string;
  onChanged: () => Promise<void>;
  onClose?: () => void;
}) {
  const [name, setName] = useState(department?.name || "");
  const [description, setDescription] = useState(department?.description || "");
  const [parentId, setParentId] = useState(department?.parentId || "");
  const [leadUserId, setLeadUserId] = useState(department?.leadUserId || "");
  const [color, setColor] = useState(department?.color || "#57c1ff");
  const [iconId, setIconId] = useState<string | null>(department?.iconId || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownId = department?.id;
  const excluded = new Set<string>();
  if (ownId) {
    excluded.add(ownId);
    // Exclude descendants as parent choices before the authoritative server
    // validates the hierarchy again under the company graph lock.
    let pending = true;
    while (pending) {
      pending = false;
      for (const child of departments) if (child.parentId && excluded.has(child.parentId) && !excluded.has(child.id)) { excluded.add(child.id); pending = true; }
    }
  }
  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (department) {
        await api(`/api/admin/workforce/departments/${encodeURIComponent(department.id)}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), description: description.trim() || null, parentId: parentId || null, leadUserId: leadUserId || null, color, iconId, expectedRevision: department.revision || 1 }) });
      } else {
        await api("/api/admin/workforce/departments", { method: "POST", body: JSON.stringify({ workspaceId, name: name.trim(), description: description.trim() || null, parentId: parentId || null, leadUserId: leadUserId || null, color, iconId }) });
      }
      await onChanged(); onClose?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save department. Refresh and review your changes."); }
    finally { setBusy(false); }
  }
  return <div className="people-company-graph-editor-v507">
    <h4>{department ? "Edit department" : "Create department"}</h4>
    <div className="people-company-department-preview-v11"><DepartmentIdentityMark department={{ name: name.trim() || "New department", color, iconId }} size={34} label /><small>Shared identity for People and organization views</small></div>
    <label><span>Name</span><ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
    <label><span>Description</span><ClusterTextInput value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
    <label><span>Parent department</span><ClusterNativeSelect value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Studio root</option>{departments.filter((entry) => !excluded.has(entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</ClusterNativeSelect></label>
    <label><span>Department lead</span><ClusterNativeSelect value={leadUserId} onChange={(event) => setLeadUserId(event.target.value)}><option value="">No lead</option>{people.filter((entry) => entry.employment?.active !== false).map((entry) => <option key={entry.id} value={entry.id}>{entry.preferredName || entry.displayName || entry.username || entry.id}</option>)}</ClusterNativeSelect></label>
    <label><span>Department color</span><ClusterInput type="color" aria-label="Department color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    <div className="people-company-department-icon-picker-v11"><span>Department icon</span><ResourceIconPicker label={name.trim() || "Department"} value={iconId} onChange={setIconId} /></div>
    {error && <p role="alert">{error}</p>}
    <div className="button-row compact"><ClusterButton disabled={busy || !name.trim()} variant="primary" onClick={() => void save()}>{busy ? "Saving…" : "Save department"}</ClusterButton>{onClose && <ClusterButton variant="secondary" onClick={onClose}>Cancel</ClusterButton>}</div>
  </div>;
}

export function CompanyGraphPanel({ departments, teams, people, workspaceId, canEdit, onChanged, onOpenPerson }: {
  departments: CompanyGraphDepartment[];
  teams: CompanyGraphTeam[];
  people: CompanyGraphPerson[];
  onOpenPerson: (id: string) => void;
  workspaceId: string;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const graph = useMemo(() => buildCompanyGraph({ departments, teams, people }), [departments, teams, people]);
  const departmentsById = useMemo(() => new Map(departments.map((department) => [department.id, department])), [departments]);
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const [showPeople, setShowPeople] = useState(true);
  const [creating, setCreating] = useState(false);
  const selected = graph.nodes.find((node) => node.id === selection) || null;
  const needle = search.trim().toLocaleLowerCase();
  const matches = graph.nodes.filter((node) => (showPeople || node.kind !== "person") && (!needle || `${node.label} ${node.detail}`.toLocaleLowerCase().includes(needle)));
  const related = selected ? graph.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id) : [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = ["department", "team", "person"] as const;
  return <div className="people-company-graph-v507" aria-label="Company relationships">
    <div className="people-company-graph-toolbar-v507">
      <label><span>Find organization resources</span><ClusterTextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find departments, teams, or people" /></label>
      <label className="people-company-graph-toggle-v507"><input type="checkbox" checked={showPeople} onChange={(event) => setShowPeople(event.target.checked)} /> Show people</label>
      <small>{departments.length} departments · {teams.length} teams · {graph.nodes.filter((node) => node.kind === "person").length} active people</small>
      {canEdit && workspaceId && <ClusterButton variant="secondary" onClick={() => setCreating((current) => !current)}>{creating ? "Close form" : "New department"}</ClusterButton>}
    </div>
    {creating && canEdit && workspaceId && <DepartmentEditor departments={departments} people={people} workspaceId={workspaceId} onChanged={onChanged} onClose={() => setCreating(false)} />}
    {graph.warnings.length > 0 && <div className="people-company-graph-warning-v507" role="status">Some department hierarchy references need attention: {graph.warnings.join("; ")}</div>}
    <div className="people-company-graph-layout-v507">
      <nav aria-label="Company graph resources" className="people-company-graph-index-v507">
        {groups.map((kind) => <section key={kind}>
          <h3>{kind === "department" ? "Departments" : kind === "team" ? "Teams" : "People"}</h3>
          {matches.filter((node) => node.kind === kind).map((node) => <button key={node.id} type="button" className={selection === node.id ? "is-selected" : ""} style={{ paddingInlineStart: `${Math.min(node.depth, 5) * 12 + 10}px` }} onClick={() => setSelection(node.id)} aria-current={selection === node.id ? "true" : undefined}>
            {kind === "department" && departmentsById.get(node.sourceId)
              ? <DepartmentIdentityMark department={departmentsById.get(node.sourceId)!} label size={25} />
              : <strong>{node.label}</strong>}
            <span>{node.detail}</span>
          </button>)}
        </section>)}
        {!matches.length && <p className="muted">No matching resources.</p>}
      </nav>
      <div className="people-company-graph-detail-v507">
        {!selected ? <div className="people-company-graph-empty-v507"><strong>Explore the company structure</strong><p>Select a department, team or person to see its authoritative relationships. This view does not create a second organization directory.</p></div> : <>
          <header><div><small>{selected.kind}</small>{selected.kind === "department" && departmentsById.get(selected.sourceId) ? <h3><DepartmentIdentityMark department={departmentsById.get(selected.sourceId)!} size={32} label /></h3> : <h3>{selected.label}</h3>}<p>{selected.detail}</p></div>{selected.kind === "person" && <ClusterButton variant="secondary" onClick={() => onOpenPerson(selected.sourceId)}>Open profile</ClusterButton>}</header>
          {canEdit && workspaceId && selected.kind === "department" && <DepartmentEditor key={`${selected.sourceId}:${(departments.find((row) => row.id === selected.sourceId) as (CompanyGraphDepartment & { revision?: number }) | undefined)?.revision || 1}`} department={departments.find((row) => row.id === selected.sourceId)} departments={departments} people={people} workspaceId={workspaceId} onChanged={onChanged} />}
          <section><h4>Relationships</h4>{!related.length && <p className="muted">No linked resources.</p>}
            <div className="people-company-graph-links-v507">{related.map((edge, index) => {
              const other = byId.get(edge.from === selected.id ? edge.to : edge.from);
              if (!other) return null;
              const role = edge.kind === "reports_to" ? (edge.to === selected.id ? "Reports to" : "Direct report") : edge.kind === "team_member" ? "Team membership" : edge.kind === "employment" ? "Employment" : edge.kind === "lead" ? "Leadership" : edge.kind === "department" ? "Department hierarchy" : "Department team";
              return <button type="button" key={`${edge.kind}-${index}-${other.id}`} onClick={() => setSelection(other.id)}><span>{role}</span><strong>{other.label}</strong><small>{other.kind}</small></button>;
            })}</div>
          </section>
        </>}
      </div>
    </div>
  </div>;
}

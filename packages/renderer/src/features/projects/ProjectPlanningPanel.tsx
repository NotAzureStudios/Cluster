import { useEffect, useMemo, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ResourceIconPicker } from "../../components/ResourceIconPicker";
import { ColorField } from "../../components/ColorField";
import { ClusterDateRangeField } from "../../components/ClusterDateTimeControls";
import type { Project, ProjectStatus, User } from "../application/application-models";
import { PROJECT_STATUS_OPTIONS } from "./projects-utils";
import type { ProjectFocusSummary } from "./project-focus";
import "./project-settings.css";

export type ProjectPlanDraft = {
  name: string;
  externalName: string;
  codename: string;
  aliases: string;
  description: string;
  objective: string;
  clientName: string;
  departmentId: string;
  startDate: string;
  targetDate: string;
  priority: string;
  tags: string;
  color: string;
  iconId: string | null;
  healthNote: string;
  status: ProjectStatus;
};

type Option = { id: string; name: string };

function createDraft(project: Project): ProjectPlanDraft {
  return { name: project.name, externalName: project.externalName || "", codename: project.codename || "", aliases: (project.aliases || []).join(", "), description: project.description || "", objective: project.objective || "", clientName: project.clientName || "", departmentId: project.departmentId || "", startDate: project.startDate?.slice(0, 10) || "", targetDate: project.targetDate?.slice(0, 10) || "", priority: project.priority || "medium", tags: (project.tags || []).join(", "), color: project.color || "#60a5fa", iconId: project.iconId || null, healthNote: project.healthNote || "", status: (project.status || "active") as ProjectStatus };
}

function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return <div className="pj-set__row" data-top={top || undefined}><span className="pj-set__label">{label}</span><div className="pj-set__control">{children}</div></div>;
}

export function ProjectPlanningPanel({ project, users, focus, onReloadFocus, canEdit, canManage, permissionReason, busy, status, onSave, onLifecycleAction, onUploadIcon }: {
  project: Project;
  users: User[];
  focus: ProjectFocusSummary | null;
  onReloadFocus: () => Promise<void> | void;
  canEdit: boolean;
  canManage: boolean;
  permissionReason: string;
  busy: boolean;
  status: string;
  onSave: (draft: ProjectPlanDraft) => Promise<void>;
  onLifecycleAction: (action: "cancel" | "reactivate" | "complete" | "reopen", reason: string) => Promise<void>;
  onUploadIcon?: (file: File) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectPlanDraft>(() => createDraft(project));
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [departments, setDepartments] = useState<Option[] | null>(null);
  const [teamOptions, setTeamOptions] = useState<Option[]>([]);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState("");
  useEffect(() => { setDraft(createDraft(project)); setLifecycleReason(""); }, [project.id, project.revision]);
  useEffect(() => {
    let live = true;
    void queryApi<Array<{ id: string; name: string; archived?: boolean }>>("/api/departments", { staleMs: 60_000 })
      .then((rows) => { if (live) setDepartments((rows || []).filter((row) => !row.archived).map((row) => ({ id: row.id, name: row.name }))); })
      .catch(() => { if (live) setDepartments(focus?.department ? [focus.department] : []); });
    // Teams: the studio directory when allowed, otherwise the teams people here belong to.
    const fromUsers = () => [...new Map(users.flatMap((user) => user.studioTeams || []).map((team) => [team.id, { id: team.id, name: team.name }])).values()];
    void queryApi<Array<{ id: string; name: string; archived?: boolean }>>("/api/team/teams", { staleMs: 60_000 })
      .then((rows) => { if (live) setTeamOptions((rows || []).filter((row) => !row.archived).map((row) => ({ id: row.id, name: row.name }))); })
      .catch(() => { if (live) setTeamOptions(fromUsers()); });
    return () => { live = false; };
  }, [project.id, users.length]);

  const change = <K extends keyof ProjectPlanDraft>(key: K, value: ProjectPlanDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(createDraft(project)), [draft, project]);
  const teams = focus?.teams || [];
  const addableTeams = teamOptions.filter((team) => !teams.some((assigned) => assigned.id === team.id)).sort((a, b) => a.name.localeCompare(b.name));
  const departmentChoices = departments || (focus?.department ? [focus.department] : []);
  const closed = ["completed", "cancelled"].includes(String(project.status || ""));

  async function addTeam(teamId: string) {
    if (!teamId) return;
    setTeamBusy(true); setTeamError("");
    try {
      await api("/api/access-rules", { method: "POST", body: JSON.stringify({ targetKind: "project", targetId: project.id, projectId: project.id, subjectKind: "team", subjectId: teamId, effect: "allow", level: "contribute" }) });
      await onReloadFocus();
    } catch (error) { setTeamError(error instanceof Error ? error.message : "That team could not be added."); } finally { setTeamBusy(false); }
  }
  async function removeTeam(ruleId: string) {
    setTeamBusy(true); setTeamError("");
    try {
      await api(`/api/access-rules/${ruleId}`, { method: "DELETE" });
      await onReloadFocus();
    } catch (error) { setTeamError(error instanceof Error ? error.message : "That team could not be removed."); } finally { setTeamBusy(false); }
  }

  return (
    <section className="pj-set">
      <header className="pj-set__bar">
        {status ? <span className="pj-set__status" data-tone={/fail|could not|denied|required/i.test(status) ? "danger" : undefined}>{status}</span> : !canEdit ? <span className="pj-set__status">{permissionReason || "Read only"}</span> : null}
        {canEdit ? <>
          {dirty ? <ClusterButton variant="quiet" size="compact" disabled={busy} onClick={() => setDraft(createDraft(project))}>Revert</ClusterButton> : null}
          <ClusterButton variant="primary" size="compact" disabled={busy || !dirty || !draft.name.trim()} busy={busy} busyLabel="Saving…" onClick={() => onSave(draft)}>Save</ClusterButton>
        </> : null}
      </header>
      <fieldset className="pj-set__fields" disabled={!canEdit}>
        <div className="pj-set__group">
          <Row label="Name"><ClusterTextInput value={draft.name} onChange={(event) => change("name", event.target.value)} /></Row>
          <Row label="Look"><div className="pj-set__inline">
            <ResourceIconPicker label={project.name} projectId={project.id} projectType={project.projectType} value={draft.iconId} disabled={!canEdit || busy} onChange={(id) => change("iconId", id)} onUpload={!dirty ? onUploadIcon : undefined} />
            <ColorField value={draft.color} onChange={(value) => change("color", value)} label="Color" />
          </div></Row>
          <Row label="Status"><ClusterNativeSelect disabled={closed} value={draft.status} onChange={(event) => change("status", event.target.value as ProjectStatus)}>{PROJECT_STATUS_OPTIONS.filter((option) => ["active", "on_hold", "paused"].includes(option.value) || option.value === draft.status).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ClusterNativeSelect></Row>
          <Row label="Priority"><ClusterNativeSelect value={draft.priority} onChange={(event) => change("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></ClusterNativeSelect></Row>
          <Row label="Dates"><ClusterDateRangeField label="Dates" start={draft.startDate} end={draft.targetDate} onChange={({ start, end }) => setDraft((current) => ({ ...current, startDate: start, targetDate: end }))} /></Row>
          <Row label="Tags"><ClusterTextInput value={draft.tags} onChange={(event) => change("tags", event.target.value)} placeholder="gameplay, launch" /></Row>
        </div>

        <h3 className="pj-set__heading">Ownership</h3>
        <div className="pj-set__group">
          <Row label="Department"><ClusterNativeSelect value={draft.departmentId} onChange={(event) => change("departmentId", event.target.value)}>
            <option value="">None</option>
            {departmentChoices.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </ClusterNativeSelect></Row>
          <Row label="Teams" top><div className="pj-set__chips">
            {teams.map((team) => <span key={team.ruleId} className="pj-set__chip" title={`${team.memberIds.length} ${team.memberIds.length === 1 ? "person" : "people"} · ${team.level}`}>
              {team.name}<small>{team.memberIds.length}</small>
              {canManage ? <ClusterIconButton size="compact" label={`Remove ${team.name}`} disabled={teamBusy} onClick={() => void removeTeam(team.ruleId)}><ClusterIcon name="close" /></ClusterIconButton> : null}
            </span>)}
            {canManage && addableTeams.length ? <ClusterNativeSelect className="pj-set__add" value="" disabled={teamBusy} aria-label="Add team" onChange={(event) => void addTeam(event.target.value)}>
              <option value="">Add team…</option>
              {addableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </ClusterNativeSelect> : null}
            {!teams.length && !(canManage && addableTeams.length) ? <span className="pj-set__muted">None</span> : null}
            {teamError ? <span className="pj-set__status" data-tone="danger">{teamError}</span> : null}
          </div></Row>
          <Row label="Client"><ClusterTextInput value={draft.clientName} onChange={(event) => change("clientName", event.target.value)} placeholder="Internal, publisher, client…" /></Row>
        </div>

        <h3 className="pj-set__heading">Goal</h3>
        <div className="pj-set__group">
          <Row label="Objective" top><ClusterTextArea rows={3} value={draft.objective} onChange={(event) => change("objective", event.target.value)} placeholder="What does done look like?" /></Row>
          <Row label="Health note" top><ClusterTextArea rows={2} value={draft.healthNote} onChange={(event) => change("healthNote", event.target.value)} placeholder="Current risk or decision" /></Row>
        </div>

        <details className="pj-set__more">
          <summary>More</summary>
          <div className="pj-set__group">
            <Row label="Public name"><ClusterTextInput value={draft.externalName} onChange={(event) => change("externalName", event.target.value)} placeholder="Partner-safe name" /></Row>
            <Row label="Codename"><ClusterTextInput value={draft.codename} onChange={(event) => change("codename", event.target.value)} /></Row>
            <Row label="Aliases"><ClusterTextInput value={draft.aliases} onChange={(event) => change("aliases", event.target.value)} placeholder="Comma-separated" /></Row>
          </div>
        </details>
      </fieldset>

      <h3 className="pj-set__heading">Lifecycle</h3>
      <div className="pj-set__group pj-set__lifecycle">
        <ClusterTextInput value={lifecycleReason} disabled={!canManage || busy} onChange={(event) => setLifecycleReason(event.target.value)} placeholder={project.status === "cancelled" ? "Reason (optional)" : "Note (required to cancel)"} aria-label="Lifecycle note" />
        {project.status === "cancelled"
          ? <ClusterButton size="compact" variant="secondary" disabled={!canManage || busy} onClick={() => onLifecycleAction("reactivate", lifecycleReason.trim())}>Reactivate</ClusterButton>
          : project.status === "completed"
            ? <ClusterButton size="compact" variant="secondary" disabled={!canManage || busy} onClick={() => onLifecycleAction("reopen", lifecycleReason.trim())}>Reopen</ClusterButton>
            : <>
              <ClusterButton size="compact" variant="secondary" disabled={!canManage || busy} onClick={() => onLifecycleAction("complete", lifecycleReason.trim())}>Mark complete</ClusterButton>
              <ClusterButton size="compact" variant="danger" disabled={!canManage || busy || !lifecycleReason.trim()} onClick={() => onLifecycleAction("cancel", lifecycleReason.trim())}>Cancel project</ClusterButton>
            </>}
      </div>
    </section>
  );
}

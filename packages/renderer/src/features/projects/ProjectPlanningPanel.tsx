import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectStatus } from "../application/application-models";
import { PROJECT_STATUS_OPTIONS } from "./projects-utils";
import { ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { ClusterOperationalStatus } from "../../components/ClusterOperationalStatus";
import { operationalInteractionState } from "../../components/operational-status";
import { ClusterButton } from "../../components/ClusterButton";
import { ColorField } from "../../components/ColorField";
import { ClusterDateRangeField } from "../../components/ClusterDateTimeControls";

export type ProjectPlanDraft = {
  name: string;
  externalName: string;
  codename: string;
  aliases: string;
  description: string;
  objective: string;
  clientName: string;
  startDate: string;
  targetDate: string;
  priority: string;
  tags: string;
  color: string;
  healthNote: string;
  status: ProjectStatus;
};

function createDraft(project: Project): ProjectPlanDraft {
  return { name: project.name, externalName: project.externalName || "", codename: project.codename || "", aliases: (project.aliases || []).join(", "), description: project.description || "", objective: project.objective || "", clientName: project.clientName || "", startDate: project.startDate?.slice(0, 10) || "", targetDate: project.targetDate?.slice(0, 10) || "", priority: project.priority || "medium", tags: (project.tags || []).join(", "), color: project.color || "#60a5fa", healthNote: project.healthNote || "", status: (project.status || "active") as ProjectStatus };
}

export function ProjectPlanningPanel({ project, setupChecklist = [], canEdit, canManage, permissionReason, busy, status, onSave, onLifecycleAction }: { project: Project; setupChecklist?: Array<{ label: string; done: boolean }>; canEdit: boolean; canManage: boolean; permissionReason: string; busy: boolean; status: string; onSave: (draft: ProjectPlanDraft) => Promise<void>; onLifecycleAction: (action: "cancel" | "reactivate", reason: string) => Promise<void> }) {
  const [draft, setDraft] = useState<ProjectPlanDraft>(() => createDraft(project));
  const [lifecycleReason, setLifecycleReason] = useState("");
  useEffect(() => { setDraft(createDraft(project)); setLifecycleReason(""); }, [project.id, project.revision]);
  const change = <K extends keyof ProjectPlanDraft>(key: K, value: ProjectPlanDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(createDraft(project)), [draft, project]);
  const days = draft.startDate && draft.targetDate ? Math.max(0, Math.ceil((new Date(draft.targetDate).getTime() - new Date(draft.startDate).getTime()) / 86_400_000)) : null;
  const tagCount = draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean).length;
  const completedSetup = setupChecklist.filter((item) => item.done).length;
  const readinessPercent = setupChecklist.length ? Math.round((completedSetup / setupChecklist.length) * 100) : 100;
  return (
    <section className="project-subpage-v312 project-planning-v312">
      <ProjectSectionHeader eyebrow="Planning" title="Brief and delivery plan" description="Keep the project’s purpose, schedule, stakeholder context, and health signal current." metrics={[{ label: "Status", value: PROJECT_STATUS_OPTIONS.find((item) => item.value === draft.status)?.label || draft.status }, { label: "Duration", value: days === null ? "Unscheduled" : `${days} days`, tone: draft.targetDate ? "accent" : "warning" }, { label: "Tags", value: tagCount }]} actions={canEdit ? <><span className={`project-unsaved-v312 ${dirty ? "dirty" : ""}`}>{dirty ? "Unsaved changes" : "Up to date"}</span><ClusterButton disabled={busy || !dirty || !draft.name.trim()} busy={busy} busyLabel="Saving…" onClick={() => onSave(draft)}>Save plan</ClusterButton></> : <ClusterOperationalStatus compact model={{ state: "read_only", interactionState: operationalInteractionState("read_only"), label: "Read only", detail: permissionReason }} />} />
      <ProjectSectionStatus tone={status.toLowerCase().includes("failed") ? "danger" : canEdit ? "good" : "neutral"}>{status || (!canEdit ? permissionReason : "")}</ProjectSectionStatus>
      <fieldset className="project-form-layout-v312 project-permission-fieldset-v316" disabled={!canEdit}>
        <ProjectSurface title="Project brief" description="Internal identity, external-safe naming, and the concise version of what the team is making and why." className="span-2" tone="accent"><div className="project-form-grid-v312"><label className="field span-2"><span>Internal name</span><ClusterTextInput value={draft.name} onChange={(event) => change("name", event.target.value)} /></label><label className="field"><span>External / public name</span><ClusterTextInput value={draft.externalName} onChange={(event) => change("externalName", event.target.value)} placeholder="Optional partner-safe name" /></label><label className="field"><span>Codename</span><ClusterTextInput value={draft.codename} onChange={(event) => change("codename", event.target.value)} placeholder="Optional internal codename" /></label><label className="field span-2"><span>Aliases / previous names</span><ClusterTextInput value={draft.aliases} onChange={(event) => change("aliases", event.target.value)} placeholder="Comma-separated" /></label><label className="field span-2"><span>Summary</span><ClusterTextArea rows={3} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="What is this project?" /></label><label className="field span-2"><span>Objective and definition of success</span><ClusterTextArea rows={5} value={draft.objective} onChange={(event) => change("objective", event.target.value)} placeholder="What measurable outcome makes the project successful?" /></label></div></ProjectSurface>
        <ProjectSurface title="Delivery window" description="Dates, lifecycle, priority, and accountable stakeholder."><div className="project-form-grid-v312"><ClusterDateRangeField className="span-2" label="Delivery window" start={draft.startDate} end={draft.targetDate} onChange={({ start, end }) => setDraft((current) => ({ ...current, startDate: start, targetDate: end }))} /><label className="field"><span>Priority</span><ClusterNativeSelect value={draft.priority} onChange={(event) => change("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></ClusterNativeSelect></label><label className="field"><span>Working status</span><ClusterNativeSelect disabled={["completed", "cancelled"].includes(String(project.status || ""))} value={draft.status} onChange={(event) => change("status", event.target.value as ProjectStatus)}>{PROJECT_STATUS_OPTIONS.filter((option) => ["active", "on_hold", "paused"].includes(option.value) || option.value === draft.status).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</ClusterNativeSelect></label><label className="field span-2"><span>Client or stakeholder</span><ClusterTextInput value={draft.clientName} onChange={(event) => change("clientName", event.target.value)} placeholder="Internal, publisher, client, partner…" /></label></div></ProjectSurface>
        <ProjectSurface title="Readiness" description="The concrete setup required before this project can operate without missing ownership or infrastructure." tone={readinessPercent >= 70 ? "accent" : "warning"}>
          <div className="project-readiness-v13">
            <div className="project-readiness-v13__summary"><strong>{readinessPercent}%</strong><span>{completedSetup}/{setupChecklist.length || completedSetup} checks complete</span></div>
            <div className="project-readiness-v13__list">{setupChecklist.length ? setupChecklist.map((item) => <div key={item.label} data-done={item.done ? "true" : "false"}><span aria-hidden="true">{item.done ? "✓" : "!"}</span><strong>{item.label}</strong><em>{item.done ? "Ready" : "Required"}</em></div>) : <div data-done="true"><span aria-hidden="true">✓</span><strong>No setup checks required</strong><em>Ready</em></div>}</div>
          </div>
        </ProjectSurface>
        <ProjectSurface title="Project lifecycle" description="Completion is governed by Closeout. Cancellation is an explicit manager action, not a dropdown accident."><div className="project-form-grid-v312"><label className="field span-2"><span>Lifecycle note</span><ClusterTextArea rows={3} value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder={project.status === "cancelled" ? "Reason for reactivating this project" : "Reason for cancelling this project"} /></label><div className="field span-2">{project.status === "cancelled" ? <ClusterButton variant="secondary" disabled={!canManage || busy} busy={busy} onClick={() => onLifecycleAction("reactivate", lifecycleReason.trim())}>Reactivate project</ClusterButton> : project.status === "completed" ? <ProjectSectionStatus tone="neutral">Completed projects are reopened from Closeout so verification history stays coherent.</ProjectSectionStatus> : <ClusterButton variant="danger" disabled={!canManage || busy || !lifecycleReason.trim()} busy={busy} onClick={() => onLifecycleAction("cancel", lifecycleReason.trim())}>Cancel project</ClusterButton>} {!canManage ? <small>{permissionReason}</small> : null}</div></div></ProjectSurface>
        <ProjectSurface title="Identity and health" description="Visual identity, discoverability, and the current delivery signal."><div className="project-form-grid-v312"><label className="field span-2"><span>Tags</span><ClusterTextInput value={draft.tags} onChange={(event) => change("tags", event.target.value)} placeholder="gameplay, launch, client" /></label><ColorField value={draft.color} onChange={(value) => change("color", value)} label="Project color" /><label className="field span-2"><span>Health note</span><ClusterTextArea rows={5} value={draft.healthNote} onChange={(event) => change("healthNote", event.target.value)} placeholder="Current risk, dependency, decision, or delivery note." /></label></div></ProjectSurface>
      </fieldset>
    </section>
  );
}

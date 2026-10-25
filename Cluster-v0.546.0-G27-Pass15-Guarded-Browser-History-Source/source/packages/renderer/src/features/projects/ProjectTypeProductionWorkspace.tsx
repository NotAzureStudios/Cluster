import { useEffect, useMemo, useState } from "react";
import type { ClusterProjectTypeDefinition, ClusterProjectWorkspaceEntityDefinition } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterField } from "../../components/ClusterField";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ProjectTicketDestinationPicker, projectTicketDestinationIds } from "./ProjectTicketDestinationPicker";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { api } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import type { Project, User } from "../application/application-models";
import { displayUserName } from "../people/people-utils";
import { ProjectEmptyState, ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { projectMemberIds, projectMemberRoles } from "./projects-utils";
import { deriveProjectTypeOperatingLens } from "./project-type-operating-lens";
import { deriveProjectTypeDailyOperations } from "./project-type-daily-operations";
import { mergeTypeWorkspaceRecords, upsertTypeWorkspaceRecord, type TypeWorkspacePayload, type TypeWorkspaceRecord } from "./project-type-workspace-state";
type ProjectTypesPayload = { types: ClusterProjectTypeDefinition[]; defaultTypeId: string; contractVersion: number };
type MigrationPreview = {
  currentType: ClusterProjectTypeDefinition;
  targetType: ClusterProjectTypeDefinition;
  targetEntities: ClusterProjectWorkspaceEntityDefinition[];
  affectedRecords: Array<{ id: string; title: string; entityKind: string }>;
  removedTools: string[];
  addedTools: string[];
  droppedStages: string[];
  warnings: string[];
  safe: boolean;
  requiresConfirmation: boolean;
};

const pretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const closed = (status: string) => ["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"].includes(status.toLowerCase());

function workspaceTitle(type: ClusterProjectTypeDefinition) {
  if (type.category === "game") return "Game production";
  if (type.category === "software") return "Software delivery";
  if (type.category === "creative") return "Creative studio";
  if (type.category === "marketing") return "Campaign operations";
  if (type.category === "event") return "Event production";
  if (type.category === "operations") return "Operations workspace";
  return `${type.label} production`;
}

function workspaceDescription(type: ClusterProjectTypeDefinition) {
  if (type.category === "game") return "Features, systems, levels, assets, playtests, platforms, and releases tied into the shared Project graph.";
  if (type.category === "software") return "Releases, environments, deployments, incidents, and controlled changes without splitting delivery into another app.";
  if (type.category === "creative") return "Concepts, assets, iterations, review rounds, approvals, and deliverables on the shared Project backbone.";
  if (type.category === "marketing") return "Campaigns, audiences, channels, deliverables, activations, and performance follow-through tied into shared scheduling and work.";
  if (type.category === "event") return "Sessions, run-of-show items, resources, bookings, issues, and live delivery on the shared Project backbone.";
  if (type.category === "operations") return "Initiatives, service requests, procedures, recurring runs, incidents, and controlled improvements without creating a second operations database.";
  return type.note;
}

function crewMatchesOwnership(user: User, project: Project, ownership: string[]) {
  if (!ownership.length) return false;
  const role = projectMemberRoles(project)[user.id] || "";
  const searchable = [user.department, user.teamName, user.title, role, ...(user.skills || [])].filter(Boolean).join(" ").toLowerCase();
  return ownership.some((token) => searchable.includes(token.toLowerCase().replaceAll("_", " ")) || searchable.includes(token.toLowerCase()));
}

export function ProjectTypeProductionWorkspace({ project, type, users, canContribute, canManage, isAdmin, onReloadProjects }: { project: Project; type: ClusterProjectTypeDefinition; users: User[]; canContribute: boolean; canManage: boolean; isAdmin: boolean; onReloadProjects: () => Promise<unknown> }) {
  const [data, setData] = useState<TypeWorkspacePayload | null>(null);
  const [status, setStatus] = useState("");
  const [ticketDestination, setTicketDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [entityKind, setEntityKind] = useState(type.workspaceEntities?.[0]?.id || "");
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [stage, setStage] = useState(type.workspaceEntities?.[0]?.stage || type.deliveryStages?.[0] || "");
  const [dueDate, setDueDate] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  const [projectTypes, setProjectTypes] = useState<ClusterProjectTypeDefinition[]>([]);
  const [migrationTarget, setMigrationTarget] = useState("");
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);
  const [migrationMappings, setMigrationMappings] = useState<Record<string, string>>({});
  const [migrationConfirmTools, setMigrationConfirmTools] = useState(false);
  const [migrationConfirmStages, setMigrationConfirmStages] = useState(false);
  const [scheduleStage, setScheduleStage] = useState(type.deliveryStages?.[0] || "");
  const [scheduleOwnerId, setScheduleOwnerId] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleHours, setScheduleHours] = useState("4");

  const load = async () => setData(await api<TypeWorkspacePayload>(`/api/projects/${project.id}/type-workspace`));
  useEffect(() => {
    setData(null); setStatus(""); setEntityKind(type.workspaceEntities?.[0]?.id || ""); setStage(type.workspaceEntities?.[0]?.stage || type.deliveryStages?.[0] || ""); setFilterKind("all"); setMigrationPreview(null); setMigrationMappings({}); setMigrationConfirmTools(false); setMigrationConfirmStages(false);
    void load().catch(() => setStatus("Specialized project workspace failed to load."));
    void api<ProjectTypesPayload>("/api/project-types").then((payload) => setProjectTypes(payload.types)).catch(() => setProjectTypes([]));
  }, [project.id, type.id]);

  const effectiveType = data?.type || type;
  const entities = effectiveType.workspaceEntities || [];
  const entityMap = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  const assignedIds = new Set(projectMemberIds(project));
  const crew = users.filter((user) => assignedIds.has(user.id) && !user.archived);
  const visibleRecords = (data?.records || []).filter((record) => filterKind === "all" || record.entityKind === filterKind);
  const activeEntity = entityMap.get(entityKind) || entities[0];
  const stages = effectiveType.deliveryStages || [];
  const stageCoverage = stages.map((stageName) => {
    const ownership = effectiveType.stageOwnership?.[stageName] || [];
    const matchingCrew = crew.filter((user) => crewMatchesOwnership(user, project, ownership));
    const records = (data?.records || []).filter((record) => record.stage === stageName);
    return { stage: stageName, ownership, matchingCrew, records, open: records.filter((record) => !closed(record.status)).length };
  });
  const coveredStages = stageCoverage.filter((item) => item.matchingCrew.length > 0 || item.ownership.length === 0).length;
  const operatingLens = useMemo(() => deriveProjectTypeOperatingLens(effectiveType, data?.records || []), [effectiveType, data?.records]);
  const dailyOperations = useMemo(() => deriveProjectTypeDailyOperations(effectiveType, data?.records || []), [effectiveType, data?.records]);

  async function mutate(action: () => Promise<unknown>, success: string, refresh = true) {
    setBusy(true); setStatus("");
    try { await action(); if (refresh) await load(); setStatus(success); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Project workspace action failed."); }
    finally { setBusy(false); }
  }

  async function createRecord() {
    if (!activeEntity || !title.trim()) return;
    setBusy(true); setStatus("");
    try {
      const record = await api<TypeWorkspaceRecord>(`/api/projects/${project.id}/type-workspace/records`, { method: "POST", body: JSON.stringify({ entityKind: activeEntity.id, title: title.trim(), ownerId: ownerId || null, stage: stage || activeEntity.stage || null, dueDate: dueDate || null, status: activeEntity.defaultStatus, payload: {} }) });
      setData((current) => current ? upsertTypeWorkspaceRecord(current, record) : current);
      setTitle(""); setDueDate(""); setStatus(`${activeEntity.label} created.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Project workspace action failed."); }
    finally { setBusy(false); }
  }

  async function patchRecord(record: TypeWorkspaceRecord, patch: Record<string, unknown>) {
    setBusy(true); setStatus("");
    try {
      const updated = await api<TypeWorkspaceRecord>(`/api/projects/${project.id}/type-workspace/records/${record.id}`, { method: "PATCH", body: JSON.stringify({ ...patch, expectedRevision: record.revision }) });
      setData((current) => current ? upsertTypeWorkspaceRecord(current, updated) : current);
      setStatus(`${entityMap.get(record.entityKind)?.label || "Production record"} updated.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Project workspace action failed."); }
    finally { setBusy(false); }
  }

  async function materialize(record: TypeWorkspaceRecord, target: "ticket" | "timeline") {
    const destination = target === "ticket" ? projectTicketDestinationIds(ticketDestination) : null;
    if (target === "ticket" && !destination) { setStatus("Choose an active Ticket destination Board/List first."); return; }
    await mutate(() => api(`/api/projects/${project.id}/control-records/${record.id}/materialize`, { method: "POST", body: JSON.stringify({ target, attach: true, ...(destination || {}) }) }), `${target === "ticket" ? "Ticket" : "Timeline item"} created from ${entityMap.get(record.entityKind)?.label.toLowerCase() || "record"}.`, false);
  }

  async function applyTemplate(template: string) {
    setBusy(true); setStatus("");
    try {
      const result = await api<{ created: TypeWorkspaceRecord[]; skipped: number }>(`/api/projects/${project.id}/type-workspace/apply-template`, { method: "POST", body: JSON.stringify({ template }) });
      setData((current) => current ? mergeTypeWorkspaceRecords(current, result.created || []) : current);
      setStatus(`${template} template applied${result.skipped ? ` · ${result.skipped} existing record${result.skipped === 1 ? "" : "s"} kept` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Project template could not be applied."); }
    finally { setBusy(false); }
  }

  async function createStageAutomation(stageName: string) {
    const coverage = stageCoverage.find((item) => item.stage === stageName);
    const defaultOwner = coverage?.matchingCrew[0]?.id || scheduleOwnerId || null;
    await mutate(() => api(`/api/projects/${project.id}/type-workspace/stage-automation`, { method: "POST", body: JSON.stringify({ stage: stageName, ownerId: defaultOwner }) }), `${pretty(stageName)} handoff automation configured.`, false);
  }

  async function scheduleStageWork() {
    if (!scheduleStage || !scheduleAt) return;
    const startsAt = new Date(scheduleAt);
    const hours = Math.max(0.5, Math.min(24, Number(scheduleHours) || 4));
    const endsAt = new Date(startsAt.getTime() + hours * 3_600_000);
    const owner = scheduleOwnerId || stageCoverage.find((item) => item.stage === scheduleStage)?.matchingCrew[0]?.id || undefined;
    setBusy(true); setStatus("");
    try {
      await api("/api/schedule/blocks", { method: "POST", body: JSON.stringify({ projectId: project.id, userId: owner, title: `${effectiveType.label} · ${pretty(scheduleStage)}`, description: `[project-type-stage] ${effectiveType.id}:${scheduleStage}`, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), type: "work" }) });
      setStatus(`${pretty(scheduleStage)} work block added to Scheduler.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Scheduler manage permission is required to place stage work."); }
    finally { setBusy(false); }
  }

  async function previewMigration() {
    if (!migrationTarget || migrationTarget === effectiveType.id) { setMigrationPreview(null); return; }
    setBusy(true); setStatus("");
    try {
      const preview = await api<MigrationPreview>(`/api/projects/${project.id}/type-workspace/migration-preview?targetType=${encodeURIComponent(migrationTarget)}`);
      setMigrationPreview(preview);
      setMigrationMappings(Object.fromEntries(preview.affectedRecords.map((record) => [record.id, preview.targetEntities.some((entity) => entity.id === record.entityKind) ? record.entityKind : ""])));
      setMigrationConfirmTools(preview.removedTools.length === 0);
      setMigrationConfirmStages(preview.droppedStages.length === 0);
    }
    catch (error) { setStatus(error instanceof Error ? error.message : "Project type migration preview failed."); }
    finally { setBusy(false); }
  }

  async function applyMigration() {
    if (!migrationPreview) return;
    const missingMapping = migrationPreview.affectedRecords.find((record) => !migrationMappings[record.id]);
    if (missingMapping) { setStatus(`Choose how to migrate ${missingMapping.title}.`); return; }
    if (migrationPreview.removedTools.length && !migrationConfirmTools) { setStatus("Confirm the tools that will leave the default workspace."); return; }
    if (migrationPreview.droppedStages.length && !migrationConfirmStages) { setStatus("Confirm the delivery stages that will be removed."); return; }
    setBusy(true); setStatus("");
    try {
      const result = await api<{ migrated: number; archived: number; projectType: string }>(`/api/projects/${project.id}/type-workspace/migrate`, { method: "POST", body: JSON.stringify({ targetType: migrationPreview.targetType.id, recordMappings: migrationMappings, confirmRemovedTools: migrationConfirmTools, confirmDroppedStages: migrationConfirmStages, expectedRevision: project.revision }) });
      await onReloadProjects();
      setMigrationPreview(null); setMigrationTarget(""); setMigrationMappings({});
      setStatus(`Project migrated to ${migrationPreview.targetType.label}. ${result.migrated} record${result.migrated === 1 ? "" : "s"} mapped${result.archived ? ` · ${result.archived} archived` : ""}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Project type migration failed."); }
    finally { setBusy(false); }
  }

  if (!entities.length) return <section className="project-subpage-v312 project-type-workspace-v495"><ProjectEmptyState title="No specialized workspace configured" description={`${effectiveType.label} does not define specialized production entities yet. Studio admins can add them to the Project Type contract.`} /></section>;

  return <section className="project-subpage-v312 project-type-workspace-v495">
    <ProjectSectionHeader eyebrow={effectiveType.label} title={workspaceTitle(effectiveType)} description={workspaceDescription(effectiveType)} metrics={[{ label: "Records", value: data?.summary.total || 0, tone: "accent" }, { label: "Open", value: data?.summary.open || 0, tone: data?.summary.open ? "warning" : "good" }, { label: "Unowned", value: data?.summary.unowned || 0, tone: data?.summary.unowned ? "warning" : "good" }, { label: "Stage coverage", value: `${coveredStages}/${stages.length || 0}`, tone: coveredStages === stages.length ? "good" : "warning" }]} />
    {canContribute ? <ProjectTicketDestinationPicker project={project} value={ticketDestination} onChange={setTicketDestination} /> : null}
    {status ? <ProjectSectionStatus tone={status.toLowerCase().includes("failed") || status.toLowerCase().includes("required") ? "danger" : "neutral"}>{status}</ProjectSectionStatus> : null}

    {(effectiveType.dashboardWidgets || []).length || (effectiveType.defaultTools || []).length ? <ProjectSurface title="Type-aware workspace defaults" description="This Project Type drives the dashboard emphasis, navigation, and automation vocabulary used across Cluster."><div className="project-type-template-row-v495">{(effectiveType.dashboardWidgets || []).map((widget) => <span key={`widget-${widget}`} className="soft-pill">{pretty(widget)}</span>)}{(effectiveType.defaultTools || []).slice(0, 10).map((tool) => <span key={`tool-${tool}`} className="soft-pill">{effectiveType.terminology?.[tool] || pretty(tool)}</span>)}</div></ProjectSurface> : null}
    {(effectiveType.productionTemplates || []).length ? <ProjectSurface title="Production templates" description="Bootstrap type-aware records without creating a disconnected template system."><div className="project-type-template-row-v495">{effectiveType.productionTemplates!.map((template) => <ClusterButton key={template} size="compact" variant="quiet" disabled={!canContribute || busy} onClick={() => void applyTemplate(template)}>{template}</ClusterButton>)}</div></ProjectSurface> : null}

    <ProjectSurface title={operatingLens.title} description="Type-specific operating signals derived from the same Project Control records, so specialized projects expose useful daily focus instead of cosmetic metadata."><div className="project-type-operating-lens-v495">{operatingLens.items.map((item) => <ClusterButton key={item.id} variant="quiet" className={item.attention ? "needs-attention" : ""} selected={filterKind === item.id} onClick={() => setFilterKind((current) => current === item.id ? "all" : item.id)}><span><strong>{item.label}</strong><small>{item.open} open · {item.total} total</small></span><em>{item.overdue ? `${item.overdue} overdue` : item.unowned ? `${item.unowned} unowned` : item.highRisk ? `${item.highRisk} high risk` : "Clear"}</em></ClusterButton>)}</div></ProjectSurface>

    {dailyOperations.signals.length ? <ProjectSurface title={dailyOperations.title} description="Category-specific queues derived from the same specialized records, tuned to the decisions this kind of project actually makes every day."><div className="project-type-daily-operations-v495"><div className="project-type-daily-signals-v495">{dailyOperations.signals.map((signal) => <article key={signal.id} className={signal.count ? "active" : "clear"}><div><strong>{signal.label}</strong><span>{signal.detail}</span></div><em>{signal.count ? `${signal.count} active` : "Clear"}</em></article>)}</div>{dailyOperations.attention.length ? <div className="project-type-attention-queue-v495"><header><strong>Needs attention</strong><span>{dailyOperations.attentionCount} open signal{dailyOperations.attentionCount === 1 ? "" : "s"}</span></header>{dailyOperations.attention.map((record) => <ClusterButton key={record.id} variant="quiet" size="compact" onClick={() => setFilterKind(record.entityKind)}><span><strong>{record.title}</strong><small>{pretty(record.entityKind)} · {pretty(record.status)}</small></span><em>{record.reasons.slice(0, 2).join(" · ")}</em></ClusterButton>)}</div> : <ProjectSectionStatus tone="good">No category-specific blockers or near-term attention records.</ProjectSectionStatus>}</div></ProjectSurface> : null}

    <div className="project-type-workspace-grid-v495">
      <ProjectSurface title="Specialized work" description="Create and operate domain records that still participate in Project Control, search, relationships, and automation." action={<ClusterSelect ariaLabel="Specialized record filter" value={filterKind} onChange={setFilterKind} options={[{ value: "all", label: "All records" }, ...entities.map((entity) => ({ value: entity.id, label: entity.plural }))]} />}>
        {canContribute ? <div className="project-type-composer-v495">
          <ClusterField label="Type"><ClusterSelect ariaLabel="Specialized record type" value={entityKind} onChange={(value) => { setEntityKind(value); const next = entityMap.get(value); if (next?.stage) setStage(next.stage); }} options={entities.map((entity) => ({ value: entity.id, label: entity.label }))} /></ClusterField>
          <ClusterField label="Title"><ClusterTextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder={activeEntity ? `New ${activeEntity.label.toLowerCase()}` : "New record"} /></ClusterField>
          <ClusterField label="Owner"><ClusterSelect ariaLabel="Specialized record owner" value={ownerId} onChange={setOwnerId} options={[{ value: "", label: "Unassigned" }, ...crew.map((user) => ({ value: user.id, label: displayUserName(user), meta: user.department || projectMemberRoles(project)[user.id] || "Project member" }))]} /></ClusterField>
          <ClusterField label="Stage"><ClusterSelect ariaLabel="Specialized record stage" value={stage} onChange={setStage} options={[{ value: "", label: "No stage" }, ...stages.map((item) => ({ value: item, label: pretty(item) }))]} /></ClusterField>
          <ClusterField label="Due"><ClusterTextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></ClusterField>
          <ClusterButton variant="primary" busy={busy} disabled={!title.trim()} onClick={() => void createRecord()}>Add {activeEntity?.label || "record"}</ClusterButton>
        </div> : null}
        <div className="project-type-record-grid-v495">{visibleRecords.length ? visibleRecords.map((record) => {
          const entity = entityMap.get(record.entityKind);
          const statusOptions = entity?.statuses || [record.status];
          const owner = crew.find((user) => user.id === record.ownerId);
          return <article key={record.id} className="project-type-record-v495"><header><div><span>{entity?.label || pretty(record.entityKind)}</span><strong>{record.title}</strong></div><em>{record.stage ? pretty(record.stage) : "No stage"}</em></header>{entity?.description ? <p>{entity.description}</p> : null}<div className="project-type-record-meta-v495"><span>{owner ? displayUserName(owner) : "Unassigned"}</span><span>{record.dueDate ? `Due ${new Date(record.dueDate).toLocaleDateString()}` : "No due date"}</span><span>{record.updatedAt ? formatRelativeTime(record.updatedAt) : ""}</span></div><div className="project-type-record-actions-v495"><ClusterSelect ariaLabel={`${record.title} status`} value={record.status} onChange={(value) => void patchRecord(record, { status: value, progress: closed(value) ? 100 : record.progress })} options={statusOptions.map((value) => ({ value, label: pretty(value) }))} />{canContribute ? <ClusterSelect ariaLabel={`${record.title} owner`} value={record.ownerId || ""} onChange={(value) => void patchRecord(record, { ownerId: value || null })} options={[{ value: "", label: "Unassigned" }, ...crew.map((user) => ({ value: user.id, label: displayUserName(user) }))]} /> : null}{canContribute ? <ClusterButton size="compact" variant="quiet" onClick={() => void materialize(record, "ticket")}>Create ticket</ClusterButton> : null}{canContribute && ["milestone", "deliverable"].includes(String(record.kind)) ? <ClusterButton size="compact" variant="quiet" onClick={() => void materialize(record, "timeline")}>Timeline</ClusterButton> : null}</div></article>;
        }) : <ProjectEmptyState title={`No ${filterKind === "all" ? "specialized records" : entityMap.get(filterKind)?.plural.toLowerCase() || "records"}`} description="Apply a production template or add the first domain record above." />}</div>
      </ProjectSurface>

      <div className="project-type-side-stack-v495">
        <ProjectSurface title="Stage ownership" description="Configured department/role ownership matched against the actual Project crew."><div className="project-stage-coverage-v495">{stageCoverage.map((item) => <article key={item.stage} className={item.ownership.length && !item.matchingCrew.length ? "missing" : "covered"}><div><strong>{pretty(item.stage)}</strong><span>{item.ownership.length ? item.ownership.join(" · ") : "No ownership requirement"}</span></div><small>{item.matchingCrew.length ? item.matchingCrew.map(displayUserName).join(", ") : item.ownership.length ? "No matching project crew" : `${item.open} open record${item.open === 1 ? "" : "s"}`}</small>{canManage ? <ClusterButton size="compact" variant="quiet" onClick={() => void createStageAutomation(item.stage)}>Handoff automation</ClusterButton> : null}</article>)}</div></ProjectSurface>

        <ProjectSurface title="Resource planning" description="Place stage work through the shared Scheduler. Scheduler permission stays authoritative."><div className="project-stage-scheduler-v495"><ClusterField label="Stage"><ClusterSelect ariaLabel="Stage scheduling target" value={scheduleStage} onChange={setScheduleStage} options={stages.map((item) => ({ value: item, label: pretty(item) }))} /></ClusterField><ClusterField label="Owner"><ClusterSelect ariaLabel="Stage schedule owner" value={scheduleOwnerId} onChange={setScheduleOwnerId} options={[{ value: "", label: "Use matched owner" }, ...crew.map((user) => ({ value: user.id, label: displayUserName(user), meta: user.department || "Project member" }))]} /></ClusterField><ClusterField label="Starts"><ClusterTextInput type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></ClusterField><ClusterField label="Hours"><ClusterTextInput type="number" min={0.5} max={24} step={0.5} value={scheduleHours} onChange={(event) => setScheduleHours(event.target.value)} /></ClusterField><ClusterButton variant="secondary" busy={busy} disabled={!canManage || !scheduleAt || !scheduleStage} onClick={() => void scheduleStageWork()}>Add to Scheduler</ClusterButton></div></ProjectSurface>
      </div>
    </div>

    {canManage ? <ProjectSurface title="Project type migration" description={isAdmin ? "Preview, map, confirm, and apply Project Type changes without silently stranding specialized records or workflow stages." : "Project managers can preview migration impact. A Studio admin is required to apply a Project Type change."}><div className="project-type-migration-v495"><ClusterSelect ariaLabel="Project type migration target" value={migrationTarget} onChange={(value) => { setMigrationTarget(value); setMigrationPreview(null); setMigrationMappings({}); }} options={[{ value: "", label: "Select target type" }, ...projectTypes.filter((item) => item.id !== effectiveType.id && item.enabled !== false).map((item) => ({ value: item.id, label: item.label }))]} /><ClusterButton variant="secondary" busy={busy} disabled={!migrationTarget} onClick={() => void previewMigration()}>Preview migration</ClusterButton>{migrationPreview ? <div className={`project-type-migration-result-v495 ${migrationPreview.safe ? "safe" : "warning"}`}><strong>{migrationPreview.safe ? "Direct mapping available" : "Explicit migration choices required"}</strong>{migrationPreview.warnings.length ? <ul>{migrationPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No specialized records, stages, or default tools would be stranded.</p>}{migrationPreview.affectedRecords.length ? <div className="project-type-migration-map-v495">{migrationPreview.affectedRecords.map((record) => <ClusterField key={record.id} label={`${record.title} · ${pretty(record.entityKind)}`}><ClusterSelect ariaLabel={`Migration mapping for ${record.title}`} value={migrationMappings[record.id] || ""} onChange={(value) => setMigrationMappings((current) => ({ ...current, [record.id]: value }))} options={[{ value: "", label: "Choose mapping" }, ...migrationPreview.targetEntities.map((entity) => ({ value: entity.id, label: `Map to ${entity.label}` })), { value: "archive", label: "Archive this record" }]} /></ClusterField>)}</div> : null}{migrationPreview.removedTools.length ? <ClusterButton size="compact" variant={migrationConfirmTools ? "secondary" : "quiet"} onClick={() => setMigrationConfirmTools((value) => !value)}>{migrationConfirmTools ? <ClusterIcon name="check" /> : "Confirm"} removed tools: {migrationPreview.removedTools.join(", ")}</ClusterButton> : null}{migrationPreview.droppedStages.length ? <ClusterButton size="compact" variant={migrationConfirmStages ? "secondary" : "quiet"} onClick={() => setMigrationConfirmStages((value) => !value)}>{migrationConfirmStages ? <ClusterIcon name="check" /> : "Confirm"} removed stages: {migrationPreview.droppedStages.map(pretty).join(", ")}</ClusterButton> : null}<ClusterButton variant="primary" busy={busy} disabled={!isAdmin} title={!isAdmin ? "Studio admin required to apply Project Type migration" : undefined} onClick={() => void applyMigration()}>Apply migration to {migrationPreview.targetType.label}</ClusterButton></div> : null}</div></ProjectSurface> : null}
  </section>;
}

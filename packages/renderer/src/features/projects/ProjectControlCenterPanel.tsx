import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, formatApiError } from "../../core/api";
import type { Project, User } from "../application/application-models";
import { ProjectEmptyState, ProjectSectionHeader, ProjectSectionStatus, ProjectSegmentedControl, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { ProjectControlRecordEditor } from "./ProjectControlRecordEditor";
import { ProjectControlRecordCard } from "./ProjectControlRecordCard";
import { ProjectRoadmapWorkbench } from "./ProjectRoadmapWorkbench";
import { ProjectAutomationHistory } from "./ProjectAutomationHistory";
import { ProjectStructureTemplates } from "./ProjectStructureTemplates";
import { ProjectBudgetSummary } from "./ProjectBudgetSummary";
import { ProjectReportWorkbench } from "./ProjectReportWorkbench";
import { ProjectTeamCapacitySummary } from "./ProjectTeamCapacitySummary";
import {
  PROJECT_CONTROL_KIND_META,
  controlDateLabel,
  emptyProjectControlDraft,
  recordIsClosed,
  recordMatchesSavedView,
  type ProjectControlCenterPayload,
  type ProjectControlDraft,
  type ProjectControlKind,
  type ProjectControlRecord,
} from "./project-control-model";
import { runtimeStyle } from "../../core/runtime-style";
import { LoadingState } from "../../components/LoadingState";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ProjectTicketDestinationPicker, projectTicketDestinationIds } from "./ProjectTicketDestinationPicker";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { resolveClusterResourceActions } from "../../core/resource-action-registry";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { readClusterDetailSelection, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { ProjectWorkflowGraphPanel } from "./ProjectWorkflowGraphPanel";

type ControlView = "pulse" | "roadmap" | "raid" | "outcomes" | "team" | "system";
const RAID_DESCRIPTIONS: Partial<Record<ProjectControlKind, string>> = { risk: "Probability, impact, trigger conditions, ownership, and mitigation.", issue: "Active problems requiring resolution.", assumption: "Unverified beliefs that can change scope or delivery.", decision: "Options, outcomes, rationale, and approval state.", dependency: "External or internal conditions the project relies on.", change_request: "Controlled changes to scope, dates, staffing, or release targets." };
const humanize = (value: string) => value.replace(/[_-]/g, " ");
const VIEW_ITEMS: Array<{ id: ControlView; label: string }> = [
  { id: "pulse", label: "Pulse" },
  { id: "roadmap", label: "Roadmap" },
  { id: "raid", label: "RAID & change" },
  { id: "outcomes", label: "Goals & reports" },
  { id: "team", label: "People controls" },
  { id: "system", label: "Automation & closeout" },
];

function closedStatus(kind: ProjectControlKind) {
  if (kind === "risk" || kind === "issue") return "resolved";
  if (kind === "decision" || kind === "change_request" || kind === "baseline") return "approved";
  if (kind === "status_report") return "published";
  return "completed";
}

function healthTone(value: number) {
  if (value >= 80) return "good";
  if (value >= 60) return "warning";
  return "danger";
}

function controlViewForKind(kind: ProjectControlKind): ControlView {
  if (["phase", "milestone", "deliverable"].includes(kind)) return "roadmap";
  if (["risk", "issue", "assumption", "decision", "dependency", "change_request"].includes(kind)) return "raid";
  if (["goal", "status_report", "baseline", "budget"].includes(kind)) return "outcomes";
  if (["responsibility", "onboarding"].includes(kind)) return "team";
  if (["automation", "saved_view", "closeout"].includes(kind)) return "system";
  return "pulse";
}

function payloadForApi(draft: ProjectControlDraft) {
  return {
    ...draft,
    ownerId: draft.ownerId || null,
    parentId: draft.parentId || null,
    category: draft.category || null,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    probability: draft.kind === "risk" ? draft.probability : null,
    impact: draft.kind === "risk" ? draft.impact : null,
    confidence: draft.kind === "goal" ? draft.confidence : null,
    linkedEntityType: draft.linkedEntityType || null,
    linkedEntityId: draft.linkedEntityId || null,
  };
}

export function ProjectControlCenterPanel({ project, projects, users, currentUser, canManage, permissionReason, data, loading, onReload, onReloadProjectResources }: {
  project: Project;
  projects: Project[];
  users: User[];
  currentUser?: User | null;
  canManage: boolean;
  permissionReason: string;
  data: ProjectControlCenterPayload | null;
  loading: boolean;
  onReload: () => Promise<void>;
  onReloadProjectResources?: () => Promise<void>;
}) {
  const [view, setView] = useState<ControlView>("pulse");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const restoreControlDetail = useCallback((id: string | null) => setSelectedRecordId(id || ""), []);
  const controlDetailHistory = useClusterDetailHistory("project-control", selectedRecordId || null, restoreControlDetail);
  const [editing, setEditing] = useState<ProjectControlRecord | null>(null);
  const [creatingKind, setCreatingKind] = useState<ProjectControlKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [ticketDestination, setTicketDestination] = useState("");
  const [activeSavedViewId, setActiveSavedViewId] = useState("");
  const [automationRefresh, setAutomationRefresh] = useState(0);
  const [automationTemplates, setAutomationTemplates] = useState<Array<{ id: string; title: string; description: string; trigger: string }>>([]);
  const [studioAutomationGovernance, setStudioAutomationGovernance] = useState<{ total: number; published: number; drafts: number; paused: number; failing: number; unowned: number; methodology: string } | null>(null);
  const [automationVersions, setAutomationVersions] = useState<Record<string, Array<{ id: string; createdAt: string; governanceVersion: number; governanceState: string; reason: string; changedKeys: string[]; checksum: string }>>>({});
  const [expandedAutomationVersions, setExpandedAutomationVersions] = useState("");
  const [automationCopyTargets, setAutomationCopyTargets] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState<"game-production" | "software" | "content" | "client-delivery">(project.external ? "client-delivery" : project.projectType === "game" ? "game-production" : project.projectType === "video" || project.projectType === "creative" ? "content" : "software");
  const [relationshipDraft, setRelationshipDraft] = useState({ sourceId: "", targetType: "control" as "control" | "project", targetId: "", relationship: "depends_on", critical: false, description: "" });
  const records = data?.records || [];
  const relationships = data?.relationships || [];
  const savedViews = records.filter((record) => record.kind === "saved_view");
  const activeSavedView = savedViews.find((record) => record.id === activeSavedViewId) || null;
  const visibleRecords = activeSavedView ? records.filter((record) => record.kind === "saved_view" || recordMatchesSavedView(record, activeSavedView)) : records;
  const summary = data?.summary;
  const recordsById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const selectedRecord = selectedRecordId ? recordsById.get(selectedRecordId) || null : null;
  useEffect(() => {
    if (view !== "system") return;
    let active = true;
    void api<{ templates: Array<{ id: string; title: string; description: string; trigger: string }> }>(`/api/projects/${project.id}/automation-templates`).then((result) => { if (active) setAutomationTemplates(result.templates || []); }).catch(() => { if (active) setAutomationTemplates([]); });
    return () => { active = false; };
  }, [project.id, view, automationRefresh]);
  useEffect(() => {
    if (view !== "system" || !currentUser?.isAdmin) { setStudioAutomationGovernance(null); return; }
    let active = true;
    void api<{ total: number; published: number; drafts: number; paused: number; failing: number; unowned: number; methodology: string }>(`/api/projects/${project.id}/automations/governance/studio`).then((result) => { if (active) setStudioAutomationGovernance(result); }).catch(() => { if (active) setStudioAutomationGovernance(null); });
    return () => { active = false; };
  }, [project.id, view, automationRefresh, currentUser?.isAdmin]);

  useEffect(() => {
    const requestedId = readClusterDetailSelection("project-control");
    if (!requestedId || loading) return;
    const record = recordsById.get(requestedId);
    if (record) { setView(controlViewForKind(record.kind)); return; }
    setSelectedRecordId("");
    recoverClusterDetailNavigation("project-control", { title: "Project control record unavailable", message: "That control record may have been archived, deleted, moved, or your access may have changed. Project Control stayed open.", tone: "warning" });
  }, [loading, recordsById]);
  const childrenByParent = useMemo(() => records.reduce((map, record) => { if (record.parentId) map.set(record.parentId, (map.get(record.parentId) || 0) + 1); return map; }, new Map<string, number>()), [records]);
  const byKind = (kind: ProjectControlKind) => visibleRecords.filter((record) => record.kind === kind);
  const phases = byKind("phase");
  const ungroupedRoadmap = visibleRecords.filter((record) => ["milestone", "deliverable"].includes(record.kind) && !record.parentId);

  async function mutate<T>(work: () => Promise<T>, success: string) {
    if (!canManage) { const error = new Error(permissionReason || "Project manage access required."); setStatus(error.message); throw error; }
    setBusy(true);
    setStatus("");
    try {
      const value = await work();
      await onReload();
      setStatus(success);
      return value;
    } catch (error) {
      setStatus(formatApiError(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveRecord(draft: ProjectControlDraft) {
    try {
      if (editing) {
        await mutate(() => api(`/api/projects/${project.id}/control-records/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...payloadForApi(draft), expectedRevision: editing.revision }) }), `${PROJECT_CONTROL_KIND_META[draft.kind].label} saved.`);
      } else {
        await mutate(() => api(`/api/projects/${project.id}/control-records`, { method: "POST", body: JSON.stringify(payloadForApi(draft)) }), `${PROJECT_CONTROL_KIND_META[draft.kind].label} created.`);
      }
      setEditing(null);
      setCreatingKind(null);
    } catch {
      // Status is already rendered with the structured API error.
    }
  }

  async function toggleDone(record: ProjectControlRecord) {
    const nextStatus = recordIsClosed(record) ? PROJECT_CONTROL_KIND_META[record.kind].defaultStatus : closedStatus(record.kind);
    await mutate(() => api(`/api/projects/${project.id}/control-records/${record.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, progress: recordIsClosed(record) ? Math.min(record.progress, 95) : 100, expectedRevision: record.revision }) }), `${record.title} ${recordIsClosed(record) ? "reopened" : "completed"}.`).catch(() => undefined);
  }

  async function archiveRecord(record: ProjectControlRecord) {
    if (!await confirmCluster({ title: "Archive control record?", message: `Archive ${PROJECT_CONTROL_KIND_META[record.kind].label.toLowerCase()} "${record.title}"?`, confirmLabel: "Archive record" })) return;
    await mutate(() => api(`/api/projects/${project.id}/control-records/${record.id}`, { method: "DELETE" }), `${record.title} archived.`).catch(() => undefined);
  }

  async function applyTemplate(replace = false) {
    if (replace && !await confirmCluster({ title: "Replace Project Control records?", message: "Existing records will be archived before the selected template is applied.", confirmLabel: "Replace records", tone: "danger" })) return;
    await mutate(() => api(`/api/projects/${project.id}/control-center/bootstrap`, { method: "POST", body: JSON.stringify({ template, replace }) }), `${humanize(template)} template applied.`).catch(() => undefined);
  }

  async function generateReport(publish = false) {
    await mutate(() => api(`/api/projects/${project.id}/status-reports/generate`, { method: "POST", body: JSON.stringify({ publish }) }), publish ? "Status report generated and published." : "Status report draft generated.").catch(() => undefined);
    setView("outcomes");
  }

  async function createRelationship(event: FormEvent) {
    event.preventDefault();
    if (!relationshipDraft.sourceId || !relationshipDraft.targetId || relationshipDraft.sourceId === relationshipDraft.targetId) return setStatus("Choose two different project records.");
    await mutate(() => api(`/api/projects/${project.id}/relationships`, { method: "POST", body: JSON.stringify({ sourceType: "control", sourceId: relationshipDraft.sourceId, targetType: relationshipDraft.targetType, targetId: relationshipDraft.targetId, relationship: relationshipDraft.relationship, description: relationshipDraft.description || null, critical: relationshipDraft.critical }) }), "Relationship added.").then(() => setRelationshipDraft({ sourceId: "", targetType: "control", targetId: "", relationship: "depends_on", critical: false, description: "" })).catch(() => undefined);
  }

  async function installAutomationTemplate(templateId: string) {
    const result = await mutate(() => api<{ ruleId: string }>(`/api/projects/${project.id}/automation-templates/${encodeURIComponent(templateId)}/apply`, { method: "POST", body: "{}" }), "Automation template installed.").catch(() => null);
    if (result) setAutomationRefresh((value) => value + 1);
  }

  async function runAutomation(record: ProjectControlRecord, dryRun: boolean) {
    const endpoint = dryRun ? `/api/projects/${project.id}/automations/${record.id}/test` : `/api/projects/${project.id}/control-records/${record.id}/run`;
    const result = await mutate(() => api<{ actions: Array<{ type: string; title: string }>; created: ProjectControlRecord[] }>(endpoint, { method: "POST", body: dryRun ? "{}" : JSON.stringify({ dryRun: false }) }), dryRun ? "Automation test generated." : "Automation executed.").catch(() => null);
    if (result && dryRun) setStatus(result.actions.length ? `Preview: ${result.actions.map((action) => `${humanize(action.type)} · ${action.title}`).join("; ")}` : "This rule has no configured actions.");
    if (result && !dryRun) setAutomationRefresh((value) => value + 1);
  }

  async function setAutomationGovernance(record: ProjectControlRecord, state: "draft" | "published") {
    const result = await mutate(() => api(`/api/projects/${project.id}/automations/${record.id}/governance`, { method: "POST", body: JSON.stringify({ state, expectedRevision: record.revision }) }), state === "published" ? "Automation published." : "Automation moved to draft.").catch(() => null);
    if (result) setAutomationRefresh((value) => value + 1);
  }

  async function toggleAutomationVersions(record: ProjectControlRecord) {
    if (expandedAutomationVersions === record.id) { setExpandedAutomationVersions(""); return; }
    setExpandedAutomationVersions(record.id);
    if (automationVersions[record.id]) return;
    try {
      const result = await api<{ versions: Array<{ id: string; createdAt: string; governanceVersion: number; governanceState: string; reason: string; changedKeys: string[]; checksum: string }> }>(`/api/projects/${project.id}/automations/${record.id}/versions`);
      setAutomationVersions((current) => ({ ...current, [record.id]: result.versions || [] }));
    } catch (error) { setStatus(formatApiError(error)); }
  }

  async function copyAutomation(record: ProjectControlRecord) {
    const targetProjectId = automationCopyTargets[record.id];
    if (!targetProjectId) { setStatus("Choose a target project before copying the automation."); return; }
    const result = await mutate(() => api<{ projectTypeChanged: boolean }>(`/api/projects/${project.id}/automations/${record.id}/copy`, { method: "POST", body: JSON.stringify({ targetProjectId, publish: false }) }), "Automation copied as a draft.").catch(() => null);
    if (result?.projectTypeChanged) setStatus("Automation copied as draft. The target uses a different Project Type, so review its conditions/actions before publishing.");
  }

  async function exportAutomationBundle() {
    try {
      const bundle = await api<Record<string, unknown>>(`/api/projects/${project.id}/automations/export`);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${project.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "project"}-automations.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("Automation bundle exported.");
    } catch (error) { setStatus(formatApiError(error)); }
  }

  async function importAutomationBundle(file: File | null) {
    if (!file) return;
    setBusy(true); setStatus("");
    try {
      const bundle = JSON.parse(await file.text());
      const result = await api<{ imported: number }>(`/api/projects/${project.id}/automations/import`, { method: "POST", body: JSON.stringify({ bundle, publish: false }) });
      setStatus(`${result.imported} automation rule${result.imported === 1 ? "" : "s"} imported as draft.`);
      setAutomationRefresh((value) => value + 1);
      await onReload();
    } catch (error) { setStatus(formatApiError(error)); } finally { setBusy(false); }
  }

  async function materialize(record: ProjectControlRecord, target: "ticket" | "timeline") {
    const destination = target === "ticket" ? projectTicketDestinationIds(ticketDestination) : null;
    if (target === "ticket" && !destination) { setStatus("Choose a Ticket destination Board/List above before creating follow-up work."); return; }
    await mutate(() => api(`/api/projects/${project.id}/control-records/${record.id}/materialize`, { method: "POST", body: JSON.stringify({ target, attach: true, ...(destination || {}) }) }), `${record.title} connected to ${target === "ticket" ? "Tickets" : "Timeline"}.`).catch(() => undefined);
  }
  async function syncTimeline() { await mutate(() => api(`/api/projects/${project.id}/control-center/sync-timeline`, { method: "POST", body: "{}" }), "Roadmap synced to Timeline.").catch(() => undefined); }
  async function reconcileLinks() { await mutate(() => api(`/api/projects/${project.id}/control-center/reconcile`, { method: "POST", body: "{}" }), "Linked records reconciled.").catch(() => undefined); }
  async function moveRoadmap(record: ProjectControlRecord, direction: -1 | 1) { const siblings = visibleRecords.filter((item) => item.kind === record.kind && item.parentId === record.parentId).sort((a, b) => a.sortOrder - b.sortOrder); const index = siblings.findIndex((item) => item.id === record.id); const next = index + direction; if (next < 0 || next >= siblings.length) return; [siblings[index], siblings[next]] = [siblings[next], siblings[index]]; await mutate(() => api(`/api/projects/${project.id}/control-center/reorder`, { method: "POST", body: JSON.stringify({ orderedIds: siblings.map((item) => item.id), parentId: record.parentId || null }) }), "Roadmap order updated.").catch(() => undefined); }

  function renderCards(items: ProjectControlRecord[], emptyTitle: string, emptyDescription: string, initialKind: ProjectControlKind) {
    if (!items.length) return <ProjectEmptyState title={emptyTitle} description={emptyDescription} action={canManage ? <ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind(initialKind)} variant="secondary" size="compact">Add {PROJECT_CONTROL_KIND_META[initialKind].label.toLowerCase()}</ClusterButton> : undefined} />;
    return <div className="project-control-card-grid-v313">{items.map((record) => <ProjectControlRecordCard key={record.id} record={record} users={users} childCount={childrenByParent.get(record.id) || 0} selected={selectedRecordId === record.id} onSelect={() => controlDetailHistory.openDetail(record.id)} onEdit={canManage ? () => setEditing(record) : undefined} onToggleDone={canManage ? () => void toggleDone(record) : undefined} onDelete={canManage ? () => void archiveRecord(record) : undefined} onMaterialize={canManage ? (target) => void materialize(record, target) : undefined} />)}</div>;
  }

  const editor = canManage && (editing || creatingKind) ? <ProjectControlRecordEditor record={editing} initialKind={creatingKind || editing?.kind || "deliverable"} records={records} users={users} currentUser={currentUser} linkCandidates={data?.linkCandidates || []} busy={busy} onCancel={() => { setEditing(null); setCreatingKind(null); }} onSave={saveRecord} /> : null;

  return (
    <section className={`project-subpage-v312 project-control-center-v313 ${canManage ? "" : "project-control-readonly-v316"}`}>
      <ProjectSectionHeader
        eyebrow="Project control center"
        title="Delivery management"
        description="Coordinate roadmap, deliverables, outcomes, RAID, staffing responsibility, reporting, automation, and closeout from one project-owned system."
        metrics={summary ? [
          { label: "Health", value: `${summary.health.overall}%`, detail: summary.health.overall >= 80 ? "healthy" : summary.health.overall >= 60 ? "attention" : "at risk", tone: healthTone(summary.health.overall) },
          { label: "Deliverables", value: `${summary.counts.completedDeliverables}/${summary.counts.deliverables}`, detail: `${summary.progress.deliverables}% complete`, tone: "accent" },
          { label: "Attention", value: summary.attention.length, detail: `${summary.counts.overdue} overdue`, tone: summary.attention.length ? "warning" : "good" },
          { label: "Dependencies", value: summary.counts.relationships, detail: `${summary.counts.criticalDependencies} critical`, tone: summary.counts.criticalDependencies ? "warning" : "neutral" },
        ] : undefined}
        actions={canManage ? <><ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("deliverable")} variant="secondary">Add record</ClusterButton><ClusterButton type="button" className="" onClick={() => void generateReport(false)} variant="primary">Generate report</ClusterButton><ClusterActionMenu label="More project control actions" items={resolveClusterResourceActions({ kind: "project", id: project.id }, [{ id: "reconcile", resourceKinds: ["project"] as const, allowed: () => canManage, label: "Reconcile linked records", description: "Refresh Project Control links against their source records.", available: () => !busy, unavailableReason: "A Project Control operation is in progress", onSelect: () => reconcileLinks() }])} /></> : <span className="project-permission-badge-v316">Read only</span>}
      />
      {canManage ? <ProjectTicketDestinationPicker project={project} value={ticketDestination} onChange={setTicketDestination} /> : null}
      <ProjectSectionStatus tone={status.toLowerCase().includes("failed") || status.toLowerCase().includes("could not") ? "danger" : "neutral"}>{status || (!canManage ? permissionReason : "")}</ProjectSectionStatus>
      {selectedRecord ? <ProjectSurface title={selectedRecord.title} description={`${PROJECT_CONTROL_KIND_META[selectedRecord.kind].label} · ${selectedRecord.status.replace(/_/g, " ")}`} action={<div className="button-row"><ClusterButton type="button" className="" onClick={() => controlDetailHistory.closeDetail()} variant="quiet" size="compact">Close inspector</ClusterButton>{canManage ? <ClusterButton type="button" className="" onClick={() => setEditing(selectedRecord)} variant="quiet" size="compact">Edit</ClusterButton> : null}</div>}><dl className="project-control-selected-detail-v491"><div><dt>Owner</dt><dd>{users.find((user) => user.id === selectedRecord.ownerId)?.displayName || users.find((user) => user.id === selectedRecord.ownerId)?.username || "Unassigned"}</dd></div><div><dt>Priority</dt><dd>{selectedRecord.priority}</dd></div><div><dt>Due</dt><dd>{selectedRecord.dueDate ? controlDateLabel(selectedRecord.dueDate) : "No due date"}</dd></div><div><dt>Progress</dt><dd>{recordIsClosed(selectedRecord) ? 100 : selectedRecord.progress || 0}%</dd></div></dl>{selectedRecord.description ? <p className="muted">{selectedRecord.description}</p> : null}<WorkActionMenu context={{ source: { kind: "control", id: selectedRecord.id, projectId: project.id, label: selectedRecord.title }, navigation: { screen: "project", projectId: project.id, projectTab: "control", inspectScope: "project-control", inspectId: selectedRecord.id }, projectId: project.id, assigneeId: selectedRecord.ownerId || null, dueDate: selectedRecord.dueDate || null }} label={`${selectedRecord.title} work actions`} /><LinkedWorkPanel projectId={project.id} kind="control" entityId={selectedRecord.id} compact /></ProjectSurface> : null}
      {editor}
      <ProjectSegmentedControl items={VIEW_ITEMS} activeId={view} onChange={setView} label="Project control views" />
      {savedViews.length ? <div className="project-saved-view-strip-v315"><ClusterButton unstyled type="button" className={!activeSavedViewId ? "active" : ""} onClick={() => setActiveSavedViewId("")}>All records</ClusterButton>{savedViews.map((item) => <ClusterButton unstyled type="button" key={item.id} className={activeSavedViewId === item.id ? "active" : ""} onClick={() => setActiveSavedViewId(item.id)}>{item.title}<span>{records.filter((record) => record.kind !== "saved_view" && recordMatchesSavedView(record, item)).length}</span></ClusterButton>)}</div> : null}

      {loading && !data ? <LoadingState label="Loading project control data" rows={6} compact className="project-control-loading-v313" /> : null}
      {!loading && !records.length && canManage ? <ProjectSurface title="Start with a production template" description="Create a complete starter hierarchy with phases, milestones, deliverables, goals, onboarding, responsibility, a baseline, and a safe automation rule." tone="accent"><div className="project-control-template-v313"><ClusterNativeSelect disabled={!canManage} value={template} onChange={(event) => setTemplate(event.target.value as typeof template)}><option value="game-production">Game production</option><option value="software">Software delivery</option><option value="content">Content production</option><option value="client-delivery">Client delivery</option></ClusterNativeSelect><ClusterButton type="button" className="" disabled={busy} onClick={() => void applyTemplate(false)} variant="primary">Build control center</ClusterButton><span>Nothing is hard-coded to the template after creation. Every record remains editable.</span></div></ProjectSurface> : null}

      {view === "pulse" && summary ? <div className="project-control-pulse-v313">
        <section className="project-control-health-grid-v313" aria-label="Project health dimensions">{Object.entries(summary.health).map(([key, value]) => <article key={key} className={healthTone(value)}><div><span>{key}</span><strong>{value}%</strong></div><div><i style={runtimeStyle({ width: `${value}%` })} /></div></article>)}</section>
        <div className="project-control-two-col-v313">
          <ProjectSurface title="Attention inbox" description="The highest-impact overdue, blocked, risky, unowned, and decision-bound records." action={<ClusterButton type="button" className="" onClick={() => setView("raid")} variant="quiet" size="compact">Open RAID</ClusterButton>}>
            {summary.attention.length ? <div className="project-control-attention-v313">{summary.attention.slice(0, 12).map((item) => { const record = recordsById.get(item.recordId); return <ClusterButton unstyled type="button" key={item.id} className={item.tone} onClick={() => record && controlDetailHistory.openDetail(record.id)}><span>{item.reason}</span><strong>{item.title}</strong><small>{PROJECT_CONTROL_KIND_META[item.kind].label}{item.dueDate ? ` · ${controlDateLabel(item.dueDate)}` : ""}</small></ClusterButton>; })}</div> : <ProjectEmptyState title="No urgent project-control items" description="Dates, owners, delivery status, and recorded risks are currently clean." />}
          </ProjectSurface>
          <ProjectSurface title="Progress and readiness" description="Outcome progress is calculated from project-owned records, not a manually invented percentage."><div className="project-control-progress-stack-v313"><article><span>Deliverables</span><strong>{summary.progress.deliverables}%</strong><i><b style={runtimeStyle({ width: `${summary.progress.deliverables}%` })} /></i></article><article><span>Goals</span><strong>{summary.progress.goals}%</strong><i><b style={runtimeStyle({ width: `${summary.progress.goals}%` })} /></i></article><article><span>Onboarding</span><strong>{summary.progress.onboarding}%</strong><i><b style={runtimeStyle({ width: `${summary.progress.onboarding}%` })} /></i></article></div></ProjectSurface>
        </div>
        <ProjectSurface title="Control coverage" description="Missing control areas are visible before they become release-week archaeology."><div className="project-control-coverage-v313">{[
          ["Phases", summary.counts.phases, "phase"], ["Milestones", summary.counts.milestones, "milestone"], ["Deliverables", summary.counts.deliverables, "deliverable"], ["Goals", summary.counts.goals, "goal"], ["Risks", byKind("risk").length, "risk"], ["Decisions", byKind("decision").length, "decision"], ["Responsibilities", byKind("responsibility").length, "responsibility"], ["Onboarding", summary.counts.onboarding, "onboarding"], ["Reports", byKind("status_report").length, "status_report"], ["Automations", byKind("automation").length, "automation"],
        ].map(([label, count, kind]) => <ClusterButton unstyled type="button" key={String(label)} className={Number(count) ? "ready" : "missing"} onClick={() => Number(count) ? setView(PROJECT_CONTROL_KIND_META[kind as ProjectControlKind].group === "roadmap" ? "roadmap" : PROJECT_CONTROL_KIND_META[kind as ProjectControlKind].group === "raid" ? "raid" : PROJECT_CONTROL_KIND_META[kind as ProjectControlKind].group === "team" ? "team" : PROJECT_CONTROL_KIND_META[kind as ProjectControlKind].group === "outcomes" ? "outcomes" : "system") : setCreatingKind(kind as ProjectControlKind)}><span>{label}</span><strong>{count}</strong><em>{Number(count) ? "configured" : "add"}</em></ClusterButton>)}</div></ProjectSurface>
      </div> : null}

      {view === "roadmap" ? <div className="project-control-roadmap-v313">
        <ProjectSurface title="Phases, milestones, and deliverables" description="The delivery hierarchy connects high-level phases to the work products and checkpoints that prove completion." action={<div className="project-control-inline-actions-v313"><ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("phase")} variant="quiet" size="compact">Add phase</ClusterButton><ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("milestone")} variant="quiet" size="compact">Add milestone</ClusterButton><ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("deliverable")} variant="quiet" size="compact">Add deliverable</ClusterButton></div>}>
          <ProjectRoadmapWorkbench records={visibleRecords} relationships={relationships} busy={busy} canManage={canManage} onMove={(record, direction) => void moveRoadmap(record, direction)} onMaterialize={(record, target) => void materialize(record, target)} onSyncTimeline={() => void syncTimeline()} />
          {phases.length ? <div className="project-control-phase-grid-v313">{phases.map((phase) => { const children = records.filter((record) => record.parentId === phase.id); return <section key={phase.id} className="project-control-phase-v313"><ProjectControlRecordCard record={phase} users={users} childCount={children.length} selected={selectedRecordId === phase.id} onSelect={() => controlDetailHistory.openDetail(phase.id)} onEdit={canManage ? () => setEditing(phase) : undefined} onToggleDone={canManage ? () => void toggleDone(phase) : undefined} onDelete={canManage ? () => void archiveRecord(phase) : undefined} onMaterialize={canManage ? (target) => void materialize(phase, target) : undefined} /><div className="project-control-phase-children-v313">{children.length ? children.map((record) => <ProjectControlRecordCard key={record.id} record={record} users={users} selected={selectedRecordId === record.id} onSelect={() => controlDetailHistory.openDetail(record.id)} onEdit={canManage ? () => setEditing(record) : undefined} onToggleDone={canManage ? () => void toggleDone(record) : undefined} onDelete={canManage ? () => void archiveRecord(record) : undefined} onMaterialize={canManage ? (target) => void materialize(record, target) : undefined} />) : <ClusterButton unstyled type="button" className="project-control-add-child-v313" disabled={!canManage} onClick={() => setCreatingKind("deliverable")}>+ Add milestone or deliverable</ClusterButton>}</div></section>; })}</div> : <ProjectEmptyState title="No delivery phases" description="Add phases manually or apply a production template to create a useful first roadmap." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("phase")} variant="secondary" size="compact">Add phase</ClusterButton>} />}
          {ungroupedRoadmap.length ? <div className="project-control-ungrouped-v313"><h4>Unassigned roadmap records</h4>{renderCards(ungroupedRoadmap, "", "", "deliverable")}</div> : null}
        </ProjectSurface>
        <ProjectSurface title="Dependency and relationship map" description="Connect control records to show blocking, delivery, validation, approval, and implementation relationships.">
          <form className="project-control-relationship-form-v313" onSubmit={createRelationship}><fieldset disabled={!canManage}><ClusterNativeSelect value={relationshipDraft.sourceId} onChange={(event) => setRelationshipDraft((draft) => ({ ...draft, sourceId: event.target.value }))}><option value="">Source record</option>{records.map((record) => <option key={record.id} value={record.id}>{PROJECT_CONTROL_KIND_META[record.kind].label}: {record.title}</option>)}</ClusterNativeSelect><ClusterNativeSelect value={relationshipDraft.relationship} onChange={(event) => setRelationshipDraft((draft) => ({ ...draft, relationship: event.target.value }))}><option value="depends_on">depends on</option><option value="blocks">blocks</option><option value="delivers">delivers</option><option value="validates">validates</option><option value="implements">implements</option><option value="approves">approves</option><option value="informs">informs</option><option value="supersedes">supersedes</option><option value="relates_to">relates to</option></ClusterNativeSelect><ClusterNativeSelect value={relationshipDraft.targetType} onChange={(event) => setRelationshipDraft((draft) => ({ ...draft, targetType: event.target.value as "control" | "project", targetId: "" }))}><option value="control">Project record</option><option value="project">Another project</option></ClusterNativeSelect><ClusterNativeSelect value={relationshipDraft.targetId} onChange={(event) => setRelationshipDraft((draft) => ({ ...draft, targetId: event.target.value }))}><option value="">{relationshipDraft.targetType === "project" ? "Target project" : "Target record"}</option>{relationshipDraft.targetType === "project" ? projects.filter((item) => item.id !== project.id && !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : records.map((record) => <option key={record.id} value={record.id}>{PROJECT_CONTROL_KIND_META[record.kind].label}: {record.title}</option>)}</ClusterNativeSelect><label><ClusterInput type="checkbox" checked={relationshipDraft.critical} onChange={(event) => setRelationshipDraft((draft) => ({ ...draft, critical: event.target.checked }))} /> Critical</label><ClusterButton type="submit" className="" variant="secondary" size="compact">Add relationship</ClusterButton></fieldset></form>
          {relationships.length ? <div className="project-control-relationships-v313">{relationships.map((relationship) => <article key={relationship.id} className={relationship.critical ? "critical" : ""}><span>{recordsById.get(relationship.sourceId)?.title || relationship.sourceId}</span><strong>{humanize(relationship.relationship)}</strong><span>{recordsById.get(relationship.targetId)?.title || projects.find((item) => item.id === relationship.targetId)?.name || relationship.targetId}</span>{relationship.critical ? <em>Critical</em> : null}{canManage ? <ClusterButton type="button" className="" onClick={() => void mutate(() => api(`/api/projects/${project.id}/relationships/${relationship.id}`, { method: "DELETE" }), "Relationship removed.").catch(() => undefined)} variant="danger" size="compact">Remove</ClusterButton> : null}</article>)}</div> : <ProjectEmptyState title="No dependencies mapped" description="Add relationships between milestones, deliverables, goals, risks, and decisions to expose the critical path." />}
        </ProjectSurface>
      </div> : null}

      {view === "raid" ? <div className="project-control-raid-v313"><ProjectSurface title="Workflow graph" description="Explore the canonical Project relationship neighborhood across project work, dependencies, references, delivery links, and control records."><ProjectWorkflowGraphPanel project={project} projects={projects} records={records} /></ProjectSurface>{(["risk", "issue", "assumption", "decision", "dependency", "change_request"] as ProjectControlKind[]).map((kind) => <ProjectSurface key={kind} title={PROJECT_CONTROL_KIND_META[kind].plural} description={RAID_DESCRIPTIONS[kind]} action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind(kind)} variant="quiet" size="compact">Add</ClusterButton>}>{renderCards(byKind(kind), `No ${PROJECT_CONTROL_KIND_META[kind].plural.toLowerCase()}`, `Add the first ${PROJECT_CONTROL_KIND_META[kind].label.toLowerCase()} when the project needs it.`, kind)}</ProjectSurface>)}</div> : null}

      {view === "outcomes" ? <div className="project-control-outcomes-v313">
        <ProjectSurface title="Goals and success criteria" description="Track outcomes separately from work completion so delivery progress and project results remain independently measurable." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("goal")} variant="quiet" size="compact">Add goal</ClusterButton>}>{renderCards(byKind("goal"), "No measurable goals", "Add objectives with target values, confidence, ownership, and dates.", "goal")}</ProjectSurface>
        <ProjectSurface title="Approved baselines" description="Capture original scope, schedule, staffing, and delivery commitments before later changes rewrite history." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("baseline")} variant="quiet" size="compact">Capture baseline</ClusterButton>}>{renderCards(byKind("baseline"), "No baselines", "Capture the approved starting point so later changes remain visible.", "baseline")}</ProjectSurface>
        <ProjectSurface title="Status reports" description="Generate editable reports from real project records, risks, decisions, goals, and delivery state." action={<div className="project-control-inline-actions-v313"><ClusterButton type="button" className="" disabled={!canManage} onClick={() => void generateReport(false)} variant="quiet" size="compact">Generate draft</ClusterButton><ClusterButton type="button" className="" disabled={!canManage} onClick={() => void generateReport(true)} variant="quiet" size="compact">Generate + publish</ClusterButton></div>}>
          {byKind("status_report").length ? <ProjectReportWorkbench projectId={project.id} reports={byKind("status_report")} canManage={canManage} onEdit={setEditing} onArchive={(report) => void archiveRecord(report)} /> : <ProjectEmptyState title="No status reports" description="Generate the first draft from current project data, then edit or publish it." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => void generateReport(false)} variant="secondary" size="compact">Generate report</ClusterButton>} />}
        </ProjectSurface>
        <ProjectSurface title="Budget and cost controls" description="Planned, actual, forecast, ownership, category, and variance at project level." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("budget")} variant="quiet" size="compact">Add budget</ClusterButton>}><ProjectBudgetSummary records={visibleRecords} />{renderCards(byKind("budget"), "Budget tracking disabled", "Add a budget record only for projects that need financial controls.", "budget")}</ProjectSurface>
      </div> : null}

      {view === "team" ? <div className="project-control-team-v313">
        <ProjectSurface title="Workload" description="Owner load, due-soon pressure, overdue work, and unowned control records."><ProjectTeamCapacitySummary records={visibleRecords} users={users} /></ProjectSurface>
        <ProjectSurface title="Responsibility matrix" description="Assign responsibility, accountability, consultation, and information roles to major outcomes." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("responsibility")} variant="quiet" size="compact">Add responsibility</ClusterButton>}>{byKind("responsibility").length ? <div className="project-control-raci-v313">{byKind("responsibility").map((record) => { const owner = users.find((user) => user.id === record.ownerId); return <article key={record.id}><span className={`raci-${record.payload.raci || "responsible"}`}>{String(record.payload.raci || "responsible").slice(0, 1).toUpperCase()}</span><div><strong>{record.title}</strong><small>{owner?.displayName || owner?.username || "Unassigned"} · {record.payload.raci || "responsible"}</small></div><ClusterButton type="button" className="" disabled={!canManage} onClick={() => setEditing(record)} variant="quiet" size="compact">Edit</ClusterButton></article>; })}</div> : <ProjectEmptyState title="No responsibility matrix" description="Clarify who is responsible, accountable, consulted, and informed for major deliverables." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("responsibility")} variant="secondary" size="compact">Add responsibility</ClusterButton>} />}</ProjectSurface>
        <ProjectSurface title="Project onboarding" description="Give new members a visible checklist for access, tools, conventions, required reading, and first work." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("onboarding")} variant="quiet" size="compact">Add onboarding item</ClusterButton>}>{renderCards(byKind("onboarding"), "No onboarding checklist", "Add required access, reading, setup, communication, and first-work steps.", "onboarding")}</ProjectSurface>
      </div> : null}

      {view === "system" ? <div className="project-control-system-v313">
        <ProjectSurface title="Project automation" description="Run bounded project-scoped rules with compound conditions, branching, durable delays, Project-Type templates, draft/publish governance, portable bundles, dry-run explanations, and observable retries." action={<div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant="quiet" disabled={!canManage || busy} onClick={() => void exportAutomationBundle()}>Export</ClusterButton><ClusterFileButton label="Import automation bundle" accept="application/json,.json" size="compact" variant="quiet" disabled={!canManage || busy} onChange={(event) => void importAutomationBundle(event.currentTarget.files?.[0] || null)}>Import</ClusterFileButton><ClusterButton size="compact" variant="secondary" disabled={!canManage} onClick={() => setCreatingKind("automation")}>Add automation</ClusterButton></div>}>
          {automationTemplates.length ? <div className="video-template-actions-v495"><span>Type-aware templates</span>{automationTemplates.map((templateItem) => <ClusterButton size="compact" variant="secondary" key={templateItem.id} disabled={!canManage || busy} title={templateItem.description} onClick={() => void installAutomationTemplate(templateItem.id)}>{templateItem.title}</ClusterButton>)}</div> : null}
          {studioAutomationGovernance ? <ProjectSectionStatus tone={studioAutomationGovernance.failing || studioAutomationGovernance.paused ? "warning" : "neutral"}>Studio automation governance: {studioAutomationGovernance.published} published · {studioAutomationGovernance.drafts} drafts · {studioAutomationGovernance.paused} paused/disabled · {studioAutomationGovernance.failing} failing · {studioAutomationGovernance.unowned} unowned</ProjectSectionStatus> : null}
          {byKind("automation").length ? <div className="project-control-automation-list-v313">{byKind("automation").map((record) => { const governanceState = String(record.payload.governance?.state || (record.status === "draft" ? "draft" : "published")); const versions = automationVersions[record.id] || []; const copyTarget = automationCopyTargets[record.id] || ""; return <article key={record.id}><div><span>{record.payload.trigger || "manual"} · {governanceState}</span><h4>{record.title}</h4><p>{record.description || "No description."}</p><small>{record.payload.enabled === false ? "Disabled" : record.status === "paused" ? "Paused after failures" : governanceState === "draft" ? "Draft · event execution blocked" : "Published listener active"}{record.payload.lastRunAt ? ` · Last ${controlDateLabel(record.payload.lastRunAt)}` : ""}</small></div><footer><ClusterButton size="compact" variant="quiet" disabled={!canManage} onClick={() => void runAutomation(record, true)}>Test</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!canManage || governanceState === "draft"} onClick={() => void runAutomation(record, false)}>Run now</ClusterButton>{governanceState === "draft" ? <ClusterButton size="compact" variant="secondary" disabled={!canManage} onClick={() => void setAutomationGovernance(record, "published")}>Publish</ClusterButton> : <ClusterButton size="compact" variant="quiet" disabled={!canManage} onClick={() => void setAutomationGovernance(record, "draft")}>Move to draft</ClusterButton>}<ClusterButton size="compact" variant="quiet" disabled={!canManage} onClick={() => void toggleAutomationVersions(record)}>Versions</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!canManage} onClick={() => setEditing(record)}>Edit</ClusterButton></footer>{canManage && projects.some((item) => item.id !== project.id && !item.archived) ? <div className="project-control-action-options-v494"><label className="wide"><span>Copy as draft</span><ClusterSelect ariaLabel={`Copy ${record.title} to project`} value={copyTarget} onChange={(value) => setAutomationCopyTargets((current) => ({ ...current, [record.id]: value }))} placeholder="Choose target project" options={projects.filter((item) => item.id !== project.id && !item.archived).map((item) => ({ value: item.id, label: item.name }))} /></label><ClusterButton size="compact" variant="secondary" disabled={!copyTarget || busy} onClick={() => void copyAutomation(record)}>Copy</ClusterButton></div> : null}{expandedAutomationVersions === record.id ? <div className="project-traceability-edges-v386"><strong>Version history</strong>{versions.length ? versions.slice(0, 12).map((version) => <span key={version.id}>v{version.governanceVersion || "draft"} · {version.governanceState} · {version.reason.replace(/_/g, " ")} · {version.changedKeys.length ? version.changedKeys.join(", ") : "initial snapshot"} · {new Date(version.createdAt).toLocaleString()}</span>) : <span>No version snapshots recorded yet. The next governance change will create one.</span>}</div> : null}</article>; })}</div> : <ProjectEmptyState title="No project automations" description="Add scoped rules for overdue work, risks, approvals, QA decisions, and delivery changes." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("automation")} variant="secondary" size="compact">Add automation</ClusterButton>} />}
          <ProjectAutomationHistory projectId={project.id} users={users} refreshKey={automationRefresh} canRetry={canManage} />
        </ProjectSurface>
        <ProjectSurface title="Reusable Board & Whiteboard structures" description="Capture project-owned working structures and create clean copies later without cloning assignments, external links, or production-object references."><ProjectStructureTemplates project={project} canManage={canManage} onCreated={onReloadProjectResources} /></ProjectSurface>
        <ProjectSurface title="Saved project views" description="Persist useful project-level filters and operating views for the team." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("saved_view")} variant="quiet" size="compact">Add saved view</ClusterButton>}>{renderCards(byKind("saved_view"), "No saved views", "Create shared views such as launch blockers, due this week, missing owners, or unverified release assets.", "saved_view")}</ProjectSurface>
        <ProjectSurface title="Closeout readiness" description="Track final delivery, QA approval, repository and channel archival, backups, access removal, postmortem, and lessons learned." action={<ClusterButton type="button" className="" disabled={!canManage} onClick={() => setCreatingKind("closeout")} variant="quiet" size="compact">Add closeout item</ClusterButton>}>{renderCards(byKind("closeout"), "No closeout checklist", "Build the closeout checklist before final delivery so archival, backup, access, and review work can be completed on schedule.", "closeout")}</ProjectSurface>
        {records.length ? <ProjectSurface title="Rebuild from template" description="Archive current Project Control records and rebuild the starter hierarchy. Existing Boards, files, tickets, Builds, and other project tools are untouched." tone="danger"><div className="project-control-template-v313"><ClusterNativeSelect disabled={!canManage} value={template} onChange={(event) => setTemplate(event.target.value as typeof template)}><option value="game-production">Game production</option><option value="software">Software delivery</option><option value="content">Content production</option><option value="client-delivery">Client delivery</option></ClusterNativeSelect><ClusterButton type="button" className="" disabled={busy || !canManage} onClick={() => void applyTemplate(true)} variant="danger">Replace controls</ClusterButton></div></ProjectSurface> : null}
      </div> : null}
    </section>
  );
}

import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, formatApiError } from "../../core/api";
import type { Project, User } from "../application/application-models";
import { ProjectSectionHeader, ProjectSectionStatus, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import "./project-quality.css";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";

type IntelligenceNode = {
  id: string;
  kind: string;
  entityId: string;
  section?: string;
  title: string;
  status: string;
  version?: string | null;
  commit?: string | null;
  platform?: string | null;
  priority?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
  updatedAt?: string | null;
};


type DeliveryPipelineSnapshot = {
  typeId: string; typeLabel: string; configured: number; stageCount: number; overdue: number; blocked: number; linkedDependencies: number; confidence: "high" | "medium" | "low"; dependencyDelayDays?: number; dependencyConstraints?: Array<{ id: string; name: string; status: string; targetDate?: string | null; constrainsStart: boolean }>; forecastReasons: string[];
  deliveryReady?: boolean; deliveryRecommendedAction?: string | null;
  projectTypeGatePolicy?: { requiredGateIds: string[]; optionalGateIds: string[]; channels?: string[] }; activeGatePolicy?: { source?: string; channel?: string; requiredGateIds?: string[]; optionalGateIds?: string[] } | null;
  deliveryGates?: Array<{ id: string; label: string; required: boolean; state: string; passed: boolean; detail: string }>;
  schedulerSuggestions?: Array<{ stage: string; label: string; ownerId: string; startsAt: string; endsAt: string; reason: string }>;
  stages: Array<{ stage: string; label: string; recordId?: string | null; status: string; progress: number; ownerId?: string | null; ownerDepartments: string[]; startDate: string; dueDate: string; forecastStart: string; forecastFinish: string; slipDays: number; scheduleBlocks: number; schedulerSuggestion?: { ownerId: string; startsAt: string; endsAt: string; reason: string } | null; deliveryGate?: { id: string; state: string; detail: string; target?: unknown } | null }>;
};

type IntelligenceEdge = {
  id: string;
  relationshipId?: string;
  from: string;
  to: string;
  relationship: string;
  authority?: "explicit" | "inferred";
  critical?: boolean;
  description?: string | null;
};

export type ProjectIntelligenceSnapshot = {
  project: { id: string; name: string; status: string; projectType: string; updatedAt: string; targetDate?: string | null };
  generatedAt: string;
  score: number;
  readiness?: { factors: Array<{ id: string; label: string; score: number; maximum: number; explanation: string; state: "good" | "warning" | "danger"; affected: string[] }>; signals?: Array<{ id: string; label: string; severity: "warning" | "danger"; explanation: string; affected: string[] }> };
  dependencies?: {
    edgeCount: number; openEdgeCount: number; criticalEdgeCount: number; hasCycles: boolean;
    cycles: Array<{ nodeIds: string[]; nodes: Array<{ id: string; title: string; kind: string; status: string }> }>;
    criticalPath: { nodeIds: string[]; edgeIds: string[]; weight: number; cyclic: boolean; nodes: Array<{ id: string; title: string; kind: string; status: string; priority?: string | null; dueDate?: string | null }> };
    crossProject: Array<{ id: string; relationship: string; critical: boolean; sourceProjectId: string; targetProjectId: string; description?: string | null }>;
    openDependencies: Array<{ id: string; relationshipId: string; relationship: string; critical: boolean; prerequisiteNode: { id: string; title: string; status: string }; dependentNode: { id: string; title: string; status: string } }>;
  };
  workspace: Array<{ id: string; group: string; label: string; count: number; ready: boolean }>;
  counts: {
    boards?: number; cards?: number; openCards?: number; whiteboards?: number;
    builds: number; qaPlans: number; qaSessions: number; releases: number; controlRecords: number; blockers: number;
    releaseReadyBuilds: number; unlinkedBuilds: number; unlinkedQa: number; timelineItems: number; projectAutomations: number;
    calendarEvents?: number; scheduleBlocks?: number; libraryItems?: number; files?: number; referencedUsers?: number;
  };
  delivery: { stage: string; blockers: Array<{ id: string; nodeId?: string; kind: string; title: string; status: string; priority: string; dueDate?: string | null }>; unlinkedBuildIds: string[]; unlinkedQaIds: string[]; readiness?: { required: number; passed: number; blocked: number; channel: string; canPublish: boolean; gates: Array<{ id: string; label: string; required: boolean; passed: boolean; detail: string }> } | null; recommendedAction?: string | null; orchestration?: { conflicts: unknown[]; calendarEvents: unknown[] } | null; history?: { averageQaHours?: number | null; averageReleaseHours?: number | null } | null };
  traceability: { nodes: IntelligenceNode[]; edges: IntelligenceEdge[] };
  activity?: Array<{ id: string; type: string; entityType: string; entityId?: string | null; title: string; message?: string | null; createdAt: string; user?: { id: string; username?: string | null; displayName?: string | null; avatarUrl?: string | null } | null }>;
};

function stageLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function kindLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProjectIntelligencePanel({ project, projects = [], users = [], snapshot, loading, canManage = false, onRefresh, onOpenSection }: { project: Project; projects?: Project[]; users?: User[]; snapshot: ProjectIntelligenceSnapshot | null; loading: boolean; canManage?: boolean; onRefresh: () => Promise<void>; onOpenSection: (section: string) => void }) {
  const linkedNodeIds = useMemo(() => new Set((snapshot?.traceability.edges || []).flatMap((edge) => [edge.from, edge.to])), [snapshot]);
  const traceRows = snapshot?.traceability.nodes || [];
  const explicitEdges = (snapshot?.traceability.edges || []).filter((edge) => edge.authority !== "inferred");
  const inferredEdges = (snapshot?.traceability.edges || []).filter((edge) => edge.authority === "inferred");
  const deliveryTone: "danger" | "good" | "warning" = ["blocked", "qa_attention", "gates_blocked", "release_hold"].includes(snapshot?.delivery.stage || "") ? "danger" : snapshot?.delivery.stage === "release_ready" ? "good" : "warning";
  const [pipeline, setPipeline] = useState<DeliveryPipelineSnapshot | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState("");
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [dependencyBusy, setDependencyBusy] = useState(false);
  const [dependencyStatus, setDependencyStatus] = useState("");
  const [schedulerConflicts, setSchedulerConflicts] = useState<Record<string, Array<{ id: string; title: string; startsAt: string; endsAt: string }>>>({});
  const [dependencyDraft, setDependencyDraft] = useState({ targetProjectId: "", relationship: "depends_on", ownerId: "", dueDate: "", critical: false });
  useEffect(() => {
    let active = true;
    api<DeliveryPipelineSnapshot>(`/api/projects/${project.id}/intelligence/pipeline`).then((result) => { if (active) setPipeline(result); }).catch(() => { if (active) setPipeline(null); });
    return () => { active = false; };
  }, [project.id, snapshot?.generatedAt]);
  async function ensureDeliveryPipeline() {
    setPipelineBusy(true); setPipelineStatus("");
    try {
      const result = await api<{ pipeline: DeliveryPipelineSnapshot }>(`/api/projects/${project.id}/intelligence/pipeline/ensure`, { method: "POST", body: "{}" });
      setPipeline(result.pipeline); setPipelineStatus("Delivery pipeline synchronized with Project Control and dependency links."); await onRefresh();
    } catch (error) { setPipelineStatus(formatApiError(error)); } finally { setPipelineBusy(false); }
  }
  async function reconcileDeliveryPipeline() {
    setPipelineBusy(true); setPipelineStatus("");
    try {
      const result = await api<{ activated: number; pipeline: DeliveryPipelineSnapshot }>(`/api/projects/${project.id}/intelligence/pipeline/reconcile`, { method: "POST", body: "{}" });
      setPipeline(result.pipeline); setPipelineStatus(result.activated ? `${result.activated} delivery stage${result.activated === 1 ? "" : "s"} activated after prerequisites cleared.` : "Pipeline already matches its prerequisite state."); await onRefresh();
    } catch (error) { setPipelineStatus(formatApiError(error)); } finally { setPipelineBusy(false); }
  }
  async function applyProjectTypeGatePolicy() {
    setPipelineBusy(true); setPipelineStatus("");
    try {
      const result = await api<{ pipeline: DeliveryPipelineSnapshot }>(`/api/projects/${project.id}/intelligence/pipeline/gate-policy/apply`, { method: "POST", body: JSON.stringify({ channel: "release" }) });
      setPipeline(result.pipeline); setPipelineStatus("Project-Type delivery gates applied through the existing delivery lifecycle authority."); await onRefresh();
    } catch (error) { setPipelineStatus(formatApiError(error)); } finally { setPipelineBusy(false); }
  }
  async function schedulePipelineStage(stage: string, allowConflict = false) {
    setPipelineBusy(true); setPipelineStatus("");
    try {
      const result = await api<{ pipeline: DeliveryPipelineSnapshot; conflicts: Array<{ id: string; title: string; startsAt: string; endsAt: string }> }>(`/api/projects/${project.id}/intelligence/pipeline/schedule`, { method: "POST", body: JSON.stringify({ stage, allowConflict }) });
      setPipeline(result.pipeline); setSchedulerConflicts((current) => ({ ...current, [stage]: result.conflicts || [] })); setPipelineStatus(result.conflicts?.length ? `Stage placed with ${result.conflicts.length} explicitly accepted overlap${result.conflicts.length === 1 ? "" : "s"}.` : "Stage placed in Scheduler after availability validation."); await onRefresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "SCHEDULER_CONFLICT") { const payload = (error.payload || {}) as { conflicts?: Array<{ id: string; title: string; startsAt: string; endsAt: string }> }; setSchedulerConflicts((current) => ({ ...current, [stage]: payload.conflicts || [] })); setPipelineStatus("Scheduler conflicts found. Review them below or explicitly place anyway."); }
      else setPipelineStatus(formatApiError(error));
    } finally { setPipelineBusy(false); }
  }
  async function createProjectDependency() {
    if (!dependencyDraft.targetProjectId) { setDependencyStatus("Choose another project first."); return; }
    setDependencyBusy(true); setDependencyStatus("");
    try {
      await api(`/api/projects/${project.id}/intelligence/project-dependencies`, { method: "POST", body: JSON.stringify({ targetProjectId: dependencyDraft.targetProjectId, relationship: dependencyDraft.relationship, ownerId: dependencyDraft.ownerId || null, dueDate: dependencyDraft.dueDate || null, critical: dependencyDraft.critical }) });
      setDependencyStatus("Cross-project dependency created with a Project Control owner/due-date record.");
      setDependencyDraft({ targetProjectId: "", relationship: "depends_on", ownerId: "", dueDate: "", critical: false });
      await onRefresh();
    } catch (error) { setDependencyStatus(formatApiError(error)); } finally { setDependencyBusy(false); }
  }
  const pipelineGates = pipeline?.deliveryGates || [];
  const requiredPipelineGates = pipelineGates.filter((gate) => gate.required);
  const blockedRequiredPipelineGates = requiredPipelineGates.filter((gate) => !gate.passed);
  const advisoryPipelineGates = pipelineGates.filter((gate) => !gate.required);
  return (
    <section className="project-subpage-v312 project-intelligence-v386">
      <ProjectSectionHeader
        eyebrow="Intelligence"
        title="Project signals"
        description="One server-derived view of work, people, schedules, delivery relationships, activity, and explainable release readiness."
        metrics={[
          { label: "Readiness", value: snapshot ? `${snapshot.score}%` : "—", tone: snapshot && snapshot.score >= 80 ? "good" : snapshot && snapshot.score < 50 ? "danger" : "accent" },
          { label: "Open work", value: `${snapshot?.counts.openCards || 0}` },
          { label: "Builds / QA", value: `${snapshot?.counts.builds || 0} / ${snapshot?.counts.qaSessions || 0}` },
          { label: "Blockers", value: `${snapshot?.counts.blockers || 0}`, tone: snapshot?.counts.blockers ? "danger" : "good" },
          { label: "Dependency cycles", value: `${snapshot?.dependencies?.cycles.length || 0}`, tone: snapshot?.dependencies?.hasCycles ? "danger" : "good" },
        ]}
        actions={<ClusterButton disabled={loading} onClick={() => void onRefresh()}>{loading ? "Refreshing…" : "Refresh signals"}</ClusterButton>}
      />
      <ProjectSectionStatus tone={deliveryTone}>{loading && !snapshot ? "Updating project signals…" : snapshot ? `${stageLabel(snapshot.delivery.stage)} · generated ${new Date(snapshot.generatedAt).toLocaleString()}` : "Project signals are unavailable."}</ProjectSectionStatus>

      <div className="project-intelligence-grid-v386">
        <ProjectSurface title="Unified workspace" description="Project-owned workspaces and the server records backing them.">
          <div className="project-intelligence-workspace-v386">
            {(snapshot?.workspace || []).map((item) => <ClusterButton unstyled type="button" key={item.id} onClick={() => onOpenSection(item.id)}><span>{item.label}</span><strong>{item.count}</strong><em>{item.group}</em></ClusterButton>)}
          </div>
        </ProjectSurface>
        <ProjectSurface title="Delivery posture" description="Blocking work is derived from durable cards and Project Control records." tone={snapshot?.counts.blockers ? "danger" : "accent"}>
          <dl className="project-intelligence-metrics-v386">
            <div><dt>Blockers</dt><dd>{snapshot?.counts.blockers || 0}</dd></div>
            <div><dt>Release gates</dt><dd>{snapshot?.delivery.readiness ? `${snapshot.delivery.readiness.passed}/${snapshot.delivery.readiness.required}` : "—"}</dd></div>
            <div><dt>Schedule conflicts</dt><dd>{snapshot?.delivery.orchestration?.conflicts?.length || 0}</dd></div>
            <div><dt>Calendar / scheduled</dt><dd>{snapshot?.counts.calendarEvents || 0} / {snapshot?.counts.scheduleBlocks || 0}</dd></div>
          </dl>
          {(snapshot?.delivery.blockers || []).slice(0, 6).map((blocker) => <article className="project-intelligence-blocker-v386" key={`${blocker.kind}:${blocker.id}`}><strong>{blocker.title}</strong><span>{kindLabel(blocker.kind)} · {blocker.status} · {blocker.priority}</span></article>)}
          {snapshot?.delivery.readiness ? <div className="project-intelligence-workspace-v386">{snapshot.delivery.readiness.gates.filter((gate) => gate.required && !gate.passed).slice(0, 5).map((gate) => <article key={gate.id} className="project-intelligence-blocker-v386 tone-danger"><strong>{gate.label}</strong><span>{gate.detail}</span></article>)}</div> : null}
          {snapshot && snapshot.delivery.blockers.length === 0 && !snapshot.delivery.readiness?.blocked ? <ClusterEmptyState compact kind="empty" title="No delivery blockers" description="No explicit delivery blockers are currently recorded." /> : null}
        </ProjectSurface>
      </div>

      <ProjectSurface title="Explainable readiness" description="Every point is tied to a named production signal and the affected Project objects.">
        <div className="project-intelligence-workspace-v386">
          {(snapshot?.readiness?.factors || []).map((factor) => <article key={factor.id} className={`project-intelligence-blocker-v386 tone-${factor.state}`}><strong>{factor.label} · {factor.score}/{factor.maximum}</strong><span>{factor.explanation}</span>{factor.affected.length ? <em>{factor.affected.length} affected object{factor.affected.length === 1 ? "" : "s"}</em> : null}</article>)}
        </div>
      </ProjectSurface>

      <div className="project-intelligence-grid-v386">
        <ProjectSurface title="Dependency path" description="Blocking relationships are normalized into prerequisite → dependent order so cycles and critical sequencing are visible." tone={snapshot?.dependencies?.hasCycles ? "danger" : "accent"}>
          <dl className="project-intelligence-metrics-v386"><div><dt>Blocking links</dt><dd>{snapshot?.dependencies?.edgeCount || 0}</dd></div><div><dt>Open prerequisites</dt><dd>{snapshot?.dependencies?.openEdgeCount || 0}</dd></div><div><dt>Critical links</dt><dd>{snapshot?.dependencies?.criticalEdgeCount || 0}</dd></div><div><dt>Cross-project</dt><dd>{snapshot?.dependencies?.crossProject.length || 0}</dd></div></dl>
          {snapshot?.dependencies?.hasCycles ? (snapshot.dependencies.cycles || []).slice(0, 4).map((cycle, index) => <article className="project-intelligence-blocker-v386 tone-danger" key={`cycle-${index}`}><strong>Dependency cycle {index + 1}</strong><span>{cycle.nodes.map((node) => node.title).join(" → ")}</span></article>) : snapshot?.dependencies?.criticalPath.nodes.length ? <div className="project-traceability-edges-v386"><strong>Longest weighted dependency path</strong><span>{snapshot.dependencies.criticalPath.nodes.map((node) => node.title).join(" → ")}</span></div> : <ClusterEmptyState compact kind="empty" title="No blocking dependency chain" description="Map project dependencies to surface a critical path here." />}
        </ProjectSurface>
        <ProjectSurface title="Explainable risk signals" description="Warnings are named deductions from concrete Project data, not an opaque prediction." tone={(snapshot?.readiness?.signals || []).some((signal) => signal.severity === "danger") ? "danger" : "accent"}>
          {(snapshot?.readiness?.signals || []).length ? <div className="project-intelligence-workspace-v386">{(snapshot?.readiness?.signals || []).slice(0, 8).map((signal) => <article key={signal.id} className={`project-intelligence-blocker-v386 tone-${signal.severity}`}><strong>{signal.label}</strong><span>{signal.explanation}</span>{signal.affected.length ? <em>{signal.affected.length} evidence item{signal.affected.length === 1 ? "" : "s"}</em> : null}</article>)}</div> : <ClusterEmptyState compact kind="empty" title="No readiness deductions" description="Cluster has no current readiness signals to surface." />}
        </ProjectSurface>
      </div>

      <ClusterDisclosureGroup className="project-intelligence-deep-dive-v30d" title="Advanced operations & evidence" summary="Cross-project dependencies, delivery forecast, relationship graph, and activity history" headerTrailing={<em>{snapshot?.dependencies?.crossProject.length || 0} cross-project · {pipeline?.stageCount || 0} stages · {snapshot?.activity?.length || 0} events</em>} contentClassName="project-intelligence-deep-dive-body-v30d">
          <ProjectSurface title="Cross-project dependency operations" description="Project-to-project blockers also create owned Project Control dependency records, so accountability and due dates remain visible outside the graph." tone={(snapshot?.dependencies?.crossProject || []).some((item) => item.critical) ? "warning" : "accent"}>
        {canManage ? <div className="project-control-action-options-v494"><label className="wide"><span>Related project</span><ClusterSelect ariaLabel="Cross-project dependency target" value={dependencyDraft.targetProjectId} onChange={(value) => setDependencyDraft((current) => ({ ...current, targetProjectId: value }))} placeholder="Choose project" options={projects.filter((item) => item.id !== project.id && !item.archived).map((item) => ({ value: item.id, label: item.name }))} /></label><label><span>Relationship</span><ClusterSelect ariaLabel="Cross-project dependency relationship" value={dependencyDraft.relationship} onChange={(value) => setDependencyDraft((current) => ({ ...current, relationship: value }))} options={[{ value: "depends_on", label: "This project depends on target" }, { value: "blocks", label: "This project blocks target" }]} /></label><label><span>Owner</span><ClusterSelect ariaLabel="Cross-project dependency owner" value={dependencyDraft.ownerId} onChange={(value) => setDependencyDraft((current) => ({ ...current, ownerId: value }))} placeholder="Unassigned" options={[{ value: "", label: "Unassigned" }, ...users.filter((user) => !user.archived).map((user) => ({ value: user.id, label: user.displayName || user.username }))]} /></label><label><span>Due date</span><ClusterTextInput type="date" value={dependencyDraft.dueDate} onChange={(event) => setDependencyDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label className="project-toggle-field-v495"><span>Critical</span><ClusterInput type="checkbox" checked={dependencyDraft.critical} onChange={(event) => setDependencyDraft((current) => ({ ...current, critical: event.target.checked }))} /></label><ClusterButton size="compact" variant="secondary" busy={dependencyBusy} busyLabel="Saving…" onClick={() => void createProjectDependency()}>Add dependency</ClusterButton></div> : null}
        {dependencyStatus ? <ProjectSectionStatus tone={dependencyStatus.toLowerCase().includes("could") || dependencyStatus.toLowerCase().includes("failed") ? "danger" : "neutral"}>{dependencyStatus}</ProjectSectionStatus> : null}
        {(snapshot?.dependencies?.crossProject || []).length ? <div className="project-intelligence-workspace-v386">{snapshot!.dependencies!.crossProject.slice(0, 12).map((item) => { const otherId = item.sourceProjectId === project.id ? item.targetProjectId : item.sourceProjectId; const other = projects.find((candidate) => candidate.id === otherId); return <article key={item.id} className={`project-intelligence-blocker-v386 ${item.critical ? "tone-warning" : ""}`}><strong>{item.relationship.replace(/_/g, " ")}{item.critical ? " · critical" : ""}</strong><span>{other?.name || otherId}</span><em>{item.description || "No relationship note"}</em></article>; })}</div> : <ClusterEmptyState compact kind="empty" title="No cross-project dependencies" description="Cross-project relationships will appear here when they are mapped." />}
      </ProjectSurface>

      <ProjectSurface title="Delivery pipeline forecast" description="Project-Type stages materialize as Project Control phases with explicit blocking links. Forecasts show dates and evidence, not a predictive black box." tone={pipeline?.overdue || pipeline?.blocked ? "warning" : "accent"} action={canManage ? <div className="project-control-inline-actions-v313">{pipeline && pipeline.configured < pipeline.stageCount ? <ClusterButton size="compact" variant="secondary" busy={pipelineBusy} busyLabel="Synchronizing…" onClick={() => void ensureDeliveryPipeline()}>Materialize pipeline</ClusterButton> : null}{(pipeline?.projectTypeGatePolicy?.requiredGateIds?.length || pipeline?.projectTypeGatePolicy?.optionalGateIds?.length) ? <ClusterButton size="compact" variant="quiet" disabled={pipelineBusy} onClick={() => void applyProjectTypeGatePolicy()}>Apply type gates</ClusterButton> : null}<ClusterButton size="compact" variant="quiet" disabled={!pipeline?.configured} busy={pipelineBusy} busyLabel="Reconciling…" onClick={() => void reconcileDeliveryPipeline()}>Reconcile stages</ClusterButton></div> : undefined}>
        {pipelineStatus ? <ProjectSectionStatus tone={pipelineStatus.toLowerCase().includes("could") || pipelineStatus.toLowerCase().includes("failed") ? "danger" : "neutral"}>{pipelineStatus}</ProjectSectionStatus> : null}
        {pipeline?.stageCount ? <><dl className="project-intelligence-metrics-v386"><div><dt>Configured</dt><dd>{pipeline.configured}/{pipeline.stageCount}</dd></div><div><dt>Overdue</dt><dd>{pipeline.overdue}</dd></div><div><dt>Blocked</dt><dd>{pipeline.blocked}</dd></div><div><dt>Forecast confidence</dt><dd>{pipeline.confidence}</dd></div><div><dt>Dependency delay</dt><dd>{pipeline.dependencyDelayDays || 0}d</dd></div><div><dt>Delivery gates</dt><dd>{(pipeline.deliveryGates || []).filter((gate) => gate.passed).length}/{(pipeline.deliveryGates || []).filter((gate) => gate.required).length || 0}</dd></div></dl><div className="project-intelligence-workspace-v386">{pipeline.stages.map((stage) => <article key={stage.stage} className={`project-intelligence-blocker-v386 ${stage.slipDays || stage.deliveryGate?.state === "blocked" ? "tone-warning" : ""}`}><strong>{stage.label} · {stage.status}</strong><span>{new Date(stage.startDate).toLocaleDateString()} → {new Date(stage.dueDate).toLocaleDateString()}{stage.slipDays ? ` · ${stage.slipDays}d overdue` : ""}</span><em>{stage.ownerDepartments.length ? `Expected: ${stage.ownerDepartments.join(", ")}` : "No stage-owner departments configured"}{stage.scheduleBlocks ? ` · ${stage.scheduleBlocks} scheduled block${stage.scheduleBlocks === 1 ? "" : "s"}` : stage.schedulerSuggestion ? " · Scheduler placement suggested" : ""}</em>{stage.deliveryGate ? <small>Delivery gate: {stage.deliveryGate.state} · {stage.deliveryGate.detail}</small> : null}</article>)}</div>{pipelineGates.length ? <div className="project-delivery-gates-current"><div className="project-delivery-gates-summary-current"><span><strong>{requiredPipelineGates.filter((gate) => gate.passed).length}/{requiredPipelineGates.length || 0}</strong><small>required gates passed</small></span><span className={blockedRequiredPipelineGates.length ? "attention" : "good"}><strong>{blockedRequiredPipelineGates.length}</strong><small>blocking</small></span><span><strong>{advisoryPipelineGates.length}</strong><small>advisory</small></span></div>{blockedRequiredPipelineGates.length ? <div className="project-delivery-gates-blockers-current">{blockedRequiredPipelineGates.slice(0, 5).map((gate) => <article key={gate.id}><strong>{gate.label}</strong><span>{gate.detail}</span></article>)}</div> : <ProjectSectionStatus tone="good">Required delivery gates are clear.</ProjectSectionStatus>}{pipeline.deliveryRecommendedAction ? <ProjectSectionStatus tone={pipeline.deliveryReady ? "good" : "warning"}>Next delivery action: {pipeline.deliveryRecommendedAction}</ProjectSectionStatus> : null}</div> : null}{(pipeline.schedulerSuggestions || []).length ? <div className="project-intelligence-workspace-v386"><strong>Scheduler assistance</strong>{pipeline.schedulerSuggestions!.slice(0, 8).map((suggestion) => { const conflicts = schedulerConflicts[suggestion.stage] || []; return <article key={suggestion.stage} className={`project-intelligence-blocker-v386 ${conflicts.length ? "tone-warning" : ""}`}><strong>{suggestion.label}</strong><span>{new Date(suggestion.startsAt).toLocaleDateString()} → {new Date(suggestion.endsAt).toLocaleDateString()}</span><em>{suggestion.reason}</em>{conflicts.length ? <small>{conflicts.slice(0, 4).map((item) => `${item.title} (${new Date(item.startsAt).toLocaleString()})`).join(" · ")}</small> : null}{canManage ? <div className="project-control-inline-actions-v313"><ClusterButton size="compact" variant="secondary" disabled={pipelineBusy} onClick={() => void schedulePipelineStage(suggestion.stage, false)}>Place in Scheduler</ClusterButton>{conflicts.length ? <ClusterButton size="compact" variant="quiet" disabled={pipelineBusy} onClick={() => void schedulePipelineStage(suggestion.stage, true)}>Place anyway</ClusterButton> : null}</div> : null}</article>; })}<small>Placement is explicit and availability-checked. Overbooking requires an explicit override.</small></div> : null}<div className="project-traceability-edges-v386">{pipeline.forecastReasons.map((reason) => <span key={reason}>{reason}</span>)}</div></> : <ClusterEmptyState compact kind="empty" title="No delivery-stage model" description="This Project Type does not define delivery stages yet." />}
      </ProjectSurface>

      <ProjectSurface title="Unified relationship graph" description="Build → QA → Release traceability remains part of a larger explicit relationship graph spanning work, schedules, files, and people.">
        {traceRows.length ? <div className="project-traceability-v386">
          {traceRows.slice(0, 120).map((node) => <ClusterButton unstyled type="button" key={node.id} className={linkedNodeIds.has(node.id) ? "linked" : "unlinked"} onClick={() => onOpenSection(node.section || "overview")}>
            <span>{kindLabel(node.kind)}</span><strong>{node.title}</strong><em>{node.status}{node.platform ? ` · ${node.platform}` : ""}</em>
          </ClusterButton>)}
          <div className="project-traceability-edges-v386">
            <strong>{explicitEdges.length} explicit · {inferredEdges.length} inferred</strong>
            {(snapshot?.traceability.edges || []).slice(0, 60).map((edge) => <span key={edge.id}>{edge.from} → {edge.relationship.replace(/_/g, " ")} → {edge.to} · {edge.authority || "explicit"}</span>)}
          </div>
        </div> : <ClusterEmptyState compact kind="empty" title="No related project records" description={`No related Project records exist yet for ${project.name}.`} />}
      </ProjectSurface>

      <ProjectSurface title="Recent Project activity" description="The same server activity stream used by notifications and project history.">
        <div className="project-traceability-edges-v386">
          {(snapshot?.activity || []).length ? (snapshot?.activity || []).slice(0, 20).map((event) => <span key={event.id}><strong>{event.user?.displayName || event.user?.username || "Cluster"}</strong> · {event.title} · {new Date(event.createdAt).toLocaleString()}{event.message ? ` · ${event.message}` : ""}</span>) : <span>No recent Project activity.</span>}
        </div>
      </ProjectSurface>
      </ClusterDisclosureGroup>
    </section>
  );
}

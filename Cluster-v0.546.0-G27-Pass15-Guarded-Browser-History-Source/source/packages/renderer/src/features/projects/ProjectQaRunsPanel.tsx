import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useCallback, useEffect, useMemo, useState } from "react";
import { localId } from "../../core/storage";
import { api, queryApi } from "../../core/api";
import { emitProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { emitProjectDeliveryUpdate } from "../../core/project-delivery-storage";
import type { BuildArtifactRecord, Project, QASessionRecord, TicketCard, User } from "../application/application-models";
import { QA_SCOPES, qaDecisionForSession, qaSessionPassRate, qaSessionStatusFromResults } from "./project-quality-models";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterActionMenu, ClusterRecoveryNotice, confirmDestructiveAction } from "../../components/ClusterContextActions";
import { TableLoadingState } from "../../components/LoadingState";
import { useServerState } from "../../core/server-state";
import { ClusterSelect } from "../../components/ClusterSelect";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { SharedWorkEvidencePanel } from "../../components/SharedWorkEvidencePanel";
import { SharedWorkActivityPanel } from "../../components/SharedWorkActivityPanel";
import { PeopleMultiPicker, PeoplePicker } from "../people/PeoplePicker";
import { openContextualCreate } from "../create/shared-create-handoff";
import { displayUserName } from "../people/people-utils";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { readClusterDetailSelection, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { openClusterWorkNavigation, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { ProjectDeliveryRiskPanel } from "./ProjectDeliveryRiskPanel";

const FILTER_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const DECISION_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "go", label: "Go" },
  { value: "conditional", label: "Conditional" },
  { value: "no-go", label: "No-go" },
];

type Props = {
  project: Project;
  artifacts: BuildArtifactRecord[];
  sessions: QASessionRecord[];
  users?: User[];
  currentUser?: User | null;
  readOnly?: boolean;
  canSignoff?: boolean;
  loading?: boolean;
  onSessionsChange: (rows: QASessionRecord[]) => void;
  onArtifactPatch: (id: string, patch: Partial<BuildArtifactRecord>) => void;
};

export function ProjectQaRunsPanel({ project, artifacts, sessions, users = [], currentUser = null, readOnly = false, canSignoff = false, loading = false, onSessionsChange, onArtifactPatch }: Props) {
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState<"active" | "completed" | "all">("active");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [lastRemovedSession, setLastRemovedSession] = useState<QASessionRecord | null>(null);
  const [density, setDensity] = useServerState<"compact" | "comfortable">("user", "project.quality-density", "comfortable", { merge: (value, fallback) => value === "compact" || value === "comfortable" ? value : fallback });
  const restoreQaSessionDetail = useCallback((id: string | null) => { setSelectedSessionId(id || ""); if (id) setFilter("all"); }, []);
  const qaSessionDetailHistory = useClusterDetailHistory("qa-session", selectedSessionId || null, restoreQaSessionDetail);
  const [form, setForm] = useState({
    buildId: artifacts[0]?.id || "",
    platform: artifacts[0]?.platform || "Windows",
    configuration: "default",
    suite: "general",
    regressionBaseBuildId: artifacts[0]?.previousBuildId || "",
    scope: "smoke" as QASessionRecord["scope"],
    ownerId: currentUser?.id || "",
    testerIds: [] as string[],
    environment: "Production-like",
    notes: "",
  });
  const rows = sessions
    .filter((session) => session.projectId === project.id)
    .filter((session) => filter === "all" || (filter === "active" ? ["planned", "running"].includes(session.status) : !["planned", "running"].includes(session.status)));
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const artifactMap = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts]);
  const sessionMap = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  useEffect(() => {
    const requestedId = readClusterDetailSelection("qa-session");
    if (!requestedId || loading) return;
    if (sessions.some((session) => session.id === requestedId)) return;
    setSelectedSessionId("");
    recoverClusterDetailNavigation("qa-session", { title: "QA session unavailable", message: "That QA session may have been removed, archived with its project, or your access may have changed. QA stayed open.", tone: "warning" });
  }, [loading, sessions]);
  function save(next: QASessionRecord[]) { onSessionsChange(next); }
  function patch(id: string, next: Partial<QASessionRecord>) { save(sessions.map((session) => session.id === id ? { ...session, ...next, updatedAt: new Date().toISOString() } : session)); }
  function create() {
    const now = new Date().toISOString();
    const artifact = artifacts.find((item) => item.id === form.buildId);
    if (!artifact) { setActionStatus("Select a synchronized Build before starting QA."); return; }
    const owner = userMap.get(form.ownerId);
    const record: QASessionRecord = {
      id: localId("qa-session"),
      projectId: project.id,
      buildId: artifact.id,
      planId: null,
      retestOfSessionId: null,
      regressionBaseBuildId: form.regressionBaseBuildId || artifact.previousBuildId || null,
      build: artifact.version,
      platform: form.platform || artifact.platform || "Unspecified",
      configuration: form.configuration || "default",
      suite: form.suite || "general",
      environment: form.environment,
      scope: form.scope,
      owner: owner ? displayUserName(owner) : "",
      ownerId: form.ownerId || null,
      testerIds: form.testerIds,
      status: "running",
      decision: "pending",
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      notes: form.notes,
      startedAt: now,
      sourceRevision: artifact.sourceRevision,
      sourceRepositoryId: artifact.sourceRepositoryId,
      sourceReviewId: artifact.sourceReviewId || null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    save([record, ...sessions]);
    setShow(false);
  }
  function count(session: QASessionRecord, key: "passed" | "failed" | "blocked" | "skipped", delta: number) {
    const next = { ...session, [key]: Math.max(0, session[key] + delta) };
    const status = qaSessionStatusFromResults(next);
    patch(session.id, { [key]: next[key], status, decision: qaDecisionForSession(next), completedAt: ["passed", "failed", "blocked"].includes(status) ? new Date().toISOString() : null });
  }
  function signoff(session: QASessionRecord, decision: QASessionRecord["decision"]) {
    patch(session.id, {
      decision,
      signedOffBy: currentUser ? displayUserName(currentUser) : session.signedOffBy,
      signedOffById: currentUser?.id || session.signedOffById || null,
      signedOffAt: new Date().toISOString(),
      completedAt: session.completedAt || new Date().toISOString(),
    });
  }
  function rerun(session: QASessionRecord) {
    const now = new Date().toISOString();
    const record: QASessionRecord = {
      ...session,
      id: localId("qa-session"),
      retestOfSessionId: session.id,
      status: "running",
      decision: "pending",
      passed: 0, failed: 0, blocked: 0, skipped: 0,
      completedAt: null, signedOffAt: null, signedOffBy: null, signedOffById: null,
      startedAt: now, createdAt: now, updatedAt: now, revision: 0,
    };
    save([record, ...sessions]);
    setSelectedSessionId(record.id);
    emitProjectDeliveryUpdate({ projectId: project.id, kind: "qa-session" });
  }
  function schedule(session: QASessionRecord) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60 * 1000);
    openContextualCreate("calendar", {
      projectId: project.id,
      title: `QA: ${session.build} ${session.scope}`,
      details: `${session.platform} · ${session.environment}\n${session.notes || "QA verification session"}`,
      assigneeId: session.ownerId || currentUser?.id || "",
      attendeeIds: session.testerIds || [],
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      calendarType: "review",
      source: { kind: "qa_session", id: session.id, projectId: project.id, label: `${session.build} QA` },
      relationship: "scheduled_by",
    });
  }
  async function createFixTicket(session: QASessionRecord) {
    if (readOnly) return;
    setActionStatus("Creating linked fix ticket…");
    try {
      const delivery = await queryApi<any>(`/api/projects/${encodeURIComponent(project.id)}/delivery-lifecycle`, { staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", project.id] });
      const existingCycle = (delivery.failures || []).find((item: any) => item.failedQa?.id === session.id);
      const existingFix = existingCycle?.issues?.find((item: any) => !item.done) || existingCycle?.issues?.[0];
      if (existingFix?.navigation) {
        setActionStatus(existingFix.done ? "A resolved fix is already linked to this QA failure." : "An open fix is already linked to this QA failure.");
        openClusterWorkNavigation(existingFix.navigation);
        return;
      }
      const failureCount = Number(session.failed || 0) + Number(session.blocked || 0);
      const description = [
        "Type: QA failure fix",
        `Build: ${session.build}`,
        `Platform: ${session.platform}`,
        `Environment: ${session.environment}`,
        `Scope: ${session.scope}`,
        `Results: ${session.passed} passed · ${session.failed} failed · ${session.blocked} blocked · ${session.skipped} skipped`,
        `Decision: ${session.decision}`,
        session.notes ? `QA notes:\n${session.notes}` : "QA notes: No additional notes recorded.",
        "Acceptance criteria:\n- Reproduce or explain the failure.\n- Implement and verify the fix.\n- Resolve this ticket before creating the superseding rebuild.\n- Retest the rebuild against the linked QA failure.",
      ].join("\n\n");
      const severity = failureCount > 1 || session.scope === "regression" || session.scope === "certification" ? "urgent" : "high";
      const ticket = await api<TicketCard>("/api/tickets", { method: "POST", body: JSON.stringify({
        projectId: project.id,
        title: `Fix QA failure: ${session.build} · ${session.scope}`,
        description,
        priority: severity,
        dueDate: null,
        labels: ["qa", "qa-failure", "fix", session.scope, session.platform, session.scope === "regression" ? "regression" : ""].filter(Boolean),
        assigneeId: session.ownerId || currentUser?.id || null,
        automationContext: { type: "Build Issue", severity, labels: `qa,qa-failure,fix,${session.scope}` },
      }) });
      await api(`/api/projects/${encodeURIComponent(project.id)}/workflow-links`, { method: "POST", body: JSON.stringify({
        source: { kind: "qa_session", id: session.id, projectId: project.id, label: `${session.build} QA` },
        target: { kind: "ticket", id: ticket.id, projectId: project.id, label: ticket.title },
        relationship: "tracks",
        description: "Fix work created from failed QA verification.",
        critical: true,
      }) });
      await api(`/api/projects/${encodeURIComponent(project.id)}/workflow-links`, { method: "POST", body: JSON.stringify({
        source: { kind: "ticket", id: ticket.id, projectId: project.id, label: ticket.title },
        target: { kind: "qa_session", id: session.id, projectId: project.id, label: `${session.build} QA` },
        relationship: "fixes",
        description: "This ticket owns the fix for the linked QA failure.",
        critical: true,
      }) });
      emitProjectDeliveryUpdate({ projectId: project.id, kind: "qa-session" });
      emitProjectWorkflowUpdate({ projectId: project.id, kind: "relationship" });
      setActionStatus("Fix ticket created and linked to the failed QA cycle.");
      openClusterWorkNavigation({ screen: "tickets", projectId: project.id, inspectScope: "ticket", inspectId: ticket.id });
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Fix ticket could not be created.");
    }
  }
  function createFollowupCard(session: QASessionRecord) {
    openContextualCreate("card", {
      projectId: project.id,
      title: `${session.failed || session.blocked ? "QA failure" : "QA follow-up"}: ${session.build}`,
      details: `Build: ${session.build}
Platform: ${session.platform}
Environment: ${session.environment}
Scope: ${session.scope}
Passed: ${session.passed}
Failed: ${session.failed}
Blocked: ${session.blocked}

${session.notes || "Add reproduction and follow-up details."}`,
      assigneeId: session.ownerId || currentUser?.id || "",
      priority: session.failed || session.blocked ? "urgent" : "medium",
      labels: ["qa", session.scope, session.platform, session.failed ? "failed" : "follow-up"].filter(Boolean),
      source: { kind: "qa_session", id: session.id, projectId: project.id, label: `${session.build} QA` },
      relationship: "tracks",
    });
  }
  async function removeSession(session: QASessionRecord) {
    if (!await confirmDestructiveAction({ title: "Remove QA session?", message: `Remove ${session.build} from this project QA history?`, confirmLabel: "Remove session" })) return;
    setLastRemovedSession(session);
    save(sessions.filter((item) => item.id !== session.id));
    if (selectedSessionId === session.id) qaSessionDetailHistory.closeDetail();
    setActionStatus(`${session.build} removed.`);
  }
  function restoreRemovedSession() {
    if (!lastRemovedSession) return;
    save([...sessions, lastRemovedSession].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()));
    setActionStatus(`${lastRemovedSession.build} restored.`);
    setLastRemovedSession(null);
  }
  if (loading && !sessions.length) return <TableLoadingState label="Loading QA sessions" rows={5} columns={5} />;
  return <section className={`qa-runs-workspace-v309 density-${density}`}>
    <div className="section-heading"><div><h3>Test runs</h3><p className="muted tight">Environment-aware verification, scheduling, collaboration, and release sign-off.</p></div><ClusterButton variant="primary" size="compact" disabled={readOnly} onClick={() => setShow(!show)}>{show ? "Close" : "Start test session"}</ClusterButton></div>
    {lastRemovedSession ? <ClusterRecoveryNotice message={`${lastRemovedSession.build} removed.`} onAction={restoreRemovedSession} onDismiss={() => setLastRemovedSession(null)} /> : null}
    {actionStatus ? <p className="inline-status">{actionStatus}</p> : null}
    <div className="project-filter-bar-v159"><ClusterSelect value={filter} onChange={(value) => setFilter(value as typeof filter)} ariaLabel="Filter QA sessions" options={FILTER_OPTIONS} /><div className="button-row" role="group" aria-label="QA session density"><ClusterButton size="compact" variant="quiet" selected={density === "compact"} onClick={() => setDensity("compact")}>Compact</ClusterButton><ClusterButton size="compact" variant="quiet" selected={density === "comfortable"} onClick={() => setDensity("comfortable")}>Comfortable</ClusterButton></div></div>
    {show && !readOnly && <div className="project-inline-composer-v159 qa-session-composer-v309">
      <label className="field">Artifact<ClusterSelect value={form.buildId} onChange={(value) => { const artifact = artifacts.find((item) => item.id === value); setForm((current) => ({ ...current, buildId: value, platform: artifact?.platform || current.platform, regressionBaseBuildId: artifact?.previousBuildId || "", ownerId: artifact?.ownerId || current.ownerId, testerIds: artifact?.reviewerIds || current.testerIds })); }} ariaLabel="QA artifact" options={[{ value: "", label: "Select Build" }, ...artifacts.map((artifact) => ({ value: artifact.id, label: `${artifact.version} · ${artifact.platform} · ${artifact.sourceRevision.slice(0, 10)}` }))]} /></label>
      <label className="field">Scope<ClusterSelect value={form.scope} onChange={(value) => setForm((current) => ({ ...current, scope: value as QASessionRecord["scope"] }))} ariaLabel="QA scope" options={QA_SCOPES.map((scope) => ({ value: scope.id, label: scope.label }))} /></label>
      <label className="field">Platform<ClusterTextInput value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))} /></label>
      <label className="field">Environment<ClusterTextInput value={form.environment} onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))} placeholder="Production-like" /></label>
      <label className="field">Configuration<ClusterTextInput value={form.configuration} onChange={(event) => setForm((current) => ({ ...current, configuration: event.target.value }))} placeholder="Shipping" /></label>
      <label className="field">Suite<ClusterTextInput value={form.suite} onChange={(event) => setForm((current) => ({ ...current, suite: event.target.value }))} placeholder="Core regression" /></label>
      <label className="field">Regression baseline<ClusterSelect value={form.regressionBaseBuildId} onChange={(value) => setForm((current) => ({ ...current, regressionBaseBuildId: value }))} ariaLabel="Regression baseline Build" options={[{ value: "", label: "No baseline" }, ...artifacts.filter((artifact) => artifact.id !== form.buildId).map((artifact) => ({ value: artifact.id, label: `${artifact.version} · ${artifact.platform} · ${artifact.sourceRevision.slice(0, 10)}` }))]} /></label>
      <PeoplePicker label="Owner" value={form.ownerId} onChange={(ownerId) => setForm((current) => ({ ...current, ownerId }))} people={users} />
      <PeopleMultiPicker label="Testers" values={form.testerIds} onChange={(testerIds) => setForm((current) => ({ ...current, testerIds }))} people={users} />
      <label className="field span-2">Notes<ClusterTextArea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      <ClusterButton variant="primary" onClick={create}>Start test session</ClusterButton>
    </div>}
    <div className="qa-session-list-v309">{rows.length ? rows.map((session) => {
      const owner = session.ownerId ? userMap.get(session.ownerId) : null;
      const ownerLabel = owner ? displayUserName(owner) : session.owner || "Unassigned";
      return <article className="qa-session-card-v309" key={session.id}>
        <header><div><strong>{session.build}</strong><span>{session.scope} · {session.platform} · {session.configuration || "default"} · {session.suite || "general"} · {session.environment}</span></div><i className={`status-${session.status}`}>{session.status}</i></header>
        <div className="qa-result-grid-v309">{(["passed", "failed", "blocked", "skipped"] as const).map((key) => <div key={key}><span>{key}</span><strong>{session[key]}</strong><span><ClusterButton unstyled type="button" disabled={readOnly} onClick={() => count(session, key, -1)}>−</ClusterButton><ClusterButton unstyled type="button" disabled={readOnly} onClick={() => count(session, key, 1)}>+</ClusterButton></span></div>)}</div>
        <div className="qa-session-footer-v309"><span>{qaSessionPassRate(session)}% pass rate · {ownerLabel}{session.retestOfSessionId ? ` · retest of ${sessionMap.get(session.retestOfSessionId)?.build || session.retestOfSessionId}` : ""}{session.regressionBaseBuildId ? ` · baseline ${artifactMap.get(session.regressionBaseBuildId)?.version || session.regressionBaseBuildId}` : ""}</span><label>Release decision<ClusterSelect disabled={!canSignoff} value={session.decision} onChange={(value) => signoff(session, value as QASessionRecord["decision"])} ariaLabel={`Release decision for ${session.build}`} options={DECISION_OPTIONS} /></label></div>
        <div className="qa-session-primary-actions-v30d">
          <ClusterButton size="compact" variant="quiet" onClick={() => qaSessionDetailHistory.openDetail(session.id)}>Inspect</ClusterButton>
          {(session.failed || session.blocked || session.decision === "no-go") ? <ClusterButton size="compact" variant="primary" disabled={readOnly} onClick={() => void createFixTicket(session)}>Create fix ticket</ClusterButton> : null}
          <ClusterActionMenu
            label={`More actions for ${session.build}`}
            items={[
              { id: "calendar", label: "Add to Calendar", disabled: readOnly, onSelect: () => schedule(session) },
              { id: "card", label: "Create Card", disabled: readOnly, onSelect: () => createFollowupCard(session) },
              { id: "rerun", label: "Rerun session", disabled: readOnly, onSelect: () => rerun(session) },
              { id: "remove", label: "Remove session", disabled: readOnly, danger: true, separatorBefore: true, onSelect: () => removeSession(session) },
            ]}
          />
        </div>
        {density === "compact" ? <ClusterDisclosureGroup title="More QA context" summary="Delivery risks, linked work, and discussion"><ProjectDeliveryRiskPanel projectId={project.id} kind="qa_session" entityId={session.id} /><LinkedWorkPanel projectId={project.id} kind="qa_session" entityId={session.id} compact /><SharedWorkEvidencePanel projectId={project.id} kind="qa_session" entityId={session.id} label={session.build || "QA session"} compact /><SharedWorkWatchControl entity={{ kind: "qa_session", id: session.id, projectId: project.id, label: `QA ${session.build} · ${session.platform}` }} compact /><CollaborationPanel title="QA discussion" entityType="qa_session" entityId={session.id} users={users} currentUser={currentUser} compact /></ClusterDisclosureGroup> : <><ProjectDeliveryRiskPanel projectId={project.id} kind="qa_session" entityId={session.id} /><LinkedWorkPanel projectId={project.id} kind="qa_session" entityId={session.id} compact /><SharedWorkEvidencePanel projectId={project.id} kind="qa_session" entityId={session.id} label={session.build || "QA session"} compact /><SharedWorkWatchControl entity={{ kind: "qa_session", id: session.id, projectId: project.id, label: session.build || "QA session" }} compact /><CollaborationPanel title="QA discussion" entityType="qa_session" entityId={session.id} users={users} currentUser={currentUser} compact /></>}
      </article>;
    }) : <p className="muted">No test sessions in this view.</p>}</div>
    <ClusterModal open={Boolean(selectedSession)} onClose={qaSessionDetailHistory.closeDetail} backdropClassName="cluster-dialog-backdrop" className="cluster-dialog qa-session-inspector-v491" ariaLabel={selectedSession ? `QA session ${selectedSession.build}` : "QA session"}>{selectedSession && <><div className="section-heading"><div><p className="eyebrow">QA session</p><h3>{selectedSession.build}</h3><p className="muted tight">{selectedSession.scope} · {selectedSession.platform} · {selectedSession.environment}</p></div><span className={`soft-pill status-${selectedSession.status}`}>{selectedSession.status}</span></div><dl className="quality-detail-list-v309"><div><dt>Decision</dt><dd>{selectedSession.decision}</dd></div><div><dt>Pass rate</dt><dd>{qaSessionPassRate(selectedSession)}%</dd></div><div><dt>Configuration</dt><dd>{selectedSession.configuration || "default"}</dd></div><div><dt>Suite</dt><dd>{selectedSession.suite || "general"}</dd></div><div><dt>Source revision</dt><dd>{selectedSession.sourceRevision.slice(0, 12)}</dd></div><div><dt>Review</dt><dd>{selectedSession.sourceReviewId || "Direct revision"}</dd></div><div><dt>Retest of</dt><dd>{selectedSession.retestOfSessionId ? sessionMap.get(selectedSession.retestOfSessionId)?.build || selectedSession.retestOfSessionId : "Original session"}</dd></div><div><dt>Regression baseline</dt><dd>{selectedSession.regressionBaseBuildId ? artifactMap.get(selectedSession.regressionBaseBuildId)?.version || selectedSession.regressionBaseBuildId : "None"}</dd></div><div><dt>Passed</dt><dd>{selectedSession.passed}</dd></div><div><dt>Failed</dt><dd>{selectedSession.failed}</dd></div><div><dt>Blocked</dt><dd>{selectedSession.blocked}</dd></div><div><dt>Owner</dt><dd>{selectedSession.ownerId && userMap.get(selectedSession.ownerId) ? displayUserName(userMap.get(selectedSession.ownerId)!) : selectedSession.owner || "Unassigned"}</dd></div></dl>{selectedSession.notes ? <p className="muted pre-wrap-v113">{selectedSession.notes}</p> : null}<ProjectDeliveryRiskPanel projectId={project.id} kind="qa_session" entityId={selectedSession.id} /><LinkedWorkPanel projectId={project.id} kind="qa_session" entityId={selectedSession.id} compact /><SharedWorkEvidencePanel projectId={project.id} kind="qa_session" entityId={selectedSession.id} label={selectedSession.build || "QA session"} compact /><SharedWorkActivityPanel entity={{ kind: "qa_session", id: selectedSession.id, projectId: project.id, label: selectedSession.build }} compact /><div className="button-row"><WorkActionMenu context={{ source: { kind: "qa_session", id: selectedSession.id, projectId: project.id, label: selectedSession.build }, navigation: { screen: "project", projectId: project.id, projectTab: "qa", inspectScope: "qa-session", inspectId: selectedSession.id }, projectId: project.id, assigneeId: selectedSession.ownerId || null }} label={`${selectedSession.build} work actions`} allowMention /><ClusterButton variant="quiet" onClick={qaSessionDetailHistory.closeDetail}>Close</ClusterButton></div></>}</ClusterModal>
  </section>;
}

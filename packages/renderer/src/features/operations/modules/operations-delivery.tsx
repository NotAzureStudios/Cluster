import { isClosedBoardWorkItem } from "@cluster/shared";
import { ClusterNativeSelect } from "../../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterTextArea } from "../../../components/ClusterTextArea";
import { promptCluster } from "../../../components/cluster-dialog-service";

import { useCallback, useEffect, useMemo, useState } from "react";
import { localId } from "../../../core/storage";
import { api, formatApiError } from "../../../core/api";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { useProjectDeliveryList } from "../../../core/project-delivery-storage";
import { addDays, compactDateTime } from "../../../core/date-time";
import { levelLabel } from "../../../core/format";
import { NumberStepper } from "../../../components/NumberStepper";
import { ClusterButton, ClusterLinkButton } from "../../../components/ClusterButton";
import { ClusterEmptyState } from "../../../components/ClusterEmptyState";
import { ClusterSelect } from "../../../components/ClusterSelect";
import { CollaborationPanel } from "../../../components/CollaborationPanel";
import { readClusterDetailSelection, useClusterDetailHistory } from "../../../components/ClusterMasterDetail";
import { buildReleaseNoteBody, splitReleaseNoteLines } from "../../projects/ProjectBuildsPanel";
import type { ProjectControlRecord } from "../../projects/project-control-model";
import { displayUserName } from "../../people/people-utils";
import { PeopleMultiPicker, PeoplePicker } from "../../people/PeoplePicker";
import { openSharedCreate } from "../../create/shared-create-handoff";
import { recoverClusterDetailNavigation } from "../../workflow/work-navigation";
import { LinkedWorkPanel } from "../../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../../workflow/WorkActionMenu";
import type { User, Project, TimelineEntry, UserActivitySummary, MeetingRecord, BuildArtifactRecord, QATestCaseStatus, QATestPlanStatus, QATestCase, QATestPlan, QASessionRecord, ReleaseNoteDraft, TicketCard } from "../../application/application-models";

import { CustomFieldValuesPanel } from "./operations-workflows";

export function BuildArtifactRegistry({
  projects,
  rows: _rows,
}: {
  projects: Project[];
  rows: Array<{
    entry: TimelineEntry;
    lane: string;
    version: string;
    statusMeta: { label: string; tone: string };
  }>;
}) {
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const [artifacts, setArtifacts, artifactSync] = useProjectDeliveryList<BuildArtifactRecord>("build", projectIds);
  const approved = artifacts.filter((artifact) => artifact.approval === "approved").length;
  const blocked = artifacts.filter((artifact) => artifact.approval === "blocked" || artifact.qaStatus === "failed").length;
  const tested = artifacts.filter((artifact) => artifact.qaStatus === "passed").length;
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  function patchArtifact(id: string, patch: Partial<BuildArtifactRecord>) {
    setArtifacts((current) => current.map((artifact) => artifact.id === id ? { ...artifact, ...patch, updatedAt: new Date().toISOString() } : artifact));
  }
  return (
    <section className="panel build-artifact-registry-v123">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Builds</p>
          <h2>Delivery registry</h2>
          <p className="muted tight">First-class Builds captured from synchronized Source Control provenance. Create Builds from a project or CI; Operations is the cross-project review surface.</p>
        </div>
        <span className="soft-pill">{artifacts.length} builds · {tested} QA passed · {approved} approved · {blocked} blocked</span>
      </div>
      {artifactSync.error ? <p className="inline-status danger" role="alert">{artifactSync.error}</p> : null}
      <div className="build-artifact-list-v123">
        {artifacts.length ? artifacts.slice(0, 30).map((artifact) => (
          <article key={artifact.id} className={`${artifact.qaStatus} ${artifact.approval}`}>
            <div>
              <strong>{artifact.title}</strong>
              <span>{projectMap.get(artifact.projectId) || "Project"} · {artifact.version} · {artifact.platform}</span>
              <p>{artifact.provenance.repositoryName} · {artifact.sourceBranch} · {artifact.provenance.shortRevision || artifact.sourceRevision.slice(0, 12)}{artifact.sourceReviewId ? ` · review ${artifact.provenance.reviewTitle || artifact.sourceReviewId}` : ""}</p>
              <small>{artifact.changes.commitCount} changes since {artifact.changes.previousVersion || "baseline"} · {artifact.changes.filesChanged} files</small>
            </div>
            <em>{levelLabel(artifact.channel || artifact.lane)} · {levelLabel(artifact.qaStatus)} · {levelLabel(artifact.approval)}</em>
            <div className="button-row compact">
              {artifact.artifactUrl ? <ClusterLinkButton className="" href={artifact.artifactUrl} target="_blank" variant="quiet" size="compact">Open artifact</ClusterLinkButton> : null}
              {artifact.approval === "draft" ? <ClusterButton type="button" variant="quiet" size="compact" onClick={() => patchArtifact(artifact.id, { approval: "pending" })}>Request approval</ClusterButton> : null}
              {artifact.approval === "pending" ? <ClusterButton type="button" variant="quiet" size="compact" onClick={() => patchArtifact(artifact.id, { approval: "approved" })}>Approve</ClusterButton> : null}
            </div>
          </article>
        )) : <ClusterEmptyState compact kind={artifactSync.loading ? "loading" : "empty"} title={artifactSync.loading ? "Loading Builds" : "No Builds recorded"} description={artifactSync.loading ? "Cluster is loading the canonical delivery registry." : "Create or ingest a Build with synchronized Source Control provenance to begin delivery tracking."} />}
      </div>
    </section>
  );
}

export const QA_TEST_TEMPLATES: Record<string, Array<{ title: string; expected: string }>> = {
  smoke: [
    {
      title: "Launch build and reach main menu",
      expected: "Build opens without crash and core menu controls respond.",
    },
    {
      title: "Load primary test map or scene",
      expected: "Scene loads, player gains control, and no blocking errors appear.",
    },
    {
      title: "Create/save basic progress",
      expected: "Save data writes successfully and reloads without corruption.",
    },
    {
      title: "Quit and relaunch",
      expected: "Session closes cleanly and relaunch keeps expected state.",
    },
  ],
  regression: [
    {
      title: "Verify recently fixed crash paths",
      expected: "Known crash repros no longer fail.",
    },
    {
      title: "Run core gameplay loop",
      expected: "Movement, interaction, UI, and progression remain stable.",
    },
    {
      title: "Check old high-priority bugs",
      expected: "Previously closed high-risk bugs remain closed.",
    },
    {
      title: "Review platform-specific labels",
      expected: "Platform-only fixes are verified on their actual target.",
    },
  ],
  release: [
    {
      title: "Confirm build metadata",
      expected: "Version, platform, branch, and artifact link match release target.",
    },
    {
      title: "Validate known issues list",
      expected: "Known issues are documented and not ship-blocking unless approved.",
    },
    {
      title: "Run final smoke test",
      expected: "No critical or high severity blockers remain.",
    },
    {
      title: "Approve release notes",
      expected: "Release notes are reviewed and ready to publish.",
    },
  ],
};

export function normalizeQaStatus(status: string): QATestPlanStatus {
  if (["ready", "running", "passed", "failed", "blocked"].includes(status)) return status as QATestPlanStatus;
  return "draft";
}

export function qaStatusFromCases(cases: QATestCase[]): QATestPlanStatus {
  if (!cases.length) return "draft";
  if (cases.some((testCase) => testCase.status === "blocked")) return "blocked";
  if (cases.some((testCase) => testCase.status === "failed")) return "failed";
  if (cases.every((testCase) => testCase.status === "passed" || testCase.status === "skipped")) return "passed";
  if (cases.some((testCase) => testCase.status !== "not-run")) return "running";
  return "ready";
}

export function defaultQaCases(template: string): QATestCase[] {
  return (QA_TEST_TEMPLATES[template] || QA_TEST_TEMPLATES.smoke).map((item) => ({
    id: localId("qa-case"),
    title: item.title,
    expected: item.expected,
    status: "not-run" as QATestCaseStatus,
    notes: "",
  }));
}

export function normalizeTestPlan(plan: QATestPlan): QATestPlan {
  const cases = Array.isArray(plan.cases)
    ? plan.cases.map((testCase) => ({
        ...testCase,
        status: (testCase.status || "not-run") as QATestCaseStatus,
      }))
    : [];
  return {
    ...plan,
    status: normalizeQaStatus(plan.status || qaStatusFromCases(cases)),
    cases,
    createdAt: plan.createdAt || new Date().toISOString(),
    updatedAt: plan.updatedAt || plan.createdAt || new Date().toISOString(),
  };
}

export function QATestPlansPanel({ projects, qaCards, readOnly = false, users = [], currentUser = null, artifacts = [] }: { projects: Project[]; qaCards: TicketCard[]; readOnly?: boolean; users?: User[]; currentUser?: User | null; artifacts?: BuildArtifactRecord[] }) {
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const [loadedArtifacts] = useProjectDeliveryList<BuildArtifactRecord>("build", projectIds);
  const builds = artifacts.length ? artifacts : loadedArtifacts;
  const [plans, setPlans, planSync] = useProjectDeliveryList<QATestPlan>("qa-plan", projectIds);
  const [sessions, setSessions] = useProjectDeliveryList<QASessionRecord>("qa-session", projectIds);
  const normalizedPlans = plans.map(normalizeTestPlan);
  const [selectedId, setSelectedId] = useState(normalizedPlans[0]?.id || "");
  const selectedPlan = normalizedPlans.find((plan) => plan.id === selectedId) || normalizedPlans[0];
  const restoreQaPlanDetail = useCallback((id: string | null) => setSelectedId(id || ""), []);
  const qaPlanDetailHistory = useClusterDetailHistory("qa-plan", selectedId || null, restoreQaPlanDetail);
  useEffect(() => {
    const requestedId = readClusterDetailSelection("qa-plan");
    if (!requestedId || planSync.loading) return;
    if (normalizedPlans.some((plan) => plan.id === requestedId)) return;
    recoverClusterDetailNavigation("qa-plan", { title: "QA plan unavailable", message: "That QA plan may have been removed, archived with its project, or your access may have changed. QA stayed open.", tone: "warning" });
  }, [planSync.loading, normalizedPlans]);
  const firstBuild = builds.find((artifact) => artifact.projectId === projects[0]?.id) || builds[0];
  const [form, setForm] = useState({
    title: "", projectId: firstBuild?.projectId || projects[0]?.id || "", buildId: firstBuild?.id || "", platform: firstBuild?.platform || "Windows", configuration: "default", suite: "general", environment: "Production-like", dueDate: "", template: "smoke", ownerId: currentUser?.id || "", testerIds: [] as string[],
  });
  const openQaCards = qaCards.filter((card) => !isClosedBoardWorkItem(card));
  const failedCases = normalizedPlans.reduce((sum, plan) => sum + plan.cases.filter((testCase) => testCase.status === "failed" || testCase.status === "blocked").length, 0);
  const passReady = normalizedPlans.filter((plan) => ["passed", "ready"].includes(plan.status)).length;
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const buildMap = useMemo(() => new Map(builds.map((build) => [build.id, build])), [builds]);
  const sessionsByPlan = useMemo(() => { const map = new Map<string, QASessionRecord[]>(); for (const session of sessions) if (session.planId) map.set(session.planId, [...(map.get(session.planId) || []), session]); return map; }, [sessions]);
  function persist(next: QATestPlan[]) { setPlans(next.map(normalizeTestPlan)); }
  function createPlan() {
    if (readOnly || !form.title.trim() || !form.buildId) return;
    const artifact = buildMap.get(form.buildId);
    if (!artifact) return;
    const owner = userMap.get(form.ownerId);
    const now = new Date().toISOString();
    const nextPlan: QATestPlan = {
      id: localId("qa-plan"), title: form.title.trim(), projectId: artifact.projectId, buildId: artifact.id, platform: form.platform || artifact.platform, configuration: form.configuration || "default", suite: form.suite || "general", environment: form.environment || "Production-like", dueDate: form.dueDate ? new Date(`${form.dueDate}T12:00:00`).toISOString() : null, template: form.template, owner: owner ? displayUserName(owner) : "Unassigned", ownerId: form.ownerId || null, testerIds: form.testerIds, status: "ready", cases: defaultQaCases(form.template), createdAt: now, updatedAt: now, revision: 0,
    };
    persist([nextPlan, ...normalizedPlans].slice(0, 80));
    qaPlanDetailHistory.openDetail(nextPlan.id);
    setForm((prev) => ({ ...prev, title: "" }));
  }
  function patchPlan(planId: string, patch: Partial<QATestPlan>) { if (!readOnly) persist(normalizedPlans.map((plan) => plan.id === planId ? { ...plan, ...patch, updatedAt: new Date().toISOString() } : plan)); }
  function updateCase(planId: string, caseId: string, patch: Partial<QATestCase>) {
    if (readOnly) return;
    persist(normalizedPlans.map((plan) => { if (plan.id !== planId) return plan; const cases = plan.cases.map((testCase) => testCase.id === caseId ? { ...testCase, ...patch, updatedAt: new Date().toISOString() } : testCase); return { ...plan, cases, status: qaStatusFromCases(cases), updatedAt: new Date().toISOString() }; }));
  }
  async function addCase(planId: string) {
    if (readOnly) return;
    const title = await promptCluster({ title: "Add test case", message: "Name the new QA test case.", label: "Test case title", confirmLabel: "Add case" });
    if (!title?.trim()) return;
    persist(normalizedPlans.map((plan) => plan.id === planId ? { ...plan, cases: [{ id: localId("qa-case"), title: title.trim(), expected: "Describe expected result", status: "not-run", priority: "medium", assigneeId: plan.ownerId || null }, ...plan.cases], updatedAt: new Date().toISOString() } : plan));
  }
  function logRun(plan: QATestPlan) {
    if (readOnly) return;
    const artifact = buildMap.get(plan.buildId);
    if (!artifact) return;
    const passed = plan.cases.filter((testCase) => testCase.status === "passed").length;
    const failed = plan.cases.filter((testCase) => testCase.status === "failed").length;
    const blocked = plan.cases.filter((testCase) => testCase.status === "blocked").length;
    const skipped = plan.cases.filter((testCase) => testCase.status === "skipped").length;
    const status: QASessionRecord["status"] = blocked ? "blocked" : failed ? "failed" : plan.cases.length && passed + skipped === plan.cases.length ? "passed" : "running";
    const decision: QASessionRecord["decision"] = blocked || failed ? "no-go" : status === "passed" ? "go" : "pending";
    const testerId = plan.testerIds?.[0] || plan.ownerId || currentUser?.id || null;
    const tester = testerId ? userMap.get(testerId) : null;
    const now = new Date().toISOString();
    const run: QASessionRecord = {
      id: localId("qa-session"), projectId: plan.projectId, buildId: artifact.id, planId: plan.id, retestOfSessionId: null, regressionBaseBuildId: artifact.previousBuildId || null, build: artifact.version, platform: plan.platform || artifact.platform, configuration: plan.configuration || "default", suite: plan.suite || "general", environment: plan.environment || "Production-like", scope: plan.template === "regression" ? "regression" : plan.template === "release" ? "certification" : "smoke", owner: tester ? displayUserName(tester) : plan.owner || "QA", ownerId: testerId, testerIds: plan.testerIds || [], status, decision, passed, failed, blocked, skipped, notes: `${passed}/${plan.cases.length} passed from ${plan.title}`, startedAt: now, completedAt: status === "running" ? null : now, signedOffBy: null, signedOffById: null, signedOffAt: null, sourceRevision: artifact.sourceRevision, sourceRepositoryId: artifact.sourceRepositoryId, sourceReviewId: artifact.sourceReviewId || null, createdAt: now, updatedAt: now, revision: 0,
    };
    setSessions((current) => [run, ...current]);
    patchPlan(plan.id, { status: qaStatusFromCases(plan.cases) });
  }
  function rerunFailures(plan: QATestPlan) { if (!readOnly) { const cases = plan.cases.map((testCase) => ["failed", "blocked"].includes(testCase.status) ? { ...testCase, status: "not-run" as QATestCaseStatus, updatedAt: new Date().toISOString() } : testCase); patchPlan(plan.id, { cases, status: qaStatusFromCases(cases) }); } }
  function schedulePlan(plan: QATestPlan) {
    const artifact = buildMap.get(plan.buildId); if (!artifact) return;
    const start = plan.dueDate ? new Date(plan.dueDate) : new Date(Date.now() + 24 * 60 * 60 * 1000); if (!plan.dueDate) start.setHours(10, 0, 0, 0); const end = new Date(start.getTime() + 90 * 60 * 1000);
    openSharedCreate("calendar", { projectId: plan.projectId, title: `QA plan: ${plan.title}`, details: `${artifact.version} · ${plan.platform} · ${plan.configuration || "default"} · ${plan.suite || "general"}`, assigneeId: plan.ownerId || currentUser?.id || "", attendeeIds: plan.testerIds || [], startsAt: start.toISOString(), endsAt: end.toISOString(), calendarType: "review", source: { kind: "qa_plan", id: plan.id, projectId: plan.projectId, label: plan.title }, relationship: "scheduled_by" });
  }
  function escalatePlan(plan: QATestPlan, mode: "bug" | "card") {
    const artifact = buildMap.get(plan.buildId); if (!artifact) return;
    const failed = plan.cases.filter((testCase) => ["failed", "blocked"].includes(testCase.status));
    openSharedCreate(mode, { projectId: plan.projectId, title: `${failed.length ? "QA failures" : "QA follow-up"}: ${plan.title}`, details: `Plan: ${plan.title}\nBuild: ${artifact.version} (${artifact.sourceRevision.slice(0, 12)})\nPlatform: ${plan.platform}\nConfiguration: ${plan.configuration || "default"}\nSuite: ${plan.suite || "general"}\nFailed/blocked: ${failed.length}\n\n${failed.slice(0, 8).map((testCase) => `• ${testCase.title}: ${testCase.expected}`).join("\n") || "Add follow-up details."}`, assigneeId: plan.ownerId || currentUser?.id || "", priority: failed.length ? "urgent" : "medium", labels: ["qa", plan.template, failed.length ? "failed" : "follow-up"], source: { kind: "qa_plan", id: plan.id, projectId: plan.projectId, label: plan.title }, relationship: "tracks" });
  }
  const selectedBuild = selectedPlan ? buildMap.get(selectedPlan.buildId) : null;
  const selectedRuns = selectedPlan ? (sessionsByPlan.get(selectedPlan.id) || []).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : [];
  return (
    <section className="panel qa-test-plans-v133">
      <div className="section-heading"><div><p className="eyebrow">QA planning</p><h2>Test plans and runs</h2><p className="muted tight">Plans target immutable Builds; execution history is first-class QA Sessions, not copied plan payload.</p></div><span className="soft-pill">{normalizedPlans.length} plans · {failedCases} blockers</span></div>
      <div className="qa-plan-kpis-v133"><ClusterButton unstyled type="button"><span>Plans</span><strong>{normalizedPlans.length}</strong><em>{passReady} ready/passed</em></ClusterButton><ClusterButton unstyled type="button" className={failedCases ? "danger" : "good"}><span>Failed/blocked cases</span><strong>{failedCases}</strong><em>{failedCases ? "Needs attention" : "Clean"}</em></ClusterButton><ClusterButton unstyled type="button"><span>QA sessions</span><strong>{sessions.length}</strong><em>{openQaCards.length} open QA cards</em></ClusterButton></div>
      <div className="qa-plan-layout-v133">
        <section className="qa-plan-create-v133">
          <fieldset className="qa-plan-form-v133" disabled={readOnly}>
            <div className="field"><label>Plan title</label><ClusterTextInput value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="RC1 regression pass" /></div>
            <div className="field"><label>Project</label><ClusterSelect value={form.projectId} onChange={(projectId) => { const build = builds.find((item) => item.projectId === projectId); setForm((prev) => ({ ...prev, projectId, buildId: build?.id || "", platform: build?.platform || prev.platform })); }} ariaLabel="QA plan project" options={projects.map((project) => ({ value: project.id, label: project.name }))} /></div>
            <div className="field"><label>Build</label><ClusterSelect value={form.buildId} onChange={(buildId) => { const build = buildMap.get(buildId); setForm((prev) => ({ ...prev, buildId, projectId: build?.projectId || prev.projectId, platform: build?.platform || prev.platform, ownerId: build?.ownerId || prev.ownerId, testerIds: build?.reviewerIds || prev.testerIds })); }} ariaLabel="QA plan build" options={[{ value: "", label: "Select first-class Build" }, ...builds.filter((build) => !form.projectId || build.projectId === form.projectId).map((build) => ({ value: build.id, label: `${build.version} · ${build.platform} · ${build.provenance.shortRevision || build.sourceRevision.slice(0, 10)}` }))]} /></div>
            <div className="field"><label>Platform</label><ClusterTextInput value={form.platform} onChange={(event) => setForm((prev) => ({ ...prev, platform: event.target.value }))} /></div>
            <div className="field"><label>Configuration</label><ClusterTextInput value={form.configuration} onChange={(event) => setForm((prev) => ({ ...prev, configuration: event.target.value }))} placeholder="Shipping" /></div>
            <div className="field"><label>Suite</label><ClusterTextInput value={form.suite} onChange={(event) => setForm((prev) => ({ ...prev, suite: event.target.value }))} placeholder="Core regression" /></div>
            <div className="field"><label>Environment</label><ClusterTextInput value={form.environment} onChange={(event) => setForm((prev) => ({ ...prev, environment: event.target.value }))} /></div>
            <div className="field"><label>Due date</label><ClusterTextInput type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} /></div>
            <div className="field"><label>Template</label><ClusterSelect value={form.template} onChange={(template) => setForm((prev) => ({ ...prev, template }))} ariaLabel="QA plan template" options={[{ value: "smoke", label: "Smoke" }, { value: "regression", label: "Regression" }, { value: "release", label: "Release certification" }]} /></div>
            <PeoplePicker label="Owner" value={form.ownerId} onChange={(ownerId) => setForm((prev) => ({ ...prev, ownerId }))} people={users} disabled={readOnly} /><PeopleMultiPicker label="Testers" values={form.testerIds} onChange={(testerIds) => setForm((prev) => ({ ...prev, testerIds }))} people={users} disabled={readOnly} />
            <ClusterButton variant="primary" disabled={!form.buildId || !form.title.trim()} onClick={createPlan}>Create test plan</ClusterButton>
          </fieldset>
          <div className="qa-plan-list-v133">{normalizedPlans.length ? normalizedPlans.map((plan) => { const build = buildMap.get(plan.buildId); return <ClusterButton unstyled type="button" key={plan.id} className={`${selectedPlan?.id === plan.id ? "active" : ""} ${plan.status}`} onClick={() => qaPlanDetailHistory.openDetail(plan.id)}><strong>{plan.title}</strong><span>{projects.find((project) => project.id === plan.projectId)?.name || "Project"} · {build?.version || "Missing Build"}</span><em>{levelLabel(plan.status)} · {plan.cases.length} cases · {(sessionsByPlan.get(plan.id) || []).length} sessions</em></ClusterButton>; }) : <ClusterEmptyState compact kind="empty" title="No QA plans" description="Create a QA plan for a Build to organize test coverage and sessions." />}</div>
        </section>
        {selectedPlan && <section className="qa-plan-detail-v133">
          <div className="qa-plan-detail-head-v133"><div><strong>{selectedPlan.title}</strong><span>{selectedPlan.platform} · {selectedPlan.configuration || "default"} · {selectedPlan.suite || "general"} · {selectedBuild?.version || "Missing Build"}</span></div><div className="button-row compact"><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => addCase(selectedPlan.id)}>Add case</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={readOnly || !selectedBuild} onClick={() => logRun(selectedPlan)}>Create QA session</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => rerunFailures(selectedPlan)}>Reset failures</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => schedulePlan(selectedPlan)}>Add to Calendar</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => escalatePlan(selectedPlan, "bug")}>Create Bug</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => escalatePlan(selectedPlan, "card")}>Create Card</ClusterButton><ClusterButton size="compact" variant="danger" disabled={readOnly || selectedRuns.length > 0} onClick={() => { persist(normalizedPlans.filter((plan) => plan.id !== selectedPlan.id)); qaPlanDetailHistory.closeDetail(); }}>Remove</ClusterButton></div></div>
          <div className="quality-field-grid-v309"><PeoplePicker label="Owner" value={selectedPlan.ownerId || ""} onChange={(ownerId) => { const owner = userMap.get(ownerId); patchPlan(selectedPlan.id, { ownerId: ownerId || null, owner: owner ? displayUserName(owner) : "Unassigned" }); }} people={users} disabled={readOnly} /><PeopleMultiPicker label="Testers" values={selectedPlan.testerIds || []} onChange={(testerIds) => patchPlan(selectedPlan.id, { testerIds })} people={users} disabled={readOnly} /></div>
          <CustomFieldValuesPanel compact entity="qa" entityId={selectedPlan.id} projectId={selectedPlan.projectId} title="QA fields" />
          <div className="qa-case-list-v133">{selectedPlan.cases.map((testCase) => <article key={testCase.id} className={testCase.status}><div><strong>{testCase.title}</strong><span>{testCase.expected}</span><PeoplePicker label="Assignee" value={testCase.assigneeId || ""} onChange={(assigneeId) => updateCase(selectedPlan.id, testCase.id, { assigneeId: assigneeId || null, assignee: assigneeId && userMap.get(assigneeId) ? displayUserName(userMap.get(assigneeId)!) : "" })} people={users} disabled={readOnly} /></div><ClusterSelect disabled={readOnly} value={testCase.status} onChange={(status) => updateCase(selectedPlan.id, testCase.id, { status: status as QATestCaseStatus })} ariaLabel={`Status for ${testCase.title}`} options={[{ value: "not-run", label: "Not run" }, { value: "passed", label: "Passed" }, { value: "failed", label: "Failed" }, { value: "blocked", label: "Blocked" }, { value: "skipped", label: "Skipped" }]} /></article>)}</div>
          <div className="qa-run-history-v133"><strong>First-class QA sessions</strong>{selectedRuns.length ? selectedRuns.slice(0, 8).map((run) => <span key={run.id}>{compactDateTime(run.startedAt)} · {levelLabel(run.status)} · {run.platform}/{run.configuration || "default"}/{run.suite || "general"} · {run.passed} passed / {run.failed + run.blocked} failed-blocked</span>) : <span>No QA sessions for this plan yet.</span>}</div>
          <WorkActionMenu context={{ source: { kind: "qa_plan", id: selectedPlan.id, projectId: selectedPlan.projectId, label: selectedPlan.title }, navigation: { screen: "project", projectId: selectedPlan.projectId, projectTab: "qa", inspectScope: "qa-plan", inspectId: selectedPlan.id }, projectId: selectedPlan.projectId }} label={`${selectedPlan.title} work actions`} /><LinkedWorkPanel projectId={selectedPlan.projectId} kind="qa_plan" entityId={selectedPlan.id} compact /><CollaborationPanel title="QA plan discussion" entityType="qa_plan" entityId={selectedPlan.id} users={users} currentUser={currentUser} compact />
        </section>}
      </div>
    </section>
  );
}

export function ReleaseNotesGenerator({ projects, buildRows: _buildRows }: { projects: Project[]; buildRows: Array<{ entry: TimelineEntry; lane: string; version: string; statusMeta: { label: string; tone: string } }> }) {
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const [builds] = useProjectDeliveryList<BuildArtifactRecord>("build", projectIds);
  const [sessions] = useProjectDeliveryList<QASessionRecord>("qa-session", projectIds);
  const [drafts, setDrafts, releaseSync] = useProjectDeliveryList<ReleaseNoteDraft>("release", projectIds);
  const [selectedBuildId, setSelectedBuildId] = useState(builds[0]?.id || "");
  const [titleOverride, setTitleOverride] = useState("");
  useEffect(() => { if ((!selectedBuildId || !builds.some((build) => build.id === selectedBuildId)) && builds[0]) setSelectedBuildId(builds[0].id); }, [builds, selectedBuildId]);
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) || builds[0] || null;
  const buildSessions = selectedBuild ? sessions.filter((session) => session.buildId === selectedBuild.id) : [];
  const latestDraft = drafts[0] || null;
  function generateDraft() {
    if (!selectedBuild) return;
    const sourceText = `${selectedBuild.changelog || ""}\n${selectedBuild.changes.commits.map((commit) => commit.message).join("\n")}`;
    const title = titleOverride.trim() || `${selectedBuild.title} release notes`;
    const features = splitReleaseNoteLines(sourceText.match(/(?:features?|added|new):([\s\S]*?)(?:fix|bug|known|$)/i)?.[1] || "", "Changes captured from synchronized source history");
    const fixes = splitReleaseNoteLines(sourceText.match(/(?:fix(?:ed|es)?|bugs?):([\s\S]*?)(?:known|issue|$)/i)?.[1] || "", selectedBuild.changes.commits.filter((commit) => /fix|bug|crash|regression/i.test(commit.message)).slice(0, 12).map((commit) => commit.message).join("\n") || "No explicit fixes extracted");
    const blockers = buildSessions.filter((session) => ["failed", "blocked"].includes(session.status) || session.decision === "no-go");
    const knownIssues = blockers.length ? blockers.map((session) => `${session.platform}/${session.configuration || "default"}/${session.suite || session.scope}: ${session.failed} failed, ${session.blocked} blocked`) : ["No ship-blocking QA sessions recorded"];
    const body = buildReleaseNoteBody({ title, buildVersion: selectedBuild.version, platform: selectedBuild.platform, sourceBranch: selectedBuild.sourceBranch, sourceRevision: selectedBuild.sourceRevision, qaStatus: selectedBuild.qaStatus, features, fixes, knownIssues });
    const now = new Date().toISOString();
    const draft: ReleaseNoteDraft = { id: localId("release"), projectId: selectedBuild.projectId, title, buildId: selectedBuild.id, buildVersion: selectedBuild.version, platform: selectedBuild.platform, qaStatus: selectedBuild.qaStatus, features, fixes, knownIssues, body, status: "draft", publishedAt: null, sourceRevision: selectedBuild.sourceRevision, sourceRepositoryId: selectedBuild.sourceRepositoryId, sourceReviewId: selectedBuild.sourceReviewId || null, createdAt: now, updatedAt: now, revision: 0 };
    setDrafts((current) => [draft, ...current].slice(0, 60));
  }
  function updateDraft(id: string, patch: Partial<ReleaseNoteDraft>) { setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch, updatedAt: new Date().toISOString() } : draft)); }
  return (
    <section className="panel release-notes-generator-v133">
      <div className="section-heading"><div><p className="eyebrow">Releases</p><h2>Build-linked release notes</h2><p className="muted tight">Drafts inherit immutable Build provenance and current QA state. Publishing is blocked server-side until QA passes and the Build is approved.</p></div><span className="soft-pill">{drafts.length} releases · {builds.length} Builds</span></div>
      {releaseSync.error ? <p className="inline-status danger" role="alert">{releaseSync.error}</p> : null}
      <div className="release-note-form-v133">
        <div className="field"><label>Build source</label><ClusterSelect value={selectedBuild?.id || ""} onChange={setSelectedBuildId} ariaLabel="Release Build source" options={[{ value: "", label: "Select first-class Build" }, ...builds.map((build) => ({ value: build.id, label: `${build.version} · ${build.platform} · ${build.provenance.shortRevision || build.sourceRevision.slice(0, 10)}` }))]} /></div>
        <div className="field"><label>Title override</label><ClusterTextInput value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)} placeholder={selectedBuild ? `${selectedBuild.title} release notes` : "Select a Build"} /></div>
        {selectedBuild ? <div className="field full"><label>Lineage</label><p className="muted tight">{selectedBuild.provenance.repositoryName} → {selectedBuild.sourceBranch} → {selectedBuild.provenance.shortRevision || selectedBuild.sourceRevision.slice(0, 12)}{selectedBuild.sourceReviewId ? ` → ${selectedBuild.provenance.reviewTitle || "review"}` : ""} → Build {selectedBuild.version} → {buildSessions.length} QA session(s)</p></div> : null}
        <ClusterButton type="button" disabled={!selectedBuild} onClick={generateDraft} variant="primary">Generate build-linked draft</ClusterButton>
      </div>
      <div className="release-note-layout-v133">
        <div className="release-note-draft-list-v133">{drafts.length ? drafts.slice(0, 12).map((draft) => <ClusterButton unstyled type="button" key={draft.id} className={`${draft.status} ${latestDraft?.id === draft.id ? "active" : ""}`} onClick={() => setDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)])}><strong>{draft.title}</strong><span>{draft.buildVersion} · {draft.platform} · {draft.sourceRevision.slice(0, 10)}</span><em>{levelLabel(draft.status)} · {compactDateTime(draft.updatedAt)}</em></ClusterButton>) : <ClusterEmptyState compact kind="empty" title="No release drafts" description="Create a release draft from an approved Build after its QA gates are satisfied." />}</div>
        {latestDraft ? <div className="release-note-editor-v133"><div className="release-note-editor-head-v133"><strong>{latestDraft.title}</strong><div className="button-row compact">{latestDraft.status !== "published" ? <ClusterButton type="button" onClick={() => updateDraft(latestDraft.id, { status: latestDraft.status === "draft" ? "review" : "published" })} variant="quiet" size="compact">{latestDraft.status === "review" ? "Publish" : "Send to review"}</ClusterButton> : <span className="soft-pill">Published · immutable</span>}{latestDraft.status !== "published" ? <ClusterButton type="button" onClick={() => setDrafts((current) => current.filter((draft) => draft.id !== latestDraft.id))} variant="quiet" size="compact">Remove</ClusterButton> : null}</div></div>{latestDraft.status === "published" ? <pre className="release-note-body-v491">{latestDraft.body}</pre> : <ClusterTextArea value={latestDraft.body} onChange={(event) => updateDraft(latestDraft.id, { body: event.target.value })} />}</div> : null}
      </div>
    </section>
  );
}

export function ProjectBudgetPanel({ projects }: { projects: Project[] }) {
  const [records, setRecords] = useState<Record<string, ProjectControlRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all(projects.map(async (project) => {
      const result = await api<{ records: ProjectControlRecord[] }>(`/api/projects/${encodeURIComponent(project.id)}/control-center`);
      return [project.id, (result.records || []).filter((record) => record.kind === "budget" && !record.archived)] as const;
    })).then((rows) => { if (active) { setRecords(Object.fromEntries(rows)); setError(""); } }).catch((caught) => { if (active) setError(formatApiError(caught)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projects.map((project) => `${project.id}:${project.revision || 0}`).join("|")]);
  const rows = projects.map((project) => {
    const budgets = records[project.id] || [];
    const planned = budgets.reduce((sum, record) => sum + Number(record.payload?.planned || 0), 0);
    const actual = budgets.reduce((sum, record) => sum + Number(record.payload?.actual || 0), 0);
    const forecast = budgets.reduce((sum, record) => sum + Number(record.payload?.forecast ?? record.payload?.actual ?? 0), 0);
    const currencies = [...new Set(budgets.map((record) => String(record.payload?.currency || "USD")))];
    return { project, budgets, planned, actual, forecast, currency: currencies.length === 1 ? currencies[0] : "mixed" };
  });
  const totalBudgetRecords = rows.reduce((sum, row) => sum + row.budgets.length, 0);
  return (
    <section className="panel project-budget-panel-v123">
      <div className="section-heading"><div><p className="eyebrow">Budgets</p><h2>Project Control budgets</h2><p className="muted tight">Cross-project budget visibility reads the same Project Control records used inside each project. Edit categories, owners, actuals, and forecasts in Project Control instead of maintaining a second budget database.</p></div><span className="soft-pill">{loading ? "Loading…" : `${totalBudgetRecords} canonical records`}</span></div>
      {error ? <div className="status-box error">{error}</div> : null}
      <div className="project-budget-list-v123">
        {rows.map((row) => <article key={row.project.id}><div><strong>{row.project.name}</strong><span>{row.budgets.length ? `${row.budgets.length} cost ${row.budgets.length === 1 ? "category" : "categories"}` : "No budget controls"} · {row.currency}</span><p>{row.budgets.length ? `Planned ${row.planned.toLocaleString()} · Actual ${row.actual.toLocaleString()} · Forecast ${row.forecast.toLocaleString()}` : "Add budget records from the project's Plan & Control workspace."}</p></div><em>{row.budgets.length ? `${row.forecast - row.planned >= 0 ? "+" : ""}${(row.forecast - row.planned).toLocaleString()} variance` : "Not configured"}</em></article>)}
      </div>
    </section>
  );
}

export function AdminSettingsCleanupPanel() {
  const groups: Array<{
    title: string;
    detail: string;
    tools?: Array<{
      label: string;
      meta: string;
      action: () => void;
      disabled?: boolean;
    }>;
  }> = [
    {
      title: "Workspace",
      detail: "Name, onboarding, first-run state, defaults.",
    },
    {
      title: "Users & Roles",
      detail: "Profiles, roles, external defaults, project permissions.",
    },
    {
      title: "Projects",
      detail: "Templates, project intake, archives, budgets.",
    },
    {
      title: "Tool Infrastructure",
      detail: "Timeline, Tickets, Calendar, Scheduler, and Library controls live in their dedicated administration area.",
    },
    { title: "Builds", detail: "Artifacts, lanes, gates, release notes." },
    {
      title: "Connections",
      detail: "Git, Discord, webhooks, automation routing.",
    },
    {
      title: "Backup & Restore",
      detail: "Backup policy, manifests, restore checkpoints.",
    },
    { title: "Appearance", detail: "Theme, density, font, surfaces, motion." },
    {
      title: "Server Configuration",
      detail: "Ports, hosts, security, upload limits, logs.",
    },
    {
      title: "Audit & Security",
      detail: "Permission tester, destructive actions, diffs.",
    },
  ];
  return (
    <section className="panel admin-settings-cleanup-v123">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settings architecture</p>
          <h2>Admin settings map</h2>
          <p className="muted tight">A cleaner admin structure so settings stop feeling like someone threw forms into a blender and called it enterprise.</p>
        </div>
        <span className="soft-pill">{groups.length} groups</span>
      </div>
      <div className="admin-settings-map-v123">
        {groups.map((group) => (
          <article key={group.title}>
            <strong>{group.title}</strong>
            <span>{group.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}


export function MeetingPlanner({ projects }: { projects: Project[] }) {
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const [meetings, setMeetings, meetingSync] = useProjectWorkflowList<MeetingRecord>("meeting", projectIds);
  const [form, setForm] = useState({
    projectId: projects[0]?.id || "",
    name: "Meeting 1",
    goal: "",
    start: new Date().toISOString().slice(0, 10),
    end: addDays(new Date(), 14).toISOString().slice(0, 10),
    capacity: "40",
    status: "planned" as MeetingRecord["status"],
  });
  function addMeeting() {
    if (!form.name.trim() || !form.projectId) return;
    setMeetings(
      [
        {
          id: localId("meeting"),
          ...form,
          name: form.name.trim(),
          createdAt: new Date().toISOString(),
        },
        ...meetings,
      ].slice(0, 80),
    );
    setForm((prev) => ({
      ...prev,
      name: `Meeting ${meetings.length + 2}`,
      goal: "",
    }));
  }
  const active = meetings.filter((meeting) => meeting.status !== "closed");
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name || "Studio";
  return (
    <section className="panel meeting-planner-v121">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Meetings & milestones</p>
          <h2>Planning units</h2>
          <p className="muted tight">Plan meetings, milestone windows, capacity targets, and review states before they become calendar fog.</p>
        </div>
        <span className="soft-pill">{active.length} active</span>
      </div>
      <div className="meeting-form-v121">
        <div className="field">
          <label>Name</label>
          <ClusterTextInput value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
        </div>
        <div className="field">
          <label>Project</label>
          <ClusterNativeSelect value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Start</label>
          <ClusterTextInput type="date" value={form.start} onChange={(event) => setForm((prev) => ({ ...prev, start: event.target.value }))} />
        </div>
        <div className="field">
          <label>End</label>
          <ClusterTextInput type="date" value={form.end} onChange={(event) => setForm((prev) => ({ ...prev, end: event.target.value }))} />
        </div>
        <div className="field">
          <label>Capacity hours</label>
          <ClusterTextInput value={form.capacity} onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))} />
        </div>
        <div className="field">
          <label>Status</label>
          <ClusterNativeSelect
            value={form.status}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                status: event.target.value as MeetingRecord["status"],
              }))
            }
          >
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="review">Review</option>
            <option value="closed">Closed</option>
          </ClusterNativeSelect>
        </div>
        <div className="field full">
          <label>Goal</label>
          <ClusterTextArea value={form.goal} onChange={(event) => setForm((prev) => ({ ...prev, goal: event.target.value }))} placeholder="Meeting agenda, decisions, owners, and follow-up work." />
        </div>
        <ClusterButton type="button" className="" onClick={addMeeting} variant="primary">
          Create meeting
        </ClusterButton>
      </div>
      {meetingSync.error && <div className="status-box error">{meetingSync.error}</div>}
      <div className="meeting-list-v121">
        {meetings.length ? (
          meetings.slice(0, 10).map((meeting) => (
            <article key={meeting.id} className={meeting.status}>
              <div>
                <strong>{meeting.name}</strong>
                <span>
                  {projectName(meeting.projectId)} · {meeting.start} → {meeting.end}
                </span>
                <p>{meeting.goal || "No goal yet."}</p>
              </div>
              <em>
                {meeting.capacity}h · {levelLabel(meeting.status)}
              </em>
              <ClusterButton type="button" className="" onClick={() => setMeetings(meetings.filter((item) => item.id !== meeting.id))} variant="quiet" size="compact">
                Remove
              </ClusterButton>
            </article>
          ))
        ) : (
          <div className="empty-state compact-empty">No meetings yet.</div>
        )}
      </div>
    </section>
  );
}

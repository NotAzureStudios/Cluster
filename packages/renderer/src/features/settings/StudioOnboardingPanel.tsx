import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioAudience } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { ClusterOperationFeedback } from "../../components/ClusterOperationFeedback";
import { RequestErrorState } from "../../components/RequestState";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";

const EVERYONE: StudioAudience = { mode: "all", targets: [] };
type StepKind = "packet" | "policy" | "form";
type StepDraft = { kind: StepKind; resourceId: string; required: boolean };
type ResourceOption = { id: string; label: string; kind: StepKind };
type Version = {
  id: string;
  versionLabel: string;
  status: string;
  assignmentCount: number;
  dueAfterDays?: number | null;
  reminderDaysBefore?: number | null;
  escalationDaysAfter?: number | null;
  steps?: Array<{ id: string; kind: StepKind; resourceLabel: string; resourceVersionLabel?: string | null; required: boolean }>;
};
type Plan = { id: string; key: string; title: string; description?: string | null; status: string; audience: StudioAudience; versions?: Version[] };
type AssignmentLifecycle = {
  status: "active" | "revoked" | "cancelled" | "superseded" | string;
  state: "active" | "complete" | "overdue" | "inactive" | string;
  dueAt?: string | null;
  overdue?: boolean;
  lastReminderAt?: string | null;
  escalatedAt?: string | null;
  lifecycleNote?: string | null;
};
type ReportPerson = {
  assignmentId: string;
  user: { id: string; username: string; displayName?: string | null; preferredName?: string | null };
  assignedAt: string;
  complete: number;
  total: number;
  requiredComplete: number;
  requiredTotal: number;
  done: boolean;
  lifecycle: AssignmentLifecycle;
  steps: Array<{ id: string; kind: StepKind; resourceLabel: string; resourceVersionLabel?: string | null; required: boolean; complete: boolean; completedAt?: string | null }>;
};
type OnboardingReport = { plan: { id: string; title: string }; version: Version; assigned: number; active: number; completed: number; overdue: number; people: ReportPerson[] };

function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "onboarding"; }
function optionalNumber(value: string) { const trimmed = value.trim(); return trimmed ? Number(trimmed) : null; }
function displayName(person: ReportPerson["user"]) { return person.preferredName || person.displayName || person.username; }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString() : "No due date"; }

export function StudioOnboardingPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [draft, setDraft] = useState({ title: "", key: "", description: "", audience: EVERYONE as StudioAudience });
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [versionLabel, setVersionLabel] = useState("1.0");
  const [dueAfterDays, setDueAfterDays] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState("3");
  const [escalationDaysAfter, setEscalationDaysAfter] = useState("1");
  const [supersedePreviousAssignments, setSupersedePreviousAssignments] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [newStep, setNewStep] = useState<StepDraft>({ kind: "packet", resourceId: "", required: true });
  const [reportData, setReportData] = useState<OnboardingReport | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const retryActionRef = useRef<null | (() => void)>(null);
  const actionInFlightRef = useRef(false);
  const selected = plans.find((plan) => plan.id === selectedPlanId) || null;
  const available = useMemo(() => resources.filter((resource) => resource.kind === newStep.kind), [resources, newStep.kind]);

  async function load(force = false) {
    setLoadError(null);
    const [onboarding, packetResult, formResult, policyResult] = await Promise.all([
      queryApi<{ plans: Plan[] }>("/api/studio-systems/onboarding", { force, staleMs: 5_000, tags: ["studio-systems", "onboarding"] }),
      queryApi<{ packets: Array<{ title: string; packetDefinition?: { id?: string; versionLabel?: string } }> }>("/api/packets", { force, staleMs: 10_000, tags: ["packets"] }),
      queryApi<{ forms: Array<{ title: string; status: string; versions?: Array<{ id: string; version: number; status: string }> }> }>("/api/studio-systems/forms", { force, staleMs: 10_000, tags: ["studio-systems", "forms"] }),
      queryApi<{ policies: Array<{ title: string; status: string; versions?: Array<{ id: string; versionLabel: string; status: string }> }> }>("/api/studio-systems/policies", { force, staleMs: 10_000, tags: ["studio-systems", "policies"] }),
    ]);
    setPlans(onboarding.plans || []);
    setSelectedPlanId((current) => onboarding.plans.some((plan) => plan.id === current) ? current : onboarding.plans[0]?.id || "");
    const next: ResourceOption[] = [];
    for (const packet of packetResult.packets || []) if (packet.packetDefinition?.id) next.push({ id: packet.packetDefinition.id, label: `${packet.title} · ${packet.packetDefinition.versionLabel || "1.0"}`, kind: "packet" });
    for (const form of formResult.forms || []) { const version = form.versions?.find((item) => item.status === "published"); if (form.status === "active" && version) next.push({ id: version.id, label: `${form.title} · v${version.version}`, kind: "form" }); }
    for (const policy of policyResult.policies || []) { const version = policy.versions?.find((item) => item.status === "published"); if (policy.status === "active" && version) next.push({ id: version.id, label: `${policy.title} · ${version.versionLabel}`, kind: "policy" }); }
    setResources(next);
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().catch((error) => { if (!cancelled) setLoadError(error); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { setReportData((current) => current && current.plan.id === selectedPlanId ? current : null); }, [selectedPlanId]);

  async function retryCommittedRefresh() {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusyAction("refresh");
    setActionError(null);
    setStatus("Refreshing onboarding state after the completed action…");
    retryActionRef.current = () => { void retryCommittedRefresh(); };
    try {
      await load(true);
      retryActionRef.current = null;
      setStatus("Onboarding state refreshed. The previous action was not repeated.");
    } catch (error) {
      setStatus("");
      setActionError(error);
    } finally {
      actionInFlightRef.current = false;
      setBusyAction(null);
    }
  }

  async function runAction<T>(key: string, workingMessage: string, action: () => Promise<T>, onSuccess: (result: T) => Promise<void> | void, readOnly = false) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusyAction(key);
    setActionError(null);
    setStatus(workingMessage);
    // A timed-out write may already have committed. Only read-only actions can be replayed.
    retryActionRef.current = readOnly
      ? () => { void runAction(key, workingMessage, action, onSuccess, true); }
      : () => { void retryCommittedRefresh(); };
    let result: T;
    try {
      result = await action();
    } catch (error) {
      setStatus("");
      setActionError(error);
      actionInFlightRef.current = false;
      setBusyAction(null);
      return;
    }

    // The write is committed at this point. Never let a failed follow-up read make Retry repeat it.
    retryActionRef.current = null;
    try {
      await onSuccess(result);
    } catch (error) {
      setStatus("");
      setActionError(error);
      retryActionRef.current = () => { void retryCommittedRefresh(); };
    } finally {
      actionInFlightRef.current = false;
      setBusyAction(null);
    }
  }

  async function createPlan() {
    if (!draft.title.trim() || (draft.audience.mode !== "all" && !draft.audience.targets.length)) return;
    const payload = { ...draft, key: slug(draft.key || draft.title) };
    await runAction("create-plan", "Creating onboarding plan…",
      () => api<Plan>("/api/studio-systems/onboarding", { method: "POST", body: JSON.stringify(payload) }),
      async (created) => {
        setDraft({ title: "", key: "", description: "", audience: EVERYONE });
        setSelectedPlanId(created.id);
        setStatus("Onboarding plan created.");
        await load(true);
      });
  }
  function addStep() {
    if (!newStep.resourceId || busyAction) return;
    setSteps((current) => current.some((step) => step.kind === newStep.kind && step.resourceId === newStep.resourceId)
      ? current : [...current, { ...newStep }]);
    setNewStep((current) => ({ ...current, resourceId: "" }));
  }
  function moveStep(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const other = index + direction;
      if (other < 0 || other >= current.length) return current;
      const next = [...current];
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  }
  async function publishVersion() {
    if (!selected || !steps.length || !versionLabel.trim()) return;
    const planId = selected.id;
    const payload = { versionLabel, steps: [...steps], publish: true, dueAfterDays: optionalNumber(dueAfterDays), reminderDaysBefore: optionalNumber(reminderDaysBefore), escalationDaysAfter: optionalNumber(escalationDaysAfter), supersedePreviousAssignments };
    await runAction("publish-version", "Publishing onboarding version…",
      () => api<{ assigned: number; superseded: number }>(`/api/studio-systems/onboarding/${planId}/versions`, { method: "POST", body: JSON.stringify(payload) }),
      async (result) => {
        setSteps([]);
        setSupersedePreviousAssignments(false);
        setStatus(`Published and assigned to ${result.assigned} people${result.superseded ? `; ${result.superseded} previous assignments superseded` : ""}.`);
        await load(true);
      });
  }
  async function reconcile(versionId: string) {
    await runAction(`reconcile:${versionId}`, "Reconciling onboarding audience…",
      () => api<{ eligible: number; assigned: number }>(`/api/studio-systems/onboarding/versions/${versionId}/assign`, { method: "POST" }),
      async (result) => {
        setStatus(`Audience reconciled: ${result.eligible} eligible, ${result.assigned} newly assigned.`);
        await load(true);
        if (reportData?.version.id === versionId) await loadReport(versionId, false, true);
      });
  }
  async function loadReport(versionId: string, announce = true, nested = false) {
    const execute = async () => {
      const result = await api<OnboardingReport>(`/api/studio-systems/onboarding/versions/${versionId}/report`);
      setReportData(result);
      if (announce) setStatus(`${result.completed} of ${result.assigned} assigned people completed all required steps · ${result.overdue} overdue.`);
      return result;
    };
    if (nested) { await execute(); return; }
    await runAction(`report:${versionId}`, "Loading onboarding progress…", execute, () => undefined, true);
  }
  async function changeLifecycle(person: ReportPerson, action: "revoke" | "cancel" | "reactivate") {
    const key = `lifecycle:${person.assignmentId}:${action}`;
    await runAction(key, `Updating ${displayName(person.user)} onboarding…`,
      () => api(`/api/studio-systems/onboarding/assignments/${person.assignmentId}/lifecycle`, { method: "PATCH", body: JSON.stringify({ action }) }),
      async () => {
        setStatus(`${displayName(person.user)} onboarding ${action === "reactivate" ? "reactivated" : action === "revoke" ? "revoked" : "cancelled"}.`);
        await load(true);
        if (reportData) await loadReport(reportData.version.id, false, true);
      });
  }
  async function runLifecycle() {
    await runAction("run-lifecycle", "Queueing onboarding lifecycle check…",
      () => api<{ queued: boolean; jobId: string }>("/api/studio-systems/onboarding/lifecycle/run", { method: "POST" }),
      (result) => { setStatus(result.queued ? "Lifecycle check queued through the durable job system. Progress will refresh as the worker completes it." : "Lifecycle check queued."); });
  }


  if (loading && !plans.length) return <div className="settings-card-v092" role="status" aria-live="polite"><span>Loading onboarding plans…</span></div>;
  if (loadError && !plans.length) return <RequestErrorState error={loadError} title="Onboarding could not be loaded" onRetry={() => { setLoading(true); setLoadError(null); void load(true).catch(setLoadError).finally(() => setLoading(false)); }} />;

  return <div className="studio-systems-layout-v34f"><aside className="studio-systems-list-v34f"><div className="studio-create-strip-v272 studio-systems-create-v34f"><div><strong>New onboarding plan</strong><span>Compose existing Packets, Policies, and Forms. Completion stays owned by those canonical systems.</span></div><ClusterInput value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, key: current.key || slug(event.target.value) }))} placeholder="Plan name" /><ClusterInput value={draft.key} onChange={(event) => setDraft((current) => ({ ...current, key: slug(event.target.value) }))} placeholder="onboarding-key" /><ClusterTextarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description" /><StudioAudiencePicker value={draft.audience} onChange={(audience) => setDraft((current) => ({ ...current, audience }))} compact /><ClusterButton type="button" variant="secondary" busy={busyAction === "create-plan"} disabled={Boolean(busyAction) || !draft.title.trim() || (draft.audience.mode !== "all" && !draft.audience.targets.length)} onClick={() => void createPlan()}>Create plan</ClusterButton></div><div className="studio-entity-list-v272">{plans.map((plan) => <ClusterButton type="button" key={plan.id} className={plan.id === selectedPlanId ? "active" : ""} onClick={() => setSelectedPlanId(plan.id)}><span className="studio-entity-list-copy-v272"><strong>{plan.title}</strong><small>{plan.status} · {plan.versions?.length || 0} versions</small></span></ClusterButton>)}</div></aside>
    <section className="studio-systems-editor-v34f">{actionError ? <RequestErrorState compact error={actionError} title="Onboarding action could not be completed" onRetry={() => retryActionRef.current?.()} /> : status ? <ClusterOperationFeedback state={busyAction ? "working" : "success"} message={status} /> : null}{selected ? <><header className="studio-entity-editor-head-v272"><div><span className="eyebrow">Composed onboarding</span><h3>{selected.title}</h3><p>{selected.description || "Build an ordered, version-bound onboarding sequence."}</p></div><ClusterButton type="button" size="compact" variant="quiet" busy={busyAction === "run-lifecycle"} disabled={Boolean(busyAction)} onClick={() => void runLifecycle()}>Run lifecycle check</ClusterButton></header><div className="settings-card-v092"><label className="field"><span>Version label</span><ClusterInput value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /></label><div className="button-row"><label className="field"><span>Due after days</span><ClusterInput type="number" min="1" value={dueAfterDays} onChange={(event) => setDueAfterDays(event.target.value)} placeholder="No due date" /></label><label className="field"><span>Remind days before</span><ClusterInput type="number" min="0" value={reminderDaysBefore} onChange={(event) => setReminderDaysBefore(event.target.value)} placeholder="None" /></label><label className="field"><span>Escalate days after</span><ClusterInput type="number" min="0" value={escalationDaysAfter} onChange={(event) => setEscalationDaysAfter(event.target.value)} placeholder="None" /></label></div><label><ClusterInput type="checkbox" checked={supersedePreviousAssignments} onChange={(event) => setSupersedePreviousAssignments(event.target.checked)} /> Supersede older active assignments for people receiving this version</label><div className="button-row"><ClusterNativeSelect value={newStep.kind} onChange={(event) => setNewStep({ kind: event.target.value as StepKind, resourceId: "", required: true })}><option value="packet">Packet</option><option value="policy">Policy</option><option value="form">Form</option></ClusterNativeSelect><ClusterNativeSelect value={newStep.resourceId} onChange={(event) => setNewStep((current) => ({ ...current, resourceId: event.target.value }))}><option value="">Choose resource…</option>{available.map((resource) => <option key={resource.id} value={resource.id}>{resource.label}</option>)}</ClusterNativeSelect><label><ClusterInput type="checkbox" checked={newStep.required} onChange={(event) => setNewStep((current) => ({ ...current, required: event.target.checked }))} /> Required</label><ClusterButton type="button" variant="secondary" disabled={!newStep.resourceId} onClick={addStep}>Add step</ClusterButton></div>{steps.map((step, index) => <div className="button-row" key={`${step.kind}:${step.resourceId}:${index}`}><strong>{index + 1}. {resources.find((resource) => resource.id === step.resourceId)?.label || step.resourceId}</strong><span>{step.required ? "Required" : "Optional"}</span><ClusterButton type="button" size="compact" variant="quiet" disabled={Boolean(busyAction) || index === 0} onClick={() => moveStep(index, -1)}>Move up</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" disabled={Boolean(busyAction) || index === steps.length - 1} onClick={() => moveStep(index, 1)}>Move down</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" disabled={Boolean(busyAction)} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</ClusterButton></div>)}<ClusterButton type="button" variant="primary" busy={busyAction === "publish-version"} disabled={Boolean(busyAction) || !steps.length || !versionLabel.trim()} onClick={() => void publishVersion()}>Publish version</ClusterButton></div><div className="studio-form-field-list-v34f">{selected.versions?.map((version) => <div className="settings-card-v092" key={version.id}><strong>{version.versionLabel} · {version.status}</strong><small>{version.assignmentCount || 0} assigned · {version.steps?.length || 0} steps · due {version.dueAfterDays == null ? "not set" : `${version.dueAfterDays}d`} · reminder {version.reminderDaysBefore == null ? "off" : `${version.reminderDaysBefore}d before`} · escalation {version.escalationDaysAfter == null ? "off" : `${version.escalationDaysAfter}d after`}</small>{version.steps?.map((step, index) => <span key={step.id}>{index + 1}. {step.resourceLabel}{step.resourceVersionLabel ? ` · ${step.resourceVersionLabel}` : ""}{step.required ? " · required" : ""}</span>)}{version.status === "published" && <div className="button-row"><ClusterButton type="button" size="compact" variant="secondary" busy={busyAction === `reconcile:${version.id}`} disabled={Boolean(busyAction)} onClick={() => void reconcile(version.id)}>Reconcile audience</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" busy={busyAction === `report:${version.id}`} disabled={Boolean(busyAction)} onClick={() => void loadReport(version.id)}>Progress</ClusterButton></div>}</div>)}</div>{reportData && <div className="settings-card-v092"><strong>{reportData.plan.title} · {reportData.version.versionLabel} progress</strong><small>{reportData.active} active · {reportData.completed}/{reportData.assigned} complete · {reportData.overdue} overdue</small><div className="studio-form-field-list-v34f">{reportData.people.map((person) => <div className="settings-card-v092" key={person.assignmentId}><strong>{displayName(person.user)}</strong><small>@{person.user.username} · {person.requiredComplete}/{person.requiredTotal} required · {person.lifecycle.state} · due {formatDate(person.lifecycle.dueAt)}</small>{person.lifecycle.lastReminderAt && <span>Reminder sent {formatDate(person.lifecycle.lastReminderAt)}</span>}{person.lifecycle.escalatedAt && <span>Escalated {formatDate(person.lifecycle.escalatedAt)}</span>}{person.lifecycle.lifecycleNote && <span>{person.lifecycle.lifecycleNote}</span>}{person.steps.map((step, index) => <span key={step.id}>{index + 1}. {step.resourceLabel}{step.resourceVersionLabel ? ` · ${step.resourceVersionLabel}` : ""} · {step.complete ? `complete${step.completedAt ? ` ${formatDate(step.completedAt)}` : ""}` : step.required ? "required" : "optional"}</span>)}<div className="button-row">{person.lifecycle.status === "active" ? <><ClusterButton type="button" size="compact" variant="quiet" disabled={Boolean(busyAction)} onClick={() => void changeLifecycle(person, "revoke")}>Revoke</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" disabled={Boolean(busyAction)} onClick={() => void changeLifecycle(person, "cancel")}>Cancel</ClusterButton></> : <ClusterButton type="button" size="compact" variant="secondary" disabled={Boolean(busyAction)} onClick={() => void changeLifecycle(person, "reactivate")}>Reactivate</ClusterButton>}</div></div>)}</div></div>}</> : <div className="settings-card-v092"><strong>Create an onboarding plan to begin.</strong></div>}</section></div>;
}

import { useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterProgressTracker } from "../../components/ClusterProgressTracker";
import { StudioFormRunner, type StudioFormDocument } from "../studio-systems/StudioFormRunner";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

type PolicyAction = {
  kind: "policy";
  policy: { id: string; title: string; summary?: string | null };
  version: { id: string; versionLabel: string; bodyMarkdown: string; acceptanceMode: "none" | "acknowledge" | "initials" | "signature" | "form"; formVersionId?: string | null };
  formDocument?: StudioFormDocument | null;
  existingFormSubmissionId?: string | null;
};
type StepAction =
  | { kind: "packet"; packetId: string; completionMode: string }
  | { kind: "form"; document: StudioFormDocument }
  | PolicyAction
  | { kind: "unavailable"; reason: string }
  | null;
export type OnboardingStep = { id: string; kind: "packet" | "policy" | "form"; resourceId: string; resourceLabel: string; resourceVersionLabel?: string | null; required: boolean; complete: boolean; completedAt?: string | null; action?: StepAction };
export type OnboardingPlan = { assignmentId: string; assignedAt: string; lifecycle: { status: string; state: string; dueAt?: string | null; overdue?: boolean; lastReminderAt?: string | null; escalatedAt?: string | null }; plan: { id: string; key: string; title: string; description?: string | null }; version: { id: string; versionLabel: string }; steps: OnboardingStep[]; progress: { complete: number; total: number; requiredComplete: number; requiredTotal: number; done: boolean } };

function OnboardingStepAction({ step, onRefresh }: { step: OnboardingStep; onRefresh: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [initials, setInitials] = useState("");
  const [signature, setSignature] = useState("");
  if (step.complete) return <span>Completed{step.completedAt ? ` · ${new Date(step.completedAt).toLocaleDateString()}` : ""}</span>;
  const action = step.action;
  if (!action) return <span className="muted">No action is currently available.</span>;
  if (action.kind === "unavailable") return <span className="muted">{action.reason}</span>;
  if (action.kind === "packet") return <ClusterButton type="button" size="compact" variant="primary" onClick={() => openClusterWorkNavigation({ screen: "packets", packetId: action.packetId })}>Open packet</ClusterButton>;
  if (action.kind === "form") return <StudioFormRunner document={action.document} submitLabel="Complete form" showHeading={false} submit={(payload) => api(`/api/forms/${action.document.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={() => void onRefresh()} />;
  const policyAction = action;

  async function accept(mode: PolicyAction["version"]["acceptanceMode"], extra: Record<string, unknown> = {}) {
    setPending(true); setError("");
    try { await api(`/api/studio-policies/${policyAction.version.id}/accept`, { method: "POST", body: JSON.stringify({ mode, ...extra }) }); await onRefresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The policy could not be accepted."); }
    finally { setPending(false); }
  }
  const mode = action.version.acceptanceMode;
  return <div className="settings-card-v092"><strong>{action.policy.title} · {action.version.versionLabel}</strong>{action.policy.summary && <span>{action.policy.summary}</span>}<pre className="settings-card-v092">{action.version.bodyMarkdown}</pre>
    {mode === "acknowledge" && <ClusterButton type="button" size="compact" variant="primary" disabled={pending} onClick={() => void accept("acknowledge")}>{pending ? "Saving…" : "Acknowledge"}</ClusterButton>}
    {mode === "initials" && <div className="button-row"><ClusterInput value={initials} maxLength={20} onChange={(event) => setInitials(event.target.value)} placeholder="Initials" /><ClusterButton type="button" size="compact" variant="primary" disabled={pending || !initials.trim()} onClick={() => void accept("initials", { initials })}>Accept</ClusterButton></div>}
    {mode === "signature" && <div className="button-row"><ClusterInput value={signature} maxLength={300} onChange={(event) => setSignature(event.target.value)} placeholder="Signature" /><ClusterButton type="button" size="compact" variant="primary" disabled={pending || !signature.trim()} onClick={() => void accept("signature", { signature })}>Sign</ClusterButton></div>}
    {mode === "form" && action.formDocument && !action.existingFormSubmissionId && <StudioFormRunner document={action.formDocument} showHeading={false} submitLabel="Complete policy form" submit={(payload) => api(`/api/forms/${action.formDocument!.form.key}/submissions`, { method: "POST", body: JSON.stringify(payload) })} onSubmitted={(result) => { const id = String(result.id || result.submissionId || ""); if (id) void accept("form", { formSubmissionId: id }); }} />}
    {mode === "form" && action.existingFormSubmissionId && <ClusterButton type="button" size="compact" variant="primary" disabled={pending} onClick={() => void accept("form", { formSubmissionId: action.existingFormSubmissionId })}>Accept with completed form</ClusterButton>}
    {mode === "none" && <span className="muted">No acceptance is required.</span>}
    {mode === "form" && !action.formDocument && !action.existingFormSubmissionId && <span className="muted">The required policy form is not available to your account.</span>}
    {error && <div className="error-box" role="alert">{error}</div>}
  </div>;
}

export function MyOnboardingPanel({ plans, onRefresh }: { plans: OnboardingPlan[]; onRefresh: () => Promise<void> | void }) {
  const active = plans.filter((plan) => !plan.progress.done);
  if (!plans.length) return null;
  return <section className="mywork-panel-v253"><header><div><h2>Onboarding</h2><span>{active.length ? `${active.length} active plan${active.length === 1 ? "" : "s"}` : "All required onboarding complete"}</span></div></header>
    <div className="studio-form-field-list-v34f">{plans.map((plan) => <article className="settings-card-v092" key={plan.assignmentId} id={`onboarding-${plan.assignmentId}`} data-onboarding-assignment={plan.assignmentId}><strong>{plan.plan.title}</strong>{plan.plan.description && <span>{plan.plan.description}</span>}<small>{plan.progress.requiredComplete}/{plan.progress.requiredTotal} required · {plan.progress.complete}/{plan.progress.total} total · {plan.lifecycle.overdue ? "overdue" : plan.lifecycle.dueAt ? `due ${new Date(plan.lifecycle.dueAt).toLocaleDateString()}` : "no due date"}</small>{plan.lifecycle.lastReminderAt && <span>Reminder sent {new Date(plan.lifecycle.lastReminderAt).toLocaleDateString()}</span>}{plan.lifecycle.escalatedAt && <span>Escalated {new Date(plan.lifecycle.escalatedAt).toLocaleDateString()}</span>}<ClusterProgressTracker label={`${plan.plan.title} progress`} compact steps={plan.steps.map((step) => ({ id: step.id, label: step.resourceLabel, state: step.complete ? "complete" : step.action?.kind === "unavailable" ? "blocked" : "pending" }))} />{plan.steps.map((step, index) => <div className="settings-card-v092" key={step.id}><strong>{index + 1}. {step.resourceLabel}</strong><small>{step.kind}{step.resourceVersionLabel ? ` · ${step.resourceVersionLabel}` : ""}{step.required ? " · required" : " · optional"}</small><OnboardingStepAction step={step} onRefresh={onRefresh} /></div>)}</article>)}</div>
  </section>;
}

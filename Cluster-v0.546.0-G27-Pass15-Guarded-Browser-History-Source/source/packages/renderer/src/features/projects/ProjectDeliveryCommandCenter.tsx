import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterField } from "../../components/ClusterField";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import "./project-quality.css";

type Gate = { id: string; label: string; required: boolean; passed: boolean; state: "passed" | "blocked" | "warning"; detail: string; resource?: ClusterResourceAddress | null };
type Decision = { id: string; gateId: string; decision: string; reviewerName?: string | null; reason?: string | null; createdAt?: string | null; expiresAt?: string | null };
type DeliverySnapshot = {
  generatedAt: string;
  releaseReady: boolean;
  recommendedAction: string;
  latestBuild?: { id: string; title?: string; version?: string; platform?: string; channel?: string; ownerId?: string | null } | null;
  regressionRisk?: string;
  readiness: { channel: string; policy: { projectType: string; source: string; requiredGateIds: string[]; optionalGateIds: string[] }; required: number; passed: number; blocked: number; canPublish: boolean; gates: Gate[]; activeHold?: Decision | null; latestReviewerDecision?: Decision | null; decisions: Decision[]; exceptions: Decision[] };
  orchestration: { calendarEvents: Array<{ id: string; title: string; startsAt: string; endsAt?: string | null; resource?: ClusterResourceAddress | null }>; scheduleBlocks: Array<{ id: string; title: string; startsAt: string; endsAt: string; resource?: ClusterResourceAddress | null }>; conflicts: Array<{ kind: string; id: string; title: string; startsAt: string }>; launchWindow?: { id: string; title: string; startsAt: string; endsAt?: string | null } | null };
  history?: { cycles: Array<{ id: string; version: string; platform?: string | null; qaHours?: number | null; releaseHours?: number | null; releasedAt?: string | null }>; averageQaHours?: number | null; averageReleaseHours?: number | null; failureCycles: number; clearedFailureCycles: number; releases: Array<{ id: string; title: string; status: string; buildVersion?: string; updatedAt?: string }> };
};

export function ProjectDeliveryCommandCenter({ projectId, canManage = false, canContribute = false, compact = false }: { projectId: string; canManage?: boolean; canContribute?: boolean; compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [exceptionGate, setExceptionGate] = useState("");
  const load = useCallback(async (force = false) => {
    try { setSnapshot(await queryApi<DeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle`, { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", projectId] })); setStatus(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Delivery readiness failed to load."); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeProjectWorkflowUpdate((detail) => { if (detail.projectId === projectId) void load(true); }), [projectId, load]);
  const blockedGates = useMemo(() => (snapshot?.readiness.gates || []).filter((gate) => gate.required && !gate.passed && gate.id !== "no_active_hold" && !["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "reviewer_approval"].includes(gate.id)), [snapshot]);
  useEffect(() => { if (!exceptionGate || !blockedGates.some((gate) => gate.id === exceptionGate)) setExceptionGate(blockedGates[0]?.id || ""); }, [blockedGates, exceptionGate]);
  async function decision(gateId: string, value: "approved" | "rejected" | "hold" | "cleared" | "exception") {
    if (!snapshot?.latestBuild?.id) return;
    if ((value === "hold" || value === "rejected" || value === "exception") && !reason.trim()) { setStatus("A reason is required for holds, rejections and exceptions."); return; }
    setBusy(`${gateId}:${value}`);
    try {
      const result = await api<{ snapshot: DeliverySnapshot }>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle/decisions`, { method: "POST", body: JSON.stringify({ buildId: snapshot.latestBuild.id, gateId, decision: value, reason: reason.trim() }) });
      setSnapshot(result.snapshot); setReason(""); setStatus(`Recorded ${value.replace(/_/g, " ")}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Delivery decision failed."); }
    finally { setBusy(""); }
  }
  async function orchestrate() {
    setBusy("orchestrate");
    try {
      const result = await api<{ snapshot: DeliverySnapshot }>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle/orchestrate`, { method: "POST", body: "{}" });
      setSnapshot(result.snapshot); setStatus("Delivery milestones synchronized to Calendar and Scheduler.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Delivery scheduling failed."); }
    finally { setBusy(""); }
  }
  if (!snapshot) return <section className={`project-delivery-command-v492 ${compact ? "compact" : ""}`}><p className="muted tight">{status || "Loading release readiness…"}</p>{status ? <ClusterButton size="compact" onClick={() => void load()}>Retry</ClusterButton> : null}</section>;
  const tone = snapshot.releaseReady ? "ready" : snapshot.readiness.activeHold ? "hold" : snapshot.readiness.blocked ? "blocked" : "pending";
  return <section className={`project-delivery-command-v492 tone-${tone} ${compact ? "compact" : ""}`}>
    <header className="project-delivery-command-head-v492">
      <div><p className="eyebrow">Release command center</p><h3>{snapshot.latestBuild ? `${snapshot.latestBuild.version || snapshot.latestBuild.title || "Build"} · ${snapshot.readiness.channel}` : "No delivery build"}</h3><span>{snapshot.recommendedAction}</span></div>
      <div className="project-delivery-command-metrics-v492"><strong>{snapshot.readiness.passed}/{snapshot.readiness.required}</strong><span>required gates</span><em>{snapshot.releaseReady ? "Ready to publish" : `${snapshot.readiness.blocked} blocked`}</em></div>
    </header>
    <div className="project-delivery-gates-v492">
      {snapshot.readiness.gates.map((gate) => <ClusterButton unstyled type="button" key={gate.id} className={`delivery-gate-v492 state-${gate.state}`} disabled={!clusterResourceNavigation(gate.resource)} onClick={() => { const target = clusterResourceNavigation(gate.resource); if (target) openClusterWorkNavigation(target); }} title={gate.detail}><span>{gate.required ? "Required" : "Optional"}</span><strong>{gate.label}</strong><em>{gate.detail}</em></ClusterButton>)}
    </div>
    <div className="project-delivery-command-grid-v492">
      <div className="project-delivery-command-panel-v492">
        <header><strong>Reviewer decisions</strong><span>{snapshot.readiness.latestReviewerDecision ? `${snapshot.readiness.latestReviewerDecision.reviewerName || "Reviewer"} · ${snapshot.readiness.latestReviewerDecision.decision}` : "No reviewer decision"}</span></header>
        {canManage ? <>
          <ClusterField label="Decision note" description="Required for holds and exceptions; retained in delivery history."><ClusterTextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason or release note" /></ClusterField>
          <p className="muted tight">Independent review is required. Build creators and owners cannot approve their own release. Core QA, fix, rebuild and hold gates cannot be waived.</p><div className="project-delivery-actions-v492"><ClusterButton size="compact" variant="primary" busy={busy === "reviewer_approval:approved"} onClick={() => void decision("reviewer_approval", "approved")}>Approve</ClusterButton><ClusterButton size="compact" variant="danger" busy={busy === "reviewer_approval:rejected"} onClick={() => void decision("reviewer_approval", "rejected")}>Reject</ClusterButton>{snapshot.readiness.activeHold ? <ClusterButton size="compact" busy={busy === "no_active_hold:cleared"} onClick={() => void decision("no_active_hold", "cleared")}>Clear hold</ClusterButton> : <ClusterButton size="compact" variant="danger" busy={busy === "no_active_hold:hold"} onClick={() => void decision("no_active_hold", "hold")}>Place hold</ClusterButton>}</div>
          {blockedGates.length ? <div className="project-delivery-exception-v492"><ClusterSelect value={exceptionGate} ariaLabel="Gate exception" options={blockedGates.map((gate) => ({ value: gate.id, label: gate.label, meta: gate.detail }))} onChange={setExceptionGate} /><ClusterButton size="compact" disabled={!exceptionGate || !reason.trim()} busy={busy === `${exceptionGate}:exception`} onClick={() => void decision(exceptionGate, "exception")}>Record exception</ClusterButton></div> : null}
        </> : <p className="muted tight">Project managers can record reviewer decisions, holds, and gate exceptions.</p>}
        <div className="project-delivery-decision-history-v492">{snapshot.readiness.decisions.slice(0, 6).map((item) => <span key={item.id}><strong>{item.gateId.replace(/_/g, " ")}</strong> · {item.decision} · {item.reviewerName || "Cluster"}{item.reason ? ` · ${item.reason}` : ""}</span>)}</div>
      </div>
      <div className="project-delivery-command-panel-v492">
        <header><strong>Delivery orchestration</strong><span>{snapshot.orchestration.calendarEvents.length} milestones · {snapshot.orchestration.conflicts.length} conflicts</span></header>
        <div className="project-delivery-milestones-v492">{snapshot.orchestration.calendarEvents.slice(0, 6).map((item) => <ClusterButton unstyled type="button" key={item.id} onClick={() => { const target = clusterResourceNavigation(item.resource); if (target) openClusterWorkNavigation(target); }}><strong>{item.title}</strong><span>{new Date(item.startsAt).toLocaleString()}</span></ClusterButton>)}</div>
        {snapshot.orchestration.conflicts.length ? <p className="project-delivery-conflict-v492">{snapshot.orchestration.conflicts.length} owner/tester/reviewer conflict{snapshot.orchestration.conflicts.length === 1 ? "" : "s"} overlap delivery windows.</p> : <p className="muted tight">No scheduling conflicts overlap generated delivery windows.</p>}
        {canContribute ? <ClusterButton size="compact" busy={busy === "orchestrate"} onClick={() => void orchestrate()}>{snapshot.orchestration.calendarEvents.length ? "Resync milestones" : "Schedule delivery milestones"}</ClusterButton> : null}
      </div>
      <div className="project-delivery-command-panel-v492">
        <header><strong>Delivery history</strong><span>{snapshot.history?.cycles.length || 0} build cycles</span></header>
        <dl className="project-delivery-history-metrics-v492"><div><dt>Build → QA</dt><dd>{snapshot.history?.averageQaHours == null ? "—" : `${snapshot.history.averageQaHours}h`}</dd></div><div><dt>Build → release</dt><dd>{snapshot.history?.averageReleaseHours == null ? "—" : `${snapshot.history.averageReleaseHours}h`}</dd></div><div><dt>Failure loops</dt><dd>{snapshot.history?.clearedFailureCycles || 0}/{snapshot.history?.failureCycles || 0}</dd></div><div><dt>Regression risk</dt><dd>{snapshot.regressionRisk || "none"}</dd></div></dl>
        <div className="project-delivery-cycle-list-v492">{snapshot.history?.cycles.slice(0, 5).map((cycle) => <span key={cycle.id}><strong>{cycle.version}</strong>{cycle.qaHours != null ? ` · QA ${cycle.qaHours}h` : " · QA pending"}{cycle.releaseHours != null ? ` · release ${cycle.releaseHours}h` : ""}</span>)}</div>
      </div>
    </div>
    <footer className="project-delivery-command-foot-v492"><span>Policy: {snapshot.readiness.policy.projectType} / {snapshot.readiness.channel} · {snapshot.readiness.policy.source.replace(/_/g, " ")}</span><span>{status || `Generated ${new Date(snapshot.generatedAt).toLocaleString()}`}</span></footer>
  </section>;
}

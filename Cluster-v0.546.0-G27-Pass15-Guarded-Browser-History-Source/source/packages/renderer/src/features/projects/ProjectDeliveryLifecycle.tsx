import { useCallback, useEffect, useState } from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";

type DeliveryStageState = "pending" | "active" | "complete" | "blocked";
type DeliveryStage = { id: string; label: string; state: DeliveryStageState; detail: string; target?: ClusterResourceAddress | null };
type DeliverySnapshot = { generatedAt: string; releaseReady: boolean; recommendedAction: string; stages: DeliveryStage[]; issues: { total: number; open: number; resolved: number; items?: Array<{ id: string; kind: "ticket" | "card"; title: string; done: boolean; ticketStage?: string; listTitle?: string; resource?: ClusterResourceAddress | null }> }; qa: { passed: number; failed: number; sessions: unknown[] }; latestBuild?: { id: string; version?: string; title?: string; platform?: string } | null; readiness?: { required: number; passed: number; blocked: number; evidenceComplete?: boolean; incompleteEvidence?: string[]; gates?: Array<{ id: string; label: string; required: boolean; passed: boolean; detail: string; resource?: ClusterResourceAddress | null }> }; orchestration?: { calendarEvents: Array<{ id: string; resource?: ClusterResourceAddress | null }>; scheduleBlocks: Array<{ id: string; resource?: ClusterResourceAddress | null }>; conflicts: unknown[] } };

export function ProjectDeliveryLifecycle({ projectId, compact = false, canContribute = false }: { projectId: string; compact?: boolean; canContribute?: boolean }) {
  const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (force = false) => {
    try { setSnapshot(await queryApi<DeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle`, { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", projectId] })); setStatus(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Delivery lifecycle failed to load."); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeProjectWorkflowUpdate((detail) => { if (detail.projectId === projectId) void load(true); }), [projectId, load]);
  async function orchestrate() {
    setBusy(true);
    try { const result = await api<{ snapshot: DeliverySnapshot }>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle/orchestrate`, { method: "POST", body: "{}" }); setSnapshot(result.snapshot); setStatus("Delivery milestones synchronized."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Delivery scheduling failed."); }
    finally { setBusy(false); }
  }
  if (!snapshot && !status) return <section className={`project-delivery-lifecycle-v492 ${compact ? "compact" : ""}`}><p className="muted tight">Loading delivery lifecycle…</p></section>;
  if (!snapshot) return <section className={`project-delivery-lifecycle-v492 ${compact ? "compact" : ""}`}><p className="muted tight">{status}</p><ClusterButton type="button" className="" onClick={() => void load()} variant="quiet" size="compact">Retry</ClusterButton></section>;
  return <section className={`project-delivery-lifecycle-v492 ${compact ? "compact" : ""}`}>
    <div className="project-delivery-lifecycle-head-v492"><div><p className="eyebrow">Delivery lifecycle</p><strong>{snapshot.recommendedAction}</strong></div><span className={`soft-pill ${snapshot.releaseReady ? "good" : ""}`}>{snapshot.releaseReady ? "Release ready" : snapshot.readiness?.blocked ? `${snapshot.readiness.blocked} blocked gate${snapshot.readiness.blocked === 1 ? "" : "s"}` : "Readiness incomplete"}</span></div>
    <div className="project-delivery-lifecycle-actions-v492">
      {snapshot.readiness ? <span>{snapshot.readiness.passed}/{snapshot.readiness.required} gates · {snapshot.orchestration?.conflicts.length || 0} schedule conflict{(snapshot.orchestration?.conflicts.length || 0) === 1 ? "" : "s"}</span> : null}
      <div>
        {clusterResourceNavigation(snapshot.orchestration?.calendarEvents[0]?.resource) ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(snapshot.orchestration?.calendarEvents[0]?.resource); if (target) openClusterWorkNavigation(target); }}>Calendar</ClusterButton> : null}
        {clusterResourceNavigation(snapshot.orchestration?.scheduleBlocks[0]?.resource) ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(snapshot.orchestration?.scheduleBlocks[0]?.resource); if (target) openClusterWorkNavigation(target); }}>Scheduler</ClusterButton> : null}
        {canContribute ? <ClusterButton size="compact" busy={busy} onClick={() => void orchestrate()}>{snapshot.orchestration?.calendarEvents.length ? "Resync gates" : "Schedule gates"}</ClusterButton> : null}
      </div>
    </div>
    {status ? <p className="project-delivery-lifecycle-status-v492">{status}</p> : null}
    {snapshot.readiness?.evidenceComplete === false ? <p role="alert" className="project-delivery-lifecycle-status-v492">Release blocked: delivery evidence is incomplete ({snapshot.readiness.incompleteEvidence?.join(", ") || "bounded history"}).</p> : null}
    {!snapshot.releaseReady && snapshot.readiness?.gates?.some((gate) => gate.required && !gate.passed) ? <div className="project-delivery-lifecycle-blockers-v492" aria-label="Blocking delivery gates">
      <strong>Before publishing</strong>
      {snapshot.readiness.gates.filter((gate) => gate.required && !gate.passed).slice(0, 5).map((gate) => <ClusterButton key={gate.id} size="compact" variant="quiet" disabled={!clusterResourceNavigation(gate.resource)} title={gate.detail} onClick={() => { const target = clusterResourceNavigation(gate.resource); if (target) openClusterWorkNavigation(target); }}>{gate.label}: {gate.detail}</ClusterButton>)}
    </div> : null}
    {!compact && snapshot.issues.items?.some((issue) => !issue.done) ? (
      <div className="project-delivery-open-fixes-g25" aria-label="Unresolved delivery work">
        <strong>Unresolved linked work</strong>
        <div>
          {snapshot.issues.items.filter((issue) => !issue.done).slice(0, 4).map((issue) => (
            <ClusterButton key={`${issue.kind}:${issue.id}`} type="button" size="compact" variant="quiet" disabled={!clusterResourceNavigation(issue.resource)}
              title={`${issue.title}: ${issue.kind === "ticket" ? `Ticket stage ${issue.ticketStage || "new"}` : `Board List ${issue.listTitle || "Open"}`}`}
              onClick={() => { const target = clusterResourceNavigation(issue.resource); if (target) openClusterWorkNavigation(target); }}>
              {issue.title} · {issue.kind === "ticket" ? `Ticket: ${(issue.ticketStage || "new").replaceAll("_", " ")}` : issue.listTitle || "Open"}
            </ClusterButton>
          ))}
        </div>
        {snapshot.issues.open > 4 ? <small>Showing the first four of {snapshot.issues.open} unresolved linked items.</small> : null}
      </div>
    ) : null}
    <div className="project-delivery-stage-track-v492">{snapshot.stages.map((item, index) => <ClusterButton unstyled key={item.id} type="button" className={`project-delivery-stage-v492 state-${item.state}`} disabled={!clusterResourceNavigation(item.target)} onClick={() => { const target = clusterResourceNavigation(item.target); if (target) openClusterWorkNavigation(target); }} title={item.detail}><span>{index + 1}</span><div><strong>{item.label}</strong><em>{item.detail}</em></div></ClusterButton>)}</div>
  </section>;
}

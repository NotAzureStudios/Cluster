import { useCallback, useEffect, useState } from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import "./delivery.css";

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
  if (!snapshot && !status) return <section className="dl" aria-busy="true"><p className="dl-muted">Loading delivery…</p></section>;
  if (!snapshot) return <section className="dl"><p className="dl-muted">{status}</p><ClusterButton type="button" onClick={() => void load()} variant="quiet" size="compact">Retry</ClusterButton></section>;
  const go = (resource?: ClusterResourceAddress | null) => { const target = clusterResourceNavigation(resource); if (target) openClusterWorkNavigation(target); };
  const blocking = snapshot.releaseReady ? [] : (snapshot.readiness?.gates || []).filter((gate) => gate.required && !gate.passed).slice(0, 5);
  const openWork = compact ? [] : (snapshot.issues.items || []).filter((issue) => !issue.done).slice(0, 5);
  const tone = snapshot.releaseReady ? "good" : blocking.length || snapshot.readiness?.evidenceComplete === false ? "danger" : "warning";
  const conflicts = snapshot.orchestration?.conflicts.length || 0;
  const calendar = snapshot.orchestration?.calendarEvents[0]?.resource;
  const scheduler = snapshot.orchestration?.scheduleBlocks[0]?.resource;
  /* Delivery at a glance: the next action, gates passed, the stage track,
     then what blocks publishing and what work is still open. */
  return <section className="dl" data-tone={tone} data-compact={compact || undefined}>
    <header className="dl-head">
      <i className="dl-dot" aria-hidden="true" />
      <strong>{snapshot.recommendedAction}</strong>
      {snapshot.readiness ? <span className="dl-gates" data-blocked={snapshot.readiness.blocked ? true : undefined} title={`${snapshot.readiness.passed} of ${snapshot.readiness.required} required gates passed`}>{snapshot.readiness?.blocked ? `${snapshot.readiness.blocked} blocked gate${snapshot.readiness.blocked === 1 ? "" : "s"}` : <><b>{snapshot.readiness.passed}</b>/{snapshot.readiness.required} gates</>}</span> : null}
      {conflicts ? <span className="dl-flag" title="Schedule conflicts">{conflicts} conflict{conflicts === 1 ? "" : "s"}</span> : null}
      <span className="dl-head__actions">
        {clusterResourceNavigation(calendar) ? <ClusterButton size="compact" variant="quiet" onClick={() => go(calendar)}>Calendar</ClusterButton> : null}
        {clusterResourceNavigation(scheduler) ? <ClusterButton size="compact" variant="quiet" onClick={() => go(scheduler)}>Scheduler</ClusterButton> : null}
        {canContribute ? <ClusterButton size="compact" variant="secondary" busy={busy} onClick={() => void orchestrate()}>{snapshot.orchestration?.calendarEvents.length ? "Resync gates" : "Schedule gates"}</ClusterButton> : null}
      </span>
    </header>
    <ol className="dl-track">{snapshot.stages.map((item) => <li key={item.id} data-state={item.state}>
      <ClusterButton unstyled type="button" disabled={!clusterResourceNavigation(item.target)} onClick={() => go(item.target)} title={item.detail}><i aria-hidden="true" /><span>{item.label}</span></ClusterButton>
    </li>)}</ol>
    {status ? <p className="dl-muted">{status}</p> : null}
    {snapshot.readiness?.evidenceComplete === false ? <p role="alert" className="dl-alert">Evidence incomplete{snapshot.readiness.incompleteEvidence?.length ? `: ${snapshot.readiness.incompleteEvidence.join(", ")}` : ""}</p> : null}
    {blocking.length || openWork.length ? <div className="dl-lists">
      {blocking.length ? <div aria-label="Blocking delivery gates">
        <h4>Blocking release</h4>
        <ul>{blocking.map((gate) => <li key={gate.id}><ClusterButton unstyled type="button" className="dl-row" data-tone="danger" disabled={!clusterResourceNavigation(gate.resource)} onClick={() => go(gate.resource)}><i aria-hidden="true" /><strong>{gate.label}</strong><small>{gate.detail}</small></ClusterButton></li>)}</ul>
      </div> : null}
      {openWork.length ? <div aria-label="Unresolved delivery work">
        <h4>Open work <span>{snapshot.issues.open}</span></h4>
        <ul>{openWork.map((issue) => <li key={`${issue.kind}:${issue.id}`}><ClusterButton unstyled type="button" className="dl-row" data-tone="warning" disabled={!clusterResourceNavigation(issue.resource)} onClick={() => go(issue.resource)}><i aria-hidden="true" /><strong>{issue.title}</strong><small>{issue.kind === "ticket" ? (issue.ticketStage || "new").replaceAll("_", " ") : issue.listTitle || "Open"}</small></ClusterButton></li>)}</ul>
      </div> : null}
    </div> : null}
  </section>;
}

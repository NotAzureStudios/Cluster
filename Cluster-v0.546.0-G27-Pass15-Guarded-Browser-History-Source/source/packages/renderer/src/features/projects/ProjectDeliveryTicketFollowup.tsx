import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { queryApi } from "../../core/api";
import { subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { createSupersedingDeliveryRebuild } from "./project-delivery-actions";

type DeliveryIssue = { id: string; kind: "card" | "ticket"; title: string; done: boolean };
type DeliveryCycle = {
  failedBuild?: { id: string; title: string; version?: string; resource?: ClusterResourceAddress | null } | null;
  failedQa?: { id: string; resource?: ClusterResourceAddress | null } | null;
  issues: DeliveryIssue[];
  openFixes: number;
  resolvedFixes: number;
  rebuildRequired: boolean;
  regressionRisk: string;
  nextAction: string;
  rebuild?: { id: string; title?: string; resource?: ClusterResourceAddress | null } | null;
};
type DeliverySnapshot = { failures?: DeliveryCycle[] };

export function ProjectDeliveryTicketFollowup({ projectId, ticketId, resolved, creatorLabel = "" }: { projectId: string; ticketId: string; resolved: boolean; creatorLabel?: string }) {
  const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (force = false) => {
    if (!projectId || !ticketId) return;
    try { setSnapshot(await queryApi<DeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle`, { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", projectId] })); }
    catch { setSnapshot(null); }
  }, [projectId, ticketId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeProjectWorkflowUpdate((detail) => {
    if (!detail.projectId || detail.projectId === projectId) void load(true);
  }), [load, projectId]);
  const cycle = useMemo(() => (snapshot?.failures || []).find((item) => item.issues?.some((issue) => issue.id === ticketId)) || null, [snapshot, ticketId]);
  if (!cycle?.failedBuild) return null;
  const risk = String(cycle.regressionRisk || "medium").toLowerCase();
  const canCreateRebuild = resolved && cycle.openFixes === 0 && cycle.rebuildRequired && !cycle.rebuild;
  const failedBuild = cycle.failedBuild;
  async function createRebuild() {
    if (!canCreateRebuild || busy) return;
    setBusy(true);
    setStatus("Creating superseding rebuild…");
    try {
      const result = await createSupersedingDeliveryRebuild({ projectId, failedBuildId: failedBuild.id, creatorLabel });
      setStatus(result.existing ? "A superseding rebuild already exists." : "Superseding rebuild created with resolved fixes attached.");
      await load(true);
      const target = clusterResourceNavigation(result.resource); if (target) openClusterWorkNavigation(target);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The rebuild could not be created.");
    } finally { setBusy(false); }
  }
  return (
    <section className={`project-delivery-ticket-followup-v492 risk-${risk}`} aria-label="Delivery follow-up">
      <div className="project-delivery-risk-head-v492">
        <div>
          <span>Delivery follow-up</span>
          <strong>{cycle.failedBuild.version || cycle.failedBuild.title}</strong>
        </div>
        <span className="tag-chip">{risk} risk</span>
      </div>
      <p className="muted">{cycle.nextAction}</p>
      <div className="project-delivery-risk-metrics-v492">
        <span><strong>{cycle.resolvedFixes}</strong> resolved</span>
        <span><strong>{cycle.openFixes}</strong> open</span>
      </div>
      <div className="button-row compact">
        {clusterResourceNavigation(cycle.rebuild?.resource) ? <ClusterButton size="compact" variant="secondary" onClick={() => { const target = clusterResourceNavigation(cycle.rebuild?.resource); if (target) openClusterWorkNavigation(target); }}>Open rebuild</ClusterButton> : null}
        {canCreateRebuild ? <ClusterButton size="compact" variant="primary" disabled={busy} onClick={() => void createRebuild()}>{busy ? "Creating…" : "Create rebuild"}</ClusterButton> : null}
        {!cycle.rebuild && clusterResourceNavigation(cycle.failedBuild.resource) ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(cycle.failedBuild?.resource); if (target) openClusterWorkNavigation(target); }}>Failed build</ClusterButton> : null}
      </div>
      {status ? <p className="inline-status">{status}</p> : null}
    </section>
  );
}

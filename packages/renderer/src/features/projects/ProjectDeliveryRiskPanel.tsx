import { useCallback, useEffect, useState } from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { queryApi } from "../../core/api";
import { subscribeProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { ClusterButton } from "../../components/ClusterButton";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";

type FailureIssue = { id: string; kind: "card" | "ticket"; title: string; priority: string; done: boolean; resource?: ClusterResourceAddress | null };
type FailureCycle = {
  id: string;
  failedQa: { id: string; build: string; scope: string; resource?: ClusterResourceAddress | null };
  failedBuild?: { id: string; title: string; version?: string; resource?: ClusterResourceAddress | null } | null;
  issues: FailureIssue[];
  openFixes: number;
  resolvedFixes: number;
  rebuild?: { id: string; title: string; version?: string; qaPassed?: boolean; resource?: ClusterResourceAddress | null } | null;
  rebuildRequired: boolean;
  regressionRisk: "critical" | "high" | "medium" | "low" | "cleared";
  regressionReasons: string[];
  nextAction: string;
  cleared: boolean;
};
type DeliverySnapshot = { failures?: FailureCycle[] };

export function ProjectDeliveryRiskPanel({ projectId, kind, entityId }: { projectId: string; kind: "build" | "qa_session"; entityId: string }) {
  const [cycle, setCycle] = useState<FailureCycle | null>(null);
  const load = useCallback(async (force = false) => {
    try {
      const snapshot = await queryApi<DeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle`, { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", projectId] });
      const match = (snapshot.failures || []).find((item) => kind === "qa_session"
        ? item.failedQa.id === entityId
        : item.failedBuild?.id === entityId || item.rebuild?.id === entityId) || null;
      setCycle(match);
    } catch { setCycle(null); }
  }, [projectId, kind, entityId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeProjectWorkflowUpdate((detail) => { if (detail.projectId === projectId) void load(true); }), [projectId, load]);
  if (!cycle) return null;
  const firstOpen = cycle.issues.find((issue) => !issue.done);
  const riskLabel = cycle.regressionRisk === "cleared" ? "Cleared" : cycle.regressionRisk[0].toUpperCase() + cycle.regressionRisk.slice(1);
  return <section className={`project-delivery-risk-v492 risk-${cycle.regressionRisk}`}>
    <div className="project-delivery-risk-head-v492"><div><span>Regression risk</span><strong>{riskLabel}</strong></div><div><span>Next action</span><strong>{cycle.nextAction}</strong></div></div>
    <div className="project-delivery-risk-metrics-v492"><span><b>{cycle.openFixes}</b> open fixes</span><span><b>{cycle.resolvedFixes}</b> resolved</span><span><b>{cycle.rebuild ? "1" : "0"}</b> rebuild</span></div>
    {cycle.regressionReasons.length ? <ul>{cycle.regressionReasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="muted tight">The failure loop has passing rebuild evidence and no unresolved linked fixes.</p>}
    <div className="button-row">
      {clusterResourceNavigation(firstOpen?.resource) ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(firstOpen?.resource); if (target) openClusterWorkNavigation(target); }}>Open fix</ClusterButton> : null}
      {clusterResourceNavigation(cycle.rebuild?.resource) ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(cycle.rebuild?.resource); if (target) openClusterWorkNavigation(target); }}>Open rebuild</ClusterButton> : null}
      {clusterResourceNavigation(cycle.failedQa.resource) && kind === "build" ? <ClusterButton size="compact" variant="quiet" onClick={() => { const target = clusterResourceNavigation(cycle.failedQa.resource); if (target) openClusterWorkNavigation(target); }}>Open failed QA</ClusterButton> : null}
    </div>
  </section>;
}

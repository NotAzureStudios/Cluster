import { ClusterButton } from "../../components/ClusterButton";
import type { ProductionEvidenceGate } from "./project-production-readiness";

export function ProjectProductionEvidenceBar({ gates, ready, total, blockers, onOpenBuilds, onOpenQa }: { gates: ProductionEvidenceGate[]; ready: number; total: number; blockers: number; onOpenBuilds?: () => void; onOpenQa?: () => void }) {
  return <section className="project-production-evidence-v495" aria-label="Production delivery evidence">
    <header>
      <div><span>Delivery evidence</span><strong>{blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : `${ready}/${total} ready`}</strong></div>
      <div className="project-production-evidence-actions-v495">
        {onOpenBuilds ? <ClusterButton size="compact" variant="quiet" onClick={onOpenBuilds}>Builds</ClusterButton> : null}
        {onOpenQa ? <ClusterButton size="compact" variant="quiet" onClick={onOpenQa}>QA</ClusterButton> : null}
      </div>
    </header>
    <div className="project-production-evidence-grid-v495">
      {gates.map((gate) => <article key={gate.id} className={`tone-${gate.tone}`} data-ready={gate.ready ? "true" : "false"}>
        <span>{gate.label}</span>
        <strong>{gate.value}</strong>
        <small>{gate.detail}</small>
      </article>)}
    </div>
  </section>;
}

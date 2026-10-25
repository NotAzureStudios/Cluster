import type { ReactNode } from "react";
import { ClusterStatus, type ClusterStatusTone } from "./ClusterStatus";

export type ClusterProgressStep = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  state: "complete" | "current" | "pending" | "blocked" | "error";
};

function toneForStep(state: ClusterProgressStep["state"]): ClusterStatusTone {
  if (state === "complete") return "good";
  if (state === "current") return "info";
  if (state === "blocked") return "warning";
  if (state === "error") return "danger";
  return "neutral";
}

export function ClusterProgressTracker({ steps, label, compact = false, className = "" }: { steps: readonly ClusterProgressStep[]; label: string; compact?: boolean; className?: string }) {
  return (
    <ol className={`cluster-action-group-v425 ${className}`.trim()} aria-label={label} data-motion-purpose="progress">
      {steps.map((step, index) => (
        <li key={step.id} aria-current={step.state === "current" ? "step" : undefined}>
          <ClusterStatus tone={toneForStep(step.state)} compact={compact} dot><span>{index + 1}. {step.label}</span></ClusterStatus>
          {step.description ? <small className="muted">{step.description}</small> : null}
        </li>
      ))}
    </ol>
  );
}

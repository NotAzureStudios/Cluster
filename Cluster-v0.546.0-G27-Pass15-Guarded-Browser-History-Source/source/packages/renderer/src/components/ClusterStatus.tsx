import type { HTMLAttributes, ReactNode } from "react";
import { clusterStateTone, type ClusterInteractionState, type ClusterStateTone } from "./interaction-state";

export type ClusterStatusTone = ClusterStateTone;

type ClusterStatusProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ClusterStatusTone;
  state?: ClusterInteractionState;
  compact?: boolean;
  dot?: boolean;
  children: ReactNode;
};

export function ClusterStatus({ tone, state = "default", compact = false, dot = false, className = "", children, ...props }: ClusterStatusProps) {
  const resolvedTone = tone || clusterStateTone(state);
  return <span {...props} data-cluster-state={state} data-motion-purpose="state" className={`cluster-status-v425 ${resolvedTone} ${compact ? "compact" : ""} ${className}`.trim()}>
    {dot ? <i className="cluster-status-dot-v425" aria-hidden="true" /> : null}<span>{children}</span>
  </span>;
}

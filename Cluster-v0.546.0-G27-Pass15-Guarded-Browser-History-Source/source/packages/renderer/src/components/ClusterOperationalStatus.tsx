import type { ReactNode } from "react";
import { ClusterStatus } from "./ClusterStatus";
import type { ClusterOperationalStatusModel } from "./operational-status";

function checkedLabel(value: ClusterOperationalStatusModel["lastCheckedAt"]) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `Checked ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ClusterOperationalStatus({ model, compact = false, actions, className = "" }: { model: ClusterOperationalStatusModel; compact?: boolean; actions?: ReactNode; className?: string }) {
  const checked = checkedLabel(model.lastCheckedAt);
  return <div className={`cluster-operational-status-v433 ${compact ? "compact" : ""} ${className}`.trim()} data-operational-state={model.state} data-cluster-state={model.interactionState} role={model.interactionState === "error" || model.interactionState === "conflict" ? "alert" : "status"}>
    <div className="cluster-operational-status-main-v433">
      <ClusterStatus state={model.interactionState} compact={compact} dot>{model.label}</ClusterStatus>
      {!compact && <span>{model.detail}</span>}
    </div>
    <div className="cluster-operational-status-meta-v433">
      {model.pendingCount ? <small>{model.pendingCount} pending</small> : null}
      {model.conflictCount ? <small>{model.conflictCount} review</small> : null}
      {checked ? <small>{checked}</small> : null}
      {actions}
    </div>
  </div>;
}

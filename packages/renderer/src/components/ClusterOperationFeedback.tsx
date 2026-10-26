import type { ReactNode } from "react";
import { ClusterStatus } from "./ClusterStatus";
import type { ClusterActionFeedbackState } from "./useClusterActionFeedback";

export function ClusterOperationFeedback({
  state,
  message,
  detail,
  progress,
  children,
}: {
  state: ClusterActionFeedbackState | "warning";
  message: ReactNode;
  detail?: ReactNode;
  progress?: number | null;
  children?: ReactNode;
}) {
  const numericProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
  const tone = state === "error" ? "danger" : state === "success" ? "good" : state === "warning" ? "warning" : state === "working" ? "info" : "neutral";
  return <div className="cluster-operation-feedback-v1" data-motion-purpose="progress" data-feedback-state={state} role={state === "error" ? "alert" : "status"} aria-live={state === "error" ? "assertive" : "polite"}>
    <ClusterStatus tone={tone} state={state === "working" ? "loading" : state === "error" ? "error" : state === "success" ? "success" : state === "warning" ? "warning" : "default"}>{message}</ClusterStatus>
    {numericProgress != null ? <progress value={numericProgress} max={100} aria-label={`${numericProgress}% complete`} /> : null}
    {detail ? <small>{detail}</small> : null}
    {children}
  </div>;
}

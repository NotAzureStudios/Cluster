import { type ComponentProps, type ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";
import { useClusterActionFeedback } from "./useClusterActionFeedback";

export function ClusterActionButton({
  action,
  children,
  workingLabel = "Working…",
  successLabel = "Done",
  errorLabel = "Try again",
  resetAfterMs = 1600,
  optimistic,
  rollback,
  onSuccess,
  onError,
  ...props
}: Omit<ComponentProps<typeof ClusterButton>, "onClick" | "busy" | "busyLabel" | "state"> & {
  action: () => Promise<unknown> | unknown;
  children: ReactNode;
  workingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  resetAfterMs?: number;
  optimistic?: () => unknown;
  rollback?: (snapshot: unknown, error: unknown) => Promise<void> | void;
  onSuccess?: (result: unknown) => Promise<void> | void;
  onError?: (error: unknown) => void;
}) {
  const feedback = useClusterActionFeedback({ resetAfterMs, labels: { working: workingLabel, success: successLabel, error: errorLabel } });
  const label = feedback.state === "working" ? workingLabel : feedback.state === "success" ? successLabel : feedback.state === "error" ? (feedback.errorStage === "commit" ? "Check result" : errorLabel) : children;
  const state = feedback.state === "working" ? "loading" : feedback.state === "success" ? "success" : feedback.state === "error" ? "error" : "default";

  return (
    <>
      <ClusterButton {...props} motionPurpose="feedback" busy={feedback.busy} state={state} onClick={() => void feedback.run({ action, optimistic, rollback, commit: onSuccess, onError })}>{label}</ClusterButton>
      <span className="sr-only-v204" aria-live={feedback.state === "error" ? "assertive" : "polite"}>{feedback.message}</span>
    </>
  );
}

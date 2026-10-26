import { useCallback, useEffect, useRef, useState } from "react";
import { playClusterUiSound } from "../core/cluster-sounds";
import { executeClusterActionTransaction } from "./cluster-action-transaction";

export type ClusterActionFeedbackState = "idle" | "working" | "success" | "error";
export type ClusterActionErrorStage = "optimistic" | "action" | "commit" | null;

type Labels = Partial<Record<Exclude<ClusterActionFeedbackState, "idle">, string>>;

export function useClusterActionFeedback({
  resetAfterMs = 1600,
  labels = {},
}: {
  resetAfterMs?: number;
  labels?: Labels;
} = {}) {
  const [state, setState] = useState<ClusterActionFeedbackState>("idle");
  const [message, setMessage] = useState("");
  const [errorStage, setErrorStage] = useState<ClusterActionErrorStage>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  const clearResetTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const reset = useCallback(() => {
    // Resetting UI feedback is not permission to start another in-flight write.
    if (runningRef.current) return;
    clearResetTimer();
    if (!mountedRef.current) return;
    setState("idle");
    setMessage("");
    setErrorStage(null);
  }, [clearResetTimer]);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    if (!mountedRef.current) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!runningRef.current && mountedRef.current) {
        setState("idle");
        setMessage("");
        setErrorStage(null);
      }
    }, Math.max(300, resetAfterMs));
  }, [clearResetTimer, resetAfterMs]);

  const run = useCallback(async <T,>({
    action,
    optimistic,
    rollback,
    commit,
    onError,
  }: {
    action: () => Promise<T> | T;
    optimistic?: () => unknown;
    rollback?: (snapshot: unknown, error: unknown) => Promise<void> | void;
    commit?: (result: T) => Promise<void> | void;
    onError?: (error: unknown) => void;
  }): Promise<T | undefined> => {
    // A synchronous lock is needed: React hasn't rendered `busy` yet on the
    // second click, and an earlier success/error timer must not reset this run.
    if (runningRef.current) return undefined;
    runningRef.current = true;
    clearResetTimer();
    if (mountedRef.current) {
      setState("working");
      setMessage(labels.working || "Working…");
      setErrorStage(null);
    }
    try {
      const result = await executeClusterActionTransaction({ action, optimistic, rollback, commit });
      if (result.ok) {
        if (mountedRef.current) {
          setState("success");
          setMessage(labels.success || "Done");
          playClusterUiSound("confirm");
        }
        return result.value;
      }
      if (mountedRef.current) {
        setErrorStage(result.stage);
        setState("error");
        const explanation = result.stage === "commit"
          ? "The operation may have completed. Check its result before retrying."
          : result.rollbackError !== undefined
            ? "Action failed and its local changes could not be restored. Refresh before retrying."
            : labels.error || "Action failed";
        setMessage(explanation);
        playClusterUiSound("error");
        try { onError?.(result.error); } catch { /* feedback callbacks must not strand the action lock */ }
      }
      return undefined;
    } finally {
      runningRef.current = false;
      if (mountedRef.current) scheduleReset();
    }
  }, [clearResetTimer, labels.error, labels.success, labels.working, scheduleReset]);

  return { state, message, errorStage, busy: state === "working", run, reset };
}

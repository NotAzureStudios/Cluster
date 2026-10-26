import { useCallback, useEffect, useRef, useState } from "react";
import { requireConfirmedMenuOutcome, type ClusterMenuAction, type ClusterMenuActionResult } from "./cluster-menu-action-outcome";

/**
 * Single-flight execution for an entire action surface, not merely one ID.
 * A rapid click on two different menu items must never create two mutations.
 * The lock is set synchronously, before React can commit the busy state.
 */
export function useClusterMenuExecution() {
  const activeRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback((id: string, action: ClusterMenuAction, onSuccess: () => void) => {
    if (activeRef.current !== null) return;
    if (!id.trim()) {
      setError("The action is missing an identifier.");
      return;
    }
    activeRef.current = id;
    setPendingId(id);
    setError(null);
    // Invoke during the originating user gesture (clipboard, popups and other
    // browser-gated operations require this), but normalize sync/async errors.
    let result: ClusterMenuActionResult | Promise<ClusterMenuActionResult>;
    try { result = action(); }
    catch {
      activeRef.current = null;
      if (mountedRef.current) {
        setPendingId(null);
        setError("Could not confirm this action. Check its result before trying again.");
      }
      return;
    }
    void Promise.resolve(result).then((outcome) => {
      requireConfirmedMenuOutcome(outcome);
      if (mountedRef.current) onSuccess();
    }).catch(() => {
      if (mountedRef.current) setError("Could not confirm this action. Check its result before trying again.");
    }).finally(() => {
      activeRef.current = null;
      if (mountedRef.current) setPendingId(null);
    });
  }, []);

  // This synchronous read is for dismissal handlers that may run before React
  // commits the pending state. A render snapshot is not a mutation fence.
  const isExecuting = useCallback(() => activeRef.current !== null, []);
  return { pendingId, error, execute, busy: pendingId !== null, isExecuting };
}

import { useCallback, useEffect, useRef, useState } from "react";

/** Prevent overlapping Undo/Redo mutations before React can render disabled buttons. */
export function useClusterHistoryExecution() {
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const execute = useCallback((action: () => void | Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError("");
    // Run synchronously to preserve user gesture semantics, while guarding
    // against both synchronous throws and asynchronous failures.
    let result: void | Promise<void>;
    try { result = action(); }
    catch { pendingRef.current = false; if (mountedRef.current) { setBusy(false); setError("Could not confirm this change. Check the result before retrying."); } return; }
    void Promise.resolve(result).catch(() => {
      if (mountedRef.current) setError("Could not confirm this change. Check the result before retrying.");
    }).finally(() => { pendingRef.current = false; if (mountedRef.current) setBusy(false); });
  }, []);
  const isExecuting = useCallback(() => pendingRef.current, []);
  return { busy, error, execute, isExecuting };
}

import { useCallback, useRef, useState } from "react";
import { createClusterActionRunGate } from "../core/cluster-action-run-gate";

/** Local UI feedback and single-flight execution for async actions. The server remains the final authority. */
export function useClusterMutationGate() {
  const gate = useRef(createClusterActionRunGate());
  const [pendingKeys, setPendingKeys] = useState<readonly string[]>([]);
  const run = useCallback(<T,>(key: string, action: () => Promise<T> | T) => {
    if (gate.current.has(key)) return gate.current.run(key, action);
    setPendingKeys((keys) => [...keys, key]);
    return gate.current.run(key, action).finally(() => {
      setPendingKeys((keys) => keys.filter((item) => item !== key));
    });
  }, []);
  const isPending = useCallback((key: string) => pendingKeys.includes(key), [pendingKeys]);
  return { run, isPending, anyPending: pendingKeys.length > 0 };
}

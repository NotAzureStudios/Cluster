import { useCallback, useEffect, useRef, useState } from "react";
import { createClusterActionFlight } from "./cluster-action-flight";

/** Keep an immediate mutation lock and a separately rendered pending label. */
export function useClusterActionFlight() {
  const gate = useRef(createClusterActionFlight());
  const mounted = useRef(true);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const begin = useCallback((id: string): boolean => {
    if (!gate.current.enter(id)) return false;
    if (mounted.current) setPending(id);
    return true;
  }, []);
  const finish = useCallback((id: string): void => {
    if (gate.current.leave(id) && mounted.current) setPending(null);
  }, []);
  const isExecuting = useCallback(() => gate.current.isActive(), []);
  return { pending, begin, finish, isExecuting };
}

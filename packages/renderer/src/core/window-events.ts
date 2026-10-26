import { useEffect, useRef } from "react";

/**
 * Owns one stable browser event subscription while always dispatching to the
 * latest render's handler. This avoids listener teardown/rebind churn for app-
 * wide custom events whose handlers depend on changing workspace state.
 */
export function useWindowEvent(type: string, handler: (event: Event) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const listener = (event: Event) => handlerRef.current(event);
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }, [type, enabled]);
}

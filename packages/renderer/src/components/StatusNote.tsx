import { useEffect, useState, type ReactNode } from "react";

const PROBLEM = /fail|error|could not|couldn't|unavailable|denied|invalid|conflict|rejected|blocked/i;

/** Transient page status ("Updated 8:01 AM", "Saved"). Confirmations fade
 * after a few seconds and stay readable by assistive tech; problems stay
 * on screen until the status changes. */
export function StatusNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  const text = typeof children === "string" ? children : "";
  const problem = PROBLEM.test(text);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    if (problem) return;
    const timer = window.setTimeout(() => setVisible(false), 3500);
    return () => window.clearTimeout(timer);
  }, [text, problem]);
  return <div className={`status-box system-status-box-v053 ${className}`.trim()} role={problem ? "alert" : "status"} aria-live="polite" data-faded={!visible || undefined}>{children}</div>;
}

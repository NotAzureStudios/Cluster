import type { HTMLAttributes, ReactNode } from "react";
import type { ClusterInteractionState } from "./interaction-state";

export function ClusterToolbar({ label, role = "toolbar", state = "default", className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; state?: ClusterInteractionState; children: ReactNode }) {
  return <div {...props} data-cluster-state={state} className={`cluster-toolbar-v425 ${className}`.trim()} role={role} aria-label={label}>{children}</div>;
}

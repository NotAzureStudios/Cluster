import type { HTMLAttributes, ReactNode } from "react";
import type { ClusterInteractionState } from "./interaction-state";

type ClusterFieldState = Extract<ClusterInteractionState, "default" | "disabled" | "loading" | "success" | "warning" | "error" | "stale" | "conflict">;

export function ClusterField({ label, htmlFor, description, error, required = false, state = "default", className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & {
  label: ReactNode; htmlFor?: string; description?: ReactNode; error?: ReactNode; required?: boolean; state?: ClusterFieldState; children: ReactNode;
}) {
  const resolvedState: ClusterFieldState = error ? "error" : state;
  return <div {...props} data-cluster-state={resolvedState} className={`cluster-field-v425 ${error ? "invalid" : ""} ${className}`.trim()}>
    <label htmlFor={htmlFor} className="cluster-field-label-v425"><span>{label}</span>{required ? <em aria-hidden="true">Required</em> : null}</label>
    {children}
    {error ? <small className="cluster-field-message-v425 error" role="alert">{error}</small> : description ? <small className="cluster-field-message-v425">{description}</small> : null}
  </div>;
}

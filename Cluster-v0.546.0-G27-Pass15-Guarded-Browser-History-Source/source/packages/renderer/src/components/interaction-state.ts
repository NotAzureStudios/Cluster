export const CLUSTER_INTERACTION_STATES = [
  "default",
  "hover",
  "focus",
  "pressed",
  "selected",
  "disabled",
  "loading",
  "success",
  "warning",
  "error",
  "offline",
  "stale",
  "conflict",
] as const;

export type ClusterInteractionState = (typeof CLUSTER_INTERACTION_STATES)[number];
export type ClusterOperationalState = Exclude<ClusterInteractionState, "default" | "hover" | "focus" | "pressed" | "selected" | "disabled">;
export type ClusterStateTone = "neutral" | "info" | "good" | "warning" | "danger";

export function resolveClusterInteractionState({
  state = "default",
  selected = false,
  disabled = false,
  busy = false,
}: {
  state?: ClusterInteractionState;
  selected?: boolean;
  disabled?: boolean;
  busy?: boolean;
} = {}): ClusterInteractionState {
  if (busy) return "loading";
  if (disabled) return "disabled";
  if (selected) return "selected";
  return state;
}

export function clusterStateTone(state: ClusterInteractionState): ClusterStateTone {
  if (state === "success") return "good";
  if (state === "warning" || state === "offline" || state === "stale") return "warning";
  if (state === "error" || state === "conflict") return "danger";
  if (state === "loading" || state === "selected" || state === "focus" || state === "pressed") return "info";
  return "neutral";
}

export const CLUSTER_LIFECYCLE_RISKS = ["routine", "sensitive", "destructive"] as const;
export type ClusterLifecycleRisk = (typeof CLUSTER_LIFECYCLE_RISKS)[number];

export type ClusterLifecycleTransition<TState extends string = string> = {
  to: TState;
  label?: string | null;
  description?: string | null;
  risk?: ClusterLifecycleRisk;
  requirements?: readonly string[];
};

export type ClusterLifecycleDefinition<TState extends string = string> = {
  id: string;
  label: string;
  states: readonly TState[];
  initialState: TState;
  terminalStates: readonly TState[];
  transitions: Readonly<Record<TState, readonly ClusterLifecycleTransition<TState>[]>>;
};

export type ClusterLifecycleTransitionEvaluation<TState extends string = string> = {
  lifecycleId: string;
  from: TState;
  to: TState;
  allowed: boolean;
  transition?: ClusterLifecycleTransition<TState> | null;
  reasonCode: "SAME_STATE" | "TRANSITION_ALLOWED" | "TRANSITION_NOT_ALLOWED";
  message: string;
};

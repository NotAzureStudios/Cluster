import { createClusterExplanation } from "@cluster/shared";
import type {
  ClusterExplanation,
  ClusterLifecycleDefinition,
  ClusterLifecycleTransitionEvaluation,
} from "@cluster/shared";

export type StateTransitionMap<TState extends string> = Readonly<Record<TState, readonly TState[]>>;

export class InvalidStateTransitionError<TState extends string = string> extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
  constructor(
    public readonly machine: string,
    public readonly from: TState,
    public readonly to: TState,
  ) {
    super(`${machine} cannot transition from ${from} to ${to}.`);
    this.name = "InvalidStateTransitionError";
  }
}

export function lifecycleTransitionMap<TState extends string>(definition: ClusterLifecycleDefinition<TState>): StateTransitionMap<TState> {
  return Object.fromEntries(definition.states.map((state) => [state, definition.transitions[state].map((transition) => transition.to)])) as unknown as StateTransitionMap<TState>;
}

export function evaluateLifecycleTransition<TState extends string>(
  definition: ClusterLifecycleDefinition<TState>,
  from: TState,
  to: TState,
): ClusterLifecycleTransitionEvaluation<TState> {
  if (from === to) return {
    lifecycleId: definition.id,
    from,
    to,
    allowed: true,
    transition: null,
    reasonCode: "SAME_STATE",
    message: `${definition.label} is already ${to}.`,
  };
  const transition = definition.transitions[from]?.find((candidate) => candidate.to === to) || null;
  return {
    lifecycleId: definition.id,
    from,
    to,
    allowed: Boolean(transition),
    transition,
    reasonCode: transition ? "TRANSITION_ALLOWED" : "TRANSITION_NOT_ALLOWED",
    message: transition
      ? transition.description || `${definition.label} may transition from ${from} to ${to}.`
      : `${definition.label} cannot transition from ${from} to ${to}.`,
  };
}

export function explainLifecycleTransition<TState extends string>(
  definition: ClusterLifecycleDefinition<TState>,
  from: TState,
  to: TState,
): ClusterExplanation {
  const evaluation = evaluateLifecycleTransition(definition, from, to);
  return createClusterExplanation({
    code: evaluation.reasonCode,
    title: evaluation.allowed ? "Transition available" : "Transition unavailable",
    summary: evaluation.message,
    outcome: evaluation.allowed,
    reasons: evaluation.transition?.requirements?.length
      ? evaluation.transition.requirements.map((requirement) => `Requires ${requirement}.`)
      : [evaluation.message],
    evidence: [{
      kind: "lifecycle-transition",
      label: `${from} → ${to}`,
      detail: evaluation.transition?.label || evaluation.message,
      metadata: { lifecycleId: definition.id, risk: evaluation.transition?.risk || "routine" },
    }],
    metadata: { lifecycleId: definition.id, from, to },
  });
}

export function assertLifecycleTransition<TState extends string>(
  definition: ClusterLifecycleDefinition<TState>,
  from: TState,
  to: TState,
) {
  const evaluation = evaluateLifecycleTransition(definition, from, to);
  if (!evaluation.allowed) throw new InvalidStateTransitionError(definition.id, from, to);
}

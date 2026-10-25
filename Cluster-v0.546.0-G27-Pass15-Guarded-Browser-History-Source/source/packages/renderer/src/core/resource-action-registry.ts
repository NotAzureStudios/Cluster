import { CLUSTER_RESOURCE_MANIFEST, type ClusterResourceKind } from "@cluster/shared";
import type { ClusterActionMenuItem } from "../components/ClusterContextActions";
import type { ClusterMenuActionResult } from "../components/cluster-menu-action-outcome";

export type ClusterActionTarget = { kind: ClusterResourceKind; id: string; projectId?: string | null };

/**
 * A UI adapter over the canonical resource and command vocabularies, not a
 * second authorization engine or network command dispatcher. Domain owners
 * register real handlers; the server still authorizes every sensitive action.
 */
export type ClusterResourceAction = Omit<ClusterActionMenuItem, "disabled" | "onSelect"> & {
  resourceKinds: readonly ClusterResourceKind[];
  /** Explicit permission decision supplied by the domain that owns the action. */
  allowed: (target: ClusterActionTarget) => boolean;
  available?: (target: ClusterActionTarget) => boolean;
  unavailableReason?: string;
  onSelect: (target: ClusterActionTarget) => ClusterMenuActionResult | Promise<ClusterMenuActionResult>;
};

export function resolveClusterResourceActions(
  target: ClusterActionTarget,
  actions: readonly ClusterResourceAction[],
): ClusterActionMenuItem[] {
  const resource = CLUSTER_RESOURCE_MANIFEST[target.kind];
  if (!resource || !target.id.trim() || (resource.projectScoped && !("standaloneAllowed" in resource && resource.standaloneAllowed) && !target.projectId?.trim())) return [];
  const seen = new Set<string>();
  const resolved: ClusterActionMenuItem[] = [];
  for (const action of actions) {
    if (!action.id.trim() || seen.has(action.id) || !action.resourceKinds.includes(target.kind)) continue;
    seen.add(action.id);
    // Hidden rather than disabled for denied actions: do not disclose privileged commands.
    if (!action.allowed(target)) continue;
    const disabled = action.available ? !action.available(target) : false;
    resolved.push({
      id: action.id,
      label: action.label,
      description: disabled ? (action.unavailableReason || action.description) : action.description,
      icon: action.icon,
      danger: action.danger,
      separatorBefore: action.separatorBefore,
      disabled,
      onSelect: () => action.onSelect(target),
    });
  }
  return resolved;
}


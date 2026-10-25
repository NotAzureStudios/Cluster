import type { ClusterAdminConfigurableToolId, ClusterResourceChange, ClusterResourceKind } from "@cluster/shared";
import { TOOL_AVAILABILITY } from "../access/configurable-tool-availability.js";

/**
 * The shared change feed remains online while individual Studio tools are
 * suspended. Only events owned by an enabled tool may be exposed to clients.
 * This is the same six-switch authority used for API admission and TD2 work.
 * It does not reinterpret per-user permissions as tool availability.
 */
export const RESOURCE_CHANGE_TOOL_OWNERS = {
  timeline: "timeline",
  ticket: "tickets",
  meeting: "calendar",
  calendar: "calendar",
  scheduler: "scheduler",
  library: "library",
  file: "library",
  packet: "packets",
} as const satisfies Partial<Record<ClusterResourceKind, ClusterAdminConfigurableToolId>>;

export function resourceChangeToolOwner(kind: ClusterResourceKind): ClusterAdminConfigurableToolId | null {
  return (RESOURCE_CHANGE_TOOL_OWNERS as Partial<Record<ClusterResourceKind, ClusterAdminConfigurableToolId>>)[kind] ?? null;
}

export function enabledResourceChanges(
  changes: readonly ClusterResourceChange[],
  isEnabled: (tool: ClusterAdminConfigurableToolId) => boolean,
): ClusterResourceChange[] {
  return changes.filter((change) => {
    const owner = resourceChangeToolOwner(change.resource.kind);
    return !owner || isEnabled(owner);
  });
}

/**
 * A stream advances its cursor even over withheld events. On any tool-toggle
 * transition it MUST reset/reconcile clients, including on re-enable, rather
 * than assume the skipped sequence range will be replayed automatically.
 */
export function resourceChangeToolAvailabilityFingerprint(
  isEnabled: (tool: ClusterAdminConfigurableToolId) => boolean,
): string {
  return (Object.keys(TOOL_AVAILABILITY) as ClusterAdminConfigurableToolId[])
    .map((tool) => `${tool}:${isEnabled(tool) ? "1" : "0"}`)
    .join("|");
}

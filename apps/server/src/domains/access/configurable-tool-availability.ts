import type { ClusterAdminConfigurableToolId } from "@cluster/shared";

/** Only true studio-level kill switches belong here. Personal tool permissions are separate. */
export const TOOL_AVAILABILITY = {
  timeline: { flag: "timelineEnabled", label: "Timeline" },
  tickets: { flag: "ticketsEnabled", label: "Tickets" },
  calendar: { flag: "calendarEnabled", label: "Calendar" },
  scheduler: { flag: "schedulerEnabled", label: "Scheduler" },
  library: { flag: "libraryEnabled", label: "Library" },
  packets: { flag: "packetsEnabled", label: "Packets" },
} as const satisfies Record<ClusterAdminConfigurableToolId, { flag: string; label: string }>;

export const CONFIGURABLE_TOOL_SETTING_FLAGS = Object.values(TOOL_AVAILABILITY).map((definition) => definition.flag);

export function isConfigurableToolCapability(tool: string | null | undefined): tool is ClusterAdminConfigurableToolId {
  return typeof tool === "string" && Object.prototype.hasOwnProperty.call(TOOL_AVAILABILITY, tool);
}

/** Unknown/non-configurable capabilities do not acquire a fake availability switch. */
export function disabledConfigurableToolLabel(tool: string | null | undefined, settings: Record<string, unknown>): string | null {
  if (!isConfigurableToolCapability(tool)) return null;
  const definition = TOOL_AVAILABILITY[tool];
  return settings[definition.flag] === false ? definition.label : null;
}

/** Reconcile each available Studio tool against its persisted kill switch.
 * Permissions are separate; this is intentionally not a user authorization API. */
export function reconcileConfigurableToolOwners(
  settings: Record<string, unknown>,
  setEnabled: (tool: ClusterAdminConfigurableToolId, enabled: boolean) => void,
  changedKeys?: readonly string[],
) {
  for (const tool of Object.keys(TOOL_AVAILABILITY) as ClusterAdminConfigurableToolId[]) {
    const flag = TOOL_AVAILABILITY[tool].flag;
    if (changedKeys && !changedKeys.includes(flag)) continue;
    setEnabled(tool, settings[flag] !== false);
  }
}

import { CLUSTER_CREATE_MODE_IDS } from "@cluster/shared";
import { canUseTool, type ToolPermissionKey } from "../../core/permissions";
import type { QuickCreateMode, Settings, User } from "../application/application-models";

/** The shared Create drawer and Command Search must advertise the same modes.
 * This controls discoverability only; the server remains the write authority. */
const TOOL_BY_CREATE_MODE: Record<QuickCreateMode, ToolPermissionKey> = {
  project: "projects", card: "boards", ticket: "tickets", bug: "tickets", build: "builds",
  timeline: "timeline", calendar: "calendar", scheduler: "scheduler", meeting: "projects",
  whiteboard: "whiteboards", packet: "packets",
};

export function canOfferCreateMode(user: User, settings: Settings | undefined, mode: QuickCreateMode): boolean {
  if (!Object.prototype.hasOwnProperty.call(TOOL_BY_CREATE_MODE, mode)) return false;
  if (!canUseTool(user, TOOL_BY_CREATE_MODE[mode], mode === "project" ? "manage" : "edit")) return false;
  if (mode === "timeline" && settings?.timelineEnabled === false) return false;
  if ((mode === "ticket" || mode === "bug") && settings?.ticketsEnabled === false) return false;
  if (mode === "calendar" && settings?.calendarEnabled === false) return false;
  if (mode === "scheduler" && settings?.schedulerEnabled === false) return false;
  if (mode === "packet" && settings?.packetsEnabled === false) return false;
  return true;
}

export function availableCreateModes(user: User, settings?: Settings): QuickCreateMode[] {
  return CLUSTER_CREATE_MODE_IDS.filter((mode) => canOfferCreateMode(user, settings, mode));
}

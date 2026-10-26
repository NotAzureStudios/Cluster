import type { Settings, User } from "../application/application-models";
import { isMandatorySecurityNotification } from "./notification-mandatory-security";
import {
  notificationCategoryEnabled,
  notificationEffectiveDelivery,
  notificationPriorityAllowed,
  notificationProjectAllowed,
  notificationToolAllowed,
} from "./notification-preferences";

type LiveCandidate = {
  category: string;
  priority: string;
  signal?: string | null;
  tool?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type LiveChannels = { toast: boolean; native: boolean };
const NONE: LiveChannels = { toast: false, native: false };
const modes = ["toast", "native", "both", "silent", "off"];

/** Server persistence is authoritative. These are local *interruptions* only.
 * Saved policy can suppress an interruption but cannot revive a channel the
 * recipient has since muted. Mandatory critical security evidence overrides
 * silent/off configuration and any historical noninterruptive snapshot.
 */
export function notificationLiveChannels(
  source: User | Partial<Settings> | null | undefined,
  item: LiveCandidate,
  timeZone?: string | null,
  now = new Date(),
): LiveChannels {
  const category = String(item.category || "activity");
  const priority = String(item.priority || "normal");
  const mandatory = isMandatorySecurityNotification(item);
  if (!mandatory && (!notificationCategoryEnabled(source, category)
    || !notificationPriorityAllowed(source, priority, category)
    || !notificationToolAllowed(source, item.tool, priority, category)
    || !notificationProjectAllowed(source, item.projectId, category, priority))) return NONE;

  const stored = item.metadata?.notificationPolicy;
  const policy = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as Record<string, unknown> : null;
  if (!mandatory && policy?.interruptive === false) return NONE;
  const currentMode = notificationEffectiveDelivery(source, category, priority, now, timeZone);
  const chosenMode = mandatory && (currentMode === "off" || currentMode === "silent")
    ? "toast" : currentMode;
  if (chosenMode === "off" || chosenMode === "silent") return NONE;

  // With no saved policy, current preferences are the fallback. With a valid
  // policy, require both current and recorded channel permission for routine
  // alerts. This avoids old native-only records becoming new toast alerts.
  let allowedMode = chosenMode;
  if (!mandatory && policy && modes.includes(String(policy.deliveryMode)))
    allowedMode = String(policy.deliveryMode);
  return {
    toast: (chosenMode === "toast" || chosenMode === "both") && (allowedMode === "toast" || allowedMode === "both"),
    native: (chosenMode === "native" || chosenMode === "both") && (allowedMode === "native" || allowedMode === "both"),
  };
}

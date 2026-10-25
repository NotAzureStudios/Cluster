import {
  CLUSTER_NOTIFICATION_PRIORITIES,
  type NotificationCategory,
  type NotificationDeliveryMode,
  type NotificationEscalationMode,
  type NotificationPriority,
  type NotificationPriorityFloor,
  type NotificationProjectMode,
  type NotificationSignal,
  type NotificationTool,
} from "@cluster/shared";

const priorityRank: Record<NotificationPriority, number> = { normal: 0, medium: 1, high: 2, critical: 3 };

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function enumValue<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  const text = String(value || "").trim() as T;
  return values.includes(text) ? text : fallback;
}

function preferenceRecord(preferences: Record<string, any>, key: string) {
  return parseObject(preferences[key]);
}

function timeZoneClock(now: Date, timeZone: string | null | undefined) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (Number.isInteger(hour) && Number.isInteger(minute)) return hour * 60 + minute;
  } catch {
    // Invalid or unavailable timezones fall back to UTC rather than bypassing quiet hours.
  }
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function clockMinutes(value: unknown, fallback: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

export function notificationQuietHoursActive(user: any, now = new Date()) {
  const preferences = parseObject(user?.preferences);
  if (preferences.userQuietHoursEnabled !== true) return false;
  const start = clockMinutes(preferences.userQuietHoursStart, 18 * 60);
  const end = clockMinutes(preferences.userQuietHoursEnd, 9 * 60);
  const current = timeZoneClock(now, user?.workingPattern?.timezone || "UTC");
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function notificationDeliveryMode(user: any, category: NotificationCategory): NotificationDeliveryMode {
  const preferences = parseObject(user?.preferences);
  const delivery = preferenceRecord(preferences, "notificationCategoryDelivery");
  const explicit = String(delivery[category] || "");
  if (["toast", "native", "both", "silent", "off"].includes(explicit)) return explicit as NotificationDeliveryMode;
  return "toast";
}

export function elevateNotificationPriority(input: {
  priority: NotificationPriority;
  signal: NotificationSignal;
  requiresAction: boolean;
  preferences: Record<string, any>;
}) {
  const mode = enumValue(["standard", "action-required", "aggressive"] as const, input.preferences.notificationEscalationMode, "standard") as NotificationEscalationMode;
  let rank = priorityRank[input.priority];
  if ((mode === "action-required" || mode === "aggressive") && input.requiresAction) rank = Math.max(rank, 2);
  if (mode === "aggressive" && ["failure", "blocked", "security"].includes(input.signal)) rank = 3;
  return (CLUSTER_NOTIFICATION_PRIORITIES[Math.min(3, Math.max(0, rank))] || input.priority) as NotificationPriority;
}

export function evaluateNotificationPolicy(user: any, input: {
  category: NotificationCategory;
  priority: NotificationPriority;
  projectId?: string | null;
  tool: NotificationTool;
  signal: NotificationSignal;
  requiresAction: boolean;
}, now = new Date()) {
  const preferences = parseObject(user?.preferences);
  const priority = elevateNotificationPriority({ priority: input.priority, signal: input.signal, requiresAction: input.requiresAction, preferences });
  // Studio security incidents are mandatory inbox evidence, even when the
  // recipient has muted routine System notifications or is in quiet hours.
  // Only genuinely critical security signals get this override.
  const mandatorySecurity = input.category === "system" && input.signal === "security" && priority === "critical";
  const configuredDeliveryMode = notificationDeliveryMode(user, input.category);
  const deliveryMode = mandatorySecurity && configuredDeliveryMode === "off" ? "toast" : configuredDeliveryMode;
  const bypassScopeMute = input.category === "mentions" || input.category === "system" || input.signal === "security";

  const projectModes = preferenceRecord(preferences, "notificationProjectModes");
  const projectMode = input.projectId ? enumValue(["all", "important", "off"] as const, projectModes[input.projectId], "all") : "all";
  const toolModes = preferenceRecord(preferences, "notificationToolModes");
  const toolMode = enumValue(["all", "important", "off"] as const, toolModes[input.tool], "all");
  const floor = enumValue(["all", "medium", "high", "critical"] as const, preferences.notificationPriorityFloor, "all");
  const minimumRank = floor === "all" ? 0 : priorityRank[floor];
  const importantEnough = priorityRank[priority] >= 2;

  let store = deliveryMode !== "off";
  const reasons: string[] = [];
  if (!store) reasons.push("category-off");
  if (!bypassScopeMute && projectMode === "off") { store = false; reasons.push("project-off"); }
  if (!bypassScopeMute && projectMode === "important" && !importantEnough) { store = false; reasons.push("project-important-only"); }
  if (!bypassScopeMute && toolMode === "off") { store = false; reasons.push("tool-off"); }
  if (!bypassScopeMute && toolMode === "important" && !importantEnough) { store = false; reasons.push("tool-important-only"); }
  if (!bypassScopeMute && priorityRank[priority] < minimumRank) { store = false; reasons.push("priority-floor"); }

  const quietHours = notificationQuietHoursActive(user, now);
  const quietBehavior = enumValue(["silent", "critical-only", "normal"] as const, preferences.notificationQuietHoursBehavior, "critical-only");
  let interruptive = store && deliveryMode !== "silent" && deliveryMode !== "off";
  if (quietHours && quietBehavior === "silent") interruptive = false;
  if (quietHours && quietBehavior === "critical-only" && priority !== "critical") interruptive = false;
  if (mandatorySecurity) interruptive = true;

  return {
    store,
    interruptive,
    priority,
    deliveryMode,
    projectMode: projectMode as NotificationProjectMode,
    toolMode,
    priorityFloor: floor as NotificationPriorityFloor,
    quietHours,
    quietBehavior,
    reasons,
  };
}

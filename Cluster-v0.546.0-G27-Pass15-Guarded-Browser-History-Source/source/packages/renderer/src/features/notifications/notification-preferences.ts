import {
  CLUSTER_NOTIFICATION_CATEGORIES,
  CLUSTER_NOTIFICATION_TOOLS,
  CLUSTER_NOTIFICATION_TOOL_DETAILS,
  PRODUCT_TERMS,
  type NotificationCategory,
  type NotificationDeliveryMode,
  type NotificationPriorityFloor,
  type NotificationQuietHoursBehavior,
  type NotificationTool,
  type NotificationToolMode,
} from "@cluster/shared";
import type { Settings, User } from "../application/application-models";
export type { NotificationCategory, NotificationDeliveryMode, NotificationToolMode } from "@cluster/shared";

export const NOTIFICATION_CATEGORIES = CLUSTER_NOTIFICATION_CATEGORIES;
export const NOTIFICATION_TOOLS = CLUSTER_NOTIFICATION_TOOLS;
export const NOTIFICATION_TOOL_DETAILS = CLUSTER_NOTIFICATION_TOOL_DETAILS;

export const NOTIFICATION_DELIVERY_OPTIONS: Array<{ value: NotificationDeliveryMode; label: string; detail: string }> = [
  { value: "toast", label: "Toast", detail: "Inbox + live in-app toast" },
  { value: "native", label: "Native push", detail: "Inbox + system notification" },
  { value: "both", label: "Toast + native", detail: "Inbox + both live delivery channels" },
  { value: "silent", label: "Silent", detail: "Inbox only, no interruption" },
  { value: "off", label: "Off", detail: "Hide and mute this category" },
];

export const DEFAULT_NOTIFICATION_CATEGORY_DELIVERY: Record<NotificationCategory, NotificationDeliveryMode> = {
  mentions: "toast",
  approvals: "toast",
  work: "toast",
  schedule: "toast",
  delivery: "toast",
  qa: "toast",
  system: "toast",
  activity: "toast",
};

export const NOTIFICATION_CATEGORY_DETAILS: Record<NotificationCategory, { label: string; description: string }> = {
  mentions: { label: "Mentions", description: "Direct mentions and replies across Boards, Whiteboards, comments, and reviews." },
  approvals: { label: "Approvals", description: "Review requests, completion approvals, and decisions." },
  work: { label: "Work", description: "Assignments, tickets, cards, blockers, and completed work." },
  schedule: { label: "Schedule", description: "Due work, overdue items, calendar events, and milestones." },
  delivery: { label: "Delivery", description: "Builds, releases, deployments, Git reviews, and failures." },
  qa: { label: PRODUCT_TERMS.qa, description: "Test plans, regression results, failed checks, and QA requests." },
  system: { label: "System & security", description: "Account, privacy, security, backup, and server events." },
  activity: { label: "Workspace updates", description: "Shared review, collaboration, announcements, and uncategorized workspace changes." },
};

function rawPreferences(source: User | Partial<Settings> | null | undefined): Record<string, unknown> {
  if (!source) return {};
  if ("preferences" in source && source.preferences && typeof source.preferences === "object") return source.preferences as Record<string, unknown>;
  return source as Record<string, unknown>;
}

function deliveryRecord(source: User | Partial<Settings> | null | undefined) {
  const raw = rawPreferences(source).notificationCategoryDelivery;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<Record<NotificationCategory, NotificationDeliveryMode>>
    : null;
}

export function notificationDeliveryMode(source: User | Partial<Settings> | null | undefined, categoryValue: string): NotificationDeliveryMode {
  const category = NOTIFICATION_CATEGORIES.includes(categoryValue as NotificationCategory)
    ? categoryValue as NotificationCategory
    : "activity";
  const explicit = deliveryRecord(source)?.[category];
  if (["toast", "native", "both", "silent", "off"].includes(String(explicit))) return explicit as NotificationDeliveryMode;

  return DEFAULT_NOTIFICATION_CATEGORY_DELIVERY[category];
}

export function notificationCategoryEnabled(source: User | Partial<Settings> | null | undefined, categoryValue: string) {
  return notificationDeliveryMode(source, categoryValue) !== "off";
}

export function notificationUsesToast(source: User | Partial<Settings> | null | undefined, categoryValue: string) {
  const mode = notificationDeliveryMode(source, categoryValue);
  return mode === "toast" || mode === "both";
}

export function notificationUsesNative(source: User | Partial<Settings> | null | undefined, categoryValue: string) {
  const mode = notificationDeliveryMode(source, categoryValue);
  return mode === "native" || mode === "both";
}

export function hasNativeNotificationDelivery(source: User | Partial<Settings> | null | undefined) {
  return NOTIFICATION_CATEGORIES.some((category) => notificationUsesNative(source, category));
}

function minutesFromClock(value: unknown, fallback: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

export function notificationQuietHoursActive(source: User | Partial<Settings> | null | undefined, now = new Date()) {
  const raw = rawPreferences(source);
  if (raw.userQuietHoursEnabled !== true) return false;
  const start = minutesFromClock(raw.userQuietHoursStart, 18 * 60);
  const end = minutesFromClock(raw.userQuietHoursEnd, 9 * 60);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function notificationEffectiveDelivery(source: User | Partial<Settings> | null | undefined, categoryValue: string, priorityValue = "normal", now = new Date()): NotificationDeliveryMode {
  const mode = notificationDeliveryMode(source, categoryValue);
  if (mode === "off" || mode === "silent" || !notificationQuietHoursActive(source, now)) return mode;
  const raw = rawPreferences(source);
  const behavior = (["silent", "critical-only", "normal"].includes(String(raw.notificationQuietHoursBehavior))
    ? raw.notificationQuietHoursBehavior
    : "critical-only") as NotificationQuietHoursBehavior;
  if (behavior === "normal") return mode;
  if (behavior === "silent") return "silent";
  return String(priorityValue) === "critical" ? mode : "silent";
}

export function normalizedNotificationCategoryDelivery(source: User | Partial<Settings> | null | undefined) {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [category, notificationDeliveryMode(source, category)]),
  ) as Record<NotificationCategory, NotificationDeliveryMode>;
}


function toolModeRecord(source: User | Partial<Settings> | null | undefined) {
  const raw = rawPreferences(source).notificationToolModes;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<Record<NotificationTool, NotificationToolMode>>
    : null;
}

export function notificationToolMode(source: User | Partial<Settings> | null | undefined, toolValue: string | null | undefined): NotificationToolMode {
  if (!toolValue || !NOTIFICATION_TOOLS.includes(toolValue as NotificationTool)) return "all";
  const explicit = toolModeRecord(source)?.[toolValue as NotificationTool];
  return explicit === "important" || explicit === "off" ? explicit : "all";
}

export function notificationPriorityAllowed(source: User | Partial<Settings> | null | undefined, priorityValue: string, categoryValue = "activity") {
  if (categoryValue === "mentions" || categoryValue === "system") return true;
  const raw = rawPreferences(source);
  const floor = (["all", "medium", "high", "critical"].includes(String(raw.notificationPriorityFloor))
    ? raw.notificationPriorityFloor
    : "all") as NotificationPriorityFloor;
  if (floor === "all") return true;
  const ranks: Record<string, number> = { normal: 0, medium: 1, high: 2, critical: 3 };
  return (ranks[String(priorityValue)] ?? 0) >= ranks[floor];
}

export function notificationToolAllowed(source: User | Partial<Settings> | null | undefined, toolValue: string | null | undefined, priorityValue: string, categoryValue = "activity") {
  if (categoryValue === "mentions" || categoryValue === "system") return true;
  const mode = notificationToolMode(source, toolValue);
  if (mode === "off") return false;
  if (mode === "important") return priorityValue === "high" || priorityValue === "critical";
  return true;
}

export function normalizedNotificationToolModes(source: User | Partial<Settings> | null | undefined) {
  return Object.fromEntries(NOTIFICATION_TOOLS.map((tool) => [tool, notificationToolMode(source, tool)])) as Record<NotificationTool, NotificationToolMode>;
}

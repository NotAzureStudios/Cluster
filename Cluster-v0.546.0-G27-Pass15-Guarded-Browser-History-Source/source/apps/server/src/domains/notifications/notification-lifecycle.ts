import type { NotificationPriority } from "@cluster/shared";
import { notificationQuietHoursActive } from "./notification-policy.js";

export type NotificationDigestCadence = "off" | "daily" | "weekly";
export type NotificationEscalationMode = "standard" | "action-required" | "aggressive";

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

function clockMinutes(value: unknown, fallback: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

function localParts(now: Date, timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[parts.weekday] || 1;
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      weekday,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
    };
  } catch {
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
      weekday: now.getUTCDay() === 0 ? 7 : now.getUTCDay(),
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
    };
  }
}

function isoWeekKey(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function notificationDigestSlot(user: any, now = new Date()) {
  const preferences = parseObject(user?.preferences);
  const cadence = (["off", "daily", "weekly"].includes(String(preferences.userDigestCadence)) ? preferences.userDigestCadence : "daily") as NotificationDigestCadence;
  if (cadence === "off") return null;
  const timeZone = String(user?.workingPattern?.timezone || "UTC");
  const local = localParts(now, timeZone);
  const scheduledMinutes = clockMinutes(preferences.userDigestTime, 9 * 60);
  const weeklyDay = Math.max(1, Math.min(7, Number(preferences.userDigestWeekday || 1) || 1));
  const scheduledReached = cadence === "daily"
    ? local.minutes >= scheduledMinutes
    : local.weekday > weeklyDay || (local.weekday === weeklyDay && local.minutes >= scheduledMinutes);
  if (!scheduledReached || notificationQuietHoursActive(user, now)) return null;
  const periodKey = cadence === "daily"
    ? `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`
    : isoWeekKey(local.year, local.month, local.day);
  const periodHours = cadence === "daily" ? 24 : 24 * 7;
  return {
    cadence,
    periodKey,
    periodStart: new Date(now.getTime() - periodHours * 60 * 60 * 1000),
    periodEnd: now,
    scheduledFor: now,
    timeZone,
  };
}

const escalationThresholdMinutes: Record<NotificationEscalationMode, [number, number, number]> = {
  standard: [24 * 60, 72 * 60, 7 * 24 * 60],
  "action-required": [4 * 60, 24 * 60, 72 * 60],
  aggressive: [60, 4 * 60, 24 * 60],
};

export function notificationEscalationLevel(item: any, user: any, now = new Date()) {
  if (!item?.requiresAction || item?.acknowledgedAt || item?.dismissedAt) return Number(item?.escalationLevel || 0);
  if (item?.snoozedUntil && new Date(item.snoozedUntil).getTime() > now.getTime()) return Number(item?.escalationLevel || 0);
  const preferences = parseObject(user?.preferences);
  const mode = (["standard", "action-required", "aggressive"].includes(String(preferences.notificationEscalationMode))
    ? preferences.notificationEscalationMode
    : "standard") as NotificationEscalationMode;
  const ageMinutes = Math.max(0, (now.getTime() - new Date(item.createdAt).getTime()) / 60_000);
  const thresholds = escalationThresholdMinutes[mode];
  if (ageMinutes >= thresholds[2]) return 3;
  if (ageMinutes >= thresholds[1]) return 2;
  if (ageMinutes >= thresholds[0]) return 1;
  return Number(item.escalationLevel || 0);
}

export function notificationEscalationPriority(level: number, current: string): NotificationPriority {
  if (level >= 2) return "critical";
  if (level >= 1 && !["critical", "high"].includes(current)) return "high";
  return (["normal", "medium", "high", "critical"].includes(current) ? current : "normal") as NotificationPriority;
}

export const NOTIFICATION_RETENTION = {
  dismissedDays: 30,
  readDays: 90,
  unreadDays: 180,
  acknowledgedDays: 180,
  digestDeliveryDays: 365,
} as const;

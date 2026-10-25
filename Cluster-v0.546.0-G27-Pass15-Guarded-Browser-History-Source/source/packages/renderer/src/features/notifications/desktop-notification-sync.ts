import { useEffect } from "react";
import { api } from "../../core/api";
import { requestDesktopNotificationPermission, showDesktopNotification } from "../../core/desktop";
import type { Settings, User } from "../application/application-models";
import { notificationDeliveryMode, notificationEffectiveDelivery, notificationPriorityAllowed, notificationToolAllowed } from "./notification-preferences";
import { notificationDesktopRoute, notificationWorkNavigation } from "./notification-navigation";
import type { NotificationItem } from "@cluster/shared";
import { CLUSTER_LIVE_NOTIFICATION_EVENT, CLUSTER_NOTIFICATION_READ_STATE_EVENT } from "./notification-events";

type DesktopInboxPriority = NotificationItem["priority"];
type DesktopInboxItem = NotificationItem;

type DesktopInboxPage = { items?: DesktopInboxItem[] };
type SeenState = { schema: 1; primed: true; ids: string[]; updatedAt: string };

const POLL_INTERVAL_MS = 120_000; // EventSource is authoritative; polling is recovery-only.
const MAX_SEEN_IDS = 256;
const MAX_BATCH_ITEMS = 40;

function storageKey(userId: string) {
  return `cluster.desktop.native-notifications:${userId}`;
}

function deliveryToken(item: DesktopInboxItem) {
  return `${item.id}:${Math.max(0, Number(item.escalationLevel || 0))}`;
}

function wasSeen(item: DesktopInboxItem, ids: string[]) {
  const token = deliveryToken(item);
  if (ids.includes(token)) return true;
  return Number(item.escalationLevel || 0) === 0 && ids.includes(item.id);
}

function readSeen(userId: string): SeenState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "null") as Partial<SeenState> | null;
    if (!parsed || parsed.schema !== 1 || parsed.primed !== true || !Array.isArray(parsed.ids)) return null;
    return {
      schema: 1,
      primed: true,
      ids: parsed.ids.filter((id): id is string => typeof id === "string" && id.length > 0).slice(-MAX_SEEN_IDS),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeSeen(userId: string, ids: Iterable<string>) {
  try {
    const unique = [...new Set([...ids].filter(Boolean))].slice(-MAX_SEEN_IDS);
    const state: SeenState = { schema: 1, primed: true, ids: unique, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Delivery must not depend on local storage availability.
  }
}

function categoryAllowed(item: DesktopInboxItem, settings: Settings) {
  const category = String(item.category || "activity").toLowerCase();
  if (!notificationPriorityAllowed(settings, item.priority, category)) return false;
  if (!notificationToolAllowed(settings, item.tool, item.priority, category)) return false;
  const policy = item.metadata?.notificationPolicy;
  let delivery = notificationEffectiveDelivery(settings, category, item.priority);
  if (policy && typeof policy === "object" && !Array.isArray(policy)) {
    const authoritative = policy as Record<string, unknown>;
    if (authoritative.interruptive === false) return false;
    delivery = String(authoritative.deliveryMode || notificationDeliveryMode(settings, category)) as ReturnType<typeof notificationDeliveryMode>;
  }
  if (delivery !== "native" && delivery !== "both") return false;

  if (!item.projectId || category === "mentions" || category === "system") return true;
  const modes = settings.notificationProjectModes;
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) return true;
  const mode = String((modes as Record<string, unknown>)[item.projectId] || "all");
  if (mode === "off") return false;
  if (mode === "important") return item.priority === "critical" || item.priority === "high";
  return true;
}

function priorityRank(priority: DesktopInboxPriority) {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  return 3;
}

export function desktopNotificationRoute(item: DesktopInboxItem) {
  return notificationDesktopRoute(notificationWorkNavigation(item));
}

function notificationBody(item: DesktopInboxItem, additional: number) {
  const detail = String(item.message || item.projectName || item.actor || "Open Cluster to review this update.").trim();
  if (additional <= 0) return detail.slice(0, 300);
  return `${detail.slice(0, 260)} · +${additional} more new notification${additional === 1 ? "" : "s"}`;
}

export function useDesktopNotificationSync({ enabled, user, settings }: { enabled: boolean; user: User; settings: Settings }) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let alive = true;
    let requestInFlight = false;

    const showItems = async (items: DesktopInboxItem[]) => {
      const eligible = items.filter((item) => (!item.read || Boolean(item.requiresAction && !item.acknowledgedAt && Number(item.escalationLevel || 0) > 0)) && categoryAllowed(item, settings))
        .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
          || Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
      if (!eligible.length || !alive) return;
      const permission = await requestDesktopNotificationPermission().catch(() => false);
      if (!permission || !alive) return;
      const top = eligible[0];
      const additional = eligible.length - 1;
      const batch = eligible.length > 1;
      await showDesktopNotification({
        title: batch ? `${eligible.length} new Cluster notifications` : top.title || "Cluster notification",
        body: notificationBody(top, additional),
        route: batch ? "inbox" : desktopNotificationRoute(top),
        tag: batch ? `batch-${top.id}` : `notification-${top.id}`,
        priority: top.priority,
      }).catch(() => false);
    };

    const poll = async () => {
      if (!alive || requestInFlight || document.visibilityState !== "visible" || !navigator.onLine) return;
      requestInFlight = true;
      try {
        const page = await api<DesktopInboxPage>(`/api/notifications?limit=${MAX_BATCH_ITEMS}`);
        if (!alive) return;
        const items = Array.isArray(page.items) ? page.items.filter((item) => item && typeof item.id === "string") : [];
        const existing = readSeen(user.id);
        if (!existing) {
          writeSeen(user.id, items.map(deliveryToken));
          return;
        }
        const newItems = items.filter((item) => !wasSeen(item, existing.ids));
        writeSeen(user.id, [...existing.ids, ...items.map(deliveryToken)]);
        await showItems(newItems);
      } catch {
        // Polling is a recovery path. Normal connectivity surfaces remain authoritative.
      } finally {
        requestInFlight = false;
      }
    };

    const live = (event: Event) => {
      const item = (event as CustomEvent<DesktopInboxItem>).detail;
      if (!item?.id) return;
      const existing = readSeen(user.id);
      const ids = existing?.ids || [];
      if (wasSeen(item, ids)) return;
      writeSeen(user.id, [...ids, deliveryToken(item)]);
      void showItems([item]);
    };

    let pollTimer = 0;
    const clearPoll = () => { if (pollTimer) window.clearTimeout(pollTimer); pollTimer = 0; };
    const schedulePoll = () => {
      clearPoll();
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      pollTimer = window.setTimeout(async () => { pollTimer = 0; await poll(); schedulePoll(); }, POLL_INTERVAL_MS);
    };
    const refresh = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) { clearPoll(); return; }
      void poll();
      schedulePoll();
    };
    const onVisibility = () => refresh();
    const onOffline = () => clearPoll();
    void poll();
    schedulePoll();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(CLUSTER_NOTIFICATION_READ_STATE_EVENT, refresh);
    window.addEventListener(CLUSTER_LIVE_NOTIFICATION_EVENT, live);
    return () => {
      alive = false;
      clearPoll();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(CLUSTER_NOTIFICATION_READ_STATE_EVENT, refresh);
      window.removeEventListener(CLUSTER_LIVE_NOTIFICATION_EVENT, live);
    };
  }, [enabled, user.id, settings.notificationCategoryDelivery, settings.notificationProjectModes, settings.notificationToolModes, settings.notificationPriorityFloor, settings.userQuietHoursEnabled, settings.userQuietHoursStart, settings.userQuietHoursEnd, settings.notificationQuietHoursBehavior]);
}

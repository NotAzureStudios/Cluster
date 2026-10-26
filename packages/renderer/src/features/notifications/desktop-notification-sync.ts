import { useEffect } from "react";
import { api } from "../../core/api";
import { requestDesktopNotificationPermission, showDesktopNotification } from "../../core/desktop";
import type { Settings, User } from "../application/application-models";
import { notificationLiveChannels } from "./notification-live-channels";
import { notificationDesktopRoute, notificationWorkNavigation } from "./notification-navigation";
import type { NotificationItem } from "@cluster/shared";
import { CLUSTER_LIVE_NOTIFICATION_EVENT, CLUSTER_NOTIFICATION_READ_STATE_EVENT } from "./notification-events";
import { deliverNativeNotificationTokens } from "./native-notification-claims";

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


function categoryAllowed(item: DesktopInboxItem, settings: Settings, timeZone: string | null | undefined) {
  return notificationLiveChannels(settings, item, timeZone).native;
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

    const isEligible = (item: DesktopInboxItem) =>
      (!item.read || Boolean(item.requiresAction && !item.acknowledgedAt && Number(item.escalationLevel || 0) > 0)) && categoryAllowed(item, settings, user.timezone);

    const showItems = async (items: DesktopInboxItem[]): Promise<boolean> => {
      if (!items.length || !alive) return false;
      const permission = await requestDesktopNotificationPermission().catch(() => false);
      if (!permission || !alive) return false;
      const ordered = [...items].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority)
        || Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
      const top = ordered[0];
      const batch = ordered.length > 1;
      const delivered = await showDesktopNotification({
        title: batch ? `${ordered.length} new Cluster notifications` : top.title || "Cluster notification",
        body: notificationBody(top, ordered.length - 1),
        route: batch ? "inbox" : desktopNotificationRoute(top),
        tag: batch ? `batch-${top.id}` : `notification-${top.id}`,
        priority: top.priority,
      }).catch(() => false);
      return delivered === true;
    };

    const deliverItems = async (items: DesktopInboxItem[], primeIfMissing: boolean) => {
      if (!alive) return;
      const eligible = items.filter(isEligible);
      // Priming on the first recovery poll is intentionally based on every
      // visible ID, so historical/muted items never become surprise alerts.
      const tokens = (primeIfMissing ? items : eligible).map(deliveryToken);
      if (!tokens.length) return;
      const byToken = new Map(eligible.map((item) => [deliveryToken(item), item]));
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      await deliverNativeNotificationTokens({
        tokens, primeIfMissing,
        read: () => readSeen(user.id)?.ids || null,
        write: (ids) => writeSeen(user.id, ids),
        deliver: (fresh) => showItems(fresh.map((token) => byToken.get(token)).filter((item): item is DesktopInboxItem => Boolean(item))),
        exclusive: locks?.request
          ? (work) => locks.request(`cluster-native-notifications:${user.id}`, { mode: "exclusive" }, work)
          : undefined,
      });
    };

    const poll = async () => {
      if (!alive || requestInFlight || document.visibilityState !== "visible" || !navigator.onLine) return;
      requestInFlight = true;
      try {
        const page = await api<DesktopInboxPage>(`/api/notifications?limit=${MAX_BATCH_ITEMS}`);
        if (!alive) return;
        const items = Array.isArray(page.items) ? page.items.filter((item) => item && typeof item.id === "string") : [];
        await deliverItems(items, true);
      } catch {
        // Polling is a recovery path. Normal connectivity surfaces remain authoritative.
      } finally {
        requestInFlight = false;
      }
    };

    const live = (event: Event) => {
      const item = (event as CustomEvent<DesktopInboxItem>).detail;
      if (!item?.id) return;
      void deliverItems([item], false).catch(() => undefined);
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
  }, [enabled, user.id, settings.notificationCategoryDelivery, settings.notificationProjectModes, settings.notificationToolModes, settings.notificationPriorityFloor, settings.userQuietHoursEnabled, settings.userQuietHoursStart, settings.userQuietHoursEnd, settings.notificationQuietHoursBehavior, user.timezone]);
}

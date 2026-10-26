import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { formatRelativeTime, levelLabel } from "../../core/format";
import { useServerState } from "../../core/server-state";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterActionGroup, ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterActionMenu, ClusterBulkActionBar, ClusterUndoBar } from "../../components/ClusterContextActions";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { SavedViewsToolbar } from "../../components/SavedViewsToolbar";
import { ClusterMasterDetail, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { LoadingState } from "../../components/LoadingState";
import { RequestEmptyState, RequestErrorState } from "../../components/RequestState";
import { ClusterStatus } from "../../components/ClusterStatus";
import { usePersistedScrollPosition } from "../../core/perceived-performance";
import type { Settings, User } from "../application/application-models";
import { notificationCategoryEnabled, notificationPriorityAllowed, notificationToolAllowed, notificationProjectAllowed } from "./notification-preferences";
import { isMandatorySecurityNotification } from "./notification-mandatory-security";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import type { NotificationGroupSummary, NotificationItem } from "@cluster/shared";
import { notificationWorkNavigation, notificationWorkSource } from "./notification-navigation";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { CLUSTER_LIVE_NOTIFICATION_EVENT, CLUSTER_NOTIFICATION_READ_STATE_EVENT } from "./notification-events";
import { createInboxRequestOwnership } from "./inbox-request-ownership";
import { createInboxMutationOwnership } from "./inbox-mutation-ownership";

export type InboxItem = NotificationItem;

type InboxSummary = { total: number; unread: number; snoozed: number; critical: number; high: number; requiresAction?: number; unacknowledged?: number; categories: Record<string, number>; tools?: Record<string, number> };
type InboxPage = { items: InboxItem[]; nextCursor?: string | null; hasMore?: boolean; summary: InboxSummary };
type Digest = { rows: Array<{ category: string; priority: string; _count?: { _all?: number } }>; top: InboxItem[]; since: string };
type DigestStatus = { cadence: string; periodKey: string; deliveredAt?: string | null; scheduledFor?: string | null } | null;

type InboxLane = "all" | "unread" | "action" | "critical" | "high" | "mentions" | "approvals" | "delivery" | "qa" | "schedule" | "work" | "system" | "snoozed";
type InboxGroupMode = "date" | "thread" | "project" | "category" | "tool";
type ProjectNotificationMode = "all" | "important" | "off";

const DEFAULT_RULES: Record<string, boolean> = { mentions: true, approvals: true, delivery: true, qa: true, schedule: true, work: true, system: true, activity: true };
function userPreferences(user: User): Partial<Settings> { return user.preferences && typeof user.preferences === "object" ? user.preferences as Partial<Settings> : {}; }
function ruleDefaults(_user: User) {
  return { ...DEFAULT_RULES };
}
function projectAllowed(item: InboxItem, user: User) {
  return notificationProjectAllowed(user, item.projectId, item.category, item.priority);
}
function notificationWorkContext(item: InboxItem) {
  const source = notificationWorkSource(item);
  const navigation = notificationWorkNavigation(item);
  // Delivered announcements belong to Inbox. Do not expose author-only
  // resource actions or an admin Studio Settings deep link to recipients.
  if (source?.kind === "announcement") return null;
  if (!source || !navigation) return null;
  return { source, navigation, projectId: source.projectId || item.projectId || null, boardId: item.boardId || null };
}

function priorityLabel(priority: InboxItem["priority"]) {
  if (priority === "critical") return "Critical";
  if (priority === "high") return "Important";
  if (priority === "medium") return "Normal";
  return "Information";
}
function dateGroupLabel(dateValue: string) {
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function groupLabel(item: InboxItem, mode: InboxGroupMode) {
  if (mode === "thread") return item.groupKey ? `${item.projectName || "Workspace"} · ${item.title}` : item.title;
  if (mode === "project") return item.projectName || "Workspace";
  if (mode === "category") return levelLabel(item.category);
  if (mode === "tool") return levelLabel(item.tool || "project");
  return dateGroupLabel(item.createdAt);
}

export function NotificationInboxPage({ currentUser, onOpenProject, onOpenTickets, onOpenTime, onOpenCalendar, onOpenActivity, onOpenUserAdmin }: { currentUser: User; onOpenProject: (projectId: string) => void; onOpenTickets: () => void; onOpenTime: () => void; onOpenCalendar: () => void; onOpenActivity: () => void; onOpenUserAdmin: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [summary, setSummary] = useState<InboxSummary>({ total: 0, unread: 0, snoozed: 0, critical: 0, high: 0, categories: {} });
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestStatus, setDigestStatus] = useState<DigestStatus>(null);
  const [threadGroups, setThreadGroups] = useState<NotificationGroupSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxLane>("all");
  const [groupMode, setGroupMode] = useState<InboxGroupMode>("date");
  const [query, setQuery] = useState("");
  const [projectModes, setProjectModes] = useState<Record<string, ProjectNotificationMode>>(() => ({ ...(userPreferences(currentUser).notificationProjectModes || {}) }));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const restoreNotificationDetail = useCallback((id: string | null) => setSelectedId(id || ""), []);
  const notificationDetailHistory = useClusterDetailHistory("notification", selectedId || null, restoreNotificationDetail);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [lastDismissed, setLastDismissed] = useState<{ ids: string[]; message: string } | null>(null);
  const [status, setStatus] = useState("Loading inbox…");
  const [rules, setRules] = useServerState<Record<string, boolean>>("user", "notifications.view-rules", ruleDefaults(currentUser), { merge: (value, fallback) => ({ ...fallback, ...value }) });
  const inboxRequests = useRef(createInboxRequestOwnership());
  const inboxMutations = useRef(createInboxMutationOwnership());
  const [mutationBusy, setMutationBusy] = useState(false);
  const revalidateTimerRef = useRef(0);

  async function load(reset = true, cursor?: string | null, _force = false, quiet = false) {
    // A fresh read during a mutation can replace an optimistic state with the
    // pre-commit server snapshot. The mutation schedules a read on settlement.
    if (inboxMutations.current.isPending()) return;
    const sequence = inboxRequests.current.beginRead();
    if (!quiet && reset && items.length) setRefreshing(true);
    else if (!quiet && reset) setLoading(true);
    try {
      setLoadError(null);
      const params = new URLSearchParams({ limit: "200", includeRead: "true", includeSnoozed: "true" });
      if (cursor) params.set("cursor", cursor);
      const pagePath = `/api/notifications?${params.toString()}`;
      const [page, digestResult, groupResult, digestStatusResult] = await Promise.all([
        // Inbox records contain private titles and recipient projections.
        // Do not persist them in IndexedDB or serve an older authorized cache
        // after another client revokes a Project/Packet/Library permission.
        api<InboxPage>(pagePath),
        reset ? api<{ ok: true } & Digest>("/api/notifications/digest?hours=24").catch(() => null) : Promise.resolve(null),
        reset ? api<{ ok: true; groups: NotificationGroupSummary[] }>("/api/notifications/groups?hours=168&groupBy=thread&includeRead=false&limit=8").catch(() => null) : Promise.resolve(null),
        reset ? api<{ ok: true; latest: DigestStatus }>("/api/notifications/digest/status").catch(() => null) : Promise.resolve(null),
      ]);
      if (!inboxRequests.current.isCurrent(sequence)) return;
      setItems((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      if (reset) {
        const availableIds = new Set(page.items.map((item) => item.id));
        setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
      }
      setSummary(page.summary);
      setNextCursor(page.nextCursor || null);
      if (digestResult) setDigest(digestResult);
      if (groupResult) setThreadGroups(groupResult.groups || []);
      if (digestStatusResult) setDigestStatus(digestStatusResult.latest || null);
      setStatus(`Inbox synced · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      if (inboxRequests.current.isCurrent(sequence)) {
        setLoadError(error);
        setStatus("Inbox sync failed");
      }
    } finally {
      if (inboxRequests.current.isCurrent(sequence)) { setLoading(false); setRefreshing(false); }
    }
  }

  function scheduleInboxRevalidation() {
    window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => {
      if (document.visibilityState === "visible") void load(true, null, true, true);
    }, 350);
  }

  useEffect(() => {
    void load(true);
    const onLiveNotification = () => scheduleInboxRevalidation();
    window.addEventListener(CLUSTER_LIVE_NOTIFICATION_EVENT, onLiveNotification);
    return () => {
      inboxRequests.current.invalidate();
      window.clearTimeout(revalidateTimerRef.current);
      window.removeEventListener(CLUSTER_LIVE_NOTIFICATION_EVENT, onLiveNotification);
    };
  }, []);
  // The application notification stream is authoritative for new items. Keep a slow visible
  // reconciliation poll for missed frames/read-state changes rather than refetching four inbox
  // projections every minute while the page sits open.
  useVisibleRefresh(() => load(true, null, true, true), { intervalMs: 5 * 60_000, requireOnline: true });
  // ACL and resource changes can revoke notification visibility without
  // generating a new notification. Recheck those views while Inbox is visible.
  useResourceChangeRefresh(() => scheduleInboxRevalidation(), {
    // Permission/membership and published content changes need a fresh
    // recipient projection. Ordinary Card edits are already delivered by the
    // notification stream; do not refetch four Inbox APIs per Card mutation.
    kinds: ["project", "user", "team", "department", "job_role", "packet", "policy", "studio_form", "form_submission", "library", "file"],
    debounceMs: 350, visibleOnly: true,
  });

  const now = Date.now();
  const visible = useMemo(() => items.filter((item) => {
    if (!isMandatorySecurityNotification(item) && !notificationCategoryEnabled(currentUser, item.category)) return false;
    if (!notificationPriorityAllowed(currentUser, item.priority, item.category)) return false;
    if (!notificationToolAllowed(currentUser, item.tool, item.priority, item.category)) return false;
    if (rules[item.category] === false) return false;
    if (!item.projectId || item.category === "mentions" || item.category === "system") return true;
    const mode = projectModes[item.projectId] || "all";
    if (mode === "off") return false;
    if (mode === "important") return item.priority === "critical" || item.priority === "high";
    return true;
  }), [items, rules, projectModes, currentUser]);
  const active = visible.filter((item) => !item.snoozedUntil || new Date(item.snoozedUntil).getTime() <= now);
  const snoozed = visible.filter((item) => item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now);
  const unread = active.filter((item) => !item.read);

  const laneItems = (filter === "snoozed" ? snoozed : active).filter((item) => {
    if (filter === "all" || filter === "snoozed") return true;
    if (filter === "unread") return !item.read;
    if (filter === "action") return Boolean(item.requiresAction) && !item.acknowledgedAt;
    if (filter === "critical" || filter === "high") return item.priority === filter;
    return item.category === filter;
  });
  const needle = query.trim().toLowerCase();
  const filtered = laneItems.filter((item) => !needle || needle.split(/\s+/).every((token) => `${item.title} ${item.message || ""} ${item.projectName || ""} ${item.actor || ""} ${item.category}`.toLowerCase().includes(token)));
  const grouped = Object.entries(filtered.reduce<Record<string, InboxItem[]>>((groups, item) => { (groups[groupLabel(item, groupMode)] ||= []).push(item); return groups; }, {})).map(([group, rows]) => [group, rows.slice().sort((a, b) => {
    const priorityRank = { critical: 3, high: 2, medium: 1, normal: 0 } as const;
    return priorityRank[b.priority] - priorityRank[a.priority] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  })] as [string, InboxItem[]]);
  const selected = items.find((item) => item.id === selectedId) || null;
  const selectedVisible = filtered.filter((item) => selectedIds.includes(item.id)).map((item) => item.id);
  const allSelected = Boolean(filtered.length) && selectedVisible.length === filtered.length;
  const inboxScroll = usePersistedScrollPosition(`notifications:${filter}:${groupMode}:${needle}`);

  function beginInboxMutation(): number | null {
    const ticket = inboxMutations.current.begin();
    if (ticket === null) {
      setStatus("An Inbox update is already in progress. Finish it before another change.");
      return null;
    }
    setMutationBusy(true);
    setLoadError(null);
    return ticket;
  }

  function finishInboxMutation(ticket: number) {
    if (inboxMutations.current.end(ticket)) setMutationBusy(false);
  }

  function notifyCommittedInboxMutation() {
    // Only committed server changes can invalidate the taskbar/native summary.
    // Optimistic list updates must not cause a pre-commit summary fetch.
    window.dispatchEvent(new Event(CLUSTER_NOTIFICATION_READ_STATE_EVENT));
  }

  function mutationFailed(error: unknown, action: string) {
    setLoadError(error);
    setStatus(`${action} failed. Inbox will refresh; your previous state is preserved.`);
  }

  function invalidateInboxReadsForMutation() {
    inboxRequests.current.invalidate();
    setRefreshing(false);
    // Mutation outcomes take precedence over earlier pending reads.
    setLoading(false);
  }

  async function setRead(ids: string[], read: boolean) {
    if (!ids.length) return;
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    invalidateInboxReadsForMutation();
    const previous = new Map(items.filter((item) => ids.includes(item.id)).map((item) => [item.id, { read: item.read, readAt: item.readAt }]));
    const unreadDelta = [...previous.values()].reduce((delta, item) => item.read !== read ? delta + (read ? -1 : 1) : delta, 0);
    const at = read ? new Date().toISOString() : null;
    setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, read, readAt: at } : item));
    setSummary((current) => ({ ...current, unread: Math.max(0, current.unread + unreadDelta) }));
    try {
      await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids, read }) });
      notifyCommittedInboxMutation();
    } catch (error) {
      setItems((current) => current.map((item) => {
        const snapshot = previous.get(item.id);
        return snapshot ? { ...item, read: snapshot.read, readAt: snapshot.readAt } : item;
      }));
      setSummary((current) => ({ ...current, unread: Math.max(0, current.unread - unreadDelta) }));
      mutationFailed(error, "Notification update");
    } finally {
      finishInboxMutation(ticket);
      scheduleInboxRevalidation();
    }
  }
  async function dismiss(ids: string[]) {
    if (!ids.length) return;
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    invalidateInboxReadsForMutation();
    try {
      await api("/api/notifications/dismiss", { method: "POST", body: JSON.stringify({ ids }) });
      notifyCommittedInboxMutation();
      setItems((current) => current.filter((item) => !ids.includes(item.id)));
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      if (ids.includes(selectedId)) notificationDetailHistory.closeDetail();
      setLastDismissed({ ids: [...ids], message: `Dismissed ${ids.length} notification${ids.length === 1 ? "" : "s"}.` });
    } catch (error) {
      mutationFailed(error, "Dismiss");
    } finally {
      finishInboxMutation(ticket);
      // An error must also restore the read that mutation admission invalidated.
      scheduleInboxRevalidation();
    }
  }
  async function snooze(ids: string[], hours: number | null) {
    if (!ids.length) return;
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    invalidateInboxReadsForMutation();
    try {
      const until = hours == null ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
      await api("/api/notifications/snooze", { method: "POST", body: JSON.stringify({ ids, until }) });
      notifyCommittedInboxMutation();
      setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, snoozedUntil: until } : item));
      setSelectedIds([]);
    } catch (error) {
      mutationFailed(error, "Snooze");
    } finally {
      finishInboxMutation(ticket);
      scheduleInboxRevalidation();
    }
  }
  async function acknowledge(ids: string[], acknowledged = true) {
    if (!ids.length) return;
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    invalidateInboxReadsForMutation();
    try {
      const at = acknowledged ? new Date().toISOString() : null;
      await api("/api/notifications/acknowledge", { method: "POST", body: JSON.stringify({ ids, acknowledged }) });
      notifyCommittedInboxMutation();
      setItems((current) => current.map((item) => ids.includes(item.id) && item.requiresAction ? { ...item, acknowledgedAt: at, ...(acknowledged ? { read: true, readAt: at } : {}) } : item));
      setSelectedIds([]);
    } catch (error) {
      mutationFailed(error, "Acknowledge");
    } finally {
      finishInboxMutation(ticket);
      scheduleInboxRevalidation();
    }
  }
  async function restoreDismissed(ids?: string[]) {
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    invalidateInboxReadsForMutation();
    let succeeded = false;
    try {
      await api("/api/notifications/restore", { method: "POST", ...(ids?.length ? { body: JSON.stringify({ ids }) } : {}) });
      notifyCommittedInboxMutation();
      setLastDismissed(null);
      succeeded = true;
    } catch (error) {
      mutationFailed(error, "Restore");
    } finally {
      finishInboxMutation(ticket);
      // The server mutation has settled before this reconciliation begins.
      // One read on success, a coalesced recovery read on failure.
      if (succeeded) void load(true, null, true);
      else scheduleInboxRevalidation();
    }
  }
  async function setProjectMode(projectId: string, mode: ProjectNotificationMode) {
    const ticket = beginInboxMutation();
    if (ticket === null) return;
    const previous = projectModes;
    const next = { ...previous, [projectId]: mode };
    setProjectModes(next);
    try {
      await api("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ preferences: { notificationProjectModes: next } }) });
      setStatus(`Project notification level updated · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      setProjectModes(previous);
      mutationFailed(error, "Project notification preferences");
    } finally {
      finishInboxMutation(ticket);
    }
  }

  function open(item: InboxItem) {
    if (item.entityType === "password_reset_request") { onOpenUserAdmin(); return; }
    if (item.entityType === "announcement" || item.resource?.kind === "announcement") return; // Already showing its recipient-specific Inbox content.
    if (openClusterWorkNavigation(notificationWorkNavigation(item))) return;
    if (item.resource?.id || item.entityId || item.cardId) {
      setStatus("The linked notification target is not available. Your Inbox remains open.");
      return;
    }
    if (item.category === "work") { onOpenTickets(); return; }
    if (item.category === "schedule") { onOpenCalendar(); return; }
    onOpenActivity();
  }

  const lanes: Array<[InboxLane, number]> = [
    ["all", active.length], ["unread", unread.length], ["action", active.filter((item) => item.requiresAction && !item.acknowledgedAt).length], ["critical", active.filter((item) => item.priority === "critical").length], ["high", active.filter((item) => item.priority === "high").length],
    ["mentions", active.filter((item) => item.category === "mentions").length], ["approvals", active.filter((item) => item.category === "approvals").length], ["delivery", active.filter((item) => item.category === "delivery").length],
    ["qa", active.filter((item) => item.category === "qa").length], ["schedule", active.filter((item) => item.category === "schedule").length], ["work", active.filter((item) => item.category === "work").length], ["system", active.filter((item) => item.category === "system").length], ["snoozed", snoozed.length],
  ];
  const digestCount = digest?.rows.reduce((sum, row) => sum + Number(row._count?._all || 0), 0) || 0;
  const savedInboxView = useMemo(() => ({ filter, groupMode, query }), [filter, groupMode, query]);
  function applySavedInboxView(values: Record<string, string>) {
    if (["all", "unread", "action", "critical", "high", "mentions", "approvals", "delivery", "qa", "schedule", "work", "system", "snoozed"].includes(values.filter || "")) setFilter(values.filter as InboxLane);
    if (["date", "thread", "project", "category", "tool"].includes(values.groupMode || "")) setGroupMode(values.groupMode as InboxGroupMode);
    setQuery(values.query || "");
    setSelectedIds([]);
    notificationDetailHistory.closeDetail();
  }

  return (
    <section className="page cluster-page-shell notification-center-v251 notification-center-v387" aria-busy={mutationBusy}>
      <header className="notification-command-v252 cluster-workspace-header-v391 cluster-page-header">
        <div className="notification-title-v252"><div><h1>Inbox</h1><span>{status}</span>{mutationBusy ? <ClusterStatus state="loading" compact>Saving change</ClusterStatus> : refreshing ? <ClusterStatus state="loading" compact>Refreshing</ClusterStatus> : null}</div>
          <ClusterMetricStrip
            className="notification-summary-v252 notification-summary-v253 cluster-workspace-metrics-v391"
            label="Inbox summary"
            items={[
              { label: "Unread", value: unread.length, selected: filter === "unread", onSelect: () => setFilter("unread") },
              { label: "Action", value: active.filter((item) => item.requiresAction && !item.acknowledgedAt).length, tone: "warning", selected: filter === "action", onSelect: () => setFilter("action") },
              { label: "Critical", value: active.filter((item) => item.priority === "critical").length, tone: "danger", selected: filter === "critical", onSelect: () => setFilter("critical") },
              { label: "Important", value: active.filter((item) => item.priority === "high").length, tone: "warning", selected: filter === "high", onSelect: () => setFilter("high") },
              { label: "Snoozed", value: snoozed.length, selected: filter === "snoozed", onSelect: () => setFilter("snoozed") },
            ]}
          />
        </div>
        <ClusterActionGroup label="Inbox actions" className="notification-command-actions-v252">
          <ClusterActionMenu iconOnly label="More inbox actions" items={[
            { id: "refresh", label: "Refresh inbox", icon: "refresh", onSelect: () => load(true, null, true) },
            { id: "restore", label: "Restore dismissed", description: "Restore previously dismissed notifications.", icon: "archive", onSelect: () => restoreDismissed() },
          ]} />
          {unread.length > 0 ? <ClusterButton variant="primary" disabled={mutationBusy} onClick={() => void setRead(unread.map((item) => item.id), true)}>Mark loaded read</ClusterButton> : null}
        </ClusterActionGroup>
      </header>
      {lastDismissed ? <ClusterUndoBar message={lastDismissed.message} onUndo={() => restoreDismissed(lastDismissed.ids)} onDismiss={() => setLastDismissed(null)} /> : null}
      <SavedViewsToolbar scope="notifications.inbox" label="Inbox view" current={savedInboxView} onApply={applySavedInboxView} summary="Save the inbox lane, grouping mode, and search together." />
      <div className="notification-workspace-v251 notification-workspace-v252 notification-workspace-v429">
        <aside className="notification-lanes-v251 notification-lanes-v252">
          <label className="notification-search-v251 notification-search-v252"><ClusterIcon name="search" /><ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inbox" />{query ? <ClusterIconButton label="Clear inbox search" size="compact" onClick={() => setQuery("")}><ClusterIcon name="close" /></ClusterIconButton> : null}</label>
          <nav>{lanes.map(([lane, count]) => <ClusterButton unstyled type="button" key={lane} data-lane={lane} className={filter === lane ? "active" : ""} onClick={() => { setFilter(lane); setSelectedIds([]); notificationDetailHistory.closeDetail(); }}><span>{levelLabel(lane)}</span><b>{count}</b></ClusterButton>)}</nav>
          <ClusterDisclosureGroup className="notification-digest-v387" title="24-hour digest" headerTrailing={<span>{digestCount}</span>}>{digest?.rows.length ? digest.rows.slice(0, 8).map((row) => <p key={`${row.category}-${row.priority}`}><strong>{row._count?._all || 0}</strong><span>{levelLabel(row.category)} · {priorityLabel(row.priority as InboxItem["priority"])}</span></p>) : <small>No recent digest activity.</small>}{digestStatus?.deliveredAt ? <small>Last scheduled {digestStatus.cadence} digest · {formatRelativeTime(digestStatus.deliveredAt)}</small> : null}</ClusterDisclosureGroup>
          <ClusterDisclosureGroup className="notification-digest-v387" title="Active threads" headerTrailing={<span>{threadGroups.length}</span>}>{threadGroups.length ? threadGroups.slice(0, 8).map((group) => <p key={group.key}><strong>{group.unread || group.count}</strong><span>{group.label}{group.requiresAction ? ` · ${group.requiresAction} action` : ""}</span></p>) : <small>No active notification threads.</small>}</ClusterDisclosureGroup>
          <ClusterDisclosureGroup className="notification-digest-v387" title="View sources" headerTrailing={<span>{Object.keys(DEFAULT_RULES).filter((kind) => rules[kind] !== false).length}/{Object.keys(DEFAULT_RULES).length}</span>}>{Object.keys(DEFAULT_RULES).map((kind) => <label key={kind}><ClusterInput type="checkbox" checked={rules[kind] !== false} onChange={(event) => setRules((current) => ({ ...current, [kind]: event.target.checked }))} /> {levelLabel(kind)}</label>)}</ClusterDisclosureGroup>
        </aside>
        <ClusterMasterDetail className="notification-master-detail-v429" label="Notification queue and inspector" masterLabel="Notification queue" detailLabel="Notification inspector" detailOpen={Boolean(selected)} onCloseDetail={notificationDetailHistory.closeDetail} detailSize="narrow" persistKey="notifications" master={<main className="notification-queue-v251 notification-queue-v252"><header><label className="notification-select-all-v252"><ClusterInput type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : filtered.map((item) => item.id))} disabled={mutationBusy || !filtered.length} /><span>{selectedVisible.length ? `${selectedVisible.length} selected` : `${filtered.length} items`}</span></label><div className="notification-group-controls-v416"><span>Group</span><ClusterSegmentedControl value={groupMode} onChange={setGroupMode} label="Notification grouping" options={(["date", "thread", "project", "category", "tool"] as InboxGroupMode[]).map((mode) => ({ value: mode, label: levelLabel(mode) }))} /></div></header>
          <ClusterBulkActionBar selectionCount={mutationBusy ? 0 : selectedVisible.length} label="Selected notification actions" onClear={() => setSelectedIds([])} className="notification-bulk-actions-v428">
            <ClusterButton size="compact" disabled={mutationBusy} onClick={() => void setRead(selectedVisible, true)}>Mark read</ClusterButton>
            <ClusterActionMenu triggerLabel="More" label="More selected notification actions" items={[
              ...(selectedVisible.some((id) => items.find((item) => item.id === id)?.requiresAction) ? [{ id: "acknowledge", label: "Acknowledge action items", onSelect: () => acknowledge(selectedVisible.filter((id) => items.find((item) => item.id === id)?.requiresAction), true) }] : []),
              { id: "snooze", label: "Snooze 4 hours", onSelect: () => snooze(selectedVisible, 4) },
              { id: "dismiss", label: "Dismiss selected", danger: true, separatorBefore: true, onSelect: () => dismiss(selectedVisible) },
            ]} />
          </ClusterBulkActionBar>
          <div ref={inboxScroll.elementRef} onScroll={inboxScroll.onScroll} className="notification-rows-v251 notification-rows-v252" aria-busy={loading || refreshing || mutationBusy}>{loading && !items.length ? <LoadingState label="Loading inbox" rows={8} compact /> : loadError && !items.length ? <RequestErrorState error={loadError} title="Inbox unavailable" onRetry={() => void load(true, null, true)} compact /> : grouped.length ? grouped.map(([group, rows]) => <section className="notification-date-group-v252" key={group}><header><strong>{group}</strong><span>{rows.length}</span></header>{rows.map((item) => <article key={item.id} data-severity={item.priority === "critical" ? "critical" : item.priority === "high" ? "important" : "info"} className={`${item.priority === "critical" ? "severity-critical" : item.priority === "high" ? "severity-important" : "severity-info"} ${selected?.id === item.id ? "selected" : ""} ${item.read ? "read" : "unread"}`}><label><ClusterInput type="checkbox" checked={selectedIds.includes(item.id)} disabled={mutationBusy} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} aria-label={`Select ${item.title}`} /></label><ClusterButton unstyled type="button" onClick={() => { notificationDetailHistory.openDetail(item.id); if (!item.read) void setRead([item.id], true); }}><i data-kind={item.category} data-severity={item.priority} /><span><strong>{item.title}</strong><em>{item.message}</em><small>{item.projectName || levelLabel(item.category)} · {item.actor || "Cluster"}</small></span><time>{formatRelativeTime(item.createdAt)}</time></ClusterButton></article>)}</section>) : <RequestEmptyState title={query || filter !== "all" ? "No notifications match this view" : "Inbox is clear"} description={query || filter !== "all" ? "Change the lane or clear the search to widen the inbox view." : "New high-signal notifications will appear here as work changes."} kind={query || filter !== "all" ? "filtered" : "empty"} compact />}{Boolean(loadError) && items.length > 0 && <RequestErrorState error={loadError} title="Inbox refresh failed" onRetry={() => void load(true, null, true)} compact />}{nextCursor ? <ClusterButton className="notification-load-more-v387" onClick={() => void load(false, nextCursor)}>Load older</ClusterButton> : null}</div>
        </main>}
        detail={<aside className="notification-detail-v251 notification-detail-v252">{selected ? <><header><span className="notification-kind-pill-v252" data-kind={selected.category} data-severity={selected.priority}>{priorityLabel(selected.priority)} · {levelLabel(selected.category)}{selected.requiresAction ? selected.acknowledgedAt ? " · Acknowledged" : " · Action required" : ""}</span><small>{formatRelativeTime(selected.createdAt)}</small></header><div><div className="notification-detail-title-v252"><h2>{selected.title}</h2>{!selected.read && <span>Unread</span>}</div><p>{selected.message || "No additional details."}</p><dl><div><dt>Workspace</dt><dd>{selected.projectName || "Workspace"}</dd></div><div><dt>Source</dt><dd>{selected.actor || levelLabel(selected.category)}</dd></div>{selected.tool ? <div><dt>Tool</dt><dd>{levelLabel(selected.tool)}</dd></div> : null}{selected.signal ? <div><dt>Signal</dt><dd>{levelLabel(selected.signal)}</dd></div> : null}{selected.escalationLevel ? <div><dt>Escalation</dt><dd>Level {selected.escalationLevel}{selected.lastEscalatedAt ? ` · ${formatRelativeTime(selected.lastEscalatedAt)}` : ""}</dd></div> : null}{selected.acknowledgedAt ? <div><dt>Acknowledged</dt><dd>{new Date(selected.acknowledgedAt).toLocaleString()}</dd></div> : null}{selected.projectId && <div className="notification-project-policy-v416"><dt>Project alerts</dt><dd><ClusterNativeSelect aria-label={`${selected.projectName || "Project"} notification level`} value={projectModes[selected.projectId] || "all"} disabled={mutationBusy} onChange={(event) => void setProjectMode(selected.projectId!, event.target.value as ProjectNotificationMode)}><option value="all">All high-signal</option><option value="important">Important only</option><option value="off">Off</option></ClusterNativeSelect></dd></div>}<div><dt>Received</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div></dl></div><footer>{(selected.entityType === "announcement" || selected.resource?.kind === "announcement") ? null : <ClusterButton variant="primary" onClick={() => open(selected)}>Open source</ClusterButton>}{selected.requiresAction ? <ClusterButton size="compact" onClick={() => void acknowledge([selected.id], !selected.acknowledgedAt)}>{selected.acknowledgedAt ? "Unacknowledge" : "Acknowledge"}</ClusterButton> : <ClusterButton size="compact" onClick={() => void setRead([selected.id], !selected.read)}>{selected.read ? "Mark unread" : "Mark read"}</ClusterButton>}{notificationWorkContext(selected) ? <WorkActionMenu context={notificationWorkContext(selected)!} label="Notification work actions" triggerLabel="Work actions" exclude={["open"]} allowMention={notificationWorkContext(selected)!.source.kind === "user"} /> : null}<ClusterActionMenu label="More notification actions" items={[{ id: "snooze-1", label: "Snooze 1 hour", onSelect: () => snooze([selected.id], 1) }, { id: "snooze-4", label: "Snooze 4 hours", onSelect: () => snooze([selected.id], 4) }, { id: "snooze-24", label: "Snooze until tomorrow", onSelect: () => snooze([selected.id], 24) }, ...(selected.snoozedUntil ? [{ id: "unsnooze", label: "Unsnooze", onSelect: () => snooze([selected.id], null) }] : []), { id: "dismiss", label: "Dismiss notification", danger: true, separatorBefore: true, onSelect: () => dismiss([selected.id]) }]} /></footer></> : <RequestEmptyState title="Select a notification" description="Choose an inbox item to inspect its source, project context, and available actions." compact />}</aside>}
        />
      </div>
    </section>
  );
}

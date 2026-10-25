import { ClusterNativeSelect } from "../../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { useEffect, useRef, useState } from "react";
import { API_URL, api, queryApi } from "../../../core/api";
import { useVisibleRefresh } from "../../../core/visible-refresh";
import { reconnectBackoffDelay } from "../../../core/reconnect-backoff";
import { copyClusterText } from "../../../core/clipboard";
import { desktopWorkspaceRouteFromCurrentLocation, openCurrentWorkInDesktopWindow } from "../../workflow/workspace-window";
import { type AppScreen } from "../../../core/navigation";
import { canUseTool } from "../../../core/permissions";
import { compactDateTime } from "../../../core/date-time";
import { formatRelativeTime, levelLabel } from "../../../core/format";
import { ClusterIcon, type ClusterIconName } from "../../../components/ClusterIcon";
import { collectBoardCards, projectMemberIds, projectStatusLabel } from "../../projects/projects-utils";
import { displayUserName, presenceLabel, presenceState, userInitial } from "../../people/people-utils";
import { PresenceAvatar } from "../../../components/PresenceAvatar";
import { useDesktopNotificationSync } from "../../notifications/desktop-notification-sync";
import { NOTIFICATION_CATEGORY_DETAILS, hasNativeNotificationDelivery, notificationCategoryEnabled, notificationDeliveryMode, notificationEffectiveDelivery, notificationPriorityAllowed, notificationToolAllowed, type NotificationCategory } from "../../notifications/notification-preferences";
import { playClusterNotificationSound } from "../../../core/cluster-sounds";
import { notificationWorkNavigation } from "../../notifications/notification-navigation";
import { CLUSTER_LIVE_NOTIFICATION_EVENT, CLUSTER_NOTIFICATION_READ_STATE_EVENT } from "../../notifications/notification-events";
import { openClusterWorkNavigation } from "../../workflow/work-navigation";
import { type NotificationItem } from "@cluster/shared";
import { openTicketWorkspace } from "../../tickets/ticket-navigation";

import { ClusterSelect } from "../../../components/ClusterSelect";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterActionMenu } from "../../../components/ClusterContextActions";
import type { User, Project, Priority, Board, Settings, NotificationSeverity, TicketCard } from "../application-models";import { PRIORITY_CREATE_OPTIONS } from "./priority-options";
import { shouldHandleGlobalNavigationShortcut } from "../../../core/accessibility";
import type { SmartWorkspaceContext } from "../../../core/smart-interface";
import { MobilePrimaryNavigation } from "./MobilePrimaryNavigation";
import { MobileViewportRuntime } from "./MobileViewportRuntime";
import { ClusterTextArea } from "../../../components/ClusterTextArea";
import { ClusterFloatingSurface } from "../../../components/ClusterFloatingSurface";
import { ClusterTaskbar } from "../../shell/ShellPrimitives";
import { TaskbarHistory } from "../../shell/TaskbarHistory";
import { TaskbarTransferCenter } from "../../shell/TaskbarTransferCenter";
import { TaskbarProjectTabs } from "../../shell/TaskbarProjectTabs";
import { createClusterCreateIntentControl } from "../../create/create-intent-control";
import { createTaskbarActionRequestGate } from "./taskbar-action-requests";
import { createClusterCommandInvocation } from "../../search/cluster-command-invocation";

type NotificationPreview = NotificationItem;

const TASKBAR_PRESENCE_OPTIONS = [
  { value: "available", label: "Available", meta: "Open to messages" },
  { value: "busy", label: "Busy", meta: "Limited interruptions" },
  { value: "focus", label: "Focus", meta: "Heads-down work" },
  { value: "do_not_disturb", label: "Do not disturb", meta: "Silence interruptions" },
  { value: "away", label: "Away", meta: "Temporarily unavailable" },
] as const;

export function ProjectTabsBar({ projects, openProjectIds, pinnedProjectIds, activeProjectId, screen, currentRoute, user, settings, commandPaletteOpen, resumeContext, onResumeContext, onClearResumeContext, onOpenHome, onOpenProject, onCloseProject, onToggleProjectPin, onMoveProjectTab, onCloseOtherProjects, onOpenProjects, onOpenMyWork, onOpenNotifications, onOpenTickets, onOpenPeople, onOpenUserAdmin, onOpenProfile, onOpenSettings, onOpenQuickCreate, onOpenCommandPalette, onOpenNavigation, onPresenceChange, onLogout }: { projects: Project[]; openProjectIds: string[]; pinnedProjectIds: string[]; activeProjectId?: string | null; screen: AppScreen; currentRoute?: string; user: User; settings: Settings; commandPaletteOpen: boolean; resumeContext?: SmartWorkspaceContext | null; onResumeContext?: () => void; onClearResumeContext?: () => void; onOpenHome: () => void; onOpenProject: (projectId: string) => void; onCloseProject: (projectId: string) => void; onToggleProjectPin: (projectId: string) => void; onMoveProjectTab: (projectId: string, delta: -1 | 1) => void; onCloseOtherProjects: (projectId: string) => void; onOpenProjects: () => void; onOpenMyWork: () => void; onOpenNotifications: () => void; onOpenTickets: () => void; onOpenPeople: () => void; onOpenUserAdmin: () => void; onOpenProfile: () => void; onOpenSettings: () => void; onOpenQuickCreate: () => void; onOpenCommandPalette: () => void; onOpenNavigation: () => void; onPresenceChange: (availability: string, message?: string | null, connectionVisibility?: "visible" | "invisible") => Promise<void>; onLogout: () => void }) {
  const assignedProjectCount = projects.filter((project) => projectMemberIds(project).includes(user.id)).length;
  const canSeeProjects = canUseTool(user, "projects");
  const canSeeMyWork = canUseTool(user, "mywork");
  const canSeeNotifications = canUseTool(user, "inbox");
  const canSeeTickets = settings.ticketsEnabled !== false && canUseTool(user, "tickets");
  const canSeePeople = canUseTool(user, "people");
  const canSeeSettings = canUseTool(user, "settings");
  const primaryStudioTeam = user.studioTeams?.find((team) => team.primaryMembership) || user.studioTeams?.[0] || null;
  const accountRoleLabel = user.isAdmin ? "Administrator" : user.title?.trim() || user.workspaceRole?.trim() || (user.accountType ? user.accountType.replace(/[_-]+/g, " ") : "Member");
  const accountContextLabel = [user.department?.trim(), primaryStudioTeam?.name?.trim()].filter(Boolean).join(" · ");
  const desktopShell = typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("clusterDesktop") === "1" || /ClusterDesktop\//i.test(window.navigator.userAgent));
  const detachableWorkspaceRoute = desktopWorkspaceRouteFromCurrentLocation(currentRoute);
  useDesktopNotificationSync({ enabled: desktopShell && canSeeNotifications && settings.browserNotifications === true && hasNativeNotificationDelivery(settings), user, settings });
  useEffect(() => {
    const handleMouseHistory = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        window.history.back();
      } else if (event.button === 4) {
        event.preventDefault();
        window.history.forward();
      }
    };
    const handleKeyboardHistory = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !shouldHandleGlobalNavigationShortcut(event)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        window.history.back();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        window.history.forward();
      }
    };
    if (desktopShell) window.addEventListener("mouseup", handleMouseHistory, true);
    window.addEventListener("keydown", handleKeyboardHistory, true);
    return () => {
      if (desktopShell) window.removeEventListener("mouseup", handleMouseHistory, true);
      window.removeEventListener("keydown", handleKeyboardHistory, true);
    };
  }, [desktopShell]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const accountUtilityInvocationRef = useRef(createClusterCommandInvocation());
  const [accountUtilityBusy, setAccountUtilityBusy] = useState(false);
  const [accountUtilityError, setAccountUtilityError] = useState("");
  function invokeAccountUtility(action: () => void | boolean | Promise<void | boolean>, failure: string) {
    // Invoke synchronously from the activating user gesture (native clipboard
    // and window actions cannot be deferred to a microtask before invocation).
    const pending = accountUtilityInvocationRef.current.run(action);
    if (!pending) return;
    setAccountUtilityError("");
    setAccountUtilityBusy(true);
    void pending.then((confirmed) => {
      if (confirmed) setUserMenuOpen(false);
      else setAccountUtilityError(failure);
    }).finally(() => setAccountUtilityBusy(false));
  }
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationSeverity, setNotificationSeverity] = useState<NotificationSeverity>("info");
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [notificationPreviewItems, setNotificationPreviewItems] = useState<NotificationPreview[]>([]);
  const [notificationPreviewLoading, setNotificationPreviewLoading] = useState(false);
  const [notificationActionBusy, setNotificationActionBusy] = useState(false);
  const [notificationActionError, setNotificationActionError] = useState("");
  const notificationRequestGateRef = useRef(createTaskbarActionRequestGate());
  const [notificationToast, setNotificationToast] = useState<NotificationPreview | null>(null);
  const [notificationToastQueue, setNotificationToastQueue] = useState<NotificationPreview[]>([]);
  const notificationSeenIds = useRef<Set<string>>(new Set());
  const notificationStreamRef = useRef<EventSource | null>(null);
  const notificationStreamRevisionRef = useRef(0);
  const [ticketMenuOpen, setTicketMenuOpen] = useState(false);
  const [ticketCreateOpen, setTicketCreateOpen] = useState(false);
  const [personalTickets, setPersonalTickets] = useState<TicketCard[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketSaving, setTicketSaving] = useState(false);
  // One taskbar Quick Ticket submission per intent, before React can rerender.
  // Uncertain retries reuse the server receipt; only an explicit new form resets it.
  const ticketCreateIntentRef = useRef(createClusterCreateIntentControl());
  const ticketLoadSequenceRef = useRef(0);
  const [ticketStatus, setTicketStatus] = useState("");
  const [ticketDraft, setTicketDraft] = useState({
    title: "",
    description: "",
    priority: "medium" as Priority,
    projectId: "",
    boardId: "",
    listId: "",
  });
  const [ticketBoardOptions, setTicketBoardOptions] = useState<Board[]>([]);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [presenceError, setPresenceError] = useState("");
  const presenceRequestGateRef = useRef(createTaskbarActionRequestGate());
  const [presenceMessage, setPresenceMessage] = useState(user.statusMessage || "");
  const userMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notificationMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ticketMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    setPresenceMessage(user.statusMessage || "");
  }, [user.statusMessage]);
  async function updateOwnPresence(availability = user.status || "available", message: string | null = presenceMessage.trim() || null, connectionVisibility?: "visible" | "invisible") {
    const gate = presenceRequestGateRef.current;
    if (!gate.beginMutation()) return;
    setPresenceBusy(true);
    setPresenceError("");
    try {
      await onPresenceChange(availability, message, connectionVisibility);
    } catch (error) {
      setPresenceError(error instanceof Error ? error.message : "Could not save your presence. Try again.");
    } finally {
      gate.endMutation();
      setPresenceBusy(false);
    }
  }
  function ticketIsClosed(card: TicketCard) {
    return card.ticketStage ? ["resolved", "rejected"].includes(card.ticketStage) : Boolean(card.listIsDone || /done|closed|complete|approved|resolved|shipped/i.test(card.listTitle));
  }
  async function loadPersonalTickets() {
    const requestId = ++ticketLoadSequenceRef.current;
    if (!canSeeTickets) {
      setPersonalTickets([]);
      setTicketLoading(false);
      return;
    }
    setTicketLoading(true);
    try {
      const workspace = await queryApi<{ boards: Board[] }>("/api/tickets/workspace", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force: false, tags: ["tickets", "workspace"] });
      if (requestId === ticketLoadSequenceRef.current) setTicketBoardOptions(workspace.boards || []);
      const rows = collectBoardCards(workspace.boards || [])
        .filter((card) => card.assigneeId === user.id)
        .filter((card) => card.workItemKind === "ticket")
        .filter((card) => !ticketIsClosed(card))
        .sort((a, b) => {
          const weight = { urgent: 4, high: 3, medium: 2, low: 1 } as const;
          const priorityDelta = weight[b.priority] - weight[a.priority];
          if (priorityDelta) return priorityDelta;
          const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue || a.title.localeCompare(b.title);
        });
      if (requestId !== ticketLoadSequenceRef.current) return;
      setPersonalTickets(rows);
      // A successful submission notice should not vanish during list reconciliation.
      setTicketStatus((message) => message.startsWith("Ticket submitted") ? message : "");
    } catch (error) {
      if (requestId === ticketLoadSequenceRef.current) setTicketStatus(error instanceof Error ? error.message : "Your tickets could not be loaded.");
    } finally {
      if (requestId === ticketLoadSequenceRef.current) setTicketLoading(false);
    }
  }
  function openPersonalTickets(query = "") {
    setTicketMenuOpen(false);
    setTicketCreateOpen(false);
    openTicketWorkspace({ assigneeId: user.id, query });
  }
  async function submitPersonalTicket() {
    if (!ticketCreateIntentRef.current.begin()) {
      if (ticketCreateIntentRef.current.committed) setTicketStatus("This ticket was already submitted. Choose New ticket to start another.");
      return;
    }
    const title = ticketDraft.title.trim();
    if (!title) {
      setTicketStatus("Add a ticket title.");
      ticketCreateIntentRef.current.finish();
      return;
    }
    if (settings.ticketsRequireProject && !ticketDraft.projectId) {
      setTicketStatus("Select a project. Studio policy requires one for new tickets.");
      ticketCreateIntentRef.current.finish();
      return;
    }
    if (ticketDraft.projectId && !ticketDraft.listId) {
      setTicketStatus("Choose an active destination Board and List for this Project Ticket, or use Studio Tickets.");
      ticketCreateIntentRef.current.finish();
      return;
    }
    setTicketSaving(true);
    setTicketStatus("");
    try {
      const body = JSON.stringify({
        projectId: ticketDraft.projectId || null,
        boardId: ticketDraft.projectId ? ticketDraft.boardId || null : null,
        listId: ticketDraft.projectId ? ticketDraft.listId || null : null,
        title,
        description: ticketDraft.description.trim(),
        priority: ticketDraft.priority,
        labels: ["personal-submission"],
        assigneeId: user.id,
      });
      const headers = new Headers();
      headers.set("X-Cluster-Idempotency-Key", ticketCreateIntentRef.current.requestKey("POST", "/api/tickets", body));
      await api<TicketCard>("/api/tickets", { method: "POST", body, headers });
      // Commit immediately after the server acknowledges creation. Subsequent
      // list-refresh or notification failures must never recreate this ticket.
      ticketCreateIntentRef.current.commit();
      setTicketDraft({
        title: "",
        description: "",
        priority: "medium",
        projectId: "",
        boardId: "",
        listId: "",
      });
      setTicketCreateOpen(false);
      setTicketStatus("Ticket submitted and assigned to you.");
      await loadPersonalTickets();
      window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
    } catch (error) {
      setTicketStatus(error instanceof Error ? error.message : "Ticket submission failed.");
    } finally {
      ticketCreateIntentRef.current.finish();
      setTicketSaving(false);
    }
  }
  useEffect(() => {
    if (!canSeeTickets) { ++ticketLoadSequenceRef.current; return; }
    void loadPersonalTickets();
    const refresh = () => void loadPersonalTickets();
    window.addEventListener("cluster-ticket-workspace-changed", refresh);
    return () => { ++ticketLoadSequenceRef.current; window.removeEventListener("cluster-ticket-workspace-changed", refresh); };
  }, [canSeeTickets, user.id]);

  useVisibleRefresh(() => loadPersonalTickets(), { enabled: canSeeTickets, intervalMs: 60_000 });
  function notificationAllowed(item: NotificationPreview) {
    if (!notificationCategoryEnabled(settings, item.category)) return false;
    if (!notificationPriorityAllowed(settings, item.priority, item.category)) return false;
    if (!notificationToolAllowed(settings, item.tool, item.priority, item.category)) return false;
    if (!item.projectId || item.category === "mentions" || item.category === "system") return true;
    const mode = settings.notificationProjectModes?.[item.projectId] || "all";
    if (mode === "off") return false;
    if (mode === "important") return item.priority === "critical" || item.priority === "high";
    return true;
  }
  function notificationShouldToast(item: NotificationPreview) {
    if (!notificationAllowed(item)) return false;
    const policy = item.metadata?.notificationPolicy;
    if (policy && typeof policy === "object" && !Array.isArray(policy)) {
      const authoritative = policy as Record<string, unknown>;
      if (authoritative.interruptive === false) return false;
      const delivery = String(authoritative.deliveryMode || notificationDeliveryMode(settings, item.category));
      return delivery === "toast" || delivery === "both";
    }
    const delivery = notificationEffectiveDelivery(settings, item.category, item.priority);
    return delivery === "toast" || delivery === "both";
  }
  function notificationDeliveryToken(item: NotificationPreview) {
    return `${item.id}:${Math.max(0, Number(item.escalationLevel || 0))}`;
  }
  function notificationCategoryIcon(categoryValue: string): ClusterIconName {
    const category = categoryValue as NotificationCategory;
    return ({ mentions: "comment", approvals: "check", work: "work", schedule: "calendar", delivery: "cloud", qa: "check", system: "warning", activity: "activity" } as Record<NotificationCategory, ClusterIconName>)[category] || "bell";
  }
  function enqueueNotification(item: NotificationPreview) {
    if (!item?.id) return;
    const token = notificationDeliveryToken(item);
    if (notificationSeenIds.current.has(token) || (Number(item.escalationLevel || 0) === 0 && notificationSeenIds.current.has(item.id))) return;
    notificationSeenIds.current.add(token);
    const escalationInterrupt = Boolean(item.requiresAction && !item.acknowledgedAt && Number(item.escalationLevel || 0) > 0);
    if ((item.read && !escalationInterrupt) || !notificationAllowed(item)) return;
    window.dispatchEvent(new CustomEvent(CLUSTER_LIVE_NOTIFICATION_EVENT, { detail: item }));
    if (!notificationShouldToast(item)) return;
    playClusterNotificationSound();
    setNotificationToastQueue((queue) => queue.some((queued) => notificationDeliveryToken(queued) === token) ? queue : [...queue, item]);
  }
  async function loadNotificationPreview(showSpinner = false) {
    if (!canSeeNotifications) return;
    const gate = notificationRequestGateRef.current;
    const request = gate.beginRead();
    setNotificationPreviewLoading(showSpinner);
    setNotificationActionError("");
    try {
      const page = await api<{ items: NotificationPreview[] }>("/api/notifications?limit=8&includeRead=true");
      if (gate.currentRead(request)) setNotificationPreviewItems((page.items || []).filter(notificationAllowed));
    } catch (error) {
      if (gate.currentRead(request)) setNotificationActionError(error instanceof Error ? error.message : "Could not refresh notifications.");
    } finally {
      if (gate.currentRead(request)) setNotificationPreviewLoading(false);
    }
  }
  // Both a single notification and the visible bulk action use this same
  // immediate gate. Do not present read=true until the server confirms it.
  async function markNotificationPreviewRead(ids: string[]) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return;
    const gate = notificationRequestGateRef.current;
    if (!gate.beginMutation()) return;
    setNotificationPreviewLoading(false);
    setNotificationActionBusy(true);
    setNotificationActionError("");
    try {
      await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: uniqueIds, read: true }) });
      const confirmed = new Set(uniqueIds);
      setNotificationPreviewItems((items) => items.map((item) => confirmed.has(item.id) ? { ...item, read: true } : item));
      window.dispatchEvent(new Event(CLUSTER_NOTIFICATION_READ_STATE_EVENT));
    } catch (error) {
      setNotificationActionError(error instanceof Error ? error.message : "Could not mark notifications read. Please retry.");
    } finally {
      gate.endMutation();
      setNotificationActionBusy(false);
    }
  }
  function openNotificationPreview(item: NotificationPreview) {
    void markNotificationPreviewRead([item.id]);
    setNotificationMenuOpen(false);
    setNotificationToast((current) => current?.id === item.id ? null : current);
    const route = String(item.metadata?.route || "");
    if (item.entityType === "password_reset_request") { onOpenUserAdmin(); return; }
    if (openClusterWorkNavigation(notificationWorkNavigation(item))) return;
    if (route === "people") { onOpenPeople(); return; }
    if (item.projectId) { onOpenProject(item.projectId); return; }
    onOpenNotifications();
  }
  useEffect(() => {
    if (notificationToast || !notificationToastQueue.length || document.visibilityState !== "visible") return;
    const [next, ...remaining] = notificationToastQueue;
    setNotificationToast(next);
    setNotificationToastQueue(remaining);
  }, [notificationToast, notificationToastQueue]);
  useEffect(() => {
    if (!notificationToast) return;
    const duration = notificationToast.priority === "critical" ? 10_000 : notificationToast.priority === "high" ? 8_000 : 6_500;
    const timer = window.setTimeout(() => setNotificationToast((current) => current?.id === notificationToast.id ? null : current), duration);
    return () => window.clearTimeout(timer);
  }, [notificationToast?.id]);
  useEffect(() => {
    if (!canSeeNotifications) {
      notificationRequestGateRef.current.invalidateReads();
      setNotificationCount(0);
      setNotificationSeverity("info");
      notificationRequestGateRef.current.invalidateReads();
      setNotificationPreviewItems([]);
      setNotificationActionError("");
      setNotificationToast(null);
      setNotificationToastQueue([]);
      notificationSeenIds.current.clear();
      return;
    }
    let alive = true;
    let primed = false;
    let requestInFlight = false;
    let refreshPending = false;
    let forcePending = false;
    async function loadNotificationBadge(discoverNew = true, forceRefresh = false) {
      if (requestInFlight) { refreshPending = true; forcePending ||= forceRefresh; return; }
      requestInFlight = true;
      const version = notificationRequestGateRef.current.snapshotVersion();
      const streamRevision = notificationStreamRevisionRef.current;
      try {
        const [result, preview] = await Promise.all([
          queryApi<{ ok: boolean; summary: { unread: number; critical: number; high: number } }>("/api/notifications/summary", { force: forceRefresh, staleMs: 5_000, maxAgeMs: 60_000, persist: false, tags: ["inbox", "notifications"] }),
          api<{ items: NotificationPreview[] }>("/api/notifications?limit=40&includeRead=true").catch(() => null),
        ]);
        if (!alive || !notificationRequestGateRef.current.versionUnchanged(version)) return;
        const nextItems = preview?.items || [];
        setNotificationCount(Math.max(0, Number(result.summary?.unread || 0)));
        setNotificationSeverity(result.summary?.critical ? "critical" : result.summary?.high ? "important" : "info");
        if (preview && streamRevision === notificationStreamRevisionRef.current) {
          setNotificationPreviewItems(nextItems.filter(notificationAllowed).slice(0, 8));
          if (!primed || !discoverNew) {
            for (const item of nextItems) notificationSeenIds.current.add(notificationDeliveryToken(item));
            primed = true;
          } else {
            [...nextItems].reverse().forEach(enqueueNotification);
          }
        }
      } finally {
        requestInFlight = false;
        if (alive && (refreshPending || !notificationRequestGateRef.current.versionUnchanged(version))) {
          const force = forcePending || !notificationRequestGateRef.current.versionUnchanged(version);
          refreshPending = false;
          forcePending = false;
          void loadNotificationBadge(false, force).catch(() => undefined);
        }
      }
    }
    async function refreshNotificationSummaryOnly() {
      const version = notificationRequestGateRef.current.snapshotVersion();
      const result = await queryApi<{ ok: boolean; summary: { unread: number; critical: number; high: number } }>("/api/notifications/summary", { force: true, staleMs: 5_000, maxAgeMs: 60_000, persist: false, tags: ["inbox", "notifications"] });
      if (!alive || !notificationRequestGateRef.current.versionUnchanged(version)) return;
      setNotificationCount(Math.max(0, Number(result.summary?.unread || 0)));
      setNotificationSeverity(result.summary?.critical ? "critical" : result.summary?.high ? "important" : "info");
    }
    const refreshNotificationBadge = (event?: Event) => {
      if (document.visibilityState === "visible") void loadNotificationBadge(true, event?.type === CLUSTER_NOTIFICATION_READ_STATE_EVENT).catch(() => undefined);
    };
    void loadNotificationBadge(false).catch(() => undefined);

    let reconnectTimer = 0;
    let reconnectAttempts = 0;
    let badgeTimer = 0;
    let summaryTimer = 0;
    let streamLive = false;
    const clearReconnect = () => { if (reconnectTimer) window.clearTimeout(reconnectTimer); reconnectTimer = 0; };
    const clearBadge = () => { if (badgeTimer) window.clearTimeout(badgeTimer); badgeTimer = 0; };
    const clearSummary = () => { if (summaryTimer) window.clearTimeout(summaryTimer); summaryTimer = 0; };
    const canRecoverStream = () => alive && document.visibilityState === "visible" && navigator.onLine;
    const scheduleReconnect = () => {
      clearReconnect();
      if (!canRecoverStream()) return;
      reconnectAttempts += 1;
      const delay = reconnectBackoffDelay(reconnectAttempts, { baseMs: 2_000, maxMs: 60_000 });
      reconnectTimer = window.setTimeout(() => { reconnectTimer = 0; connectStream(); }, delay);
    };
    const connectStream = () => {
      if (!canRecoverStream() || typeof EventSource === "undefined" || notificationStreamRef.current) return;
      try {
        const url = new URL(`${API_URL}/api/notifications/stream`, window.location.origin);
        const source = new EventSource(url.toString(), { withCredentials: true });
        notificationStreamRef.current = source;
        const markStreamLive = () => {
          reconnectAttempts = 0;
          streamLive = true;
          scheduleBadgeRefresh();
        };
        source.onopen = markStreamLive;
        source.addEventListener("ready", markStreamLive);
        source.addEventListener("notification", (event) => {
          if (!alive) return;
          try {
            const item = JSON.parse((event as MessageEvent).data) as NotificationPreview;
            enqueueNotification(item);
            notificationStreamRevisionRef.current++;
            notificationRequestGateRef.current.invalidateReads();
            setNotificationPreviewLoading(false);
            setNotificationPreviewItems((current) => [item, ...current.filter((existing) => existing.id !== item.id)].filter(notificationAllowed).slice(0, 8));
            clearSummary();
            summaryTimer = window.setTimeout(() => {
              summaryTimer = 0;
              void refreshNotificationSummaryOnly().catch(() => undefined);
            }, 250);
          } catch { /* malformed notification frame */ }
        });
        source.onerror = () => {
          streamLive = false;
          source.close();
          if (notificationStreamRef.current === source) notificationStreamRef.current = null;
          scheduleBadgeRefresh();
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };
    const scheduleBadgeRefresh = () => {
      clearBadge();
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) return;
      // The stream is authoritative for new notifications. While healthy, the list/summary poll
      // is only a slow reconciliation path for missed frames or read-state changes elsewhere.
      const delay = streamLive ? 5 * 60_000 : 60_000;
      badgeTimer = window.setTimeout(async () => { badgeTimer = 0; refreshNotificationBadge(); scheduleBadgeRefresh(); }, delay);
    };
    const recoverVisibleOnline = () => {
      if (!alive || document.visibilityState !== "visible" || !navigator.onLine) { clearBadge(); clearReconnect(); clearSummary(); return; }
      reconnectAttempts = 0;
      setNotificationToastQueue((queue) => [...queue]);
      refreshNotificationBadge();
      scheduleBadgeRefresh();
      connectStream();
    };
    const onVisibility = () => recoverVisibleOnline();
    const onOffline = () => { streamLive = false; clearBadge(); clearReconnect(); clearSummary(); notificationStreamRef.current?.close(); notificationStreamRef.current = null; };
    connectStream();
    scheduleBadgeRefresh();
    window.addEventListener("focus", recoverVisibleOnline);
    window.addEventListener("online", recoverVisibleOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(CLUSTER_NOTIFICATION_READ_STATE_EVENT, refreshNotificationBadge);
    return () => {
      alive = false;
      clearBadge();
      clearReconnect();
      clearSummary();
      notificationStreamRef.current?.close();
      notificationStreamRef.current = null;
      window.removeEventListener("focus", recoverVisibleOnline);
      window.removeEventListener("online", recoverVisibleOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(CLUSTER_NOTIFICATION_READ_STATE_EVENT, refreshNotificationBadge);
    };
  }, [canSeeNotifications, user.id, settings.notificationCategoryDelivery, settings.notificationProjectModes, settings.notificationToolModes, settings.notificationPriorityFloor, settings.userQuietHoursEnabled, settings.userQuietHoursStart, settings.userQuietHoursEnd, settings.notificationQuietHoursBehavior]);
  const desktopActiveProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) : undefined;
  useEffect(() => {
    if (!desktopShell) return;
    window.__clusterDesktopState = {
      schema: 2,
      unreadNotifications: Math.max(0, Math.min(100000, Math.floor(notificationCount))),
      activeScreen: String(screen),
      activeRoute: String(currentRoute || screen).slice(0, 420),
      activeInspector: new URL(window.location.href).searchParams.get("inspect")?.slice(0, 220) || undefined,
      serverLabel: String(settings.studioName || settings.appDisplayName || "Cluster").slice(0, 120),
      userLabel: String(user.displayName || user.username || "").slice(0, 120),
      presenceLabel: String(presenceLabel(user) || user.status || "").slice(0, 160),
      activeProjectId: desktopActiveProject?.id,
      activeProjectName: desktopActiveProject?.name?.slice(0, 120),
    };
    return () => {
      delete window.__clusterDesktopState;
    };
  }, [desktopShell, notificationCount, screen, currentRoute, settings.studioName, settings.appDisplayName, user.displayName, user.username, user.status, user.statusMessage, desktopActiveProject?.id, desktopActiveProject?.name]);
  useEffect(() => {
    if (!desktopShell) return;
    const syncInspector = () => {
      if (!window.__clusterDesktopState) return;
      window.__clusterDesktopState = {
        ...window.__clusterDesktopState,
        activeInspector: new URL(window.location.href).searchParams.get("inspect")?.slice(0, 220) || undefined,
      };
    };
    syncInspector();
    window.addEventListener("cluster:inspector-state-changed", syncInspector);
    window.addEventListener("popstate", syncInspector);
    return () => {
      window.removeEventListener("cluster:inspector-state-changed", syncInspector);
      window.removeEventListener("popstate", syncInspector);
    };
  }, [desktopShell]);
  const notificationBadgeLabel = `${notificationCount} unread ${notificationSeverity} notification${notificationCount === 1 ? "" : "s"}`;
  const taskbarUserMenu = (
    <div className="taskbar-user-menu-v078 taskbar-user-menu-pinned-v145">
      <ClusterButton ref={userMenuTriggerRef} unstyled type="button" className={`taskbar-profile-v073 ${screen === "people" ? "active" : ""}`} onClick={() => { if (presenceRequestGateRef.current.isMutating() || accountUtilityInvocationRef.current.isExecuting()) return; setAccountUtilityError(""); setUserMenuOpen((open) => !open); setNotificationMenuOpen(false); setTicketMenuOpen(false); }} title="Open account menu" aria-haspopup="dialog" aria-expanded={userMenuOpen}>
        <PresenceAvatar userId={user.id} imageUrl={user.avatarUrl} accentColor={user.personalAccentColor} label={displayUserName(user)} fallback={userInitial(user)} state={presenceState(user)} title={presenceLabel(user)} className="taskbar-profile-avatar-v227" />
        <span className="taskbar-profile-copy-v546">
          <strong>{displayUserName(user)}</strong>
          <small>{presenceLabel(user)}</small>
        </span>
        <ClusterIcon name="chevron-down" className="taskbar-chevron-v227" />
      </ClusterButton>
      <ClusterFloatingSurface
        open={userMenuOpen}
        anchorRef={userMenuTriggerRef}
        placement="bottom-end"
        mobileMode="sheet"
        className="taskbar-user-dropdown-v078 taskbar-user-dropdown-v228 taskbar-account-menu-v546 taskbar-floating-menu-v522"
        label="Account and presence"
        canDismiss={() => !presenceRequestGateRef.current.isMutating() && !accountUtilityInvocationRef.current.isExecuting()}
        onDismiss={() => { if (!presenceRequestGateRef.current.isMutating() && !accountUtilityInvocationRef.current.isExecuting()) setUserMenuOpen(false); }}
      >
        <header className="taskbar-account-header-v546">
          <ClusterButton unstyled type="button" className="taskbar-account-identity-v546" onClick={() => { setUserMenuOpen(false); onOpenProfile(); }}>
            <PresenceAvatar userId={user.id} imageUrl={user.avatarUrl} accentColor={user.personalAccentColor} label={displayUserName(user)} fallback={userInitial(user)} state={presenceState(user)} title={presenceLabel(user)} className="taskbar-menu-avatar-v228" />
            <span className="taskbar-account-copy-v546">
              <span className="taskbar-account-name-row-v546">
                <strong>{displayUserName(user)}</strong>
                {user.isAdmin && <small className="taskbar-account-admin-chip-v546">Admin</small>}
              </span>
              <span className="taskbar-account-username-v546">@{user.username}</span>
              <span className="taskbar-account-role-v546">{accountRoleLabel}{accountContextLabel ? ` · ${accountContextLabel}` : ""}</span>
            </span>
            <ClusterIcon name="chevron-right" className="taskbar-account-chevron-v546" />
          </ClusterButton>
          <div className="taskbar-account-facts-v546" aria-label="Account summary">
            <span><strong>{assignedProjectCount}</strong> project{assignedProjectCount === 1 ? "" : "s"}</span>
            {primaryStudioTeam?.name && <span>{primaryStudioTeam.name}</span>}
            <span>{user.connectionVisibility === "invisible" ? "Invisible" : presenceLabel(user)}</span>
          </div>
        </header>

        <section className="taskbar-account-section-v546" aria-labelledby="taskbar-presence-heading">
          <div className="taskbar-account-section-heading-v546">
            <span id="taskbar-presence-heading">Presence</span>
            {presenceBusy && <small>Saving…</small>}
          </div>
          {presenceError ? <p role="alert" className="taskbar-presence-error-v548">{presenceError}</p> : null}
          <div className="taskbar-presence-presets-v546" role="group" aria-label="Presence status">
            {TASKBAR_PRESENCE_OPTIONS.map((option) => {
              const active = (user.status || "available") === option.value;
              return (
                <ClusterButton
                  key={option.value}
                  unstyled
                  type="button"
                  className={`taskbar-presence-option-v546 ${active ? "active" : ""}`}
                  data-status={option.value}
                  aria-pressed={active}
                  disabled={presenceBusy}
                  onClick={() => void updateOwnPresence(option.value)}
                >
                  <span className="taskbar-presence-dot-v546" aria-hidden="true" />
                  <span><strong>{option.label}</strong><small>{option.meta}</small></span>
                </ClusterButton>
              );
            })}
          </div>
          <ClusterButton
            unstyled
            type="button"
            className={`taskbar-presence-visibility-v546 ${user.connectionVisibility === "invisible" ? "active" : ""}`}
            aria-pressed={user.connectionVisibility === "invisible"}
            disabled={presenceBusy}
            onClick={() => void updateOwnPresence(user.status || "available", presenceMessage.trim() || null, user.connectionVisibility === "invisible" ? "visible" : "invisible")}
          >
            <span className="taskbar-account-action-icon-v546"><ClusterIcon name={user.connectionVisibility === "invisible" ? "cloud-off" : "cloud"} /></span>
            <span><strong>{user.connectionVisibility === "invisible" ? "Become visible" : "Appear offline"}</strong><small>{user.connectionVisibility === "invisible" ? "Your availability will be visible again." : "Hide presence without changing availability or time records."}</small></span>
          </ClusterButton>
          <div className="taskbar-presence-message-v228 taskbar-presence-message-v546">
            <ClusterTextInput value={presenceMessage} onChange={(event) => setPresenceMessage(event.target.value)} placeholder="Add a status message" maxLength={120} aria-label="Status message" />
            {presenceMessage && (
              <ClusterButton unstyled type="button" className="taskbar-status-clear-v546" onClick={() => { setPresenceMessage(""); void updateOwnPresence(user.status || "available", null); }} disabled={presenceBusy}>
                Clear
              </ClusterButton>
            )}
            <ClusterButton unstyled type="button" className="taskbar-status-save-v546" onClick={() => void updateOwnPresence()} disabled={presenceBusy}>
              Save
            </ClusterButton>
          </div>
        </section>

        <section className="taskbar-account-section-v546" aria-labelledby="taskbar-account-heading">
          <div className="taskbar-account-section-heading-v546"><span id="taskbar-account-heading">Account</span></div>
          <div className="taskbar-account-actions-v546">
            <ClusterButton unstyled type="button" onClick={() => { setUserMenuOpen(false); onOpenProfile(); }}>
              <span className="taskbar-account-action-icon-v546"><ClusterIcon name="user" /></span>
              <span><strong>My profile</strong><small>Profile, identity, and contact details</small></span>
              <ClusterIcon name="chevron-right" className="taskbar-account-action-chevron-v546" />
            </ClusterButton>
            {canSeeSettings && (
              <ClusterButton unstyled type="button" onClick={() => { setUserMenuOpen(false); onOpenSettings(); }}>
                <span className="taskbar-account-action-icon-v546"><ClusterIcon name="settings" /></span>
                <span><strong>Settings</strong><small>Appearance, account, and preferences</small></span>
                <ClusterIcon name="chevron-right" className="taskbar-account-action-chevron-v546" />
              </ClusterButton>
            )}
            {canSeePeople && (
              <ClusterButton unstyled type="button" onClick={() => { setUserMenuOpen(false); onOpenPeople(); }}>
                <span className="taskbar-account-action-icon-v546"><ClusterIcon name="users" /></span>
                <span><strong>People</strong><small>Directory, teams, and availability</small></span>
                <ClusterIcon name="chevron-right" className="taskbar-account-action-chevron-v546" />
              </ClusterButton>
            )}
            {user.isAdmin && (
              <ClusterButton unstyled type="button" onClick={() => { setUserMenuOpen(false); onOpenUserAdmin(); }}>
                <span className="taskbar-account-action-icon-v546"><ClusterIcon name="tools" /></span>
                <span><strong>User administration</strong><small>Accounts, access, and security actions</small></span>
                <ClusterIcon name="chevron-right" className="taskbar-account-action-chevron-v546" />
              </ClusterButton>
            )}
          </div>
        </section>

        <section className="taskbar-account-section-v546 taskbar-account-section-utility-v546" aria-labelledby="taskbar-utility-heading">
          <div className="taskbar-account-section-heading-v546"><span id="taskbar-utility-heading">Current workspace</span></div>
          <div className="taskbar-account-utility-actions-v546" aria-busy={accountUtilityBusy}>
            <ClusterButton unstyled type="button" disabled={accountUtilityBusy} onClick={() => { const shareable = `${window.location.origin}${window.location.pathname}${window.location.hash}`; invokeAccountUtility(() => copyClusterText(shareable), "Could not copy the workspace link. Check clipboard permissions and try again."); }}>
              <ClusterIcon name="link" />
              <span>Copy link to current view</span>
            </ClusterButton>
            {detachableWorkspaceRoute && typeof window !== "undefined" && window.clusterDesktop?.openWorkspaceWindow && (
              <ClusterButton unstyled type="button" disabled={accountUtilityBusy} onClick={() => invokeAccountUtility(() => openCurrentWorkInDesktopWindow(currentRoute || screen, "Cluster workspace"), "The desktop window could not be opened. Your current workspace is unchanged.")}>
                <ClusterIcon name="panel-open" />
                <span>Open current work in new window</span>
              </ClusterButton>
            )}
            {typeof window !== "undefined" && window.clusterDesktop?.showConnection && (
              <ClusterButton unstyled type="button" onClick={() => { setUserMenuOpen(false); void window.clusterDesktop?.showConnection?.(); }}>
                <ClusterIcon name="operations" />
                <span>Switch server</span>
              </ClusterButton>
            )}
            {accountUtilityError && <div role="alert" className="taskbar-account-utility-error-v546">{accountUtilityError}</div>}
          </div>
        </section>

        <div className="taskbar-account-signout-v546">
          <ClusterButton unstyled type="button" className="danger" onClick={() => { setUserMenuOpen(false); onLogout(); }}>
            <span className="taskbar-account-action-icon-v546"><ClusterIcon name="forward" /></span>
            <span><strong>Sign out</strong><small>End this Cluster session</small></span>
          </ClusterButton>
        </div>
      </ClusterFloatingSurface>
    </div>
  );
  return (
    <>
      <MobileViewportRuntime />
      <ClusterTaskbar searchOpen={commandPaletteOpen}
        left={<>
            <TaskbarHistory resumeContext={resumeContext} onResumeContext={onResumeContext} onClearResumeContext={onClearResumeContext} />
            {canSeeMyWork && (
              <ClusterButton unstyled type="button" className={`cluster-taskbar-action my-work ${screen === "mywork" ? "is-active" : ""}`} onClick={onOpenMyWork} title="Open your work hub">
                <ClusterIcon name="work" className="cluster-taskbar-action__icon" />
                <span className="cluster-taskbar-action__label">My Work</span>
                <em className="cluster-taskbar-action__badge">{assignedProjectCount}</em>
              </ClusterButton>
            )}
            {canSeeNotifications && (
              <div className="taskbar-notification-menu-v473">
                <ClusterButton ref={notificationMenuTriggerRef} unstyled type="button" className={`cluster-taskbar-action cluster-taskbar-action--icon notifications severity-${notificationSeverity} ${screen === "inbox" || notificationMenuOpen ? "is-active" : ""}`} onClick={() => { if (notificationRequestGateRef.current.isMutating()) return; setNotificationMenuOpen((open) => !open); setUserMenuOpen(false); setTicketMenuOpen(false); if (!notificationMenuOpen) void loadNotificationPreview(true); }} title={notificationBadgeLabel} aria-label={`Inbox, ${notificationBadgeLabel}`} aria-haspopup="dialog" aria-expanded={notificationMenuOpen}>
                  <ClusterIcon name="bell" className="cluster-taskbar-action__icon" />
                  <span className={`taskbar-count-badge-v086 severity-${notificationSeverity} ${notificationCount ? "" : "empty"}`} aria-hidden="true">{notificationCount > 99 ? "99+" : notificationCount}</span>
                </ClusterButton>
                <ClusterFloatingSurface open={notificationMenuOpen} anchorRef={notificationMenuTriggerRef} placement="bottom-start" mobileMode="sheet" className="notification-popover-v473 taskbar-floating-menu-v522" label="Recent notifications" canDismiss={() => !notificationRequestGateRef.current.isMutating()} onDismiss={() => { if (!notificationRequestGateRef.current.isMutating()) setNotificationMenuOpen(false); }}>
                  <header><div><strong>Inbox</strong><span>{notificationCount ? `${notificationCount} unread` : "You're caught up"}</span></div><ClusterButton type="button" className="" onClick={() => void loadNotificationPreview(true)} disabled={notificationPreviewLoading || notificationActionBusy} variant="quiet" size="compact">{notificationPreviewLoading ? "Loading…" : "Refresh"}</ClusterButton></header>
                  <div className="notification-popover-list-v473">{notificationActionError ? <p role="alert" className="taskbar-notification-error-v548">{notificationActionError}</p> : null}{notificationPreviewItems.length ? notificationPreviewItems.map((item) => <ClusterButton unstyled type="button" key={item.id} className="notification-popover-item-v473" data-priority={item.priority} data-category={item.category} onClick={() => openNotificationPreview(item)}><span className="notification-popover-icon-v473"><ClusterIcon name={notificationCategoryIcon(item.category)} /></span><span><small>{NOTIFICATION_CATEGORY_DETAILS[item.category as NotificationCategory]?.label || levelLabel(item.category)}</small><strong>{item.title}</strong><em>{item.message || levelLabel(item.category)}</em></span><time>{formatRelativeTime(item.createdAt)}</time></ClusterButton>) : <div className="notification-popover-empty-v473">No recent notifications.</div>}</div>
                  <footer>{notificationPreviewItems.some((item) => !item.read) ? <ClusterButton type="button" className="" busy={notificationActionBusy} disabled={notificationActionBusy} onClick={() => void markNotificationPreviewRead(notificationPreviewItems.filter((item) => !item.read).map((item) => item.id))} variant="secondary">{notificationActionBusy ? "Marking read…" : "Mark visible read"}</ClusterButton> : <span />}<ClusterButton type="button" className="" onClick={() => { setNotificationMenuOpen(false); onOpenNotifications(); }} variant="primary">View all</ClusterButton></footer>
                </ClusterFloatingSurface>
              </div>
            )}
            {canSeeTickets && (
              <div className="taskbar-ticket-menu-v254">
                <ClusterButton ref={ticketMenuTriggerRef} unstyled type="button"
                  className={`cluster-taskbar-action cluster-taskbar-action--icon tickets ${screen === "tickets" || ticketMenuOpen ? "is-active" : ""}`}
                  onClick={() => {
                    setTicketMenuOpen((open) => !open);
                    setUserMenuOpen(false);
                    setNotificationMenuOpen(false);
                  }}
                  title={`${personalTickets.length} open ticket${personalTickets.length === 1 ? "" : "s"} assigned to you`}
                  aria-label={`Open your tickets, ${personalTickets.length} open`}
                  aria-haspopup="dialog"
                  aria-expanded={ticketMenuOpen}
                >
                  <ClusterIcon name="ticket" className="cluster-taskbar-action__icon" />
                  <span className={`taskbar-ticket-count-v254 ${personalTickets.length ? "" : "empty"}`} aria-hidden="true">
                    {personalTickets.length > 99 ? "99+" : personalTickets.length}
                  </span>
                </ClusterButton>
                <ClusterFloatingSurface
                  open={ticketMenuOpen}
                  anchorRef={ticketMenuTriggerRef}
                  placement="bottom-start"
                  mobileMode="sheet"
                  className="taskbar-ticket-dropdown-v254 taskbar-floating-menu-v522"
                  label="Your tickets"
                  canDismiss={() => !ticketCreateIntentRef.current.inFlight}
                  onDismiss={() => { if (!ticketCreateIntentRef.current.inFlight) setTicketMenuOpen(false); }}
                >
                    <header>
                      <div>
                        <strong>My tickets</strong>
                        <span>{personalTickets.length} open and assigned to you</span>
                      </div>
                      <ClusterButton type="button" className="" onClick={() => void loadPersonalTickets()} disabled={ticketLoading} variant="quiet" size="compact">
                        {ticketLoading ? "Loading…" : "Refresh"}
                      </ClusterButton>
                    </header>
                    <div className="taskbar-ticket-actions-v254">
                      <ClusterButton
                        type="button"
                        className=""
                        onClick={() => {
                          if (ticketCreateIntentRef.current.inFlight) return;
                          if (ticketCreateOpen) {
                            setTicketCreateOpen(false);
                          } else {
                            // Only explicit New ticket starts a fresh receipt lifetime.
                            ticketCreateIntentRef.current.reset();
                            setTicketCreateOpen(true);
                          }
                          setTicketStatus("");
                        }}
                        disabled={ticketSaving}
                       variant="primary">
                        {ticketCreateOpen ? "Cancel" : "New ticket"}
                      </ClusterButton>
                      <ClusterButton type="button" className="" onClick={() => { if (!ticketCreateIntentRef.current.inFlight) openPersonalTickets(); }} disabled={ticketSaving} variant="secondary">
                        Open my tickets
                      </ClusterButton>
                    </div>
                    {ticketCreateOpen && (
                      <div className="taskbar-ticket-create-v254">
                        <label>
                          Title
                          <ClusterTextInput
                            value={ticketDraft.title}
                            onChange={(event) =>
                              setTicketDraft((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="What needs attention?"
                            maxLength={300}
                            autoFocus
                          />
                        </label>
                        <div>
                          <label>
                            Priority
                            <ClusterNativeSelect
                              value={ticketDraft.priority}
                              onChange={(event) =>
                                setTicketDraft((current) => ({
                                  ...current,
                                  priority: event.target.value as Priority,
                                }))
                              }
                            >
                              {PRIORITY_CREATE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </ClusterNativeSelect>
                          </label>
                          <label>
                            Project
                            <ClusterNativeSelect
                              value={ticketDraft.projectId}
                              onChange={(event) =>
                                setTicketDraft((current) => ({
                                  ...current,
                                  projectId: event.target.value,
                                  boardId: "",
                                  listId: "",
                                }))
                              }
                            >
                              <option value="">Studio ticket</option>
                              {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))}
                            </ClusterNativeSelect>
                          </label>
                        </div>
                        {ticketDraft.projectId && <div className="form-grid two-column">
                          <label>
                            Ticket destination Board
                            <ClusterNativeSelect value={ticketDraft.boardId} onChange={(event) => setTicketDraft((current) => ({ ...current, boardId: event.target.value, listId: "" }))}>
                              <option value="">Choose Board...</option>
                              {ticketBoardOptions.filter((board) => board.project.id === ticketDraft.projectId && !board.archived).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                            </ClusterNativeSelect>
                          </label>
                          <label>
                            Destination List
                            <ClusterNativeSelect value={ticketDraft.listId} disabled={!ticketDraft.boardId} onChange={(event) => setTicketDraft((current) => ({ ...current, listId: event.target.value }))}>
                              <option value="">Choose active List...</option>
                              {ticketBoardOptions.find((board) => board.id === ticketDraft.boardId)?.lists.filter((list) => !list.isDone).map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                            </ClusterNativeSelect>
                          </label>
                        </div>}
                        <label>
                          Details
                          <ClusterTextArea
                            value={ticketDraft.description}
                            onChange={(event) =>
                              setTicketDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="Optional context"
                            rows={3}
                            maxLength={100000}
                          />
                        </label>
                        <ClusterButton type="button" className="" onClick={() => void submitPersonalTicket()} disabled={ticketSaving || !ticketDraft.title.trim()} busy={ticketSaving} variant="primary">
                          {ticketSaving ? "Submitting…" : "Submit ticket"}
                        </ClusterButton>
                      </div>
                    )}
                    {ticketStatus && <p className="taskbar-ticket-status-v254">{ticketStatus}</p>}
                    <div className="taskbar-ticket-list-v254">
                      {personalTickets.length ? (
                        personalTickets.slice(0, 8).map((ticket) => (
                          <ClusterButton unstyled type="button" key={ticket.id} onClick={() => openPersonalTickets(ticket.title)}>
                            <span className={`priority-dot-v254 ${ticket.priority}`} aria-hidden="true" />
                            <strong>{ticket.title}</strong>
                            <em>
                              {ticket.projectName} · {ticket.listTitle}
                            </em>
                            {ticket.dueDate && <small>Due {compactDateTime(ticket.dueDate)}</small>}
                          </ClusterButton>
                        ))
                      ) : (
                        <div className="taskbar-ticket-empty-v254">
                          <strong>No open tickets assigned to you.</strong>
                          <span>Submit one here when you need work tracked.</span>
                        </div>
                      )}
                    </div>
                </ClusterFloatingSurface>
              </div>
            )}
            <ClusterButton unstyled type="button" className="cluster-taskbar-action cluster-taskbar-action--icon cluster-taskbar-create" onClick={onOpenQuickCreate} title="Quick create" aria-label="Quick create">
              <ClusterIcon name="plus" className="cluster-taskbar-action__icon" />
            </ClusterButton>
          </>}
        tabs={<TaskbarProjectTabs projects={projects} openProjectIds={openProjectIds} pinnedProjectIds={pinnedProjectIds} activeProjectId={activeProjectId} screen={screen} canSeeProjects={canSeeProjects} onOpenProject={onOpenProject} onOpenProjects={onOpenProjects} onOpenMyWork={onOpenMyWork} onToggleProjectPin={onToggleProjectPin} onMoveProjectTab={onMoveProjectTab} onCloseOtherProjects={onCloseOtherProjects} onCloseProject={onCloseProject} />}
        utilities={<>
            <TaskbarTransferCenter />
            <ClusterButton unstyled type="button" id="cluster-taskbar-search-trigger" className="cluster-taskbar-action cluster-taskbar-command" onClick={onOpenCommandPalette} title={commandPaletteOpen ? "Close search" : "Search Cluster and run commands"} aria-label={commandPaletteOpen ? "Close search" : "Search Cluster and run commands"} aria-expanded={commandPaletteOpen} aria-controls={commandPaletteOpen ? "cluster-command-palette" : undefined}>
              <ClusterIcon name={commandPaletteOpen ? "close" : "search"} className="cluster-taskbar-action__icon" />
              <span className="cluster-taskbar-action__label">{commandPaletteOpen ? "Close" : "Search"}</span>
              <kbd className="cluster-taskbar-action__hotkey">{settings.userCommandPaletteHotkey || "Ctrl+K"}</kbd>
            </ClusterButton>
            {taskbarUserMenu}
          </>}
      >
      {notificationToast && <div className="notification-toast-v473" role="status" data-priority={notificationToast.priority} data-category={notificationToast.category}>
        <ClusterButton unstyled type="button" className="notification-toast-main-v473" onClick={() => openNotificationPreview(notificationToast)}>
          <span className="notification-toast-icon-v473"><ClusterIcon name={notificationCategoryIcon(notificationToast.category)} /></span>
          <span><small>{NOTIFICATION_CATEGORY_DETAILS[notificationToast.category as NotificationCategory]?.label || levelLabel(notificationToast.category)}{notificationToast.priority === "critical" ? " · Critical" : notificationToast.priority === "high" ? " · Important" : ""}</small><strong>{notificationToast.title}</strong><em>{notificationToast.message || "Open Cluster to review this update."}</em></span>
        </ClusterButton>
        <ClusterButton unstyled type="button" className="notification-toast-close-v473" aria-label="Dismiss notification" onClick={() => setNotificationToast(null)}><ClusterIcon name="close" /></ClusterButton>
      </div>}
      </ClusterTaskbar>
      <MobilePrimaryNavigation
        screen={screen}
        canSeeProjects={canSeeProjects}
        canSeeMyWork={canSeeMyWork}
        canSeeNotifications={canSeeNotifications}
        notificationCount={notificationCount}
        searchOpen={commandPaletteOpen}
        onOpenHome={onOpenHome}
        onOpenProjects={onOpenProjects}
        onOpenMyWork={onOpenMyWork}
        onOpenQuickCreate={onOpenQuickCreate}
        onOpenSearch={() => { setUserMenuOpen(false); setNotificationMenuOpen(false); setTicketMenuOpen(false); onOpenCommandPalette(); }}
        onOpenNavigation={() => { setUserMenuOpen(false); setNotificationMenuOpen(false); setTicketMenuOpen(false); onOpenNavigation(); }}
      />
    </>
  );
}


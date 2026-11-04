import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLUSTER_PERSON_CHANGED_EVENT, CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, type ClusterPersonSummary, type ClusterAssignmentChange } from "@cluster/shared";
import { api, queryApi, setApiQueryData } from "../../core/api";
import { requestDesktopNotificationPermission, showDesktopNotification } from "../../core/desktop";
import { EntityCustomFields } from "../custom-fields/EntityCustomFields";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ColorField } from "../../components/ColorField";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { LoadingState } from "../../components/LoadingState";
import { RequestEmptyState, RequestErrorState } from "../../components/RequestState";
import "./calendar.css";
import { runtimeStyle } from "../../core/runtime-style";
import { openSharedCreate } from "../create/shared-create-handoff";
import { useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { openClusterWorkNavigation, readClusterWorkProjectContext, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectCollaborationStrip } from "../collaboration";
import { subscribeClusterCohesionEvent } from "../../core/cohesion-events";
import { PeopleMultiPicker, PeoplePicker } from "../people/PeoplePicker";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterModal } from "../../components/ClusterModal";
import { createCalendarMutationGate } from "./calendar-mutation-gate";
import { calendarDateInputValue, parseCalendarLocalDate, shiftCalendarWindow } from "./calendar-date-navigation";
import { calendarEventPage, indexCalendarEventsByLocalDay } from "./calendar-event-visibility";

function openSharedCalendarCreate(date = new Date()) {
  openSharedCreate("calendar", { date: date.toISOString().slice(0, 10) });
}

type Project = { id: string; name: string };
type User = ClusterPersonSummary;
type CalendarEvent = {
  id: string;
  projectId?: string | null;
  project?: Project | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  color?: string | null;
  externalUrl?: string | null;
  eventType?: string | null;
  status?: string | null;
  ownerId?: string | null;
  attendeeIds?: string[];
  delegateIds?: string[];
  occurrenceStartsAt?: string | null;
  occurrenceKey?: string | null;
  occurrenceExceptions?: Array<{ occurrenceStartsAt: string; status: string; movedStartsAt?: string | null; movedEndsAt?: string | null; reason?: string | null }>;
  meetingOccurrenceResponses?: Array<{ occurrenceStartsAt: string; userId: string; rsvp?: string | null; attendance?: string | null; revision: number }>;
  visibility?: "studio" | "project" | "participants" | "private";
  notes?: string | null;
  timezone?: string | null;
  attachmentIds?: string[];
  decisionIds?: string[];
  actionItemIds?: string[];
  reminderMinutes?: number | null;
  reminderAudience?: "owner" | "participants";
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  ticketId?: string | null;
  revision?: number;
  private?: boolean;
  meeting?: {
    id?: string;
    organizerId?: string;
    agenda?: string | null;
    private?: boolean;
    rsvp?: Record<string, string>;
    attendance?: Record<string, string>;
    revision?: number;
    schedulerBlockId?: string | null;
    resources?: Array<{ resourceId: string; quantity: number; resource?: { id: string; name: string; type: string; location?: string | null; quantityTotal?: number; status?: string } | null }>;
  } | null;
};
type ScheduleResource = { id: string; name: string; type: string; location?: string | null; quantityTotal?: number; status?: string };
type TimelineEntry = {
  id: string;
  source: "manual" | "calendar" | "card" | "schedule" | "time" | string;
  type: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  color?: string | null;
  externalUrl?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  ownerId?: string | null;
  project?: { id: string; name: string } | null;
};
type TimelinePayload = { entries: TimelineEntry[]; manualItems: unknown[]; range: { start: string; end: string } };
type CalendarDisplayItem = CalendarEvent & {
  overlay?: {
    source: "timeline" | "card";
    sourceId: string;
    boardId?: string | null;
    readOnly: true;
  };
};
type UpcomingPayload = {
  lookaheadDays: number;
  events: CalendarEvent[];
  dueCards: Array<{ id: string; title: string; dueDate: string; priority: string; list: { id: string; title: string }; board: { id: string; name: string }; project: { id: string; name: string } }>;
};
type Settings = { notifyUpcomingEvents?: boolean; notifyDueDates?: boolean };

function displayUserName(user?: User | null) { return user?.preferredName || user?.displayName || user?.username || "Unknown user"; }
function levelLabel(value: string) { return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function monthStart(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1); }
function addDays(value: Date, amount: number) { const next = new Date(value); next.setDate(next.getDate() + amount); return next; }
function weekStart(value = new Date()) { const next = new Date(value); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - next.getDay()); return next; }
function sameDate(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function compactDateTime(value?: string | null) { return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unscheduled"; }
function toDateInputValue(value?: string | null) { if (!value) return ""; const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function toDateTimeLocalInput(value?: string | null) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function fromDateTimeLocalInput(value: string) { return new Date(value).toISOString(); }

function CalendarTimelineOverlayPanel({ entries }: { entries: TimelineEntry[] }) {
  const overlays = entries.filter((entry) => entry.source === "manual" || entry.source === "card");
  return (
    <section className="panel calendar-sync-panel-v121">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Canonical planning</p>
          <h2>Timeline overlays</h2>
          <p className="muted tight">Milestones, releases, deadlines, and Card due dates appear here as read-only views of their owning resources. Edit them at the source.</p>
        </div>
        <span className="soft-pill">{overlays.length} visible</span>
      </div>
      <p className="muted tight">Calendar does not copy Timeline work into shadow events. Selecting an overlay opens its canonical Timeline item or Card.</p>
    </section>
  );
}

function UpcomingPanel({ compact = false }: { compact?: boolean }) {
  const [upcoming, setUpcoming] = useState<UpcomingPayload | null>(null);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingError, setUpcomingError] = useState<unknown>(null);
  const [enabled, setEnabled] = useState(false);
  const notifiedRef = useRef<Set<string>>(new Set());
  const upcomingRequestSequence = useRef(0);

  async function loadUpcoming(pushNotify = false, force = false) {
    const sequence = ++upcomingRequestSequence.current;
    if (!upcoming) setUpcomingLoading(true);
    setUpcomingError(null);
    try {
      const [payload, settings] = await Promise.all([
        queryApi<UpcomingPayload>("/api/calendar/upcoming", { staleMs: 15_000, maxAgeMs: 5 * 60_000, staleWhileRevalidate: true, force, tags: ["calendar", "upcoming"] }),
        queryApi<Settings>("/api/settings", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["settings", "notifications"] })
      ]);
      if (sequence !== upcomingRequestSequence.current) return;
      setUpcoming(payload);

    if (pushNotify && (Boolean(window.clusterDesktop) || (typeof Notification !== "undefined" && Notification.permission === "granted"))) {
      if (settings.notifyUpcomingEvents ?? true) {
        for (const event of payload.events.slice(0, 5)) {
          const key = `event:${event.occurrenceKey || event.id}`;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            void showDesktopNotification({ title: `Cluster event: ${event.title}`, body: compactDateTime(event.startsAt), route: "calendar" });
          }
        }
      }
      if (settings.notifyDueDates ?? true) {
        for (const card of payload.dueCards.slice(0, 5)) {
          const key = `card:${card.id}`;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            void showDesktopNotification({ title: `Cluster due date: ${card.title}`, body: `${card.project.name} · due ${compactDateTime(card.dueDate)}`, route: "calendar" });
          }
        }
      }
    }
    } catch (error) {
      if (sequence === upcomingRequestSequence.current) setUpcomingError(error);
    } finally {
      if (sequence === upcomingRequestSequence.current) setUpcomingLoading(false);
    }
  }

  useEffect(() => { void loadUpcoming(false); return () => { upcomingRequestSequence.current += 1; }; }, []);
  useVisibleRefresh(() => loadUpcoming(true, true), { intervalMs: 2 * 60_000, requireOnline: true });
  useResourceChangeRefresh(() => loadUpcoming(false, true), { kinds: ["calendar", "meeting", "timeline", "card", "scheduler"], debounceMs: 220 });

  async function enableNotifications() {
    const granted = await requestDesktopNotificationPermission();
    setEnabled(granted);
    if (granted) void loadUpcoming(true);
  }

  if (!upcoming) return <div className="panel notifier-panel">{upcomingError ? <RequestErrorState error={upcomingError} title="Upcoming reminders unavailable" onRetry={() => void loadUpcoming(false)} compact /> : <LoadingState label="Loading upcoming reminders" rows={3} compact />}</div>;

  return (
    <section className={`panel notifier-panel ${compact ? "compact" : ""}`}>
      <div className="management-header-row">
        <div><h2>Upcoming</h2><p className="muted tight">Next {upcoming.lookaheadDays} day{upcoming.lookaheadDays === 1 ? "" : "s"}.</p></div>
        <ClusterButton type="button" className="" onClick={enableNotifications} variant="quiet" size="compact">{enabled || Boolean(window.clusterDesktop) || (typeof Notification !== "undefined" && Notification.permission === "granted") ? "Notifications on" : "Enable notifications"}</ClusterButton>
      </div>
      <div className="notifier-list">
        {upcoming.events.map((event) => <div className="notifier-row" key={`event-${event.occurrenceKey || event.id}`}><span className="notifier-dot" style={runtimeStyle({ background: event.color || "#3b82f6" })} /><div><strong>{event.title}</strong><span>{compactDateTime(event.startsAt)}{event.project?.name ? ` · ${event.project.name}` : ""}</span></div></div>)}
        {upcoming.dueCards.map((card) => <div className="notifier-row" key={`card-${card.id}`}><span className="notifier-dot due-dot" /><div><strong>{card.title}</strong><span>Due {compactDateTime(card.dueDate)} · {card.project.name} / {card.board.name}</span></div></div>)}
        {Boolean(upcomingError) && <RequestErrorState error={upcomingError} title="Reminder refresh failed" onRetry={() => void loadUpcoming(false)} compact />}
        {upcoming.events.length === 0 && upcoming.dueCards.length === 0 && <RequestEmptyState title="Nothing upcoming" description="Events and due dates inside the current reminder window will appear here." compact />}
      </div>
    </section>
  );
}

export default function CalendarPage({ projects }: { projects: Project[] }) {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const preferredMonthDayRef = useRef(anchorDate.getDate());
  const [view, setView] = useState<"month" | "week" | "day" | "agenda">("month");
  const userChangedView = useRef(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsSnapshotPath, setEventsSnapshotPath] = useState("");
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [timelineSnapshotPath, setTimelineSnapshotPath] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [selectedOccurrenceStart, setSelectedOccurrenceStart] = useState<string | null>(null);
  const openedOccurrenceRef = useRef<string | null>(null);
  const [creatingDate, setCreatingDate] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedDayLimit, setSelectedDayLimit] = useState(25);
  const [agendaLimit, setAgendaLimit] = useState(20);
  const [focusDayKey, setFocusDayKey] = useState<string | null>(null);
  const selectedDayInspectorRef = useRef<HTMLElement | null>(null);
  const overflowReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [projectFilter, setProjectFilter] = useState(() => readClusterWorkProjectContext() || "all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showPlanningTools, setShowPlanningTools] = useState(false);
  const [status, setStatus] = useState("");
  const eventsRequestSequence = useRef(0);
  const timelineRequestSequence = useRef(0);
  const usersRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const restoreCalendarDetail = useCallback((id: string | null) => {
    const request = ++detailRequestSequence.current;
    if (!id) { setEditing(null); setSelectedOccurrenceStart(null); openedOccurrenceRef.current = null; return; }
    // History and local list items are not authorization evidence. Always
    // reread the exact event before opening private notes/attendee details.
    const occurrence = openedOccurrenceRef.current;
    setEditing(null);
    void api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}${occurrence ? `?occurrenceStartsAt=${encodeURIComponent(occurrence)}` : ""}`)
      .then((event) => {
        if (request !== detailRequestSequence.current) return;
        const date = new Date(occurrence || event.startsAt);
        setAnchorDate(date);
        setSelectedDate(date);
        setSelectedDayLimit(25);
        overflowReturnFocusRef.current = null;
        preferredMonthDayRef.current = date.getDate();
        setProjectFilter(event.projectId || "studio");
        setSelectedOccurrenceStart(occurrence);
        setEditing(event);
      })
      .catch(() => {
        if (request !== detailRequestSequence.current) return;
        setEditing(null);
        recoverClusterDetailNavigation("calendar-event", {
          title: "Calendar event unavailable",
          message: "That event may have been deleted, moved, archived with its project, or your access may have changed. Calendar stayed open.",
          tone: "warning",
        });
      });
  }, []);
  useEffect(() => () => { detailRequestSequence.current += 1; }, []);
  const calendarDetailHistory = useClusterDetailHistory("calendar-event", editing?.id || null, restoreCalendarDetail);

  const month = monthStart(anchorDate);
  const monthGridStart = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const activeWeekStart = weekStart(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(activeWeekStart, index));

  const range = useMemo(() => {
    if (view === "month") return { start: monthDays[0], end: addDays(monthDays[41], 1) };
    if (view === "week") return { start: activeWeekStart, end: addDays(activeWeekStart, 7) };
    if (view === "day") return { start: new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()), end: addDays(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()), 1) };
    return { start: new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1), end: new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 3, 1) };
  }, [view, anchorDate]);
  const eventsPath = useMemo(() => `/api/calendar/events?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`, [range.start.getTime(), range.end.getTime()]);
  const timelinePath = useMemo(() => `/api/timeline?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`, [range.start.getTime(), range.end.getTime()]);

  function eventInsideRange(event: CalendarEvent) {
    const starts = Date.parse(event.startsAt);
    return Number.isFinite(starts) && starts >= range.start.getTime() && starts < range.end.getTime();
  }
  function commitEvent(saved: CalendarEvent) {
    setEventsSnapshotPath(eventsPath);
    setEvents((current) => {
      const without = current.filter((item) => item.id !== saved.id);
      const next = eventInsideRange(saved) ? [...without, saved].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) : without;
      setApiQueryData(eventsPath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["calendar"] });
      return next;
    });
  }
  function removeEvent(id: string) {
    setEventsSnapshotPath(eventsPath);
    setEvents((current) => {
      const next = current.filter((item) => item.id !== id);
      setApiQueryData(eventsPath, next, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["calendar"] });
      return next;
    });
  }
  async function loadEvents(force = false) {
    const sequence = ++eventsRequestSequence.current;
    try {
      const result = await queryApi<CalendarEvent[]>(eventsPath, { staleMs: 15_000, maxAgeMs: 5 * 60_000, staleWhileRevalidate: true, force, tags: ["calendar"] });
      if (sequence !== eventsRequestSequence.current) return;
      setEvents(result);
      setEventsSnapshotPath(eventsPath);
    } catch (error) {
      if (sequence === eventsRequestSequence.current) setStatus(error instanceof Error ? error.message : "Calendar events unavailable");
    }
  }
  async function loadTimeline(force = false) {
    const sequence = ++timelineRequestSequence.current;
    try {
      const result = await queryApi<TimelinePayload>(timelinePath, { staleMs: 15_000, maxAgeMs: 5 * 60_000, staleWhileRevalidate: true, force, tags: ["timeline", "calendar-overlays"] });
      if (sequence !== timelineRequestSequence.current) return;
      setTimelineEntries(result.entries.filter((entry) => entry.source === "manual" || entry.source === "card"));
      setTimelineSnapshotPath(timelinePath);
    } catch (error) {
      if (sequence === timelineRequestSequence.current) setStatus(error instanceof Error ? error.message : "Timeline overlays unavailable");
    }
  }

  async function loadUsers() {
    const sequence = ++usersRequestSequence.current;
    try {
      const [result, me] = await Promise.all([
        queryApi<User[]>("/api/users?summary=true&limit=1000", { staleMs: 30_000 }),
        queryApi<{ user: { id?: string } | null }>("/api/me", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["me"] }),
      ]);
      if (sequence !== usersRequestSequence.current) return;
      setUsers(result.filter((user) => !user.archived));
      setCurrentUserId(String(me.user?.id || ""));
    } catch (error) {
      if (sequence === usersRequestSequence.current) setStatus(error instanceof Error ? error.message : "Calendar participants unavailable");
    }
  }

  // Saving a personal default in Account Settings should refresh a mounted
  // Calendar without navigation or overriding a deliberate manual view change.
  const [preferenceReload, setPreferenceReload] = useState(0);
  useEffect(() => {
    const refresh = () => setPreferenceReload((value) => value + 1);
    window.addEventListener("cluster-calendar-view-preference-changed", refresh);
    return () => window.removeEventListener("cluster-calendar-view-preference-changed", refresh);
  }, []);
  useEffect(() => {
    let cancelled = false;
    userChangedView.current = false;
    const projectId = projectFilter !== "all" && projectFilter !== "studio" ? projectFilter : null;
    const url = projectId ? `/api/calendar/view-preference?projectId=${encodeURIComponent(projectId)}` : "/api/calendar/view-preference";
    void api<{ ok: boolean; value: "month" | "week" | "day" | "agenda" }>(url)
      .then((result) => { if (!cancelled && !userChangedView.current) setView(result.value); })
      .catch(() => { /* Leave the view usable when preferences are temporarily unavailable. */ });
    return () => { cancelled = true; };
  }, [projectFilter, preferenceReload]);

  useEffect(() => { void loadUsers(); return () => { usersRequestSequence.current += 1; }; }, []);
  useEffect(() => { void loadEvents(); return () => { eventsRequestSequence.current += 1; }; }, [eventsPath]);
  useEffect(() => { void loadTimeline(); return () => { timelineRequestSequence.current += 1; }; }, [timelinePath]);
  useEffect(() => subscribeClusterCohesionEvent<ClusterAssignmentChange>(CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, (change) => { if (change.resource.kind === "calendar") void loadEvents(true); }), [range.start.getTime(), range.end.getTime()]);
  useEffect(() => subscribeClusterCohesionEvent<Partial<ClusterPersonSummary>>(CLUSTER_PERSON_CHANGED_EVENT, () => { void loadUsers(); }), []);
  useResourceChangeRefresh(async () => {
    await Promise.all([loadEvents(true), loadTimeline(true)]);
  }, { kinds: ["calendar", "meeting", "timeline", "card", "scheduler"], debounceMs: 220 });

  const visibleTimelineEntries = timelineSnapshotPath === timelinePath ? timelineEntries : [];
  const visibleEvents = eventsSnapshotPath === eventsPath ? events : [];
  const overlayItems = useMemo<CalendarDisplayItem[]>(() => visibleTimelineEntries.map((entry) => ({
    id: `overlay:${entry.source}:${entry.id}`,
    projectId: entry.projectId || entry.project?.id || null,
    project: entry.project || null,
    title: entry.title,
    description: entry.description || null,
    location: null,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt || null,
    allDay: false,
    color: entry.color || (entry.source === "card" ? "#60a5fa" : "#3b82f6"),
    externalUrl: entry.externalUrl || null,
    eventType: entry.source === "card" ? "deadline" : entry.type,
    status: "source",
    ownerId: entry.ownerId || null,
    attendeeIds: [],
    overlay: { source: entry.source === "card" ? "card" : "timeline", sourceId: entry.id, boardId: entry.boardId || null, readOnly: true },
  })), [visibleTimelineEntries]);

  const filteredEvents = useMemo<CalendarDisplayItem[]>(() => {
    const query = search.trim().toLowerCase();
    const displayEvents: CalendarDisplayItem[] = [...visibleEvents, ...overlayItems];
    return displayEvents
      .filter((event) => projectFilter === "all" || (projectFilter === "studio" ? !event.projectId : event.projectId === projectFilter))
      .filter((event) => typeFilter === "all" || (event.eventType || "meeting") === typeFilter)
      .filter((event) => event.overlay ? ownerFilter === "all" : (ownerFilter === "all" || (ownerFilter === "unassigned" ? !event.ownerId : event.ownerId === ownerFilter)))
      .filter((event) => !query || [event.title, event.description, event.location, event.project?.name, event.eventType, event.status, event.overlay?.source].filter(Boolean).join(" ").toLowerCase().includes(query))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [visibleEvents, overlayItems, projectFilter, typeFilter, ownerFilter, search]);

  function openDisplayItem(item: CalendarDisplayItem) {
    if (!item.overlay) {
      openedOccurrenceRef.current = item.occurrenceStartsAt || null;
      setSelectedOccurrenceStart(openedOccurrenceRef.current);
      calendarDetailHistory.openDetail(item.id);
      return;
    }
    const projectId = item.projectId || null;
    const resource = item.overlay.source === "card"
      ? { kind: "card" as const, id: item.overlay.sourceId, projectId }
      : { kind: "timeline" as const, id: item.overlay.sourceId, projectId };
    if (!openClusterWorkNavigation(clusterResourceNavigation(resource))) {
      setStatus("The source resource could not be opened.");
    }
  }

  const eventsByDay = useMemo(() => indexCalendarEventsByLocalDay(filteredEvents), [filteredEvents]);
  // Local-day controls must not round-trip midnight through UTC.
  const selectedKey = calendarDateInputValue(selectedDate);
  const selectedEvents = eventsByDay.get(selectedKey) || [];
  const visibleSelectedEvents = calendarEventPage(selectedEvents, selectedDayLimit);
  const agendaEvents = calendarEventPage(filteredEvents, agendaLimit);
  const agendaScopeKey = [range.start.getTime(), range.end.getTime(), projectFilter, typeFilter, ownerFilter, search].join("|");
  useEffect(() => { setAgendaLimit(20); }, [agendaScopeKey]);
  useEffect(() => {
    if (!focusDayKey || focusDayKey !== selectedKey) return;
    selectedDayInspectorRef.current?.focus({ preventScroll: true });
    setFocusDayKey(null);
  }, [focusDayKey, selectedKey]);
  const projectName = (id?: string | null) => projects.find((project) => project.id === id)?.name || "Studio";
  const userName = (id?: string | null) => users.find((user) => user.id === id) ? displayUserName(users.find((user) => user.id === id) as User) : "Unassigned";

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const timed = filteredEvents.filter((event) => !event.allDay && !event.overlay);
    for (let i = 0; i < timed.length; i += 1) {
      const aStart = new Date(timed[i].startsAt).getTime();
      const aEnd = timed[i].endsAt ? new Date(timed[i].endsAt as string).getTime() : aStart + 60 * 60 * 1000;
      for (let j = i + 1; j < timed.length; j += 1) {
        if (timed[i].ownerId && timed[j].ownerId && timed[i].ownerId !== timed[j].ownerId) continue;
        const bStart = new Date(timed[j].startsAt).getTime();
        const bEnd = timed[j].endsAt ? new Date(timed[j].endsAt as string).getTime() : bStart + 60 * 60 * 1000;
        if (aStart < bEnd && bStart < aEnd) { ids.add(timed[i].occurrenceKey || timed[i].id); ids.add(timed[j].occurrenceKey || timed[j].id); }
      }
    }
    return ids;
  }, [filteredEvents]);

  function selectCalendarDate(date: Date) {
    setSelectedDate(date);
    setSelectedDayLimit(25);
    preferredMonthDayRef.current = date.getDate();
    overflowReturnFocusRef.current = null;
  }

  function openCalendarDayOverflow(date: Date, trigger: HTMLButtonElement) {
    selectCalendarDate(date);
    overflowReturnFocusRef.current = trigger;
    setFocusDayKey(calendarDateInputValue(date));
  }

  function returnToCalendarDay() {
    const trigger = overflowReturnFocusRef.current;
    if (!trigger) return;
    overflowReturnFocusRef.current = null;
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function jumpToCalendarDate(value: string) {
    const date = parseCalendarLocalDate(value);
    if (!date) return; // Native date field may temporarily be empty or incomplete.
    preferredMonthDayRef.current = date.getDate();
    setAnchorDate(date);
    setSelectedDate(date);
    setSelectedDayLimit(25);
    overflowReturnFocusRef.current = null;
  }

  function changeCalendarView(next: "month" | "week" | "day" | "agenda") {
    userChangedView.current = true;
    overflowReturnFocusRef.current = null;
    setSelectedDayLimit(25);
    if (next === "day" || next === "week") {
      // Selecting a date in Month then entering Day must show that date's
      // fetched range, not the original month anchor's unrelated day.
      setAnchorDate(selectedDate);
      preferredMonthDayRef.current = selectedDate.getDate();
    }
    setView(next);
  }

  function moveWindow(amount: number) {
    const next = shiftCalendarWindow(anchorDate, selectedDate, view, amount, preferredMonthDayRef.current);
    setAnchorDate(next.anchor);
    setSelectedDate(next.selected);
    setSelectedDayLimit(25);
    overflowReturnFocusRef.current = null;
  }

  const rangeLabel = view === "month"
    ? anchorDate.toLocaleString([], { month: "long", year: "numeric" })
    : view === "week"
      ? `${weekDays[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
      : view === "day"
        ? anchorDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
        : `${range.start.toLocaleDateString([], { month: "short", year: "numeric" })} – ${addDays(range.end, -1).toLocaleDateString([], { month: "short", year: "numeric" })}`;

  const eventTypes = ["meeting", "review", "deadline", "release", "milestone", "focus", "availability", "client", "production", "publishing", "maintenance", "other"];

  return (
    <section className="page cluster-page-shell cluster-tool-page-v228 calendar-page calendar-page-v189 calendar-page-v190">
      <ToolPageHeader
        className="cluster-page-header"
        title="Calendar"
        description="Coordinate meetings, reviews, deadlines, releases, milestones, and production commitments across the studio."
        metrics={[
          { label: "Visible", value: filteredEvents.length },
          { label: "Overlays", value: filteredEvents.filter((event) => Boolean(event.overlay)).length },
          { label: "Conflicts", value: conflictIds.size, tone: conflictIds.size ? "warning" : "neutral" },
          { label: "Tentative", value: filteredEvents.filter((event) => event.status === "tentative").length },
          { label: "Recurring", value: filteredEvents.filter((event) => event.recurrenceRule).length }
        ]}
        actions={<><ClusterButton type="button" className="" onClick={() => setShowPlanningTools((value) => !value)} variant="secondary">{showPlanningTools ? "Hide planning" : "Planning tools"}</ClusterButton><ClusterButton type="button" className="" onClick={() => openSharedCalendarCreate(selectedDate || new Date())} variant="primary">New event</ClusterButton></>}
      />
      {projectFilter !== "all" && projectFilter !== "studio" ? <ProjectCollaborationStrip tool="calendar" projectId={projectFilter} activity={`Calendar · ${view}`} /> : null}

      {status && <div className="status-box system-status-box-v053">{status}</div>}

      <div className="calendar-toolbar-v189 panel calendar-toolbar-v190">
        <ClusterSegmentedControl value={view} onChange={changeCalendarView} label="Calendar view" options={(["month", "week", "day", "agenda"] as const).map((item) => ({ value: item, label: levelLabel(item) }))} />
        <div className="calendar-range-control-v189"><ClusterButton type="button" className="" onClick={() => moveWindow(-1)} variant="quiet" size="compact">Previous</ClusterButton><ClusterButton type="button" className="" onClick={() => { const now = new Date(); preferredMonthDayRef.current = now.getDate(); setAnchorDate(now); setSelectedDate(now); setSelectedDayLimit(25); overflowReturnFocusRef.current = null; }} variant="quiet" size="compact">Today</ClusterButton><ClusterButton type="button" className="" onClick={() => moveWindow(1)} variant="quiet" size="compact">Next</ClusterButton><strong>{rangeLabel}</strong>
          <label className="calendar-date-jump-v11">
            <span>Go to date</span>
            <ClusterInput type="date" aria-label="Jump to calendar date"
              value={calendarDateInputValue(anchorDate)}
              onChange={(event) => jumpToCalendarDate(event.target.value)} />
          </label>
        </div>
        <div className="calendar-filter-row-v189 calendar-filter-row-v190">
          <ClusterTextInput type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search schedule" />
          <ClusterSelect value={projectFilter} onChange={setProjectFilter} ariaLabel="Filter calendar by project" options={[{ value: "all", label: "All projects" }, { value: "studio", label: "Studio only" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />
          <ClusterSelect value={typeFilter} onChange={setTypeFilter} ariaLabel="Filter calendar by type" options={[{ value: "all", label: "All types" }, ...eventTypes.map((type) => ({ value: type, label: levelLabel(type) }))]} />
          <ClusterSelect value={ownerFilter} onChange={setOwnerFilter} ariaLabel="Filter calendar by owner" options={[{ value: "all", label: "All owners" }, { value: "unassigned", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: displayUserName(user) }))]} />
        </div>
      </div>

      {showPlanningTools && <div className="calendar-planning-tools-v189"><UpcomingPanel compact /><CalendarTimelineOverlayPanel entries={visibleTimelineEntries} /></div>}

      <div className="calendar-workspace-v189">
        <section className="panel calendar-main-v189">
          {view === "month" && <div className="calendar-month-scroll-v495"><div className="calendar-weekdays calendar-weekdays-v189">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid calendar-grid-v189">{monthDays.map((day) => { const key = calendarDateInputValue(day); const dayEvents = eventsByDay.get(key) || []; const dayLabel = day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }); return <section className={`calendar-day calendar-day-v189 ${day.getMonth() !== month.getMonth() ? "muted-day" : ""} ${sameDate(day, new Date()) ? "today" : ""} ${sameDate(day, selectedDate) ? "selected" : ""}`} key={key}><div className="calendar-day-head-v189"><ClusterButton unstyled type="button" className="calendar-day-select-v393" onClick={() => selectCalendarDate(day)} aria-label={`Select ${dayLabel}`}><strong>{day.getDate()}</strong></ClusterButton>{dayEvents.length > 0 && <span>{dayEvents.length}</span>}<ClusterButton unstyled type="button" className="calendar-day-add-v393" onClick={() => openSharedCalendarCreate(day)} aria-label={`Add event on ${dayLabel}`}>+</ClusterButton></div><div className="calendar-event-stack">{dayEvents.slice(0, 3).map((event) => <ClusterButton unstyled type="button" className={`calendar-chip ${event.overlay ? "calendar-overlay-readonly-v505" : ""} ${conflictIds.has(event.occurrenceKey || event.id) ? "conflict" : ""}`} key={event.occurrenceKey || event.id} onClick={() => openDisplayItem(event)} style={runtimeStyle({ borderColor: event.color || undefined })}><i style={runtimeStyle({ background: event.color || undefined })} /><span>{event.title}</span></ClusterButton>)}{dayEvents.length > 3 ? <ClusterButton type="button" variant="quiet" size="compact" className="calendar-more calendar-more-action-v11"
  onClick={(event) => openCalendarDayOverflow(day, event.currentTarget)}
  aria-label={`Show all ${dayEvents.length} events on ${dayLabel}`} aria-controls="calendar-selected-day-inspector-v11">
  +{dayEvents.length - 3} more
</ClusterButton> : null}</div></section>; })}</div></div>}

          {view === "week" && <div className="calendar-week-view-v189">{weekDays.map((day) => { const key = calendarDateInputValue(day); const dayEvents = eventsByDay.get(key) || []; const dayLabel = day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }); return <section key={key} className={`${sameDate(day, new Date()) ? "today" : ""} ${sameDate(day, selectedDate) ? "selected" : ""}`}><header><ClusterButton unstyled type="button" className="calendar-week-day-trigger-v393" onClick={() => selectCalendarDate(day)} aria-label={`Select ${dayLabel}`}><span>{day.toLocaleDateString([], { weekday: "short" })}</span><strong>{day.getDate()}</strong></ClusterButton><ClusterButton unstyled type="button" className="calendar-week-add-v393" onClick={() => openSharedCalendarCreate(day)} aria-label={`Add event on ${dayLabel}`}>+</ClusterButton></header><div>{calendarEventPage(dayEvents, 25).map((event) => <ClusterButton unstyled type="button" className={conflictIds.has(event.occurrenceKey || event.id) ? "conflict" : ""} key={event.occurrenceKey || event.id} onClick={() => openDisplayItem(event)}><i style={runtimeStyle({ background: event.color || undefined })} /><strong>{event.title}</strong><span>{event.allDay ? "All day" : new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><em>{event.project?.name || projectName(event.projectId)} · {userName(event.ownerId)}</em></ClusterButton>)}
              {dayEvents.length > 25 ? <ClusterButton variant="quiet" size="compact" className="calendar-week-more-v11"
                onClick={(event) => openCalendarDayOverflow(day, event.currentTarget)}
                aria-label={`Show all ${dayEvents.length} events on ${dayLabel}`}
                aria-controls="calendar-selected-day-inspector-v11">
                Show all {dayEvents.length} events
              </ClusterButton> : null}
            </div></section>; })}</div>}

          {view === "day" && <div className="calendar-day-view-v190">{selectedEvents.length ? visibleSelectedEvents.map((event) => <ClusterButton unstyled type="button" key={event.occurrenceKey || event.id} className={conflictIds.has(event.occurrenceKey || event.id) ? "conflict" : ""} onClick={() => openDisplayItem(event)}><time>{event.allDay ? "All day" : new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><i style={runtimeStyle({ background: event.color || undefined })} /><div><strong>{event.title}</strong><span>{levelLabel(event.eventType || "meeting")} · {event.overlay ? "Read-only source" : levelLabel(event.status || "scheduled")}</span><em>{event.project?.name || projectName(event.projectId)} · {userName(event.ownerId)}</em></div></ClusterButton>) : <RequestEmptyState compact kind="empty" title="Nothing scheduled" description="This day has no scheduled events." actions={<ClusterButton onClick={() => openSharedCalendarCreate(selectedDate)} variant="secondary">Add event</ClusterButton>} />}
            {selectedEvents.length > selectedDayLimit ? <ClusterButton type="button" variant="secondary" size="compact"
              className="calendar-event-next-v11" onClick={() => setSelectedDayLimit((limit) => limit + 25)}>
              Show next {Math.min(25, selectedEvents.length - selectedDayLimit)} events · {selectedEvents.length - selectedDayLimit} remaining
            </ClusterButton> : null}</div>}

          {view === "agenda" && <div className="calendar-agenda-v189">{filteredEvents.length > agendaEvents.length && <p role="status" className="calendar-agenda-limit-v11">Showing {agendaEvents.length} of {filteredEvents.length} authorized events in this date range. Load more below or narrow the filters.</p>}{agendaEvents.length ? agendaEvents.map((event) => <ClusterButton unstyled type="button" className={conflictIds.has(event.occurrenceKey || event.id) ? "conflict" : ""} key={event.occurrenceKey || event.id} onClick={() => openDisplayItem(event)}><time><strong>{new Date(event.startsAt).toLocaleDateString([], { month: "short", day: "numeric" })}</strong><span>{event.allDay ? "All day" : new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></time><i style={runtimeStyle({ background: event.color || undefined })} /><div><strong>{event.title}</strong><span>{levelLabel(event.eventType || "meeting")} · {event.overlay ? "Read-only source overlay" : event.description || "No description"}</span><em>{event.project?.name || projectName(event.projectId)} · {userName(event.ownerId)}{event.location ? ` · ${event.location}` : ""}</em></div></ClusterButton>) : <RequestEmptyState compact kind="filtered" title="No events match this agenda range" description="Change the date range or filters to widen the agenda." />}
            {filteredEvents.length > agendaLimit ? <ClusterButton type="button" variant="secondary" size="compact"
              className="calendar-event-next-v11" onClick={() => setAgendaLimit((limit) => limit + 20)}>
              Show next {Math.min(20, filteredEvents.length - agendaLimit)} events · {filteredEvents.length - agendaLimit} remaining
            </ClusterButton> : null}</div>}
        </section>

        <aside ref={selectedDayInspectorRef} id="calendar-selected-day-inspector-v11"
          className="panel calendar-inspector-v189" role="region"
          aria-labelledby="calendar-selected-day-heading-v11"
          aria-describedby="calendar-selected-day-description-v11"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented || !overflowReturnFocusRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            returnToCalendarDay();
          }}>
          <p id="calendar-selected-day-description-v11" className="sr-only-v204">
            Events and read-only overlays for the selected date. After Show more, press Escape to return to the calendar.
          </p>
          <div className="calendar-inspector-head-v189"><div><span>{selectedDate.toLocaleDateString([], { weekday: "long" })}</span><strong id="calendar-selected-day-heading-v11">{selectedDate.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</strong></div><ClusterButton type="button" className="" onClick={() => openSharedCalendarCreate(selectedDate)} variant="quiet" size="compact">Add</ClusterButton></div><div className="calendar-selected-list-v189">{selectedEvents.length ? visibleSelectedEvents.map((event) => <ClusterButton unstyled type="button" key={event.occurrenceKey || event.id} className={conflictIds.has(event.occurrenceKey || event.id) ? "conflict" : ""} onClick={() => openDisplayItem(event)}><i style={runtimeStyle({ background: event.color || undefined })} /><div><strong>{event.title}</strong><span>{event.allDay ? "All day" : new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><em>{levelLabel(event.eventType || "meeting")} · {event.overlay ? "Read-only source" : userName(event.ownerId)}</em></div></ClusterButton>) : <RequestEmptyState compact kind="empty" title="Nothing scheduled" description="This day has no scheduled events." />}
            {selectedEvents.length > selectedDayLimit ? <ClusterButton type="button" variant="secondary" size="compact"
              className="calendar-event-next-v11" onClick={() => setSelectedDayLimit((limit) => limit + 25)}>
              Show next {Math.min(25, selectedEvents.length - selectedDayLimit)} events · {selectedEvents.length - selectedDayLimit} remaining
            </ClusterButton> : null}
          </div><div className="calendar-inspector-summary-v189"><span><strong>{selectedEvents.length}</strong> Selected</span><span><strong>{selectedEvents.filter((event) => event.status === "tentative").length}</strong> Tentative</span><span><strong>{selectedEvents.filter((event) => conflictIds.has(event.occurrenceKey || event.id)).length}</strong> Conflicts</span></div></aside>
      </div>

      {(editing || creatingDate) && <EventEditor key={`${currentUserId}:${editing?.id || "new"}:${selectedOccurrenceStart || "series"}`} event={editing} date={creatingDate} occurrenceStartsAt={selectedOccurrenceStart} projects={projects} users={users} currentUserId={currentUserId} onClose={() => { if (editing) calendarDetailHistory.closeDetail(); else setCreatingDate(null); }} onSaved={(change) => { if (change.saved) { commitEvent(change.saved); void loadEvents(true); } if (change.deletedId) removeEvent(change.deletedId); setSelectedOccurrenceStart(null); if (editing) calendarDetailHistory.closeDetail(); setCreatingDate(null); }} />}
    </section>
  );
}

function EventEditor({ event, date, occurrenceStartsAt, projects, users, currentUserId, onClose, onSaved }: { event: CalendarEvent | null; date: Date | null; occurrenceStartsAt?: string | null; projects: Project[]; users: User[]; currentUserId: string; onClose: () => void; onSaved: (change: { saved?: CalendarEvent; deletedId?: string }) => void }) {
  const [title, setTitle] = useState(event?.title || "");
  const [description, setDescription] = useState(event?.description || "");
  const [location, setLocation] = useState(event?.location || "");
  const [projectId, setProjectId] = useState(event?.projectId || "");
  const [startsAt, setStartsAt] = useState(event ? toDateTimeLocalInput(event.startsAt) : toDateTimeLocalInput((date || new Date()).toISOString()));
  const [endsAt, setEndsAt] = useState(event?.endsAt ? toDateTimeLocalInput(event.endsAt) : "");
  const [allDay, setAllDay] = useState(Boolean(event?.allDay));
  const [color, setColor] = useState(event?.color || "#3b82f6");
  const [externalUrl, setExternalUrl] = useState(event?.externalUrl || "");
  const [eventType, setEventType] = useState(event?.eventType || "meeting");
  const [eventStatus, setEventStatus] = useState(event?.status || "scheduled");
  const [ownerId, setOwnerId] = useState(event?.ownerId || "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendeeIds || []);
  const [delegateIds, setDelegateIds] = useState<string[]>(event?.delegateIds || []);
  const [exceptionReason, setExceptionReason] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationGateRef = useRef(createCalendarMutationGate());
  useEffect(() => () => mutationGateRef.current.invalidate(), []);
  async function runMutation<T>(request: () => Promise<T>, onCommitted: (result: T) => void, fallback: string) {
    await mutationGateRef.current.run(request, onCommitted, (error) => {
      setError(error instanceof Error ? error.message : fallback);
    }, setMutationBusy);
  }
  const closeEditor = () => { if (!mutationGateRef.current.busy()) onClose(); };
  const currentException = event?.occurrenceExceptions?.find((row) => row.occurrenceStartsAt === occurrenceStartsAt);
  const [movedStartsAt, setMovedStartsAt] = useState(() =>
    toDateTimeLocalInput(currentException?.movedStartsAt || occurrenceStartsAt || null));
  const [movedEndsAt, setMovedEndsAt] = useState(() =>
    toDateTimeLocalInput(currentException?.movedEndsAt || (occurrenceStartsAt && event?.endsAt
      ? new Date(new Date(occurrenceStartsAt).getTime() + new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()).toISOString() : null)));

  const [reminderMinutes, setReminderMinutes] = useState(event?.reminderMinutes?.toString() || "");
  const [reminderAudience, setReminderAudience] = useState<"owner" | "participants">(event?.reminderAudience || "owner");
  const [recurrenceRule, setRecurrenceRule] = useState(event?.recurrenceRule || "");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(event?.recurrenceEndDate || "");
  const [ticketId, setTicketId] = useState(event?.ticketId || "");
  const [showAdvanced, setShowAdvanced] = useState(Boolean(event?.recurrenceRule || event?.externalUrl || event?.ticketId || event?.attendeeIds?.length || event?.meeting));
  const [agenda, setAgenda] = useState(event?.meeting?.agenda || "");
  const [notes, setNotes] = useState(event?.notes || "");
  const [timezone, setTimezone] = useState(event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [visibility, setVisibility] = useState<"studio" | "project" | "participants" | "private">(event?.visibility || (event?.projectId ? "project" : "studio"));
  const [attachmentIdsText, setAttachmentIdsText] = useState((event?.attachmentIds || []).join(", "));
  const [decisionIdsText, setDecisionIdsText] = useState((event?.decisionIds || []).join(", "));
  const [actionItemIdsText, setActionItemIdsText] = useState((event?.actionItemIds || []).join(", "));
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [resources, setResources] = useState<ScheduleResource[]>([]);
  const [meetingResourceIds, setMeetingResourceIds] = useState<string[]>((event?.meeting?.resources || []).map((item) => item.resourceId));
  const responsesForOccurrence = (event?.meetingOccurrenceResponses || []).filter((item) =>
    occurrenceStartsAt && item.occurrenceStartsAt === occurrenceStartsAt);
  const responseFor = (userId: string) => responsesForOccurrence.find((item) => item.userId === userId);
  const [attendance, setAttendance] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(Object.entries(event?.meeting?.attendance || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ...Object.fromEntries(responsesForOccurrence.map((item) => [item.userId, item.attendance] as const).filter((entry): entry is readonly [string, string] => typeof entry[1] === "string")) }));
  const [error, setError] = useState("");
  const eventTypes = ["meeting", "review", "deadline", "release", "milestone", "focus", "availability", "client", "production", "publishing", "maintenance", "other"];
  const isMeeting = eventType === "meeting";
  const isPrivateRedaction = false;
  const isOrganizer = Boolean(event?.meeting?.organizerId && event.meeting.organizerId === currentUserId);
  const effectiveRsvp = { ...event?.meeting?.rsvp,
    ...Object.fromEntries(responsesForOccurrence.filter((item) => item.rsvp).map((item) => [item.userId, item.rsvp])) };
  const myRsvp = currentUserId ? effectiveRsvp[currentUserId] || "pending" : "pending";
  const perOccurrenceResponses = Boolean(event?.recurrenceRule && occurrenceStartsAt);

  useEffect(() => {
    if (!isMeeting) return;
    const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    void queryApi<ScheduleResource[]>(`/api/schedule/resources${suffix}`, { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["scheduler", "resources"] })
      .then(setResources)
      .catch(() => setResources([]));
  }, [isMeeting, projectId]);

  function parseIds(value: string) {
    return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
  }

  async function saveEvent() {
    setError("");
    if (mutationGateRef.current.busy()) return;
    try {
      const payload = {
        projectId: projectId || null,
        title,
        description,
        location,
        startsAt: fromDateTimeLocalInput(startsAt),
        endsAt: endsAt ? fromDateTimeLocalInput(endsAt) : null,
        allDay,
        color,
        externalUrl,
        eventType,
        status: eventStatus,
        ownerId: ownerId || null,
        attendeeIds,
        delegateIds,
        reminderMinutes: reminderMinutes ? Number(reminderMinutes) : null,
        reminderAudience,
        recurrenceRule: recurrenceRule || null,
        recurrenceEndDate: recurrenceRule && isMeeting ? recurrenceEndDate || null : null,
        ticketId: ticketId || null,
        visibility,
        notes: notes || null,
        timezone: timezone || "UTC",
        attachmentIds: parseIds(attachmentIdsText),
        decisionIds: parseIds(decisionIdsText),
        actionItemIds: parseIds(actionItemIdsText),
        ...(event ? { expectedRevision: event.revision || 1 } : {}),
        meeting: isMeeting ? {
          agenda: agenda || null,
          resources: meetingResourceIds.map((resourceId) => ({ resourceId, quantity: 1 })),
          allowConflicts,
        } : null,
      };
      await runMutation(
        () => api<CalendarEvent>(event ? `/api/calendar/events/${encodeURIComponent(event.id)}` : "/api/calendar/events", { method: event ? "PUT" : "POST", body: JSON.stringify(payload) }),
        (saved) => onSaved({ saved }), "Could not save event",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid event date or time");
    }
  }

  async function changeOccurrence(instant: string, action: "cancel" | "restore" | "reschedule") {
    if (!event || mutationGateRef.current.busy()) return;
    setError("");
    await runMutation(() => api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/occurrence`, {
        method: "PATCH",
        body: JSON.stringify({ occurrenceStartsAt: instant, action, expectedRevision: event.revision || 1,
          ...(action === "reschedule" ? { startsAt: fromDateTimeLocalInput(movedStartsAt), endsAt: fromDateTimeLocalInput(movedEndsAt) } : {}),
          reason: exceptionReason.trim() || undefined }),
      }), (saved) => onSaved({ saved }), "Could not update this occurrence");
  }

  async function deleteEvent() {
    if (!event) return;
    setError("");
    await runMutation(
      () => api(`/api/calendar/events/${encodeURIComponent(event.id)}?expectedRevision=${encodeURIComponent(String(event.revision || 1))}`, { method: "DELETE" }),
      () => onSaved({ deletedId: event.id }), "Could not delete event",
    );
  }

  async function updateRsvp(status: "accepted" | "tentative" | "declined") {
    if (!event || !currentUserId) return;
    setError("");
    await runMutation(
      () => perOccurrenceResponses
        ? api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/occurrence-response`, { method: "PATCH",
            body: JSON.stringify({ occurrenceStartsAt, expectedRevision: event.revision || 1, responses: [{
              userId: currentUserId, rsvp: status, expectedResponseRevision: responseFor(currentUserId)?.revision || 0,
            }] }),
          })
        : api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/rsvp`, { method: "PATCH", body: JSON.stringify({ status, expectedRevision: event.revision || 1 }) }),
      (saved) => onSaved({ saved }), "Could not update RSVP",
    );
  }

  async function saveAttendance() {
    if (!event) return;
    setError("");
    const participantIds = Array.from(new Set([event.meeting?.organizerId || event.ownerId || "", ...(event.attendeeIds || [])].filter(Boolean)));
    await runMutation(
      () => perOccurrenceResponses
        ? api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/occurrence-response`, {
            method: "PATCH",
            body: JSON.stringify({ occurrenceStartsAt, expectedRevision: event.revision || 1,
              responses: participantIds.map((userId) => ({ userId, attendance: attendance[userId] || "unknown",
                expectedResponseRevision: responseFor(userId)?.revision || 0 })) }),
          })
        : api<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/attendance`, {
            method: "PATCH",
            body: JSON.stringify({ expectedRevision: event.revision || 1,
              attendance: participantIds.map((userId) => ({ userId, status: attendance[userId] || "unknown" })) }),
          }),
      (saved) => onSaved({ saved }), "Could not save attendance",
    );
  }

  if (isPrivateRedaction) {
    return <ClusterModal open onClose={onClose} className="modal-card event-modal panel event-modal-v190" labelledBy="calendar-private-event-title-v36">
      <div className="modal-header"><div><p className="eyebrow">Private meeting</p><h2 id="calendar-private-event-title-v36">Busy</h2></div><ClusterButton type="button" onClick={onClose} variant="quiet" size="compact">Close</ClusterButton></div>
      <RequestEmptyState compact kind="empty" title="Meeting details are private" description="Only the organizer and invited attendees can view this meeting's title, agenda, notes, links, or participant list." />
    </ClusterModal>;
  }

  return <ClusterModal open onClose={closeEditor} className="modal-card event-modal panel event-modal-v190" labelledBy="calendar-event-editor-title-v36">
      <div className="modal-header">
        <div><p className="eyebrow">{isMeeting ? "Meeting" : "Schedule"}</p><h2 id="calendar-event-editor-title-v36">{event ? `Edit ${isMeeting ? "meeting" : "event"}` : `New ${isMeeting ? "meeting" : "event"}`}</h2></div>
        <ClusterButton type="button" onClick={onClose} variant="quiet" size="compact">Close</ClusterButton>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="event-editor-grid-v190">
        <div className="field span-2"><label>Title</label><ClusterTextInput value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></div>
        <div className="field"><label>Type</label><ClusterSelect value={eventType} onChange={setEventType} ariaLabel="Event type" options={eventTypes.map((type) => ({ value: type, label: levelLabel(type) }))} /></div>
        <div className="field"><label>Status</label><ClusterSelect value={eventStatus} onChange={setEventStatus} ariaLabel="Event status" options={[{ value: "scheduled", label: "Scheduled" }, { value: "tentative", label: "Tentative" }, { value: "confirmed", label: "Confirmed" }, { value: "cancelled", label: "Cancelled" }]} /></div>
        <div className="field"><label>Starts</label><ClusterTextInput type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="field"><label>Ends</label><ClusterTextInput type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
        <div className="field"><label>Project</label><ClusterSelect value={projectId} onChange={setProjectId} ariaLabel="Event project" options={[{ value: "", label: "Studio / no project" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} /></div>
        <PeoplePicker label={isMeeting ? "Organizer" : "Owner"} value={ownerId} onChange={setOwnerId} people={users} ariaLabel="Event owner" />
        <div className="field span-2"><label>Description</label><ClusterTextArea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label>Location</label><ClusterTextInput value={location} onChange={(e) => setLocation(e.target.value)} /></div>
                <div className="field"><label>Remind</label><ClusterSelect value={reminderAudience} onChange={(next) => setReminderAudience(next as "owner" | "participants")} ariaLabel="Reminder recipients" options={[{ value: "owner", label: "Owner only" }, { value: "participants", label: "Owner and eligible attendees" }]} /><small>Only attendees with current Calendar access are notified; declined invitations and private-event attendees are excluded.</small></div>
<div className="field"><label>Reminder time</label><ClusterSelect value={reminderMinutes} onChange={setReminderMinutes} ariaLabel="Event reminder" options={[{ value: "", label: "No reminder" }, { value: "5", label: "5 minutes" }, { value: "15", label: "15 minutes" }, { value: "30", label: "30 minutes" }, { value: "60", label: "1 hour" }, { value: "1440", label: "1 day" }, { value: "10080", label: "1 week" }]} /></div>
        <label className="tool-check"><ClusterInput type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
        <ColorField value={color} onChange={setColor} label="Event color" />
      </div>

      <div className="event-advanced-v190">
        <div className="two-col">
          <div className="field"><label>Timezone</label><ClusterTextInput value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" /></div>
          <div className="field"><label>Visibility</label><ClusterSelect value={visibility} onChange={(value) => setVisibility(value as "studio" | "project" | "participants" | "private")} ariaLabel="Calendar visibility" options={[{ value: "studio", label: "Studio" }, { value: "project", label: "Project members" }, { value: "participants", label: "Participants only" }, { value: "private", label: "Private" }]} /></div>
        </div>
        <div className="field"><label>Notes</label><ClusterTextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes, context, outcomes, or handoff information" /></div>
        <PeopleMultiPicker label={isMeeting ? "Attendees" : "Participants"} values={attendeeIds} onChange={setAttendeeIds} people={users} />
        {(!event || currentUserId === event.ownerId) ? <div className="field span-2"><PeopleMultiPicker label="Delegated editors" values={delegateIds} onChange={setDelegateIds} people={users} /><small>Editors must already have Calendar tool access; Project permissions and explicit denies still apply. Delegation does not transfer ownership.</small></div> : <div className="field span-2"><label>Delegated editors</label><span>{delegateIds.map((id) => displayUserName(users.find((person) => person.id === id))).join(", ") || "None"}</span></div>}
        {isMeeting && <><div className="field"><label>Agenda</label><ClusterTextArea value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="Topics, goals, and prep" /></div>
        {resources.length ? <div className="field"><label>Rooms / resources</label><div className="event-resource-list-v9n">{resources.slice(0, 64).map((resource) => <label className="tool-check" key={resource.id}><ClusterInput type="checkbox" checked={meetingResourceIds.includes(resource.id)} onChange={(e) => setMeetingResourceIds((current) => e.target.checked ? Array.from(new Set([...current, resource.id])) : current.filter((id) => id !== resource.id))} /> {resource.name}{resource.location ? ` · ${resource.location}` : ""}</label>)}</div></div> : null}
        <label className="tool-check"><ClusterInput type="checkbox" checked={allowConflicts} onChange={(e) => setAllowConflicts(e.target.checked)} /> Allow availability/resource conflict override</label></>}
        <div className="two-col">
          <div className="field"><label>Library attachment IDs</label><ClusterTextInput value={attachmentIdsText} onChange={(e) => setAttachmentIdsText(e.target.value)} placeholder="id1, id2" /></div>
          <div className="field"><label>Decision IDs</label><ClusterTextInput value={decisionIdsText} onChange={(e) => setDecisionIdsText(e.target.value)} placeholder="id1, id2" /></div>
        </div>
        <div className="field"><label>Action item IDs</label><ClusterTextInput value={actionItemIdsText} onChange={(e) => setActionItemIdsText(e.target.value)} placeholder="Canonical My Work / work-item IDs" /></div>
      </div>

      <ClusterButton unstyled type="button" className="settings-disclosure-v190" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "Hide recurrence and links" : "Recurrence and links"}</ClusterButton>
      {showAdvanced && <div className="event-advanced-v190">
        <div className="two-col">
          <div className="field"><label>Recurrence</label><ClusterSelect value={recurrenceRule} onChange={setRecurrenceRule} ariaLabel="Event recurrence" options={[{ value: "", label: "Does not repeat" }, { value: "FREQ=DAILY", label: "Daily" }, { value: "FREQ=WEEKLY", label: "Weekly" }, { value: "FREQ=MONTHLY", label: "Monthly" }, { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Weekdays" }]} /></div>
          {isMeeting && recurrenceRule ? <div className="field"><label>Final occurrence date</label><ClusterTextInput type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} required /><small>Reservations are checked across the full series. Up to 366 days and 128 occurrences; extend later by editing the series. Existing indefinite series require an end date when edited.</small></div> : <div className="field"><label>Linked ticket ID</label><ClusterTextInput value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="Optional ticket/card ID" /></div>}
        </div>
        {isMeeting && recurrenceRule ? <div className="field"><label>Linked ticket ID</label><ClusterTextInput value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="Optional ticket/card ID" /></div> : null}
        <div className="field"><label>External URL</label><ClusterTextInput value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} /></div>
      </div>}

      {event?.recurrenceRule && <section className="panel compact-panel">
        <div className="section-heading"><div><p className="eyebrow">Series exceptions</p><h3>Individual occurrences</h3></div></div>
        <p className="muted tight">Skip or move one recurring date while keeping replies, RSVP and attendance attached to its original occurrence. Resource bookings are verified before a move.</p>
        {occurrenceStartsAt && (!event.meeting || occurrenceStartsAt !== event.startsAt) ? <div className="event-advanced-v190">
          <div className="two-col"><div className="field"><label>New occurrence start</label><ClusterTextInput type="datetime-local" value={movedStartsAt} onChange={(e) => setMovedStartsAt(e.target.value)} /></div>
          <div className="field"><label>New occurrence end</label><ClusterTextInput type="datetime-local" value={movedEndsAt} onChange={(e) => setMovedEndsAt(e.target.value)} /></div></div>
          <div className="modal-actions"><ClusterButton variant="secondary" disabled={mutationBusy || !movedStartsAt || !movedEndsAt || new Date(movedStartsAt).getTime() >= new Date(movedEndsAt).getTime()} onClick={() => void changeOccurrence(occurrenceStartsAt, "reschedule")}>Move only this occurrence</ClusterButton></div>
          {currentException?.status === "rescheduled" ? <small>This occurrence is moved. Restore it to its original series time to release its individual Scheduler booking.</small> : null}
        </div> : null}
        {occurrenceStartsAt && !(event.occurrenceExceptions || []).some((item) => item.status === "cancelled" && item.occurrenceStartsAt === occurrenceStartsAt) ? <div className="modal-actions"><span>{compactDateTime(occurrenceStartsAt)}</span><ClusterButton variant="secondary" disabled={mutationBusy} onClick={() => void changeOccurrence(occurrenceStartsAt, "cancel")}>Skip this occurrence</ClusterButton></div> : null}
        <div className="field"><label>Optional reason</label><ClusterTextInput value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} maxLength={500} placeholder="e.g. studio holiday" /></div>
        {(event.occurrenceExceptions || []).map((item) => <div className="modal-actions" key={item.occurrenceStartsAt}><span>{item.status === "rescheduled" ? `Moved ${compactDateTime(item.occurrenceStartsAt)} → ${compactDateTime(item.movedStartsAt || item.occurrenceStartsAt)}` : `Skipped ${compactDateTime(item.occurrenceStartsAt)}`}{item.reason ? ` · ${item.reason}` : ""}</span><ClusterButton variant="secondary" disabled={mutationBusy} onClick={() => void changeOccurrence(item.occurrenceStartsAt, "restore")}>Restore original</ClusterButton></div>)}
      </section>}

      {event?.meeting && currentUserId && (event.meeting.organizerId === currentUserId || (event.attendeeIds || []).includes(currentUserId)) ? <section className="panel compact-panel">
        <div className="section-heading"><div><p className="eyebrow">{perOccurrenceResponses ? `RSVP · ${compactDateTime(occurrenceStartsAt!)}` : "Series RSVP"}</p><h3>{levelLabel(myRsvp)}</h3></div><span className="soft-pill">{Object.values(effectiveRsvp).filter((value) => value === "accepted").length} accepted</span></div>
        <p className="muted tight">{perOccurrenceResponses ? "Your response applies only to this occurrence." : "Your response is the default for this meeting series."}</p>
        <div className="modal-actions"><ClusterButton type="button" disabled={mutationBusy} onClick={() => void updateRsvp("accepted")} variant="secondary">Accept</ClusterButton><ClusterButton type="button" disabled={mutationBusy} onClick={() => void updateRsvp("tentative")} variant="secondary">Tentative</ClusterButton><ClusterButton type="button" disabled={mutationBusy} onClick={() => void updateRsvp("declined")} variant="secondary">Decline</ClusterButton></div>
      </section> : null}

      {event?.meeting && isOrganizer ? <section className="panel compact-panel">
        <div className="section-heading"><div><p className="eyebrow">{perOccurrenceResponses ? `Attendance · ${compactDateTime(occurrenceStartsAt!)}` : "Series attendance"}</p><h3>Record attendance</h3></div><span className="soft-pill">Organizer authority</span></div>
        <div className="event-resource-list-v9n">{Array.from(new Set([event.meeting.organizerId || event.ownerId || "", ...(event.attendeeIds || [])].filter(Boolean))).map((userId) => <div className="two-col" key={userId}><span>{displayUserName(users.find((user) => user.id === userId))}</span><ClusterSelect value={attendance[userId] || "unknown"} onChange={(value) => setAttendance((current) => ({ ...current, [userId]: value }))} ariaLabel={`Attendance for ${userId}`} options={[{ value: "unknown", label: "Unknown" }, { value: "present", label: "Present" }, { value: "remote", label: "Remote" }, { value: "absent", label: "Absent" }, { value: "excused", label: "Excused" }]} /></div>)}</div>
        <div className="modal-actions"><ClusterButton type="button" disabled={mutationBusy} onClick={() => void saveAttendance()} variant="secondary">Save attendance</ClusterButton></div>
      </section> : null}

      {event ? <WorkActionMenu context={{ source: { kind: "calendar", id: event.id, projectId: event.projectId || null, label: event.title }, navigation: { screen: "calendar", projectId: event.projectId || null, inspectScope: "calendar-event", inspectId: event.id }, projectId: event.projectId || null, assigneeId: ownerId || event.ownerId || null, attendeeIds, startsAt: event.startsAt, endsAt: event.endsAt || null }} label={`${event.title} work actions`} allowAssign onAssign={() => document.querySelector<HTMLElement>('[aria-label="Event owner"]')?.focus()} exclude={["schedule"]} /> : null}
      {event?.projectId ? <LinkedWorkPanel projectId={event.projectId} kind="calendar" entityId={event.id} compact /> : null}
      {event && <EntityCustomFields entity="calendar" entityId={event.id} entityLabel={event.title} projectId={event.projectId || null} title="Event fields" compact />}
      <div className="modal-actions">
        <ClusterButton type="button" disabled={mutationBusy} onClick={closeEditor} variant="secondary">Cancel</ClusterButton>
        {event && <ClusterButton type="button" disabled={mutationBusy} onClick={() => void deleteEvent()} variant="secondary">Delete</ClusterButton>}
        <ClusterButton type="button" onClick={() => void saveEvent()} disabled={mutationBusy || !title.trim() || !startsAt || (isMeeting && (!endsAt || (Boolean(recurrenceRule) && !recurrenceEndDate)))} variant="primary">{mutationBusy ? "Saving…" : `Save ${isMeeting ? "meeting" : "event"}`}</ClusterButton>
      </div>
  </ClusterModal>;
}

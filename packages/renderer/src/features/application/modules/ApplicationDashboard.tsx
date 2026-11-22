import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, queryApi, setApiQueryData } from "../../../core/api";
import { useVisibleTicker } from "../../../core/visible-ticker";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { useProjectDeliveryList } from "../../../core/project-delivery-storage";
import { pruneSignalPreferences, signalIsVisible, type SmartSignalPreferences, type SmartWorkspaceContext } from "../../../core/smart-interface";
import { canUseTool } from "../../../core/permissions";
import { useServerState } from "../../../core/server-state";
import { addDays, compactDateTime, minutesToHuman, weekStart } from "../../../core/date-time";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../../core/format";
import { importantBuildEntries, isExternalProject, projectAssignedIds, projectBoardCount, projectCompleteness, projectGitCount, projectHealth, projectLatestTimestamp, projectSetupGaps, projectStatusLabel } from "../../projects/projects-utils";
import { activeLabel } from "../../people/people-utils";
import { personMetaLabel } from "../../people/person-summary";
import { notificationWorkNavigation } from "../../notifications/notification-navigation";
import { openClusterWorkNavigation } from "../../workflow/work-navigation";
import { CLUSTER_PERSON_CHANGED_EVENT, CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, type ClusterPersonSummary, type ClusterAssignmentChange, type NotificationItem, type NotificationSummary } from "@cluster/shared";
import { subscribeClusterCohesionEvent } from "../../../core/cohesion-events";
import { ClusterButton } from "../../../components/ClusterButton";
import { confirmCluster } from "../../../components/cluster-dialog-service";
import { ToolPageHeader } from "../../../components/ToolPageHeader";
import { requestSecurityPin, requestSecurityPinSetup } from "../../../core/security-pin";
import type { User, Project, ProjectSnapshot, Settings, LibrarySummary, TimelinePayload, UpcomingPayload, TimeEntry, TimeSummary, ActivityEvent, UserActivitySummary, WorkLinkRecord, RecurringWorkRecord, WatcherRecord, ProjectCloseoutRecord, ExternalPortalRule, AttentionItem, AttachmentRecord, TimeCorrectionRequest, ShiftRuleSettings, BreakLedgerEntry, BuildArtifactRecord, QATestPlan, ClockIntentPayload, TeamAssignment } from "../application-models";
import { readShiftRules } from "../../operations/modules/time-rules";
import { useDashboardWidgets } from "../../home-widgets/home-dashboard-controller";

import { ProjectWorkflowAttentionState, deriveNeedsAttention } from "./application-foundation";
import { ClockIntentModal } from "./application-workspace-core";
import { CLUSTER_KIOSK_POLICY_CHANGED_EVENT } from "../../desktop/use-kiosk-document-state";
import { BuiltInHomeWidget, type BuiltInHomeWidgetData, type BuiltInHomeWidgetActions, type HomeWidgetListItem } from "../../home-widgets/BuiltInHomeWidget";
import { HomeWidgetGrid } from "../../home-widgets/HomeWidgetGrid";
import { HomeWidgetGallery } from "../../home-widgets/HomeWidgetGallery";
import { HomeWidgetOptions } from "../../home-widgets/HomeWidgetOptions";
import { DASHBOARD_WIDGETS, departmentAwareHomeWidgetRecommendation, homeWidgetGovernanceFromCsv, type HomeWidgetPlacement, type HomeWidgetRuntimeStatus } from "../../home-widgets/home-widget-model";
import { packGrid } from "../../home-widgets/home-widget-grid";
import { derivePeopleCapacity, deriveReviewQueue, deriveSourceControl } from "../../home-widgets/home-widget-sources";
import { useHomeSourceControl } from "../../home-widgets/use-home-source-control";
import { isOpenHomeTicket, isPriorityHomeTicket } from "../../home-widgets/home-ticket-policy";
import { createHomeRequestAuthority } from "../../home-widgets/home-request-authority";
import { openSharedCreate } from "../../create/shared-create-handoff";
import { type HomeWidgetRuntimeContext } from "../../home-widgets/home-widget-runtime-policy";

type NotificationPreview = NotificationItem;
type HomeRemoteSource = "library" | "requiredKnowledge" | "time" | "calendar" | "timeline" | "people" | "activity" | "assignments" | "tickets" | "inbox";
type HomeKnowledgeAssignment = {
  id: string;
  kind: "packet" | "policy";
  resourceId: string;
  resourceVersionId?: string | null;
  title: string;
  description?: string | null;
  versionLabel?: string | null;
  state: string;
  dueAt?: string | null;
  overdue: boolean;
  navigation: { screen: "packets"; packetId?: string | null; policyId?: string | null };
};
type HomeTicketSummary = {
  id: string;
  title: string;
  priority?: string | null;
  ticketStage?: string | null;
  dueDate?: string | null;
  assigneeId?: string | null;
  updatedAt?: string | null;
  listId: string;
  listTitle: string;
  listIsDone?: boolean;
  boardId: string;
  boardName: string;
  projectId: string;
  projectName: string;
};
type HomeRemoteState = { state: "loading" | "ready" | "error"; error?: string };
const HOME_REMOTE_SOURCES: HomeRemoteSource[] = ["library", "requiredKnowledge", "time", "calendar", "timeline", "people", "activity", "assignments", "tickets", "inbox"];
function defaultHomeRemoteState(): Record<HomeRemoteSource, HomeRemoteState> {
  return Object.fromEntries(HOME_REMOTE_SOURCES.map((source) => [source, { state: "loading" }])) as Record<HomeRemoteSource, HomeRemoteState>;
}
function homeRemoteError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Cluster could not refresh this Home data.";
}

export function Dashboard({ projects, onOpenBoard, onOpenProjects, onOpenProject, onOpenMyWork, onOpenIntegrations, onOpenAdmin, onOpenLibrary, onOpenTime, onOpenTeam, onOpenTimeline, onOpenBuilds, onOpenQA, onOpenTickets, onOpenNotifications, onOpenActivity, isAdmin, currentUser, settings, resumeContext }: { projects: Project[]; onOpenBoard: (boardId: string) => void; onOpenProjects: () => void; onOpenProject: (projectId: string) => void; onOpenMyWork: () => void; onOpenIntegrations: () => void; onOpenAdmin: () => void; onOpenLibrary: () => void; onOpenTime: () => void; onOpenTeam: () => void; onOpenTimeline: () => void; onOpenBuilds: () => void; onOpenQA: () => void; onOpenTickets: () => void; onOpenNotifications: () => void; onOpenActivity: () => void; isAdmin: boolean; currentUser: User; settings: Settings; resumeContext?: SmartWorkspaceContext | null }) {
  const boardCount = projectBoardCount(projects);
  const gitCount = projectGitCount(projects);
  const unassignedProjects = projects.filter((project) => isExternalProject(project) && !projectAssignedIds(project).length);
  const missingBoardProjects = projects.filter((project) => !project.boards.length);
  const missingWhiteboardProjects = projects.filter((project) => !(project.whiteboards?.length || 0));
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [timeSummary, setTimeSummary] = useState<TimeSummary | null>(null);
  const [homeActiveEntry, setHomeActiveEntry] = useState<TimeEntry | null>(null);
  const [clockBusy, setClockBusy] = useState(false);
  const [clockStatus, setClockStatus] = useState("");
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [clockTitle, setClockTitle] = useState("");
  const [clockProjectIds, setClockProjectIds] = useState<string[]>([]);
  const [clockTick, setClockTick] = useState(Date.now());
  const [upcoming, setUpcoming] = useState<UpcomingPayload | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [homeAssignments, setHomeAssignments] = useState<TeamAssignment[]>([]);
  const [homeKnowledgeAssignments, setHomeKnowledgeAssignments] = useState<HomeKnowledgeAssignment[]>([]);
  const [homeTickets, setHomeTickets] = useState<HomeTicketSummary[]>([]);
  const [homeInboxSummary, setHomeInboxSummary] = useState<NotificationSummary | null>(null);
  const [homeRemoteState, setHomeRemoteState] = useState<Record<HomeRemoteSource, HomeRemoteState>>(() => defaultHomeRemoteState());
  const [projectSnapshots, setProjectSnapshots] = useState<Record<string, ProjectSnapshot>>({});
  useEffect(() => {
    const ids = projects.map((project) => project.id).sort();
    if (!ids.length) { setProjectSnapshots({}); return; }
    let active = true;
    queryApi<{ snapshots: ProjectSnapshot[] }>(`/api/projects/snapshots?ids=${encodeURIComponent(ids.join(","))}`, { staleMs: 60_000, maxAgeMs: 3 * 60_000, tags: ["home", "projects", "project-snapshot"] })
      .then((result) => { if (active) setProjectSnapshots(Object.fromEntries((result.snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]))); })
      .catch(() => { if (active) setProjectSnapshots({}); });
    return () => { active = false; };
  }, [projects.map((project) => project.id).sort().join("|")]);
  const projectHealthForHome = (project: Project) => {
    const snapshot = projectSnapshots[project.id];
    if (snapshot?.health.state === "blocked") return { tone: "danger", label: "Blocked" };
    if (snapshot?.health.state === "at_risk") return { tone: "danger", label: "At Risk" };
    if (snapshot?.health.state === "attention") return { tone: "warning", label: "Needs Attention" };
    if (snapshot) return { tone: "good", label: "Healthy" };
    return projectHealth(project);
  };
  const operationalProjects = projects.filter((project) => projectHealthForHome(project).tone === "good");
  const attentionProjects = projects.filter((project) => projectHealthForHome(project).tone !== "good");
  const [lastSeenAt, setLastSeenAt] = useServerState<string>("user", "activity.last-seen", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const [signalPreferences, setSignalPreferences] = useServerState<SmartSignalPreferences>("user", "smart.signal-preferences", {});
  const homeRoleId = currentUser.workspaceRole || settings.studioDefaultWorkspaceRole || "member";
  const homeRoleDefinition = settings.studioRoleDefinitions?.find((role) => role.id === homeRoleId);
  const normalizedUserDepartment = String(currentUser.department || "").trim().toLowerCase();
  const matchedHomeDepartment = settings.studioDepartmentDefinitions?.find((department) => department.id.toLowerCase() === normalizedUserDepartment || department.label.toLowerCase() === normalizedUserDepartment);
  const homeDepartmentId = homeRoleDefinition?.departmentId || matchedHomeDepartment?.id || settings.studioDefaultDepartmentId || normalizedUserDepartment;
  const homeRecommendation = departmentAwareHomeWidgetRecommendation(homeRoleId, homeDepartmentId, settings.studioRoleDefinitions, settings.studioDepartmentDefinitions, settings.studioHomeRecommendedWidgetsCsv);
  const homeRecommendationKey = homeRecommendation.keys.join(", ");
  const homeWidgetGovernance = useMemo(() => homeWidgetGovernanceFromCsv(settings.studioHomeRequiredWidgetsCsv, settings.studioHomeUnavailableWidgetsCsv, homeRecommendationKey), [settings.studioHomeRequiredWidgetsCsv, settings.studioHomeUnavailableWidgetsCsv, homeRecommendationKey]);
  const dashboardWidgets = useDashboardWidgets(homeWidgetGovernance);
  const homeCanMyWork = canUseTool(currentUser, "mywork");
  const homeCanProjects = canUseTool(currentUser, "projects");
  const homeCanTime = settings.schedulerEnabled !== false && canUseTool(currentUser, "scheduler");
  const homeCanNotifications = canUseTool(currentUser, "inbox");
  const homeCanTeam = canUseTool(currentUser, "people");
  const homeCanActivity = canUseTool(currentUser, "activity");
  const homeCanBuilds = canUseTool(currentUser, "builds");
  const homeCanQa = canUseTool(currentUser, "qa");
  const homeCanTimeline = settings.timelineEnabled !== false && canUseTool(currentUser, "timeline");
  const homeCanTickets = settings.ticketsEnabled !== false && canUseTool(currentUser, "tickets");
  const homeCanSourceControl = canUseTool(currentUser, "sourceControl");
  const homeCanCalendar = settings.calendarEnabled !== false && canUseTool(currentUser, "calendar");
  const homeCanLibrary = settings.libraryEnabled !== false && canUseTool(currentUser, "library");
  const [homeEditMode, setHomeEditMode] = useState(false);
  const [homeOptionsId, setHomeOptionsId] = useState<string | null>(null);
  const [kioskHomeState, setKioskHomeState] = useState(() => ({
    active: typeof document !== "undefined" && document.documentElement.dataset.clusterKiosk === "true",
    readOnly: typeof document !== "undefined" && document.documentElement.dataset.clusterKioskReadOnly === "true",
    widgetIds: typeof document !== "undefined" ? String(document.documentElement.dataset.clusterKioskHomeWidgets || "").split(",").filter(Boolean) : [],
  }));
  useEffect(() => {
    const sync = () => setKioskHomeState({
      active: document.documentElement.dataset.clusterKiosk === "true",
      readOnly: document.documentElement.dataset.clusterKioskReadOnly === "true",
      widgetIds: String(document.documentElement.dataset.clusterKioskHomeWidgets || "").split(",").filter(Boolean),
    });
    window.addEventListener(CLUSTER_KIOSK_POLICY_CHANGED_EVENT, sync);
    sync();
    return () => window.removeEventListener(CLUSTER_KIOSK_POLICY_CHANGED_EVENT, sync);
  }, []);
  const enabledHomeWidgets = useMemo(() => {
    const kioskIds = new Set(kioskHomeState.widgetIds);
    return dashboardWidgets.layout.items.filter((placement) => !kioskHomeState.active || !kioskIds.size || kioskIds.has(placement.id));
  }, [dashboardWidgets.layout, kioskHomeState.active, kioskHomeState.widgetIds.join("|")]);
  const enabledHomeWidgetIds = useMemo(() => new Set<string>(enabledHomeWidgets.map((placement) => placement.id)), [enabledHomeWidgets]);
  const enabledHomeWidgetSignature = useMemo(() => [...enabledHomeWidgetIds].sort().join("|"), [enabledHomeWidgetIds]);
  const homeWidgetUses = (...ids: string[]) => ids.some((id) => enabledHomeWidgetIds.has(id));
  // Each source loads only while a widget on Home reads it; "brief" reads them all.
  const homeNeedsLibrary = homeWidgetUses("library", "brief");
  const homeNeedsRequiredKnowledge = homeWidgetUses("roleFocus", "brief");
  const homeNeedsTime = homeWidgetUses("scheduler", "brief");
  const homeNeedsCalendar = homeWidgetUses("roleFocus", "upcoming", "scheduler", "brief");
  const homeNeedsTimeline = homeWidgetUses("timeline", "brief");
  const homeNeedsPeople = homeWidgetUses("people", "peopleCapacity", "brief");
  const homeNeedsActivity = homeWidgetUses("activity", "brief");
  const homeNeedsAssignments = homeWidgetUses("roleFocus", "peopleCapacity", "brief");
  const homeNeedsTeamWideAssignments = homeWidgetUses("peopleCapacity", "brief");
  const homeNeedsTickets = homeWidgetUses("tickets", "brief");
  const homeNeedsInbox = homeWidgetUses("inbox", "brief");
  const homeNeedsBuilds = homeWidgetUses("builds", "brief");
  const homeNeedsQa = homeWidgetUses("qa", "brief");
  const homeNeedsSourceControl = homeWidgetUses("sourceControl", "reviewQueue");
  const homeNeedsProjectWorkflow = homeWidgetUses("projects", "adminOverview", "brief");
  const homeSourceControl = useHomeSourceControl(homeCanSourceControl && homeNeedsSourceControl, currentUser.id);
  const [homeNote, setHomeNote] = useServerState<string>("user", "dashboard.note", "");
  const workflowProjectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const projectWorkflowIds = homeCanProjects && homeNeedsProjectWorkflow ? workflowProjectIds : [];
  const [qaPlans] = useProjectDeliveryList<QATestPlan>("qa-plan", homeCanQa && homeNeedsQa ? workflowProjectIds : []);
  const [buildArtifacts] = useProjectDeliveryList<BuildArtifactRecord>("build", homeCanBuilds && homeNeedsBuilds ? workflowProjectIds : []);
  const [workflowLinks] = useProjectWorkflowList<WorkLinkRecord>("dependency", projectWorkflowIds);
  const [recurringWork] = useProjectWorkflowList<RecurringWorkRecord>("recurring", projectWorkflowIds);
  const [workflowWatchers] = useProjectWorkflowList<WatcherRecord>("watcher", projectWorkflowIds);
  const [homeAttachments] = useServerState<AttachmentRecord[]>("studio", "operations.attachments", [], { enabled: homeCanLibrary && homeNeedsProjectWorkflow });
  const [homeCorrectionRequests] = useServerState<TimeCorrectionRequest[]>("studio", "time.correction-requests", [], { enabled: homeCanTime && (homeNeedsTime || homeNeedsProjectWorkflow) });
  const [homeShiftRules] = useServerState<ShiftRuleSettings>("studio", "time.shift-rules", readShiftRules(), { merge: (value, fallback) => ({ ...fallback, ...value }), enabled: homeCanTime && (homeNeedsTime || homeNeedsProjectWorkflow) });
  const [homeBreakLedger] = useServerState<BreakLedgerEntry[]>("studio", "time.break-ledger", [], { enabled: homeCanTime && (homeNeedsTime || homeNeedsProjectWorkflow) });
  const homeRefreshTimerRef = useRef(0);
  const homeRefreshPendingRef = useRef<Set<HomeRemoteSource>>(new Set());
  const projectWorkflowAttention = useMemo<ProjectWorkflowAttentionState>(() => ({
    qaPlans,
    links: workflowLinks,
    recurring: recurringWork,
    watchers: workflowWatchers,
    closeouts: [],
    portalRules: [],
    attachments: homeCanLibrary ? homeAttachments : [],
    correctionRequests: homeCanTime ? homeCorrectionRequests : [],
    shiftRules: homeCanTime ? homeShiftRules : readShiftRules(),
    breakLedger: homeCanTime ? homeBreakLedger : [],
  }), [qaPlans, workflowLinks, recurringWork, workflowWatchers, homeAttachments, homeCorrectionRequests, homeShiftRules, homeBreakLedger]);
  function markHomeRemote(source: HomeRemoteSource, next: HomeRemoteState) {
    setHomeRemoteState((current) => ({ ...current, [source]: next }));
  }
  function homeSourceAllowed(source: HomeRemoteSource) {
    if (source === "library") return homeCanLibrary && homeNeedsLibrary;
    if (source === "requiredKnowledge") return homeCanMyWork && homeNeedsRequiredKnowledge;
    if (source === "time") return homeCanTime && homeNeedsTime;
    if (source === "calendar") return homeCanCalendar && homeNeedsCalendar;
    if (source === "timeline") return homeCanTimeline && homeNeedsTimeline;
    if (source === "people") return homeCanTeam && homeNeedsPeople;
    if (source === "activity") return homeCanActivity && homeNeedsActivity;
    if (source === "assignments") return (homeCanMyWork || homeCanTeam) && homeNeedsAssignments;
    if (source === "inbox") return homeCanNotifications && homeNeedsInbox;
    return homeCanTickets && homeNeedsTickets;
  }
  const homeReadOwner = `${currentUser.id}|${HOME_REMOTE_SOURCES.map((source) => homeSourceAllowed(source) ? "1" : "0").join("")}|team:${homeNeedsTeamWideAssignments ? "1" : "0"}`;
  const homeReadAuthorityRef = useRef(createHomeRequestAuthority(homeReadOwner));
  homeReadAuthorityRef.current.setOwner(homeReadOwner);
  const homeMountedRef = useRef(false);
  useEffect(() => {
    homeMountedRef.current = true;
    return () => {
      homeMountedRef.current = false;
      // Unmount, role changes and source selection changes cancel pending UI commits.
      for (const source of HOME_REMOTE_SOURCES) homeReadAuthorityRef.current.invalidate(source);
    };
  }, [homeReadOwner]);
  async function loadHomeSource<T>(source: HomeRemoteSource, read: () => Promise<T>, apply: (data: T) => void, quiet = false, rethrow = false) {
    const authority = homeReadAuthorityRef.current;
    if (!homeMountedRef.current || !authority.isOwner(homeReadOwner) || !homeSourceAllowed(source)) return;
    const ticket = authority.claim(source);
    if (!quiet) markHomeRemote(source, { state: "loading" });
    try {
      const result = await read();
      if (!authority.isCurrent(ticket)) return;
      apply(result);
      markHomeRemote(source, { state: "ready" });
    } catch (error) {
      if (!authority.isCurrent(ticket)) return;
      markHomeRemote(source, { state: "error", error: homeRemoteError(error) });
      if (rethrow) throw error;
    }
  }
  function loadHomeLibrary(quiet = false, force = false) {
    return loadHomeSource("library", () => queryApi<LibrarySummary>("/api/library/summary", { staleMs: 60_000, maxAgeMs: 15 * 60_000, force, tags: ["library", "home"] }), setLibrarySummary, quiet);
  }
  function loadRequiredKnowledge(quiet = false, force = false) {
    return loadHomeSource("requiredKnowledge", () => queryApi<{ assignments: HomeKnowledgeAssignment[] }>("/api/my-knowledge", { staleMs: 45_000, maxAgeMs: 2 * 60_000, force, tags: ["work", "packets", "studio-systems", "home"] }), (result) => setHomeKnowledgeAssignments(result.assignments || []), quiet);
  }
  function loadHomeTime(quiet = false, force = false) {
    return loadHomeSource("time", async () => {
      const start = weekStart();
      const end = addDays(start, 7);
      return Promise.all([
        queryApi<TimeSummary>(`/api/time/summary?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&userId=${encodeURIComponent(currentUser.id)}`, { staleMs: 30_000, maxAgeMs: 2 * 60_000, force, tags: ["time", "home"] }),
        queryApi<{ active: TimeEntry | null }>("/api/time/active", { staleMs: 15_000, maxAgeMs: 60_000, force, tags: ["time", "clock", "workday"] }),
      ]);
    }, ([summary, active]) => { setTimeSummary(summary); setHomeActiveEntry(active.active); setClockTick(Date.now()); }, quiet, true);
  }
  function loadHomeCalendar(quiet = false, force = false) {
    return loadHomeSource("calendar", () => queryApi<UpcomingPayload>("/api/calendar/upcoming", { staleMs: 45_000, maxAgeMs: 5 * 60_000, force, tags: ["calendar"] }), setUpcoming, quiet);
  }
  function loadHomeTimeline(quiet = false, force = false) {
    return loadHomeSource("timeline", () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = addDays(start, 180);
      return queryApi<TimelinePayload>(`/api/timeline?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, { staleMs: 90_000, maxAgeMs: 10 * 60_000, force, tags: ["timeline", "home"] });
    }, setTimeline, quiet);
  }
  function loadHomePeople(quiet = false, force = false) {
    return loadHomeSource("people", () => queryApi<UserActivitySummary[]>("/api/users", { staleMs: 60_000, maxAgeMs: 5 * 60_000, force, tags: ["users", "people"] }), setUsers, quiet);
  }
  function loadHomeActivity(quiet = false, force = false) {
    return loadHomeSource("activity", () => queryApi<ActivityEvent[]>("/api/activity?limit=100", { staleMs: 45_000, maxAgeMs: 2 * 60_000, force, tags: ["activity"] }), setActivity, quiet);
  }
  function loadHomeAssignments(quiet = false, force = false) {
    return loadHomeSource("assignments", () => queryApi<TeamAssignment[]>(`/api/team/assignments?scope=${homeNeedsTeamWideAssignments ? "team" : "mine"}`, { staleMs: 45_000, maxAgeMs: 2 * 60_000, force, tags: ["work"] }), setHomeAssignments, quiet);
  }
  function loadHomeInbox(quiet = false, force = false) {
    return loadHomeSource("inbox", () => queryApi<{ ok: true; summary: NotificationSummary }>("/api/notifications/summary", { staleMs: 20_000, maxAgeMs: 60_000, force, tags: ["inbox", "notifications", "home"] }), (result) => setHomeInboxSummary(result.summary), quiet);
  }
  function loadHomeTickets(quiet = false, force = false) {
    return loadHomeSource("tickets", () => queryApi<{ items: HomeTicketSummary[] }>("/api/tickets/assigned-summary?limit=40", { staleMs: 45_000, maxAgeMs: 5 * 60_000, force, tags: ["tickets", "work", "home"] }), (result) => setHomeTickets(result.items || []), quiet);
  }
  function runScheduledHomeRefresh() {
    window.clearTimeout(homeRefreshTimerRef.current);
    if (document.visibilityState !== "visible") return;
    const sources = [...homeRefreshPendingRef.current];
    homeRefreshPendingRef.current.clear();
    for (const source of sources) {
      if (!homeSourceAllowed(source)) continue;
      if (source === "library") void loadHomeLibrary(true, true);
      else if (source === "requiredKnowledge") void loadRequiredKnowledge(true, true);
      else if (source === "time") void loadHomeTime(true, true).catch(() => undefined);
      else if (source === "calendar") void loadHomeCalendar(true, true);
      else if (source === "timeline") void loadHomeTimeline(true, true);
      else if (source === "people") void loadHomePeople(true, true);
      else if (source === "activity") void loadHomeActivity(true, true);
      else if (source === "assignments") void loadHomeAssignments(true, true);
      else if (source === "inbox") void loadHomeInbox(true, true);
      else void loadHomeTickets(true, true);
    }
  }
  function scheduleHomeRefresh(sources: HomeRemoteSource[]) {
    sources.filter(homeSourceAllowed).forEach((source) => homeRefreshPendingRef.current.add(source));
    window.clearTimeout(homeRefreshTimerRef.current);
    if (document.visibilityState !== "visible") return;
    homeRefreshTimerRef.current = window.setTimeout(runScheduledHomeRefresh, 1_000);
  }
  function retryHomeRemote(source: HomeRemoteSource) {
    if (!homeSourceAllowed(source)) return;
    if (source === "library") void loadHomeLibrary(false, true);
    else if (source === "requiredKnowledge") void loadRequiredKnowledge(false, true);
    else if (source === "time") void loadHomeTime(false, true).catch(() => undefined);
    else if (source === "calendar") void loadHomeCalendar(false, true);
    else if (source === "timeline") void loadHomeTimeline(false, true);
    else if (source === "people") void loadHomePeople(false, true);
    else if (source === "activity") void loadHomeActivity(false, true);
    else if (source === "assignments") void loadHomeAssignments(false, true);
    else if (source === "inbox") void loadHomeInbox(false, true);
    else void loadHomeTickets(false, true);
  }
  useEffect(() => {
    if (homeSourceAllowed("library")) void loadHomeLibrary();
    if (homeSourceAllowed("requiredKnowledge")) void loadRequiredKnowledge();
    if (homeSourceAllowed("time")) void loadHomeTime().catch(() => undefined);
    if (homeSourceAllowed("calendar")) void loadHomeCalendar();
    if (homeSourceAllowed("timeline")) void loadHomeTimeline();
    if (homeSourceAllowed("people")) void loadHomePeople();
    if (homeSourceAllowed("activity")) void loadHomeActivity();
    if (homeSourceAllowed("assignments")) void loadHomeAssignments();
    if (homeSourceAllowed("tickets")) void loadHomeTickets();
    if (homeSourceAllowed("inbox")) void loadHomeInbox();
    const stampHandle = window.setTimeout(() => setLastSeenAt(new Date().toISOString()), 1500);
    return () => window.clearTimeout(stampHandle);
  }, [setLastSeenAt, currentUser.id, homeCanLibrary, homeCanTime, homeCanCalendar, homeCanTimeline, homeCanTeam, homeCanActivity, homeCanMyWork, homeCanTickets, homeCanNotifications, enabledHomeWidgetSignature]);
  useEffect(() => subscribeClusterCohesionEvent<ClusterAssignmentChange>(CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, () => { scheduleHomeRefresh(["assignments", "requiredKnowledge", "calendar", "tickets", "activity", "inbox"]); }), [currentUser.id]);
  useEffect(() => subscribeClusterCohesionEvent<Partial<ClusterPersonSummary>>(CLUSTER_PERSON_CHANGED_EVENT, () => { scheduleHomeRefresh(["people", "assignments"]); }), [currentUser.id]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "visible" && homeRefreshPendingRef.current.size) runScheduledHomeRefresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(homeRefreshTimerRef.current); document.removeEventListener("visibilitychange", onVisibility); };
  }, [currentUser.id]);
  useEffect(() => { if (!homeActiveEntry) setClockTick(Date.now()); }, [homeActiveEntry?.id]);
  useVisibleTicker(() => setClockTick(Date.now()), 30_000, Boolean(homeActiveEntry));
  function openHomeClockModal() {
    if (clockBusy) return;
    setClockStatus("");
    setClockTitle("");
    setClockModalOpen(true);
  }
  async function confirmHomeClock(payload: ClockIntentPayload) {
    if (clockBusy) return;
    setClockStatus("");
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: homeActiveEntry ? "Clock out" : "Clock in",
          description: homeActiveEntry ? "Enter your PIN to stop the active timer." : "Enter your PIN to start the timer.",
          purpose: homeActiveEntry ? "clock_out" : "clock_in",
          confirmLabel: homeActiveEntry ? "Clock out" : "Clock in",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before using time tracking.",
          purpose: "clock_in",
        });
    if (!pin) return;
    setClockBusy(true);
    try {
      if (homeActiveEntry) {
        const stopped = await api<TimeEntry>("/api/time/stop", {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        setHomeActiveEntry(null);
        setApiQueryData("/api/time/active", { active: null }, { staleMs: 5_000, maxAgeMs: 60_000, tags: ["time", "clock", "workday"] });
        setClockStatus(`Clocked out. ${minutesToHuman(stopped.computedDurationMinutes)} recorded.`);
        setClockModalOpen(false);
      } else {
        const chosenProjects = projects.filter((project) => payload.projectIds.includes(project.id));
        const description = chosenProjects.length > 1 ? `Projects: ${chosenProjects.map((project) => project.name).join(", ")}` : null;
        const started = await api<TimeEntry>("/api/time/start", {
          method: "POST",
          body: JSON.stringify({
            title: payload.title || "Clock in",
            projectId: payload.projectIds.length === 1 ? payload.projectIds[0] : null,
            boardId: null,
            cardId: null,
            description,
            pin,
          }),
        });
        setHomeActiveEntry(started);
        setApiQueryData("/api/time/active", { active: started }, { staleMs: 5_000, maxAgeMs: 60_000, tags: ["time", "clock", "workday"] });
        setClockStatus(chosenProjects.length > 1 ? `Clocked in across ${chosenProjects.length} projects.` : `Clocked in${chosenProjects[0] ? ` on ${chosenProjects[0].name}` : ""}.`);
        setClockModalOpen(false);
      }
      scheduleHomeRefresh(["time", "activity"]);
    } catch (err) {
      setClockStatus(err instanceof Error ? err.message : "Clock action failed.");
    } finally {
      setClockBusy(false);
    }
  }
  const activeUsers = users.filter((item) => activeLabel(item.lastSeenAt, item.lastActivityAt) !== "Offline").length;
  const recentProjects = [...projects].sort((a, b) => projectLatestTimestamp(b) - projectLatestTimestamp(a)).slice(0, 5);
  const recentActivity = activity.slice(0, 7);
  const homeAssignmentByUserId = useMemo(() => new Map(homeAssignments.map((item) => [item.user.id, item])), [homeAssignments]);
  const homeUsersWithWorkload = useMemo(() => users.map((user) => ({
    ...user,
    counts: {
      activityEvents: user.counts?.activityEvents || 0,
      comments: user.counts?.comments || 0,
      assignedCards: homeAssignmentByUserId.get(user.id)?.cards.length ?? user.counts?.assignedCards ?? 0,
    },
  })), [users, homeAssignmentByUserId]);
  const homeMine = homeAssignmentByUserId.get(currentUser.id);
  const homeAssignedCards = homeMine?.cards || [];
  const homePriorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const homeFocusCards = [...homeAssignedCards]
    .sort((a, b) => (homePriorityRank[a.priority || "medium"] ?? 2) - (homePriorityRank[b.priority || "medium"] ?? 2) || new Date(a.dueDate || "2999-12-31").getTime() - new Date(b.dueDate || "2999-12-31").getTime())
    .slice(0, 5);
  const homeTodayStart = new Date();
  homeTodayStart.setHours(0, 0, 0, 0);
  const homeTodayEnd = addDays(homeTodayStart, 1);
  const homeTodayEvents = (upcoming?.events || []).filter((event) => {
    const starts = new Date(event.startsAt).getTime();
    return starts >= homeTodayStart.getTime() && starts < homeTodayEnd.getTime();
  }).slice(0, 4);
  const homeOverdueCards = homeAssignedCards.filter((card) => card.dueDate && new Date(card.dueDate).getTime() < homeTodayStart.getTime());
  const homePriorityCards = homeAssignedCards.filter((card) => card.priority === "urgent" || card.priority === "high");
  const homeRelationshipBlockers = homeAssignedCards.reduce((total, card) => total + (card.relationshipSummary?.blockers || 0), 0);
  const dueCards = upcoming?.dueCards?.slice(0, 5) || [];
  const upcomingEvents = upcoming?.events?.slice(0, 5) || [];
  const timelineEntries = timeline?.entries || [];
  const buildEntries = importantBuildEntries(timelineEntries).slice(0, 6);
  const allNeedsAttentionItems = deriveNeedsAttention({
    projects: homeCanProjects ? projects : [],
    dueCards: homeCanCalendar ? (upcoming?.dueCards || []) : [],
    timelineEntries: homeCanTimeline ? timelineEntries : [],
    buildEntries: homeCanBuilds ? buildEntries : [],
    users: homeCanTeam ? homeUsersWithWorkload : [],
    librarySummary: homeCanLibrary ? librarySummary : null,
    timeSummary: homeCanTime ? timeSummary : null,
    activeEntry: homeCanTime ? homeActiveEntry : null,
    activity: homeCanActivity ? activity : [],
    lastSeenAt,
    projectWorkflows: projectWorkflowAttention,
  });
  function attentionTargetAllowed(target: AttentionItem["target"]) {
    if (target === "projects") return homeCanProjects;
    if (target === "timeline") return homeCanTimeline;
    if (target === "builds") return homeCanBuilds;
    if (target === "scheduler") return homeCanTime;
    if (target === "library") return homeCanLibrary;
    if (target === "people") return homeCanTeam;
    if (target === "inbox") return homeCanNotifications;
    if (target === "activity") return homeCanActivity;
    if (target === "tickets") return homeCanTickets;
    return isAdmin;
  }
  const authorizedNeedsAttentionItems = allNeedsAttentionItems.filter((item) => attentionTargetAllowed(item.target));
  const prunedSignalPreferences = pruneSignalPreferences(signalPreferences, authorizedNeedsAttentionItems.map((item) => item.id));
  const needsAttentionItems = authorizedNeedsAttentionItems.filter((item) => signalIsVisible(item.id, prunedSignalPreferences));
  function patchSignalPreference(itemId: string, preference: SmartSignalPreferences[string]) {
    const next = { ...prunedSignalPreferences, [itemId]: preference };
    setSignalPreferences(next);
  }
  function snoozeSignal(itemId: string) {
    patchSignalPreference(itemId, { snoozedUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() });
  }
  function dismissSignal(itemId: string) {
    patchSignalPreference(itemId, { dismissedAt: new Date().toISOString() });
  }
  const activeClockMinutes = homeActiveEntry ? Math.max(homeActiveEntry.computedDurationMinutes || 0, Math.round((clockTick - new Date(homeActiveEntry.startedAt).getTime()) / 60000)) : 0;
  const clockButtonLabel = homeActiveEntry ? "Clock out" : "Clock in";
  const readinessAverage = projects.length ? Math.round(projects.reduce((sum, project) => sum + (projectSnapshots[project.id]?.readiness.score ?? projectCompleteness(project)), 0) / projects.length) : 0;
  const teamSpotlight = [...users].sort((a, b) => new Date(b.lastActivityAt || b.lastSeenAt || b.updatedAt || 0).getTime() - new Date(a.lastActivityAt || a.lastSeenAt || a.updatedAt || 0).getTime()).slice(0, 4);
  const totalSetupGaps = projects.reduce((sum, project) => sum + projectSetupGaps(project).length, 0);
  const urgentAttentionCount = needsAttentionItems.filter((item) => item.severity === "critical" || item.severity === "high").length;
  const attentionHandlers: Record<AttentionItem["target"], () => void> = {
    projects: onOpenProjects,
    timeline: onOpenTimeline,
    builds: onOpenBuilds,
    scheduler: onOpenTime,
    library: onOpenLibrary,
    people: onOpenTeam,
    inbox: onOpenNotifications,
    activity: onOpenActivity,
    tickets: onOpenTickets,
    admin: onOpenAdmin,
  };
  const homeKnowledgeWorkItems = homeKnowledgeAssignments.map((assignment) => ({
    id: `knowledge:${assignment.id}`,
    title: assignment.title,
    detail: `${assignment.kind === "policy" ? "Policy" : "Packet"}${assignment.versionLabel ? ` · ${assignment.versionLabel}` : ""}`,
    value: assignment.dueAt ? formatDueDate(assignment.dueAt) : "Required",
    workTarget: {
      screen: "packets" as const,
      packetId: assignment.navigation.packetId || null,
      policyId: assignment.navigation.policyId || null,
      inspectScope: assignment.kind,
      inspectId: assignment.resourceId,
    },
  }));
  const homeKnowledgeOverdueCount = homeKnowledgeAssignments.filter((assignment) => assignment.overdue).length;
  const builtInWidgetData: BuiltInHomeWidgetData = {
    attention: needsAttentionItems.map((item) => ({ id: item.id, title: item.title, detail: item.detail, target: item.target })),
    projects: {
      total: projects.length, ready: operationalProjects.length, attention: attentionProjects.length, boards: boardCount, git: gitCount,
      recent: recentProjects.map((project) => ({ id: project.id, title: projectSnapshots[project.id]?.identity.displayName || project.name, detail: projectSnapshots[project.id]?.schedule.label || projectStatusLabel(project), value: `${projectSnapshots[project.id]?.readiness.score ?? projectCompleteness(project)}%`, workTarget: { screen: "project", projectId: project.id } })),
    },
    myWork: {
      assigned: homeAssignedCards.length + homeKnowledgeAssignments.length, overdue: homeOverdueCards.length + homeKnowledgeOverdueCount, priority: homePriorityCards.length + homeKnowledgeOverdueCount, blockers: homeRelationshipBlockers, today: homeTodayEvents.length,
      next: [...homeKnowledgeWorkItems, ...homeFocusCards.map((card): HomeWidgetListItem => {
        const project = projects.find((item) => item.name === card.projectName);
        const board = project?.boards.find((item) => item.name === card.boardName) || project?.boards[0];
        return {
          id: card.id,
          title: card.title,
          detail: `${card.projectName} · ${card.boardName}${card.relationshipSummary?.blockers ? ` · ${card.relationshipSummary.blockers} blocker${card.relationshipSummary.blockers === 1 ? "" : "s"}` : ""}`,
          value: card.dueDate ? formatDueDate(card.dueDate) : levelLabel(card.priority || "medium"),
          workTarget: {
            screen: card.isTicket ? "tickets" : "board",
            projectId: card.projectId || project?.id || null,
            boardId: card.isTicket ? null : (card.boardId || board?.id || null),
            inspectScope: card.isTicket ? "ticket" : "card",
            inspectId: card.id,
          },
        };
      })].slice(0, 8),
    },
    upcoming: [
      ...dueCards.map((card) => ({ id: `card:${card.id}`, title: card.title, detail: card.project?.name || "Due work", value: card.dueDate ? formatDueDate(card.dueDate) : undefined, workTarget: { screen: "board" as const, projectId: card.project?.id || null, boardId: card.board?.id || null, inspectScope: "card", inspectId: card.id } })),
      ...upcomingEvents.map((event) => ({ id: `event:${event.id}`, title: event.title, detail: event.project?.name || "Calendar", value: compactDateTime(event.startsAt), workTarget: { screen: "calendar" as const, projectId: event.projectId || event.project?.id || null, inspectScope: "calendar-event", inspectId: event.id } })),
    ].slice(0, 8),
    scheduler: {
      week: minutesToHuman(homeCanTime ? (timeSummary?.totalMinutes || 0) : 0), running: homeCanTime ? (timeSummary?.runningCount || 0) : 0, active: homeCanTime && Boolean(homeActiveEntry), activeDetail: homeCanTime ? (homeActiveEntry?.project?.name || homeActiveEntry?.title || "Active timer") : "",
      today: homeCanCalendar ? homeTodayEvents.map((event) => ({ id: event.id, title: event.title, detail: event.project?.name || "Calendar", value: new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), workTarget: { screen: "calendar" as const, projectId: event.projectId || event.project?.id || null, inspectScope: "calendar-event", inspectId: event.id } })) : [],
    },
    notifications: { attention: homeCanNotifications ? (homeInboxSummary?.unacknowledged ?? homeInboxSummary?.requiresAction ?? 0) : 0, urgent: homeCanNotifications ? ((homeInboxSummary?.critical || 0) + (homeInboxSummary?.high || 0)) : 0 },
    people: { total: homeCanTeam ? users.length : 0, active: homeCanTeam ? activeUsers : 0, spotlight: homeCanTeam ? teamSpotlight.map((member) => ({ id: member.id, title: member.displayName || member.username, detail: personMetaLabel(member, { localTime: true, capacity: true }) || member.title || member.workspaceRole || "Person", workTarget: { screen: "people", inspectScope: "person", inspectId: member.id } })) : [] },
    peopleCapacity: derivePeopleCapacity(homeCanTeam ? users : [], homeAssignments),
    library: {
      total: homeCanLibrary ? (librarySummary?.total || 0) : 0, pinned: homeCanLibrary ? (librarySummary?.pinned || 0) : 0,
      recent: homeCanLibrary ? (librarySummary?.recent || []).slice(0, 8).map((item) => ({ id: item.id, title: item.title, detail: `${levelLabel(item.type)} · ${levelLabel(item.status)}`, value: item.pinned ? "Pinned" : undefined, workTarget: { screen: "library", projectId: item.projectId || item.project?.id || null, inspectScope: "library-item", inspectId: item.id } })) : [],
    },
    builds: {
      total: buildArtifacts.length, testing: buildArtifacts.filter((item) => item.qaStatus === "testing" || item.qaStatus === "untested").length, failed: buildArtifacts.filter((item) => item.qaStatus === "failed" || item.approval === "blocked").length, approved: buildArtifacts.filter((item) => item.approval === "approved").length,
      items: [...buildArtifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8).map((item) => ({ id: item.id, title: item.title, detail: `${projects.find((project) => project.id === item.projectId)?.name || item.platform || "Build"} · ${item.version}`, value: item.qaStatus === "failed" ? "QA failed" : levelLabel(item.approval), workTarget: { screen: "project", projectId: item.projectId, projectTab: "builds", inspectScope: "build-artifact", inspectId: item.id } })),
    },
    timeline: timelineEntries.slice(0, 8).map((entry) => ({ id: entry.id, title: entry.title, detail: entry.project?.name || "Timeline", value: compactDateTime(entry.startsAt), workTarget: { screen: "timeline", projectId: entry.projectId || entry.project?.id || null, inspectScope: "timeline-item", inspectId: entry.id } })),
    qa: {
      total: qaPlans.length,
      open: qaPlans.filter((plan) => !["passed"].includes(plan.status)).length,
      failed: qaPlans.filter((plan) => plan.status === "failed").length,
      blocked: qaPlans.filter((plan) => plan.status === "blocked").length,
      items: [...qaPlans].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8).map((plan) => ({ id: plan.id, title: plan.title, detail: projects.find((project) => project.id === plan.projectId)?.name || plan.platform || "QA plan", value: levelLabel(plan.status), workTarget: { screen: "project", projectId: plan.projectId, projectTab: "qa", inspectScope: "qa-plan", inspectId: plan.id } })),
    },
    sourceControl: deriveSourceControl(homeSourceControl.repositories),
    reviewQueue: deriveReviewQueue(homeSourceControl.reviews),
    tickets: {
      total: homeTickets.length,
      open: homeTickets.filter(isOpenHomeTicket).length,
      priority: homeTickets.filter(isPriorityHomeTicket).length,
      items: homeTickets.filter(isOpenHomeTicket).slice(0, 8).map((ticket) => ({ id: ticket.id, title: ticket.title, detail: `${ticket.projectName} · ${ticket.listTitle}`, value: levelLabel(ticket.priority || "medium"), projectId: ticket.projectId, userId: ticket.assigneeId || null, at: ticket.updatedAt || null, workTarget: { screen: "tickets", projectId: ticket.projectId, inspectScope: "ticket", inspectId: ticket.id } })),
    },
    activity: recentActivity.map((event) => ({
      id: event.id,
      title: event.message || event.title,
      detail: event.user?.displayName || event.user?.username || "System",
      value: formatRelativeTime(event.createdAt),
      workTarget: notificationWorkNavigation({
        category: "activity",
        projectId: event.project?.id || null,
        boardId: event.board?.id || null,
        cardId: event.card?.id || null,
        entityType: event.entityType,
        entityId: event.entityId || null,
        resource: null,
        metadata: event.metadata || {},
      }),
    })),
    admin: { setupGaps: totalSetupGaps, maintenance: needsAttentionItems.filter((item) => item.source === "maintenance").length, corrections: homeCorrectionRequests.length, breakEntries: homeBreakLedger.length },
  };
  const builtInWidgetActions: BuiltInHomeWidgetActions = { projects: onOpenProjects, myWork: onOpenMyWork, scheduler: onOpenTime, notifications: onOpenNotifications, people: onOpenTeam, library: onOpenLibrary, builds: onOpenBuilds, qa: onOpenQA, timeline: onOpenTimeline, tickets: onOpenTickets, activity: onOpenActivity, admin: onOpenAdmin, quickCreate: (mode) => openSharedCreate(mode), work: (target) => { openClusterWorkNavigation(target); } };
  const homeWidgetRuntimeContext: HomeWidgetRuntimeContext = { currentUserId: currentUser.id, currentRoleId: currentUser.workspaceRole || currentUser.title || null, currentProjectId: resumeContext?.projectId || null };
  function homeStatusFromSources(sources: HomeRemoteSource[]): HomeWidgetRuntimeStatus | undefined {
    const uniqueSources = Array.from(new Set(sources.filter(homeSourceAllowed)));
    if (!uniqueSources.length) return undefined;
    const failed = uniqueSources.find((source) => homeRemoteState[source].state === "error");
    if (failed) return { state: "error", error: homeRemoteState[failed].error, onRetry: () => retryHomeRemote(failed) };
    const loadingSource = uniqueSources.find((source) => homeRemoteState[source].state === "loading");
    if (loadingSource) return { state: "loading" };
    return { state: "ready" };
  }
  function builtInHomeWidgetStatus(id: string): HomeWidgetRuntimeStatus | undefined {
    if (id === "roleFocus") return homeStatusFromSources(["assignments", "requiredKnowledge", "calendar"]);
    if (id === "upcoming") return homeStatusFromSources(["calendar"]);
    if (id === "scheduler") return homeStatusFromSources(["time"]);
    if (id === "people" || id === "peopleCapacity") return homeStatusFromSources(["people", "assignments"]);
    if (id === "timeline") return homeStatusFromSources(["timeline"]);
    if (id === "activity") return homeStatusFromSources(["activity"]);
    if (id === "tickets") return homeStatusFromSources(["tickets"]);
    if (id === "inbox") return homeStatusFromSources(["inbox"]);
    if (id === "library") return homeStatusFromSources(["library"]);
    if (id === "sourceControl" || id === "reviewQueue") return homeSourceControl.status;
    return undefined;
  }
  function canUseBuiltInHomeWidget(id: string) {
    if (id === "projects") return homeCanProjects;
    if (id === "library") return homeCanLibrary;
    if (id === "roleFocus") return homeCanMyWork;
    if (id === "upcoming") return homeCanMyWork && homeCanCalendar;
    if (id === "scheduler") return homeCanTime;
    if (id === "inbox") return homeCanNotifications;
    if (id === "people" || id === "peopleCapacity") return homeCanTeam;
    if (id === "activity") return homeCanActivity;
    if (id === "builds") return homeCanBuilds;
    if (id === "sourceControl" || id === "reviewQueue") return homeCanSourceControl;
    if (id === "qa") return homeCanQa;
    if (id === "timeline") return homeCanTimeline;
    if (id === "tickets") return homeCanTickets;
    return true;
  }
  const availableHomeWidgetIds = useMemo(() => new Set<string>(DASHBOARD_WIDGETS
    .filter((definition) => canUseBuiltInHomeWidget(definition.key) && (!definition.adminOnly || isAdmin) && dashboardWidgets.canAdd(definition.key))
    .map((definition) => definition.key)), [isAdmin, homeCanProjects, homeCanLibrary, homeCanMyWork, homeCanCalendar, homeCanTime, homeCanNotifications, homeCanTeam, homeCanActivity, homeCanBuilds, homeCanSourceControl, homeCanQa, homeCanTimeline, homeCanTickets, dashboardWidgets.governance]);
  const kioskWidgetSet = new Set(kioskHomeState.widgetIds);
  const kioskFiltered = kioskHomeState.active && kioskWidgetSet.size > 0;
  const homeVisible = useMemo(() => {
    const visible = dashboardWidgets.layout.items.filter((placement) => availableHomeWidgetIds.has(placement.id) && (!kioskFiltered || kioskWidgetSet.has(placement.id)));
    // A kiosk shows a subset; close the gaps the rest would leave.
    return kioskFiltered ? packGrid(visible) : visible;
  }, [dashboardWidgets.layout, availableHomeWidgetIds, kioskFiltered, kioskHomeState.widgetIds.join("|")]);
  const homeHidden = dashboardWidgets.layout.items.filter((placement) => !homeVisible.some((item) => item.id === placement.id));
  const homeCanEdit = !kioskHomeState.active && !kioskHomeState.readOnly;
  const editing = homeEditMode && homeCanEdit;
  function commitHomeLayout(items: HomeWidgetPlacement[]) {
    dashboardWidgets.commit([...items, ...homeHidden]);
  }
  function openAttentionTarget(target?: string) {
    if (!target) return;
    const handler = attentionHandlers[target as keyof typeof attentionHandlers];
    if (handler) handler();
  }
  const optionsPlacement = homeOptionsId ? dashboardWidgets.layout.items.find((item) => item.id === homeOptionsId) || null : null;
  return (
    <section className="page dashboard-page home-page" data-editing={editing ? "true" : "false"}>
      <ToolPageHeader
        title="Home"
        metrics={editing ? [] : [
          { label: "need attention", value: urgentAttentionCount, tone: urgentAttentionCount ? "warning" : "good" },
          { label: "ready", value: `${readinessAverage}%`, tone: readinessAverage >= 75 ? "good" : readinessAverage >= 45 ? "warning" : "danger" },
          { label: "online", value: `${activeUsers}/${users.length || 0}` },
          // Only while clocked in: the Clock in button already says when you are not.
          ...(homeActiveEntry ? [{ label: "on the clock", value: minutesToHuman(activeClockMinutes), tone: "good" as const }] : []),
        ]}
        actions={editing ? (
          <>
            <ClusterButton type="button" variant="quiet" onClick={() => void confirmCluster({ title: "Reset Home?", message: "Home goes back to the Studio default widgets and layout.", confirmLabel: "Reset", tone: "danger" }).then((ok) => { if (ok) dashboardWidgets.reset(); })}>Reset</ClusterButton>
            <ClusterButton type="button" variant="quiet" className="home-arrange" onClick={dashboardWidgets.pack}>Auto-arrange</ClusterButton>
            <HomeWidgetGallery available={availableHomeWidgetIds} placed={new Set(dashboardWidgets.layout.items.map((item) => item.id))} onAdd={dashboardWidgets.add} />
            <ClusterButton type="button" variant="primary" onClick={() => setHomeEditMode(false)}>Done</ClusterButton>
          </>
        ) : (
          <>
            {homeCanEdit && <ClusterButton type="button" variant="secondary" onClick={() => setHomeEditMode(true)}>Edit</ClusterButton>}
            {!kioskHomeState.readOnly && <ClusterButton type="button" variant={homeActiveEntry ? "danger" : "primary"} onClick={openHomeClockModal} disabled={clockBusy} data-cluster-kiosk-write-action="true">
              {clockButtonLabel}
            </ClusterButton>}
          </>
        )}
      />

      {clockStatus && <p className="home-clock-status">{clockStatus}</p>}
      <ClockIntentModal open={clockModalOpen} mode={homeActiveEntry ? "out" : "in"} active={homeActiveEntry} projects={projects} title={clockTitle} onTitleChange={setClockTitle} projectIds={clockProjectIds} onProjectIdsChange={setClockProjectIds} busy={clockBusy} onCancel={() => setClockModalOpen(false)} onConfirm={confirmHomeClock} />
      <HomeWidgetOptions
        placement={optionsPlacement}
        onClose={() => setHomeOptionsId(null)}
        onSave={(id, config) => dashboardWidgets.configure(id, { clockFormat: undefined, noteTitle: undefined, context: undefined, contextId: undefined, timeRange: undefined, filterText: undefined, ...config })}
        projects={projects.map((project) => ({ id: project.id, label: project.name }))}
        users={users.map((user) => ({ id: user.id, label: user.displayName || user.username }))}
        roles={(settings.studioRoleDefinitions || []).filter((role) => role.enabled !== false).map((role) => ({ id: role.id, label: role.label || role.id }))}
      />

      {homeVisible.length ? <HomeWidgetGrid
        items={homeVisible}
        editMode={editing}
        onCommit={commitHomeLayout}
        onRemove={dashboardWidgets.remove}
        onOptions={setHomeOptionsId}
        canRemove={dashboardWidgets.canRemove}
        renderWidget={(placement) => <BuiltInHomeWidget id={placement.id} size={placement.size} config={placement.config} runtimeContext={homeWidgetRuntimeContext} status={builtInHomeWidgetStatus(placement.id)} data={builtInWidgetData} actions={builtInWidgetActions} note={homeNote} onNoteChange={setHomeNote} onAttentionAction={openAttentionTarget} onSnooze={snoozeSignal} onDismiss={dismissSignal} onClock={openHomeClockModal} />}
      /> : <div className="home-empty">
        <strong>Nothing on Home</strong>
        {homeCanEdit && <span><ClusterButton variant="secondary" size="compact" onClick={() => setHomeEditMode(true)}>Add widgets</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={dashboardWidgets.reset}>Restore default</ClusterButton></span>}
      </div>}
    </section>
  );
}

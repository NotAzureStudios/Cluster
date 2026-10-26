import "../styles/home-dashboard.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { api, queryApi, setApiQueryData } from "../../../core/api";
import { useVisibleTicker } from "../../../core/visible-ticker";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { useProjectDeliveryList } from "../../../core/project-delivery-storage";
import { pruneSignalPreferences, signalIsVisible, type SmartSignalPreferences, type SmartWorkspaceContext } from "../../../core/smart-interface";
import { canUseTool } from "../../../core/permissions";
import { useServerState } from "../../../core/server-state";
import { addDays, compactDateTime, minutesToHuman, weekStart } from "../../../core/date-time";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../../core/format";
import { importantBuildEntries, isExternalProject, isVideoProject, projectAssignedIds, projectBoardCount, projectCompleteness, projectGitCount, projectHasDiscord, projectHealth, projectLatestTimestamp, projectSetupGaps, projectStatusLabel, projectWhiteboardCount } from "../../projects/projects-utils";
import { activeLabel } from "../../people/people-utils";
import { personMetaLabel } from "../../people/person-summary";
import { notificationWorkNavigation } from "../../notifications/notification-navigation";
import { openClusterWorkNavigation } from "../../workflow/work-navigation";
import { CLUSTER_PERSON_CHANGED_EVENT, CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, type ClusterPersonSummary, type ClusterAssignmentChange, type NotificationItem, type NotificationSummary } from "@cluster/shared";
import { subscribeClusterCohesionEvent } from "../../../core/cohesion-events";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterSelect } from "../../../components/ClusterSelect";
import { ToolPageHeader } from "../../../components/ToolPageHeader";
import { requestSecurityPin, requestSecurityPinSetup } from "../../../core/security-pin";
import type { User, Project, ProjectSnapshot, Settings, LibrarySummary, TimelinePayload, UpcomingPayload, TimeEntry, TimeSummary, ActivityEvent, UserActivitySummary, WorkLinkRecord, RecurringWorkRecord, WatcherRecord, ProjectCloseoutRecord, ExternalPortalRule, AttentionItem, AttachmentRecord, TimeCorrectionRequest, ShiftRuleSettings, BreakLedgerEntry, BuildArtifactRecord, QATestPlan, ClockIntentPayload, TeamAssignment } from "../application-models";
import { readShiftRules } from "../../operations/modules/operations-admin";
import { useDashboardWidgets } from "../../home-widgets/home-dashboard-controller";

import { ProjectWorkflowAttentionState, deriveNeedsAttention } from "./application-foundation";
import { ClockIntentModal } from "./application-workspace-core";
import { HomeWidgetEditor } from "../../home-widgets/HomeWidgetEditor";
import { CLUSTER_KIOSK_POLICY_CHANGED_EVENT } from "../../desktop/use-kiosk-document-state";
import { useHomeWidgetLibrary } from "../../home-widgets/home-widget-library";
import { useHomeLayoutSharing } from "../../home-widgets/home-layout-sharing";
import { BuiltInHomeWidget, type BuiltInHomeWidgetData, type BuiltInHomeWidgetActions, type HomeWidgetListItem } from "../../home-widgets/BuiltInHomeWidget";
import { CustomHomeWidget, type CustomHomeWidgetActions, type CustomHomeWidgetRuntimeData } from "../../home-widgets/CustomHomeWidget";
import { HomeWidgetPlacement } from "../../home-widgets/HomeWidgetPlacement";
import { HomeWidgetPalette } from "../../home-widgets/HomeWidgetPalette";
import { DASHBOARD_WIDGETS, departmentAwareHomeWidgetRecommendation, homeWidgetExtensionPolicyFromSettings, homeWidgetGovernanceFromCsv, type HomeWidgetPermission, type HomeWidgetPreset, type HomeWidgetRuntimeStatus } from "../../home-widgets/home-widget-model";
import { deriveHandoff, deriveIntegrationHealth, derivePeopleCapacity, deriveReleaseReadiness, deriveReviewQueue, deriveSavedViews, deriveSourceControl, deriveToday, deriveWatchlist } from "../../home-widgets/home-widget-phase7-data";
import { useHomeDeliveryLifecycleSummaries } from "../../home-widgets/use-home-delivery-lifecycle";
import { useWidget2CatalogInsights } from "../../home-widgets/use-widget2-catalog-insights";
import { isOpenHomeTicket, isPriorityHomeTicket } from "../../home-widgets/home-ticket-policy";
import { createHomeRequestAuthority } from "../../home-widgets/home-request-authority";
import { openSharedCreate } from "../../create/shared-create-handoff";
import { buildWidget21DashboardRuntimeData } from "../../home-widgets/home-widget-9l-data";
import { type HomeWidgetRuntimeContext } from "../../home-widgets/home-widget-runtime-policy";

function HomeWidgetCanvasSurface({
  editMode,
  kioskActive,
  density,
  mobileLayout,
  widgetIds,
  selectedId,
  onSelect,
  children,
}: {
  editMode: boolean;
  kioskActive: boolean;
  density: string;
  mobileLayout: string;
  widgetIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "home-widget-canvas", disabled: !editMode, data: { type: "home-widget-canvas" } });
  const canvasRef = useRef<HTMLElement | null>(null);
  const programmaticCarouselSelection = useRef(true);
  const activeIndex = Math.max(0, widgetIds.indexOf(selectedId || ""));
  const mobileNavigation = !editMode && (mobileLayout === "carousel" || mobileLayout === "focus") && widgetIds.length > 1;
  const setCanvasRef = useCallback((node: HTMLElement | null) => { canvasRef.current = node; setNodeRef(node); }, [setNodeRef]);
  useEffect(() => {
    if (mobileLayout !== "carousel" || editMode || typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches) return;
    if (!programmaticCarouselSelection.current) { programmaticCarouselSelection.current = true; return; }
    const canvas = canvasRef.current;
    const selected = canvas?.querySelector<HTMLElement>(`.home-widget-placement-v505[data-widget-id="${CSS.escape(selectedId || "")}"]`);
    if (!selected || !canvas) return;
    const destination = selected.offsetLeft + selected.offsetWidth / 2 - canvas.clientWidth / 2;
    canvas.scrollTo({ left: Math.max(0, destination), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [mobileLayout, selectedId, widgetIds.join("|"), editMode]);
  const selectOffset = (offset: number) => {
    if (!widgetIds.length) return;
    programmaticCarouselSelection.current = true;
    onSelect(widgetIds[Math.max(0, Math.min(widgetIds.length - 1, activeIndex + offset))]);
  };
  const updateCarouselPosition = () => {
    if (mobileLayout !== "carousel" || editMode || !canvasRef.current || typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches) return;
    const canvas = canvasRef.current;
    const center = canvas.scrollLeft + canvas.clientWidth / 2;
    const cards = Array.from(canvas.querySelectorAll<HTMLElement>(".home-widget-placement-v505"));
    const nearest = cards.reduce((current, card, index) => Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) < current.distance ? { index, distance: Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) } : current, { index: 0, distance: Infinity });
    const id = widgetIds[nearest.index];
    if (id && id !== selectedId) {
      // Touch scrolling owns its position. Don't scroll back to an interim card.
      programmaticCarouselSelection.current = false;
      onSelect(id);
    }
  };
  return (
    <>
    {mobileNavigation && <nav className="home-widget-mobile-nav-v547" aria-label="Home widget navigation">
      <ClusterButton variant="quiet" size="compact" disabled={activeIndex === 0} onClick={() => selectOffset(-1)} aria-label="Previous Home widget">←</ClusterButton>
      <span role="status" aria-live="polite">{activeIndex + 1} of {widgetIds.length}</span>
      <ClusterButton variant="quiet" size="compact" disabled={activeIndex === widgetIds.length - 1} onClick={() => selectOffset(1)} aria-label="Next Home widget">→</ClusterButton>
    </nav>}
    <section
      ref={setCanvasRef}
      className="home-widget-canvas-v484"
      data-kiosk-home={kioskActive ? "true" : "false"}
      data-density={density}
      data-edit-mode={editMode ? "true" : "false"}
      data-canvas-drop={editMode && isOver ? "true" : "false"}
      data-mobile-layout={mobileLayout}
      aria-label="Home widgets"
      tabIndex={mobileNavigation ? 0 : undefined}
      onScroll={mobileLayout === "carousel" && !editMode ? updateCarouselPosition : undefined}
      onKeyDown={(event) => {
        if (!mobileNavigation || event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft") { event.preventDefault(); selectOffset(-1); }
        if (event.key === "ArrowRight") { event.preventDefault(); selectOffset(1); }
      }}
    >
      {children}
    </section>
    </>
  );
}

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
  const whiteboardCount = projectWhiteboardCount(projects);
  const gitCount = projectGitCount(projects);
  const discordCount = projects.filter(projectHasDiscord).length;
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
    queryApi<{ snapshots: ProjectSnapshot[] }>(`/api/projects/snapshots?ids=${encodeURIComponent(ids.join(","))}`, { staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["home", "projects", "project-snapshot"] })
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
  const homeWidgetExtensionPolicy = homeWidgetExtensionPolicyFromSettings(settings.studioCustomWidgetPolicy, settings.studioCustomWidgetAllowedPermissionsCsv, settings.studioCustomWidgetBlockedIdsCsv);
  const homeRoleLabel = homeRoleDefinition?.label || levelLabel(homeRoleId);
  const homeDepartmentLabel = settings.studioDepartmentDefinitions?.find((department) => department.id === homeDepartmentId)?.label || (homeDepartmentId ? levelLabel(homeDepartmentId) : "Studio");
  const homeRecommendationLabel = homeRecommendation.source === "role" ? homeRoleLabel : homeRecommendation.source === "department" ? homeDepartmentLabel : "Studio";
  const dashboardWidgets = useDashboardWidgets(homeWidgetGovernance);
  const homeCanMyWork = canUseTool(currentUser, "mywork");
  const homeCanProjects = canUseTool(currentUser, "projects");
  const homeCanBoards = canUseTool(currentUser, "boards");
  const homeCanWhiteboards = canUseTool(currentUser, "whiteboards");
  const homeCanPackets = canUseTool(currentUser, "packets");
  const homeCanServerConfig = canUseTool(currentUser, "serverConfig");
  const homeCanTime = settings.schedulerEnabled !== false && canUseTool(currentUser, "scheduler");
  const homeCanNotifications = canUseTool(currentUser, "inbox");
  const homeCanTeam = canUseTool(currentUser, "people");
  const homeCanActivity = canUseTool(currentUser, "activity");
  const homeCanBuilds = canUseTool(currentUser, "builds");
  const homeCanQa = canUseTool(currentUser, "qa");
  const homeCanTimeline = settings.timelineEnabled !== false && canUseTool(currentUser, "timeline");
  const homeCanTickets = settings.ticketsEnabled !== false && canUseTool(currentUser, "tickets");
  const homeCanSourceControl = canUseTool(currentUser, "sourceControl");
  const homeCanIntegrations = isAdmin && canUseTool(currentUser, "integrations");
  const homeCanCalendar = settings.calendarEnabled !== false && canUseTool(currentUser, "calendar");
  const homeCanLibrary = settings.libraryEnabled !== false && canUseTool(currentUser, "library");
  const [homeEditorOpen, setHomeEditorOpen] = useState(false);
  const [homeEditorFocusId, setHomeEditorFocusId] = useState<string | null>(null);
  const [homeEditMode, setHomeEditMode] = useState(false);
  const [homePaletteCollapsed, setHomePaletteCollapsed] = useState(false);
  const [homeMobileLayout, setHomeMobileLayout] = useState(settings.userHomeMobileLayout || "stack");
  const [mobileHomeSelectedId, setMobileHomeSelectedId] = useState<string | null>(null);
  const [homeDensity, setHomeDensity] = useState<"compact" | "balanced" | "expanded">((settings.userDashboardDensity as "compact" | "balanced" | "expanded") || "balanced");
  useEffect(() => setHomeMobileLayout(settings.userHomeMobileLayout || "stack"), [settings.userHomeMobileLayout]);
  useEffect(() => setHomeDensity((settings.userDashboardDensity as "compact" | "balanced" | "expanded") || "balanced"), [settings.userDashboardDensity]);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [homeGridColumns, setHomeGridColumns] = useState(() => typeof window === "undefined" ? 12 : window.innerWidth >= 2200 ? 20 : window.innerWidth >= 1600 ? 16 : window.innerWidth <= 760 ? 2 : 12);
  useEffect(() => {
    const syncGridColumns = () => setHomeGridColumns(window.innerWidth >= 2200 ? 20 : window.innerWidth >= 1600 ? 16 : window.innerWidth <= 760 ? 2 : 12);
    window.addEventListener("resize", syncGridColumns);
    syncGridColumns();
    return () => window.removeEventListener("resize", syncGridColumns);
  }, []);
  const homeWidgetSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
    return dashboardWidgets.orderedEnabled.filter((placement) => !kioskHomeState.active || !kioskIds.size || kioskIds.has(placement.id));
  }, [dashboardWidgets.orderedEnabled, kioskHomeState.active, kioskHomeState.widgetIds.join("|")]);
  const enabledHomeWidgetIds = useMemo(() => new Set(enabledHomeWidgets.map((placement) => placement.id)), [enabledHomeWidgets]);
  const enabledHomeWidgetSignature = useMemo(() => enabledHomeWidgets.map((placement) => `${placement.id}:${placement.size}:${placement.enabled ? 1 : 0}`).join("|"), [enabledHomeWidgets]);
  const hasEnabledCustomHomeWidget = enabledHomeWidgets.some((placement) => placement.source === "custom");
  const homeWidgetUses = (...ids: string[]) => hasEnabledCustomHomeWidget || ids.some((id) => enabledHomeWidgetIds.has(id));
  const homeNeedsLibrary = homeWidgetUses("library", "libraryActivity", "pulse", "brief");
  const homeNeedsRequiredKnowledge = homeWidgetUses("roleFocus", "myWork", "today", "brief");
  const homeNeedsTime = homeWidgetUses("scheduler", "pulse", "today", "brief");
  const homeNeedsCalendar = homeWidgetUses("roleFocus", "upcoming", "scheduler", "today", "pulse", "brief");
  const homeNeedsTimeline = homeWidgetUses("timeline", "brief");
  const homeNeedsPeople = homeWidgetUses("people", "peopleCapacity", "departments", "pulse", "brief");
  const homeNeedsActivity = homeWidgetUses("activity", "digest", "handoff", "brief");
  const homeNeedsAssignments = homeWidgetUses("roleFocus", "myWork", "today", "peopleCapacity", "handoff", "brief");
  const homeNeedsTeamWideAssignments = homeWidgetUses("peopleCapacity", "brief");
  const homeNeedsTickets = homeWidgetUses("tickets", "deliveryAttention", "needs", "brief");
  const homeNeedsInbox = homeWidgetUses("inbox", "needs", "brief");
  const homeNeedsBuilds = homeWidgetUses("builds", "releaseReadiness", "brief");
  const homeNeedsQa = homeWidgetUses("qa", "releaseReadiness", "brief");
  const homeNeedsSourceControl = homeWidgetUses("sourceControl", "reviewQueue", "brief");
  const homeNeedsIntegrations = homeWidgetUses("integrationHealth", "brief");
  const homeNeedsSavedViews = homeWidgetUses("savedViews") || homeEditMode || homeEditorOpen || enabledHomeWidgets.some((placement) => Boolean(placement.config?.savedViewId));
  const homeNeedsProjectWorkflow = homeWidgetUses("control", "workflow", "closeout", "attachments", "watchlists", "projects", "readiness", "brief");
  const widget2Catalog = useWidget2CatalogInsights(homeCanSourceControl && homeNeedsSourceControl, homeCanIntegrations && homeNeedsIntegrations, homeNeedsSavedViews, currentUser.id);
  const [homeNote, setHomeNote] = useServerState<string>("user", "dashboard.note", "");
  const homeWidgetLibrary = useHomeWidgetLibrary(homeWidgetExtensionPolicy);
  const homeLayoutSharing = useHomeLayoutSharing(Boolean(currentUser.id));
  const customWidgetSignature = homeWidgetLibrary.allManifests.map((item) => `${item.id}@${item.version}`).sort().join("|");
  useEffect(() => {
    if (!homeWidgetLibrary.desktop || homeWidgetLibrary.status) dashboardWidgets.syncCustom(homeWidgetLibrary.allManifests);
  }, [customWidgetSignature, homeWidgetLibrary.desktop, homeWidgetLibrary.status]);
  const workflowProjectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const projectWorkflowIds = homeCanProjects && homeNeedsProjectWorkflow ? workflowProjectIds : [];
  const [qaPlans] = useProjectDeliveryList<QATestPlan>("qa-plan", homeCanQa && homeNeedsQa ? workflowProjectIds : []);
  const [buildArtifacts] = useProjectDeliveryList<BuildArtifactRecord>("build", homeCanBuilds && homeNeedsBuilds ? workflowProjectIds : []);
  const homeDeliveryLifecycles = useHomeDeliveryLifecycleSummaries(workflowProjectIds, homeCanBuilds && (homeNeedsBuilds || homeNeedsQa), currentUser.id);
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
    return loadHomeSource("library", () => queryApi<LibrarySummary>("/api/library/summary", { staleMs: 30_000, maxAgeMs: 15 * 60_000, force, tags: ["library", "home"] }), setLibrarySummary, quiet);
  }
  function loadRequiredKnowledge(quiet = false, force = false) {
    return loadHomeSource("requiredKnowledge", () => queryApi<{ assignments: HomeKnowledgeAssignment[] }>("/api/my-knowledge", { staleMs: 10_000, maxAgeMs: 2 * 60_000, force, tags: ["work", "packets", "studio-systems", "home"] }), (result) => setHomeKnowledgeAssignments(result.assignments || []), quiet);
  }
  function loadHomeTime(quiet = false, force = false) {
    return loadHomeSource("time", async () => {
      const start = weekStart();
      const end = addDays(start, 7);
      return Promise.all([
        queryApi<TimeSummary>(`/api/time/summary?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&userId=${encodeURIComponent(currentUser.id)}`, { staleMs: 10_000, maxAgeMs: 2 * 60_000, force, tags: ["time", "home"] }),
        queryApi<{ active: TimeEntry | null }>("/api/time/active", { staleMs: 5_000, maxAgeMs: 60_000, force, tags: ["time", "clock", "workday"] }),
      ]);
    }, ([summary, active]) => { setTimeSummary(summary); setHomeActiveEntry(active.active); setClockTick(Date.now()); }, quiet, true);
  }
  function loadHomeCalendar(quiet = false, force = false) {
    return loadHomeSource("calendar", () => queryApi<UpcomingPayload>("/api/calendar/upcoming", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force, tags: ["calendar"] }), setUpcoming, quiet);
  }
  function loadHomeTimeline(quiet = false, force = false) {
    return loadHomeSource("timeline", () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = addDays(start, 180);
      return queryApi<TimelinePayload>(`/api/timeline?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, { staleMs: 30_000, maxAgeMs: 10 * 60_000, force, tags: ["timeline", "home"] });
    }, setTimeline, quiet);
  }
  function loadHomePeople(quiet = false, force = false) {
    return loadHomeSource("people", () => queryApi<UserActivitySummary[]>("/api/users", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force, tags: ["users", "people"] }), setUsers, quiet);
  }
  function loadHomeActivity(quiet = false, force = false) {
    return loadHomeSource("activity", () => queryApi<ActivityEvent[]>("/api/activity?limit=100", { staleMs: 10_000, maxAgeMs: 2 * 60_000, force, tags: ["activity"] }), setActivity, quiet);
  }
  function loadHomeAssignments(quiet = false, force = false) {
    return loadHomeSource("assignments", () => queryApi<TeamAssignment[]>(`/api/team/assignments?scope=${homeNeedsTeamWideAssignments ? "team" : "mine"}`, { staleMs: 10_000, maxAgeMs: 2 * 60_000, force, tags: ["work"] }), setHomeAssignments, quiet);
  }
  function loadHomeInbox(quiet = false, force = false) {
    return loadHomeSource("inbox", () => queryApi<{ ok: true; summary: NotificationSummary }>("/api/notifications/summary", { staleMs: 5_000, maxAgeMs: 60_000, force, tags: ["inbox", "notifications", "home"] }), (result) => setHomeInboxSummary(result.summary), quiet);
  }
  function loadHomeTickets(quiet = false, force = false) {
    return loadHomeSource("tickets", () => queryApi<{ items: HomeTicketSummary[] }>("/api/tickets/assigned-summary?limit=40", { staleMs: 15_000, maxAgeMs: 5 * 60_000, force, tags: ["tickets", "work", "home"] }), (result) => setHomeTickets(result.items || []), quiet);
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
    homeRefreshTimerRef.current = window.setTimeout(runScheduledHomeRefresh, 160);
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
  }, [setLastSeenAt, currentUser.id, homeCanLibrary, homeCanTime, homeCanCalendar, homeCanTimeline, homeCanTeam, homeCanActivity, homeCanMyWork, homeCanTickets, homeCanNotifications, homeCanIntegrations, enabledHomeWidgetSignature]);
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
  const sinceLastVisit = activity.filter((event) => new Date(event.createdAt).getTime() > new Date(lastSeenAt).getTime());
  const digestCounts = sinceLastVisit.reduce<Record<string, number>>((acc, event) => {
    acc[event.entityType || event.type] = (acc[event.entityType || event.type] || 0) + 1;
    return acc;
  }, {});
  const digestTop = (Object.entries(digestCounts) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
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
  const topProjectTime = timeSummary?.byProject?.[0];
  const activeClockMinutes = homeActiveEntry ? Math.max(homeActiveEntry.computedDurationMinutes || 0, Math.round((clockTick - new Date(homeActiveEntry.startedAt).getTime()) / 60000)) : 0;
  const clockButtonLabel = homeActiveEntry ? "Clock out" : "Clock in";
  const readinessAverage = projects.length ? Math.round(projects.reduce((sum, project) => sum + (projectSnapshots[project.id]?.readiness.score ?? projectCompleteness(project)), 0) / projects.length) : 0;
  const teamSpotlight = [...users].sort((a, b) => new Date(b.lastActivityAt || b.lastSeenAt || b.updatedAt || 0).getTime() - new Date(a.lastActivityAt || a.lastSeenAt || a.updatedAt || 0).getTime()).slice(0, 4);
  const departmentSummary = Array.from(users.reduce((map, member) => {
    const label = String(member.department || "Unassigned").trim() || "Unassigned";
    const entry = map.get(label) || { total: 0, active: 0 };
    entry.total += 1;
    if (activeLabel(member.lastSeenAt, member.lastActivityAt) !== "Offline") entry.active += 1;
    map.set(label, entry);
    return map;
  }, new Map<string, { total: number; active: number }>()).entries()).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  const videoProjectCount = projects.filter(isVideoProject).length;
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
      total: projects.length, ready: operationalProjects.length, attention: attentionProjects.length, boards: boardCount, whiteboards: whiteboardCount, git: gitCount, discord: discordCount,
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
    today: deriveToday(homeCanCalendar ? homeTodayEvents : [], homeFocusCards, dueCards.length + homeKnowledgeAssignments.length, homeRelationshipBlockers, homePriorityCards.length + homeKnowledgeOverdueCount, homeKnowledgeWorkItems),
    notifications: { attention: homeCanNotifications ? (homeInboxSummary?.unacknowledged ?? homeInboxSummary?.requiresAction ?? 0) : 0, urgent: homeCanNotifications ? ((homeInboxSummary?.critical || 0) + (homeInboxSummary?.high || 0)) : 0 },
    people: { total: homeCanTeam ? users.length : 0, active: homeCanTeam ? activeUsers : 0, spotlight: homeCanTeam ? teamSpotlight.map((member) => ({ id: member.id, title: member.displayName || member.username, detail: personMetaLabel(member, { localTime: true, capacity: true }) || member.title || member.workspaceRole || "Person", workTarget: { screen: "people", inspectScope: "person", inspectId: member.id } })) : [] },
    peopleCapacity: derivePeopleCapacity(homeCanTeam ? users : [], homeAssignments),
    departments: { total: departmentSummary.length, staffed: departmentSummary.filter(([, value]) => value.total > 0).length, active: departmentSummary.reduce((sum, [, value]) => sum + value.active, 0), items: departmentSummary.slice(0, 8).map(([label, value]) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: label, detail: `${value.total} member${value.total === 1 ? "" : "s"}`, value: `${value.active} active` })) },
    library: {
      total: homeCanLibrary ? (librarySummary?.total || 0) : 0, pinned: homeCanLibrary ? (librarySummary?.pinned || 0) : 0,
      recent: homeCanLibrary ? (librarySummary?.recent || []).slice(0, 8).map((item) => ({ id: item.id, title: item.title, detail: `${levelLabel(item.type)} · ${levelLabel(item.status)}`, value: item.pinned ? "Pinned" : undefined, workTarget: { screen: "library", projectId: item.projectId || item.project?.id || null, inspectScope: "library-item", inspectId: item.id } })) : [],
      topTypes: homeCanLibrary ? Object.entries(librarySummary?.byType || {}).map(([label, value]) => ({ label, value: Number(value) || 0 })).sort((a, b) => b.value - a.value).slice(0, 3).map(({ label, value }) => ({ label: levelLabel(label), value })) : [],
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
    releaseReadiness: deriveReleaseReadiness(homeCanBuilds ? homeDeliveryLifecycles : [], projects),
    sourceControl: deriveSourceControl(widget2Catalog.repositories),
    reviewQueue: deriveReviewQueue(widget2Catalog.reviews),
    integrationHealth: deriveIntegrationHealth(widget2Catalog.providers),
    savedViews: deriveSavedViews(widget2Catalog.savedViews),
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
    digest: digestTop.map(([kind, count]) => ({ id: kind, title: levelLabel(kind), detail: "Since last open", value: count })),
    workflow: { links: workflowLinks.length, recurring: recurringWork.length, watchers: workflowWatchers.length, closeouts: projectWorkflowAttention.closeouts?.length || 0, portals: projectWorkflowAttention.portalRules?.length || 0, attachments: homeAttachments.length },
    watchlists: deriveWatchlist(workflowWatchers, currentUser.id),
    handoff: deriveHandoff(recentActivity, homeFocusCards, needsAttentionItems.length),
    admin: { setupGaps: totalSetupGaps, maintenance: needsAttentionItems.filter((item) => item.source === "maintenance").length, corrections: homeCorrectionRequests.length, breakEntries: homeBreakLedger.length },
    ticketAttention: { signals: needsAttentionItems.filter((item) => item.target === "tickets").length, projectAttention: attentionProjects.length },
  };
  const builtInWidgetActions: BuiltInHomeWidgetActions = { projects: onOpenProjects, project: onOpenProject, board: onOpenBoard, myWork: onOpenMyWork, scheduler: onOpenTime, notifications: onOpenNotifications, people: onOpenTeam, library: onOpenLibrary, builds: onOpenBuilds, qa: onOpenQA, timeline: onOpenTimeline, tickets: onOpenTickets, activity: onOpenActivity, admin: onOpenAdmin, integrations: onOpenIntegrations, sourceControl: onOpenProjects, quickCreate: (mode) => openSharedCreate(mode), work: (target) => { openClusterWorkNavigation(target); } };
  const customWidgetData: CustomHomeWidgetRuntimeData = buildWidget21DashboardRuntimeData({
    projects, boardCount, whiteboardCount, assignedCards: homeAssignedCards, people: users,
    activePeopleIds: new Set(users.filter((member) => activeLabel(member.lastSeenAt, member.lastActivityAt) !== "Offline").map((member) => member.id)),
    knowledgeAssignments: homeKnowledgeAssignments, recurring: recurringWork, repositories: widget2Catalog.repositories, reviews: widget2Catalog.reviews,
    attentionItems: needsAttentionItems, builtIn: builtInWidgetData, weekMinutes: timeSummary?.totalMinutes || 0, runningTimers: timeSummary?.runningCount || 0,
  });
  const homeWidgetRuntimeContext: HomeWidgetRuntimeContext = { currentUserId: currentUser.id, currentRoleId: currentUser.workspaceRole || currentUser.title || null, currentProjectId: resumeContext?.projectId || null, savedViews: widget2Catalog.savedViews.map((view) => ({ id: view.id, values: view.values })) };
  const customWidgetActions: CustomHomeWidgetActions = { projects: onOpenProjects, boards: onOpenProjects, whiteboards: onOpenProjects, mywork: onOpenMyWork, calendar: onOpenTimeline, packets: onOpenLibrary, sourceControl: onOpenProjects, operations: onOpenAdmin };
  function updateHomeMobileLayout(next: typeof homeMobileLayout) {
    setHomeMobileLayout(next);
    void api("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ preferences: { userHomeMobileLayout: next } }) }).catch(() => setHomeMobileLayout(settings.userHomeMobileLayout || "stack"));
  }
  function updateHomeDensity(next: "compact" | "balanced" | "expanded") {
    setHomeDensity(next);
    void api("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ preferences: { userDashboardDensity: next } }) }).catch(() => setHomeDensity((settings.userDashboardDensity as "compact" | "balanced" | "expanded") || "balanced"));
  }
  function canUseHomeWidgetPermission(permission: HomeWidgetPermission) {
    if (permission === "projects.read") return homeCanProjects;
    if (permission === "scheduler.read") return homeCanTime;
    if (permission === "activity.read") return homeCanActivity;
    if (permission === "inbox.read") return homeCanNotifications;
    if (permission === "people.read") return homeCanTeam;
    if (permission === "builds.read") return homeCanBuilds;
    if (permission === "qa.read") return homeCanQa;
    if (permission === "tickets.read") return homeCanTickets;
    if (permission === "calendar.read") return homeCanCalendar;
    if (permission === "boards.read") return homeCanBoards;
    if (permission === "whiteboards.read") return homeCanWhiteboards;
    if (permission === "packets.read") return homeCanPackets;
    if (permission === "sourceControl.read") return homeCanSourceControl;
    if (permission === "integrations.read") return homeCanIntegrations;
    if (permission === "serverConfig.read") return homeCanServerConfig || isAdmin;
    if (permission === "viewer.read") return homeCanLibrary;
    return homeCanLibrary;
  }
  const authorizedHomeManifests = homeWidgetLibrary.manifests.filter((manifest) => (manifest.permissions || []).every(canUseHomeWidgetPermission));
  const customManifestMap = new Map(authorizedHomeManifests.map((manifest) => [manifest.id, manifest]));
  const homeWidgetDefinitions = new Map<string, (typeof DASHBOARD_WIDGETS)[number]>(DASHBOARD_WIDGETS.map((definition) => [definition.key, definition]));
  const requestedStudioPreset = settings.studioHomeDefaultPreset || "balanced";
  const studioHomeDefaultPreset: HomeWidgetPreset = (["balanced", "quiet", "core-tools", "everything"] as HomeWidgetPreset[]).includes(requestedStudioPreset as HomeWidgetPreset) ? requestedStudioPreset as HomeWidgetPreset : "balanced";
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
    if (["roleFocus", "myWork", "today"].includes(id)) return homeStatusFromSources(["assignments", "requiredKnowledge", "calendar"]);
    if (id === "upcoming") return homeStatusFromSources(["calendar"]);
    if (["scheduler", "pulse"].includes(id)) return homeStatusFromSources(["time"]);
    if (["people", "peopleCapacity", "departments"].includes(id)) return homeStatusFromSources(["people", "assignments"]);
    if (id === "timeline") return homeStatusFromSources(["timeline"]);
    if (["activity", "digest", "handoff"].includes(id)) return homeStatusFromSources(["activity", "assignments"]);
    if (id === "tickets") return homeStatusFromSources(["tickets"]);
    if (["library", "libraryActivity"].includes(id)) return homeStatusFromSources(["library"]);
    if (["sourceControl", "reviewQueue"].includes(id)) return widget2Catalog.sourceControlStatus;
    if (id === "integrationHealth") return widget2Catalog.integrationStatus;
    if (id === "savedViews") return widget2Catalog.savedViewsStatus;
    return undefined;
  }
  function customHomeWidgetStatus(permissions: HomeWidgetPermission[] = []): HomeWidgetRuntimeStatus | undefined {
    const sources: HomeRemoteSource[] = [];
    if (permissions.includes("scheduler.read")) sources.push("time");
    if (permissions.includes("activity.read")) sources.push("activity");
    if (permissions.includes("inbox.read")) sources.push("activity");
    if (permissions.includes("people.read")) sources.push("people");
    if (permissions.includes("calendar.read")) sources.push("calendar");
    if (permissions.includes("tickets.read")) sources.push("tickets");
    if (permissions.includes("library.read")) sources.push("library");
    return homeStatusFromSources(sources);
  }
  function customWidgetPrimaryAction(manifest: { permissions?: HomeWidgetPermission[] }) {
    const permissions = manifest.permissions || [];
    if (permissions.includes("projects.read")) return { label: "Open Projects", onSelect: onOpenProjects };
    if (permissions.includes("builds.read")) return { label: "Open Builds", onSelect: onOpenBuilds };
    if (permissions.includes("qa.read")) return { label: "Open QA", onSelect: onOpenQA };
    if (permissions.includes("tickets.read")) return { label: "Open Tickets", onSelect: onOpenTickets };
    if (permissions.includes("inbox.read")) return { label: "Open Inbox", onSelect: onOpenNotifications };
    if (permissions.includes("scheduler.read")) return { label: "Open Scheduler", onSelect: onOpenTime };
    if (permissions.includes("people.read")) return { label: "Open People", onSelect: onOpenTeam };
    if (permissions.includes("library.read")) return { label: "Open Library", onSelect: onOpenLibrary };
    if (permissions.includes("calendar.read")) return { label: "Open Timeline", onSelect: onOpenTimeline };
    if (permissions.includes("activity.read")) return { label: "Open Activity", onSelect: onOpenActivity };
    if (permissions.includes("boards.read")) return { label: "Open Projects", onSelect: onOpenProjects };
    if (permissions.includes("whiteboards.read")) return { label: "Open Projects", onSelect: onOpenProjects };
    if (permissions.includes("packets.read")) return { label: "Open Knowledge", onSelect: onOpenLibrary };
    if (permissions.includes("sourceControl.read")) return { label: "Open Projects", onSelect: onOpenProjects };
    if (permissions.includes("integrations.read")) return { label: "Open Integrations", onSelect: onOpenIntegrations };
    if (permissions.includes("serverConfig.read")) return { label: "Open Operations", onSelect: onOpenAdmin };
    return undefined;
  }
  function canUseBuiltInHomeWidget(id: string) {
    if (["readiness", "projects", "control", "workflow", "closeout", "coverage", "watchlists"].includes(id)) return homeCanProjects;
    if (id === "attachments" || id === "library" || id === "libraryActivity") return homeCanLibrary;
    if (["roleFocus", "myWork", "today"].includes(id)) return homeCanMyWork;
    if (id === "upcoming") return homeCanMyWork && homeCanCalendar;
    if (["scheduler", "pulse"].includes(id)) return homeCanTime;
    if (["needs", "inbox"].includes(id)) return homeCanNotifications;
    if (["people", "peopleCapacity", "departments"].includes(id)) return homeCanTeam;
    if (["activity", "digest", "handoff"].includes(id)) return homeCanActivity;
    if (["builds", "releaseReadiness"].includes(id)) return homeCanBuilds;
    if (["sourceControl", "reviewQueue"].includes(id)) return homeCanSourceControl;
    if (id === "integrationHealth") return homeCanIntegrations;
    if (id === "qa") return homeCanQa;
    if (id === "timeline") return homeCanTimeline;
    if (id === "tickets") return homeCanTickets;
    if (id === "deliveryAttention") return homeCanTickets;
    return true;
  }
  const availableHomeWidgetIds = [
    ...DASHBOARD_WIDGETS.filter((definition) => canUseBuiltInHomeWidget(definition.key) && (!definition.adminOnly || isAdmin) && (!definition.desktopOnly || homeWidgetLibrary.desktop)).map((definition) => definition.key),
    ...homeWidgetLibrary.allManifests.filter((manifest) => (manifest.permissions || []).every(canUseHomeWidgetPermission)).map((manifest) => manifest.id),
  ];
  const availableHomeWidgetIdSet = new Set(availableHomeWidgetIds);
  const kioskWidgetSet = new Set(kioskHomeState.widgetIds);
  const homeVisiblePlacements = dashboardWidgets.orderedEnabled.filter((placement) => {
    if (kioskHomeState.active && kioskWidgetSet.size && !kioskWidgetSet.has(placement.id)) return false;
    if (placement.source === "custom") return customManifestMap.has(placement.id);
    const definition = homeWidgetDefinitions.get(placement.id);
    return Boolean(definition && availableHomeWidgetIdSet.has(placement.id));
  });
  const mobileHomeWidgetIds = homeVisiblePlacements.map((placement) => placement.id);
  const activeMobileHomeId = mobileHomeWidgetIds.includes(mobileHomeSelectedId || "") ? mobileHomeSelectedId : mobileHomeWidgetIds[0] || null;

  const draggedCatalogWidgetId = draggedWidgetId?.startsWith("catalog:") ? draggedWidgetId.slice("catalog:".length) : null;
  const draggedCatalogWidgetLabel = draggedCatalogWidgetId
    ? DASHBOARD_WIDGETS.find((widget) => widget.key === draggedCatalogWidgetId)?.label || homeWidgetLibrary.allManifests.find((manifest) => manifest.id === draggedCatalogWidgetId)?.name || draggedCatalogWidgetId
    : null;
  function addHomeWidget(id: string, targetId?: string | null, position: "before" | "after" = "after", column?: number) {
    if (!availableHomeWidgetIdSet.has(id)) return;
    const visibleWithoutAdded = homeVisiblePlacements.filter((item) => item.id !== id);
    const target = targetId && targetId !== "home-widget-canvas" ? targetId : visibleWithoutAdded.at(-1)?.id;
    dashboardWidgets.place(id, { enabled: true, column, targetId: target, position: targetId === "home-widget-canvas" || !targetId ? "after" : position });
  }
  function homeWidgetDropPosition(event: DragEndEvent): "before" | "after" {
    const target = event.over?.rect;
    const active = event.active.rect.current.translated;
    if (!target || !active) return "after";
    const dx = (active.left + active.width / 2) - (target.left + target.width / 2);
    const dy = (active.top + active.height / 2) - (target.top + target.height / 2);
    return Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "before" : "after") : (dx < 0 ? "before" : "after");
  }
  function homeWidgetDropColumn(event: DragEndEvent) {
    const active = event.active.rect.current.translated;
    const canvas = document.querySelector<HTMLElement>(".home-widget-canvas-v484");
    if (!active || !canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const columns = Math.max(1, Number.parseInt(style.getPropertyValue("--cluster-home-columns") || "12", 10) || 12);
    const gap = Number.parseFloat(style.columnGap || style.getPropertyValue("--cluster-home-grid-gap") || "12") || 12;
    const paddingLeft = Number.parseFloat(style.paddingLeft || "0") || 0;
    const paddingRight = Number.parseFloat(style.paddingRight || "0") || 0;
    const innerWidth = Math.max(1, rect.width - paddingLeft - paddingRight);
    const cellWidth = Math.max(1, (innerWidth - gap * (columns - 1)) / columns);
    const centerX = active.left + active.width / 2;
    const localX = Math.max(0, Math.min(innerWidth - 1, centerX - rect.left - paddingLeft));
    return Math.max(1, Math.min(columns, Math.floor(localX / (cellWidth + gap)) + 1));
  }
  function openAttentionTarget(target?: string) {
    if (!target) return;
    const handler = attentionHandlers[target as keyof typeof attentionHandlers];
    if (handler) handler();
  }
  return (
    <section className="page dashboard-page overview-page-v040 home-page-v091 home-card-diet-v141 cluster-tool-page-v228 home-unified-v231">
      <ToolPageHeader
        eyebrow="Workspace"
        title="Home"
        metrics={[
          {
            label: "Attention",
            value: urgentAttentionCount,
            tone: urgentAttentionCount ? "warning" : "good",
          },
          {
            label: "Readiness",
            value: `${readinessAverage}%`,
            tone: readinessAverage >= 75 ? "good" : readinessAverage >= 45 ? "warning" : "danger",
          },
          {
            label: "People active",
            value: `${activeUsers}/${users.length || 0}`,
          },
          {
            label: "Clock",
            value: homeActiveEntry ? minutesToHuman(activeClockMinutes) : "Out",
            tone: homeActiveEntry ? "good" : "neutral",
          },
        ]}
        actions={
          <>
            {!kioskHomeState.active && <ClusterButton type="button" className="" onClick={() => setHomeEditMode((editing) => !editing)} variant={homeEditMode ? "primary" : "secondary"}>
              {homeEditMode ? "Done editing" : "Customize"}
            </ClusterButton>}
            <ClusterButton type="button" className="" onClick={onOpenNotifications} variant="secondary">
              Inbox
            </ClusterButton>
            <ClusterButton type="button" className="" onClick={onOpenProjects} variant="secondary">
              Projects
            </ClusterButton>
            {!kioskHomeState.readOnly && <ClusterButton type="button" variant={homeActiveEntry ? "danger" : "primary"} onClick={openHomeClockModal} disabled={clockBusy} data-cluster-kiosk-write-action="true">
              {clockButtonLabel}
            </ClusterButton>}
          </>
        }
      />

      {clockStatus && <p className="home-clock-status-v0109 home-status-v141">{clockStatus}</p>}
      <ClockIntentModal open={clockModalOpen} mode={homeActiveEntry ? "out" : "in"} active={homeActiveEntry} projects={projects} title={clockTitle} onTitleChange={setClockTitle} projectIds={clockProjectIds} onProjectIdsChange={setClockProjectIds} busy={clockBusy} onCancel={() => setClockModalOpen(false)} onConfirm={confirmHomeClock} />

      {!kioskHomeState.active && homeEditMode && (
        <div className="home-widget-edit-mode-bar-v505" role="toolbar" aria-label="Home layout editing">
          <div><strong>Editing Home</strong><span>Drag widgets on the visible grid, resize from the lower-right corner, or drag new widgets in from the palette.</span></div>
          <div>
            <div className="home-widget-edit-inline-setting-v506"><span>Density</span><ClusterSelect ariaLabel="Home widget density" value={homeDensity} options={[{ value: "compact", label: "Compact" }, { value: "balanced", label: "Balanced" }, { value: "expanded", label: "Expanded" }]} onChange={(value) => updateHomeDensity(value as "compact" | "balanced" | "expanded")} /></div>
            <div className="home-widget-edit-inline-setting-v506"><span>Phone</span><ClusterSelect ariaLabel="Mobile Home layout" value={homeMobileLayout} options={[{ value: "stack", label: "Stack" }, { value: "grid", label: "Grid" }, { value: "carousel", label: "Carousel" }, { value: "focus", label: "Focus" }]} onChange={(value) => updateHomeMobileLayout(value as typeof homeMobileLayout)} /></div>
            <ClusterButton variant="secondary" size="compact" onClick={() => { setHomeEditorFocusId(null); setHomeEditorOpen(true); }}>Advanced settings</ClusterButton>
            <ClusterButton variant="quiet" size="compact" onClick={dashboardWidgets.resetLayout}>Reset layout</ClusterButton>
            <ClusterButton variant="primary" size="compact" onClick={() => setHomeEditMode(false)}>Done</ClusterButton>
          </div>
        </div>
      )}

      {!kioskHomeState.active && <HomeWidgetEditor
        open={homeEditorOpen}
        onClose={() => { setHomeEditorOpen(false); setHomeEditorFocusId(null); }}
        focusWidgetId={homeEditorFocusId}
        isAdmin={isAdmin}
        layout={dashboardWidgets.layout}
        library={homeWidgetLibrary}
        availableWidgetIds={availableHomeWidgetIds}
        onToggle={dashboardWidgets.updateById}
        onSize={dashboardWidgets.setSizeById}
        onMove={dashboardWidgets.move}
        onReorder={dashboardWidgets.reorder}
        onReset={dashboardWidgets.resetLayout}
        onQuietDefaults={dashboardWidgets.resetQuietDefaults}
        onCoreTools={dashboardWidgets.enableCoreTools}
        onEnableEverything={dashboardWidgets.enableEverything}
        onConfigure={dashboardWidgets.configure}
        studioDefaultPreset={studioHomeDefaultPreset}
        onStudioDefaults={() => dashboardWidgets.applyPresetByName(studioHomeDefaultPreset)}
        governance={homeWidgetGovernance}
        profiles={dashboardWidgets.profiles}
        onSaveProfile={dashboardWidgets.saveProfile}
        onApplyProfile={(id) => dashboardWidgets.applyProfile(id, homeWidgetLibrary.manifests)}
        onRemoveProfile={dashboardWidgets.removeProfile}
        onExportProfiles={dashboardWidgets.exportProfiles}
        onImportProfiles={dashboardWidgets.importProfiles}
        onStudioWidgetSet={dashboardWidgets.applyRecommendedWidgetSet}
        studioRecommendationLabel={homeRecommendationLabel}
        sharing={homeLayoutSharing}
        onApplyExternalLayout={(layout) => dashboardWidgets.applyExternalLayout(layout, homeWidgetLibrary.manifests)}
        mobileLayout={homeMobileLayout}
        onMobileLayout={updateHomeMobileLayout}
        projectOptions={projects}
        userOptions={users}
        roleOptions={settings.studioRoleDefinitions || []}
        savedViewOptions={widget2Catalog.savedViews}
        density={homeDensity}
      />}

      <DndContext
        sensors={homeWidgetSensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setDraggedWidgetId(String(event.active.id))}
        onDragCancel={() => setDraggedWidgetId(null)}
        onDragEnd={(event: DragEndEvent) => {
          const activeId = String(event.active.id);
          const targetId = event.over ? String(event.over.id) : null;
          const column = homeWidgetDropColumn(event);
          setDraggedWidgetId(null);
          if (!targetId) return;
          const position = homeWidgetDropPosition(event);
          if (activeId.startsWith("catalog:")) {
            addHomeWidget(activeId.slice("catalog:".length), targetId, position, column);
            return;
          }
          const activeIndex = homeVisiblePlacements.findIndex((item) => item.id === activeId);
          if (activeIndex < 0) return;
          if (targetId === "home-widget-canvas") {
            if (column) dashboardWidgets.setColumn(activeId, column);
            return;
          }
          const targetIndex = homeVisiblePlacements.findIndex((item) => item.id === targetId);
          if (targetIndex < 0) return;
          dashboardWidgets.place(activeId, { column, targetId, position });
        }}
      >
        <div className="home-widget-edit-workspace-v506" data-editing={homeEditMode && !kioskHomeState.readOnly ? "true" : "false"} data-palette-collapsed={homePaletteCollapsed ? "true" : "false"}>
          {homeEditMode && !kioskHomeState.readOnly && <HomeWidgetPalette
            layout={dashboardWidgets.layout}
            library={homeWidgetLibrary}
            isAdmin={isAdmin}
            availableWidgetIds={availableHomeWidgetIds}
            governance={homeWidgetGovernance}
            onAdd={(id) => addHomeWidget(id)}
            onAdvanced={() => { setHomeEditorFocusId(null); setHomeEditorOpen(true); }}
            collapsed={homePaletteCollapsed}
            onCollapsed={setHomePaletteCollapsed}
          />}
          <HomeWidgetCanvasSurface editMode={homeEditMode && !kioskHomeState.readOnly} kioskActive={kioskHomeState.active} density={homeDensity} mobileLayout={homeMobileLayout} widgetIds={mobileHomeWidgetIds} selectedId={activeMobileHomeId} onSelect={setMobileHomeSelectedId}>
            {homeVisiblePlacements.length ? homeVisiblePlacements.map((placement) => {
              const widget = placement.source === "custom"
                ? (() => { const manifest = customManifestMap.get(placement.id)!; return <CustomHomeWidget manifest={manifest} size={placement.size} data={customWidgetData} status={customHomeWidgetStatus(manifest.permissions)} config={placement.config} runtimeContext={homeWidgetRuntimeContext} actions={customWidgetActions} primaryAction={customWidgetPrimaryAction(manifest)} onConfigure={() => setHomeEditorOpen(true)} />; })()
                : (() => { const definition = homeWidgetDefinitions.get(placement.id)!; return <BuiltInHomeWidget id={definition.key} size={placement.size} config={placement.config} runtimeContext={homeWidgetRuntimeContext} status={builtInHomeWidgetStatus(definition.key)} data={builtInWidgetData} actions={builtInWidgetActions} note={homeNote} onNoteChange={setHomeNote} onAttentionAction={openAttentionTarget} onSnooze={snoozeSignal} onDismiss={dismissSignal} onClock={openHomeClockModal} />; })();
              return <HomeWidgetPlacement
                key={placement.id}
                placement={placement}
                editMode={homeEditMode && !kioskHomeState.readOnly}
                dragging={draggedWidgetId === placement.id}
                onSize={dashboardWidgets.setSizeById}
                onColumn={dashboardWidgets.setColumn}
                onMove={dashboardWidgets.move}
                onRemove={(id) => dashboardWidgets.updateById(id, false)}
                onConfigure={(id) => { setHomeEditorFocusId(id); setHomeEditorOpen(true); }}
                gridColumns={homeGridColumns}
                mobileSelected={placement.id === activeMobileHomeId}
              >{widget}</HomeWidgetPlacement>;
            }) : <div className="home-widget-canvas-empty-v485"><strong>Your Home is empty</strong><span>Drag widgets from the palette onto the grid, or restore the Studio default.</span>{!kioskHomeState.active && !homeEditMode && <ClusterButton variant="secondary" size="compact" onClick={() => setHomeEditMode(true)}>Customize Home</ClusterButton>}</div>}
          </HomeWidgetCanvasSurface>
        </div>
        <DragOverlay dropAnimation={null}>
          {draggedCatalogWidgetLabel ? <div className="home-widget-catalog-drag-overlay-v506"><ClusterIcon name="drag" /><strong>{draggedCatalogWidgetLabel}</strong><span>Drop onto the Home grid</span></div> : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

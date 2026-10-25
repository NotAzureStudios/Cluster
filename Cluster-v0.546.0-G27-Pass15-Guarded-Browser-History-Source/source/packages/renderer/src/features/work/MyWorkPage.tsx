import { ClusterTextInput } from "../../components/ClusterTextInput";
import { useEffect, useMemo, useRef, useState } from "react";
import { CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, type ClusterAssignmentChange } from "@cluster/shared";
import { api, queryApi } from "../../core/api";
import { addDays, minutesToHuman, weekStart } from "../../core/date-time";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../core/format";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterStatus } from "../../components/ClusterStatus";
import { LoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { notificationWorkNavigation, notificationWorkSource } from "../notifications/notification-navigation";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import type { ClusterWorkActionContext } from "../workflow/work-actions";
import { subscribeClusterCohesionEvent } from "../../core/cohesion-events";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { MyOnboardingPanel, type OnboardingPlan } from "./MyOnboardingPanel";
import { MyEffectiveAccessPanel } from "./MyEffectiveAccessPanel";
import { sourceReviewWorkTarget, sourceReviewNeedsAction } from "../projects/source-review-navigation";
import type { ActivityEvent, Project, ProjectSnapshot, TeamAssignment, TimeEntry, TimeSummary, UpcomingPayload, User } from "../application/application-models";
import "./my-work.css";

type MyWorkSourceReview = {
  id: string;
  projectId: string;
  projectName: string;
  repositoryName: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  eligibilityState: string;
  eligibilityMessage?: string | null;
  myDecision?: string | null;
  updatedAt: string;
};

type MyWorkKnowledgeAssignment = {
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

type MyWorkPersonnelRecord = {
  id: string;
  title: string;
  classification: string;
  actions?: Array<{ id: string; userId: string; actionType: string; status: string; dueAt?: string | null }>;
};

type MyWorkAttentionItem = {
  id: string;
  kind: "personnel_record_action" | "source_review" | "knowledge" | "onboarding";
  title: string;
  detail: string;
  dueAt?: string | null;
  tone: "info" | "warning" | "danger";
  projectId?: string | null;
  reviewId?: string | null;
  onboardingAssignmentId?: string | null;
  navigation?: MyWorkKnowledgeAssignment["navigation"] | null;
};

export function MyWorkPage({ user, projects, onOpenBoard, onOpenTime, onOpenTimeline, onOpenProjects, getProjectCompleteness, getProjectHealth }: { user: User; projects: Project[]; onOpenBoard: (boardId: string) => void; onOpenTime: () => void; onOpenTimeline: () => void; onOpenProjects: () => void; getProjectCompleteness: (project: Project) => number; getProjectHealth: (project: Project) => { tone: string; label: string } }) {
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [timeSummary, setTimeSummary] = useState<TimeSummary | null>(null);
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingPayload | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [onboardingPlans, setOnboardingPlans] = useState<OnboardingPlan[]>([]);
  const [onboardingLoadFailed, setOnboardingLoadFailed] = useState(false);
  const [sourceReviews, setSourceReviews] = useState<MyWorkSourceReview[]>([]);
  const [personnelRecords, setPersonnelRecords] = useState<MyWorkPersonnelRecord[]>([]);
  const [knowledgeAssignments, setKnowledgeAssignments] = useState<MyWorkKnowledgeAssignment[]>([]);
  const [projectSnapshots, setProjectSnapshots] = useState<Record<string, ProjectSnapshot>>({});
  const [status, setStatus] = useState("Loading your work…");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attentionLoadIssues, setAttentionLoadIssues] = useState<string[]>([]);
  const [view, setView] = useState<"today" | "attention" | "assigned" | "projects" | "activity">("today");
  const [query, setQuery] = useState("");
  const myWorkRequestSequence = useRef(0);
  const revalidateTimerRef = useRef<number | null>(null);
  // React to both a cold navigation and a new Inbox link while My Work is
  // already mounted. The member projection must contain the assignment before
  // we scroll to it; an arbitrary pasted ID never triggers a privileged fetch.
  useEffect(() => {
    function revealOnboarding() {
      const inspect = new URL(window.location.href).searchParams.get("inspect");
      if (!inspect?.startsWith("onboarding:")) return;
      const assignmentId = inspect.slice("onboarding:".length);
      if (!onboardingPlans.some((plan) => plan.assignmentId === assignmentId)) return;
      setView("today");
      window.requestAnimationFrame(() => {
        document.getElementById(`onboarding-${assignmentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
    revealOnboarding();
    window.addEventListener("cluster:inspector-state-changed", revealOnboarding);
    return () => window.removeEventListener("cluster:inspector-state-changed", revealOnboarding);
  }, [onboardingPlans]);
  async function loadMyWork(force = false) {
    const sequence = ++myWorkRequestSequence.current;
    if (!assignments.length && !upcoming) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);
    try {
      const start = weekStart();
      const end = addDays(start, 7);
      const [assignmentResult, timeResult, activeResult, upcomingResult, activityResult, onboardingResult, sourceReviewResult, recordResult, knowledgeResult] = await Promise.all([
        queryApi<TeamAssignment[]>("/api/team/assignments?scope=mine", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work"] }),
        queryApi<TimeSummary>(`/api/time/summary?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&userId=${encodeURIComponent(user.id)}`, { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["scheduler", "work"] }),
        queryApi<{ active: TimeEntry | null }>("/api/time/active", { force, staleMs: 5_000, maxAgeMs: 60_000, tags: ["scheduler", "clock", "workday"] }),
        queryApi<UpcomingPayload>("/api/calendar/upcoming", { force, staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["calendar"] }),
        queryApi<ActivityEvent[]>("/api/activity?limit=100", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["activity"] }),
        api<{ plans: OnboardingPlan[] }>("/api/onboarding").catch(() => ({ plans: null as OnboardingPlan[] | null })),
        queryApi<{ reviews: MyWorkSourceReview[] }>("/api/source-control/review-queue?limit=40&assignedOnly=true", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "source-control"] }).catch(() => ({ reviews: null as MyWorkSourceReview[] | null })),
        queryApi<{ records: MyWorkPersonnelRecord[] }>("/api/my-records", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "people"] }).catch(() => ({ records: null as MyWorkPersonnelRecord[] | null })),
        queryApi<{ assignments: MyWorkKnowledgeAssignment[] }>("/api/my-knowledge", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "packets", "studio-systems"] }).catch(() => ({ assignments: null as MyWorkKnowledgeAssignment[] | null })),
      ]);
      if (sequence !== myWorkRequestSequence.current) return;
      setAssignments(assignmentResult);
      setTimeSummary(timeResult);
      setActiveTimer(activeResult.active);
      setUpcoming(upcomingResult);
      setEvents(activityResult);
      setOnboardingLoadFailed(onboardingResult.plans === null);
      if (onboardingResult.plans !== null) setOnboardingPlans(onboardingResult.plans);
      // A failed attention feed is not an empty queue. Preserve the last known list
      // and show a retry notice instead of silently making required work disappear.
      const attentionFailures: string[] = [];
      if (onboardingResult.plans === null) attentionFailures.push("Onboarding");
      if (sourceReviewResult.reviews === null) attentionFailures.push("Source reviews");
      else setSourceReviews(sourceReviewResult.reviews);
      if (recordResult.records === null) attentionFailures.push("Personnel records");
      else setPersonnelRecords(recordResult.records);
      if (knowledgeResult.assignments === null) attentionFailures.push("Required knowledge");
      else setKnowledgeAssignments(knowledgeResult.assignments);
      setAttentionLoadIssues(attentionFailures);
      setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      if (sequence !== myWorkRequestSequence.current) return;
      setLoadError(error);
      setStatus("My Work refresh failed");
    } finally {
      if (sequence === myWorkRequestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }
  function scheduleMyWorkRevalidation() {
    if (revalidateTimerRef.current) window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => {
      revalidateTimerRef.current = null;
      if (document.visibilityState === "visible") void loadMyWork(true);
    }, 250);
  }
  useEffect(() => {
    myWorkRequestSequence.current += 1;
    void loadMyWork();
    return () => { myWorkRequestSequence.current += 1; if (revalidateTimerRef.current) window.clearTimeout(revalidateTimerRef.current); };
  }, [user.id]);
  useEffect(() => subscribeClusterCohesionEvent<ClusterAssignmentChange>(CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, scheduleMyWorkRevalidation), [user.id]);
  useResourceChangeRefresh(() => loadMyWork(true), { tags: ["work", "source-control", "packets", "people"], debounceMs: 240 });
  const mine = useMemo(() => assignments.find((item) => item.user.id === user.id), [assignments, user.id]);
  const myCards = mine?.cards || [];
  const myCalendarEvents = mine?.calendarEvents || [];
  const myScheduleBlocks = mine?.scheduleBlocks || [];
  const assignedProjectIds = useMemo(() => new Set(mine?.projects.map((item) => item.id) || []), [mine?.projects]);
  const myProjects = useMemo(() => projects.filter((project) => project.memberships?.some((membership) => membership.userId === user.id && (membership.status || "active") === "active") || assignedProjectIds.has(project.id)), [projects, user.id, assignedProjectIds]);
  useEffect(() => {
    const ids = myProjects.map((project) => project.id).sort();
    if (!ids.length) { setProjectSnapshots({}); return; }
    let active = true;
    queryApi<{ snapshots: ProjectSnapshot[] }>(`/api/projects/snapshots?ids=${encodeURIComponent(ids.join(","))}`, { staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["projects", "project-snapshot", "work"] })
      .then((result) => { if (active) setProjectSnapshots(Object.fromEntries((result.snapshots || []).map((snapshot) => [snapshot.projectId, snapshot]))); })
      .catch(() => { if (active) setProjectSnapshots({}); });
    return () => { active = false; };
  }, [myProjects.map((project) => project.id).sort().join("|")]);
  const myProjectIds = useMemo(() => new Set(myProjects.map((project) => project.id)), [myProjects]);
  const myCardIds = useMemo(() => new Set(myCards.map((card) => card.id)), [myCards]);
  const dueMine = (upcoming?.dueCards || []).filter((card) => myCardIds.has(card.id) || myProjectIds.has(card.project.id)).slice(0, 8);
  const relevantActivity = events.filter((event) => event.user?.id === user.id || Boolean(event.project?.id && myProjectIds.has(event.project.id))).slice(0, 20);
  const urgentCards = myCards.filter((card) => card.priority === "urgent" || card.priority === "high");
  const priorityRank: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sortedCards = [...myCards].sort((a, b) => (priorityRank[a.priority || "medium"] ?? 2) - (priorityRank[b.priority || "medium"] ?? 2) || new Date(a.dueDate || "2999-12-31").getTime() - new Date(b.dueDate || "2999-12-31").getTime());
  const needle = query.trim().toLowerCase();
  const visibleCards = sortedCards.filter((card) => !needle || `${card.title} ${card.projectName} ${card.boardName} ${card.priority || ""}`.toLowerCase().includes(needle));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = addDays(todayStart, 1);
  const overdueCards = sortedCards.filter((card) => card.dueDate && new Date(card.dueDate).getTime() < todayStart.getTime());
  const dueTodayCards = sortedCards.filter((card) => {
    if (!card.dueDate) return false;
    const due = new Date(card.dueDate).getTime();
    return due >= todayStart.getTime() && due < todayEnd.getTime();
  });
  const unscheduledCards = sortedCards.filter((card) => !card.dueDate);
  const focusPlan = sortedCards.slice(0, 5);
  const todayEvents = [
    ...myCalendarEvents.map((event) => ({ ...event, source: "calendar" as const })),
    ...myScheduleBlocks.map((block) => ({ ...block, source: "scheduler" as const })),
  ]
    .filter((event) => {
      const starts = new Date(event.startsAt).getTime();
      return starts >= todayStart.getTime() && starts < todayEnd.getTime();
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 8);
  const assignedCount = myCards.length + myCalendarEvents.length + myScheduleBlocks.length;
  const linkedAssignments = [...myCards, ...myCalendarEvents, ...myScheduleBlocks].filter((item) => (item.relationshipSummary?.total || 0) > 0).length;
  const relationshipBlockers = [...myCards, ...myCalendarEvents, ...myScheduleBlocks].reduce((total, item) => total + (item.relationshipSummary?.blockers || 0), 0);
  const attentionItems = useMemo<MyWorkAttentionItem[]>(() => {
    const now = Date.now();
    const recordItems = personnelRecords.flatMap((record) => (record.actions || [])
      .filter((action) => action.userId === user.id && action.status !== "completed")
      .map((action) => ({
        id: `record:${action.id}`,
        kind: "personnel_record_action" as const,
        title: record.classification === "restricted" ? "Personnel record action required" : record.title,
        detail: `${levelLabel(action.actionType)} required${action.dueAt ? ` · due ${formatDueDate(action.dueAt)}` : ""}`,
        dueAt: action.dueAt || null,
        tone: action.dueAt && new Date(action.dueAt).getTime() < now ? "danger" as const : "warning" as const,
      })));
    const reviewItems = sourceReviews
      .filter((review) => sourceReviewNeedsAction(review.myDecision))
      .map((review) => ({
        id: `review:${review.id}`,
        kind: "source_review" as const,
        title: review.title,
        detail: `${review.projectName} · ${review.sourceBranch} → ${review.targetBranch}${review.myDecision === "commented" ? " · Commented, decision pending" : ""}${review.eligibilityMessage ? ` · ${review.eligibilityMessage}` : ""}`,
        tone: review.eligibilityState === "blocked" ? "danger" as const : review.eligibilityState === "ready" ? "warning" as const : "info" as const,
        projectId: review.projectId,
        reviewId: review.id,
      }));
    const libraryItems = knowledgeAssignments.map((assignment) => ({
      id: `knowledge:${assignment.id}`,
      kind: "knowledge" as const,
      title: assignment.title,
      detail: `${assignment.kind === "policy" ? "Policy" : "Packet"}${assignment.versionLabel ? ` · ${assignment.versionLabel}` : ""}${assignment.dueAt ? ` · due ${formatDueDate(assignment.dueAt)}` : ""}`,
      dueAt: assignment.dueAt || null,
      tone: assignment.overdue ? "danger" as const : assignment.dueAt ? "warning" as const : "info" as const,
      navigation: assignment.navigation,
    }));
    const onboardingItems = onboardingPlans.filter((plan) => !plan.progress.done).map((plan) => ({
      id: `onboarding:${plan.assignmentId}`,
      kind: "onboarding" as const,
      onboardingAssignmentId: plan.assignmentId,
      title: plan.plan.title,
      detail: `${plan.progress.requiredComplete}/${plan.progress.requiredTotal} required steps complete${plan.lifecycle.dueAt ? ` · due ${formatDueDate(plan.lifecycle.dueAt)}` : ""}`,
      dueAt: plan.lifecycle.dueAt || null,
      tone: plan.lifecycle.overdue ? "danger" as const : plan.lifecycle.dueAt ? "warning" as const : "info" as const,
    }));
    return [...recordItems, ...reviewItems, ...libraryItems, ...onboardingItems].sort((a, b) => {
      const aDueAt = "dueAt" in a ? a.dueAt : null;
      const bDueAt = "dueAt" in b ? b.dueAt : null;
      const aDue = aDueAt ? new Date(aDueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = bDueAt ? new Date(bDueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue || a.title.localeCompare(b.title);
    });
  }, [personnelRecords, sourceReviews, knowledgeAssignments, onboardingPlans, user.id]);
  const openAttention = (item: MyWorkAttentionItem) => {
    if (item.kind === "onboarding" && item.onboardingAssignmentId) {
      setView("today");
      openClusterWorkNavigation({ screen: "mywork", inspectScope: "onboarding", inspectId: item.onboardingAssignmentId });
      return;
    }
    if (item.kind === "personnel_record_action") {
      openClusterWorkNavigation({ screen: "packets", inspectScope: "records" });
      return;
    }
    if (item.kind === "knowledge" && item.navigation) {
      openClusterWorkNavigation(item.navigation);
      return;
    }
    if (item.kind === "source_review" && item.projectId && item.reviewId) {
      openClusterWorkNavigation(sourceReviewWorkTarget(item.projectId, item.reviewId));
      return;
    }
    if (item.projectId) openClusterWorkNavigation({ screen: "project", projectId: item.projectId });
  };
  const relationshipHint = (summary?: { total: number; blockers: number; critical: number; labels: string[] }) => summary?.total ? `${summary.total} link${summary.total === 1 ? "" : "s"}${summary.blockers ? ` · ${summary.blockers} blocker${summary.blockers === 1 ? "" : "s"}` : summary.critical ? ` · ${summary.critical} critical` : summary.labels[0] ? ` · ${summary.labels[0]}` : ""}` : "";
  const openCard = (card: TeamAssignment["cards"][number]) => {
    openClusterWorkNavigation({
      screen: card.isTicket ? "tickets" : "board",
      projectId: card.projectId,
      boardId: card.isTicket ? null : card.boardId,
      inspectScope: card.isTicket ? "ticket" : "card",
      inspectId: card.id,
    });
  };
  const openScheduled = (event: (typeof todayEvents)[number]) => {
    openClusterWorkNavigation({
      screen: event.source === "scheduler" ? "scheduler" : "calendar",
      projectId: event.projectId || null,
      inspectScope: event.source === "scheduler" ? "schedule-block" : "calendar-event",
      inspectId: event.id,
    });
  };
  const scheduledWorkContext = (event: (typeof todayEvents)[number]): ClusterWorkActionContext => ({
    source: { kind: event.source === "scheduler" ? "scheduler" : "calendar", id: event.id, projectId: event.projectId || null, label: event.title },
    navigation: { screen: event.source === "scheduler" ? "scheduler" : "calendar", projectId: event.projectId || null, inspectScope: event.source === "scheduler" ? "schedule-block" : "calendar-event", inspectId: event.id },
    projectId: event.projectId || null,
    assigneeId: event.source === "calendar" ? event.ownerId || null : null,
    attendeeIds: "attendeeIds" in event ? event.attendeeIds || [] : [],
    startsAt: event.startsAt,
    endsAt: event.endsAt || null,
  });
  const openActivity = (event: ActivityEvent) => {
    const target = notificationWorkNavigation({
      category: "activity",
      projectId: event.project?.id || null,
      boardId: event.board?.id || null,
      cardId: event.card?.id || null,
      entityType: event.entityType,
      entityId: event.entityId || null,
      resource: null,
      metadata: event.metadata || {},
    });
    if (target) openClusterWorkNavigation(target);
  };
  const activityWorkContext = (event: ActivityEvent): ClusterWorkActionContext | null => {
    const item = { category: "activity" as const, projectId: event.project?.id || null, boardId: event.board?.id || null, cardId: event.card?.id || null, entityType: event.entityType, entityId: event.entityId || null, resource: null, metadata: event.metadata || {} };
    const source = notificationWorkSource(item);
    const navigation = notificationWorkNavigation(item);
    return source && navigation ? { source, navigation, projectId: source.projectId || navigation.projectId || null, boardId: navigation.boardId || null } : null;
  };
  if (loading && !upcoming) return <section className="page cluster-page-shell mywork-page-v253 cluster-tool-page-v228 mywork-unified-v231"><LoadingState label="Loading My Work" rows={8} /></section>;
  if (loadError && !upcoming) return <section className="page cluster-page-shell mywork-page-v253 cluster-tool-page-v228 mywork-unified-v231"><RequestErrorState error={loadError} title="My Work unavailable" onRetry={() => void loadMyWork()} /></section>;
  return (
    <section className="page cluster-page-shell mywork-page-v253 cluster-tool-page-v228 mywork-unified-v231">
      <header className="mywork-command-v253 cluster-page-header">
        <div>
          <span>Personal workspace</span>
          <h1>My Work</h1>
          {refreshing ? <ClusterStatus state="loading" compact>Refreshing</ClusterStatus> : null}
        </div>
        <div className="mywork-command-actions-v253">
          <ClusterButton type="button" className="" onClick={() => void loadMyWork()} variant="secondary">
            Refresh
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={onOpenTime} variant="secondary">
            Scheduler
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={onOpenTimeline} variant="secondary">
            Timeline
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={onOpenProjects} variant="primary">
            Projects
          </ClusterButton>
        </div>
        <div className="mywork-stat-strip-v253">
          <ClusterButton unstyled type="button" onClick={() => setView("assigned")}>
            <span>Assigned</span>
            <strong>{assignedCount}</strong>
            <em>{myCards.length} work items · {linkedAssignments} linked{relationshipBlockers ? ` · ${relationshipBlockers} blockers` : ""}</em>
          </ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => setView("today")} data-tone={overdueCards.length ? "danger" : "good"}>
            <span>Overdue</span>
            <strong>{overdueCards.length}</strong>
            <em>{dueTodayCards.length} due today</em>
          </ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => setView("projects")}>
            <span>Projects</span>
            <strong>{myProjects.length}</strong>
            <em>{myProjects.filter((project) => getProjectHealth(project).tone !== "good").length} need attention</em>
          </ClusterButton>
          <ClusterButton unstyled type="button" onClick={onOpenTime}>
            <span>This week</span>
            <strong>{minutesToHuman(timeSummary?.totalMinutes || 0)}</strong>
            <em>{activeTimer ? "Clocked in" : "Clocked out"}</em>
          </ClusterButton>
        </div>
      </header>
      <nav className="mywork-tabs-v253" aria-label="My Work views">
        {(["today", "attention", "assigned", "projects", "activity"] as const).map((item) => (
          <ClusterButton unstyled type="button" key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
            {levelLabel(item)}
            <span>{item === "today" ? dueMine.length : item === "attention" ? attentionItems.length : item === "assigned" ? assignedCount : item === "projects" ? myProjects.length : relevantActivity.length}</span>
          </ClusterButton>
        ))}
      </nav>

      {view === "today" && onboardingLoadFailed && <div className="mywork-attention-warning-v536" role="alert">Onboarding assignments could not be refreshed. Previously loaded steps remain visible. <ClusterButton type="button" size="compact" variant="secondary" onClick={() => void loadMyWork(true)}>Retry onboarding</ClusterButton></div>}
      {view === "today" && onboardingPlans.length > 0 && <MyOnboardingPanel plans={onboardingPlans} onRefresh={() => loadMyWork(true)} />}

      {view === "today" && attentionItems.length > 0 && (
        <section className="mywork-panel-v253 mywork-attention-v9f">
          <header>
            <div><h2>Needs your attention</h2><span>{attentionItems.length} open action{attentionItems.length === 1 ? "" : "s"}</span></div>
            <ClusterButton unstyled type="button" onClick={() => setView("attention")}>View all</ClusterButton>
          </header>
          <div className="mywork-work-list-v253">
            {attentionItems.slice(0, 4).map((item) => (
              <ClusterButton unstyled type="button" key={item.id} data-priority={item.tone === "danger" ? "urgent" : item.tone === "warning" ? "high" : "medium"} onClick={() => openAttention(item)}>
                <ClusterIcon name={item.kind === "source_review" ? "code" : item.kind === "knowledge" ? "packet" : "text"} width={16} height={16} />
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <em>{item.kind === "source_review" ? "Review" : item.kind === "knowledge" ? "Knowledge" : item.kind === "onboarding" ? "Onboarding" : "Records"}</em>
              </ClusterButton>
            ))}
          </div>
        </section>
      )}

      {view === "today" && (
        <div className="mywork-today-grid-v253">
          <section className="mywork-panel-v253 mywork-priority-v253">
            <header>
              <div>
                <h2>Daily focus plan</h2>
                <span>Priority, deadline, then project context</span>
              </div>
              <ClusterButton unstyled type="button" onClick={() => setView("assigned")}>View all</ClusterButton>
            </header>
            <div className="mywork-work-list-v253">
              {focusPlan.length ? (
                focusPlan.map((card, index) => (
                  <ClusterButton unstyled type="button" key={card.id} data-priority={card.priority || "medium"} onClick={() => openCard(card)}>
                    <i aria-hidden="true">{index + 1}</i>
                    <span>
                      <strong>{card.title}</strong>
                      <small>
                        {card.projectName} · {card.boardName}{relationshipHint(card.relationshipSummary) ? ` · ${relationshipHint(card.relationshipSummary)}` : ""}
                      </small>
                    </span>
                    <em>{card.dueDate ? formatDueDate(card.dueDate) : levelLabel(card.priority || "medium")}</em>
                  </ClusterButton>
                ))
              ) : (
                <ClusterEmptyState compact kind="empty" icon="work" title="No assigned work" description="Nothing is currently assigned to you. Open Projects when you need to pick up or review project work." actions={<ClusterButton size="compact" variant="secondary" onClick={onOpenProjects}>Open Projects</ClusterButton>} />
              )}
            </div>
          </section>
          <aside className="mywork-side-stack-v253">
            <section className="mywork-panel-v253 mywork-execution-health-v414">
              <header><div><h2>Execution health</h2><span>Your queue at a glance</span></div></header>
              <div className="mywork-health-grid-v414">
                <ClusterButton unstyled type="button" onClick={() => setView("assigned")} data-tone={overdueCards.length ? "danger" : "good"}><strong>{overdueCards.length}</strong><span>Overdue</span></ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => setView("assigned")}><strong>{dueTodayCards.length}</strong><span>Due today</span></ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => setView("assigned")}><strong>{urgentCards.length}</strong><span>Priority</span></ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => setView("assigned")}><strong>{unscheduledCards.length}</strong><span>Unscheduled</span></ClusterButton>
              </div>
            </section>
            <section className="mywork-panel-v253 mywork-clock-v253">
              <header>
                <div>
                  <h2>Current session</h2>
                  <span>{activeTimer ? "Tracking now" : "Not tracking"}</span>
                </div>
              </header>
              <strong>{activeTimer?.title || "Clocked out"}</strong>
              <p>{activeTimer ? `${activeTimer.project?.name || "General"} · started ${formatRelativeTime(activeTimer.startedAt)}` : `${minutesToHuman(timeSummary?.totalMinutes || 0)} tracked this week`}</p>
              <ClusterButton type="button" className="" onClick={onOpenTime} variant="secondary">
                Open Scheduler
              </ClusterButton>
            </section>
            <section className="mywork-panel-v253">
              <header>
                <div>
                  <h2>Today</h2>
                  <span>{todayEvents.length} scheduled</span>
                </div>
              </header>
              <div className="mywork-mini-list-v253">
                {todayEvents.length ? (
                  todayEvents.map((event) => (
                    <article key={event.id} className="mywork-scheduled-item-v493">
                      <ClusterButton unstyled type="button" className="mywork-scheduled-row-v493" onClick={() => openScheduled(event)}>
                        <time>
                          {new Date(event.startsAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                        <span>
                          <strong>{event.title}</strong>
                          <small>{event.projectName || (event.source === "scheduler" ? "Scheduler" : "Calendar")}{relationshipHint(event.relationshipSummary) ? ` · ${relationshipHint(event.relationshipSummary)}` : ""}</small>
                        </span>
                      </ClusterButton>
                      <WorkActionMenu iconOnly context={scheduledWorkContext(event)} label={`${event.title} actions`} exclude={["open", "schedule"]} />
                    </article>
                  ))
                ) : (
                  <ClusterEmptyState compact kind="empty" icon="calendar" title="No events today" description="Your calendar is clear for the rest of this view." />
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {view === "attention" && (
        <section className="mywork-panel-v253 mywork-browser-v253 mywork-attention-v9f">
          <header><div><h2>Attention</h2><span>Reviews and required actions from canonical systems</span></div></header>
          {attentionLoadIssues.length ? <div className="mywork-attention-warning-v536" role="alert">
            <span>Some work could not be refreshed: {attentionLoadIssues.join(", ")}. Previously loaded items are retained, but this queue may be incomplete.</span>
            <ClusterButton size="compact" variant="secondary" disabled={refreshing} onClick={() => void loadMyWork(true)}>Retry</ClusterButton>
          </div> : null}
          <div className="mywork-work-list-v253">
            {attentionItems.length ? attentionItems.map((item) => (
              <ClusterButton unstyled type="button" key={item.id} data-priority={item.tone === "danger" ? "urgent" : item.tone === "warning" ? "high" : "medium"} onClick={() => openAttention(item)}>
                <ClusterIcon name={item.kind === "source_review" ? "code" : item.kind === "knowledge" ? "packet" : "text"} width={16} height={16} />
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <em>{item.kind === "source_review" ? "Source review" : item.kind === "knowledge" ? "Required knowledge" : item.kind === "onboarding" ? "Onboarding" : "Personnel record"}</em>
              </ClusterButton>
            )) : <ClusterEmptyState compact kind="empty" icon="work" title={attentionLoadIssues.length ? "Attention queue unavailable" : "Nothing needs attention"} description={attentionLoadIssues.length ? "Some sources could not load. Retry to confirm outstanding actions." : "Reviews, required knowledge, and record actions will appear here when they need you."} />}
          </div>
        </section>
      )}

      {view === "attention" && <MyEffectiveAccessPanel />}

      {view === "assigned" && (
        <section className="mywork-panel-v253 mywork-browser-v253">
          <header>
            <div>
              <h2>Assigned work</h2>
              <span>{visibleCards.length} shown</span>
            </div>
            <label className="mywork-search-v253">
              <ClusterIcon name="search" />
              <ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assigned work" />
              {query && (
                <ClusterButton unstyled type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <ClusterIcon name="close" />
                </ClusterButton>
              )}
            </label>
          </header>
          {(myCalendarEvents.length > 0 || myScheduleBlocks.length > 0) && <div className="mywork-assigned-schedule-v491">
            <span><strong>{myCalendarEvents.length}</strong> calendar assignment{myCalendarEvents.length === 1 ? "" : "s"}</span>
            <span><strong>{myScheduleBlocks.length}</strong> scheduler block{myScheduleBlocks.length === 1 ? "" : "s"}</span>
            <ClusterButton size="compact" variant="quiet" onClick={onOpenTime}>Open schedule</ClusterButton>
          </div>}
          <div className="mywork-table-v253">
            <div className="mywork-table-head-v253">
              <span>Work</span>
              <span>Project</span>
              <span>Priority</span>
              <span>Due</span>
            </div>
            {visibleCards.length ? (
              visibleCards.map((card) => (
                <ClusterButton unstyled type="button" key={card.id} onClick={() => openCard(card)}>
                  <span>
                    <strong>{card.title}</strong>
                    <small>{card.boardName}{relationshipHint(card.relationshipSummary) ? ` · ${relationshipHint(card.relationshipSummary)}` : ""}</small>
                  </span>
                  <span>{card.projectName}</span>
                  <span data-priority={card.priority || "medium"}>{levelLabel(card.priority || "medium")}</span>
                  <time>{card.dueDate ? formatDueDate(card.dueDate) : "Unscheduled"}</time>
                </ClusterButton>
              ))
            ) : (
              <ClusterEmptyState compact kind={query ? "filtered" : "empty"} icon="work" title={query ? "No assigned work matches this search" : "No assigned work"} description={query ? "Clear the search to return to the full assigned-work list." : "Nothing is currently assigned to you."} actions={query ? <ClusterButton size="compact" variant="secondary" onClick={() => setQuery("")}>Clear search</ClusterButton> : undefined} />
            )}
          </div>
        </section>
      )}

      {view === "projects" && (
        <section className="mywork-project-grid-v253">
          {myProjects.length ? (
            myProjects.map((project) => {
              const snapshot = projectSnapshots[project.id] || null;
              const fallbackHealth = getProjectHealth(project);
              const health = snapshot?.health.state === "blocked" ? { tone: "danger", label: "Blocked" } : snapshot?.health.state === "at_risk" ? { tone: "danger", label: "At Risk" } : snapshot?.health.state === "attention" ? { tone: "warning", label: "Needs Attention" } : snapshot ? { tone: "good", label: "Healthy" } : fallbackHealth;
              return (
                <ClusterButton unstyled type="button" className="mywork-project-v253" key={project.id} onClick={() => openClusterWorkNavigation({ screen: "project", projectId: project.id })}>
                  <header>
                    <strong>{snapshot?.identity.displayName || project.name}</strong>
                    <span data-tone={health.tone}>{health.label}</span>
                  </header>
                  <div>
                    <span>Readiness</span>
                    <strong>{snapshot?.readiness.score ?? getProjectCompleteness(project)}%</strong>
                  </div>
                  <footer>
                    <span>{snapshot?.schedule.label || (project.targetDate ? new Date(project.targetDate).toLocaleDateString() : "Unscheduled")}</span>
                    <span>{myCards.filter((card) => card.projectId === project.id || card.projectName === project.name).length} cards</span>
                  </footer>
                </ClusterButton>
              );
            })
          ) : (
            <ClusterEmptyState kind="empty" icon="project" title="No assigned projects" description="Projects will appear here when you are assigned to them. The full portfolio remains available in Projects." actions={<ClusterButton variant="secondary" onClick={onOpenProjects}>Open Projects</ClusterButton>} />
          )}
        </section>
      )}

      {view === "activity" && (
        <section className="mywork-panel-v253">
          <header>
            <div>
              <h2>Related activity</h2>
              <span>Your work and assigned projects</span>
            </div>
          </header>
          <div className="mywork-activity-v253">
            {relevantActivity.length ? (
              relevantActivity.map((event) => (
                <article key={event.id} className="mywork-activity-item-v493">
                  <ClusterButton unstyled type="button" className="mywork-activity-row-v493" onClick={() => openActivity(event)}>
                    <i />
                    <span>
                      <strong>{event.title}</strong>
                      <small>{event.message || event.type}</small>
                    </span>
                    <time>{formatRelativeTime(event.createdAt)}</time>
                  </ClusterButton>
                  {activityWorkContext(event) ? <WorkActionMenu iconOnly context={activityWorkContext(event)!} label={`${event.title} actions`} exclude={["open"]} /> : null}
                </article>
              ))
            ) : (
              <ClusterEmptyState compact kind="empty" icon="activity" title="No related activity yet" description="Activity from your work and assigned projects will appear here as work changes." />
            )}
          </div>
        </section>
      )}

      {loadError && upcoming ? <RequestErrorState error={loadError} title="My Work refresh failed" onRetry={() => void loadMyWork()} compact /> : null}
      {status && !loadError && <div className="status-box system-status-box-v053">{status}</div>}
    </section>
  );
}

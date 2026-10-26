import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryApi } from "../../core/api";
import { addDays, weekStart } from "../../core/date-time";
import { formatRelativeTime } from "../../core/format";
import { CompactSectionNav, type CompactSectionNavItem } from "../../components/CompactSectionNav";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { LoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { ClusterButton } from "../../components/ClusterButton";
import { useProgressiveList } from "../../components/useProgressiveList";
import { useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import type { ClusterWorkActionContext } from "../workflow/work-actions";
import { displayUserName, presenceLabel, presenceState, userInitial } from "../people/people-utils";
import type { ActivityEvent, ActivityViewMode, Project, TimeEntry, UserActivitySummary } from "../application/application-models";
import { projectMemberIds } from "../projects/projects-utils";
import "./activity.css";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";

export function ActivityPage({ projects, onOpenProject, onOpenTickets, onOpenQa, onOpenTime, projectTypeLabel, projectStatusLabel, adminMode = false, initialView, embedded = false }: { projects: Project[]; onOpenProject: (projectId: string) => void; onOpenTickets: () => void; onOpenQa: () => void; onOpenTime: () => void; projectTypeLabel: (project: Project) => string; projectStatusLabel: (project: Pick<Project, "status" | "archived">) => string; adminMode?: boolean; initialView?: ActivityViewMode; embedded?: boolean }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const [clockedInEntries, setClockedInEntries] = useState<TimeEntry[]>([]);
  const [entityFilter, setEntityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "human" | "automation" | "system">("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [timeWindow, setTimeWindow] = useState("all");
  const [viewMode, setViewMode] = useState<ActivityViewMode>(initialView || (adminMode ? "pulse" : "feed"));
  const [query, setQuery] = useState("");
  const [presenceQuery, setPresenceQuery] = useState("");
  const [presenceFilter, setPresenceFilter] = useState("all");
  const [status, setStatus] = useState("Loading activity…");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [sourceFocus, setSourceFocus] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const restoreSourceFocus = useCallback((id: string | null) => { setSourceFocus(id); if (id) setSelectedEvent(null); }, []);
  const sourceDetailHistory = useClusterDetailHistory("activity-source", sourceFocus, restoreSourceFocus);
  const restoreEvent = useCallback((id: string | null) => { setSelectedEvent(id ? events.find((event) => event.id === id) || null : null); }, [events]);
  const eventDetailHistory = useClusterDetailHistory("activity-event", selectedEvent?.id || null, restoreEvent);
  async function loadActivity(force = false) {
    const sequence = ++loadSequenceRef.current;
    if (!events.length && !users.length) setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (entityFilter !== "all") params.set("entityType", entityFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const week = weekStart(new Date());
      const activeParams = new URLSearchParams({
        start: week.toISOString(),
        end: addDays(week, 7).toISOString(),
      });
      const [activityResult, userResult, timeResult] = await Promise.all([
        queryApi<ActivityEvent[]>(`/api/activity?${params.toString()}`, { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["activity"] }),
        queryApi<UserActivitySummary[]>("/api/users/activity", { force, staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "activity"] }),
        queryApi<TimeEntry[]>(`/api/time/entries?${activeParams.toString()}`, { force, staleMs: 15_000, maxAgeMs: 2 * 60_000, tags: ["time", "activity"] }).catch(() => []),
      ]);
      if (sequence !== loadSequenceRef.current) return;
      setEvents(activityResult);
      setUsers(userResult);
      setClockedInEntries(timeResult.filter((entry) => entry.running || !entry.endedAt));
      setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      setLoadError(error);
      setStatus("Activity refresh failed");
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    void loadActivity();
    return () => { loadSequenceRef.current += 1; };
  }, [entityFilter, typeFilter]);
  useResourceChangeRefresh(() => loadActivity(true), { tags: ["activity"], debounceMs: 240 });

  function activitySource(event: ActivityEvent): "human" | "automation" | "system" {
    if (event.user?.id) return "human";
    const metadata = event.metadata || {};
    const text = `${event.type} ${event.entityType} ${event.title} ${event.message || ""} ${JSON.stringify(metadata)}`.toLowerCase();
    if ((metadata as any).automationId || (metadata as any).automation || /automation|webhook|scheduled|background job|integration|bot/.test(text)) return "automation";
    return "system";
  }
  function activitySourceLabel(source: ReturnType<typeof activitySource>) {
    if (source === "human") return "Person";
    if (source === "automation") return "Automation";
    return "System";
  }
  function notificationSignal(event: ActivityEvent) {
    const metadata = event.metadata || {};
    const nested = metadata.notification && typeof metadata.notification === "object" && !Array.isArray(metadata.notification) ? metadata.notification as Record<string, unknown> : {};
    const tool = String(metadata.notificationTool || nested.tool || "").trim();
    const signal = String(metadata.notificationSignal || nested.signal || "").trim();
    const requiresAction = metadata.requiresAction === true || nested.requiresAction === true;
    return { tool, signal, requiresAction };
  }

  function sourceReference(value: string | null) {
    if (!value) return null;
    const separator = value.indexOf(".");
    if (separator <= 0) return null;
    return { kind: value.slice(0, separator), id: value.slice(separator + 1) };
  }
  function eventMatchesSource(event: ActivityEvent, reference: { kind: string; id: string }) {
    const metadata = event.metadata || {};
    const source = metadata.source && typeof metadata.source === "object" && !Array.isArray(metadata.source) ? metadata.source as Record<string, unknown> : null;
    const sourceKind = String(source?.kind || metadata.sourceKind || "").toLowerCase();
    const sourceId = String(source?.id || metadata.sourceId || "");
    if (sourceKind === reference.kind && sourceId === reference.id) return true;
    if (event.entityId !== reference.id && event.card?.id !== reference.id && event.project?.id !== reference.id && event.board?.id !== reference.id && event.whiteboard?.id !== reference.id) return false;
    const kindAliases: Record<string, string[]> = {
      ticket: ["ticket", "card"], card: ["card"], project: ["project"], board: ["board"], whiteboard: ["whiteboard"],
      build: ["build", "build_artifact"], qa_plan: ["qa", "qa_plan"], qa_session: ["qa", "qa_session"], release: ["release", "release_note"],
      control: ["control", "project_control", "project_control_record"], calendar: ["calendar", "calendar_event"], scheduler: ["scheduler", "schedule_block"],
      timeline: ["timeline", "timeline_item"], library: ["library"], file: ["file", "project_file"], user: ["user", "person"],
    };
    return (kindAliases[reference.kind] || [reference.kind]).includes(String(event.entityType || "").toLowerCase()) || reference.kind === "project" && event.project?.id === reference.id;
  }
  function activityContext(event: ActivityEvent): ClusterWorkActionContext | null {
    const source = event.metadata?.source && typeof event.metadata.source === "object" && !Array.isArray(event.metadata.source) ? event.metadata.source as Record<string, unknown> : null;
    const kind = String(source?.kind || event.entityType || "").toLowerCase();
    const id = String(source?.id || event.entityId || event.card?.id || event.project?.id || "");
    if (!id) return null;
    const normalized = ({ build_artifact: "build", calendar_event: "calendar", schedule_block: "scheduler", timeline_item: "timeline", project_control: "control", project_control_record: "control", release_note: "release",  project_file: "file", person: "user" } as Record<string, string>)[kind] || kind;
    if (!["project","board","card","ticket","whiteboard","build","qa_plan","qa_session","release","meeting","control","calendar","scheduler","timeline","library","file","user"].includes(normalized)) return null;
    return {
      source: { kind: normalized as ClusterWorkActionContext["source"]["kind"], id, projectId: event.project?.id || null, label: event.card?.title || event.title },
      projectId: event.project?.id || null,
      boardId: event.board?.id || null,
    };
  }

  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const windowMs = timeWindow === "24h" ? 1000 * 60 * 60 * 24 : timeWindow === "7d" ? 1000 * 60 * 60 * 24 * 7 : timeWindow === "30d" ? 1000 * 60 * 60 * 24 * 30 : 0;
    const needle = query.trim().toLowerCase();
    const focusedSource = sourceReference(sourceFocus);
    return events.filter((event) => {
      if (focusedSource && !eventMatchesSource(event, focusedSource)) return false;
      if (projectFilter !== "all" && event.project?.id !== projectFilter) return false;
      if (sourceFilter !== "all" && activitySource(event) !== sourceFilter) return false;
      if (windowMs && now - new Date(event.createdAt).getTime() > windowMs) return false;
      if (!needle) return true;
      const haystack = [event.title, event.message, event.type, event.entityType, event.project?.name, event.board?.name, event.whiteboard?.name, event.card?.title, event.user?.displayName, event.user?.username, JSON.stringify(event.metadata || {})].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [events, projectFilter, timeWindow, query, sourceFilter, sourceFocus]);
  const sourceCounts = filteredEvents.reduce<Record<"human" | "automation" | "system", number>>((acc, event) => { acc[activitySource(event)] += 1; return acc; }, { human: 0, automation: 0, system: 0 });
  const riskEvents = filteredEvents.filter((event) => ["deleted", "archived", "failed", "error"].includes(event.type) || /delete|archive|failed|error|blocked/i.test(`${event.title} ${event.message || ""}`));
  const activeUsers = users.filter((user) => user.lastActivityAt && Date.now() - new Date(user.lastActivityAt).getTime() <= 1000 * 60 * 60 * 24 * 7);
  const activeNowUsers = users.filter((user) => presenceState(user) === "active");
  const recentSignalUsers = users.filter((user) => ["active", "recent", "focus", "away"].includes(presenceState(user)));
  const entityCounts = filteredEvents.reduce<Record<string, number>>(
    (acc, event) => ({
      ...acc,
      [event.entityType || "unknown"]: (acc[event.entityType || "unknown"] || 0) + 1,
    }),
    {},
  );
  const typeCounts = filteredEvents.reduce<Record<string, number>>(
    (acc, event) => ({
      ...acc,
      [event.type || "unknown"]: (acc[event.type || "unknown"] || 0) + 1,
    }),
    {},
  );
  const projectCounts = filteredEvents.reduce<Record<string, { name: string; count: number }>>((acc, event) => {
    const key = event.project?.id || "workspace";
    const name = event.project?.name || "Workspace";
    acc[key] = { name, count: (acc[key]?.count || 0) + 1 };
    return acc;
  }, {});
  const projectActivity = Object.entries(projectCounts)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const topUsers = [...users].sort((a, b) => (b.counts.activityEvents || 0) - (a.counts.activityEvents || 0)).slice(0, 8);
  const recentEvents = filteredEvents.slice(0, 8);
  const visibleEvents = viewMode === "audit" ? riskEvents : filteredEvents;
  const activityProgress = useProgressiveList(visibleEvents, {
    initial: 80,
    step: 80,
    resetKey: `${viewMode}|${entityFilter}|${typeFilter}|${sourceFilter}|${projectFilter}|${timeWindow}|${query}|${sourceFocus || ""}`,
  });
  const groupedEvents = activityProgress.visibleItems.reduce<Record<string, ActivityEvent[]>>((acc, event) => {
    const date = new Date(event.createdAt);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24).toDateString();
    const key =
      date.toDateString() === today
        ? "Today"
        : date.toDateString() === yesterday
          ? "Yesterday"
          : date.toLocaleDateString([], {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
    acc[key] ||= [];
    acc[key].push(event);
    return acc;
  }, {});
  const activityGroups = Object.entries(groupedEvents) as Array<[string, ActivityEvent[]]>;
  function entityLabel(entity?: string | null) {
    if (entity === "whiteboard") return "Whiteboard";
    if (entity === "project_file") return "File";
    if (entity === "review_asset") return "Review asset";
    if (entity === "review_comment") return "Review note";
    if (!entity) return "Activity";
    return entity.slice(0, 1).toUpperCase() + entity.slice(1).replace(/[_-]/g, " ");
  }
  function typeLabel(type?: string | null) {
    if (type === "git_import") return "Git import";
    if (type === "comment") return "Comment";
    if (type === "commented") return "Commented";
    if (type === "uploaded") return "Uploaded";
    if (!type) return "Updated";
    return type.slice(0, 1).toUpperCase() + type.slice(1).replace(/[_-]/g, " ");
  }
  function activityTone(event: ActivityEvent) {
    if (["deleted", "archived", "failed", "error"].includes(event.type)) return "danger";
    if (event.type === "git_import" || event.entityType === "git") return "git";
    if (event.entityType === "card" || event.type === "moved") return "work";
    if (event.entityType === "review_asset" || event.entityType === "review_comment") return "video";
    if (event.entityType === "whiteboard") return "canvas";
    return "neutral";
  }
  function setQuickFilter(next: { entity?: string; type?: string; project?: string; window?: string; view?: ActivityViewMode }) {
    if (next.entity) setEntityFilter(next.entity);
    if (next.type) setTypeFilter(next.type);
    if (next.project) setProjectFilter(next.project);
    if (next.window) setTimeWindow(next.window);
    if (next.view) setViewMode(next.view);
  }
  const filteredPresenceUsers = users.filter((member) => {
    const state = presenceState(member);
    const stale = !member.lastActivityAt || Date.now() - new Date(member.lastActivityAt).getTime() > 1000 * 60 * 60 * 24 * 14;
    if (presenceFilter === "stale" && !stale) return false;
    if (presenceFilter !== "all" && presenceFilter !== "stale" && state !== presenceFilter && member.status !== presenceFilter) return false;
    const needle = presenceQuery.trim().toLowerCase();
    if (!needle) return true;
    return [displayUserName(member), member.username, member.email, member.title, member.department, member.teamName, member.statusMessage].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
  const presenceProgress = useProgressiveList(filteredPresenceUsers, {
    initial: 80,
    step: 80,
    resetKey: `${presenceFilter}|${presenceQuery}`,
  });
  const focusUserCount = users.filter((member) => ["focus", "busy"].includes(member.status || "")).length;
  const stalePresenceCount = users.filter((member) => !member.lastActivityAt || Date.now() - new Date(member.lastActivityAt).getTime() > 1000 * 60 * 60 * 24 * 14).length;
  if (embedded) {
    return (
      <section className="panel operations-live-v249" aria-label="Live operations activity">
        <header className="operations-live-head-v249">
          <div>
            <strong>Live operations</strong>
            <span>
              {filteredEvents.length} events · {activeNowUsers.length} active · {riskEvents.length} attention
            </span>
          </div>
          <div className="button-row">
            <ClusterNativeSelect value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)} aria-label="Activity period">
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="all">All time</option>
            </ClusterNativeSelect>
            <ClusterButton type="button" className="" onClick={() => void loadActivity()} variant="quiet" size="compact">
              Refresh
            </ClusterButton>
          </div>
        </header>
        <div className="operations-live-grid-v249">
          <div className="operations-live-stream-v249">
            <h3>Recent activity</h3>
            {recentEvents.length ? (
              recentEvents.slice(0, 7).map((event) => (
                <ClusterButton unstyled type="button" key={event.id} className={activityTone(event)} onClick={() => event.project?.id && onOpenProject(event.project.id)}>
                  <time>{formatRelativeTime(event.createdAt)}</time>
                  <span>
                    <strong>{event.title || typeLabel(event.type)}</strong>
                    <em>
                      {event.user ? displayUserName(event.user as any) : "Cluster"}
                      {event.project?.name ? ` · ${event.project.name}` : ""}
                    </em>
                  </span>
                  <b>{entityLabel(event.entityType)}</b>
                </ClusterButton>
              ))
            ) : (
              <div className="empty-state compact-empty">No activity in this period.</div>
            )}
          </div>
          <div className="operations-live-people-v249">
            <h3>People</h3>
            {users
              .slice()
              .sort((a, b) => (b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0) - (a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0))
              .slice(0, 6)
              .map((member) => (
                <div key={member.id}>
                  <PresenceAvatar userId={member.id} imageUrl={member.avatarUrl} label={displayUserName(member)} fallback={userInitial(member)} state={presenceState(member)} title={presenceLabel(member)} profilePeek />
                  <span>
                    <strong>{displayUserName(member)}</strong>
                    <em>{member.statusMessage || presenceLabel(member)}</em>
                  </span>
                </div>
              ))}
          </div>
          <div className="operations-live-projects-v249">
            <h3>Project signal</h3>
            {projectActivity.length ? (
              projectActivity.slice(0, 6).map((row) => (
                <ClusterButton unstyled type="button" key={row.id} onClick={() => row.id !== "workspace" && onOpenProject(row.id)}>
                  <span>
                    <strong>{row.name}</strong>
                    <em>
                      {row.count} event{row.count === 1 ? "" : "s"}
                    </em>
                  </span>
                  <b>{Math.round((row.count / Math.max(1, filteredEvents.length)) * 100)}%</b>
                </ClusterButton>
              ))
            ) : (
              <div className="empty-state compact-empty">No project activity.</div>
            )}
          </div>
        </div>
        {loading && !events.length ? <LoadingState label="Loading live activity" rows={4} compact /> : null}
        {loadError ? <RequestErrorState error={loadError} title="Live activity unavailable" onRetry={() => void loadActivity()} compact /> : null}
        {status && !loadError && <div className="status-box slim">{status}</div>}
      </section>
    );
  }
  return (
    <section className={`${embedded ? "activity-embedded-v246" : "page cluster-page-shell"} activity-page-v245 ${adminMode ? "activity-admin-mode-v245" : ""}`}>
      {!embedded && (
        <header className="activity-topbar-v245 cluster-page-header">
          <div>
            <h1>{adminMode ? "Activity + Status" : "Activity"}</h1>
            <span>
              {visibleEvents.length} events · {activeNowUsers.length} active · {clockedInEntries.length} clocked in
            </span>
          </div>
          <div className="button-row">
            {riskEvents.length > 0 && (
              <ClusterButton type="button" className="warning" onClick={() => setViewMode("audit")} variant="quiet" size="compact">
                {riskEvents.length} attention
              </ClusterButton>
            )}
            <ClusterButton type="button" className="" onClick={() => void loadActivity()} variant="secondary">
              Refresh
            </ClusterButton>
          </div>
        </header>
      )}

      {loading && !events.length ? <LoadingState label="Loading activity" rows={7} /> : null}
      {loadError ? <RequestErrorState error={loadError} title="Activity unavailable" onRetry={() => void loadActivity()} compact /> : null}

      <CompactSectionNav
        className="activity-view-nav-v245"
        label="Activity views"
        activeId={viewMode === "pulse" || viewMode === "users" ? "feed" : viewMode}
        onChange={setViewMode}
        primaryIds={["feed", "presence", "status", "audit"]}
        items={
          [
            {
              id: "feed",
              label: "Timeline",
              detail: `${filteredEvents.length}`,
            },
            {
              id: "presence",
              label: "People",
              detail: `${activeNowUsers.length}`,
            },
            { id: "status", label: "Projects", detail: `${projects.length}` },
            { id: "audit", label: "Audit", detail: `${riskEvents.length}` },
          ] as CompactSectionNavItem<ActivityViewMode>[]
        }
      />

      {(viewMode === "feed" || viewMode === "pulse" || viewMode === "users" || viewMode === "audit") && (
        <div className="activity-filterbar-v245">
          <ClusterTextInput type="search" aria-label="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" />
          <ClusterNativeSelect aria-label="Project filter" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </ClusterNativeSelect>
          <ClusterNativeSelect aria-label="Activity source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | "human" | "automation" | "system")}>
            <option value="all">All sources</option>
            <option value="human">People</option>
            <option value="automation">Automation</option>
            <option value="system">System</option>
          </ClusterNativeSelect>
          <ClusterNativeSelect aria-label="Time window" value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)}>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="all">All time</option>
          </ClusterNativeSelect>
          <ClusterNativeSelect aria-label="Entity filter" value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
            <option value="all">All records</option>
            <option value="user">Users</option>
            <option value="project">Projects</option>
            <option value="board">Boards</option>
            <option value="card">Cards</option>
            <option value="whiteboard">Whiteboards</option>
            <option value="video">Video</option>
            <option value="project_file">Files</option>
          </ClusterNativeSelect>
          <ClusterNativeSelect aria-label="Action filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All actions</option>
            <option value="login">Login</option>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
            <option value="moved">Moved</option>
            <option value="comment">Comment</option>
            <option value="uploaded">Uploaded</option>
            <option value="deleted">Deleted</option>
            <option value="archived">Archived</option>
            <option value="git_import">Git import</option>
          </ClusterNativeSelect>
          <ClusterButton type="button"
            className=""
            onClick={() => {
              setEntityFilter("all");
              setTypeFilter("all");
              setProjectFilter("all");
              setSourceFilter("all");
              setTimeWindow("all");
              setQuery("");
            }}
           variant="quiet" size="compact">
            Clear
          </ClusterButton>
        </div>
      )}

      {viewMode === "presence" && (
        <section className="activity-presence-console-v245">
          <div className="activity-presence-rail-v245">
            {[
              ["all", "All", users.length],
              ["active", "Active", activeNowUsers.length],
              ["focus", "Focus", focusUserCount],
              ["away", "Away", users.filter((member) => presenceState(member) === "away").length],
              ["offline", "Offline", users.filter((member) => presenceState(member) === "offline").length],
              ["stale", "Inactive", stalePresenceCount],
            ].map(([value, label, count]) => (
              <ClusterButton unstyled type="button" key={String(value)} className={presenceFilter === value ? "active" : ""} onClick={() => setPresenceFilter(String(value))}>
                <span>{label}</span>
                <strong>{count}</strong>
              </ClusterButton>
            ))}
            <ClusterTextInput type="search" value={presenceQuery} onChange={(event) => setPresenceQuery(event.target.value)} placeholder="Search people" aria-label="Search people" />
          </div>
          <div className="activity-presence-table-v245">
            <div className="activity-presence-head-v245">
              <span>Person</span>
              <span>State</span>
              <span>Current status</span>
              <span>Last signal</span>
            </div>
            {filteredPresenceUsers.length ? (
              presenceProgress.visibleItems.map((member) => (
                <article key={member.id}>
                  <span className="activity-person-v245">
                    <PresenceAvatar userId={member.id} imageUrl={member.avatarUrl} label={displayUserName(member)} fallback={userInitial(member)} state={presenceState(member)} title={presenceLabel(member)} />
                    <span>
                      <strong>{displayUserName(member)}</strong>
                      <em>{member.title || member.department || member.teamName || "Member"}</em>
                    </span>
                  </span>
                  <b>
                    <i className={`presence-dot-v083 inline ${presenceState(member)}`} />
                    {presenceLabel(member)}
                  </b>
                  <span>{member.statusMessage || "—"}</span>
                  <span>{member.lastActivityAt ? formatRelativeTime(member.lastActivityAt) : "Never"}</span>
                </article>
              ))
            ) : (
              <div className="empty-state compact-empty">No people match.</div>
            )}
            {presenceProgress.hasMore ? <div className="activity-load-more-v495"><ClusterButton size="compact" variant="quiet" onClick={presenceProgress.showMore}>Show {Math.min(80, presenceProgress.remaining)} more people · {presenceProgress.remaining} remaining</ClusterButton></div> : null}
          </div>
        </section>
      )}

      {viewMode === "status" && (
        <section className="activity-project-console-v245">
          <div className="activity-project-summary-v245">
            <span>
              <strong>{projects.filter((project) => !project.archived).length}</strong> active
            </span>
            <span>
              <strong>{projects.filter((project) => project.archived).length}</strong> archived
            </span>
            <span>
              <strong>{projects.filter((project) => !projectMemberIds(project).length).length}</strong> without leads
            </span>
            <span>
              <strong>{projects.filter((project) => !project.boards.length).length}</strong> without boards
            </span>
          </div>
          <div className="activity-project-table-v245">
            <div className="activity-project-head-v245">
              <span>Project</span>
              <span>Status</span>
              <span>Leads</span>
              <span>Boards</span>
              <span>Events</span>
              <span />
            </div>
            {projects.length ? (
              projects.map((project) => {
                const eventCount = projectActivity.find((item) => item.id === project.id)?.count || 0;
                return (
                  <article key={project.id} className={project.archived ? "archived" : ""}>
                    <span>
                      <strong>{project.name}</strong>
                      <em>{projectTypeLabel(project)}</em>
                    </span>
                    <b>{projectStatusLabel(project)}</b>
                    <span>{projectMemberIds(project).length}</span>
                    <span>{project.boards.length}</span>
                    <span>{eventCount}</span>
                    <ClusterButton type="button" className="" onClick={() => onOpenProject(project.id)} variant="quiet" size="compact">
                      Open
                    </ClusterButton>
                  </article>
                );
              })
            ) : (
              <div className="empty-state compact-empty">No projects.</div>
            )}
          </div>
        </section>
      )}

      {(viewMode === "feed" || viewMode === "pulse" || viewMode === "users" || viewMode === "audit") && (
        <div className="activity-source-strip-v416" aria-label="Activity source summary">
          <ClusterButton unstyled type="button" className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}><strong>{filteredEvents.length}</strong><span>All</span></ClusterButton>
          <ClusterButton unstyled type="button" className={sourceFilter === "human" ? "active" : ""} onClick={() => setSourceFilter("human")}><strong>{sourceCounts.human}</strong><span>People</span></ClusterButton>
          <ClusterButton unstyled type="button" className={sourceFilter === "automation" ? "active" : ""} onClick={() => setSourceFilter("automation")}><strong>{sourceCounts.automation}</strong><span>Automation</span></ClusterButton>
          <ClusterButton unstyled type="button" className={sourceFilter === "system" ? "active" : ""} onClick={() => setSourceFilter("system")}><strong>{sourceCounts.system}</strong><span>System</span></ClusterButton>
        </div>
      )}

      {(viewMode === "feed" || viewMode === "pulse" || viewMode === "users" || viewMode === "audit") && (
        <>
        {sourceFocus ? <div className="activity-source-filter-v493" role="status"><span>Showing activity for one work item.</span><ClusterButton type="button" className="" onClick={sourceDetailHistory.closeDetail} variant="quiet" size="compact">Clear work filter</ClusterButton></div> : null}
        <div className={`activity-workspace-v245 ${selectedEvent ? "has-detail" : ""}`}>
          <section className="activity-stream-v245">
            <header>
              <strong>{viewMode === "audit" ? "Audit timeline" : "Activity timeline"}</strong>
              <span>{activityProgress.visibleCount}/{visibleEvents.length}</span>
            </header>
            <div className="activity-stream-scroll-v245">
              {activityGroups.length ? (
                activityGroups.map(([group, groupEvents]) => (
                  <section className="activity-day-v245" key={group}>
                    <h2>
                      <span>{group}</span>
                      <b>{groupEvents.length}</b>
                    </h2>
                    {groupEvents.map((event) => (
                      <ClusterButton unstyled type="button" className={`activity-row-v245 ${activityTone(event)} ${selectedEvent?.id === event.id ? "selected" : ""}`} key={event.id} onClick={() => eventDetailHistory.openDetail(event.id)}>
                        <time>
                          {new Date(event.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        <PresenceAvatar userId={event.user?.id} imageUrl={event.user?.avatarUrl} label={event.user ? displayUserName(event.user) : "System"} fallback={event.user ? userInitial(event.user) : "S"} state={event.user ? presenceState(event.user) : "offline"} />
                        <span className="activity-row-copy-v245">
                          <strong>{event.title}</strong>
                          {event.message && <em>{event.message}</em>}
                        </span>
                        <span className="activity-row-context-v245">
                          <b>{event.project?.name || entityLabel(event.entityType)}</b>
                          <em>
                            {activitySourceLabel(activitySource(event))} · {typeLabel(event.type)}{notificationSignal(event).tool ? ` · ${notificationSignal(event).tool.replace(/_/g, " ")}` : ""}{notificationSignal(event).signal ? ` · ${notificationSignal(event).signal.replace(/_/g, " ")}` : ""}{notificationSignal(event).requiresAction ? " · action required" : ""} · {formatRelativeTime(event.createdAt)}
                          </em>
                        </span>
                      </ClusterButton>
                    ))}
                  </section>
                ))
              ) : (
                <div className="empty-state compact-empty">No matching activity.</div>
              )}
              {activityProgress.hasMore ? <div className="activity-load-more-v495"><ClusterButton size="compact" variant="quiet" onClick={activityProgress.showMore}>Show {Math.min(80, activityProgress.remaining)} more · {activityProgress.remaining} remaining</ClusterButton></div> : null}
            </div>
          </section>

          {selectedEvent && (
            <aside className="activity-detail-v245">
              <header>
                <div>
                  <strong>{selectedEvent.title}</strong>
                  <span>{new Date(selectedEvent.createdAt).toLocaleString()}</span>
                </div>
                <div className="button-row">{activityContext(selectedEvent) ? <WorkActionMenu context={{ ...activityContext(selectedEvent)!, navigation: null }} label={`${selectedEvent.title} actions`} triggerLabel="Actions" exclude={["open"]} /> : null}<ClusterButton type="button" className="" onClick={eventDetailHistory.closeDetail} variant="quiet" size="compact">Close</ClusterButton></div>
              </header>
              <dl>
                <div>
                  <dt>User</dt>
                  <dd>{selectedEvent.user ? displayUserName(selectedEvent.user) : "System"}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{activitySourceLabel(activitySource(selectedEvent))}</dd>
                </div>
                <div>
                  <dt>Action</dt>
                  <dd>{typeLabel(selectedEvent.type)}</dd>
                </div>
                <div>
                  <dt>Record</dt>
                  <dd>{entityLabel(selectedEvent.entityType)}</dd>
                </div>
                {notificationSignal(selectedEvent).tool ? <div><dt>Tool</dt><dd>{notificationSignal(selectedEvent).tool.replace(/_/g, " ")}</dd></div> : null}
                {notificationSignal(selectedEvent).signal ? <div><dt>Signal</dt><dd>{notificationSignal(selectedEvent).signal.replace(/_/g, " ")}{notificationSignal(selectedEvent).requiresAction ? " · action required" : ""}</dd></div> : null}
                <div>
                  <dt>Project</dt>
                  <dd>{selectedEvent.project?.name || "—"}</dd>
                </div>
                <div>
                  <dt>Board</dt>
                  <dd>{selectedEvent.board?.name || "—"}</dd>
                </div>
                <div>
                  <dt>Card</dt>
                  <dd>{selectedEvent.card?.title || "—"}</dd>
                </div>
              </dl>
              {selectedEvent.message && <p>{selectedEvent.message}</p>}
              {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 && (
                <details>
                  <summary>Metadata</summary>
                  <pre>{JSON.stringify(selectedEvent.metadata, null, 2)}</pre>
                </details>
              )}
            </aside>
          )}
        </div>
        </>
      )}

      {status && !loadError && <div className="status-box system-status-box-v053">{status}</div>}
    </section>
  );
}

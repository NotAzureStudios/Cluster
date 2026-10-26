import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { Children, useState, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { DesktopClipboardWidget } from "../desktop/DesktopClipboardWidget";
import type { DashboardWidgetKey, QuickCreateMode } from "../application/application-models";
import { homeWidgetRegistryEntry, type HomeWidgetConfig, type HomeWidgetRuntimeStatus, type HomeWidgetSize } from "./home-widget-model";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { workSourceFromNavigation } from "../workflow/work-actions";
import { useVisibleTicker } from "../../core/visible-ticker";
import { useHomeScopedCounts } from "./home-scoped-aggregate";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { InlineLoadingState } from "../../components/LoadingState";
import { RequestStatusLine } from "../../components/RequestState";
import { HealthStrip, TrendIndicator } from "../../components/ClusterVisualIntelligence";
import { CREATE_MODE_CATALOG } from "../create/create-mode-catalog";
import { filterHomeWidgetItems, homeWidgetNeedsScopedAggregates, HOME_SCOPED_AGGREGATES_UNAVAILABLE, type HomeWidgetRuntimeContext } from "./home-widget-runtime-policy";

export type HomeWidgetListItem = { id: string; title: string; detail?: string; value?: string | number; target?: string; workTarget?: ClusterWorkNavigationTarget | null; projectId?: string | null; userId?: string | null; roleId?: string | null; at?: string | null; savedViewId?: string | null };
export type BuiltInHomeWidgetData = {
  attention: HomeWidgetListItem[];
  projects: { total: number; ready: number; attention: number; boards: number; whiteboards: number; git: number; discord: number; recent: HomeWidgetListItem[] };
  myWork: { assigned: number; overdue: number; priority: number; blockers: number; today: number; next: HomeWidgetListItem[] };
  upcoming: HomeWidgetListItem[];
  scheduler: { week: string; running: number; active: boolean; activeDetail: string; today: HomeWidgetListItem[] };
  today: { scheduled: number; due: number; blockers: number; priority: number; items: HomeWidgetListItem[] };
  notifications: { attention: number; urgent: number };
  people: { total: number; active: number; spotlight: HomeWidgetListItem[] };
  peopleCapacity: { configured: number; totalHours: number; assigned: number; pressured: number; items: HomeWidgetListItem[] };
  departments: { total: number; staffed: number; active: number; items: HomeWidgetListItem[] };
  library: { total: number; pinned: number; recent: HomeWidgetListItem[]; topTypes: Array<{ label: string; value: number }> };
  watchlists: { total: number; muted: number; statusOnly: number; items: HomeWidgetListItem[] };
  handoff: { changes: number; attention: number; next: number; items: HomeWidgetListItem[] };
  builds: { total: number; testing: number; failed: number; approved: number; items: HomeWidgetListItem[] };
  timeline: HomeWidgetListItem[];
  qa: { total: number; open: number; failed: number; blocked: number; items: HomeWidgetListItem[] };
  releaseReadiness: { total: number; draft: number; ready: number; published: number; blocked: number; items: HomeWidgetListItem[] };
  sourceControl: { total: number; healthy: number; warning: number; failed: number; branches: number; commits: number; items: HomeWidgetListItem[] };
  reviewQueue: { total: number; awaiting: number; ready: number; changesRequested: number; items: HomeWidgetListItem[] };
  integrationHealth: { total: number; configured: number; healthy: number; attention: number; items: HomeWidgetListItem[] };
  savedViews: { total: number; scopes: number; shared: number; items: HomeWidgetListItem[] };
  tickets: { total: number; open: number; priority: number; items: HomeWidgetListItem[] };
  activity: HomeWidgetListItem[];
  digest: HomeWidgetListItem[];
  workflow: { links: number; recurring: number; watchers: number; closeouts: number; portals: number; attachments: number };
  admin: { setupGaps: number; maintenance: number; corrections: number; breakEntries: number };
  ticketAttention: { signals: number; projectAttention: number };
};

export type BuiltInHomeWidgetActions = {
  projects: () => void;
  project: (projectId: string) => void;
  board: (boardId: string) => void;
  myWork: () => void;
  scheduler: () => void;
  notifications: () => void;
  people: () => void;
  library: () => void;
  builds: () => void;
  qa: () => void;
  timeline: () => void;
  tickets: () => void;
  activity: () => void;

  admin: () => void;
  integrations: () => void;
  sourceControl: () => void;
  quickCreate: (mode: QuickCreateMode) => void;
  work: (target: ClusterWorkNavigationTarget) => void;
};

function limitFor(size: HomeWidgetSize, configured?: number) {
  if (configured && Number.isInteger(configured)) return Math.max(1, Math.min(8, configured));
  return size === "micro" ? 1 : size === "compact" ? 2 : size === "large" ? 6 : size === "feature" ? 8 : 4;
}

function WidgetHeader({ eyebrow, title, value }: { eyebrow?: string; title: string; value?: string | number }) {
  return <header className="home-widget-card-head-v484"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h3>{title}</h3></div>{value !== undefined && <span>{value}</span>}</header>;
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string | number; detail?: string }> }) {
  return <div className="home-widget-metrics-v484">{items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <em>{item.detail}</em>}</div>)}</div>;
}

function ItemList({ items, size, limit, onOpen, emptyLabel = "Nothing queued" }: { items: HomeWidgetListItem[]; size: HomeWidgetSize; limit?: number; onOpen?: (item: HomeWidgetListItem) => void; emptyLabel?: string }) {
  const visible = items.slice(0, limitFor(size, limit));
  return <div className="home-widget-list-v484">{visible.length ? visible.map((item) => {
    if (!onOpen) return <div key={item.id}><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.value !== undefined && <em>{item.value}</em>}</div>;
    const source = item.workTarget ? workSourceFromNavigation(item.workTarget, item.title) : null;
    return <div className="home-widget-list-row-v493" key={item.id}><ClusterButton unstyled type="button" className="home-widget-list-main-v493" onClick={() => onOpen(item)}><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.value !== undefined && <em>{item.value}</em>}</ClusterButton>{source && item.workTarget ? <WorkActionMenu iconOnly context={{ source, navigation: item.workTarget, projectId: source.projectId || item.workTarget.projectId || null }} label={`${item.title} actions`} allowMention={source.kind === "user"} /> : null}</div>;
  }) : <ClusterEmptyState compact kind="empty" title={emptyLabel} className="home-widget-empty-v485" />}</div>;
}

function WidgetLoadingState() {
  return <InlineLoadingState label="Loading widget" lines={3} className="home-widget-state-v485 loading" />;
}

function WidgetErrorState({ status }: { status: HomeWidgetRuntimeStatus }) {
  return <div className="home-widget-state-v485 error"><RequestStatusLine tone="danger" state="error">{status.error || "Cluster could not refresh this Home data."}</RequestStatusLine>{status.onRetry && <ClusterButton variant="secondary" size="compact" onClick={status.onRetry}>Retry</ClusterButton>}</div>;
}

function WidgetActions({ config, children }: { config?: HomeWidgetConfig; children: ReactNode }) {
  const actions = Children.toArray(children);
  const visible = config?.showActions === false ? actions.slice(0, 1) : actions;
  return visible.length ? <footer className="home-widget-actions-v484">{visible}</footer> : null;
}

function Shell({ size, className = "", status, children }: { size: HomeWidgetSize; className?: string; status?: HomeWidgetRuntimeStatus; children: ReactNode }) {
  return <article className={`home-widget-card-v484 ${className} ${status?.state === "error" ? "has-error" : ""}`} data-widget-size={size} aria-busy={status?.state === "loading" || undefined}>{status?.state === "loading" ? <WidgetLoadingState /> : status?.state === "error" ? <WidgetErrorState status={status} /> : children}</article>;
}

function LocalClock({ size, config, status, onOpen }: { size: HomeWidgetSize; config?: HomeWidgetConfig; status?: HomeWidgetRuntimeStatus; onOpen: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useVisibleTicker(() => setNow(new Date()), 30_000);
  const format = config?.clockFormat || "datetime";
  return <Shell size={size} status={status} className="clock"><WidgetHeader eyebrow="Local" title={format === "date" ? "Date" : "Time"} /><div className="home-widget-clock-v484">{format !== "date" && <strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>}{format !== "time" && <span>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>}</div><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={onOpen}>Open Scheduler</ClusterButton></WidgetActions></Shell>;
}


function applyBuiltInRuntimePolicy(data: BuiltInHomeWidgetData, config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext | undefined): BuiltInHomeWidgetData {
  if (!runtime || !config) return data;
  const apply = (items: HomeWidgetListItem[]) => filterHomeWidgetItems(items, config, runtime);
  return {
    ...data,
    attention: apply(data.attention), upcoming: apply(data.upcoming), timeline: apply(data.timeline), activity: apply(data.activity), digest: apply(data.digest),
    projects: { ...data.projects, recent: apply(data.projects.recent) }, myWork: { ...data.myWork, next: apply(data.myWork.next) }, scheduler: { ...data.scheduler, today: apply(data.scheduler.today) }, today: { ...data.today, items: apply(data.today.items) },
    people: { ...data.people, spotlight: apply(data.people.spotlight) }, peopleCapacity: { ...data.peopleCapacity, items: apply(data.peopleCapacity.items) }, departments: { ...data.departments, items: apply(data.departments.items) },
    library: { ...data.library, recent: apply(data.library.recent) }, watchlists: { ...data.watchlists, items: apply(data.watchlists.items) }, handoff: { ...data.handoff, items: apply(data.handoff.items) },
    builds: { ...data.builds, items: apply(data.builds.items) }, qa: { ...data.qa, items: apply(data.qa.items) }, releaseReadiness: { ...data.releaseReadiness, items: apply(data.releaseReadiness.items) },
    sourceControl: { ...data.sourceControl, items: apply(data.sourceControl.items) }, reviewQueue: { ...data.reviewQueue, items: apply(data.reviewQueue.items) }, integrationHealth: { ...data.integrationHealth, items: apply(data.integrationHealth.items) },
    savedViews: { ...data.savedViews, items: apply(data.savedViews.items) }, tickets: { ...data.tickets, items: apply(data.tickets.items) },
  };
}

export function BuiltInHomeWidget({ id, size, data, actions, note, onNoteChange, onAttentionAction, onSnooze, onDismiss, onClock, config, runtimeContext, status }: {
  id: DashboardWidgetKey;
  size: HomeWidgetSize;
  data: BuiltInHomeWidgetData;
  actions: BuiltInHomeWidgetActions;
  note: string;
  onNoteChange: (value: string) => void;
  onAttentionAction: (target?: string) => void;
  onSnooze: (id: string) => void;
  onDismiss: (id: string) => void;
  onClock: () => void;
  config?: HomeWidgetConfig;
  runtimeContext?: HomeWidgetRuntimeContext;
  status?: HomeWidgetRuntimeStatus;
}) {
  const visibleData = applyBuiltInRuntimePolicy(data, config, runtimeContext);
  // These numeric summaries are computed from server-wide projections, not
  // from complete filtered datasets. Show only filtered lists in scoped mode.
  const scopedAggregatesUnavailable = homeWidgetNeedsScopedAggregates(config);
  const authorizedCounts = useHomeScopedCounts(id === "projects" ? ["projects.total"] : id === "people" ? ["people.total"] : [], config, runtimeContext);
  if (scopedAggregatesUnavailable && !["clock", "note", "clipboard"].includes(id)) {
    const availableRows: Partial<Record<DashboardWidgetKey, HomeWidgetListItem[]>> = {
      projects: visibleData.projects.recent, myWork: visibleData.myWork.next,
      today: visibleData.today.items, people: visibleData.people.spotlight,
      peopleCapacity: visibleData.peopleCapacity.items, departments: visibleData.departments.items,
      builds: visibleData.builds.items, timeline: visibleData.timeline,
      qa: visibleData.qa.items, library: visibleData.library.recent,
      tickets: visibleData.tickets.items, activity: visibleData.activity,
      digest: visibleData.digest, upcoming: visibleData.upcoming,
      sourceControl: visibleData.sourceControl.items, reviewQueue: visibleData.reviewQueue.items,
      releaseReadiness: visibleData.releaseReadiness.items,
      integrationHealth: visibleData.integrationHealth.items, savedViews: visibleData.savedViews.items,
      watchlists: visibleData.watchlists.items, handoff: visibleData.handoff.items,
      needs: visibleData.attention, scheduler: visibleData.scheduler.today,
    };
    const rows = runtimeContext ? availableRows[id] || [] : [];
    return <Shell size={size} status={status} className="scoped-unavailable">
      <WidgetHeader eyebrow="Filtered Home" title={homeWidgetRegistryEntry(id)?.label || "Filtered widget"} />
      <p className="home-widget-custom-text-v484" role="status">{(id === "projects" && authorizedCounts.values["projects.total"]) || (id === "people" && authorizedCounts.values["people.total"]) ? "The labeled count comes from a complete authorized server query. Other scoped totals remain unavailable." : HOME_SCOPED_AGGREGATES_UNAVAILABLE}</p>
      {id === "projects" && authorizedCounts.values["projects.total"] && <div className="home-widget-custom-metric-v484"><span>Matching Projects · server verified</span><strong>{authorizedCounts.values["projects.total"].value}</strong></div>}
      {id === "people" && authorizedCounts.values["people.total"] && <div className="home-widget-custom-metric-v484"><span>Matching people · server verified</span><strong>{authorizedCounts.values["people.total"].value}</strong></div>}
      {authorizedCounts.pending && (id === "projects" || id === "people") && <small role="status">Checking authorized count…</small>}
      <ItemList items={rows} size={size} limit={config?.listLimit} emptyLabel="No matching visible items." onOpen={(item) => item.workTarget ? actions.work(item.workTarget) : undefined} />
    </Shell>;
  }
  const openItem = (item: HomeWidgetListItem, fallback: () => void) => item.workTarget ? actions.work(item.workTarget) : fallback();
  const renderers: Partial<Record<DashboardWidgetKey, () => ReactNode>> = {};
  renderers.clock = () => <LocalClock size={size} config={config} status={status} onOpen={actions.scheduler} />;
  renderers.clipboard = () => <Shell size={size} status={status} className="native"><WidgetHeader eyebrow="Desktop" title="Clipboard" /><DesktopClipboardWidget /></Shell>;
  renderers.note = () => <Shell size={size} status={status} className="note"><WidgetHeader eyebrow="Personal" title={config?.noteTitle || "Note"} /><ClusterTextArea value={note} maxLength={600} placeholder="Add a note for Home…" onChange={(event) => onNoteChange(event.target.value)} /><span className="home-widget-note-count-v484">{note.length}/600</span></Shell>;

  renderers.brief = () => {
    const top = visibleData.attention[0];
    return <Shell size={size} status={status} className="brief"><WidgetHeader eyebrow="Priority brief" title={top ? top.title : "No critical alerts"} value={visibleData.notifications.urgent ? `${visibleData.notifications.urgent} urgent` : "Clear"} />{top ? <><p className="home-widget-brief-detail-v484">{top.detail}</p><WidgetActions config={config}><ClusterButton variant="primary" size="compact" onClick={() => onAttentionAction(top.target)}>Open</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => onSnooze(top.id)}>Snooze 4h</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => onDismiss(top.id)}>Dismiss</ClusterButton></WidgetActions></> : <WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.notifications}>Open Inbox</ClusterButton></WidgetActions>}</Shell>;
  };

  renderers.roleFocus = renderers.myWork = () => <Shell size={size} status={status}><WidgetHeader eyebrow={id === "roleFocus" ? "Your day" : "My Work"} title={id === "roleFocus" ? "Focus and schedule" : "Assigned work"} value={visibleData.myWork.assigned} /><MetricGrid items={[{ label: "Assigned", value: visibleData.myWork.assigned }, { label: "Overdue", value: visibleData.myWork.overdue }, { label: "Blocked", value: visibleData.myWork.blockers }, { label: "Priority", value: visibleData.myWork.priority }, { label: "Today", value: visibleData.myWork.today }]} /><ItemList limit={config?.listLimit} items={visibleData.myWork.next} size={size} emptyLabel="No assigned work." onOpen={(item) => openItem(item, actions.myWork)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.myWork}>Open My Work</ClusterButton></WidgetActions></Shell>;

  renderers.upcoming = () => <Shell size={size} status={status}><WidgetHeader eyebrow="My Work" title="Upcoming work" value={visibleData.upcoming.length} /><ItemList limit={config?.listLimit} items={visibleData.upcoming} size={size} emptyLabel="No upcoming work." onOpen={(item) => openItem(item, actions.myWork)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.myWork}>Open My Work</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={actions.timeline}>Open Timeline</ClusterButton></WidgetActions></Shell>;

  renderers.readiness = renderers.projects = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Projects" title={id === "readiness" ? "Project readiness" : "Project pulse"} value={`${visibleData.projects.ready}/${visibleData.projects.total}`} /><HealthStrip label="Project health" items={[{ id: "ready", label: "Ready", value: visibleData.projects.ready, tone: visibleData.projects.attention ? "neutral" : "good" }, { id: "attention", label: "Needs work", value: visibleData.projects.attention, tone: visibleData.projects.attention ? "warning" : "good" }]} /><MetricGrid items={[{ label: "Ready", value: visibleData.projects.ready }, { label: "Needs work", value: visibleData.projects.attention }, { label: "Boards", value: visibleData.projects.boards }, { label: "Repositories", value: visibleData.projects.git }]} /><ItemList limit={config?.listLimit} items={visibleData.projects.recent} size={size} onOpen={(item) => openItem(item, actions.projects)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;

  renderers.needs = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Signals" title="Needs attention" value={visibleData.attention.length} />{visibleData.attention.length ? <div className="home-widget-attention-list-v484">{visibleData.attention.slice(0, limitFor(size, config?.listLimit)).map((item) => <div key={item.id}><ClusterButton unstyled type="button" onClick={() => onAttentionAction(item.target)}><strong>{item.title}</strong><span>{item.detail}</span></ClusterButton><aside><ClusterButton variant="quiet" size="compact" onClick={() => onSnooze(item.id)}>Later</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={() => onDismiss(item.id)}>Dismiss</ClusterButton></aside></div>)}</div> : <div className="home-widget-empty-v485"><strong>Nothing needs attention</strong><span>Urgent and follow-up signals will appear here.</span></div>}<WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.notifications}>Open Inbox</ClusterButton></WidgetActions></Shell>;

  renderers.scheduler = renderers.pulse = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Scheduler" title={visibleData.scheduler.active ? "Clocked in" : "Clocked out"} value={visibleData.scheduler.week} /><MetricGrid items={[{ label: "Running", value: visibleData.scheduler.running }, { label: "Today", value: visibleData.scheduler.today.length }, { label: "People active", value: `${visibleData.people.active}/${visibleData.people.total}` }, { label: "Library", value: visibleData.library.total }]} />{visibleData.scheduler.active && <p className="home-widget-brief-detail-v484">{visibleData.scheduler.activeDetail}</p>}<ItemList limit={config?.listLimit} items={visibleData.scheduler.today} size={size} onOpen={(item) => openItem(item, actions.scheduler)} /><WidgetActions config={config}><ClusterButton variant={visibleData.scheduler.active ? "danger" : "primary"} size="compact" onClick={onClock}>{visibleData.scheduler.active ? "Clock out" : "Clock in"}</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={actions.scheduler}>Open Scheduler</ClusterButton></WidgetActions></Shell>;

  renderers.inbox = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Inbox" title="Notification pulse" value={visibleData.notifications.attention} /><MetricGrid items={[{ label: "Attention", value: visibleData.notifications.attention }, { label: "Urgent", value: visibleData.notifications.urgent }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.notifications}>Open Inbox</ClusterButton></WidgetActions></Shell>;
  renderers.today = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Today" title="Execution focus" value={visibleData.today.scheduled + visibleData.today.due} /><MetricGrid items={[{ label: "Schedule", value: visibleData.today.scheduled }, { label: "Due", value: visibleData.today.due }, { label: "Blockers", value: visibleData.today.blockers }, { label: "Priority", value: visibleData.today.priority }]} /><ItemList limit={config?.listLimit} items={visibleData.today.items} size={size} emptyLabel="Nothing scheduled or due today." onOpen={(item) => openItem(item, actions.myWork)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.myWork}>Open My Work</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={actions.scheduler}>Open Scheduler</ClusterButton></WidgetActions></Shell>;

  renderers.people = () => <Shell size={size} status={status}><WidgetHeader eyebrow="People" title="Availability" value={`${visibleData.people.active}/${visibleData.people.total}`} /><ItemList limit={config?.listLimit} items={visibleData.people.spotlight} size={size} onOpen={(item) => openItem(item, actions.people)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.people}>Open People</ClusterButton></WidgetActions></Shell>;
  renderers.peopleCapacity = () => <Shell size={size} status={status}><WidgetHeader eyebrow="People" title="Capacity" value={`${visibleData.peopleCapacity.configured}/${visibleData.people.total}`} /><MetricGrid items={[{ label: "Configured", value: visibleData.peopleCapacity.configured }, { label: "Capacity", value: `${visibleData.peopleCapacity.totalHours}h` }, { label: "Assigned", value: visibleData.peopleCapacity.assigned }, { label: "Pressure", value: visibleData.peopleCapacity.pressured }]} /><ItemList limit={config?.listLimit} items={visibleData.peopleCapacity.items} size={size} emptyLabel="No capacity data yet." onOpen={(item) => openItem(item, actions.people)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.people}>Open People</ClusterButton></WidgetActions></Shell>;
  renderers.departments = () => <Shell size={size} status={status}><WidgetHeader eyebrow="People" title="Department pulse" value={visibleData.departments.total} /><MetricGrid items={[{ label: "Departments", value: visibleData.departments.total }, { label: "Staffed", value: visibleData.departments.staffed }, { label: "Active people", value: visibleData.departments.active }]} /><ItemList limit={config?.listLimit} items={visibleData.departments.items} size={size} emptyLabel="No department data yet." /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.people}>Open People</ClusterButton></WidgetActions></Shell>;

  renderers.builds = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Builds" title="Build health" value={visibleData.builds.total} /><HealthStrip label="Build health" items={[{ id: "testing", label: "Testing", value: visibleData.builds.testing, tone: visibleData.builds.testing ? "accent" : "neutral" }, { id: "failed", label: "Failed / blocked", value: visibleData.builds.failed, tone: visibleData.builds.failed ? "danger" : "good" }, { id: "approved", label: "Approved", value: visibleData.builds.approved, tone: visibleData.builds.approved ? "good" : "neutral" }]} /><MetricGrid items={[{ label: "Testing", value: visibleData.builds.testing }, { label: "Failed / blocked", value: visibleData.builds.failed }, { label: "Approved", value: visibleData.builds.approved }]} /><ItemList limit={config?.listLimit} items={visibleData.builds.items} size={size} emptyLabel="No build artifacts yet." onOpen={(item) => openItem(item, actions.builds)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.builds}>Open Builds</ClusterButton></WidgetActions></Shell>;
  renderers.timeline = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Timeline" title="Upcoming milestones" value={visibleData.timeline.length} /><ItemList limit={config?.listLimit} items={visibleData.timeline} size={size} onOpen={(item) => openItem(item, actions.timeline)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.timeline}>Open Timeline</ClusterButton></WidgetActions></Shell>;
  renderers.activity = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Activity" title="Recent changes" value={visibleData.activity.length} /><ItemList limit={config?.listLimit} items={visibleData.activity} size={size} onOpen={(item) => openItem(item, actions.activity)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.activity}>Open Activity</ClusterButton></WidgetActions></Shell>;
  renderers.digest = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Session" title="Since last open" value={visibleData.digest.length} /><ItemList limit={config?.listLimit} items={visibleData.digest} size={size} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.activity}>Open Activity</ClusterButton></WidgetActions></Shell>;

  renderers.control = renderers.workflow = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Projects" title={id === "control" ? "Project controls" : "Workflow operations"} /><MetricGrid items={[{ label: "Dependencies", value: visibleData.workflow.links }, { label: "Recurring", value: visibleData.workflow.recurring }, { label: "Watchers", value: visibleData.workflow.watchers }, { label: "Closeouts", value: visibleData.workflow.closeouts }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.closeout = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Delivery" title="Closeout" /><MetricGrid items={[{ label: "Closeouts", value: visibleData.workflow.closeouts }, { label: "External rules", value: visibleData.workflow.portals }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.attachments = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Files" title="Attachments" value={visibleData.workflow.attachments} /><p className="muted">Cross-project attachment records currently tracked by Operations.</p><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.coverage = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Projects" title="Coverage" /><MetricGrid items={[{ label: "Source Control", value: `${visibleData.projects.git}/${visibleData.projects.total}` }, { label: "Discord", value: `${visibleData.projects.discord}/${visibleData.projects.total}` }, { label: "Boards", value: visibleData.projects.boards }, { label: "Whiteboards", value: visibleData.projects.whiteboards }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;

  renderers.qa = () => <Shell size={size} status={status}><WidgetHeader eyebrow="QA" title="Quality pulse" value={visibleData.qa.total} /><HealthStrip label="QA health" items={[{ id: "open", label: "Open", value: visibleData.qa.open, tone: visibleData.qa.open ? "accent" : "neutral" }, { id: "failed", label: "Failed", value: visibleData.qa.failed, tone: visibleData.qa.failed ? "danger" : "good" }, { id: "blocked", label: "Blocked", value: visibleData.qa.blocked, tone: visibleData.qa.blocked ? "warning" : "good" }]} /><TrendIndicator label="Resolved QA work" current={Math.max(0, visibleData.qa.total - visibleData.qa.open)} previous={Math.max(0, visibleData.qa.total - visibleData.qa.open - visibleData.qa.failed)} /><MetricGrid items={[{ label: "Plans", value: visibleData.qa.total }, { label: "Open", value: visibleData.qa.open }, { label: "Failed", value: visibleData.qa.failed }, { label: "Blocked", value: visibleData.qa.blocked }]} /><ItemList limit={config?.listLimit} items={visibleData.qa.items} size={size} emptyLabel="No QA plans." onOpen={(item) => openItem(item, actions.qa)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.qa}>Open QA</ClusterButton></WidgetActions></Shell>;
  renderers.releaseReadiness = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Delivery" title="Release readiness" value={visibleData.releaseReadiness.total} /><HealthStrip label="Release health" items={[{ id: "ready", label: "Ready", value: visibleData.releaseReadiness.ready, tone: visibleData.releaseReadiness.ready ? "good" : "neutral" }, { id: "blocked", label: "Blocked", value: visibleData.releaseReadiness.blocked, tone: visibleData.releaseReadiness.blocked ? "danger" : "good" }, { id: "published", label: "Published", value: visibleData.releaseReadiness.published, tone: visibleData.releaseReadiness.published ? "accent" : "neutral" }]} /><MetricGrid items={[{ label: "Draft", value: visibleData.releaseReadiness.draft }, { label: "Ready", value: visibleData.releaseReadiness.ready }, { label: "Published", value: visibleData.releaseReadiness.published }, { label: "Blocked", value: visibleData.releaseReadiness.blocked }]} /><ItemList limit={config?.listLimit} items={visibleData.releaseReadiness.items} size={size} emptyLabel="No releases yet." onOpen={(item) => openItem(item, actions.builds)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.builds}>Open Builds</ClusterButton></WidgetActions></Shell>;
  renderers.sourceControl = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Source Control" title="Repository health" value={visibleData.sourceControl.total} /><HealthStrip label="Repository health" items={[{ id: "healthy", label: "Healthy", value: visibleData.sourceControl.healthy, tone: visibleData.sourceControl.failed || visibleData.sourceControl.warning ? "neutral" : "good" }, { id: "warning", label: "Warning", value: visibleData.sourceControl.warning, tone: visibleData.sourceControl.warning ? "warning" : "good" }, { id: "failed", label: "Failed", value: visibleData.sourceControl.failed, tone: visibleData.sourceControl.failed ? "danger" : "good" }]} /><MetricGrid items={[{ label: "Repositories", value: visibleData.sourceControl.total }, { label: "Branches", value: visibleData.sourceControl.branches }, { label: "Commits", value: visibleData.sourceControl.commits }]} /><ItemList limit={config?.listLimit} items={visibleData.sourceControl.items} size={size} emptyLabel="No synchronized repositories." onOpen={(item) => openItem(item, actions.projects)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.reviewQueue = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Source Control" title="Review queue" value={visibleData.reviewQueue.total} /><MetricGrid items={[{ label: "Awaiting you", value: visibleData.reviewQueue.awaiting }, { label: "Ready", value: visibleData.reviewQueue.ready }, { label: "Changes", value: visibleData.reviewQueue.changesRequested }]} /><ItemList limit={config?.listLimit} items={visibleData.reviewQueue.items} size={size} emptyLabel="No open reviews in accessible projects." onOpen={(item) => openItem(item, actions.projects)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.integrationHealth = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Integrations" title="Provider health" value={visibleData.integrationHealth.total} /><HealthStrip label="Integration health" items={[{ id: "healthy", label: "Healthy", value: visibleData.integrationHealth.healthy, tone: visibleData.integrationHealth.attention ? "neutral" : "good" }, { id: "attention", label: "Attention", value: visibleData.integrationHealth.attention, tone: visibleData.integrationHealth.attention ? "warning" : "good" }]} /><MetricGrid items={[{ label: "Providers", value: visibleData.integrationHealth.total }, { label: "Configured", value: visibleData.integrationHealth.configured }, { label: "Healthy", value: visibleData.integrationHealth.healthy }, { label: "Attention", value: visibleData.integrationHealth.attention }]} /><ItemList limit={config?.listLimit} items={visibleData.integrationHealth.items} size={size} emptyLabel="No integration providers available." /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.integrations}>Open Integrations</ClusterButton></WidgetActions></Shell>;
  renderers.tickets = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Tickets" title="Assigned ticket sample" value={visibleData.tickets.open} /><MetricGrid items={[{ label: "Loaded (max 40)", value: visibleData.tickets.total }, { label: "Open in sample", value: visibleData.tickets.open }, { label: "Priority in sample", value: visibleData.tickets.priority }]} /><ItemList limit={config?.listLimit} items={visibleData.tickets.items} size={size} emptyLabel="No open tickets." onOpen={(item) => openItem(item, actions.tickets)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.tickets}>Open Tickets</ClusterButton></WidgetActions></Shell>;
  renderers.deliveryAttention = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Tickets" title="Delivery attention" value={visibleData.ticketAttention.signals} /><MetricGrid items={[{ label: "Signals", value: visibleData.ticketAttention.signals }, { label: "Projects", value: visibleData.ticketAttention.projectAttention }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.tickets}>Open Tickets</ClusterButton></WidgetActions></Shell>;
  renderers.library = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Library" title="Files and assets" value={visibleData.library.total} /><MetricGrid items={[{ label: "Pinned", value: visibleData.library.pinned }, ...visibleData.library.topTypes]} /><ItemList limit={config?.listLimit} items={visibleData.library.recent} size={size} emptyLabel="No Library items yet." onOpen={(item) => openItem(item, actions.library)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.library}>Open Library</ClusterButton></WidgetActions></Shell>;
  renderers.libraryActivity = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Library" title="Recent activity" value={visibleData.library.recent.length} /><MetricGrid items={[{ label: "Pinned", value: visibleData.library.pinned }, ...visibleData.library.topTypes.slice(0, 2)]} /><ItemList limit={config?.listLimit} items={visibleData.library.recent} size={size} emptyLabel="No recent Library activity." onOpen={(item) => openItem(item, actions.library)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.library}>Open Library</ClusterButton></WidgetActions></Shell>;
  renderers.watchlists = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Shared work" title="Watchlists" value={visibleData.watchlists.total} /><MetricGrid items={[{ label: "Watching", value: visibleData.watchlists.total }, { label: "Muted", value: visibleData.watchlists.muted }, { label: "Status only", value: visibleData.watchlists.statusOnly }]} /><ItemList limit={config?.listLimit} items={visibleData.watchlists.items} size={size} emptyLabel="You are not watching any project work." /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.projects}>Open Projects</ClusterButton></WidgetActions></Shell>;
  renderers.savedViews = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Workspace" title="Saved views" value={visibleData.savedViews.total} /><MetricGrid items={[{ label: "Views", value: visibleData.savedViews.total }, { label: "Workspaces", value: visibleData.savedViews.scopes }, { label: "Studio", value: visibleData.savedViews.shared }]} /><ItemList limit={config?.listLimit} items={visibleData.savedViews.items} size={size} emptyLabel="No named saved views yet." onOpen={(item) => item.workTarget ? actions.work(item.workTarget) : undefined} /></Shell>;
  renderers.quickCapture = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Create" title="Quick capture" /><div className="home-widget-action-grid-v484">{CREATE_MODE_CATALOG.map((mode, index) => <ClusterButton key={mode.id} size="compact" variant={index === 0 ? "primary" : "quiet"} onClick={() => actions.quickCreate(mode.id)}>{mode.label}</ClusterButton>)}</div></Shell>;
  renderers.handoff = () => <Shell size={size} status={status}><WidgetHeader eyebrow="Handoff" title="Resume context" value={visibleData.handoff.changes} /><MetricGrid items={[{ label: "Changes", value: visibleData.handoff.changes }, { label: "Attention", value: visibleData.handoff.attention }, { label: "Next", value: visibleData.handoff.next }]} /><ItemList limit={config?.listLimit} items={visibleData.handoff.items} size={size} emptyLabel="No handoff context waiting." onOpen={(item) => openItem(item, actions.activity)} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.activity}>Open Activity</ClusterButton><ClusterButton variant="quiet" size="compact" onClick={actions.myWork}>Open My Work</ClusterButton></WidgetActions></Shell>;

  renderers.opsHealth = renderers.adminOverview = renderers.adminHealth = () => <Shell size={size} status={status} className="admin"><WidgetHeader eyebrow="Administration" title={id === "opsHealth" ? "Operations health" : id === "adminOverview" ? "Admin overview" : "Admin health"} /><MetricGrid items={[{ label: "Setup gaps", value: visibleData.admin.setupGaps }, { label: "Maintenance", value: visibleData.admin.maintenance }, { label: "Corrections", value: visibleData.admin.corrections }, { label: "Break records", value: visibleData.admin.breakEntries }]} /><WidgetActions config={config}><ClusterButton variant="quiet" size="compact" onClick={actions.admin}>Open Administration</ClusterButton></WidgetActions></Shell>;

  const rendererKey = homeWidgetRegistryEntry(id)?.renderer as DashboardWidgetKey | undefined;
  return renderers[rendererKey || id]?.() ?? null;
}

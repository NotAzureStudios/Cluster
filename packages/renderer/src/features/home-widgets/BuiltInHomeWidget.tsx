import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { useState, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { DashboardWidgetKey, QuickCreateMode } from "../application/application-models";
import { homeWidgetRegistryEntry, type HomeWidgetConfig, type HomeWidgetRuntimeStatus, type HomeWidgetSize } from "./home-widget-model";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { workSourceFromNavigation } from "../workflow/work-actions";
import { useVisibleTicker } from "../../core/visible-ticker";
import { useHomeScopedCounts } from "./home-scoped-aggregate";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { InlineLoadingState } from "../../components/LoadingState";
import { RequestStatusLine } from "../../components/RequestState";
import { CREATE_MODE_CATALOG } from "../create/create-mode-catalog";
import { filterHomeWidgetItems, homeWidgetNeedsScopedAggregates, HOME_SCOPED_AGGREGATES_UNAVAILABLE, type HomeWidgetRuntimeContext } from "./home-widget-runtime-policy";

export type HomeWidgetListItem = { id: string; title: string; detail?: string; value?: string | number; target?: string; workTarget?: ClusterWorkNavigationTarget | null; projectId?: string | null; userId?: string | null; roleId?: string | null; at?: string | null };
export type BuiltInHomeWidgetData = {
  attention: HomeWidgetListItem[];
  projects: { total: number; ready: number; attention: number; boards: number; git: number; recent: HomeWidgetListItem[] };
  myWork: { assigned: number; overdue: number; priority: number; blockers: number; today: number; next: HomeWidgetListItem[] };
  upcoming: HomeWidgetListItem[];
  scheduler: { week: string; running: number; active: boolean; activeDetail: string; today: HomeWidgetListItem[] };
  notifications: { attention: number; urgent: number };
  people: { total: number; active: number; spotlight: HomeWidgetListItem[] };
  peopleCapacity: { configured: number; totalHours: number; assigned: number; pressured: number; items: HomeWidgetListItem[] };
  library: { total: number; pinned: number; recent: HomeWidgetListItem[] };
  builds: { total: number; testing: number; failed: number; approved: number; items: HomeWidgetListItem[] };
  timeline: HomeWidgetListItem[];
  qa: { total: number; open: number; failed: number; blocked: number; items: HomeWidgetListItem[] };
  sourceControl: { total: number; healthy: number; warning: number; failed: number; branches: number; commits: number; items: HomeWidgetListItem[] };
  reviewQueue: { total: number; awaiting: number; ready: number; changesRequested: number; items: HomeWidgetListItem[] };
  tickets: { total: number; open: number; priority: number; items: HomeWidgetListItem[] };
  activity: HomeWidgetListItem[];
  admin: { setupGaps: number; maintenance: number; corrections: number; breakEntries: number };
};

export type BuiltInHomeWidgetActions = {
  projects: () => void;
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
  quickCreate: (mode: QuickCreateMode) => void;
  work: (target: ClusterWorkNavigationTarget) => void;
};

/** Home reads at most this many assigned tickets; a full sample shows "N+". */
const HOME_TICKET_SAMPLE = 40;

type Tone = "good" | "warning" | "danger" | "accent";
type Stat = { label: string; value: string | number; tone?: Tone };

/* How much a footprint holds. Small is a glance (one number), medium adds a
   stat row and a couple of rows, large and extra large fill with the list. */
const LIST_ROWS: Record<HomeWidgetSize, number> = { small: 0, medium: 2, large: 6, xlarge: 6 };

function tone(value: number, kind: Tone): Tone | undefined {
  return value > 0 ? kind : undefined;
}

function Card({ id, size, status, title, count, onOpen, filtered, children, className = "" }: {
  id: DashboardWidgetKey;
  size: HomeWidgetSize;
  status?: HomeWidgetRuntimeStatus;
  title?: string;
  count?: string | number;
  onOpen?: () => void;
  filtered?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const entry = homeWidgetRegistryEntry(id);
  const label = title || entry?.label || id;
  const heading = <><ClusterIcon name={entry?.icon || "grid"} /><span>{label}</span>{onOpen && <ClusterIcon name="chevron-right" className="hw-go" />}</>;
  return (
    <article className={`hw-card ${className}`} data-widget={id} data-size={size} aria-busy={status?.state === "loading" || undefined}>
      <header className="hw-head">
        {onOpen ? <ClusterButton unstyled className="hw-title" onClick={onOpen}>{heading}</ClusterButton> : <h3 className="hw-title">{heading}</h3>}
        {filtered && <span className="hw-tag" role="status" title={HOME_SCOPED_AGGREGATES_UNAVAILABLE}>Filtered<span className="sr-only">. {HOME_SCOPED_AGGREGATES_UNAVAILABLE}</span></span>}
        {count !== undefined && !filtered && <span className="hw-count">{count}</span>}
      </header>
      <div className="hw-body">
        {status?.state === "loading" ? <InlineLoadingState label="Loading" lines={size === "small" ? 2 : 3} className="hw-state" />
          : status?.state === "error" ? <div className="hw-state hw-error"><RequestStatusLine tone="danger" state="error">{status.error || "Couldn't refresh."}</RequestStatusLine>{status.onRetry && <ClusterButton variant="quiet" size="compact" onClick={status.onRetry}>Retry</ClusterButton>}</div>
          : children}
      </div>
    </article>
  );
}

function Hero({ value, label, tone: heroTone }: { value: string | number; label: string; tone?: Tone }) {
  return <div className="hw-hero" data-tone={heroTone}><strong>{value}</strong><span>{label}</span></div>;
}

function Stats({ items }: { items: Stat[] }) {
  return <div className="hw-stats">{items.map((item) => <div key={item.label} data-tone={item.tone}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>;
}

function Bar({ parts }: { parts: Array<{ label: string; value: number; tone?: Tone }> }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  return <div className="hw-bar" role="img" aria-label={parts.map((part) => `${part.value} ${part.label}`).join(", ")}>{parts.filter((part) => part.value).map((part) => <i key={part.label} data-tone={part.tone} style={{ flexGrow: part.value }} />)}</div>;
}

function Rows({ items, limit, empty, onOpen }: { items: HomeWidgetListItem[]; limit: number; empty: string; onOpen?: (item: HomeWidgetListItem) => void }) {
  if (!limit) return null;
  const visible = items.slice(0, limit);
  if (!visible.length) return <p className="hw-empty">{empty}</p>;
  return <ul className="hw-rows">{visible.map((item) => {
    const source = item.workTarget ? workSourceFromNavigation(item.workTarget, item.title) : null;
    const body = <><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.value !== undefined && <em>{item.value}</em>}</>;
    return <li key={item.id}>
      {onOpen ? <ClusterButton unstyled className="hw-row" onClick={() => onOpen(item)}>{body}</ClusterButton> : <div className="hw-row">{body}</div>}
      {source && item.workTarget ? <WorkActionMenu iconOnly context={{ source, navigation: item.workTarget, projectId: source.projectId || item.workTarget.projectId || null }} label={`${item.title} actions`} allowMention={source.kind === "user"} /> : null}
    </li>;
  })}</ul>;
}

/** The common shape: a glance number when small, stats and rows as it grows. */
function Summary({ size, hero, stats = [], bar, list, empty, onOpenItem, footer }: {
  size: HomeWidgetSize;
  hero?: { value: string | number; label: string; tone?: Tone };
  stats?: Stat[];
  bar?: ReactNode;
  list?: HomeWidgetListItem[];
  empty?: string;
  onOpenItem?: (item: HomeWidgetListItem) => void;
  footer?: ReactNode;
}) {
  if (size === "small") {
    return <>
      {hero && <Hero {...hero} />}
      {stats.length > 0 && <p className="hw-sub">{stats.slice(0, 2).map((stat) => <span key={stat.label} data-tone={stat.tone}>{stat.value} {stat.label.toLowerCase()}</span>)}</p>}
      {!hero && list && <Rows items={list} limit={1} empty={empty || "Nothing yet"} onOpen={onOpenItem} />}
      {footer && <div className="hw-foot">{footer}</div>}
    </>;
  }
  const allStats = hero ? [{ label: hero.label, value: hero.value, tone: hero.tone }, ...stats] : stats;
  const rows = list ? LIST_ROWS[size] - (bar && size !== "medium" ? 1 : 0) - (footer ? 1 : 0) : 0;
  return <>
    {allStats.length > 0 && <Stats items={allStats.slice(0, size === "medium" ? 4 : 6)} />}
    {size !== "medium" && bar}
    {list && <Rows items={list} limit={Math.max(rows, 1)} empty={empty || "Nothing yet"} onOpen={onOpenItem} />}
    {!list && size === "medium" && bar}
    {footer && <div className="hw-foot">{footer}</div>}
  </>;
}

function LocalClock({ size, config }: { size: HomeWidgetSize; config?: HomeWidgetConfig }) {
  const [now, setNow] = useState(() => new Date());
  useVisibleTicker(() => setNow(new Date()), 30_000);
  const format = config?.clockFormat || "datetime";
  return <div className="hw-clock">
    {format !== "date" && <strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>}
    {format !== "time" && <span>{now.toLocaleDateString([], size === "small" ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "long", month: "long", day: "numeric" })}</span>}
  </div>;
}

function applyRuntimePolicy(data: BuiltInHomeWidgetData, config: HomeWidgetConfig | undefined, runtime: HomeWidgetRuntimeContext | undefined): BuiltInHomeWidgetData {
  if (!runtime || !config) return data;
  const apply = (items: HomeWidgetListItem[]) => filterHomeWidgetItems(items, config, runtime);
  return {
    ...data,
    attention: apply(data.attention), upcoming: apply(data.upcoming), timeline: apply(data.timeline), activity: apply(data.activity),
    projects: { ...data.projects, recent: apply(data.projects.recent) }, myWork: { ...data.myWork, next: apply(data.myWork.next) }, scheduler: { ...data.scheduler, today: apply(data.scheduler.today) },
    people: { ...data.people, spotlight: apply(data.people.spotlight) }, peopleCapacity: { ...data.peopleCapacity, items: apply(data.peopleCapacity.items) },
    library: { ...data.library, recent: apply(data.library.recent) }, builds: { ...data.builds, items: apply(data.builds.items) }, qa: { ...data.qa, items: apply(data.qa.items) },
    sourceControl: { ...data.sourceControl, items: apply(data.sourceControl.items) }, reviewQueue: { ...data.reviewQueue, items: apply(data.reviewQueue.items) }, tickets: { ...data.tickets, items: apply(data.tickets.items) },
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
  const d = applyRuntimePolicy(data, config, runtimeContext);
  // Counts come from studio-wide projections, not from the filtered lists.
  // A scoped widget shows only its filtered rows, plus a server-verified total
  // where one exists.
  const scoped = homeWidgetNeedsScopedAggregates(config);
  const verified = useHomeScopedCounts(id === "projects" ? ["projects.total"] : id === "people" ? ["people.total"] : [], config, runtimeContext);
  const open = (item: HomeWidgetListItem, fallback: () => void) => item.workTarget ? actions.work(item.workTarget) : fallback();
  const card = (props: Omit<Parameters<typeof Card>[0], "id" | "size" | "status"> ) => <Card id={id} size={size} status={status} filtered={scoped} {...props} />;
  const summary = (props: Parameters<typeof Summary>[0]) => scoped
    ? <>
      {id === "projects" && verified.values["projects.total"] && <Hero value={verified.values["projects.total"].value} label="Matching projects" />}
      {id === "people" && verified.values["people.total"] && <Hero value={verified.values["people.total"].value} label="Matching people" />}
      {/* Without a runtime context the lists are unfiltered: show nothing rather than studio-wide rows. */}
      <Rows items={runtimeContext ? props.list || [] : []} limit={Math.max(LIST_ROWS[size], 1)} empty="Nothing matches" onOpen={props.onOpenItem} />
    </>
    : <Summary {...props} />;

  switch (id) {
    case "clock":
      return <Card id={id} size={size} className="hw-card-clock"><LocalClock size={size} config={config} /></Card>;
    case "note":
      return <Card id={id} size={size} title={config?.noteTitle || "Note"} className="hw-card-note"><ClusterTextArea value={note} maxLength={600} placeholder="Write something…" aria-label={config?.noteTitle || "Note"} onChange={(event) => onNoteChange(event.target.value)} /></Card>;
    case "quickCapture":
      return <Card id={id} size={size} className="hw-card-create"><div className="hw-create">{CREATE_MODE_CATALOG.slice(0, size === "small" ? 4 : 8).map((mode) => <ClusterButton key={mode.id} variant="quiet" size="compact" onClick={() => actions.quickCreate(mode.id)}>{mode.label}</ClusterButton>)}</div></Card>;
    case "brief": {
      const top = d.attention[0];
      return card({
        count: d.attention.length || undefined,
        onOpen: actions.notifications,
        className: "hw-card-brief",
        children: top ? <>
          <div className="hw-alert"><strong>{top.title}</strong>{size !== "small" && top.detail && <span>{top.detail}</span>}</div>
          {size === "large" && <Rows items={d.attention.slice(1)} limit={3} empty="" onOpen={(item) => onAttentionAction(item.target)} />}
          <div className="hw-foot">
            <ClusterButton variant="primary" size="compact" onClick={() => onAttentionAction(top.target)}>Open</ClusterButton>
            {size !== "small" && <ClusterButton variant="quiet" size="compact" onClick={() => onSnooze(top.id)}>Later</ClusterButton>}
            {size !== "small" && <ClusterButton variant="quiet" size="compact" onClick={() => onDismiss(top.id)}>Dismiss</ClusterButton>}
          </div>
        </> : <div className="hw-clear"><ClusterIcon name="check" /><span>All clear</span></div>,
      });
    }
    case "roleFocus":
      return card({ count: d.myWork.assigned, onOpen: actions.myWork, children: summary({ size,
        hero: { value: d.myWork.assigned, label: "Assigned" },
        stats: [{ label: "Overdue", value: d.myWork.overdue, tone: tone(d.myWork.overdue, "danger") }, { label: "Today", value: d.myWork.today }, { label: "Priority", value: d.myWork.priority, tone: tone(d.myWork.priority, "warning") }, { label: "Blocked", value: d.myWork.blockers, tone: tone(d.myWork.blockers, "warning") }],
        list: d.myWork.next, empty: "Nothing assigned", onOpenItem: (item) => open(item, actions.myWork) }) });
    case "upcoming":
      return card({ count: d.upcoming.length, onOpen: actions.myWork, children: summary({ size,
        hero: size === "small" ? { value: d.upcoming.length, label: "Coming up" } : undefined,
        list: d.upcoming, empty: "Nothing coming up", onOpenItem: (item) => open(item, actions.myWork) }) });
    case "scheduler":
      return card({ title: d.scheduler.active ? "On the clock" : "Time", onOpen: actions.scheduler, children: summary({ size,
        hero: { value: d.scheduler.week, label: "This week", tone: d.scheduler.active ? "good" : undefined },
        stats: size === "small" ? [] : [{ label: "Running", value: d.scheduler.running }, { label: "Today", value: d.scheduler.today.length }],
        list: size === "large" ? d.scheduler.today : undefined, empty: "Nothing scheduled", onOpenItem: (item) => open(item, actions.scheduler),
        footer: <ClusterButton variant={d.scheduler.active ? "danger" : "primary"} size="compact" onClick={onClock}>{d.scheduler.active ? "Clock out" : "Clock in"}</ClusterButton> }) });
    case "inbox":
      return card({ onOpen: actions.notifications, children: summary({ size,
        hero: { value: d.notifications.attention, label: "Need you", tone: tone(d.notifications.attention, "accent") },
        stats: [{ label: "Urgent", value: d.notifications.urgent, tone: tone(d.notifications.urgent, "danger") }] }) });
    case "projects":
      return card({ count: `${d.projects.ready}/${d.projects.total}`, onOpen: actions.projects, children: summary({ size,
        hero: { value: `${d.projects.ready}/${d.projects.total}`, label: "Healthy" },
        stats: [{ label: "Attention", value: d.projects.attention, tone: tone(d.projects.attention, "warning") }, { label: "Boards", value: d.projects.boards }, { label: "Repos", value: d.projects.git }],
        bar: <Bar parts={[{ label: "healthy", value: d.projects.ready, tone: "good" }, { label: "need attention", value: d.projects.attention, tone: "warning" }, { label: "other", value: Math.max(0, d.projects.total - d.projects.ready - d.projects.attention) }]} />,
        list: d.projects.recent, empty: "No projects", onOpenItem: (item) => open(item, actions.projects) }) });
    case "timeline":
      return card({ count: d.timeline.length, onOpen: actions.timeline, children: summary({ size,
        hero: size === "small" ? { value: d.timeline.length, label: "Milestones" } : undefined,
        list: d.timeline, empty: "No milestones", onOpenItem: (item) => open(item, actions.timeline) }) });
    case "builds":
      return card({ count: d.builds.total, onOpen: actions.builds, children: summary({ size,
        hero: { value: d.builds.failed || d.builds.total, label: d.builds.failed ? "Failing" : "Builds", tone: tone(d.builds.failed, "danger") },
        stats: [{ label: "Testing", value: d.builds.testing, tone: tone(d.builds.testing, "accent") }, { label: "Approved", value: d.builds.approved }],
        bar: <Bar parts={[{ label: "approved", value: d.builds.approved, tone: "good" }, { label: "testing", value: d.builds.testing, tone: "accent" }, { label: "failed", value: d.builds.failed, tone: "danger" }, { label: "other", value: Math.max(0, d.builds.total - d.builds.testing - d.builds.failed - d.builds.approved) }]} />,
        list: d.builds.items, empty: "No builds yet", onOpenItem: (item) => open(item, actions.builds) }) });
    case "qa":
      return card({ count: d.qa.total, onOpen: actions.qa, children: summary({ size,
        hero: { value: d.qa.open, label: "Open" },
        stats: [{ label: "Failed", value: d.qa.failed, tone: tone(d.qa.failed, "danger") }, { label: "Blocked", value: d.qa.blocked, tone: tone(d.qa.blocked, "warning") }],
        list: d.qa.items, empty: "No QA plans", onOpenItem: (item) => open(item, actions.qa) }) });
    case "tickets":
      return card({ count: d.tickets.open, onOpen: actions.tickets, children: summary({ size,
        hero: { value: d.tickets.total >= HOME_TICKET_SAMPLE ? `${d.tickets.open}+` : d.tickets.open, label: "Open" },
        stats: [{ label: "Priority", value: d.tickets.priority, tone: tone(d.tickets.priority, "warning") }],
        list: d.tickets.items, empty: "No open tickets", onOpenItem: (item) => open(item, actions.tickets) }) });
    case "sourceControl":
      return card({ count: d.sourceControl.total, onOpen: actions.projects, children: summary({ size,
        hero: { value: d.sourceControl.failed || d.sourceControl.total, label: d.sourceControl.failed ? "Failing" : "Repositories", tone: tone(d.sourceControl.failed, "danger") },
        stats: [{ label: "Warning", value: d.sourceControl.warning, tone: tone(d.sourceControl.warning, "warning") }, { label: "Branches", value: d.sourceControl.branches }, { label: "Commits", value: d.sourceControl.commits }],
        list: d.sourceControl.items, empty: "No repositories", onOpenItem: (item) => open(item, actions.projects) }) });
    case "reviewQueue":
      return card({ count: d.reviewQueue.total, onOpen: actions.projects, children: summary({ size,
        hero: { value: d.reviewQueue.awaiting, label: "Awaiting you", tone: tone(d.reviewQueue.awaiting, "accent") },
        stats: [{ label: "Ready", value: d.reviewQueue.ready }, { label: "Changes", value: d.reviewQueue.changesRequested, tone: tone(d.reviewQueue.changesRequested, "warning") }],
        list: d.reviewQueue.items, empty: "No open reviews", onOpenItem: (item) => open(item, actions.projects) }) });
    case "people":
      return card({ count: `${d.people.active}/${d.people.total}`, onOpen: actions.people, children: summary({ size,
        hero: { value: `${d.people.active}/${d.people.total}`, label: "Online", tone: tone(d.people.active, "good") },
        list: d.people.spotlight, empty: "No one yet", onOpenItem: (item) => open(item, actions.people) }) });
    case "peopleCapacity":
      return card({ onOpen: actions.people, children: summary({ size,
        hero: { value: d.peopleCapacity.pressured, label: "Over capacity", tone: tone(d.peopleCapacity.pressured, "warning") },
        stats: [{ label: "Assigned", value: d.peopleCapacity.assigned }, { label: "Hours", value: `${d.peopleCapacity.totalHours}h` }],
        list: d.peopleCapacity.items, empty: "No capacity set", onOpenItem: (item) => open(item, actions.people) }) });
    case "activity":
      return card({ onOpen: actions.activity, children: summary({ size, list: d.activity, empty: "No recent activity", onOpenItem: (item) => open(item, actions.activity) }) });
    case "library":
      return card({ count: d.library.total, onOpen: actions.library, children: summary({ size,
        hero: { value: d.library.total, label: "Items" },
        stats: [{ label: "Pinned", value: d.library.pinned }],
        list: d.library.recent, empty: "Library is empty", onOpenItem: (item) => open(item, actions.library) }) });
    case "adminOverview": {
      const total = d.admin.setupGaps + d.admin.maintenance + d.admin.corrections;
      return card({ onOpen: actions.admin, children: summary({ size,
        hero: { value: total, label: "To review", tone: tone(total, "warning") },
        stats: [{ label: "Setup gaps", value: d.admin.setupGaps, tone: tone(d.admin.setupGaps, "warning") }, { label: "Maintenance", value: d.admin.maintenance }, { label: "Corrections", value: d.admin.corrections }, { label: "Breaks", value: d.admin.breakEntries }] }) });
    }
    default:
      return null;
  }
}

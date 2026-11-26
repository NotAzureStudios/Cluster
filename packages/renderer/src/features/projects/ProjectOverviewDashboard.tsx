import { CLUSTER_WORKFLOW_RELATIONSHIP_META, type ClusterProjectTypeDefinition, type ClusterWorkflowRelationship } from "@cluster/shared";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { api } from "../../core/api";
import { useServerState } from "../../core/server-state";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterMiniRing } from "../../components/ClusterVisualMetrics";
import "./project-overview.css";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { personPresence } from "../people/person-summary";
import { formatRelativeTime } from "../../core/format";
import type { BoardSummary, Project, ProjectDashboardPayload, ProjectSnapshot, WhiteboardSummary } from "../application/application-models";
import { formatProjectDate, projectScheduleMeta } from "./project-portfolio-model";
import type { ProjectControlCenterPayload } from "./project-control-model";

function durationLabel(minutes: number) {
  if (!minutes) return "0h";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

type ProjectTeamMember = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  personalAccentColor?: string | null;
  status?: string | null;
  lastSeenAt?: string | null;
  archived?: boolean;
  connectionVisibility?: string | null;
};
type ProjectAttentionItem = { id: string; label: string; detail: string; tone: "warning" | "danger"; action: () => void };

export function ProjectOverviewDashboard({ project, projectType, snapshot, reviewAssetCount = 0, reviewOpenNoteCount = 0, dashboard, controlCenter, loading, setupChecklist, setupGaps, teamMembers, primaryBoard, primaryWhiteboard, onOpenBoard, onOpenWhiteboard, onOpenTimeline, onOpenTickets, onOpenTime, onOpenPlan, onOpenSection, availableSections = [], onRefresh, RelatedRecordsPanel, CustomFieldValuesPanel, VersionHistoryPanel, onRestore, children, canContribute = false, currentUserId }: {
  project: Project;
  projectType: ClusterProjectTypeDefinition;
  snapshot: ProjectSnapshot | null;
  reviewAssetCount?: number;
  reviewOpenNoteCount?: number;
  dashboard: ProjectDashboardPayload | null;
  controlCenter: ProjectControlCenterPayload | null;
  loading: boolean;
  setupChecklist: Array<{ label: string; done: boolean }>;
  setupGaps: string[];
  teamMembers: ProjectTeamMember[];
  primaryBoard: BoardSummary | null;
  primaryWhiteboard: WhiteboardSummary | null;
  onOpenBoard: (id: string) => void;
  onOpenWhiteboard: (id: string) => void;
  onOpenTimeline: () => void;
  onOpenTickets: () => void;
  onOpenTime: () => void;
  onOpenPlan: () => void;
  onOpenSection: (section: string) => void;
  availableSections?: readonly string[];
  onRefresh: () => void;
  RelatedRecordsPanel: ComponentType<any>;
  CustomFieldValuesPanel: ComponentType<any>;
  VersionHistoryPanel: ComponentType<any>;
  onRestore: (snapshot: Project) => Promise<void>;
  children?: ReactNode;
  canManage?: boolean;
  canContribute?: boolean;
  currentUserId?: string;
}) {
  const lastSeenBefore = useProjectLastSeen(project.id);
  const [milestoneDraft, setMilestoneDraft] = useState<{ title: string; date: string } | null>(null);
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  async function addMilestone() {
    if (!milestoneDraft?.title.trim() || !milestoneDraft.date) return;
    setMilestoneBusy(true);
    try {
      await api("/api/timeline/items", { method: "POST", body: JSON.stringify({ projectId: project.id, title: milestoneDraft.title.trim(), type: "milestone", startsAt: new Date(`${milestoneDraft.date}T12:00:00`).toISOString() }) });
      setMilestoneDraft(null);
      onRefresh();
    } finally { setMilestoneBusy(false); }
  }
  const projectToolSet = new Set([...(projectType.defaultTools || []), ...(projectType.optionalTools || [])]);
  const hiddenToolSet = new Set(projectType.hiddenTools || []);
  const isVideoType = projectType.category === "video" || projectType.id === "video";
  const supportsBuilds = !isVideoType && projectToolSet.has("builds") && !hiddenToolSet.has("builds");
  const supportsQa = projectToolSet.has("qa") && !hiddenToolSet.has("qa");
  const supportsReview = (projectToolSet.has("viewer") || isVideoType) && !hiddenToolSet.has("viewer");
  const progress = dashboard?.progress || 0;
  const readiness = snapshot?.readiness.score ?? (setupChecklist.length ? Math.round((setupChecklist.filter((item) => item.done).length / setupChecklist.length) * 100) : 0);
  const fallbackSchedule = projectScheduleMeta(project, project.archived ? "archived" : String(project.status || "active"));
  const schedule = snapshot ? { label: snapshot.schedule.label, tone: snapshot.schedule.state === "overdue" ? "danger" : snapshot.schedule.state === "due_soon" || snapshot.schedule.state === "unscheduled" ? "warning" : snapshot.schedule.state === "scheduled" ? "good" : "neutral" } : fallbackSchedule;
  const buildFailures = dashboard?.workflow.builds.failed || 0;
  const qaAttention = dashboard?.workflow.qa.attention || 0;
  const relationshipBlockers = dashboard?.workflow.relationships.blockers || 0;
  const projectRelationships = controlCenter?.relationships || [];
  const projectBlockingRelationships = projectRelationships.filter((item) => CLUSTER_WORKFLOW_RELATIONSHIP_META[item.relationship as ClusterWorkflowRelationship]?.blocking).length;
  const projectRelationshipTypes = [...new Set(projectRelationships.map((item) => item.relationship.replaceAll("_", " ")))].slice(0, 3);
  const overdueWork = dashboard?.cards.overdue || 0;
  const blockedWork = dashboard?.cards.blocked || 0;
  const attentionCount = overdueWork + blockedWork + (supportsBuilds ? buildFailures : 0) + (supportsQa ? qaAttention : 0) + (supportsReview ? reviewOpenNoteCount : 0) + relationshipBlockers;
  const delivery = dashboard?.workflow.delivery || null;
  const qaTotal = (dashboard?.workflow.qa.sessions || 0) + (dashboard?.workflow.qa.plans || 0);

  const activePhase = controlCenter?.records.find((item) => item.kind === "phase" && item.status === "active") || controlCenter?.records.find((item) => item.kind === "phase" && item.status !== "complete" && item.status !== "closed") || null;
  const integrationCount = (project.integrationBindings || []).length;
  const healthLabel = snapshot?.health.state === "blocked" ? "Blocked" : snapshot?.health.state === "at_risk" ? "At Risk" : snapshot?.health.state === "attention" ? "Needs Attention" : "Healthy";
  const healthTone = snapshot?.health.state === "blocked" || snapshot?.health.state === "at_risk" ? "danger" as const : snapshot?.health.state === "attention" ? "warning" as const : "good" as const;
  const lifecycleLabel = project.archived ? "Archived" : String(project.status || "active").replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
  const productionPhaseLabel = activePhase?.title || "Not set";
  const ownerLabel = snapshot?.lead.displayName || snapshot?.lead.username || "Unassigned";

  const attentionItems: ProjectAttentionItem[] = [
    ...(overdueWork ? [{ id: "overdue", label: `${overdueWork} overdue`, detail: `${blockedWork} blocked · ${dashboard?.cards.urgent || 0} urgent`, tone: "danger" as const, action: onOpenTickets }] : []),
    ...(blockedWork && !overdueWork ? [{ id: "blocked", label: `${blockedWork} blocked`, detail: "Cards", tone: "danger" as const, action: onOpenTickets }] : []),
    ...(supportsReview && reviewOpenNoteCount ? [{ id: "review", label: `${reviewOpenNoteCount} open note${reviewOpenNoteCount === 1 ? "" : "s"}`, detail: `${reviewAssetCount} review version${reviewAssetCount === 1 ? "" : "s"}`, tone: "warning" as const, action: () => onOpenSection("viewer") }] : []),
    ...(supportsBuilds && buildFailures ? [{ id: "builds", label: `${buildFailures} failed build${buildFailures === 1 ? "" : "s"}`, detail: delivery?.recommendedAction || "", tone: "danger" as const, action: () => onOpenSection("builds") }] : []),
    ...(supportsQa && qaAttention ? [{ id: "qa", label: `${qaAttention} QA flag${qaAttention === 1 ? "" : "s"}`, detail: `${qaTotal} records`, tone: "danger" as const, action: () => onOpenSection("qa") }] : []),
    ...(relationshipBlockers ? [{ id: "relationships", label: `${relationshipBlockers} blocking dependenc${relationshipBlockers === 1 ? "y" : "ies"}`, detail: dashboard?.workflow.relationships.critical ? `${dashboard.workflow.relationships.critical} critical` : "", tone: "warning" as const, action: onOpenTickets }] : []),
  ].slice(0, 5);

  const blockedTotal = blockedWork + relationshipBlockers;
  const healthNote = project.healthNote || "";
  const scheduleValue = schedule.label.replace(/^Due in /, "").replace(/^Overdue by /, "");
  const scheduleCaption = /^Overdue/.test(schedule.label) ? "Overdue" : /^Due in /.test(schedule.label) ? "To target" : "Target";
  const workSection = availableSections.includes("boards") ? () => (primaryBoard ? onOpenBoard(primaryBoard.id) : onOpenSection("boards")) : onOpenTickets;
  const scheduleTone = schedule.tone === "danger" || schedule.tone === "warning" || schedule.tone === "good" ? schedule.tone : "neutral";
  const pulse: Array<{ key: string; label: string; value: string | number; sub?: string; tone: "good" | "warning" | "danger" | "neutral" | "accent"; viz: "ring" | "dot" | "icon"; icon?: "calendar" | "clock"; onSelect: () => void }> = [
    { key: "done", label: "Done", value: dashboard ? `${progress}%` : "—", sub: dashboard ? `${dashboard.cards.completed}/${dashboard.cards.total} cards` : undefined, tone: "accent", viz: "ring", onSelect: workSection },
    { key: "schedule", label: scheduleCaption, value: scheduleValue, tone: scheduleTone, viz: "icon", icon: "calendar", onSelect: onOpenTimeline },
    { key: "blocked", label: "Blocked", value: blockedTotal, sub: overdueWork ? `${overdueWork} overdue` : undefined, tone: blockedTotal ? "danger" : overdueWork ? "warning" : "good", viz: "dot", onSelect: onOpenTickets },
    ...(supportsReview ? [{ key: "review", label: "Open notes", value: reviewOpenNoteCount, tone: reviewOpenNoteCount ? "warning" as const : "good" as const, viz: "dot" as const, onSelect: () => onOpenSection("viewer") }] : []),
    ...(supportsBuilds ? [{ key: "builds", label: "Builds", value: dashboard?.workflow.builds.total || 0, sub: buildFailures ? `${buildFailures} failed` : delivery?.published ? "Published" : delivery?.ready ? "Ready" : undefined, tone: buildFailures || delivery?.blocked || delivery?.activeHold ? "danger" as const : delivery?.ready || delivery?.published ? "good" as const : "neutral" as const, viz: "dot" as const, onSelect: () => onOpenSection("builds") }] : []),
    ...(supportsQa ? [{ key: "qa", label: projectType.terminology?.qa || "QA", value: qaTotal, sub: qaAttention ? `${qaAttention} flagged` : undefined, tone: qaAttention ? "danger" as const : qaTotal ? "good" as const : "neutral" as const, viz: "dot" as const, onSelect: () => onOpenSection("qa") }] : []),
    { key: "time", label: "Logged", value: durationLabel(dashboard?.time.loggedMinutes || 0), tone: "neutral", viz: "icon", icon: "clock", onSelect: onOpenTime },
  ];

  /* Overview. One row of indicators, then four cards: what needs attention,
     what's next, who's on it, what changed. Each fact appears once; the tabs
     above are the way into each tool, so there's no launchpad here. */
  // "Since you last looked": others' activity newer than your previous visit.
  const isNewActivity = (item: { createdAt: string; user?: { id: string } | null }) => Boolean(lastSeenBefore && item.createdAt > lastSeenBefore && item.user?.id !== currentUserId);
  const newActivity = (dashboard?.activity || []).slice(0, 8).filter(isNewActivity).length;

  return (
    <div className="pv">
      <section className="pv-pulse" aria-label="Project pulse">
        {pulse.map((item) => <ClusterButton unstyled type="button" key={item.key} className="pv-tile" data-tone={item.tone} onClick={item.onSelect}>
          <span className="pv-tile__viz" aria-hidden="true">{item.viz === "ring" ? <ClusterMiniRing label={item.label} percent={dashboard ? progress : null} tone="accent" showValue={false} /> : item.viz === "icon" && item.icon ? <ClusterIcon name={item.icon} /> : <i />}</span>
          <span className="pv-tile__copy"><strong>{item.value}</strong><small>{item.label}{item.sub ? <em> · {item.sub}</em> : null}</small></span>
        </ClusterButton>)}
      </section>
      {children}
      <div className="pv-grid">
        <div className="pv-col">
        {attentionItems.length ? <section className="pv-card" data-tone={attentionItems.some((item) => item.tone === "danger") ? "danger" : "warning"}>
          <header><h3>Attention</h3><span className="pv-count">{attentionItems.length}</span><ClusterIconButton size="compact" className="pv-refresh" label={loading ? "Refreshing" : "Refresh"} disabled={loading} onClick={onRefresh}><ClusterIcon name="refresh" /></ClusterIconButton></header>
          {healthNote ? <p className="pv-note">{healthNote}</p> : null}
          <ul className="pv-list">{attentionItems.map((item) => <li key={item.id}><ClusterButton unstyled type="button" className="pv-row" data-tone={item.tone} onClick={item.action}>
            <i className="pv-dot" aria-hidden="true" />
            <span className="pv-row__copy"><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
            <ClusterIcon name="chevron-right" className="pv-row__go" />
          </ClusterButton></li>)}</ul>
        </section> : null}
        <section className="pv-card">
          <header><h3>Milestones</h3>
            {canContribute && !milestoneDraft ? <ClusterIconButton size="compact" className="pv-add" label="Add milestone" onClick={() => setMilestoneDraft({ title: "", date: "" })}><ClusterIcon name="plus" /></ClusterIconButton> : null}
            <ClusterButton variant="quiet" size="compact" onClick={onOpenTimeline}>Timeline</ClusterButton></header>
          {milestoneDraft ? <form className="pv-quick" onSubmit={(event) => { event.preventDefault(); void addMilestone(); }}>
            <ClusterTextInput autoFocus value={milestoneDraft.title} placeholder="Milestone" aria-label="Milestone name" onChange={(event) => setMilestoneDraft({ ...milestoneDraft, title: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setMilestoneDraft(null); }} />
            <ClusterTextInput type="date" value={milestoneDraft.date} aria-label="Milestone date" onChange={(event) => setMilestoneDraft({ ...milestoneDraft, date: event.target.value })} />
            <ClusterButton type="submit" size="compact" variant="primary" disabled={milestoneBusy || !milestoneDraft.title.trim() || !milestoneDraft.date}>Add</ClusterButton>
            <ClusterIconButton size="compact" label="Cancel" onClick={() => setMilestoneDraft(null)}><ClusterIcon name="close" /></ClusterIconButton>
          </form> : null}
          {dashboard?.timeline.upcoming.length
            ? <ul className="pv-list">{dashboard.timeline.upcoming.slice(0, 5).map((item) => <li key={item.id}><ClusterButton unstyled type="button" className="pv-row" onClick={onOpenTimeline}>
                <time className="pv-date">{formatProjectDate(item.startsAt)}</time>
                <span className="pv-row__copy"><strong>{item.title}</strong><small>{item.type || "Milestone"}</small></span>
              </ClusterButton></li>)}</ul>
            : milestoneDraft ? null : <p className="pv-empty">Nothing scheduled</p>}
        </section>
        <section className="pv-card">
          <header><h3>Team</h3>{teamMembers.length ? <span className="pv-count">{teamMembers.length}</span> : null}<ClusterButton variant="quiet" size="compact" onClick={() => onOpenSection("people")}>Manage</ClusterButton></header>
          <dl className="pv-facts">
            <div><dt>Lead</dt><dd data-empty={ownerLabel === "Unassigned" || undefined}>{ownerLabel}</dd></div>
          </dl>
          {teamMembers.length
            ? <ul className="pv-team">{teamMembers.slice(0, 12).map((member) => <li key={member.id} title={member.name}><PresenceAvatar
                userId={member.id}
                imageUrl={member.avatarUrl}
                label={member.name}
                fallback={member.name.slice(0, 1).toUpperCase()}
                accentColor={member.personalAccentColor}
                state={member.connectionVisibility === "invisible" ? "offline" : personPresence(member)}
                profilePeek={false}
              /><span>{member.name}</span></li>)}</ul>
            : <p className="pv-empty">No one assigned</p>}
        </section>
        </div>
        <div className="pv-col">
        <section className="pv-card">
          <header><h3>Activity</h3>{newActivity ? <span className="pv-count pv-count--new">{newActivity} new</span> : null}{attentionItems.length ? null : <ClusterIconButton size="compact" className="pv-refresh" label={loading ? "Refreshing" : "Refresh"} disabled={loading} onClick={onRefresh}><ClusterIcon name="refresh" /></ClusterIconButton>}</header>
          {dashboard?.activity.length
            ? <ul className="pv-feed">{dashboard.activity.slice(0, 8).map((item) => <li key={item.id} data-new={isNewActivity(item) || undefined}>
                {item.user?.avatarUrl ? <img loading="lazy" decoding="async" src={item.user.avatarUrl} alt="" /> : <span className="pv-feed__mark" aria-hidden="true">{(item.user?.displayName || item.user?.username || item.title || "•").slice(0, 1).toUpperCase()}</span>}
                <p><strong>{item.title}</strong><small>{item.message || item.entityType}</small></p>
                <time>{formatRelativeTime(item.createdAt)}</time>
              </li>)}</ul>
            : <p className="pv-empty">No activity yet</p>}
        </section>
        </div>
      </div>

    </div>
  );
}

/** Records this visit and returns when you last opened the project before it. */
export function useProjectLastSeen(projectId: string) {
  const [lastSeen, setLastSeen, state] = useServerState<Record<string, string>>("user", "projects.last-seen", {}, { merge: (value) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {} });
  const [before, setBefore] = useState<string | null>(null);
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!state.hydrated || recorded.current === projectId) return;
    recorded.current = projectId;
    setBefore(lastSeen[projectId] || null);
    const stamp = (current: Record<string, string>) => {
      const next = { ...current, [projectId]: new Date().toISOString() };
      // Keep the map small: the 200 most recently opened projects.
      return Object.fromEntries(Object.entries(next).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 200));
    };
    setLastSeen(stamp);
    return () => setLastSeen(stamp);
  }, [state.hydrated, projectId]);
  return before;
}

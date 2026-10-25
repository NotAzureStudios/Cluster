import { CLUSTER_WORKFLOW_RELATIONSHIP_META, type ClusterProjectTypeDefinition, type ClusterWorkflowRelationship } from "@cluster/shared";
import type { ComponentType } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { resolveClusterResourceActions } from "../../core/resource-action-registry";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterIcon } from "../../components/ClusterIcon";
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

export function ProjectOverviewDashboard({ project, projectType, snapshot, reviewAssetCount = 0, reviewOpenNoteCount = 0, dashboard, controlCenter, loading, setupChecklist, setupGaps, teamMembers, primaryBoard, primaryWhiteboard, onOpenBoard, onOpenWhiteboard, onOpenTimeline, onOpenTickets, onOpenTime, onOpenPlan, onOpenSection, onRefresh, RelatedRecordsPanel, CustomFieldValuesPanel, VersionHistoryPanel, onRestore }: {
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
  onRefresh: () => void;
  RelatedRecordsPanel: ComponentType<any>;
  CustomFieldValuesPanel: ComponentType<any>;
  VersionHistoryPanel: ComponentType<any>;
  onRestore: (snapshot: Project) => Promise<void>;
  canManage?: boolean;
  canContribute?: boolean;
}) {
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
  const readinessGaps = snapshot?.readiness.gaps ?? setupGaps;
  const buildFailures = dashboard?.workflow.builds.failed || 0;
  const qaAttention = dashboard?.workflow.qa.attention || 0;
  const relationshipBlockers = dashboard?.workflow.relationships.blockers || 0;
  const projectRelationships = controlCenter?.relationships || [];
  const projectBlockingRelationships = projectRelationships.filter((item) => CLUSTER_WORKFLOW_RELATIONSHIP_META[item.relationship as ClusterWorkflowRelationship]?.blocking).length;
  const projectRelationshipTypes = [...new Set(projectRelationships.map((item) => item.relationship.replaceAll("_", " ")))].slice(0, 3);
  const overdueWork = dashboard?.cards.overdue || 0;
  const blockedWork = dashboard?.cards.blocked || 0;
  const controlAttention = controlCenter?.summary.attention.length || 0;
  const attentionCount = overdueWork + blockedWork + (supportsBuilds ? buildFailures : 0) + (supportsQa ? qaAttention : 0) + (supportsReview ? reviewOpenNoteCount : 0) + relationshipBlockers + controlAttention;
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
    ...(overdueWork ? [{ id: "overdue", label: `${overdueWork} overdue work item${overdueWork === 1 ? "" : "s"}`, detail: `${blockedWork} blocked · ${dashboard?.cards.urgent || 0} urgent`, tone: "danger" as const, action: onOpenTickets }] : []),
    ...(blockedWork && !overdueWork ? [{ id: "blocked", label: `${blockedWork} blocked work item${blockedWork === 1 ? "" : "s"}`, detail: "Review blockers and ownership", tone: "danger" as const, action: onOpenTickets }] : []),
    ...(supportsReview && reviewOpenNoteCount ? [{ id: "review", label: `${reviewOpenNoteCount} review note${reviewOpenNoteCount === 1 ? "" : "s"} unresolved`, detail: `${reviewAssetCount} review version${reviewAssetCount === 1 ? "" : "s"}`, tone: "warning" as const, action: () => onOpenSection("viewer") }] : []),
    ...(supportsBuilds && buildFailures ? [{ id: "builds", label: `${buildFailures} build${buildFailures === 1 ? "" : "s"} need attention`, detail: delivery?.recommendedAction || "Review failed build output", tone: "danger" as const, action: () => onOpenSection("builds") }] : []),
    ...(supportsQa && qaAttention ? [{ id: "qa", label: `${qaAttention} QA item${qaAttention === 1 ? "" : "s"} need review`, detail: `${qaTotal} QA records`, tone: "danger" as const, action: () => onOpenSection("qa") }] : []),
    ...(relationshipBlockers ? [{ id: "relationships", label: `${relationshipBlockers} blocking dependenc${relationshipBlockers === 1 ? "y" : "ies"}`, detail: `${dashboard?.workflow.relationships.critical || 0} critical relationships`, tone: "warning" as const, action: () => onOpenSection("control") }] : []),
    ...(controlCenter?.summary.attention.slice(0, 2).map((item) => ({ id: `control-${item.id}`, label: item.title, detail: item.reason, tone: item.tone === "danger" ? "danger" as const : "warning" as const, action: () => onOpenSection("control") })) || []),
    ...readinessGaps.slice(0, attentionItemsRoom(overdueWork, supportsBuilds ? buildFailures : 0, supportsQa ? qaAttention : 0, relationshipBlockers, controlCenter?.summary.attention.length || 0)).map((gap: string, index: number) => ({ id: `setup-${index}`, label: gap, detail: "Project setup", tone: "warning" as const, action: onOpenPlan })),
  ].slice(0, 5);

  return (
    <div className="project-subpage-v312 project-overview-v57">
      <ClusterMetricStrip label="Project identity and state" className="project-identity-strip-v12" items={[
        { key: "lifecycle", label: "Lifecycle", value: lifecycleLabel, detail: project.archived ? "Read-only archive" : "Project state" },
        { key: "phase", label: "Production phase", value: productionPhaseLabel, detail: activePhase ? `${activePhase.progress || 0}% complete` : "Configure in Plan", onSelect: () => onOpenSection("control") },
        { key: "health", label: "Health", value: healthLabel, detail: snapshot?.health.reasons[0] || "No active health signals", tone: healthTone },
        { key: "owner", label: "Owner", value: ownerLabel, detail: snapshot?.lead.configured ? "Project Lead" : "Lead required", tone: snapshot?.lead.configured ? "neutral" as const : "warning" as const, onSelect: () => onOpenSection("people") },
        { key: "integrations", label: "Integrations", value: integrationCount, detail: integrationCount ? `${integrationCount} connected` : "None connected", tone: integrationCount ? "good" as const : "neutral" as const, onSelect: () => onOpenSection("links") },
      ]} />
      <section className={`project-current-work-v57 ${attentionCount ? "attention" : schedule.tone}`}>
        <div>
          <p className="eyebrow">Current work</p>
          <h2>{attentionCount ? `${attentionCount} signal${attentionCount === 1 ? "" : "s"} need attention` : "Project is operating normally"}</h2>
          <p>{project.healthNote || snapshot?.health.reasons[0] || project.objective || (readinessGaps.length ? `${readinessGaps.length} setup item${readinessGaps.length === 1 ? "" : "s"} remain.` : "No immediate project risks are recorded.")}</p>
          <div className="project-current-context-v57">
            <span>{formatProjectDate(project.startDate)} → {formatProjectDate(project.targetDate)}</span>
            <span>{project.clientName || "Internal"}</span>
            <span>{schedule.label}</span>
          </div>
        </div>
        <div className="project-current-actions-v57">
          {isVideoType && supportsReview ? (
            <ClusterButton variant="primary" onClick={() => onOpenSection("viewer")}>Open {projectType.terminology?.viewer || "review"}</ClusterButton>
          ) : primaryBoard ? (
            <ClusterButton variant="primary" onClick={() => onOpenBoard(primaryBoard.id)}>Open board</ClusterButton>
          ) : (
            <ClusterButton variant="primary" onClick={() => onOpenSection("boards")}>Create board</ClusterButton>
          )}
          <ClusterActionMenu label="Project actions" triggerLabel="More" items={resolveClusterResourceActions({ kind: "project", id: project.id }, [
            { id: "plan", resourceKinds: ["project"] as const, allowed: () => true, label: "Edit project plan", onSelect: onOpenPlan },
            { id: "timeline", resourceKinds: ["project"] as const, allowed: () => true, label: "Open timeline", onSelect: onOpenTimeline },
            { id: "tickets", resourceKinds: ["project"] as const, allowed: () => true, label: "Open project tickets", onSelect: onOpenTickets },
            { id: "time", resourceKinds: ["project"] as const, allowed: () => true, label: "Open project time", onSelect: onOpenTime },
            { id: "library", resourceKinds: ["project"] as const, allowed: () => true, label: "Open project library", onSelect: () => onOpenSection("library") },
            ...(projectType.workspaceEntities?.length ? [{ id: "production", resourceKinds: ["project"] as const, allowed: () => true, label: `Open ${projectType.terminology?.production || "production"}`, onSelect: () => onOpenSection("production") }] : []),
            primaryWhiteboard ? { id: "whiteboard", resourceKinds: ["project"] as const, allowed: () => true, label: "Open whiteboard", onSelect: () => onOpenWhiteboard(primaryWhiteboard.id) } : { id: "whiteboard", resourceKinds: ["project"] as const, allowed: () => true, label: "Add whiteboard", onSelect: () => onOpenSection("whiteboards") },
            { id: "refresh", resourceKinds: ["project"] as const, allowed: () => true, label: loading ? "Refreshing…" : "Refresh project pulse", available: () => !loading, unavailableReason: "Project pulse refresh is already running", separatorBefore: true, onSelect: onRefresh },
          ])} />
        </div>
      </section>

      <ClusterMetricStrip label="Project pulse" className="project-pulse-v57" items={[
        { key: "delivery", label: "Delivery", value: loading ? "…" : `${progress}%`, detail: `${dashboard?.cards.completed || 0}/${dashboard?.cards.total || 0} complete`, progress, onSelect: () => onOpenSection("boards") },
        { key: "blockers", label: "Blockers", value: blockedWork + relationshipBlockers, detail: `${overdueWork} overdue`, tone: blockedWork + relationshipBlockers || overdueWork ? "danger" as const : "good" as const, onSelect: onOpenTickets },
        ...(supportsReview ? [{ key: "review", label: isVideoType ? "Review" : "Media", value: reviewAssetCount, detail: reviewOpenNoteCount ? `${reviewOpenNoteCount} unresolved` : reviewAssetCount ? "Notes clear" : "No media", tone: reviewOpenNoteCount ? "warning" as const : reviewAssetCount ? "good" as const : "neutral" as const, onSelect: () => onOpenSection("viewer") }] : []),
        ...(supportsBuilds ? [{ key: "builds", label: "Builds", value: dashboard?.workflow.builds.total || 0, detail: delivery?.published ? "Published" : delivery?.ready ? "Ready" : buildFailures ? `${buildFailures} failed` : "Pending", tone: buildFailures || delivery?.blocked || delivery?.activeHold ? "danger" as const : delivery?.ready || delivery?.published ? "good" as const : "neutral" as const, onSelect: () => onOpenSection("builds") }] : []),
        ...(supportsQa ? [{ key: "qa", label: projectType.terminology?.qa || "QA", value: qaTotal, detail: qaAttention ? `${qaAttention} need attention` : qaTotal ? "Clear" : "Not started", tone: qaAttention ? "danger" as const : qaTotal ? "good" as const : "neutral" as const, onSelect: () => onOpenSection("qa") }] : []),
        { key: "setup", label: "Setup", value: `${readiness}%`, detail: readinessGaps.length ? `${readinessGaps.length} gaps` : "Ready", tone: readinessGaps.length ? "warning" as const : "good" as const, progress: readiness, onSelect: onOpenPlan },
        { key: "time", label: "Time", value: durationLabel(dashboard?.time.loggedMinutes || 0), detail: "Project logged", onSelect: onOpenTime },
      ].slice(0, 6)} />

      <section className="project-primary-grid-v57">
        <article className={`project-focus-panel-v57 ${attentionItems.length ? "attention" : ""}`}>
          <header><div><p className="eyebrow">Attention</p><h3>{attentionItems.length ? "Needs a decision next" : "No active blockers"}</h3></div>{attentionItems.length ? <span>{attentionItems.length}</span> : null}</header>
          {attentionItems.length ? (
            <div className="project-attention-list-v57">{attentionItems.map((item) => <ClusterButton key={item.id} variant="quiet" state={item.tone === "danger" ? "error" : "warning"} onClick={item.action}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true"><ClusterIcon name="chevron-right" /></b></ClusterButton>)}</div>
          ) : (
            <div className="project-clear-v57"><strong>Nothing is currently blocking delivery.</strong><span>Keep the next milestone and ownership current.</span></div>
          )}
        </article>

        <article className="project-focus-panel-v57">
          <header><div><p className="eyebrow">Next</p><h3>Upcoming milestones</h3></div><ClusterButton variant="quiet" size="compact" onClick={onOpenTimeline}>Timeline</ClusterButton></header>
          <div className="project-upcoming-list-v57">{dashboard?.timeline.upcoming.length ? dashboard.timeline.upcoming.slice(0, 5).map((item) => <ClusterButton key={item.id} variant="quiet" onClick={onOpenTimeline}><span><strong>{item.title}</strong><small>{item.type || "milestone"}</small></span><time>{formatProjectDate(item.startsAt)}</time></ClusterButton>) : <div className="project-clear-v57"><strong>No upcoming milestone.</strong><span>Add the next meaningful checkpoint to Timeline.</span></div>}</div>
        </article>
      </section>

      <ClusterDisclosureGroup className="project-secondary-details-v57" contentClassName="project-secondary-grid-v57"
        title="Team & recent activity" summary="Ownership and the latest project changes"
        headerTrailing={<em>{teamMembers.length} people · {dashboard?.activity.length || 0} updates</em>}>
          <section>
            <header><h3>Assigned team</h3><ClusterButton variant="quiet" size="compact" onClick={() => onOpenSection("people")}>Manage</ClusterButton></header>
            {teamMembers.length ? <div className="project-team-summary-v57">{teamMembers.slice(0, 10).map((member) => <div key={member.id}><PresenceAvatar
              userId={member.id}
              imageUrl={member.avatarUrl}
              label={member.name}
              fallback={member.name.slice(0, 1).toUpperCase()}
              accentColor={member.personalAccentColor}
              state={member.connectionVisibility === "invisible" ? "offline" : personPresence(member)}
              profilePeek={false}
            /><strong>{member.name}</strong></div>)}</div> : <div className="project-clear-v57"><strong>No assigned team.</strong><span>Assign ownership before work starts drifting between people.</span></div>}
          </section>
          <section>
            <header><h3>Recent activity</h3><span>{dashboard?.activity.length || 0}</span></header>
            <div className="project-activity-list-v57">{dashboard?.activity.length ? dashboard.activity.slice(0, 6).map((item) => <div key={item.id}>{item.user?.avatarUrl ? <img loading="lazy" decoding="async" src={item.user.avatarUrl} alt="" /> : <span aria-hidden="true" />}<p><strong>{item.title}</strong><small>{item.message || item.entityType} · {formatRelativeTime(item.createdAt)}</small></p></div>) : <div className="project-clear-v57"><strong>No recent activity.</strong><span>Project changes will appear here.</span></div>}</div>
          </section>
      </ClusterDisclosureGroup>

      <ClusterDisclosureGroup className="project-secondary-details-v57" contentClassName="project-control-stack-v57"
        title="Controls & project data" summary="Risks, dependencies, relationships, custom fields, and history"
        headerTrailing={<em>{controlCenter?.summary.attention.length || 0} attention</em>}>
          {controlCenter?.records.length ? <ClusterMetricStrip label="Project control summary" items={[
            { label: "Deliverables", value: controlCenter.summary.counts.deliverables, detail: `${controlCenter.summary.progress.deliverables}% complete`, progress: controlCenter.summary.progress.deliverables, onSelect: () => onOpenSection("control") },
            { label: "High risks", value: controlCenter.summary.counts.highRisks, tone: controlCenter.summary.counts.highRisks ? "danger" : "good", onSelect: () => onOpenSection("control") },
            { label: "Decisions", value: controlCenter.summary.counts.pendingDecisions, tone: controlCenter.summary.counts.pendingDecisions ? "warning" : "neutral", onSelect: () => onOpenSection("control") },
            { label: "Dependencies", value: controlCenter.summary.counts.criticalDependencies, tone: controlCenter.summary.counts.criticalDependencies ? "warning" : "neutral", onSelect: () => onOpenSection("control") },
            { label: "Linked work", value: projectRelationships.length, detail: projectRelationshipTypes.length ? projectRelationshipTypes.join(" · ") : "No relationships", tone: projectBlockingRelationships ? "warning" : projectRelationships.length ? "good" : "neutral", onSelect: () => onOpenSection("control") },
          ]} /> : <div className="project-clear-v57"><strong>Project controls are not configured.</strong><ClusterButton size="compact" onClick={() => onOpenSection("control")}>Configure controls</ClusterButton></div>}
          <div className="project-metadata-stack-v57"><RelatedRecordsPanel entity={{ kind: "project", id: project.id, label: project.name, projectId: project.id }} projectId={project.id} /><CustomFieldValuesPanel entity="project" entityId={project.id} projectId={project.id} title="Project fields" /><VersionHistoryPanel entityType="project" entityId={project.id} projectId={project.id} label={project.name} data={project} onRestore={onRestore} /></div>
      </ClusterDisclosureGroup>
    </div>
  );
}

function attentionItemsRoom(overdue: number, builds: number, qa: number, relationships: number, control: number) {
  const occupied = Number(Boolean(overdue)) + Number(Boolean(builds)) + Number(Boolean(qa)) + Number(Boolean(relationships)) + Math.min(2, control);
  return Math.max(0, 5 - occupied);
}

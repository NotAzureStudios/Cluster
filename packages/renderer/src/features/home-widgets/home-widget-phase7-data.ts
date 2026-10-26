import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import type { ActivityEvent, Project, TeamAssignment, UserActivitySummary, WatcherRecord } from "../application/application-models";
import type { HomeWidgetListItem } from "./BuiltInHomeWidget";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../core/format";
import { notificationWorkNavigation } from "../notifications/notification-navigation";

export type HomeSourceRepository = {
  id: string;
  name: string;
  healthState?: string | null;
  healthMessage?: string | null;
  syncState?: string | null;
  defaultBranch?: string | null;
  metadata?: { projectId?: string | null; [key: string]: unknown } | null;
  projects?: Array<{ projectId: string; isPrimary?: boolean; project?: { id: string; name: string } | null }>;
  _count?: { projects?: number; branches?: number; commits?: number; changes?: number; operations?: number };
};


export type HomeSourceReview = {
  id: string; projectId: string; projectName: string; repositoryId: string; repositoryName: string; title: string; status: string; eligibilityState: string; eligibilityMessage?: string | null; sourceBranch: string; targetBranch: string; sourceRevision?: string | null; createdById?: string | null; myDecision?: string | null; approvals: number; changesRequested: number; updatedAt: string;
};

export type HomeSavedView = { id: string; name: string; scope: string; visibility: "personal" | "studio"; values: Record<string, string>; updatedAt: string };

export type HomeDeliveryLifecycleSummary = {
  projectId: string;
  ready: boolean;
  recommendedAction: string;
  blocked: number;
  activeHold: boolean;
  channel: string;
  published: boolean;
  releaseId?: string | null;
  latestBuildId?: string | null;
  generatedAt?: string;
};

export type HomeIntegrationProvider = {
  id: string;
  label?: string;
  name?: string;
  category?: string;
  configured?: boolean;
  health?: { state?: string; detail?: string } | null;
};

type FocusCard = TeamAssignment["cards"][number];

function focusCardTarget(card: FocusCard): ClusterWorkNavigationTarget {
  return {
    screen: card.isTicket ? "tickets" : "board",
    projectId: card.projectId || null,
    boardId: card.isTicket ? null : card.boardId,
    inspectScope: card.isTicket ? "ticket" : "card",
    inspectId: card.id,
  };
}


export type HomeTodayEvent = {
  id: string;
  title: string;
  startsAt: string;
  projectId?: string | null;
  project?: { id?: string | null; name?: string | null } | null;
};

export function deriveToday(events: HomeTodayEvent[], focusCards: FocusCard[], dueCount: number, blockers: number, priorityCount: number, requiredKnowledge: HomeWidgetListItem[] = []) {
  return {
    scheduled: events.length,
    due: dueCount,
    blockers,
    priority: priorityCount,
    items: [
      ...events.map((event): HomeWidgetListItem => ({
        id: `event:${event.id}`,
        title: event.title,
        detail: event.project?.name || "Calendar",
        value: new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        workTarget: { screen: "calendar", projectId: event.projectId || event.project?.id || null, inspectScope: "calendar-event", inspectId: event.id },
      })),
      ...requiredKnowledge,
      ...focusCards.map((card): HomeWidgetListItem => ({
        id: `work:${card.id}`,
        title: card.title,
        detail: `${card.projectName} · ${card.boardName}`,
        value: card.dueDate ? formatDueDate(card.dueDate) : levelLabel(card.priority || "medium"),
        workTarget: focusCardTarget(card),
      })),
    ].slice(0, 8),
  };
}

export function derivePeopleCapacity(users: UserActivitySummary[], assignments: TeamAssignment[]) {
  const rows = users.map((person) => {
    const assignment = assignments.find((item) => item.user.id === person.id);
    const assigned = assignment?.cards.length || 0;
    const capacityHours = person.capacityHours ?? null;
    const pressureThreshold = capacityHours == null ? 6 : Math.max(1, capacityHours / 4);
    return { person, assigned, capacityHours, pressured: assigned > pressureThreshold };
  });
  return {
    configured: rows.filter((row) => row.capacityHours != null).length,
    totalHours: rows.reduce((sum, row) => sum + (row.capacityHours || 0), 0),
    assigned: rows.reduce((sum, row) => sum + row.assigned, 0),
    pressured: rows.filter((row) => row.pressured).length,
    items: rows.sort((a, b) => Number(b.pressured) - Number(a.pressured) || b.assigned - a.assigned).slice(0, 8).map(({ person, assigned, capacityHours, pressured }): HomeWidgetListItem => ({
      id: person.id,
      title: person.displayName || person.username,
      detail: `${capacityHours == null ? "Capacity unset" : `${capacityHours}h/week`} · ${assigned} assigned`,
      value: pressured ? "Pressure" : "Balanced",
      workTarget: { screen: "people", inspectScope: "person", inspectId: person.id },
    })),
  };
}

export function deriveWatchlist(watchers: WatcherRecord[], currentUserId: string) {
  const rows = watchers.filter((watcher) => watcher.userId === currentUserId);
  return {
    total: rows.length,
    muted: rows.filter((item) => item.muted).length,
    statusOnly: rows.filter((item) => item.eventScope === "status").length,
    items: rows.slice(0, 8).map((item): HomeWidgetListItem => ({
      id: item.id,
      title: item.entity.label || levelLabel(item.entity.kind),
      detail: `${levelLabel(item.entity.kind)} · ${levelLabel(item.eventScope)}`,
      value: item.muted ? "Muted" : "Watching",
    })),
  };
}

export function deriveHandoff(activity: ActivityEvent[], focusCards: FocusCard[], attentionCount: number) {
  const items: HomeWidgetListItem[] = [
    ...activity.slice(0, 4).map((event): HomeWidgetListItem => ({
      id: `activity:${event.id}`,
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
    ...focusCards.slice(0, 4).map((card): HomeWidgetListItem => ({
      id: `work:${card.id}`,
      title: card.title,
      detail: `${card.projectName} · ${card.boardName}`,
      value: card.dueDate ? formatDueDate(card.dueDate) : levelLabel(card.priority || "medium"),
      workTarget: focusCardTarget(card),
    })),
  ].slice(0, 8);
  return { changes: activity.length, attention: attentionCount, next: focusCards.length, items };
}

export function deriveReleaseReadiness(lifecycles: HomeDeliveryLifecycleSummary[], projects: Project[]) {
  const state = (row: HomeDeliveryLifecycleSummary) => row.published ? "Published" : row.activeHold ? "Hold" : row.blocked > 0 ? "Blocked" : row.ready ? "Ready" : "Pending";
  return {
    total: lifecycles.length,
    draft: lifecycles.filter((row) => !row.published && !row.ready && !row.activeHold && row.blocked === 0).length,
    ready: lifecycles.filter((row) => row.ready && !row.published).length,
    published: lifecycles.filter((row) => row.published).length,
    blocked: lifecycles.filter((row) => row.activeHold || row.blocked > 0).length,
    items: lifecycles.slice().sort((a, b) => Number(b.published) - Number(a.published) || Number(b.ready) - Number(a.ready) || b.blocked - a.blocked).slice(0, 8).map((row): HomeWidgetListItem => ({
      id: `project:${row.projectId}`,
      title: projects.find((project) => project.id === row.projectId)?.name || "Project delivery",
      detail: `${levelLabel(row.channel || "internal")} · ${row.recommendedAction || "Delivery lifecycle"}`,
      value: state(row),
      workTarget: { screen: "project", projectId: row.projectId, projectTab: "builds", inspectScope: row.releaseId ? "release" : row.latestBuildId ? "build-artifact" : undefined, inspectId: row.releaseId || row.latestBuildId || undefined },
    })),
  };
}

export function deriveSourceControl(repositories: HomeSourceRepository[]) {
  return {
    total: repositories.length,
    healthy: repositories.filter((repo) => repo.healthState === "healthy").length,
    warning: repositories.filter((repo) => repo.healthState === "warning").length,
    failed: repositories.filter((repo) => repo.healthState === "failed").length,
    branches: repositories.reduce((sum, repo) => sum + (repo._count?.branches || 0), 0),
    commits: repositories.reduce((sum, repo) => sum + (repo._count?.commits || 0), 0),
    items: repositories.slice(0, 8).map((repo): HomeWidgetListItem => {
      const binding = repo.projects?.find((item) => item.isPrimary) || repo.projects?.[0];
      const projectId = binding?.project?.id || binding?.projectId || (typeof repo.metadata?.projectId === "string" ? repo.metadata.projectId : null);
      const projectName = binding?.project?.name || null;
      return {
        id: repo.id,
        title: repo.name,
        detail: `${projectName ? `${projectName} · ` : ""}${repo.defaultBranch || "main"} · ${repo._count?.branches || 0} branches`,
        value: levelLabel(repo.healthState || repo.syncState || "unknown"),
        workTarget: projectId ? { screen: "project", projectId, projectTab: "source" } : { screen: "projects" },
      };
    }),
  };
}

export function deriveIntegrationHealth(providers: HomeIntegrationProvider[]) {
  return {
    total: providers.length,
    configured: providers.filter((provider) => provider.configured).length,
    healthy: providers.filter((provider) => provider.health?.state === "healthy").length,
    attention: providers.filter((provider) => ["degraded", "failed", "misconfigured", "error"].includes(String(provider.health?.state || ""))).length,
    items: providers.slice(0, 8).map((provider): HomeWidgetListItem => ({ id: provider.id, title: provider.label || provider.name || levelLabel(provider.id), detail: levelLabel(provider.category || "integration"), value: levelLabel(provider.health?.state || (provider.configured ? "unknown" : "misconfigured")) })),
  };
}


export function deriveReviewQueue(reviews: HomeSourceReview[]) {
  return {
    total: reviews.length,
    awaiting: reviews.filter((review) => !review.myDecision).length,
    ready: reviews.filter((review) => review.eligibilityState === "ready").length,
    changesRequested: reviews.filter((review) => review.changesRequested > 0 || review.status === "changes_requested").length,
    items: reviews.slice(0, 8).map((review): HomeWidgetListItem => ({
      id: review.id,
      title: review.title,
      detail: `${review.projectName} · ${review.sourceBranch} → ${review.targetBranch}`,
      value: review.myDecision ? levelLabel(review.myDecision) : review.eligibilityState === "ready" ? "Ready" : "Review",
      workTarget: { screen: "project", projectId: review.projectId, projectTab: "source" },
    })),
  };
}

function savedViewTarget(scope: string): ClusterWorkNavigationTarget | null {
  if (scope === "projects.portfolio") return { screen: "projects" };
  if (scope === "tickets.queue") return { screen: "tickets" };
  if (scope === "people.directory") return { screen: "people" };
  if (scope === "library.workspace") return { screen: "library" };
  if (scope === "notifications.inbox") return { screen: "inbox" };
  return null;
}

export function deriveSavedViews(views: HomeSavedView[]) {
  const scopes = new Set(views.map((view) => view.scope));
  return {
    total: views.length,
    scopes: scopes.size,
    shared: views.filter((view) => view.visibility === "studio").length,
    items: views.slice(0, 8).map((view): HomeWidgetListItem => ({ id: `${view.scope}:${view.id}`, title: view.name, detail: `${levelLabel(view.scope.replace(/\./g, " "))} · ${levelLabel(view.visibility)}`, value: view.updatedAt ? formatRelativeTime(view.updatedAt) : undefined, workTarget: savedViewTarget(view.scope) })),
  };
}

import type { TeamAssignment, UserActivitySummary } from "../application/application-models";
import type { HomeWidgetListItem } from "./BuiltInHomeWidget";
import { levelLabel } from "../../core/format";

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

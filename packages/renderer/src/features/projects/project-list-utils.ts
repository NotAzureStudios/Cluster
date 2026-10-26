import type { Project } from "../application/application-models";

export type ProjectScheduleState = "due_soon" | "overdue" | "unscheduled" | "scheduled";

const PROJECT_PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function projectScheduleState(project: Project, normalizedStatus: string, now = Date.now()): ProjectScheduleState {
  if (!project.targetDate) return "unscheduled";
  const targetTime = new Date(project.targetDate).getTime();
  if (!Number.isFinite(targetTime)) return "unscheduled";
  if (targetTime < now && !["completed", "cancelled"].includes(normalizedStatus)) return "overdue";
  if (targetTime <= now + 1000 * 60 * 60 * 24 * 30) return "due_soon";
  return "scheduled";
}

export function compareProjectPriority(a: Project, b: Project) {
  return (PROJECT_PRIORITY_RANK[b.priority || "medium"] || 0) - (PROJECT_PRIORITY_RANK[a.priority || "medium"] || 0);
}

export function projectSetupChecklist(project: Project, context: {
  whiteboardCount: number;
  assignedCount: number;
  hasGit: boolean;
  hasDiscord: boolean;
  milestoneCount: number;
  videoProject: boolean;
}) {
  return [
    { label: "Brief", done: Boolean(project.description) },
    { label: "Objective", done: Boolean(project.objective) },
    { label: "Target", done: Boolean(project.targetDate) },
    { label: "Board", done: project.boards.length > 0 },
    { label: "Project lead", done: context.assignedCount > 0 },
    { label: "Library", done: Boolean(project.libraryFolderId) },
    ...(context.milestoneCount > 0 ? [{ label: "Milestone", done: true }] : []),
  ];
}

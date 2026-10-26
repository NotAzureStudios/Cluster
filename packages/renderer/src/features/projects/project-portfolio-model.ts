import type { Project } from "../application/application-models";

const DAY_MS = 86_400_000;

export type ProjectPortfolioFocus = "all" | "pinned" | "at_risk" | "due_soon" | "unscheduled" | "recent";
export type ProjectScheduleTone = "good" | "warning" | "danger" | "neutral";

export function projectScheduleMeta(project: Project, status: string, now = Date.now()) {
  if (project.archived || ["completed", "cancelled"].includes(status)) {
    return { label: project.archived ? "Archived" : "Closed", detail: "Delivery closed", tone: "neutral" as ProjectScheduleTone, days: null };
  }
  if (!project.targetDate) return { label: "Unscheduled", detail: "Target date missing", tone: "warning" as ProjectScheduleTone, days: null };
  const target = new Date(project.targetDate).getTime();
  if (!Number.isFinite(target)) return { label: "Unscheduled", detail: "Target date invalid", tone: "warning" as ProjectScheduleTone, days: null };
  const days = Math.ceil((target - now) / DAY_MS);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, detail: "Target date passed", tone: "danger" as ProjectScheduleTone, days };
  if (days === 0) return { label: "Due today", detail: "Target date is today", tone: "danger" as ProjectScheduleTone, days };
  if (days <= 7) return { label: `${days}d left`, detail: "Due this week", tone: "warning" as ProjectScheduleTone, days };
  if (days <= 30) return { label: `${days}d left`, detail: "Due this month", tone: "warning" as ProjectScheduleTone, days };
  return { label: `${days}d left`, detail: "On schedule", tone: "good" as ProjectScheduleTone, days };
}

export function projectDeliveryProgress(project: Project, now = Date.now()) {
  if (!project.startDate || !project.targetDate) return null;
  const start = new Date(project.startDate).getTime();
  const target = new Date(project.targetDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(target) || target <= start) return null;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (target - start)) * 100)));
}

export function projectAttentionScore(project: Project, status: string, setupGaps: number, completeness: number, pinned = false) {
  const schedule = projectScheduleMeta(project, status);
  let score = pinned ? 2 : 0;
  score += Math.min(setupGaps, 6) * 3;
  score += Math.max(0, 70 - completeness) / 10;
  if (schedule.tone === "danger") score += 14;
  else if (schedule.tone === "warning") score += 6;
  if (project.priority === "urgent") score += 10;
  else if (project.priority === "high") score += 5;
  if (status === "on_hold" || status === "paused") score += 4;
  return score;
}

export function projectMatchesFocus({
  focus,
  project,
  status,
  pinned,
  setupGaps,
  completeness,
  latestTimestamp,
}: {
  focus: ProjectPortfolioFocus;
  project: Project;
  status: string;
  pinned: boolean;
  setupGaps: number;
  completeness: number;
  latestTimestamp: number;
}) {
  if (focus === "all") return true;
  if (focus === "pinned") return pinned;
  const schedule = projectScheduleMeta(project, status);
  if (focus === "due_soon") return schedule.days !== null && schedule.days >= 0 && schedule.days <= 30;
  if (focus === "unscheduled") return !project.targetDate && !project.archived && !["completed", "cancelled"].includes(status);
  if (focus === "recent") return latestTimestamp >= Date.now() - DAY_MS * 14;
  return schedule.tone === "danger" || setupGaps > 0 || completeness < 70 || project.priority === "urgent" || status === "on_hold" || status === "paused";
}

export function formatProjectDate(value?: string | null, fallback = "Unscheduled") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

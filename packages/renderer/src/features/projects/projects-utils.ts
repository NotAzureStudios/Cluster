import { resolveClusterProjectRole } from "@cluster/shared";
import type { ClusterIconName } from "../../components/ClusterIcon";
import { CLUSTER_PROJECT_STATUS_DEFINITIONS } from "@cluster/shared";
import { unique } from "../../core/storage";
import type { Board, BuildMilestonePlanItem, Project, ProjectStatus, TicketCard, TimelineEntry, UserActivitySummary } from "../application/application-models";

function projectMilestoneDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function isVideoProject(project?: Project | null) {
  if (!project) return false;
  const type = project.projectType || "general";
  const tracks = project.productionTracks || [];
  return type === "video" || tracks.includes("video");
}

export function isExternalProject(project?: Pick<Project, "source"> | null) {
  return String(project?.source || "").toLowerCase() === "external";
}

export const PROJECT_STATUS_OPTIONS = CLUSTER_PROJECT_STATUS_DEFINITIONS;

export function normalizeProjectStatus(value?: string | null): ProjectStatus {
  return PROJECT_STATUS_OPTIONS.some((option) => option.value === value) ? (value as ProjectStatus) : "active";
}

export function projectStatusMeta(project: Pick<Project, "status" | "archived">) {
  if (project.archived)
    return {
      value: "archived",
      label: "Archived",
      tone: "muted",
      description: "Hidden from general project lists.",
    };
  return PROJECT_STATUS_OPTIONS.find((option) => option.value === normalizeProjectStatus(project.status)) || PROJECT_STATUS_OPTIONS[0];
}

export function projectStatusLabel(project: Pick<Project, "status" | "archived">) {
  return projectStatusMeta(project).label;
}

export function projectHasGit(project: Project) {
  return Boolean(project.sourceBindings?.some((binding) => Boolean(binding.repositoryId)));
}

export function projectSourceMeta(project: Project): { label: string; icon: ClusterIconName; tone: string } {
  if (isExternalProject(project)) return { label: "External", icon: "link", tone: "external" };
  if (projectHasGit(project)) return { label: "Git", icon: "code", tone: "git" };
  return { label: "Manual", icon: "file", tone: "manual" };
}

export function projectBoardCount(projects: Project[]) {
  return projects.reduce((total, project) => total + project.boards.length, 0);
}

export function projectWhiteboardCount(projects: Project[]) {
  return projects.reduce((total, project) => total + (project.whiteboards?.length || 0), 0);
}

export function projectGitCount(projects: Project[]) {
  return projects.filter((project) => projectHasGit(project)).length;
}

export function projectHasDiscord(project: Project) {
  return Boolean(project.integrationBindings?.some((binding) => binding.connection?.providerId === "communication.discord"));
}

export function projectColumnCount(project: Project) {
  return project.boards.reduce((total, board) => total + (board.lists?.length || 0), 0);
}

export function projectMemberIds(project: Pick<Project, "memberships">) {
  return unique((project.memberships || []).filter((membership) => String(membership.status || "active") === "active").map((membership) => membership.userId));
}

export function projectMemberRoles(project: Pick<Project, "memberships">) {
  return Object.fromEntries((project.memberships || []).filter((membership) => String(membership.status || "active") === "active").map((membership) => [membership.userId, membership.isLead ? "Project Lead" : (resolveClusterProjectRole(membership.roleKey)?.label || resolveClusterProjectRole(membership.roleLabel)?.label || "Contributor")]));
}

export function projectAssignedIds(project: Project) {
  return unique([...projectMemberIds(project), ...project.boards.flatMap((board) => [...(board.assignedUserIds || []), ...(board.lists || []).flatMap((list) => list.assignedUserIds || [])])]);
}

export function projectLatestTimestamp(project: Project) {
  const values = [project.updatedAt, ...project.boards.map((board) => board.updatedAt), ...(project.whiteboards || []).map((whiteboard) => whiteboard.updatedAt)].map((value) => (value ? new Date(value).getTime() : 0)).filter((value) => !Number.isNaN(value));
  return Math.max(0, ...values);
}

export function projectSetupGaps(project: Project) {
  const gaps: string[] = [];
  if (!project.description) gaps.push("Add brief");
  if (!project.objective) gaps.push("Define success");
  if (!project.targetDate) gaps.push("Set target date");
  if (!projectAssignedIds(project).length) gaps.push(isExternalProject(project) ? "Assign external project owner" : "Assign project owner");
  if (!project.boards.length) gaps.push("Add board");
  return gaps;
}

export function projectMembers(project: Project, users: UserActivitySummary[] = []) {
  const ids = projectAssignedIds(project);
  const userMap = new Map(users.map((user) => [user.id, user]));
  return ids.map((id) => userMap.get(id)).filter(Boolean) as UserActivitySummary[];
}

export function projectCompleteness(project: Project) {
  const checks = [Boolean(project.name), Boolean(project.description), Boolean(project.objective), Boolean(project.targetDate), Boolean(projectAssignedIds(project).length), project.boards.length > 0];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function projectHealth(project: Project) {
  const completeness = projectCompleteness(project);
  const status = projectStatusMeta(project);
  if (project.archived) return { label: "Archived", tone: "neutral" };
  if (status.value === "cancelled") return { label: "Cancelled", tone: "danger" };
  if (status.value === "on_hold" || status.value === "paused") return { label: status.label, tone: "warning" };
  if (status.value === "completed") return { label: "Completed", tone: "good" };
  if (project.targetDate && new Date(project.targetDate).getTime() < Date.now()) return { label: "Past target", tone: "danger" };
  if ((project.priority || "medium") === "urgent" && completeness < 80) return { label: "Urgent setup", tone: "warning" };
  if (!project.boards.length) return { label: "No board", tone: "danger" };
  if (isExternalProject(project) && !projectAssignedIds(project).length) return { label: "No external owner", tone: "warning" };
  if (completeness >= 72) return { label: "On track", tone: "good" };
  if (projectHasGit(project)) return { label: "Repo linked", tone: "good" };
  return { label: "Setup", tone: "neutral" };
}

export const BUILD_MILESTONE_TEMPLATES = [
  {
    label: "Concept",
    aliases: ["concept", "pitch", "preproduction", "pre-production", "design"],
    goal: "Core idea, scope, pillars, and risks are written down.",
  },
  {
    label: "Prototype",
    aliases: ["prototype", "proto", "proof of concept", "poc"],
    goal: "Playable proof of the main mechanic.",
  },
  {
    label: "Slice",
    aliases: ["vertical slice", "slice"],
    goal: "One polished sample of gameplay, art, audio, and UI.",
  },
  {
    label: "Alpha",
    aliases: ["alpha", "content complete", "feature complete"],
    goal: "Core systems are playable end to end.",
  },
  {
    label: "Beta",
    aliases: ["beta", "test build", "playtest"],
    goal: "Bug fixing, balance, UX, and performance focus.",
  },
  {
    label: "Launch",
    aliases: ["launch", "release", "rc", "release candidate", "ship", "gold"],
    goal: "Release candidate, store page, build notes, and final checks.",
  },
];

export function projectPlanningText(project: Project) {
  return [project.name, project.description || "", ...project.boards.flatMap((board) => [board.name, board.description || "", ...(board.lists || []).map((list) => list.title)])].join(" ").toLowerCase();
}

export function importantBuildEntries(entries: TimelineEntry[]) {
  const buildWords = ["milestone", "release", "deadline", "build", "prototype", "slice", "alpha", "beta", "launch", "playtest", "rc"];
  return entries
    .filter((entry) => {
      const text = `${entry.type || ""} ${entry.title || ""} ${entry.description || ""}`.toLowerCase();
      return buildWords.some((word) => text.includes(word));
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function projectBuildStage(project: Project, entries: TimelineEntry[] = []) {
  const text = `${projectPlanningText(project)} ${importantBuildEntries(entries)
    .map((entry) => `${entry.title} ${entry.type}`)
    .join(" ")}`;
  const found = [...BUILD_MILESTONE_TEMPLATES].reverse().find((template) => template.aliases.some((alias) => text.includes(alias)));
  if (found) return { label: found.label, detail: found.goal };
  if (!project.boards.length) return { label: "Setup", detail: "Create the first production board." };
  if (projectCompleteness(project) >= 72)
    return {
      label: "Production",
      detail: "Project basics are wired up. Add dated milestones next.",
    };
  return {
    label: "Planning",
    detail: "Add stage, project leads, and milestone dates.",
  };
}

export function projectBuildMilestones(project: Project, entries: TimelineEntry[] = []): BuildMilestonePlanItem[] {
  const text = projectPlanningText(project);
  const importantEntries = importantBuildEntries(entries);
  return BUILD_MILESTONE_TEMPLATES.map((template) => {
    const matchedEntry = importantEntries.find((entry) => {
      const entryText = `${entry.type || ""} ${entry.title || ""} ${entry.description || ""}`.toLowerCase();
      return template.aliases.some((alias) => entryText.includes(alias));
    });
    if (matchedEntry) {
      return {
        label: template.label,
        goal: template.goal,
        status: "scheduled",
        meta: projectMilestoneDateTime(matchedEntry.startsAt),
        date: matchedEntry.startsAt,
      };
    }
    const mentioned = template.aliases.some((alias) => text.includes(alias));
    if (mentioned)
      return {
        label: template.label,
        goal: template.goal,
        status: "tracked",
        meta: "Mentioned in board/project text",
      };
    return {
      label: template.label,
      goal: template.goal,
      status: "missing",
      meta: "Needs date/project lead",
    };
  });
}

export function collectBoardCards(boards: Board[]): TicketCard[] {
  return boards.flatMap((board) =>
    board.lists.flatMap((list) =>
      list.cards.map((card) => ({
        ...card,
        boardName: board.name,
        projectName: board.project.name,
        projectId: board.project.id,
        listTitle: list.title,
        listIsDone: Boolean(list.isDone),
        boardId: board.id,
      })),
    ),
  );
}

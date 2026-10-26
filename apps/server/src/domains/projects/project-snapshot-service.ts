import type { FastifyRequest } from "fastify";
import type { ClusterProjectSnapshot } from "@cluster/shared";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

type ProjectSnapshotServiceInput = {
  prisma: any;
  authorization: any;
  hasToolPermission: (user: any, role: string | null | undefined, tool: string, level?: string) => boolean;
};

type SnapshotContext = {
  request: FastifyRequest;
  user: any;
  decorated: any;
  projectIds: string[];
};

const DAY_MS = 86_400_000;

function toIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scheduleFor(project: any, now: Date): ClusterProjectSnapshot["schedule"] {
  const status = String(project.status || "active").toLowerCase();
  if (project.archived || ["completed", "cancelled"].includes(status)) {
    return { state: "closed", label: project.archived ? "Archived" : "Closed", targetDate: toIso(project.targetDate), daysToTarget: null };
  }
  if (!project.targetDate) return { state: "unscheduled", label: "Unscheduled", targetDate: null, daysToTarget: null };
  const target = new Date(project.targetDate);
  if (!Number.isFinite(target.getTime())) return { state: "unscheduled", label: "Unscheduled", targetDate: null, daysToTarget: null };
  const days = Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return { state: "overdue", label: `${Math.abs(days)}d overdue`, targetDate: target.toISOString(), daysToTarget: days };
  if (days === 0) return { state: "due_soon", label: "Due today", targetDate: target.toISOString(), daysToTarget: 0 };
  if (days <= 30) return { state: "due_soon", label: `${days}d left`, targetDate: target.toISOString(), daysToTarget: days };
  return { state: "scheduled", label: `${days}d left`, targetDate: target.toISOString(), daysToTarget: days };
}

function buildReadiness(project: any, capabilities: { boards: boolean; people: boolean; library: boolean }) {
  const checks: Array<{ label: string; done: boolean }> = [
    { label: "Project brief", done: Boolean(String(project.description || "").trim()) },
    { label: "Project objective", done: Boolean(String(project.objective || "").trim()) },
    { label: "Target date", done: Boolean(project.targetDate) },
  ];
  if (capabilities.boards) checks.push({ label: "Primary board", done: Number(project._count?.boards || 0) > 0 });
  if (capabilities.people) checks.push({ label: "Project lead", done: Boolean((project.memberships || []).some((membership: any) => membership.isLead)) });
  if (capabilities.library) checks.push({ label: "Project Library", done: Boolean(project.libraryFolderId) });
  const completed = checks.filter((check) => check.done).length;
  const score = checks.length ? Math.round((completed / checks.length) * 100) : 100;
  return { score, ready: score === 100, visibleChecks: checks.length, completedChecks: completed, gaps: checks.filter((check) => !check.done).map((check) => check.label) };
}

function healthFor(input: { schedule: ClusterProjectSnapshot["schedule"]; readiness: ClusterProjectSnapshot["readiness"]; failedBuilds: number | null; qaAttention: number | null; priority: string; status: string }) {
  const reasons: string[] = [];
  let attentionScore = 0;
  if (input.schedule.state === "overdue") { attentionScore += 30; reasons.push("Target date is overdue"); }
  else if (input.schedule.state === "due_soon") { attentionScore += 10; reasons.push("Target date is approaching"); }
  else if (input.schedule.state === "unscheduled") { attentionScore += 8; reasons.push("Target date is not set"); }
  if (input.readiness.score < 70) { attentionScore += 20; reasons.push("Project setup is incomplete"); }
  else if (!input.readiness.ready) { attentionScore += 8; reasons.push("Project setup has remaining gaps"); }
  if ((input.failedBuilds || 0) > 0) { attentionScore += 30; reasons.push(`${input.failedBuilds} build${input.failedBuilds === 1 ? "" : "s"} need attention`); }
  if ((input.qaAttention || 0) > 0) { attentionScore += 25; reasons.push(`${input.qaAttention} QA item${input.qaAttention === 1 ? "" : "s"} need attention`); }
  if (input.priority === "urgent") { attentionScore += 10; reasons.push("Priority is urgent"); }
  else if (input.priority === "high") attentionScore += 4;
  if (["on_hold", "paused"].includes(input.status)) { attentionScore += 8; reasons.push("Project is on hold"); }
  const state: ClusterProjectSnapshot["health"]["state"] = attentionScore >= 60
    ? "blocked"
    : attentionScore >= 30
      ? "at_risk"
      : attentionScore > 0
        ? "attention"
        : "healthy";
  return { state, attentionScore, reasons: reasons.slice(0, 6) };
}

export function createProjectSnapshotService(input: ProjectSnapshotServiceInput) {
  async function snapshotsForRequest(context: SnapshotContext): Promise<ClusterProjectSnapshot[]> {
    const projectIds = [...new Set(context.projectIds.map(String).filter(Boolean))].slice(0, 250);
    if (!projectIds.length) return [];
    const role = context.decorated?.workspaceRole || null;
    const isAdmin = Boolean(context.decorated?.isAdmin);
    const hasTool = (tool: string) => Boolean(isAdmin || input.hasToolPermission(context.user, role, tool, "view"));
    const canBoards = hasTool("boards");
    const canPeople = hasTool("people");
    const canLibrary = hasTool("library");
    const canTimeline = hasTool("timeline");
    const canCalendar = hasTool("calendar");
    const canBuilds = hasTool("builds");
    const canQa = hasTool("qa");
    const externalSafe = Boolean(input.authorization?.isExternalCollaboratorRole?.(context.user, role));
    const now = new Date();

    const projects = await input.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true, name: true, externalName: true, codename: true, description: true, objective: true,
        targetDate: true, priority: true, projectType: true, productionProfile: true, status: true,
        archived: true, updatedAt: true, libraryFolderId: true,
        memberships: {
          where: { status: "active" },
          orderBy: [{ isLead: "desc" }, { createdAt: "asc" }],
          select: { userId: true, isLead: true, user: { select: { username: true, displayName: true } } },
        },
        _count: { select: { boards: { where: { archived: false } } } },
      },
    });
    const foundIds = projects.map((project: any) => project.id);

    const [milestones, calendarCandidates, latestBuilds, buildGroups, qaGroups] = await Promise.all([
      canTimeline ? input.prisma.timelineItem.findMany({ where: { projectId: { in: foundIds }, startsAt: { gte: now }, type: { in: ["milestone", "deadline", "release", "build"] } }, orderBy: { startsAt: "asc" }, take: Math.max(80, foundIds.length * 8) }) : Promise.resolve([]),
      canCalendar ? input.prisma.calendarEvent.findMany({ where: { projectId: { in: foundIds }, startsAt: { gte: now }, status: { notIn: ["cancelled", "canceled"] } }, orderBy: { startsAt: "asc" }, take: Math.max(120, foundIds.length * 12), include: { project: { include: { memberships: { where: { status: "active" } } } } } }) : Promise.resolve([]),
      canBuilds ? input.prisma.deliveryBuild.findMany({ where: { projectId: { in: foundIds }, archived: false }, orderBy: { createdAt: "desc" }, distinct: ["projectId"], select: { id: true, projectId: true, title: true, qaStatus: true, approval: true, createdAt: true } }) : Promise.resolve([]),
      canBuilds ? input.prisma.deliveryBuild.groupBy({ by: ["projectId", "qaStatus", "approval"], where: { projectId: { in: foundIds }, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
      canQa ? input.prisma.deliveryQaSession.groupBy({ by: ["projectId", "status", "decision"], where: { projectId: { in: foundIds }, archived: false }, _count: { _all: true } }) : Promise.resolve([]),
    ]);

    const milestoneByProject = new Map<string, any>();
    for (const milestone of milestones as any[]) if (!milestoneByProject.has(String(milestone.projectId))) milestoneByProject.set(String(milestone.projectId), milestone);

    const calendarByProject = new Map<string, any>();
    for (const event of calendarCandidates as any[]) {
      const projectId = String(event.projectId || "");
      if (!projectId || calendarByProject.has(projectId)) continue;
      if (await canAccessCalendarEvent(input.authorization, context.request, event, "view")) calendarByProject.set(projectId, event);
    }

    const latestBuildByProject = new Map((latestBuilds as any[]).map((build) => [String(build.projectId), build]));
    const failedBuildsByProject = new Map<string, number>();
    for (const group of buildGroups as any[]) {
      if (String(group.qaStatus || "").toLowerCase() !== "failed" && String(group.approval || "").toLowerCase() !== "blocked") continue;
      const key = String(group.projectId);
      failedBuildsByProject.set(key, (failedBuildsByProject.get(key) || 0) + Number(group?._count?._all || 0));
    }
    const qaAttentionByProject = new Map<string, number>();
    for (const group of qaGroups as any[]) {
      const needsAttention = ["failed", "blocked"].includes(String(group.status || "").toLowerCase()) || String(group.decision || "").toLowerCase() === "no-go";
      if (!needsAttention) continue;
      const key = String(group.projectId);
      qaAttentionByProject.set(key, (qaAttentionByProject.get(key) || 0) + Number(group?._count?._all || 0));
    }

    return projects.map((project: any) => {
      const schedule = scheduleFor(project, now);
      const readiness = buildReadiness(project, { boards: canBoards, people: canPeople, library: canLibrary });
      const latestBuild = latestBuildByProject.get(String(project.id)) || null;
      const failedBuilds = canBuilds ? (failedBuildsByProject.get(String(project.id)) || 0) : null;
      const qaAttention = canQa ? (qaAttentionByProject.get(String(project.id)) || 0) : null;
      const health = healthFor({ schedule, readiness, failedBuilds, qaAttention, priority: String(project.priority || "medium"), status: String(project.status || "active").toLowerCase() });
      const leadMembership = (project.memberships || []).find((membership: any) => membership.isLead) || null;
      const milestone = milestoneByProject.get(String(project.id)) || null;
      const calendar = calendarByProject.get(String(project.id)) || null;
      const internalName = externalSafe ? null : String(project.name || "");
      const externalName = project.externalName ? String(project.externalName) : null;
      const displayName = externalSafe ? (externalName || String(project.name || "")) : String(project.name || "");
      return {
        schema: 1,
        projectId: String(project.id),
        generatedAt: now.toISOString(),
        identity: {
          displayName,
          internalName,
          externalName,
          codename: externalSafe ? null : (project.codename ? String(project.codename) : null),
          externalSafe,
          projectType: String(project.projectType || "general"),
          productionProfile: String(project.productionProfile || "generic"),
        },
        lifecycle: {
          status: String(project.status || "active"),
          archived: Boolean(project.archived),
          priority: String(project.priority || "medium"),
          updatedAt: toIso(project.updatedAt),
        },
        lead: {
          configured: Boolean(leadMembership),
          userId: canPeople && leadMembership ? String(leadMembership.userId) : null,
          displayName: canPeople && leadMembership ? String(leadMembership.user?.displayName || leadMembership.user?.username || "") || null : null,
          username: canPeople && leadMembership ? String(leadMembership.user?.username || "") || null : null,
        },
        team: { assigned: canPeople ? Number((project.memberships || []).length) : null },
        readiness,
        schedule,
        nextMilestone: milestone ? { id: String(milestone.id), title: String(milestone.title || "Milestone"), type: String(milestone.type || "milestone"), startsAt: toIso(milestone.startsAt)! } : null,
        nextCalendar: calendar ? { id: String(calendar.id), title: String(calendar.title || "Event"), eventType: String(calendar.eventType || "event"), startsAt: toIso(calendar.startsAt)! } : null,
        delivery: {
          latestBuildId: latestBuild ? String(latestBuild.id) : null,
          latestBuildTitle: latestBuild ? String(latestBuild.title || "Build") : null,
          latestBuildStatus: latestBuild ? `${String(latestBuild.qaStatus || "untested")}/${String(latestBuild.approval || "draft")}` : null,
          failedBuilds,
          qaAttention,
        },
        health,
      } satisfies ClusterProjectSnapshot;
    });
  }

  return { snapshotsForRequest };
}

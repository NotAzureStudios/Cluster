import { resolveClusterProjectRole } from "@cluster/shared";
import { levelLabel } from "../../core/format";
import { canUseTool, isExternalCollaborator, isUserAccessExpired, PROJECT_LEVEL_RANK, type ProjectPermissionLevel } from "../../core/permissions";
import type { AccessRule, AccessTargetKind, LibraryItem, Project, User, UserActivitySummary } from "../application/application-models";
import { isExternalProject } from "./projects-utils";


type ProjectUser = User | UserActivitySummary | null | undefined;
type ProjectPermissionTarget = Pick<Project, "id" | "memberships" | "source">;
type AccessIdentity = Pick<User, "id" | "studioTeams" | "workspaceRole" | "employmentType" | "title" | "isAdmin"> | null | undefined;

function accessSubjectMatchesUser(rule: Pick<AccessRule, "subjectKind" | "subjectId" | "subjectName">, user?: AccessIdentity) {
  if (rule.subjectKind === "all") return true;
  if (!user) return false;
  if (rule.subjectKind === "member") return rule.subjectId === user.id;
  if (rule.subjectKind === "team") return Boolean(rule.subjectId && user.studioTeams?.some((team) => team.id === rule.subjectId));
  if (rule.subjectKind === "external") return isExternalCollaborator(user);
  return false;
}

function accessRulesForTarget(rules: AccessRule[], targetKind: AccessTargetKind, targetId: string, projectId?: string | null) {
  const now = Date.now();
  return rules.filter((rule) => rule.status === "active" && (!rule.expiresAt || new Date(rule.expiresAt).getTime() > now) && ((rule.targetKind === targetKind && rule.targetId === targetId) || (targetKind !== "project" && rule.targetKind === "project" && rule.targetId === projectId)));
}

function activeMembershipFor(project: ProjectPermissionTarget, userId: string) {
  if (!Array.isArray(project.memberships)) return null;
  const now = Date.now();
  return project.memberships.find((membership) => {
    if (membership.userId !== userId || String(membership.status || "active") !== "active") return false;
    const starts = membership.startsAt ? new Date(membership.startsAt).getTime() : null;
    const ends = membership.endsAt ? new Date(membership.endsAt).getTime() : null;
    return !(starts && Number.isFinite(starts) && starts > now) && !(ends && Number.isFinite(ends) && ends <= now);
  }) || null;
}

export function resolveAccessOverride(user: AccessIdentity, targetKind: AccessTargetKind, targetId: string, projectId?: string | null, rules: AccessRule[] = []): ProjectPermissionLevel | null {
  if (user?.isAdmin) return "manage";
  const scoped = accessRulesForTarget(rules, targetKind, targetId, projectId);
  if (!scoped.length) return null;
  const matching = scoped.filter((rule) => accessSubjectMatchesUser(rule, user));
  if (matching.some((rule) => rule.effect === "deny")) return "none";
  const allows = matching.filter((rule) => rule.effect === "allow");
  if (allows.length) return allows.reduce<ProjectPermissionLevel>((best, rule) => (PROJECT_LEVEL_RANK[rule.level] > PROJECT_LEVEL_RANK[best] ? rule.level : best), "view");
  if (scoped.some((rule) => rule.effect === "allow")) return "none";
  return null;
}

export function getProjectPermission(user: ProjectUser, project?: ProjectPermissionTarget | null): ProjectPermissionLevel {
  if (user?.isAdmin) return "manage";
  if (isUserAccessExpired(user as User)) return "none";
  if (!project) return "none";
  const serverLevel = (project as Project).capabilities?.level;
  if (serverLevel) return serverLevel;
  const accessOverride = resolveAccessOverride(user as User, "project", project.id, project.id, []);
  if (accessOverride) return accessOverride;
  const explicit = user?.projectPermissions?.[project.id];
  if (explicit) return explicit;
  if (isExternalCollaborator(user)) return isExternalProject(project as Project) ? "view" : "none";
  const userId = user?.id || "";
  const membership = activeMembershipFor(project, userId);
  const assigned = Boolean(membership);
  if (!assigned) return "view";
  if (membership?.isLead || membership?.roleKey === "lead") return "manage";
  const level = membership?.accessLevel;
  return level === "view" || level === "contribute" || level === "manage" ? level : "none";
}

export function canUseProject(user: ProjectUser, project?: ProjectPermissionTarget | null, min: ProjectPermissionLevel = "view") {
  return PROJECT_LEVEL_RANK[getProjectPermission(user, project)] >= PROJECT_LEVEL_RANK[min];
}

export function projectPermissionReason(user: ProjectUser, project?: Project | null) {
  if (!user || !project) return "No user/project selected";
  if (user.isAdmin) return "Admin override grants manage access.";
  if (isUserAccessExpired(user as User)) return `Account access expired${user.accessExpiresAt ? ` on ${new Date(user.accessExpiresAt).toLocaleDateString()}` : ""}.`;
  if (project.capabilities?.reason) return project.capabilities.reason;
  const override = resolveAccessOverride(user as User, "project", project.id, project.id, []);
  if (override) return `Active access rule: ${levelLabel(override)}.`;
  const explicit = user.projectPermissions?.[project.id];
  if (explicit) return `Explicit project override: ${levelLabel(explicit)}.`;
  if (isExternalCollaborator(user)) return isExternalProject(project) ? "External default: view access on external projects." : "External default: internal projects hidden unless explicitly allowed.";
  const membership = activeMembershipFor(project, user.id);
  const assigned = Boolean(membership);
  if (assigned) return `${membership?.roleLabel || "Project member"} membership grants ${membership?.isLead ? "manage" : (membership?.accessLevel || "none")} access.`;
  return "Workspace default: view.";
}

export function canUseEntityAccess(user: ProjectUser, targetKind: AccessTargetKind, targetId: string, project?: Project | null, min: ProjectPermissionLevel = "view") {
  const override = resolveAccessOverride(user as User, targetKind, targetId, project?.id || null);
  const level = override || (project ? getProjectPermission(user, project) : "view");
  return PROJECT_LEVEL_RANK[level] >= PROJECT_LEVEL_RANK[min];
}

export function canUseLibraryItem(user: User | null | undefined, item: LibraryItem, project?: Project | null, min: ProjectPermissionLevel = "view") {
  const override = resolveAccessOverride(user, "library", item.id, item.projectId || project?.id || null);
  const level = override || (project ? getProjectPermission(user, project) : item.visibility === "private" && !user?.isAdmin ? "none" : "view");
  return PROJECT_LEVEL_RANK[level] >= PROJECT_LEVEL_RANK[min];
}

export function accessTargetLabel(kind: AccessTargetKind) {
  return ({ project: "Project", library: "Library item", file: "File", board: "Board", whiteboard: "Whiteboard", review_asset: "Review asset" } as Record<AccessTargetKind, string>)[kind] || levelLabel(kind);
}

export type ProjectCapabilities = {
  level: ProjectPermissionLevel;
  reason: string;
  canView: boolean;
  canContribute: boolean;
  canEditProject: boolean;
  canManage: boolean;
  canManageTeam: boolean;
  canManageConnections: boolean;
  canCreateSpaces: boolean;
  canManageAccess: boolean;
  canCloseout: boolean;
};

export function getProjectCapabilities(user: ProjectUser, project: Project): ProjectCapabilities {
  const level = getProjectPermission(user, project);
  const canManage = PROJECT_LEVEL_RANK[level] >= PROJECT_LEVEL_RANK.manage;
  const canContribute = PROJECT_LEVEL_RANK[level] >= PROJECT_LEVEL_RANK.contribute;
  const canEditProject = canManage || canUseTool(user as User, "projects", "edit");
  return {
    level,
    reason: projectPermissionReason(user, project),
    canView: PROJECT_LEVEL_RANK[level] >= PROJECT_LEVEL_RANK.view,
    canContribute,
    canEditProject,
    canManage,
    canManageTeam: canManage,
    canManageConnections: canManage,
    canCreateSpaces: canManage,
    canManageAccess: canManage,
    canCloseout: canManage,
  };
}

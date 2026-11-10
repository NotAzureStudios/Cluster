import { unique } from "../../core/storage";
import type { AdminPageScope, AdminSection, Project, Settings, UserActivitySummary } from "../application/application-models";
import { presenceState } from "../people/people-utils";
import { PROJECT_STATUS_OPTIONS, isExternalProject, normalizeProjectStatus, projectAssignedIds, projectSetupGaps } from "../projects/projects-utils";

export type AdminUserListMode = "all" | "resets" | "onboarding" | "access" | "suspended" | "archived";

export const ADMIN_WORKSPACE_SECTIONS = [
  { id: "users", scope: "users", label: "Directory", group: "People", nav: true, order: 10 },
  { id: "exports", scope: "users", label: "Exports", group: "People", nav: true, order: 20 },
  { id: "overview", scope: "operations", label: "Command Center", group: "Monitor", nav: true, order: 10 },
  { id: "incidents", scope: "operations", label: "Incidents", group: "Monitor", nav: true, order: 20 },
  { id: "jobs", scope: "operations", label: "Jobs", group: "Monitor", nav: true, order: 25 },
  { id: "approvals", scope: "operations", label: "Governance", group: "Govern", nav: true, order: 30 },
  { id: "systems", scope: "operations", label: "Systems", group: "Operate", nav: true, order: 40 },
  { id: "reports", scope: "operations", label: "Data & Audit", group: "Operate", nav: true, order: 50 },
] as const satisfies ReadonlyArray<{
  id: AdminSection;
  scope: AdminPageScope;
  label: string;
  group?: "People" | "Monitor" | "Govern" | "Operate";
  nav: boolean;
  order: number;
}>;

export type AdminWorkspaceSectionDefinition = (typeof ADMIN_WORKSPACE_SECTIONS)[number];

export function adminWorkspaceSections(scope: AdminPageScope, navOnly = false) {
  return ADMIN_WORKSPACE_SECTIONS.filter((section) => section.scope === scope && (!navOnly || section.nav));
}

/** Canonical navigation groups, preserving reachability of specialist admin sections. */
export const ADMIN_OPERATIONS_CONTEXT = {
  approvals: [
    { id: "approvals", label: "Approvals" },
    { id: "security-center", label: "Security Center" },
  ],
  systems: [
    { id: "systems", label: "System health" },
    { id: "maintenance", label: "Maintenance" },
    { id: "persistence", label: "Data persistence" },
    { id: "stabilization", label: "Stabilization" },
  ],
  reports: [
    { id: "reports", label: "Reports & audit" },
    { id: "imports", label: "Imports" },
    { id: "data-model", label: "Data model" },
    { id: "templates", label: "Templates" },
    { id: "changelog", label: "Changelog" },
  ],
} as const;

export function canonicalAdminOperationsSection(section: AdminSection): AdminSection {
  if (section === "permissions" || section === "security-center") return "approvals";
  if (section === "operations-center" || section === "jobs") return "jobs";
  if (section === "maintenance" || section === "persistence" || section === "stabilization" || section === "system") return "systems";
  if (section === "imports" || section === "data-model" || section === "templates" || section === "changelog" || section === "activity") return "reports";
  return section;
}

export function coerceAdminWorkspaceSection(scope: AdminPageScope, requested?: AdminSection | null): AdminSection {
  if (scope === "users") return requested === "exports" ? "exports" : "users";
  if (requested === "incidents" || requested === "jobs" || requested === "security-center" || requested === "systems" || requested === "reports" || requested === "overview" || requested === "approvals") return requested;
  if (requested === "permissions") return "security-center";
  if (requested === "operations-center") return "jobs";
  if (["maintenance", "system", "persistence", "stabilization"].includes(String(requested || ""))) return "systems";
  if (["activity", "imports", "changelog", "data-model", "templates"].includes(String(requested || ""))) return "reports";
  return "overview";
}

export function buildAdminWorkspaceNav(scope: AdminPageScope, input: { userCount: number; pendingApprovals: number }) {
  return adminWorkspaceSections(scope, true).map((section) => ({
    id: section.id,
    label: section.label,
    detail: section.id === "users" ? String(input.userCount) : section.id === "approvals" ? String(input.pendingApprovals) : undefined,
    group: "group" in section ? section.group : undefined,
  }));
}

export function adminUserNeedsOnboarding(member: UserActivitySummary) {
  return member.accountState === "PASSWORD_CHANGE_REQUIRED" || member.accountState === "PASSWORD_RESET_REQUIRED";
}

export function adminUserNeedsAccessReview(member: UserActivitySummary) {
  return (!member.isAdmin && !Object.keys(member.toolPermissions || {}).length)
    || Boolean(member.accessExpiresAt && new Date(member.accessExpiresAt).getTime() < Date.now())
    || member.accountState === "SUSPENDED"
    || member.accountState === "DISABLED";
}

export function filterAdminUsers(input: {
  users: UserActivitySummary[];
  mode: AdminUserListMode;
  showArchived: boolean;
  passwordResetUserIds: ReadonlySet<string>;
  departmentFilter: string;
  roleFilter: string;
  query: string;
}) {
  const normalizedQuery = input.query.trim().toLowerCase();
  return input.users.filter((member) => {
    if (input.mode === "archived" && !member.archived) return false;
    if (input.mode !== "archived" && !input.showArchived && member.archived) return false;
    if (input.mode === "resets" && !input.passwordResetUserIds.has(member.id)) return false;
    if (input.mode === "onboarding" && !adminUserNeedsOnboarding(member)) return false;
    if (input.mode === "access" && !adminUserNeedsAccessReview(member)) return false;
    if (input.mode === "suspended" && member.accountState !== "SUSPENDED" && member.accountState !== "DISABLED") return false;
    if (input.departmentFilter !== "all" && (member.department || "Unassigned") !== input.departmentFilter) return false;
    if (input.roleFilter !== "all" && (member.workspaceRole || "member") !== input.roleFilter) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      member.username,
      member.displayName,
      member.legalName,
      member.preferredName,
      member.email,
      ...(member.alternateEmails || []),
      member.phoneNumber,
      member.alternatePhoneNumber,
      member.title,
      member.department,
      member.teamName,
      member.managerName,
      member.employmentType,
      member.workLocation,
      member.statusMessage,
      member.accountState,
      member.workspaceRole,
      ...(member.skills || []),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function deriveAdminOperationsState(input: {
  users: UserActivitySummary[];
  projects: Project[];
  settings?: Settings;
  pendingApprovals: number;
  profileGapUserCount: number;
}) {
  const { users, projects, settings } = input;
  const activeProjects = projects.filter((project) => !project.archived && normalizeProjectStatus(project.status) === "active");
  const projectsWithoutLeads = projects.filter((project) => !project.archived && projectAssignedIds(project).length === 0);
  const projectsWithoutBoards = projects.filter((project) => !project.archived && project.boards.length === 0);
  const externalProjects = projects.filter((project) => !project.archived && isExternalProject(project));
  const permissionGapCount = users.filter((member) => !member.archived && !member.isAdmin && !Object.keys(member.toolPermissions || {}).length).length;
  const toolStates = [
    { label: "Timeline", enabled: settings?.timelineEnabled !== false },
    { label: "Tickets", enabled: settings?.ticketsEnabled !== false },
    { label: "Calendar", enabled: settings?.calendarEnabled !== false },
    { label: "Scheduler", enabled: settings?.schedulerEnabled !== false },
    { label: "Library", enabled: settings?.libraryEnabled !== false },
    { label: "Packets", enabled: settings?.packetsEnabled !== false },
  ];
  const activeUserCount = users.filter((member) => !member.archived && ["active", "available", "busy", "away"].includes(presenceState(member))).length;
  const awayUserCount = users.filter((member) => !member.archived && presenceState(member) === "away").length;
  const offlineUserCount = users.filter((member) => !member.archived && !["active", "available", "busy", "away"].includes(presenceState(member))).length;
  const projectStatusSummary = PROJECT_STATUS_OPTIONS.map((option) => ({
    ...option,
    count: projects.filter((project) => !project.archived && normalizeProjectStatus(project.status) === option.value).length,
  })).filter((item) => item.count > 0);
  const userStatusSummary = [
    { label: "Active", count: activeUserCount },
    { label: "Away", count: awayUserCount },
    { label: "Offline", count: offlineUserCount },
    { label: "Suspended", count: users.filter((member) => member.accountState === "SUSPENDED" || member.accountState === "DISABLED").length },
  ];
  const criticalGapCount = input.pendingApprovals + projectsWithoutLeads.length + projectsWithoutBoards.length + input.profileGapUserCount + permissionGapCount;
  const readinessDenominator = Math.max(1, projects.length * 2 + users.filter((member) => !member.archived).length * 2 + 5);
  const readinessScore = Math.max(0, Math.round(100 - (criticalGapCount / readinessDenominator) * 100));
  const recentUsers = [...users].filter((member) => !member.archived).sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime()).slice(0, 8);
  const disabledToolCount = toolStates.filter((tool) => !tool.enabled).length;
  const suspendedUserCount = users.filter((member) => member.accountState === "SUSPENDED" || member.accountState === "DISABLED").length;
  const expiredAccessCount = users.filter((member) => member.accessExpiresAt && new Date(member.accessExpiresAt).getTime() < Date.now()).length;
  const staleUserCount = users.filter((member) => !member.archived && (!member.lastSeenAt || Date.now() - new Date(member.lastSeenAt).getTime() > 1000 * 60 * 60 * 24 * 14)).length;
  const portfolioRows = projects.filter((project) => !project.archived).map((project) => ({ project, gaps: projectSetupGaps(project), leads: projectAssignedIds(project).length })).sort((a, b) => b.gaps.length - a.gaps.length || a.project.name.localeCompare(b.project.name)).slice(0, 10);
  const atRiskProjectCount = projects.filter((project) => !project.archived && (projectSetupGaps(project).length > 1 || ["on_hold", "paused", "blocked"].includes(normalizeProjectStatus(project.status)))).length;
  const departmentSummary = (Object.entries(users.filter((member) => !member.archived).reduce<Record<string, number>>((acc, member) => {
    const key = member.department || "Unassigned";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})) as Array<[string, number]>).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const onboardingUserCount = users.filter((member) => !member.archived && adminUserNeedsOnboarding(member)).length;
  const accessReviewUserCount = users.filter((member) => !member.archived && adminUserNeedsAccessReview(member)).length;
  const roleOptions = unique(users.map((member) => member.workspaceRole || "member"));
  const departmentFilterOptions = unique(users.map((member) => member.department || "Unassigned"));
  return {
    activeProjects,
    projectsWithoutLeads,
    projectsWithoutBoards,
    externalProjects,
    permissionGapCount,
    toolStates,
    activeUserCount,
    awayUserCount,
    offlineUserCount,
    projectStatusSummary,
    userStatusSummary,
    criticalGapCount,
    readinessScore,
    recentUsers,
    disabledToolCount,
    suspendedUserCount,
    expiredAccessCount,
    staleUserCount,
    portfolioRows,
    atRiskProjectCount,
    departmentSummary,
    onboardingUserCount,
    accessReviewUserCount,
    roleOptions,
    departmentFilterOptions,
  };
}

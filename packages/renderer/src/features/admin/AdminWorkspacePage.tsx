import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import "../operations/operations-workspaces.css";
import "../application/admin-control-center.css";
import type * as React from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api, mutateApi, queryApi, setApiQueryData } from "../../core/api";
import { csvToTags, unique } from "../../core/storage";
import { defaultToolPermissionsForUser, EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS, PROJECT_LEVEL_OPTIONS, ROLE_PERMISSION_TEMPLATES, TOOL_LEVEL_OPTIONS, TOOL_PERMISSION_OPTIONS, canUseTool, getToolLevel, type ProjectPermissionLevel, type ProjectPermissions, type ToolPermissionKey, type ToolPermissionLevel, type ToolPermissions } from "../../core/permissions";
import { formatRelativeTime, levelLabel } from "../../core/format";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { HealthStrip } from "../../components/ClusterVisualIntelligence";
import { InlineLoadingState } from "../../components/LoadingState";
import { SectionedWorkspaceShell } from "../../components/SectionedWorkspaceShell";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ActivityPage } from "../activity/ActivityPage";
import { ChangelogPage } from "../application/application-entrypoints";
import { AdminApprovalCenter } from "./AdminApprovalCenter";
import { AdminAuditStreamPanel } from "./AdminAuditStreamPanel";
import { AdminSetupChecklist } from "./AdminSetupChecklist";
import { ServerAdminExperiencePanel } from "./ServerAdminExperiencePanel";
import { StudioKnowledgeOperationsPanel } from "../operations/StudioKnowledgeOperationsPanel";
import { AdminUtilitySections } from "./AdminUtilitySections";
import { OperationsCenterPanel } from "./BackgroundJobsPanel";
import { OperationsEvidencePanel } from "./OperationsEvidencePanel";
import { OperationsIncidentsPanel } from "./OperationsIncidentsPanel";
import { SecurityCenterPanel } from "./SecurityCenterPanel";
import { OperationsSystemsPanel } from "./OperationsSystemsPanel";
import { adminUserNeedsAccessReview, adminUserNeedsOnboarding, buildAdminWorkspaceNav, coerceAdminWorkspaceSection, canonicalAdminOperationsSection, ADMIN_OPERATIONS_CONTEXT, deriveAdminOperationsState, filterAdminUsers, type AdminUserListMode } from "./admin-workspace-state";
import { displayUserName, presenceLabel, presenceState, userInitial } from "../people/people-utils";
import { PROJECT_STATUS_OPTIONS, isExternalProject, isVideoProject, normalizeProjectStatus, projectAssignedIds, projectMemberIds, projectHasGit, projectSetupGaps, projectStatusLabel } from "../projects/projects-utils";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import type { AdminPageScope, AdminSection, BoardSummary, DiagnosticsPayload, IssuedTemporaryPassword, Project, ProjectKind, ProjectStatus, ProjectTypePreset, SecurityDiagnostics, Settings, StudioDepartmentDefinition, StudioRoleDefinition, User, UserActivitySummary, WhiteboardSummary } from "../application/application-models";
import "./admin-workspace.css";
import { ADAPTIVE_MEDIA } from "../../core/adaptive-layout";
import { ADMIN_PAGE_DEPENDENCIES } from "../application/modules/application-admin-workspaces";

type ProjectIntakeTemplate = { key: string; label: string; type: string; boardName: string; description: string; whiteboardBrief: string; libraryBrief: string };
const ADMIN_USER_RENDER_BATCH = 160;

type PasswordResetRequest = { id: string; status: "pending" | "fulfilled" | "dismissed"; createdAt: string; user: { id: string; username: string; displayName?: string | null; email?: string | null; phoneNumber?: string | null; avatarUrl?: string | null } };
export type AdminPageDependencies = {
  PersistenceBridgePanel: React.ComponentType<any>;
  WorkLinkManager: React.ComponentType<any>;
  DataModelStandardsPanel: React.ComponentType<any>;
  AdminMaintenanceToolsPanel: React.ComponentType<any>;
  PermissionMatrixControls: React.ComponentType<any>;
  TemplateStudioPanel: React.ComponentType<any>;
  toDateInputValue: (value?: string | null) => string;
  USER_DEPARTMENT_PRESETS: string[];
  USER_TEAM_PRESETS: string[];
  enabledStudioDepartmentsFromSettings: (settings?: Settings | null) => StudioDepartmentDefinition[];
  enabledStudioRolesFromSettings: (settings?: Settings | null) => StudioRoleDefinition[];
  rolePermissionsFromSettings: (settings?: Settings | null, roleId?: string | null) => ToolPermissions | null;
  projectTypePresetsFromSettings: (settings?: Settings | null) => ProjectTypePreset[];
  PROJECT_INTAKE_TEMPLATES: ProjectIntakeTemplate[];
  projectTypeBadge: (project: Project) => string;
  readFileAsDataUrl: (file: File) => Promise<string>;
  UserEditorForm: React.ComponentType<any>;
  StabilizationCenterPanel: React.ComponentType<any>;
  ImportToolsPanel: React.ComponentType<any>;
  TOOL_INFRASTRUCTURE_CATALOG: any;
  AdminReportsPanel: React.ComponentType<any>;
  getProjectPermission: any;
  projectPermissionReason: any;
};
export type AdminPageProps = { projects: Project[]; whiteboards: WhiteboardSummary[]; currentUser: User; onReloadProjects: () => Promise<void>; onReloadWhiteboards: () => Promise<void>; previewUser: User | null; onStartPreview: (user: User) => void; onStopPreview: () => void; onOpenBoard: (boardId: string) => void; onOpenWhiteboard: (whiteboardId: string) => void; settings?: Settings; scope?: AdminPageScope; initialSection?: AdminSection; onOpenUserAdmin?: () => void; onOpenProjects?: () => void; onOpenProject?: (projectId: string) => void; onOpenToolInfrastructure?: () => void; onOpenServerConfig?: () => void; onOpenStudioSettings?: () => void; onOpenTickets?: () => void; onOpenQa?: () => void; onOpenTime?: () => void; };

export function AdminPage({ projects, whiteboards, currentUser, onReloadProjects, onReloadWhiteboards, previewUser, onStartPreview, onStopPreview, onOpenBoard, onOpenWhiteboard, settings, scope = "operations", initialSection, onOpenUserAdmin, onOpenProjects, onOpenProject, onOpenToolInfrastructure, onOpenServerConfig, onOpenStudioSettings, onOpenTickets, onOpenQa, onOpenTime }: AdminPageProps) {
  const { PersistenceBridgePanel, WorkLinkManager, DataModelStandardsPanel, AdminMaintenanceToolsPanel, PermissionMatrixControls, TemplateStudioPanel, toDateInputValue, USER_DEPARTMENT_PRESETS, USER_TEAM_PRESETS, enabledStudioDepartmentsFromSettings, enabledStudioRolesFromSettings, rolePermissionsFromSettings, projectTypePresetsFromSettings, PROJECT_INTAKE_TEMPLATES, projectTypeBadge, readFileAsDataUrl, UserEditorForm, StabilizationCenterPanel, ImportToolsPanel, TOOL_INFRASTRUCTURE_CATALOG, AdminReportsPanel, getProjectPermission, projectPermissionReason } = ADMIN_PAGE_DEPENDENCIES;
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectType, setProjectType] = useState<ProjectKind>(() => (settings?.defaultProjectTypeId || projectTypePresetsFromSettings(settings)[0]?.id || "general") as ProjectKind);
  const [newProjectStatus, setNewProjectStatus] = useState<ProjectStatus>("active");
  const [projectExternal, setProjectExternal] = useState(false);
  const [projectLeadIds, setProjectLeadIds] = useState<string[]>([]);
  const [createDefaultBoard, setCreateDefaultBoard] = useState(true);
  const [projectBoardName, setProjectBoardName] = useState("Main Board");
  const [createProjectWhiteboard, setCreateProjectWhiteboard] = useState(true);
  const [projectWhiteboardName, setProjectWhiteboardName] = useState("");
  const [projectWhiteboardDescription, setProjectWhiteboardDescription] = useState("");
  const [openCreatedWhiteboard, setOpenCreatedWhiteboard] = useState(false);
  const [createProjectLibraryFolder, setCreateProjectLibraryFolder] = useState(true);
  const [projectLibraryFolderName, setProjectLibraryFolderName] = useState("");
  const [projectLibraryFolderDescription, setProjectLibraryFolderDescription] = useState("");
  const [projectLibraryFolderUrl, setProjectLibraryFolderUrl] = useState("");
  const [projectEdits, setProjectEdits] = useState<Record<string, { name: string; description: string }>>({});
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});
  const [projectArchiveDrafts, setProjectArchiveDrafts] = useState<Record<string, boolean>>({});
  const [projectExternalDrafts, setProjectExternalDrafts] = useState<Record<string, boolean>>({});
  const [boardNames, setBoardNames] = useState<Record<string, string>>({});
  const [boardDescriptions, setBoardDescriptions] = useState<Record<string, string>>({});
  const [newBoardNames, setNewBoardNames] = useState<Record<string, string>>({});
  const [whiteboardName, setWhiteboardName] = useState("");
  const [whiteboardDescription, setWhiteboardDescription] = useState("");
  const [whiteboardProjectId, setWhiteboardProjectId] = useState("");
  const [whiteboardEdits, setWhiteboardEdits] = useState<Record<string, { name: string; description: string; projectId: string }>>({});
  const [status, setStatus] = useState("");
  const [jobsEvidenceOpen, setJobsEvidenceOpen] = useState(false);
  const [adminSection, setAdminSection] = useState<AdminSection>(() => {
    const stored = scope === "users" ? (window.sessionStorage.getItem("cluster-user-admin-section") as AdminSection | null) : null;
    if (scope === "users") window.sessionStorage.removeItem("cluster-user-admin-section");
    return coerceAdminWorkspaceSection(scope, initialSection || stored);
  });
  useEffect(() => {
    setAdminSection((current) => coerceAdminWorkspaceSection(scope, initialSection || current));
  }, [scope, initialSection]);
  const [adminPendingApprovals, setAdminPendingApprovals] = useState(0);
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const adminUsersStateRef = useRef<UserActivitySummary[]>([]);
  const adminUsersRequestSequence = useRef(0);
  const adminDiagnosticsRequestSequence = useRef(0);
  const [operationsDiagnostics, setOperationsDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [operationsSecurity, setOperationsSecurity] = useState<SecurityDiagnostics | null>(null);
  const [operationsDiagnosticsStatus, setOperationsDiagnosticsStatus] = useState("Checking runtime...");
  const [reportsActivityOpen, setReportsActivityOpen] = useState(false);
  const adminStudioDepartments = enabledStudioDepartmentsFromSettings(settings);
  const adminStudioRoles = enabledStudioRolesFromSettings(settings);
  const adminProjectTypePresets = useMemo(() => projectTypePresetsFromSettings(settings), [settings?.projectTypePresets]);
  useEffect(() => {
    if (!adminProjectTypePresets.some((preset) => preset.id === projectType)) {
      setProjectType((adminProjectTypePresets[0]?.id || "general") as ProjectKind);
    }
  }, [adminProjectTypePresets, projectType]);
  const adminDefaultDepartment = adminStudioDepartments.find((department) => department.id === settings?.studioDefaultDepartmentId) || adminStudioDepartments[0];
  const adminDepartmentOptions = unique([...adminStudioDepartments.map((department) => department.label), ...USER_DEPARTMENT_PRESETS, ...users.map((user) => user.department || "").filter(Boolean)]);
  const adminEmptyUserForm = {
    username: "",
    employeeNumber: "",
    displayName: "",
    legalName: "",
    preferredName: "",
    pronouns: "",
    email: "",
    alternateEmails: "",
    phoneNumber: "",
    alternatePhoneNumber: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    country: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    avatarUrl: "",
    hideLegalName: true,
    hideLocation: false,
    title: "",
    department: adminDefaultDepartment?.label || "",
    managerUserId: "",
    employmentType: "",
    accountType: "employee",
    accessExpiresAt: "",
    workLocation: "",
    timezone: "",
    skills: "",
    capacityHours: adminDefaultDepartment?.capacityTargetHours ? String(adminDefaultDepartment.capacityTargetHours) : "",
    minimumHours: "",
    notes: "",
    startDate: "",
    role: settings?.studioDefaultWorkspaceRole || "member",
  };
  const [adminUserForm, setAdminUserForm] = useState(adminEmptyUserForm);
  const [adminEditingUserId, setAdminEditingUserId] = useState("");
  const [adminUserSaving, setAdminUserSaving] = useState(false);
  const [adminUserQuery, setAdminUserQuery] = useState("");
  const adminUserSearchRef = useRef<HTMLInputElement | null>(null);
  const deferredAdminUserQuery = useDeferredValue(adminUserQuery);
  const [adminUserRenderLimit, setAdminUserRenderLimit] = useState(ADMIN_USER_RENDER_BATCH);
  const [adminShowArchivedUsers, setAdminShowArchivedUsers] = useState(false);
  const [adminUserListMode, setAdminUserListMode] = useState<AdminUserListMode>("all");
  const [passwordResetRequests, setPasswordResetRequests] = useState<PasswordResetRequest[]>([]);
  const [adminUserDepartmentFilter, setAdminUserDepartmentFilter] = useState("all");
  const [adminUserRoleFilter, setAdminUserRoleFilter] = useState("all");
  const [adminUserView, setAdminUserView] = useState<"profile" | "access" | "account">("profile");
  const [adminCredentialForm, setAdminCredentialForm] = useState({ pin: "", password: "" });
  const [adminPasswordVisible, setAdminPasswordVisible] = useState(false);
  const [adminCreatingUser, setAdminCreatingUser] = useState(false);
  const [issuedTemporaryPassword, setIssuedTemporaryPassword] = useState<IssuedTemporaryPassword | null>(null);
  const [permissionUserId, setPermissionUserId] = useState("");
  const [permissionTestTool, setPermissionTestTool] = useState<ToolPermissionKey>("projects");
  const [permissionTestProjectId, setPermissionTestProjectId] = useState("");
  const [toolPermissionDraft, setToolPermissionDraft] = useState<ToolPermissions>({});
  const [projectPermissionDraft, setProjectPermissionDraft] = useState<ProjectPermissions>({});
  const [permissionTemplateMode, setPermissionTemplateMode] = useState<"manual" | "role" | "external">("manual");
  const [projectAssignments, setProjectAssignments] = useState<Record<string, string[]>>({});
  const [boardAssignments, setBoardAssignments] = useState<Record<string, string[]>>({});
  const boardCount = projects.reduce((total, project) => total + project.boards.length, 0);
  const gitProjectCount = projects.filter(projectHasGit).length;
  const videoProjectCount = projects.filter(isVideoProject).length;
  const assignedProjectCount = projects.filter((project) => projectAssignedIds(project).length > 0).length;
  const setupGapCount = projects.reduce((total, project) => total + projectSetupGaps(project).length, 0);
  const canvasCoverageCount = projects.filter((project) => whiteboards.some((whiteboard) => whiteboard.projectId === project.id)).length;
  const adminArchivedProjectCount = projects.filter((project) => project.archived).length;
  const adminOnHoldProjectCount = projects.filter((project) => !project!.archived && ["on_hold", "paused"].includes(normalizeProjectStatus(project.status))).length;
  const adminArchivedUserCount = users.filter((member) => member.archived).length;
  const adminDiscordLinkedCount = users.filter((member) => member.discordUserId).length;
  const adminProfileGapUsers = useMemo(() => users.filter((member) => !member.title || (settings?.studioDepartmentRequired !== false && !member.department) || !member.teamName || (settings?.studioDepartmentCapacityMode !== "off" && !member.capacityHours) || !(member.skills || []).length), [users, settings?.studioDepartmentRequired, settings?.studioDepartmentCapacityMode]);
  const passwordResetUserIds = useMemo(() => new Set(passwordResetRequests.filter((item) => item.status === "pending").map((item) => item.user.id)), [passwordResetRequests]);
  const adminFilteredUsers = useMemo(() => filterAdminUsers({
    users,
    mode: adminUserListMode,
    showArchived: adminShowArchivedUsers,
    passwordResetUserIds,
    departmentFilter: adminUserDepartmentFilter,
    roleFilter: adminUserRoleFilter,
    query: deferredAdminUserQuery,
  }), [users, adminUserListMode, adminShowArchivedUsers, passwordResetUserIds, adminUserDepartmentFilter, adminUserRoleFilter, deferredAdminUserQuery]);
  const adminVisibleUsers = useMemo(() => adminFilteredUsers.slice(0, adminUserRenderLimit), [adminFilteredUsers, adminUserRenderLimit]);
  const adminHasMoreUsers = adminVisibleUsers.length < adminFilteredUsers.length;
  const adminProfileGapUserIds = useMemo(() => new Set(adminProfileGapUsers.map((member) => member.id)), [adminProfileGapUsers]);
  useEffect(() => { setAdminUserRenderLimit(ADMIN_USER_RENDER_BATCH); }, [deferredAdminUserQuery, adminUserListMode, adminShowArchivedUsers, adminUserDepartmentFilter, adminUserRoleFilter]);
  useEffect(() => {
    if (adminSection !== "users") return;
    const focusDirectorySearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      adminUserSearchRef.current?.focus();
    };
    window.addEventListener("keydown", focusDirectorySearch);
    return () => window.removeEventListener("keydown", focusDirectorySearch);
  }, [adminSection]);
  const permissionUser = users.find((member) => member.id === permissionUserId) || users[0] || null;
  const adminSelectedUser = users.find((member) => member.id === adminEditingUserId) || null;
  function studioRoleDefaultsForAdminUser(member?: Pick<User, "workspaceRole" | "isAdmin" | "accountType" | "accessExpiresAt" | "employmentType" | "teamName" | "title"> | null): ToolPermissions {
    const roleDefaults = rolePermissionsFromSettings(settings, member?.workspaceRole || settings?.studioDefaultWorkspaceRole || "member");
    if (roleDefaults) return roleDefaults;
    return defaultToolPermissionsForUser(member);
  }
  const permissionConfiguredCount = users.filter((member) => Object.keys(member.toolPermissions || {}).length || Object.keys(member.projectPermissions || {}).length).length;
  const adminOperationsState = useMemo(() => deriveAdminOperationsState({ users, projects, settings, pendingApprovals: adminPendingApprovals, profileGapUserCount: adminProfileGapUsers.length }), [users, projects, settings, adminPendingApprovals, adminProfileGapUsers.length]);
  const {
    activeProjects: adminActiveProjects,
    projectsWithoutLeads: adminProjectsWithoutLeads,
    projectsWithoutBoards: adminProjectsWithoutBoards,
    externalProjects: adminExternalProjects,
    permissionGapCount: adminPermissionGapCount,
    toolStates: adminToolStates,
    activeUserCount: adminActiveUserCount,
    awayUserCount: adminAwayUserCount,
    offlineUserCount: adminOfflineUserCount,
    projectStatusSummary: adminProjectStatusSummary,
    userStatusSummary: adminUserStatusSummary,
    criticalGapCount: adminCriticalGapCount,
    readinessScore: adminReadinessScore,
    recentUsers: adminRecentUsers,
    disabledToolCount: adminDisabledToolCount,
    suspendedUserCount: adminSuspendedUserCount,
    expiredAccessCount: adminExpiredAccessCount,
    staleUserCount: adminStaleUserCount,
    portfolioRows: adminPortfolioRows,
    atRiskProjectCount: adminAtRiskProjectCount,
    departmentSummary: adminDepartmentSummary,
    onboardingUserCount: adminOnboardingUserCount,
    accessReviewUserCount: adminAccessReviewUserCount,
    roleOptions: adminRoleOptions,
    departmentFilterOptions: adminDepartmentFilterOptions,
  } = adminOperationsState;
  const operationsFolderWarnings = operationsDiagnostics?.folders.filter((folder) => !folder.exists).length || 0;
  const operationsDatabaseTotal = operationsDiagnostics ? Object.values(operationsDiagnostics.counts).reduce((total, value) => total + Number(value || 0), 0) : 0;
  function openAdminUser(userId?: string) {
    if (userId) window.sessionStorage.setItem("cluster-user-admin-handoff", userId);
    onOpenUserAdmin?.();
  }
  function applyProjectTemplate(templateKey: string) {
    const template = PROJECT_INTAKE_TEMPLATES.find((item) => item.key === templateKey);
    if (!template) return;
    const configuredType = adminProjectTypePresets.some((preset) => preset.id === template.type) ? template.type : adminProjectTypePresets[0]?.id || "general";
    setProjectType(configuredType as ProjectKind);
    setProjectBoardName(template.boardName);
    setProjectDescription((current) => (current.trim() ? current : template.description));
    setCreateDefaultBoard(true);
    setCreateProjectWhiteboard(true);
    setCreateProjectLibraryFolder(true);
    setProjectWhiteboardDescription(template.whiteboardBrief);
    setProjectLibraryFolderDescription(template.libraryBrief);
    setStatus(`${template.label} template applied.`);
  }
  function commitAdminUsers(next: UserActivitySummary[]) {
    adminUsersStateRef.current = next;
    setUsers(next);
    setApiQueryData("/api/users", next, { staleMs: 8_000, maxAgeMs: 20 * 60_000, tags: ["users", "people"] });
    return next;
  }
  function upsertAdminUser(nextUser: UserActivitySummary) {
    const current = adminUsersStateRef.current;
    const nextUsers = current.some((member) => member.id === nextUser.id)
      ? current.map((member) => member.id === nextUser.id ? { ...member, ...nextUser } : member)
      : [nextUser, ...current];
    commitAdminUsers(nextUsers);
    return nextUser;
  }
  async function loadAdminUsers(force = false) {
    const sequence = ++adminUsersRequestSequence.current;
    const result = await queryApi<UserActivitySummary[]>("/api/users", {
      staleMs: 8_000,
      maxAgeMs: 20 * 60_000,
      persist: true,
      tags: ["users", "people"],
      force,
    });
    if (sequence === adminUsersRequestSequence.current) commitAdminUsers(result);
    return result;
  }
  async function loadPasswordResetRequests(force = false) {
    if (scope !== "users") return [] as PasswordResetRequest[];
    const result = await queryApi<{ ok: boolean; items: PasswordResetRequest[] }>("/api/admin/password-reset-requests?status=pending", {
      staleMs: 5_000,
      maxAgeMs: 10 * 60_000,
      tags: ["users", "security"],
      force,
    });
    const items = result.items || [];
    setPasswordResetRequests(items);
    return items;
  }
  async function loadOperationsDiagnostics(force = false) {
    const sequence = ++adminDiagnosticsRequestSequence.current;
    setOperationsDiagnosticsStatus("Checking runtime...");
    try {
      const [diagnostics, security] = await Promise.all([
        queryApi<DiagnosticsPayload>("/api/admin/diagnostics", { staleMs: 5_000, maxAgeMs: 5 * 60_000, tags: ["admin", "diagnostics"], force }),
        queryApi<SecurityDiagnostics>("/api/security/diagnostics", { staleMs: 5_000, maxAgeMs: 5 * 60_000, tags: ["security", "diagnostics"], force }).catch(() => null),
      ]);
      if (sequence !== adminDiagnosticsRequestSequence.current) return;
      setOperationsDiagnostics(diagnostics);
      setOperationsSecurity(security);
      setOperationsDiagnosticsStatus("Runtime checked.");
    } catch (error) {
      if (sequence !== adminDiagnosticsRequestSequence.current) return;
      setOperationsDiagnostics(null);
      setOperationsSecurity(null);
      setOperationsDiagnosticsStatus(error instanceof Error ? error.message : "Runtime check failed.");
    }
  }
  useEffect(() => {
    loadAdminUsers().catch(() => { adminUsersStateRef.current = []; setUsers([]); });
    if (scope === "users") loadPasswordResetRequests().catch(() => setPasswordResetRequests([]));
    api<any>("/api/admin/approvals?status=pending")
      .then((payload) => setAdminPendingApprovals((payload?.requests?.length || 0) + (payload?.avatarAudits?.length || 0)))
      .catch(() => setAdminPendingApprovals(0));
    if (scope === "operations") void loadOperationsDiagnostics();
  }, [scope]);
  useEffect(() => {
    if (!permissionUserId && users[0]) {
      selectPermissionUser(users[0]);
    }
  }, [users, permissionUserId]);
  useEffect(() => {
    if (scope !== "users" || adminCreatingUser || adminEditingUserId || !users[0]) return;
    const handoffId = window.sessionStorage.getItem("cluster-user-admin-handoff");
    if (handoffId) window.sessionStorage.removeItem("cluster-user-admin-handoff");
    if (!handoffId && !window.matchMedia(ADAPTIVE_MEDIA.persistentNavigation).matches) return;
    editAdminUser(users.find((member) => member.id === handoffId) || users[0]);
  }, [scope, users, adminCreatingUser, adminEditingUserId]);
  useEffect(() => {
    const nextProjectEdits: Record<string, { name: string; description: string }> = {};
    const nextBoardNames: Record<string, string> = {};
    const nextBoardDescriptions: Record<string, string> = {};
    const nextProjectAssignments: Record<string, string[]> = {};
    const nextProjectStatuses: Record<string, ProjectStatus> = {};
    const nextProjectArchiveDrafts: Record<string, boolean> = {};
    const nextProjectExternalDrafts: Record<string, boolean> = {};
    const nextBoardAssignments: Record<string, string[]> = {};
    for (const project of projects) {
      nextProjectEdits[project.id] = {
        name: project.name,
        description: project.description || "",
      };
      nextProjectStatuses[project.id] = normalizeProjectStatus(project.status);
      nextProjectArchiveDrafts[project.id] = Boolean(project.archived);
      nextProjectExternalDrafts[project.id] = isExternalProject(project);
      nextProjectAssignments[project.id] = projectMemberIds(project);
      for (const board of project.boards) {
        nextBoardNames[board.id] = board.name;
        nextBoardDescriptions[board.id] = board.description || "";
        nextBoardAssignments[board.id] = board.assignedUserIds || [];
      }
    }
    setProjectEdits(nextProjectEdits);
    setBoardNames(nextBoardNames);
    setBoardDescriptions(nextBoardDescriptions);
    setProjectAssignments(nextProjectAssignments);
    setProjectStatuses(nextProjectStatuses);
    setProjectArchiveDrafts(nextProjectArchiveDrafts);
    setProjectExternalDrafts(nextProjectExternalDrafts);
    setBoardAssignments(nextBoardAssignments);
  }, [projects]);
  useEffect(() => {
    const next: Record<string, { name: string; description: string; projectId: string }> = {};
    for (const whiteboard of whiteboards) {
      next[whiteboard.id] = {
        name: whiteboard.name,
        description: whiteboard.description || "",
        projectId: whiteboard.projectId || "",
      };
    }
    setWhiteboardEdits(next);
  }, [whiteboards]);
  async function run(label: string, fn: () => Promise<void>, reloadWhiteboards = false) {
    setStatus(label);
    try {
      await fn();
      await onReloadProjects();
      if (reloadWhiteboards) await onReloadWhiteboards();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Admin action failed");
    }
  }
  async function createProject() {
    const name = projectName.trim();
    if (!name) {
      setStatus("Project needs a name.");
      return;
    }
    if (!projectLeadIds.length) {
      setStatus("Select at least one project lead.");
      return;
    }
    setStatus("Creating project intake...");
    try {
      const created = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: projectDescription.trim() || null,
          projectType,
          productionTracks: adminProjectTypePresets.find((preset) => preset.id === projectType)?.tracks || [],
          boardColumns: adminProjectTypePresets.find((preset) => preset.id === projectType)?.boardColumns || [],
          status: newProjectStatus,
          external: projectExternal,
          memberIds: projectLeadIds,
          createDefaultBoard,
          boardName: projectBoardName.trim() || "Main Board",
          createWhiteboard: createProjectWhiteboard,
          whiteboardName: projectWhiteboardName.trim() || `${name} Whiteboard`,
          whiteboardDescription: projectWhiteboardDescription.trim() || projectDescription.trim() || null,
          createLibraryFolder: true,
          libraryFolderName: projectLibraryFolderName.trim() || `${name} Library`,
          libraryFolderDescription: projectLibraryFolderDescription.trim() || projectDescription.trim() || null,
          libraryFolderUrl: projectLibraryFolderUrl.trim() || null,
        }),
      });
      setProjectName("");
      setProjectDescription("");
      setProjectType((settings?.defaultProjectTypeId || adminProjectTypePresets[0]?.id || "general") as ProjectKind);
      setNewProjectStatus("active");
      setProjectExternal(false);
      setProjectLeadIds([]);
      setCreateDefaultBoard(true);
      setProjectBoardName("Main Board");
      setCreateProjectWhiteboard(true);
      setProjectWhiteboardName("");
      setProjectWhiteboardDescription("");
      setCreateProjectLibraryFolder(true);
      setProjectLibraryFolderName("");
      setProjectLibraryFolderDescription("");
      setProjectLibraryFolderUrl("");
      await onReloadProjects();
      await onReloadWhiteboards();
      const createdWhiteboard = created.whiteboards?.[0];
      const createdPieces = [projectExternal ? "external tag" : "", createDefaultBoard ? "starter board" : "", createProjectWhiteboard ? "whiteboard" : "", "library folder"].filter(Boolean);
      setStatus(createdPieces.length ? `Project created with ${createdPieces.join(", ")}.` : "Project created.");
      if (openCreatedWhiteboard && createdWhiteboard) {
        onOpenWhiteboard(createdWhiteboard.id);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Project creation failed.");
    }
  }
  async function saveProject(project: Project) {
    const edit = projectEdits[project.id];
    if (!edit?.name.trim()) return;
    await run(
      "Saving project...",
      async () => {
        const patch = {
          name: edit.name.trim(),
          description: edit.description.trim() || null,
          status: projectStatuses[project.id] || "active",
          archived: Boolean(projectArchiveDrafts[project.id]),
          external: Boolean(projectExternalDrafts[project.id]),
          memberIds: projectAssignments[project.id] || [],
        };
        const result = await mutateApi(`/api/projects/${project!.id}`, {
          method: "PATCH",
          body: patch,
          label: `Update ${project.name}`,
          dedupeKey: `project:${project.id}:details`,
          entityType: "project",
          entityId: project.id,
          resourceKind: "project",
          resourceId: project.id,
          baseRevision: project.revision,
          optimisticResult: { ...project, ...patch },
          invalidate: ["/api/projects", "/api/dashboard", "/api/operations"],
        });
        setStatus(result.queued ? "Project changes saved on this device." : "Project saved.");
      },
      true,
    );
  }
  async function archiveProject(project: Project) {
    const restoring = Boolean(project.archived);
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: restoring ? "Restore project" : "Archive project",
          description: "Enter your security PIN.",
          purpose: restoring ? "restore_project" : "archive_project",
          confirmLabel: restoring ? "Restore project" : "Archive project",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: `Create a PIN before you ${restoring ? "restore" : "archive"} a project.`,
          purpose: restoring ? "setup_for_restore_project" : "setup_for_archive_project",
        });
    if (!pin) return;
    await run(
      project.archived ? "Restoring project..." : "Archiving project...",
      async () => {
        await api(`/api/projects/${project!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ archived: !project!.archived, pin }),
        });
        setStatus(project.archived ? "Project restored." : "Project archived. Visibility is now restricted.");
      },
      true,
    );
  }
  async function deleteProject(project: Project) {
    if (!await confirmCluster({ title: "Delete project?", message: `Delete project "${project!.name}"? This removes its boards, cards, and whiteboards.`, confirmLabel: "Delete project", tone: "danger" })) return;
    await run(
      "Deleting project...",
      async () => {
        await api(`/api/projects/${project!.id}`, { method: "DELETE" });
        setStatus("Project deleted.");
      },
      true,
    );
  }
  async function createBoard(project: Project) {
    const name = newBoardNames[project.id]?.trim() || "New Board";
    await run("Creating board...", async () => {
      await api(`/api/projects/${project!.id}/boards`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewBoardNames((prev) => ({ ...prev, [project.id]: "" }));
      setStatus("Board created.");
    });
  }
  async function saveBoard(board: BoardSummary) {
    const name = boardNames[board.id]?.trim();
    if (!name) return;
    await run("Saving board...", async () => {
      await api(`/api/boards/${board.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: boardDescriptions[board.id]?.trim() || null,
        }),
      });
      setStatus("Board saved.");
    });
  }
  async function deleteBoard(board: BoardSummary) {
    if (!await confirmCluster({ title: "Delete board?", message: `Delete board "${board.name}"? Cards in this board will also be deleted.`, confirmLabel: "Delete board", tone: "danger" })) return;
    await run("Deleting board...", async () => {
      await api(`/api/boards/${board.id}`, { method: "DELETE" });
      setStatus("Board deleted.");
    });
  }
  async function createWhiteboard() {
    if (!whiteboardName.trim()) return;
    await run(
      "Creating whiteboard...",
      async () => {
        await api("/api/whiteboards", {
          method: "POST",
          body: JSON.stringify({
            name: whiteboardName.trim(),
            description: whiteboardDescription.trim() || null,
            projectId: whiteboardProjectId || null,
          }),
        });
        setWhiteboardName("");
        setWhiteboardDescription("");
        setWhiteboardProjectId("");
        setStatus("Whiteboard created.");
      },
      true,
    );
  }
  async function saveWhiteboard(whiteboard: WhiteboardSummary) {
    const edit = whiteboardEdits[whiteboard.id];
    if (!edit?.name.trim()) return;
    await run(
      "Saving whiteboard...",
      async () => {
        await api(`/api/whiteboards/${whiteboard.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: edit.name.trim(),
            description: edit.description.trim() || null,
            projectId: edit.projectId || null,
          }),
        });
        setStatus("Whiteboard saved.");
      },
      true,
    );
  }
  async function deleteWhiteboard(whiteboard: WhiteboardSummary) {
    if (!await confirmCluster({ title: "Delete whiteboard?", message: `Delete whiteboard "${whiteboard.name}"?`, confirmLabel: "Delete whiteboard", tone: "danger" })) return;
    await run(
      "Deleting whiteboard...",
      async () => {
        await api(`/api/whiteboards/${whiteboard.id}`, { method: "DELETE" });
        setStatus("Whiteboard deleted.");
      },
      true,
    );
  }
  function adminFormToPayload(form: typeof adminEmptyUserForm) {
    return {
      username: form.username.trim(),
      employeeNumber: form.employeeNumber.trim() || null,
      displayName: form.displayName.trim() || null,
      legalName: form.legalName.trim() || null,
      preferredName: form.preferredName.trim() || null,
      pronouns: form.pronouns.trim() || null,
      email: form.email.trim() || null,
      alternateEmails: csvToTags(form.alternateEmails),
      phoneNumber: form.phoneNumber.trim() || null,
      alternatePhoneNumber: form.alternatePhoneNumber.trim() || null,
      addressLine1: form.addressLine1.trim() || null,
      addressLine2: form.addressLine2.trim() || null,
      city: form.city.trim() || null,
      stateProvince: form.stateProvince.trim() || null,
      postalCode: form.postalCode.trim() || null,
      country: form.country.trim() || null,
      hideLegalName: Boolean(form.hideLegalName),
      hideLocation: Boolean(form.hideLocation),
      title: form.title.trim() || null,
      department: form.department.trim() || null,
      managerUserId: form.managerUserId || null,
      employmentType: form.employmentType.trim() || null,
      accountType: form.accountType || "employee",
      accessExpiresAt: form.accessExpiresAt ? new Date(`${form.accessExpiresAt}T23:59:59`).toISOString() : null,
      workLocation: form.workLocation.trim() || null,
      timezone: form.timezone.trim() || null,
      skills: form.skills
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      capacityHours: form.capacityHours.trim() ? Number(form.capacityHours) : null,
      minimumHours: form.minimumHours.trim() ? Number(form.minimumHours) : null,
      notes: form.notes.trim() || null,
      startDate: form.startDate || null,
      role: form.role,
    };
  }
  function adminUserToForm(user: UserActivitySummary) {
    return {
      username: user.username || "",
      employeeNumber: user.employeeNumber || "",
      displayName: user.displayName || "",
      legalName: user.legalName || "",
      preferredName: user.preferredName || "",
      pronouns: user.pronouns || "",
      email: user.email || "",
      alternateEmails: (user.alternateEmails || []).join(", "),
      phoneNumber: user.phoneNumber || "",
      alternatePhoneNumber: user.alternatePhoneNumber || "",
      addressLine1: user.addressLine1 || "",
      addressLine2: user.addressLine2 || "",
      city: user.city || "",
      stateProvince: user.stateProvince || "",
      postalCode: user.postalCode || "",
      country: user.country || "",
      emergencyContactName: user.emergencyContactName || "",
      emergencyContactPhone: user.emergencyContactPhone || "",
      emergencyContactRelation: user.emergencyContactRelation || "",
      avatarUrl: user.avatarUrl || "",
      hideLegalName: Boolean(user.hideLegalName),
      hideLocation: Boolean(user.hideLocation),
      title: user.title || "",
      department: user.department || "",
      managerUserId: user.managerUserId || "",
      employmentType: user.employmentType || "",
      accountType: user.accountType || "employee",
      accessExpiresAt: toDateInputValue(user.accessExpiresAt),
      workLocation: user.workLocation || "",
      timezone: user.timezone || "",
      skills: (user.skills || []).join(", "),
      capacityHours: user.capacityHours != null ? String(user.capacityHours) : "",
      minimumHours: user.minimumHours != null ? String(user.minimumHours) : "",
      notes: user.notes || "",
      startDate: toDateInputValue(user.startDate),
      role: user.workspaceRole || "member",
    };
  }
  async function uploadAdminAvatar(userId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !userId) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setStatus("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus("Profile icons must be 5 MB or smaller.");
      return;
    }
    try {
      setStatus(`Uploading ${file.name}...`);
      const dataUrl = await readFileAsDataUrl(file);
      const result = await api<{ user: User }>(`/api/admin/users/${userId}/avatar`, {
        method: "POST",
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl,
        }),
      });
      setAdminUserForm((current) => ({
        ...current,
        avatarUrl: result.user.avatarUrl || "",
      }));
      upsertAdminUser(result.user as UserActivitySummary);
      setStatus("Profile icon updated.");
      window.dispatchEvent(
        new CustomEvent("cluster-avatar-updated", {
          detail: { userId, avatarUrl: result.user.avatarUrl },
        }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile icon upload failed.");
    }
  }
  async function removeAdminAvatar(userId: string) {
    if (!userId || !await confirmCluster({ title: "Remove profile icon?", message: "Remove this user’s current profile icon?", confirmLabel: "Remove icon", tone: "danger" })) return;
    try {
      const result = await api<UserActivitySummary>(`/api/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ avatarUrl: null }),
      });
      setAdminUserForm((current) => ({ ...current, avatarUrl: "" }));
      upsertAdminUser(result);
      window.dispatchEvent(
        new CustomEvent("cluster-avatar-updated", {
          detail: { userId, avatarUrl: null },
        }),
      );
      setStatus("Profile icon removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile icon could not be removed.");
    }
  }
  async function saveAdminUser() {
    if (!adminUserForm.username.trim()) {
      setStatus("A username is required.");
      return;
    }
    if (adminUserSaving) return;
    setAdminUserSaving(true);
    try {
      const payload = adminFormToPayload(adminUserForm);
      let savedUser: UserActivitySummary;
      if (adminEditingUserId) {
        // Account expiry changes are governed through two-person Access Renewals.
        const { accessExpiresAt: ignoredExpiry, ...profileOnly } = payload;
        savedUser = await api<UserActivitySummary>(`/api/users/${adminEditingUserId}`, { method: "PATCH", body: JSON.stringify(profileOnly) });
        setStatus("Profile saved.");
      } else {
        const created = await api<UserActivitySummary & { temporaryPassword: string }>("/api/users", { method: "POST", body: JSON.stringify(payload) });
        savedUser = created;
        setIssuedTemporaryPassword({
          username: created.username,
          temporaryPassword: created.temporaryPassword,
        });
        selectPermissionUser(created);
        setStatus("Account created. Copy the temporary password before leaving this page.");
      }
      upsertAdminUser(savedUser);
      setAdminCreatingUser(false);
      setAdminEditingUserId(savedUser.id);
      setAdminUserForm(adminUserToForm(savedUser));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setAdminUserSaving(false);
    }
  }
  async function issueAdminPasswordReset(user: UserActivitySummary) {
    const result = await api<{
      ok: boolean;
      username: string;
      temporaryPassword: string;
    }>(`/api/admin/users/${user.id}/password-reset`, { method: "POST" });
    setIssuedTemporaryPassword({
      username: result.username,
      temporaryPassword: result.temporaryPassword,
    });
    setStatus(`Password reset issued for ${displayUserName(user)}. Existing sessions were revoked.`);
    await Promise.all([loadAdminUsers(true), loadPasswordResetRequests(true)]);
  }
  async function dismissPasswordResetRequest(requestId: string) {
    await api(`/api/admin/password-reset-requests/${encodeURIComponent(requestId)}/dismiss`, { method: "POST" });
    setStatus("Password reset request dismissed.");
    await loadPasswordResetRequests(true);
  }
  async function setAdminUserPin(user: UserActivitySummary) {
    if (!/^\d{4,8}$/.test(adminCredentialForm.pin)) {
      setStatus("PIN must contain 4–8 digits.");
      return;
    }
    const result = await api<{ ok: boolean; user: UserActivitySummary }>(`/api/admin/users/${user.id}/pin`, {
      method: "PUT",
      body: JSON.stringify({ pin: adminCredentialForm.pin }),
    });
    setAdminCredentialForm((current) => ({ ...current, pin: "" }));
    setStatus("Security PIN updated.");
    upsertAdminUser(result.user);
    setAdminEditingUserId(result.user.id);
  }
  async function resetAdminUserPin(user: UserActivitySummary) {
    if (!await confirmCluster({ title: "Reset security PIN?", message: `Reset the security PIN for ${displayUserName(user)}? The user will need to create a new PIN.`, confirmLabel: "Reset PIN", tone: "danger" })) return;
    const result = await api<{ ok: boolean; user: UserActivitySummary }>(`/api/admin/users/${user.id}/pin`, { method: "DELETE" });
    setStatus("Security PIN reset. The user must create a new PIN.");
    upsertAdminUser(result.user);
  }
  async function setAdminUserPassword(user: UserActivitySummary) {
    if (!adminCredentialForm.password.length) {
      setStatus("Password cannot be empty.");
      return;
    }
    const result = await api<{ ok: boolean; user: UserActivitySummary }>(`/api/admin/users/${user.id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password: adminCredentialForm.password }),
    });
    setAdminCredentialForm((current) => ({ ...current, password: "" }));
    setStatus("Password updated and active sessions revoked.");
    upsertAdminUser(result.user);
  }
  async function clearAdminDiscordLink(user: UserActivitySummary) {
    if (!user.discordUserId || !await confirmCluster({ title: "Clear Discord link?", message: `Clear the Discord link for ${displayUserName(user)}? Their sessions will be revoked. Discord can be linked again later from account settings.`, confirmLabel: "Clear link", tone: "danger" })) return;
    await api(`/api/admin/users/${user.id}/discord-link`, {
      method: "DELETE",
      headers: { "X-Cluster-Confirmation": "CLEAR DISCORD LINK" },
    });
    setStatus(`Discord link cleared for ${displayUserName(user)}.`);
    await loadAdminUsers(true);
  }
  async function setAdminAccountState(user: UserActivitySummary, state: "ACTIVE" | "SUSPENDED" | "DISABLED") {
    const result = await api<{ ok: boolean; user: UserActivitySummary }>(`/api/admin/users/${user.id}/account-state`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
    setStatus(`${displayUserName(user)} account set to ${state.toLowerCase()}.`);
    upsertAdminUser(result.user);
  }
  function editAdminUser(user: UserActivitySummary) {
    setAdminCreatingUser(false);
    setAdminEditingUserId(user.id);
    setAdminUserForm(adminUserToForm(user));
    selectPermissionUser(user);
    setAdminUserView("profile");
    setStatus(`Editing ${displayUserName(user)}.`);
  }
  async function archiveAdminUser(user: UserActivitySummary) {
    const updated = await api<UserActivitySummary>(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: !user.archived }),
    });
    setStatus(user.archived ? "User restored." : "User archived.");
    if (adminEditingUserId === user.id) {
      setAdminEditingUserId("");
      setAdminUserForm(adminEmptyUserForm);
    }
    upsertAdminUser(updated);
  }
  function selectPermissionUser(member: UserActivitySummary) {
    setPermissionUserId(member.id);
    setToolPermissionDraft({
      ...studioRoleDefaultsForAdminUser(member),
      ...(member.toolPermissions || {}),
    });
    setProjectPermissionDraft({ ...(member.projectPermissions || {}) });
  }
  function setToolPermission(tool: ToolPermissionKey, level: ToolPermissionLevel) {
    setToolPermissionDraft((prev) => ({ ...prev, [tool]: level }));
  }
  function setProjectPermission(projectId: string, level: ProjectPermissionLevel) {
    setProjectPermissionDraft((prev) => ({ ...prev, [projectId]: level }));
  }
  function applyRolePermissionTemplate(templateKey: string) {
    const template = ROLE_PERMISSION_TEMPLATES.find((item) => item.key === templateKey);
    if (!template) return;
    setToolPermissionDraft({ ...template.tools });
    setPermissionTemplateMode(templateKey === "external-collaborator" ? "external" : "role");
    setStatus(`${template.label} permission template applied. Save to commit it.`);
  }
  function resetPermissionDraftToDefaults() {
    if (!permissionUser) return;
    setToolPermissionDraft({
      ...studioRoleDefaultsForAdminUser(permissionUser),
    });
    setProjectPermissionDraft({ ...(permissionUser.projectPermissions || {}) });
    setPermissionTemplateMode("role");
    setStatus("Role defaults restored in the draft. Save to commit it.");
  }
  function applyExternalCollaboratorDefaults() {
    setToolPermissionDraft({ ...EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS });
    setProjectPermissionDraft(Object.fromEntries(projects.map((project) => [project.id, isExternalProject(project) ? "view" : "none"])) as ProjectPermissions);
    setPermissionTemplateMode("external");
    setStatus("External collaborator defaults applied. Save to commit it.");
  }
  function copyPermissionsFromUser(sourceUserId: string) {
    const source = users.find((member) => member.id === sourceUserId);
    if (!source) return;
    setToolPermissionDraft({
      ...studioRoleDefaultsForAdminUser(source),
      ...(source.toolPermissions || {}),
    });
    setProjectPermissionDraft({ ...(source.projectPermissions || {}) });
    setPermissionTemplateMode("manual");
    setStatus(`Copied permissions from ${displayUserName(source as User)}. Save to commit it.`);
  }
  async function savePermissions() {
    if (!permissionUser) return;
    const updated = await api<UserActivitySummary>(`/api/users/${permissionUser.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        toolPermissions: toolPermissionDraft,
        projectPermissions: projectPermissionDraft,
      }),
    });
    setStatus("Permissions saved.");
    upsertAdminUser(updated);
  }
  function downloadAdminExport(kind: "workspace" | "projects" | "users" | "permissions") {
    const payload = {
      generatedAt: new Date().toISOString(),
      kind,
      projects:
        kind === "workspace" || kind === "projects"
          ? projects.map((project) => ({
              id: project.id,
              name: project.name,
              status: project.status,
              source: project.source,
              type: project.projectType,
              archived: project.archived,
              leads: projectMemberIds(project),
              boards: project.boards.length,
              whiteboards: project.whiteboards?.length || 0,
              libraryItems: project.libraryItems?.length || 0,
            }))
          : undefined,
      users:
        kind === "workspace" || kind === "users"
          ? users.map((member) => ({
              id: member.id,
              username: member.username,
              displayName: member.displayName,
              role: member.workspaceRole,
              title: member.title,
              department: member.department,
              teamName: member.teamName,
              timezone: member.timezone,
              capacityHours: member.capacityHours,
              status: member.status,
              archived: member.archived,
            }))
          : undefined,
      permissions:
        kind === "workspace" || kind === "permissions"
          ? users.map((member) => ({
              id: member.id,
              name: displayUserName(member),
              role: member.workspaceRole,
              isAdmin: member.isAdmin,
              toolPermissions: member.toolPermissions || {},
              projectPermissions: member.projectPermissions || {},
            }))
          : undefined,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cluster-${kind}-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`${levelLabel(kind)} export downloaded.`);
  }
  return (
    <SectionedWorkspaceShell
      className={`admin-workspace-v298 admin-page admin-page-v064 ${scope === "users" ? "user-admin-page-v241" : "operations-admin-page-v241"}`}
      title={scope === "users" ? "People Management" : "Operations"}
      icon={scope === "users" ? "users" : "operations"}
      description={scope === "users" ? "Accounts, access, and lifecycle." : "Server health, incidents, approvals, and maintenance."}
      metrics={scope === "users" ? [
        { label: "People", value: users.length },
        { label: "Pending approvals", value: adminPendingApprovals, tone: adminPendingApprovals ? "warning" : "good" },
        { label: "Mode", value: "Directory" },
      ] : [
        { label: "Readiness", value: `${adminReadinessScore}%`, tone: adminCriticalGapCount ? "warning" : "good" },
        { label: "Critical gaps", value: adminCriticalGapCount, tone: adminCriticalGapCount ? "danger" : "good" },
        { label: "Pending approvals", value: adminPendingApprovals, tone: adminPendingApprovals ? "warning" : "good" },
      ]}
      actions={
        <div className="button-row compact">
          {scope === "operations" && onOpenStudioSettings ? <ClusterButton variant="quiet" onClick={onOpenStudioSettings}><ClusterIcon name="settings" /> Studio settings</ClusterButton> : null}
          {scope === "operations" && onOpenServerConfig ? <ClusterButton variant="quiet" onClick={onOpenServerConfig}><ClusterIcon name="cloud" /> Server configuration</ClusterButton> : null}
          <ClusterButton
            variant="secondary"
            onClick={() => {
              void onReloadProjects();
              void onReloadWhiteboards();
              void loadAdminUsers(true);
              if (scope === "operations") void loadOperationsDiagnostics(true);
            }}
          >
            <ClusterIcon name="refresh" /> Refresh
          </ClusterButton>
        </div>
      }
      status={status}
      navLabel={scope === "users" ? "People management sections" : "Operations sections"}
      navClassName="admin-subnav-v204"
      activeId={scope === "users" ? adminSection : canonicalAdminOperationsSection(adminSection)}
      onChange={setAdminSection}
      primaryIds={(scope === "users" ? ["users", "exports"] : ["overview", "incidents", "jobs", "approvals", "systems", "reports"]) as AdminSection[]}
      items={buildAdminWorkspaceNav(scope, { userCount: users.length, pendingApprovals: adminPendingApprovals })}
    >
      {scope === "operations" && (["approvals", "systems", "reports"] as const).includes(canonicalAdminOperationsSection(adminSection) as "approvals" | "systems" | "reports") && (
        <nav className="admin-context-rail-v5123" aria-label="Operations specialist sections">
          {ADMIN_OPERATIONS_CONTEXT[canonicalAdminOperationsSection(adminSection) as keyof typeof ADMIN_OPERATIONS_CONTEXT].map((destination) => (
            <ClusterButton key={destination.id} type="button" size="compact" variant={adminSection === destination.id ? "secondary" : "quiet"} aria-pressed={adminSection === destination.id} onClick={() => setAdminSection(destination.id)}>{destination.label}</ClusterButton>
          ))}
        </nav>
      )}

      {adminSection === "approvals" && <AdminApprovalCenter projects={projects} />}

      {canonicalAdminOperationsSection(adminSection) === "jobs" && <>
        <OperationsCenterPanel />
        <section className="panel admin-jobs-evidence-v11">
          <div className="button-row">
            <ClusterButton type="button" variant="secondary" aria-expanded={jobsEvidenceOpen}
              onClick={() => setJobsEvidenceOpen((current) => !current)}>
              {jobsEvidenceOpen ? "Hide event history" : "Inspect operational event history"}
            </ClusterButton>
            <span className="muted">Sanitized logs, request traces, and security-linked activity. Loaded on request.</span>
          </div>
          {jobsEvidenceOpen ? <OperationsEvidencePanel /> : null}
        </section>
      </>}

      {adminSection === "incidents" && <OperationsIncidentsPanel />}

      {(adminSection === "systems" || canonicalAdminOperationsSection(adminSection) === "systems") && (
        <div className="admin-consolidated-stack-v15">
          <HealthStrip
            density="compact"
            label="Systems health"
            items={[
              { id: "server", label: "Server", value: operationsDiagnostics?.ok ? "Online" : "Check", detail: operationsDiagnostics?.version ? `v${operationsDiagnostics.version}` : "runtime", tone: operationsDiagnostics?.ok ? "success" : "warning" },
              { id: "security", label: "Security", value: operationsSecurity?.authRequired ? "Protected" : "Review", detail: "authentication", tone: operationsSecurity?.authRequired ? "success" : "danger" },
              { id: "storage", label: "Storage", value: operationsFolderWarnings || 0, detail: operationsFolderWarnings ? "path issues" : "issues", tone: operationsFolderWarnings ? "danger" : "success" },
              { id: "records", label: "Records", value: Number(operationsDatabaseTotal || 0), detail: "database", tone: "info" },
            ]}
          />
          <OperationsSystemsPanel />
          <section className="panel admin-jobs-entry-v11" aria-label="Background job diagnostics">
            <strong>Background jobs and worker history</strong>
            <p>Queue status, retries, scheduled task activity, and detailed job evidence now live in Jobs. This keeps System health focused on runtime diagnostics.</p>
            <ClusterButton type="button" variant="secondary" onClick={() => setAdminSection("jobs")}>Open Jobs</ClusterButton>
          </section>
          <ClusterDisclosureGroup key={`maintenance-${adminSection}`} defaultOpen={adminSection === "maintenance"} className="admin-consolidated-details-v15" title="Maintenance tools" summary="Integrity, cleanup, repair, and one-off administrative jobs.">
            <AdminMaintenanceToolsPanel projects={projects} users={users} onOpenOperationsCenter={() => setAdminSection("systems")} />
          </ClusterDisclosureGroup>
          <ClusterDisclosureGroup key={`persistence-${adminSection}`} defaultOpen={adminSection === "persistence" || adminSection === "stabilization"} className="admin-consolidated-details-v15" title="Persistence & recovery" summary="Storage persistence, recovery readiness, stabilization, and repair evidence.">
            <PersistenceBridgePanel />
            <StabilizationCenterPanel projects={projects} users={users} onReloadProjects={onReloadProjects} />
          </ClusterDisclosureGroup>
        </div>
      )}

      {adminSection === "security-center" && (
        <div className="admin-consolidated-stack-v15">
          <HealthStrip
            density="compact"
            label="Governance health"
            items={[
              { id: "approvals", label: "Approvals", value: adminPendingApprovals, detail: adminPendingApprovals ? "waiting" : "clear", tone: adminPendingApprovals ? "warning" : "success" },
              { id: "access", label: "Access reviews", value: adminAccessReviewUserCount, detail: "accounts", tone: adminAccessReviewUserCount ? "warning" : "success" },
              { id: "suspended", label: "Suspended", value: adminSuspendedUserCount, detail: "accounts", tone: adminSuspendedUserCount ? "info" : "success" },
              { id: "expired", label: "Expired access", value: adminExpiredAccessCount, detail: "accounts", tone: adminExpiredAccessCount ? "danger" : "success" },
            ]}
          />
          <AdminApprovalCenter projects={projects} />
          <SecurityCenterPanel onOpenServerConfig={onOpenServerConfig} />
        </div>
      )}

      {(adminSection === "reports" || canonicalAdminOperationsSection(adminSection) === "reports") && (
        <div className="admin-reports-stack-v470">
          <AdminReportsPanel projects={projects} users={users} onOpenProject={onOpenProject} />
          <StudioKnowledgeOperationsPanel />
          <AdminAuditStreamPanel projects={projects} users={users} />
              <ClusterDisclosureGroup key={`imports-${adminSection}`} defaultOpen={adminSection === "imports"} className="admin-consolidated-details-v15" title="Import & migration tools" summary="Import structured data and inspect migration readiness.">
                <ImportToolsPanel projects={projects} users={users} onReloadProjects={onReloadProjects} />
              </ClusterDisclosureGroup>
              <ClusterDisclosureGroup key={`data-model-${adminSection}`} defaultOpen={adminSection === "data-model"} className="admin-consolidated-details-v15" title="Data model & relationships" summary="Review resource relationships and data quality.">
                <DataModelStandardsPanel projects={projects} users={users} whiteboards={whiteboards} />
                <WorkLinkManager projects={projects} />
              </ClusterDisclosureGroup>
              <ClusterDisclosureGroup key={`templates-${adminSection}`} defaultOpen={adminSection === "templates"} className="admin-consolidated-details-v15" title="Templates" summary="Manage reusable studio structures.">
                <TemplateStudioPanel projects={projects} users={users} />
              </ClusterDisclosureGroup>
              <ClusterDisclosureGroup key={`changelog-${adminSection}`} defaultOpen={adminSection === "changelog"} className="admin-consolidated-details-v15" title="Changelog" summary="Review shipped changes and rollout history.">
                <ChangelogPage />
              </ClusterDisclosureGroup>

          <section className="management-panel admin-resource-panel admin-activity-report-v470">
            <header className="admin-report-drilldown-head-v470">
              <div>
                <h2>Activity & audit</h2>
                <span>Inspect workspace activity, system events, and risk-oriented audit signals when you need them.</span>
              </div>
              <ClusterButton variant="secondary" onClick={() => setReportsActivityOpen((open) => !open)}>
                {reportsActivityOpen ? "Close activity" : "Open activity"}
              </ClusterButton>
            </header>
            {reportsActivityOpen ? (
              <ActivityPage
                projects={projects}
                onOpenProject={(projectId) => onOpenProject?.(projectId)}
                onOpenTickets={() => onOpenTickets?.()}
                onOpenQa={() => onOpenQa?.()}
                onOpenTime={() => onOpenTime?.()}
                projectTypeLabel={projectTypeBadge}
                projectStatusLabel={projectStatusLabel}
                adminMode
                initialView="audit"
              />
            ) : null}
          </section>
        </div>
      )}

      {adminSection === "overview" && (
        <div className="operations-overview">
          <HealthStrip
            density="compact"
            label="Studio operations health"
            items={[
              { id: "readiness", label: "Readiness", value: `${adminReadinessScore}%`, detail: `${adminCriticalGapCount} open signals`, tone: adminCriticalGapCount ? "warning" : "success" },
              { id: "projects", label: "Portfolio", value: adminActiveProjects.length, detail: `${adminAtRiskProjectCount} at risk`, tone: adminAtRiskProjectCount ? "warning" : "success" },
              { id: "people", label: "People", value: adminActiveUserCount, detail: `${adminAwayUserCount} away`, tone: "info" },
              { id: "tools", label: "Tools", value: `${TOOL_INFRASTRUCTURE_CATALOG.length - adminDisabledToolCount}/${TOOL_INFRASTRUCTURE_CATALOG.length}`, detail: "enabled", tone: adminDisabledToolCount ? "warning" : "success" },
            ]}
          />
          <section className="operations-summary-grid" aria-label="Operations summary">
            <ClusterButton type="button" className={adminCriticalGapCount ? "attention" : "good"} onClick={() => document.querySelector(".operations-action-queue")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <span>Readiness</span>
              <strong>{adminReadinessScore}%</strong>
              <b>{adminCriticalGapCount}</b>
            </ClusterButton>
            <ClusterButton type="button" className={adminAtRiskProjectCount ? "attention" : "good"} onClick={() => onOpenProjects?.()}>
              <span>Projects</span>
              <strong>{adminActiveProjects.length}</strong>
              <b>{adminAtRiskProjectCount} risk</b>
            </ClusterButton>
            <ClusterButton type="button" onClick={() => document.querySelector(".operations-live-v249")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <span>People</span>
              <strong>{adminActiveUserCount}</strong>
              <b>{adminAwayUserCount} away</b>
            </ClusterButton>
            <ClusterButton type="button" className={adminDisabledToolCount ? "attention" : "good"} onClick={() => onOpenToolInfrastructure?.()}>
              <span>Tools</span>
              <strong>
                {TOOL_INFRASTRUCTURE_CATALOG.length - adminDisabledToolCount}/{TOOL_INFRASTRUCTURE_CATALOG.length}
              </strong>
              <b>enabled</b>
            </ClusterButton>
          </section>

              <section className="panel admin-workspace-hub-v15" aria-label="Administration workspaces">
                <header><div><strong>Administration</strong><small>Quick access to canonical administrative workspaces.</small></div></header>
                <div className="admin-workspace-hub-grid-v15">
                  <ClusterButton type="button" onClick={() => onOpenStudioSettings?.()}><ClusterIcon name="settings" /><span><strong>Studio settings</strong><small>People, project defaults, policy</small></span></ClusterButton>
                  <ClusterButton type="button" onClick={() => onOpenToolInfrastructure?.()}><ClusterIcon name="tools" /><span><strong>Tools</strong><small>Tool health, availability, specialist controls</small></span></ClusterButton>
                  <ClusterButton type="button" onClick={() => onOpenServerConfig?.()}><ClusterIcon name="cloud" /><span><strong>Server</strong><small>Security, data, runtime</small></span></ClusterButton>
                  <ClusterButton type="button" onClick={() => setAdminSection("approvals")}><ClusterIcon name="lock" /><span><strong>Governance</strong><small>Approvals, policies, permissions</small></span></ClusterButton>
                  <ClusterButton type="button" onClick={() => setAdminSection("reports")}><ClusterIcon name="activity" /><span><strong>Data & Audit</strong><small>Reports, activity, templates</small></span></ClusterButton>
                </div>
              </section>
          <AdminSetupChecklist
            onOpenStudioSettings={onOpenStudioSettings}
            onOpenServerConfig={onOpenServerConfig}
            onOpenProjects={onOpenProjects}
            onOpenUserAdmin={onOpenUserAdmin}
          />
          <div className="operations-overview-layout">
            <main className="operations-overview-main">
              <details className="operations-server-details-v528">
                <summary><span><strong>Server details</strong><small>Runtime, queues, fleet sync, media workers, storage, and recovery</small></span><span>Open diagnostics</span></summary>
                <ServerAdminExperiencePanel onOpenServerConfig={onOpenServerConfig} onOpenMaintenance={() => setAdminSection("systems")} onOpenReports={() => setAdminSection("reports")} />
              </details>
              {(adminCriticalGapCount > 0 || adminStaleUserCount > 0) && <section className="panel operations-action-queue">
                <header>
                  <strong>Action queue</strong>
                  <ClusterButton type="button"
                    className=""
                    onClick={() => {
                      void onReloadProjects();
                      void onReloadWhiteboards();
                      void loadAdminUsers(true);
                    }}
                   variant="quiet" size="compact">
                    Refresh
                  </ClusterButton>
                </header>
                <div className="operations-action-grid">
                  {adminPendingApprovals ? <ClusterButton type="button" className="attention" onClick={() => setAdminSection("security-center")}>
                    <span>Approvals</span>
                    <strong>{adminPendingApprovals}</strong>
                  </ClusterButton> : null}
                  {adminProjectsWithoutLeads.length ? <ClusterButton type="button" className="attention" onClick={() => onOpenProjects?.()}>
                    <span>Projects without leads</span>
                    <strong>{adminProjectsWithoutLeads.length}</strong>
                  </ClusterButton> : null}
                  {adminProjectsWithoutBoards.length ? <ClusterButton type="button" className="attention" onClick={() => onOpenProjects?.()}>
                    <span>Projects without boards</span>
                    <strong>{adminProjectsWithoutBoards.length}</strong>
                  </ClusterButton> : null}
                  {adminProfileGapUsers.length ? <ClusterButton type="button" className="attention" onClick={() => openAdminUser()}>
                    <span>Incomplete users</span>
                    <strong>{adminProfileGapUsers.length}</strong>
                  </ClusterButton> : null}
                  {adminPermissionGapCount ? <ClusterButton type="button" className="attention" onClick={() => openAdminUser()}>
                    <span>Access reviews</span>
                    <strong>{adminPermissionGapCount}</strong>
                  </ClusterButton> : null}
                  {adminStaleUserCount ? <ClusterButton type="button" className="attention" onClick={() => document.querySelector(".operations-live-v249")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    <span>Inactive users</span>
                    <strong>{adminStaleUserCount}</strong>
                  </ClusterButton> : null}
                </div>
              </section>}

            </main>

            <aside className="operations-overview-side">
              <section className="panel operations-system-health">
                <header>
                  <strong>System health</strong>
                  <div className="button-row">
                    <span className={`soft-pill ${operationsDiagnostics?.ok && !operationsFolderWarnings ? "good" : "warning"}`}>v{operationsDiagnostics?.version || "..."}</span>
                    <ClusterButton type="button" className="" onClick={() => void loadOperationsDiagnostics(true)} variant="quiet" size="compact">
                      Refresh
                    </ClusterButton>
                  </div>
                </header>
                <div className="operations-health-grid">
                  <span className={operationsDiagnostics?.ok ? "good" : "attention"}>
                    <b>Server</b>
                    <strong>{operationsDiagnostics?.ok ? "Online" : "Check"}</strong>
                  </span>
                  <span className={operationsSecurity?.authRequired ? "good" : "attention"}>
                    <b>Security</b>
                    <strong>{operationsSecurity?.authRequired ? "Protected" : "Review"}</strong>
                  </span>
                  <span className={operationsFolderWarnings ? "attention" : "good"}>
                    <b>Storage</b>
                    <strong>{operationsFolderWarnings ? `${operationsFolderWarnings} issue` : "Ready"}</strong>
                  </span>
                  <span>
                    <b>Records</b>
                    <strong>{operationsDatabaseTotal}</strong>
                  </span>
                </div>
                <div className="operations-health-issues">
                  {(operationsDiagnostics?.folders || [])
                    .filter((folder) => !folder.exists)
                    .map((folder) => (
                      <div key={folder.key}>
                        <span>
                          <strong>{levelLabel(folder.key)}</strong>
                          <em>{folder.path}</em>
                        </span>
                        <b>Missing</b>
                      </div>
                    ))}
                  {operationsDiagnostics && !operationsFolderWarnings && (
                    <div className="good">
                      <span>
                        <strong>Storage paths</strong>
                        <em>All required folders are available.</em>
                      </span>
                      <b>Ready</b>
                    </div>
                  )}
                  {!operationsDiagnostics && <InlineLoadingState label="Loading runtime health" lines={2} />}
                </div>
              </section>

            </aside>
          </div>
        </div>
      )}

      {adminSection === "users" && (
        <section className="panel management-panel admin-resource-panel user-management-console-v244">
          <div className="user-management-head-v244 user-management-head-v470">
            <div>
              <strong>Directory</strong>
              <span>{users.length - adminArchivedUserCount} active accounts</span>
            </div>
            <div className="button-row">
              <ClusterActionMenu iconOnly label="More people management actions" items={[{ id: "refresh", label: "Refresh accounts", icon: "refresh", onSelect: async () => { await loadAdminUsers(true); } }]} />
              <ClusterButton
                variant="primary"
                onClick={() => {
                  setAdminCreatingUser(true);
                  setAdminEditingUserId("");
                  setAdminUserForm(adminEmptyUserForm);
                  setAdminUserView("profile");
                }}
              >
                Add person
              </ClusterButton>
            </div>
          </div>

          <div className="user-admin-mode-rail-v244" aria-label="User account queues">
            <ClusterButton type="button"
              className={adminUserListMode === "all" ? "active" : ""}
              onClick={() => {
                setAdminUserListMode("all");
                setAdminShowArchivedUsers(false);
              }}
            >
              <span>Active</span>
              <strong>{users.length - adminArchivedUserCount}</strong>
            </ClusterButton>
            <ClusterButton type="button"
              className={adminUserListMode === "resets" ? "active attention" : passwordResetRequests.length ? "attention" : ""}
              onClick={() => {
                setAdminUserListMode("resets");
                setAdminShowArchivedUsers(false);
              }}
            >
              <span>Reset requests</span>
              <strong>{passwordResetRequests.length}</strong>
            </ClusterButton>
            <ClusterButton type="button"
              className={adminUserListMode === "onboarding" ? "active attention" : adminOnboardingUserCount ? "attention" : ""}
              onClick={() => {
                setAdminUserListMode("onboarding");
                setAdminShowArchivedUsers(false);
              }}
            >
              <span>Onboarding</span>
              <strong>{adminOnboardingUserCount}</strong>
            </ClusterButton>
            <ClusterButton type="button"
              className={adminUserListMode === "access" ? "active attention" : adminAccessReviewUserCount ? "attention" : ""}
              onClick={() => {
                setAdminUserListMode("access");
                setAdminShowArchivedUsers(false);
              }}
            >
              <span>Access review</span>
              <strong>{adminAccessReviewUserCount}</strong>
            </ClusterButton>
            <ClusterButton type="button"
              className={adminUserListMode === "suspended" ? "active" : ""}
              onClick={() => {
                setAdminUserListMode("suspended");
                setAdminShowArchivedUsers(false);
              }}
            >
              <span>Suspended</span>
              <strong>{adminSuspendedUserCount}</strong>
            </ClusterButton>
            <ClusterButton type="button"
              className={adminUserListMode === "archived" ? "active" : ""}
              onClick={() => {
                setAdminUserListMode("archived");
                setAdminShowArchivedUsers(true);
              }}
            >
              <span>Archived</span>
              <strong>{adminArchivedUserCount}</strong>
            </ClusterButton>
          </div>

          <div className="user-admin-toolbar-v244">
            <label className="field search-field">
              <span>Search</span>
              <ClusterTextInput
                ref={adminUserSearchRef}
                value={adminUserQuery}
                onChange={(event) => setAdminUserQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { setAdminUserQuery(""); event.currentTarget.blur(); return; }
                  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !adminVisibleUsers.length) return;
                  event.preventDefault();
                  const currentIndex = Math.max(0, adminVisibleUsers.findIndex((member) => member.id === adminEditingUserId));
                  const nextIndex = event.key === "ArrowDown" ? Math.min(adminVisibleUsers.length - 1, currentIndex + 1) : event.key === "ArrowUp" ? Math.max(0, currentIndex - 1) : currentIndex;
                  editAdminUser(adminVisibleUsers[nextIndex]);
                }}
                placeholder="Name, username, email, role, team"
                aria-label="Search user directory"
              />
            </label>
            <label className="field">
              <span>Department</span>
              <ClusterSelect
                ariaLabel="Filter users by department"
                value={adminUserDepartmentFilter}
                onChange={setAdminUserDepartmentFilter}
                options={[{ value: "all", label: "All departments" }, ...adminDepartmentFilterOptions.map((department) => ({ value: department, label: department }))]}
              />
            </label>
            <label className="field">
              <span>Role</span>
              <ClusterSelect
                ariaLabel="Filter users by role"
                value={adminUserRoleFilter}
                onChange={setAdminUserRoleFilter}
                options={[{ value: "all", label: "All roles" }, ...adminRoleOptions.map((role) => ({ value: role, label: levelLabel(role) }))]}
              />
            </label>
            <span>{adminFilteredUsers.length} shown</span>
          </div>

          <div className={`user-admin-layout-v244${adminSelectedUser || adminCreatingUser ? " detail-open-v456" : ""}`}>
            <aside className="user-admin-directory-v244" aria-label="User accounts">
              <div className="user-admin-directory-head-v244">
                <span>Person</span>
                <span>Account</span>
              </div>
              <div className="user-admin-directory-scroll-v244">
                {adminFilteredUsers.length ? (
                  adminVisibleUsers.map((member) => {
                    const profileGap = adminProfileGapUserIds.has(member.id);
                    const accessReview = adminUserNeedsAccessReview(member);
                    return (
                      <article className={`${adminEditingUserId === member.id ? "active" : ""} ${member.archived ? "archived" : ""}`} key={member.id}>
                        <ClusterButton type="button" className="user-admin-person-v244" onClick={() => editAdminUser(member)}>
                          <PresenceAvatar userId={member.id} imageUrl={member.avatarUrl} label={displayUserName(member)} fallback={userInitial(member)} state={presenceState(member)} title={presenceLabel(member)} className="admin-user-presence-v227" />
                          <span>
                            <strong>{displayUserName(member)}</strong>
                            <em>{member.title || "No title"}</em>
                            <small>
                              {member.department || "No department"} · {member.teamName || "No team"}
                            </small>
                          </span>
                        </ClusterButton>
                        <span className="user-admin-account-v244">
                          <strong>{levelLabel(member.accountState || "PASSWORD_CHANGE_REQUIRED")}</strong>
                          <em>
                            {member.workspaceRole || "member"}
                            {member.isAdmin ? " · admin" : ""}
                          </em>
                          <small>{profileGap ? "Profile incomplete" : accessReview ? "Access review" : "Ready"}</small>
                        </span>
                      </article>
                    );
                  })
                ) : (
                  <ClusterEmptyState compact kind="filtered" title="No accounts match" description="Adjust the account search or filters to show more people." />
                )}
                {adminHasMoreUsers ? <div className="user-admin-load-more-v494"><ClusterButton variant="quiet" size="compact" onClick={() => setAdminUserRenderLimit((current) => current + ADMIN_USER_RENDER_BATCH)}>Show {Math.min(ADMIN_USER_RENDER_BATCH, adminFilteredUsers.length - adminVisibleUsers.length)} more · {adminFilteredUsers.length - adminVisibleUsers.length} remaining</ClusterButton></div> : null}
              </div>
            </aside>

            <main className="user-admin-detail-v244">
              {adminSelectedUser ? (
                <>
                  <header className="user-admin-subject-v244">
                    <ClusterButton type="button" className="user-admin-mobile-close-v456" variant="quiet" onClick={() => { setAdminCreatingUser(false); setAdminEditingUserId(""); }}><ClusterIcon name="chevron-left" /> Directory</ClusterButton>
                    <PresenceAvatar userId={adminSelectedUser.id} imageUrl={adminUserForm.avatarUrl || adminSelectedUser.avatarUrl} label={displayUserName(adminSelectedUser)} fallback={userInitial(adminSelectedUser)} state={presenceState(adminSelectedUser)} title={presenceLabel(adminSelectedUser)} className="admin-avatar-preview-v229" />
                    <div>
                      <h3>{displayUserName(adminSelectedUser)}</h3>
                      <span>
                        @{adminSelectedUser.username} · {adminSelectedUser.title || "No title"}
                      </span>
                      <small>
                        {adminSelectedUser.department || "No department"} · {adminSelectedUser.teamName || "No team"} · {adminSelectedUser.email || "No email"}
                      </small>
                    </div>
                    <div className="user-admin-subject-state-v244">
                      <strong>{levelLabel(adminSelectedUser.accountState || "PASSWORD_CHANGE_REQUIRED")}</strong>
                      <span>{adminSelectedUser.archived ? "Archived" : presenceLabel(adminSelectedUser)}</span>
                    </div>
                  </header>

                  <nav className="user-admin-tabs-v244" aria-label="Selected person management">
                    <ClusterButton type="button" className={adminUserView === "profile" ? "active" : ""} onClick={() => setAdminUserView("profile")}>
                      Profile
                    </ClusterButton>
                    <ClusterButton type="button" className={adminUserView === "access" ? "active" : ""} onClick={() => setAdminUserView("access")}>
                      Permissions
                    </ClusterButton>
                    <ClusterButton type="button" className={adminUserView === "account" ? "active" : ""} onClick={() => setAdminUserView("account")}>
                      Account
                    </ClusterButton>
                  </nav>

                  {issuedTemporaryPassword && (
                    <section className="issued-temporary-password" aria-label="Issued temporary password">
                      <div>
                        <h4>{issuedTemporaryPassword.username}</h4>
                        <span>Temporary password · user must change it at next sign-in</span>
                      </div>
                      <code>{issuedTemporaryPassword.temporaryPassword}</code>
                      <div className="button-row">
                        <ClusterCopyButton text={`Cluster username: ${issuedTemporaryPassword.username}\nTemporary password: ${issuedTemporaryPassword.temporaryPassword}\nChange required at next sign-in.`} copiedLabel="Credentials copied">
                          Copy
                        </ClusterCopyButton>
                        <ClusterButton type="button" variant="quiet" onClick={() => setIssuedTemporaryPassword(null)}>
                          Dismiss
                        </ClusterButton>
                      </div>
                    </section>
                  )}

                  {adminUserView === "profile" && (
                    <div className="user-admin-detail-scroll-v244">
                      <section className="admin-avatar-editor-v251">
                        <PresenceAvatar userId={adminSelectedUser.id} imageUrl={adminUserForm.avatarUrl} label={adminUserForm.displayName || adminUserForm.username || "User"} fallback={(adminUserForm.displayName || adminUserForm.username || "U").slice(0, 1).toUpperCase()} state={adminSelectedUser.status || "offline"} title="Profile icon preview" className="admin-avatar-preview-v251" />
                        <div>
                          <strong>Profile image</strong>
                          <span>PNG, JPEG, WebP, or GIF · 5 MB maximum</span>
                        </div>
                        <div className="button-row compact">
                          <ClusterFileButton label="Upload profile image" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => uploadAdminAvatar(adminSelectedUser.id, event)}>Upload</ClusterFileButton>
                          {adminUserForm.avatarUrl && (
                            <ClusterButton type="button" variant="quiet" onClick={() => void removeAdminAvatar(adminSelectedUser.id)}>
                              Remove
                            </ClusterButton>
                          )}
                        </div>
                      </section>
                      <UserEditorForm form={adminUserForm} setForm={setAdminUserForm} settings={settings} departmentOptions={adminDepartmentOptions} users={users} editingUserId={adminEditingUserId} />
                      <div className="user-admin-sticky-actions-v244">
                        <ClusterButton type="button" className="" onClick={saveAdminUser} disabled={adminUserSaving} variant="primary">
                          {adminUserSaving ? "Saving…" : "Save profile"}
                        </ClusterButton>
                      </div>
                    </div>
                  )}

                  {adminUserView === "access" && (
                    <div className="user-admin-detail-scroll-v244 user-access-editor-v242">
                      {permissionUser ? (
                        <>
                          {permissionUser.isAdmin && (
                            <div className="hint-box slim">
                              <strong>Admin override:</strong> this account has full access.
                            </div>
                          )}
                          <PermissionMatrixControls
                            projects={projects}
                            users={users}
                            permissionUser={permissionUser}
                            toolPermissionDraft={toolPermissionDraft}
                            projectPermissionDraft={projectPermissionDraft}
                            onToolChange={setToolPermission}
                            onProjectChange={setProjectPermission}
                            onApplyTemplate={applyRolePermissionTemplate}
                            onSelectUser={(member: UserActivitySummary) => {
                              editAdminUser(member);
                              setAdminUserView("access");
                            }}
                            onSave={savePermissions}
                            onResetDefaults={resetPermissionDraftToDefaults}
                            onExternalDefaults={applyExternalCollaboratorDefaults}
                            onCopyFromUser={copyPermissionsFromUser}
                          />
                          <section className="permission-section-v065">
                            <div className="section-heading">
                              <div>
                                <h3>Tool access</h3>
                              </div>
                              <span className="soft-pill">{levelLabel(permissionTemplateMode)} draft</span>
                            </div>
                            <div className="tool-permission-grid-v065">
                              {TOOL_PERMISSION_OPTIONS.map((tool) => (
                                <div className="tool-permission-card-v065" key={tool.key}>
                                  <div>
                                    <strong>{tool.label}</strong>
                                    <span>{tool.description}</span>
                                  </div>
                                  <ClusterSelect
                                    value={(toolPermissionDraft[tool.key] || defaultToolPermissionsForUser(permissionUser)[tool.key] || "none") as ToolPermissionLevel}
                                    onChange={(value) => setToolPermission(tool.key, value as ToolPermissionLevel)}
                                    ariaLabel={`${tool.label} permission`}
                                    disabled={Boolean(permissionUser.isAdmin)}
                                    options={TOOL_LEVEL_OPTIONS.map((level) => ({
                                      value: level,
                                      label: levelLabel(level),
                                    }))}
                                  />
                                </div>
                              ))}
                            </div>
                          </section>
                          <section className="permission-section-v065">
                            <div className="section-heading">
                              <div>
                                <h3>Project access</h3>
                              </div>
                            </div>
                            <div className="project-permission-list-v065">
                              {projects.length ? (
                                projects.map((project) => (
                                  <div className="project-permission-row-v065" key={project.id}>
                                    <div>
                                      <strong>{project.name}</strong>
                                      <span>
                                        {projectTypeBadge(project)} · {projectMemberIds(project).includes(permissionUser.id) ? "assigned" : "not assigned"}
                                      </span>
                                    </div>
                                    <ClusterSelect
                                      value={(projectPermissionDraft[project.id] || getProjectPermission(permissionUser, project)) as ProjectPermissionLevel}
                                      onChange={(value) => setProjectPermission(project.id, value as ProjectPermissionLevel)}
                                      ariaLabel={`${project.name} permission`}
                                      disabled={Boolean(permissionUser.isAdmin)}
                                      options={PROJECT_LEVEL_OPTIONS.map((level) => ({
                                        value: level,
                                        label: levelLabel(level),
                                      }))}
                                    />
                                  </div>
                                ))
                              ) : (
                                <ClusterEmptyState compact kind="empty" title="No projects" description="This person does not currently have project access." />
                              )}
                            </div>
                          </section>
                          <section className="permission-section-v065 permission-tester-v120">
                            <div className="section-heading">
                              <div>
                                <h3>Permission tester</h3>
                              </div>
                            </div>
                            <div className="permission-test-grid-v120">
                              <div className="field">
                                <label>Tool</label>
                                <ClusterSelect
                                  value={permissionTestTool}
                                  onChange={(value) => setPermissionTestTool(value as ToolPermissionKey)}
                                  ariaLabel="Permission tester tool"
                                  options={TOOL_PERMISSION_OPTIONS.map((tool) => ({
                                    value: tool.key,
                                    label: tool.label,
                                  }))}
                                />
                              </div>
                              <div className="field">
                                <label>Project</label>
                                <ClusterSelect
                                  value={permissionTestProjectId}
                                  onChange={setPermissionTestProjectId}
                                  ariaLabel="Permission tester project"
                                  options={[
                                    { value: "", label: "No project context" },
                                    ...projects.map((project) => ({
                                      value: project.id,
                                      label: project.name,
                                    })),
                                  ]}
                                />
                              </div>
                              <div className="permission-test-result-v120">
                                <strong>{canUseTool(permissionUser, permissionTestTool, "view") ? "Tool visible" : "Tool hidden"}</strong>
                                <span>Tool level: {getToolLevel(permissionUser, permissionTestTool)}</span>
                                <em>{permissionTestProjectId ? `Project access: ${getProjectPermission(permissionUser, projects.find((project) => project.id === permissionTestProjectId) || null)}` : "No project selected"}</em>
                                <b>{permissionTestProjectId ? projectPermissionReason(permissionUser, projects.find((project) => project.id === permissionTestProjectId) || null) : permissionUser.isAdmin ? "Allowed by admin override" : "Standard permission path"}</b>
                              </div>
                            </div>
                          </section>
                          <div className="user-admin-sticky-actions-v244">
                            <ClusterButton type="button" className="" onClick={savePermissions} disabled={Boolean(permissionUser.isAdmin)} variant="primary">
                              Save permissions
                            </ClusterButton>
                            <ClusterButton type="button" className="" onClick={resetPermissionDraftToDefaults} disabled={Boolean(permissionUser.isAdmin)} variant="secondary">
                              Reset to role
                            </ClusterButton>
                          </div>
                        </>
                      ) : (
                        <ClusterEmptyState compact kind="empty" title="Select a person" description="Choose an account to inspect access, activity, and project assignments." />
                      )}
                    </div>
                  )}

                  {adminUserView === "account" && (
                    <div className="user-admin-detail-scroll-v244 account-admin-v244">
                      <div className="account-admin-summary-v244">
                        <div>
                          <span>State</span>
                          <strong>{levelLabel(adminSelectedUser.accountState || "PASSWORD_CHANGE_REQUIRED")}</strong>
                        </div>
                        <div>
                          <span>Role</span>
                          <strong>{adminSelectedUser.workspaceRole || "member"}</strong>
                        </div>
                        <div>
                          <span>Type</span>
                          <strong>{adminSelectedUser.accountType || "employee"}</strong>
                        </div>
                        <div>
                          <span>Discord</span>
                          <strong>{adminSelectedUser.discordUserId ? "Linked" : "Not linked"}</strong>
                        </div>
                        <div>
                          <span>Last seen</span>
                          <strong>{adminSelectedUser.lastSeenAt ? formatRelativeTime(adminSelectedUser.lastSeenAt) : "Never"}</strong>
                        </div>
                        <div>
                          <span>Access expiry</span>
                          <strong>{adminSelectedUser.accessExpiresAt ? new Date(adminSelectedUser.accessExpiresAt).toLocaleDateString() : "Permanent"}</strong>
                        </div>
                      </div>
                      {passwordResetRequests.some((item) => item.user.id === adminSelectedUser.id) && (
                        <section className="account-admin-section-v244 password-reset-request-v473">
                          <header><div><h3>Password reset requested</h3><span>The user requested administrator help signing back in.</span></div><strong>{formatRelativeTime(passwordResetRequests.find((item) => item.user.id === adminSelectedUser.id)!.createdAt)}</strong></header>
                          <div className="button-row">
                            <ClusterButton type="button" className="" onClick={() => void issueAdminPasswordReset(adminSelectedUser)} variant="primary">Issue temporary password</ClusterButton>
                            <ClusterButton type="button" className="" onClick={() => void dismissPasswordResetRequest(passwordResetRequests.find((item) => item.user.id === adminSelectedUser.id)!.id)} variant="secondary">Dismiss request</ClusterButton>
                          </div>
                        </section>
                      )}
                      <section className="account-admin-section-v244">
                        <header>
                          <div>
                            <h3>Authentication</h3>
                            <span>Credential status and administrative resets</span>
                          </div>
                        </header>
                        <div className="admin-credential-status-v270">
                          <div><span>Password</span><strong>{adminSelectedUser.passwordConfigured ? "Configured" : "Setup required"}</strong><small>{adminSelectedUser.passwordChangedAt ? `Changed ${formatRelativeTime(adminSelectedUser.passwordChangedAt)}` : "No change recorded"}</small></div>
                          <div><span>Security PIN</span><strong>{adminSelectedUser.pinConfigured ? "Configured" : "Not configured"}</strong></div>
                        </div>
                        <div className="admin-credential-editor-v270">
                          <label className="field"><span>Set password</span><div className="admin-password-field-v473"><ClusterTextInput type={adminPasswordVisible ? "text" : "password"} maxLength={1024} value={adminCredentialForm.password} onChange={(event) => setAdminCredentialForm((current) => ({ ...current, password: event.target.value }))} placeholder="New password" /><ClusterButton type="button" onClick={() => setAdminPasswordVisible((value) => !value)}>{adminPasswordVisible ? "Hide" : "Show"}</ClusterButton></div></label>
                          <ClusterButton type="button" className="" onClick={() => void setAdminUserPassword(adminSelectedUser)} disabled={!adminCredentialForm.password} variant="secondary">Set password</ClusterButton>
                          <label className="field"><span>Set security PIN</span><ClusterTextInput inputMode="numeric" pattern="[0-9]*" maxLength={8} value={adminCredentialForm.pin} onChange={(event) => setAdminCredentialForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, "").slice(0, 8) }))} placeholder="4–8 digits" /></label>
                          <ClusterButton type="button" className="" onClick={() => void setAdminUserPin(adminSelectedUser)} disabled={!adminCredentialForm.pin} variant="secondary">Set PIN</ClusterButton>
                        </div>
                        <div className="account-admin-actions-v244">
                          <ClusterButton type="button" onClick={() => issueAdminPasswordReset(adminSelectedUser)}>
                            <strong>Reset password</strong>
                            <span>Issue a temporary password and revoke sessions.</span>
                          </ClusterButton>
                          <ClusterButton type="button" onClick={() => void resetAdminUserPin(adminSelectedUser)} disabled={!adminSelectedUser.pinConfigured}>
                            <strong>Reset PIN</strong>
                            <span>Remove the current PIN and require the user to create a new one.</span>
                          </ClusterButton>
                          <ClusterButton type="button" disabled={!adminSelectedUser.discordUserId} onClick={() => clearAdminDiscordLink(adminSelectedUser)}>
                            <strong>Clear Discord link</strong>
                            <span>Remove the linked Discord identity.</span>
                          </ClusterButton>
                        </div>
                      </section>
                      <section className="account-admin-section-v244">
                        <header>
                          <div>
                            <h3>Lifecycle</h3>
                            <span>Access state and archive controls</span>
                          </div>
                        </header>
                        <div className="account-admin-actions-v244">
                          {adminSelectedUser.accountState === "SUSPENDED" || adminSelectedUser.accountState === "DISABLED" ? (
                            <ClusterButton type="button" onClick={() => setAdminAccountState(adminSelectedUser, "ACTIVE")}>
                              <strong>Reactivate account</strong>
                              <span>Restore sign-in and workspace access.</span>
                            </ClusterButton>
                          ) : (
                            <ClusterButton type="button" className="danger" onClick={() => setAdminAccountState(adminSelectedUser, "SUSPENDED")}>
                              <strong>Suspend account</strong>
                              <span>Block sign-in without deleting records.</span>
                            </ClusterButton>
                          )}
                          <ClusterButton type="button" className="danger" onClick={() => archiveAdminUser(adminSelectedUser)}>
                            <strong>{adminSelectedUser.archived ? "Restore account" : "Archive account"}</strong>
                            <span>{adminSelectedUser.archived ? "Return this account to the directory." : "Remove this account from active lists."}</span>
                          </ClusterButton>
                        </div>
                      </section>
                      <section className="account-admin-section-v244">
                        <header>
                          <div>
                            <h3>Verification</h3>
                            <span>Review the workspace through this account.</span>
                          </div>
                        </header>
                        <div className="button-row">
                          <ClusterButton type="button" className="" onClick={() => onStartPreview(adminSelectedUser)} disabled={previewUser?.id === adminSelectedUser.id} variant="secondary">
                            Preview as user
                          </ClusterButton>
                          {previewUser && (
                            <ClusterButton type="button" variant="quiet" onClick={onStopPreview}>
                              Stop preview
                            </ClusterButton>
                          )}
                        </div>
                      </section>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <header className="user-admin-subject-v244">
                    <ClusterButton type="button" className="user-admin-mobile-close-v456" variant="quiet" onClick={() => { setAdminCreatingUser(false); setAdminEditingUserId(""); }}><ClusterIcon name="chevron-left" /> Directory</ClusterButton>
                    <div className="logo-mark small">+</div>
                    <div>
                      <h3>New person</h3>

                    </div>
                  </header>
                  {issuedTemporaryPassword && (
                    <section className="issued-temporary-password">
                      <div>
                        <h4>{issuedTemporaryPassword.username}</h4>
                        <span>Temporary password · user must change it at next sign-in</span>
                      </div>
                      <code>{issuedTemporaryPassword.temporaryPassword}</code>
                    </section>
                  )}
                  <div className="user-admin-detail-scroll-v244">
                    <UserEditorForm form={adminUserForm} setForm={setAdminUserForm} settings={settings} departmentOptions={adminDepartmentOptions} users={users} editingUserId={adminEditingUserId} />
                    <div className="user-admin-sticky-actions-v244">
                      <ClusterButton type="button" className="" onClick={saveAdminUser} disabled={adminUserSaving} variant="primary">
                        {adminUserSaving ? "Creating…" : "Create account"}
                      </ClusterButton>
                    </div>
                  </div>
                </>
              )}
            </main>
          </div>
        </section>
      )}

      <AdminUtilitySections
        adminSection={adminSection}
        projects={projects}
        users={users}
        onOpenServerConfig={onOpenServerConfig}
        downloadAdminExport={downloadAdminExport}
      />

    </SectionedWorkspaceShell>
  );
}

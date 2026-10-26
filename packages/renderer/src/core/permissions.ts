import { CLUSTER_TOOL_PERMISSION_KEYS, CLUSTER_TOOL_PERMISSION_MANIFEST, type ClusterToolPermissionKey } from "@cluster/shared";

export type ToolPermissionKey = ClusterToolPermissionKey;
export type ToolPermissionLevel = "none" | "view" | "edit" | "manage";
export type ProjectPermissionLevel = "none" | "view" | "contribute" | "manage";
export type ToolPermissions = Partial<Record<ToolPermissionKey, ToolPermissionLevel>>;
export type ProjectPermissions = Record<string, ProjectPermissionLevel>;

export type PermissionUser = {
  id?: string | null;
  workspaceRole?: string | null;
  accountType?: string | null;
  accessExpiresAt?: string | null;
  employmentType?: string | null;
  teamName?: string | null;
  title?: string | null;
  isAdmin?: boolean;
  toolPermissions?: ToolPermissions | null;
  projectPermissions?: ProjectPermissions | null;
};

export const TOOL_PERMISSION_OPTIONS: Array<{ key: ToolPermissionKey; label: string; description: string }> =
  CLUSTER_TOOL_PERMISSION_KEYS.map((key) => ({
    key,
    label: CLUSTER_TOOL_PERMISSION_MANIFEST[key].label,
    description: CLUSTER_TOOL_PERMISSION_MANIFEST[key].description,
  }));

export const TOOL_LEVEL_OPTIONS: ToolPermissionLevel[] = ["none", "view", "edit", "manage"];
export const PROJECT_LEVEL_OPTIONS: ProjectPermissionLevel[] = ["none", "view", "contribute", "manage"];
export const TOOL_LEVEL_RANK: Record<ToolPermissionLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };
export const PROJECT_LEVEL_RANK: Record<ProjectPermissionLevel, number> = { none: 0, view: 1, contribute: 2, manage: 3 };

export const DEFAULT_MEMBER_TOOL_PERMISSIONS: ToolPermissions = {
  mywork: "view", inbox: "view", projects: "view", boards: "edit", whiteboards: "edit", viewer: "edit", timeline: "edit", builds: "edit", qa: "edit", tickets: "edit", calendar: "edit", scheduler: "edit", library: "edit", packets: "edit", inventory: "view", vault: "none", sourceControl: "edit", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none",
};

export const DEFAULT_VIEWER_TOOL_PERMISSIONS: ToolPermissions = {
  mywork: "view", inbox: "view", projects: "view", boards: "view", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "view", tickets: "view", calendar: "view", scheduler: "view", library: "view", packets: "view", inventory: "view", vault: "none", sourceControl: "view", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none",
};

export const EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS: ToolPermissions = {
  mywork: "view", inbox: "view", projects: "view", boards: "view", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "edit", tickets: "edit", calendar: "view", scheduler: "none", library: "view", packets: "view", inventory: "none", vault: "none", sourceControl: "none", integrations: "none", people: "none", activity: "none", settings: "view", serverConfig: "none",
};

export const ROLE_PERMISSION_TEMPLATES: Array<{ key: string; label: string; description: string; tools: ToolPermissions }> = [
  {
    key: "producer",
    label: "Producer / Lead",
    description: "Manage planning, builds, QA, scheduling, people visibility, and project work without full admin system access.",
    tools: { mywork: "view", inbox: "view", projects: "manage", boards: "manage", whiteboards: "manage", viewer: "manage", timeline: "manage", builds: "manage", qa: "manage", tickets: "manage", calendar: "manage", scheduler: "manage", library: "manage", packets: "manage", sourceControl: "manage", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none" },
  },
  {
    key: "developer",
    label: "Developer",
    description: "Contribute to boards, QA, builds, planning, and Library resources without server-level configuration access.",
    tools: { mywork: "view", inbox: "view", projects: "view", boards: "edit", whiteboards: "edit", viewer: "view", timeline: "edit", builds: "edit", qa: "edit", tickets: "edit", calendar: "view", scheduler: "edit", library: "edit", packets: "edit", inventory: "view", vault: "none", sourceControl: "edit", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none" },
  },
  {
    key: "artist-editor",
    label: "Artist / Editor",
    description: "Work on boards, review, whiteboards, Library resources, and personal scheduling.",
    tools: { mywork: "view", inbox: "view", projects: "view", boards: "edit", whiteboards: "edit", viewer: "edit", timeline: "view", builds: "view", qa: "view", tickets: "view", calendar: "view", scheduler: "edit", library: "edit", packets: "edit", inventory: "view", vault: "none", sourceControl: "view", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none" },
  },
  {
    key: "qa",
    label: "QA",
    description: "Report defects, review builds, read project context, and contribute QA and ticket work.",
    tools: { mywork: "view", inbox: "view", projects: "view", boards: "edit", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "edit", tickets: "edit", calendar: "view", scheduler: "edit", library: "view", packets: "view", inventory: "view", vault: "none", sourceControl: "view", integrations: "none", people: "view", activity: "view", settings: "view", serverConfig: "none" },
  },
  {
    key: "external-collaborator",
    label: "External Collaborator",
    description: "Restricted contributor defaults for partners, clients, contractors, and vendors. Explicit project access still wins.",
    tools: EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS,
  },
  {
    key: "client-viewer",
    label: "Viewer / Client",
    description: "Read-only project visibility with no management or edit access.",
    tools: { mywork: "view", inbox: "view", projects: "view", boards: "view", whiteboards: "view", viewer: "view", timeline: "view", builds: "view", qa: "view", tickets: "view", calendar: "view", scheduler: "none", library: "view", packets: "view", inventory: "none", vault: "none", sourceControl: "none", integrations: "none", people: "none", activity: "none", settings: "view", serverConfig: "none" },
  },
];

export function isUserAccessExpired(user?: Pick<PermissionUser, "accessExpiresAt" | "isAdmin" | "workspaceRole"> | null) {
  if (!user || user.isAdmin || ["owner", "admin"].includes(String(user.workspaceRole || "")) || !user.accessExpiresAt) return false;
  const expiresAt = new Date(user.accessExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function isExternalCollaborator(user?: Pick<PermissionUser, "workspaceRole" | "accountType"> | null) {
  const workspaceRole = String(user?.workspaceRole || "").toLowerCase();
  const accountType = String(user?.accountType || "").toLowerCase();
  return ["external", "guest", "client"].includes(workspaceRole) || ["contractor", "client", "guest"].includes(accountType);
}

export function defaultToolPermissionsForUser(user?: PermissionUser | null): ToolPermissions {
  if (user?.isAdmin || ["owner", "admin"].includes(String(user?.workspaceRole || ""))) {
    return Object.fromEntries(TOOL_PERMISSION_OPTIONS.map((tool) => [tool.key, "manage"])) as ToolPermissions;
  }
  if (isExternalCollaborator(user)) return EXTERNAL_COLLABORATOR_TOOL_PERMISSIONS;
  if ((user?.workspaceRole || "member") === "viewer") return DEFAULT_VIEWER_TOOL_PERMISSIONS;
  return DEFAULT_MEMBER_TOOL_PERMISSIONS;
}

export function getToolLevel(user: PermissionUser | null | undefined, tool: ToolPermissionKey): ToolPermissionLevel {
  if (isUserAccessExpired(user)) return "none";
  const defaults = defaultToolPermissionsForUser(user);
  const override = user?.toolPermissions?.[tool];
  return (override || defaults[tool] || "none") as ToolPermissionLevel;
}

export function canUseTool(user: PermissionUser | null | undefined, tool: ToolPermissionKey, min: ToolPermissionLevel = "view") {
  if (user?.isAdmin) return true;
  return TOOL_LEVEL_RANK[getToolLevel(user, tool)] >= TOOL_LEVEL_RANK[min];
}

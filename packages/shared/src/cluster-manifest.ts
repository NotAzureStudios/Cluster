import { PRODUCT_TERMS } from "./product-language.js";

export const CLUSTER_FEATURE_LIFECYCLES = ["experimental", "active", "deprecated", "retired"] as const;
export type ClusterFeatureLifecycle = (typeof CLUSTER_FEATURE_LIFECYCLES)[number];

export const CLUSTER_RESOURCE_CAPABILITIES = [
  "view",
  "comment",
  "watch",
  "assign",
  "relate",
  "export",
  "automate",
  "review",
  "approve",
  "archive",
  "collaborate",
  "operate",
] as const;
export type ClusterResourceCapability = (typeof CLUSTER_RESOURCE_CAPABILITIES)[number];

export type ClusterResourceDefinition = {
  label: string;
  plural: string;
  ownerDomain: string;
  lifecycle: ClusterFeatureLifecycle;
  projectScoped: boolean;
  /** Resource may also exist outside a Project, while retaining Project-scoped semantics when linked. */
  standaloneAllowed?: boolean;
  capabilities: readonly ClusterResourceCapability[];
};

/**
 * Canonical Cluster resource vocabulary.
 *
 * Product/domain code should extend this manifest instead of creating another
 * local resource-kind union. Resource addresses, workflow links, navigation,
 * search, export, collaboration, and future capability discovery converge here.
 */
export const CLUSTER_RESOURCE_MANIFEST = {
  project: { label: "Project", plural: "Projects", ownerDomain: "projects", lifecycle: "active", projectScoped: false, capabilities: ["view", "comment", "watch", "relate", "export", "automate", "archive", "collaborate"] },
  board: { label: "Board", plural: "Boards", ownerDomain: "boards", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "relate", "export", "automate", "collaborate"] },
  card: { label: "Card", plural: "Cards", ownerDomain: "boards", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "archive", "collaborate"] },
  ticket: { label: "Ticket", plural: "Tickets", ownerDomain: "tickets", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "archive", "collaborate"] },
  whiteboard: { label: "Whiteboard", plural: "Whiteboards", ownerDomain: "whiteboards", lifecycle: "active", projectScoped: true, standaloneAllowed: true, capabilities: ["view", "comment", "watch", "relate", "export", "automate", "collaborate"] },
  review_asset: { label: "Review asset", plural: "Review assets", ownerDomain: "media", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "review", "approve", "collaborate"] },
  build: { label: "Build", plural: "Builds", ownerDomain: "delivery", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "review", "approve"] },
  qa_plan: { label: "QA plan", plural: "QA plans", ownerDomain: "delivery", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate"] },
  qa_session: { label: "QA session", plural: "QA sessions", ownerDomain: "delivery", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "approve"] },
  release: { label: "Release", plural: "Releases", ownerDomain: "delivery", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "approve", "archive"] },
  meeting: { label: "Meeting", plural: "Meetings", ownerDomain: "planning", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "collaborate"] },
  control: { label: "Project control record", plural: "Project control records", ownerDomain: "projects", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "approve"] },
  calendar: { label: "Calendar event", plural: "Calendar events", ownerDomain: "planning", lifecycle: "active", projectScoped: true, standaloneAllowed: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "collaborate"] },
  scheduler: { label: "Schedule block", plural: "Schedule blocks", ownerDomain: "planning", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate"] },
  timeline: { label: "Timeline item", plural: "Timeline items", ownerDomain: "planning", lifecycle: "active", projectScoped: true, standaloneAllowed: true, capabilities: ["view", "comment", "watch", "assign", "relate", "export", "automate", "collaborate"] },
  library: { label: "Library item", plural: "Library items", ownerDomain: "library", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "relate", "export", "automate", "archive", "collaborate"] },
  file: { label: "File", plural: "Files", ownerDomain: "library", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "relate", "export", "archive"] },
  user: { label: "Person", plural: "People", ownerDomain: "people", lifecycle: "active", projectScoped: false, capabilities: ["view", "relate", "export"] },
  team: { label: "Team", plural: "Teams", ownerDomain: "people", lifecycle: "active", projectScoped: false, capabilities: ["view", "export"] },
  department: { label: "Department", plural: "Departments", ownerDomain: "people", lifecycle: "active", projectScoped: false, capabilities: ["view", "export"] },
  job_role: { label: "Job role", plural: "Job roles", ownerDomain: "people", lifecycle: "active", projectScoped: false, capabilities: ["view", "export"] },
  packet: { label: "Packet", plural: "Packets", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "watch", "assign", "export", "archive"] },
  studio_form: { label: "Form", plural: "Forms", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "export", "archive"] },
  form_submission: { label: "Form submission", plural: "Form submissions", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "assign", "export", "approve"] },
  application: { label: "Application", plural: "Applications", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "assign", "export", "approve", "archive"] },
  onboarding_assignment: { label: "Onboarding assignment", plural: "Onboarding assignments", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "assign", "export"] },
  policy: { label: "Policy", plural: "Policies", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "watch", "assign", "export", "approve", "archive"] },
  announcement: { label: "Announcement", plural: "Announcements", ownerDomain: "studio-systems", lifecycle: "active", projectScoped: false, capabilities: ["view", "watch", "export", "archive"] },
  automation_rule: { label: "Automation rule", plural: "Automation rules", ownerDomain: "automation", lifecycle: "active", projectScoped: false, capabilities: ["view", "export", "automate", "archive"] },
  automation_run: { label: "Automation run", plural: "Automation runs", ownerDomain: "automation", lifecycle: "active", projectScoped: false, capabilities: ["view", "export"] },
  source_repository: { label: "Source repository", plural: "Source repositories", ownerDomain: "source-control", lifecycle: "active", projectScoped: true, capabilities: ["view", "watch", "export", "automate"] },
  source_review: { label: "Source review", plural: "Source reviews", ownerDomain: "source-control", lifecycle: "active", projectScoped: true, capabilities: ["view", "comment", "watch", "assign", "export", "review", "approve", "collaborate"] },
  source_commit: { label: "Source commit", plural: "Source commits", ownerDomain: "source-control", lifecycle: "active", projectScoped: true, capabilities: ["view", "export"] },
  approval: { label: "Approval", plural: "Approvals", ownerDomain: "approvals", lifecycle: "active", projectScoped: false, capabilities: ["view", "assign", "export", "approve"] },
  background_job: { label: "Background job", plural: "Background jobs", ownerDomain: "jobs", lifecycle: "active", projectScoped: false, capabilities: ["view", "export", "operate"] },
  integration_connection: { label: "Integration connection", plural: "Integration connections", ownerDomain: "integrations", lifecycle: "active", projectScoped: false, capabilities: ["view", "export"] },
} as const satisfies Record<string, ClusterResourceDefinition>;

export type ClusterResourceKind = keyof typeof CLUSTER_RESOURCE_MANIFEST;
export const CLUSTER_RESOURCE_KINDS = Object.freeze(Object.keys(CLUSTER_RESOURCE_MANIFEST)) as readonly ClusterResourceKind[];

export function clusterResourceDefinition(kind: ClusterResourceKind) {
  return CLUSTER_RESOURCE_MANIFEST[kind];
}

export function clusterResourceSupports(kind: ClusterResourceKind, capability: ClusterResourceCapability) {
  return (CLUSTER_RESOURCE_MANIFEST[kind].capabilities as readonly ClusterResourceCapability[]).includes(capability);
}

export const CLUSTER_RELATABLE_RESOURCE_KINDS = Object.freeze(
  CLUSTER_RESOURCE_KINDS.filter((kind) => clusterResourceSupports(kind, "relate")),
) as readonly ClusterResourceKind[];
export const CLUSTER_COMMENTABLE_RESOURCE_KINDS = Object.freeze(
  CLUSTER_RESOURCE_KINDS.filter((kind) => clusterResourceSupports(kind, "comment")),
) as readonly ClusterResourceKind[];
export const CLUSTER_WATCHABLE_RESOURCE_KINDS = Object.freeze(
  CLUSTER_RESOURCE_KINDS.filter((kind) => clusterResourceSupports(kind, "watch")),
) as readonly ClusterResourceKind[];

export type ClusterAdminToolGroup = "Planning" | "Workflow" | "Content";
export type ClusterToolPermissionDefinition = {
  label: string;
  description: string;
  lifecycle: ClusterFeatureLifecycle;
  adminConfigurable?: boolean;
  adminGroup?: ClusterAdminToolGroup;
};

/**
 * Canonical tool-permission vocabulary.
 *
 * These IDs describe product capabilities, not implementation-era aliases.
 * New authorization, navigation, admin, and policy code must depend on this
 * manifest rather than introducing local tool-key unions.
 */
export const CLUSTER_TOOL_PERMISSION_MANIFEST = {
  mywork: { label: PRODUCT_TERMS.myWork, description: "Personal assignments, due items, schedule, and work requiring attention.", lifecycle: "active" },
  inbox: { label: PRODUCT_TERMS.inbox, description: "Assignments, mentions, approvals, reminders, and other actionable notifications.", lifecycle: "active" },
  projects: { label: PRODUCT_TERMS.projects, description: "Project directory, project workspaces, and project lifecycle context.", lifecycle: "active" },
  boards: { label: PRODUCT_TERMS.boards, description: "Boards, lists, cards, and board-level production work.", lifecycle: "active" },
  whiteboards: { label: PRODUCT_TERMS.whiteboards, description: "Visual planning, diagrams, and collaborative whiteboards.", lifecycle: "active" },
  viewer: { label: "Viewer & Review", description: "Production viewing, review, notes, approvals, and media delivery workflow.", lifecycle: "active" },
  timeline: { label: PRODUCT_TERMS.timeline, description: "Roadmaps, milestones, deadlines, and timeline planning.", lifecycle: "active", adminConfigurable: true, adminGroup: "Planning" },
  builds: { label: PRODUCT_TERMS.builds, description: "Builds, releases, changelogs, testing, and ship readiness.", lifecycle: "active" },
  qa: { label: PRODUCT_TERMS.qa, description: "QA plans, sessions, defects, reproduction notes, and quality workflows.", lifecycle: "active" },
  tickets: { label: PRODUCT_TERMS.tickets, description: "Requests, support, intake, and cross-team work tracking.", lifecycle: "active", adminConfigurable: true, adminGroup: "Workflow" },
  calendar: { label: "Calendar", description: "Calendar events and planning visibility.", lifecycle: "active", adminConfigurable: true, adminGroup: "Planning" },
  scheduler: { label: PRODUCT_TERMS.scheduler, description: "Time, schedule blocks, working patterns, capacity, and workforce scheduling.", lifecycle: "active", adminConfigurable: true, adminGroup: "Workflow" },
  library: { label: PRODUCT_TERMS.library, description: "Files, folders, media, project assets, and shared workspace resources.", lifecycle: "active", adminConfigurable: true, adminGroup: "Content" },
  packets: { label: "Packets", description: "Curated training and knowledge packets backed by Library resources.", lifecycle: "active", adminConfigurable: true, adminGroup: "Content" },
  inventory: { label: "Inventory", description: "Assigned equipment, license seats, commercial key pools, and asset allocations.", lifecycle: "active" },
  vault: { label: "Vault", description: "Administrator-managed encrypted studio secrets and credential lifecycle.", lifecycle: "active" },
  sourceControl: { label: PRODUCT_TERMS.sourceControl, description: "Project repositories, branches, commits, reviews, synchronization, and repository health.", lifecycle: "active" },
  integrations: { label: "Integrations", description: "Discord, webhooks, and external connected providers.", lifecycle: "active" },
  people: { label: PRODUCT_TERMS.people, description: "People directory, profiles, organization, teams, and workforce context.", lifecycle: "active" },
  activity: { label: "Activity", description: "Workspace activity, audit signals, and operational history.", lifecycle: "active" },
  settings: { label: "Settings", description: "Account, appearance, notification, shortcut, comfort, and studio settings.", lifecycle: "active" },
  serverConfig: { label: "Server Configuration", description: "Server runtime, network, security, storage, backups, and infrastructure configuration.", lifecycle: "active" },
} as const satisfies Record<string, ClusterToolPermissionDefinition>;

export type ClusterToolPermissionKey = keyof typeof CLUSTER_TOOL_PERMISSION_MANIFEST;
export const CLUSTER_TOOL_PERMISSION_KEYS = Object.freeze(Object.keys(CLUSTER_TOOL_PERMISSION_MANIFEST)) as readonly ClusterToolPermissionKey[];

export function clusterToolPermissionDefinition(id: ClusterToolPermissionKey) {
  return CLUSTER_TOOL_PERMISSION_MANIFEST[id];
}
export type ClusterAdminConfigurableToolId = {
  [K in ClusterToolPermissionKey]: (typeof CLUSTER_TOOL_PERMISSION_MANIFEST)[K] extends { adminConfigurable: true } ? K : never
}[ClusterToolPermissionKey];
export const CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS = Object.freeze(
  CLUSTER_TOOL_PERMISSION_KEYS.filter((id): id is ClusterAdminConfigurableToolId => "adminConfigurable" in CLUSTER_TOOL_PERMISSION_MANIFEST[id] && CLUSTER_TOOL_PERMISSION_MANIFEST[id].adminConfigurable === true),
) as readonly ClusterAdminConfigurableToolId[];


export type ClusterSearchScopeDefinition = {
  label: string;
  aliases: readonly string[];
  lifecycle: ClusterFeatureLifecycle;
  remote: boolean;
  showInScopeRail: boolean;
  resultKind?: string;
};

/**
 * Canonical search vocabulary shared by the command palette and server API.
 * Remote scopes are a strict subset; local scopes may route into a focused
 * workspace without pretending the server has indexed that domain yet.
 */
export const CLUSTER_SEARCH_SCOPE_MANIFEST = {
  all: { label: "All", aliases: ["all"], lifecycle: "active", remote: true, showInScopeRail: true },
  project: { label: PRODUCT_TERMS.projects, aliases: ["project", "projects"], lifecycle: "active", remote: true, showInScopeRail: true },
  person: { label: PRODUCT_TERMS.people, aliases: ["user", "users", "person", "people", "team", "member", "members", "teammate", "teammates"], lifecycle: "active", remote: true, showInScopeRail: true },
  card: { label: "Cards", aliases: ["card", "cards"], lifecycle: "active", remote: true, showInScopeRail: true },
  ticket: { label: PRODUCT_TERMS.tickets, aliases: ["ticket", "tickets"], lifecycle: "active", remote: true, showInScopeRail: true },
  board: { label: PRODUCT_TERMS.boards, aliases: ["board", "boards"], lifecycle: "active", remote: true, showInScopeRail: true },
  whiteboard: { label: PRODUCT_TERMS.whiteboards, aliases: ["whiteboard", "whiteboards"], lifecycle: "active", remote: true, showInScopeRail: true },
  file: { label: PRODUCT_TERMS.library, aliases: ["file", "files", "doc", "docs", "library"], lifecycle: "active", remote: true, showInScopeRail: true },
  packet: { label: "Packets", aliases: ["packet", "packets", "training", "handbook", "sop"], lifecycle: "active", remote: true, showInScopeRail: true },
  policy: { label: "Policies", aliases: ["policy", "policies", "required reading", "acknowledgement"], lifecycle: "active", remote: true, showInScopeRail: true },
  timeline: { label: PRODUCT_TERMS.timeline, aliases: ["timeline", "timelines", "milestone", "milestones"], lifecycle: "active", remote: true, showInScopeRail: true },
  comment: { label: "Comments", aliases: ["comment", "comments"], lifecycle: "active", remote: true, showInScopeRail: true },
  calendar: { label: "Calendar", aliases: ["calendar"], lifecycle: "active", remote: true, showInScopeRail: true },
  control: { label: "Control", aliases: ["control", "controls", "risk", "risks"], lifecycle: "active", remote: true, showInScopeRail: true },
  build: { label: PRODUCT_TERMS.builds, aliases: ["build", "builds"], lifecycle: "active", remote: true, showInScopeRail: true },
  qa: { label: PRODUCT_TERMS.qa, aliases: ["qa", "test", "tests"], lifecycle: "active", remote: true, showInScopeRail: true },
  release: { label: "Releases", aliases: ["release", "releases"], lifecycle: "active", remote: true, showInScopeRail: true },
  source_review: { label: "Source reviews", aliases: ["review", "reviews", "source", "source-review", "source-reviews"], lifecycle: "active", remote: true, showInScopeRail: true },
  source_commit: { label: "Source commits", aliases: ["commit", "commits", "revision", "revisions", "source-commit"], lifecycle: "active", remote: true, showInScopeRail: true },
  studio_form: { label: "Studio forms", aliases: ["studio form", "studio forms", "forms"], lifecycle: "active", remote: true, showInScopeRail: true },
  form_submission: { label: "Form reviews", aliases: ["form submission", "form submissions", "response", "responses"], lifecycle: "active", remote: true, showInScopeRail: true },
  approval: { label: "Approvals", aliases: ["approval", "approvals", "request review"], lifecycle: "active", remote: true, showInScopeRail: true },
  activity: { label: "Activity", aliases: ["activity"], lifecycle: "active", remote: true, showInScopeRail: true },
  scheduler: { label: PRODUCT_TERMS.scheduler, aliases: ["scheduler", "schedule"], lifecycle: "active", remote: false, showInScopeRail: false },
  inbox: { label: PRODUCT_TERMS.inbox, aliases: ["inbox", "notifications"], lifecycle: "active", remote: false, showInScopeRail: false },
  settings: { label: "Settings", aliases: ["settings"], lifecycle: "active", remote: false, showInScopeRail: false },
} as const satisfies Record<string, ClusterSearchScopeDefinition>;

export type ClusterSearchScope = keyof typeof CLUSTER_SEARCH_SCOPE_MANIFEST;
export const CLUSTER_SEARCH_SCOPE_IDS = Object.freeze(Object.keys(CLUSTER_SEARCH_SCOPE_MANIFEST)) as readonly ClusterSearchScope[];
export type ClusterRemoteSearchScope = {
  [K in ClusterSearchScope]: (typeof CLUSTER_SEARCH_SCOPE_MANIFEST)[K]["remote"] extends true ? K : never
}[ClusterSearchScope];
export const CLUSTER_REMOTE_SEARCH_SCOPE_IDS = Object.freeze(
  CLUSTER_SEARCH_SCOPE_IDS.filter((id): id is ClusterRemoteSearchScope => CLUSTER_SEARCH_SCOPE_MANIFEST[id].remote),
) as readonly ClusterRemoteSearchScope[];
export type ClusterSearchResultKind = Exclude<ClusterRemoteSearchScope, "all">;

export function clusterSearchScopeDefinition(id: ClusterSearchScope) {
  return CLUSTER_SEARCH_SCOPE_MANIFEST[id];
}

export type ClusterCreateGroup = "Plan" | "Coordinate" | "Deliver";
export type ClusterCreateModeDefinition = {
  label: string;
  detail: string;
  keywords: readonly string[];
  group: ClusterCreateGroup;
  primary: boolean;
  resourceKind: ClusterResourceKind;
  lifecycle: ClusterFeatureLifecycle;
};

/** Canonical Shared Create vocabulary. Renderer presentation augments this with icons and guidance. */
export const CLUSTER_CREATE_MODE_MANIFEST = {
  project: { label: "Project", detail: "Typed workspace", keywords: ["workspace", "production", "client"], group: "Plan", primary: true, resourceKind: "project", lifecycle: "active" },
  card: { label: "Card", detail: "Board task", keywords: ["task", "board", "todo"], group: "Deliver", primary: true, resourceKind: "card", lifecycle: "active" },
  ticket: { label: PRODUCT_TERMS.tickets.slice(0, -1), detail: "Work intake", keywords: ["request", "support", "incident"], group: "Deliver", primary: true, resourceKind: "ticket", lifecycle: "active" },
  bug: { label: "Bug", detail: "QA issue", keywords: ["qa", "defect", "issue", "repro"], group: "Deliver", primary: false, resourceKind: "ticket", lifecycle: "active" },
  build: { label: "Build", detail: "Project artifact", keywords: ["artifact", "release", "package", "publish"], group: "Deliver", primary: false, resourceKind: "build", lifecycle: "active" },
  timeline: { label: "Timeline", detail: "Milestone or date", keywords: ["milestone", "deadline", "release"], group: "Plan", primary: true, resourceKind: "timeline", lifecycle: "active" },
  calendar: { label: "Calendar", detail: "Event", keywords: ["meeting", "event", "review"], group: "Coordinate", primary: true, resourceKind: "calendar", lifecycle: "active" },
  scheduler: { label: "Schedule", detail: "Work block", keywords: ["focus", "availability", "time off"], group: "Coordinate", primary: true, resourceKind: "scheduler", lifecycle: "active" },
  meeting: { label: "Meeting", detail: "Planning session", keywords: ["session", "planning", "retro", "standup"], group: "Coordinate", primary: false, resourceKind: "meeting", lifecycle: "active" },
  whiteboard: { label: "Whiteboard", detail: "Planning canvas", keywords: ["canvas", "brainstorm", "diagram", "flow"], group: "Plan", primary: false, resourceKind: "whiteboard", lifecycle: "active" },
  packet: { label: "Packet", detail: "Knowledge bundle", keywords: ["knowledge", "training", "onboarding", "policy", "procedure", "handoff"], group: "Plan", primary: true, resourceKind: "packet", lifecycle: "active" },
} as const satisfies Record<string, ClusterCreateModeDefinition>;

export type ClusterCreateMode = keyof typeof CLUSTER_CREATE_MODE_MANIFEST;
export const CLUSTER_CREATE_MODE_IDS = Object.freeze(Object.keys(CLUSTER_CREATE_MODE_MANIFEST)) as readonly ClusterCreateMode[];
export const CLUSTER_PRIMARY_CREATE_MODE_IDS = Object.freeze(
  CLUSTER_CREATE_MODE_IDS.filter((id) => CLUSTER_CREATE_MODE_MANIFEST[id].primary),
) as readonly ClusterCreateMode[];

export function clusterCreateModeDefinition(id: ClusterCreateMode) {
  return CLUSTER_CREATE_MODE_MANIFEST[id];
}

export type ClusterProjectWorkspaceMode =
  | "Overview"
  | "Plan & Control"
  | "Produce & Validate"
  | "Spaces & Assets"
  | "People & Access"
  | "Lifecycle";

export type ClusterProjectToolDefinition = {
  label: string;
  mode: ClusterProjectWorkspaceMode;
  order: number;
  lifecycle: ClusterFeatureLifecycle;
};

/** Canonical project-workspace tool vocabulary. */
export const CLUSTER_PROJECT_TOOL_MANIFEST = {
  overview: { label: "Overview", mode: "Overview", order: 10, lifecycle: "active" },
  intelligence: { label: "Intelligence", mode: "Overview", order: 20, lifecycle: "active" },
  plan: { label: "Plan", mode: "Plan & Control", order: 30, lifecycle: "active" },
  control: { label: "Control", mode: "Plan & Control", order: 40, lifecycle: "active" },
  tickets: { label: PRODUCT_TERMS.tickets, mode: "Plan & Control", order: 50, lifecycle: "active" },
  source: { label: "Source Control", mode: "Produce & Validate", order: 55, lifecycle: "active" },
  builds: { label: PRODUCT_TERMS.builds, mode: "Produce & Validate", order: 60, lifecycle: "active" },
  qa: { label: PRODUCT_TERMS.qa, mode: "Produce & Validate", order: 70, lifecycle: "active" },
  boards: { label: PRODUCT_TERMS.boards, mode: "Spaces & Assets", order: 80, lifecycle: "active" },
  whiteboards: { label: PRODUCT_TERMS.whiteboards, mode: "Spaces & Assets", order: 90, lifecycle: "active" },
  library: { label: PRODUCT_TERMS.library, mode: "Spaces & Assets", order: 100, lifecycle: "active" },
  assets: { label: "Assets", mode: "Spaces & Assets", order: 110, lifecycle: "active" },
  production: { label: "Production", mode: "Produce & Validate", order: 120, lifecycle: "active" },
  viewer: { label: "Viewer & Review", mode: "Produce & Validate", order: 130, lifecycle: "active" },
  people: { label: "Crew", mode: "People & Access", order: 140, lifecycle: "active" },
  links: { label: "Integrations", mode: "People & Access", order: 150, lifecycle: "active" },
  access: { label: "Access", mode: "People & Access", order: 160, lifecycle: "active" },
  closeout: { label: "Closeout", mode: "Lifecycle", order: 170, lifecycle: "active" },
} as const satisfies Record<string, ClusterProjectToolDefinition>;

export type ClusterProjectToolId = keyof typeof CLUSTER_PROJECT_TOOL_MANIFEST;
export const CLUSTER_PROJECT_TOOL_IDS = Object.freeze(Object.keys(CLUSTER_PROJECT_TOOL_MANIFEST)) as readonly ClusterProjectToolId[];

export function clusterProjectToolDefinition(id: ClusterProjectToolId) {
  return CLUSTER_PROJECT_TOOL_MANIFEST[id];
}


export type ClusterAppRouteGroup = "home" | "work" | "projects" | "planning" | "library" | "people" | "control" | "system" | "hidden";
export type ClusterAppSidebarSection = "work" | "planning" | "library" | "people" | "administration" | "system";
export type ClusterAppRouteFeatureFlag = "ticketsEnabled" | "timelineEnabled" | "calendarEnabled" | "schedulerEnabled" | "libraryEnabled" | "packetsEnabled";
export type ClusterAppNavigationIcon = "activity" | "bell" | "calendar" | "clock" | "cloud" | "library" | "lock" | "operations" | "packet" | "settings" | "game" | "inventory" | "ticket" | "timeline" | "tools" | "users" | "work" | "palette";
export type ClusterApplicationActionGroup = "navigation" | "desktop";

export type ClusterApplicationActionDescriptor = Readonly<{
  id: string;
  group: ClusterApplicationActionGroup;
  description: string;
  aliases?: readonly string[];
  keywords?: readonly string[];
  paletteKey?: string;
}>;

export type ClusterAppRouteDefinition = Readonly<{
  label: string;
  group: ClusterAppRouteGroup;
  tool?: ClusterToolPermissionKey;
  adminOnly?: boolean;
  startEligible?: boolean;
  parent?: string;
  projectContext?: boolean;
  /** Standalone renderer tool: mount using the typed tool-module registry. */
  surface?: "standalone-tool";
  sidebar?: Readonly<{
    section: ClusterAppSidebarSection;
    order: number;
    icon: ClusterAppNavigationIcon;
    featureFlag?: ClusterAppRouteFeatureFlag;
    desktopOnly?: boolean;
  }>;
  action?: ClusterApplicationActionDescriptor;
}>;

/** Canonical top-level application destinations and command-discovery metadata. */
export const CLUSTER_APP_SIDEBAR_SECTIONS = Object.freeze([
  { id: "work", label: "Work", order: 10 },
  { id: "planning", label: "Plan", order: 20 },
  { id: "library", label: PRODUCT_TERMS.library, order: 30 },
  { id: "administration", label: PRODUCT_TERMS.administration, order: 40 },
  { id: "system", label: "System", order: 50 },
] as const satisfies ReadonlyArray<{ id: ClusterAppSidebarSection; label: string; order: number }>);

export const CLUSTER_APP_ROUTE_MANIFEST = {
  dashboard: { label: PRODUCT_TERMS.home, group: "home", startEligible: true, action: { id: "navigation.home", group: "navigation", description: "Workspace overview and resume context.", aliases: ["home", "dashboard"], paletteKey: "page-home" } },
  myRecords: { label: "Records", group: "library", action: { id: "navigation.my-records", group: "navigation", description: "Open records in Packets.", aliases: ["records", "personnel records"], keywords: ["records", "acknowledgements"], paletteKey: "page-my-records" } },
  people: { label: PRODUCT_TERMS.people, group: "people", tool: "people", action: { id: "navigation.people", group: "navigation", description: "Directory, profiles, and contact information.", aliases: ["people", "team", "users"], keywords: ["users", "team"], paletteKey: "page-people" } },
  mywork: { label: PRODUCT_TERMS.myWork, group: "work", tool: "mywork", startEligible: true, action: { id: "navigation.my-work", group: "navigation", description: "Personal assignments and due items.", aliases: ["mw", "mine", "assignments"], paletteKey: "page-mywork" } },
  inbox: { label: PRODUCT_TERMS.inbox, group: "work", tool: "inbox", startEligible: true, action: { id: "navigation.inbox", group: "navigation", description: "Assignments, mentions, approvals, reminders, and attention items.", aliases: ["in", "mentions", "notifications"], paletteKey: "page-inbox" } },
  projects: { label: PRODUCT_TERMS.projects, group: "projects", tool: "projects", startEligible: true, action: { id: "navigation.projects", group: "navigation", description: "Project directory.", aliases: ["p", "proj", "projects"], paletteKey: "page-projects" } },
  project: { label: "Project", group: "projects", tool: "projects", parent: "projects", projectContext: true },
  board: { label: "Boards", group: "projects", tool: "boards", parent: "project", projectContext: true, startEligible: true, sidebar: { section: "work", order: 10, icon: "work" }, action: { id: "navigation.boards", group: "navigation", description: "Boards and cards.", aliases: ["board", "kanban"], paletteKey: "page-boards" } },
  whiteboard: { label: "Whiteboards", group: "projects", tool: "whiteboards", parent: "project", projectContext: true, startEligible: true, sidebar: { section: "work", order: 20, icon: "palette" }, action: { id: "navigation.whiteboards", group: "navigation", description: "Visual canvases and diagrams.", aliases: ["whiteboard", "canvas"], paletteKey: "page-whiteboards" } },
  calendar: { label: "Calendar", group: "planning", tool: "calendar", sidebar: { section: "planning", order: 10, icon: "calendar", featureFlag: "calendarEnabled" }, action: { id: "navigation.calendar", group: "navigation", description: "Schedule and recurring commitments.", aliases: ["cal", "schedule"], paletteKey: "page-calendar" } },
  timeline: { label: PRODUCT_TERMS.timeline, group: "planning", tool: "timeline", startEligible: true, sidebar: { section: "planning", order: 20, icon: "timeline", featureFlag: "timelineEnabled" }, action: { id: "navigation.timeline", group: "navigation", description: "Roadmap and milestones.", aliases: ["tl", "roadmap"], paletteKey: "page-timeline" } },
  builds: { label: PRODUCT_TERMS.builds, group: "projects", tool: "builds", startEligible: true, projectContext: true },
  qa: { label: PRODUCT_TERMS.qa, group: "projects", tool: "qa", startEligible: true, projectContext: true },
  tickets: { label: PRODUCT_TERMS.tickets, group: "work", tool: "tickets", action: { id: "navigation.tickets", group: "navigation", description: "Studio intake, triage, blockers, and tracked work.", aliases: ["t", "issues", "support"], keywords: ["issues", "support"], paletteKey: "page-tickets" } },
  activity: { label: "Activity", group: "control", tool: "activity", adminOnly: true, parent: "admin", action: { id: "navigation.activity", group: "navigation", description: "Studio activity and audit history. The primary admin surface is Operations → Data & Audit.", aliases: ["audit", "history"], paletteKey: "page-activity" } },
  scheduler: { label: PRODUCT_TERMS.scheduler, group: "planning", tool: "scheduler", startEligible: true, sidebar: { section: "planning", order: 40, icon: "clock", featureFlag: "schedulerEnabled" }, action: { id: "navigation.scheduler", group: "navigation", description: "Clock, schedule, activity, and capacity.", aliases: ["time", "scheduler", "clock"], keywords: ["time", "clock"], paletteKey: "page-scheduler" } },
  library: { label: PRODUCT_TERMS.library, group: "library", tool: "library", startEligible: true, sidebar: { section: "library", order: 10, icon: "library", featureFlag: "libraryEnabled" }, action: { id: "navigation.library", group: "navigation", description: "Files and workspace assets.", aliases: ["lib", "files", "assets"], keywords: ["files", "assets", "library"], paletteKey: "page-library" } },
  packets: { label: "Packets", group: "library", tool: "packets", startEligible: true, sidebar: { section: "library", order: 20, icon: "packet", featureFlag: "packetsEnabled" }, action: { id: "navigation.packets", group: "navigation", description: "PDF and video learning collections.", paletteKey: "page-packets" } },
  inventory: { label: "Inventory", group: "library", tool: "inventory", startEligible: true, surface: "standalone-tool", sidebar: { section: "library", order: 30, icon: "inventory" }, action: { id: "navigation.inventory", group: "navigation", description: "Equipment, assigned licenses, asset allocations, and managed key pools.", aliases: ["equipment", "licenses", "assets", "key pools"], paletteKey: "page-inventory" } },
  vault: { label: "Vault", group: "control", tool: "vault", adminOnly: true, surface: "standalone-tool", sidebar: { section: "administration", order: 15, icon: "lock" }, action: { id: "navigation.vault", group: "navigation", description: "Privileged encrypted secrets, reveal, rotation, and revocation.", aliases: ["secrets", "credentials"], paletteKey: "page-vault" } },
  admin: { label: PRODUCT_TERMS.operations, group: "control", adminOnly: true, sidebar: { section: "administration", order: 10, icon: "operations" }, action: { id: "navigation.control-center", group: "navigation", description: "Approvals, health, maintenance, and diagnostics.", aliases: ["ops", "admin", "operations"], keywords: ["admin"], paletteKey: "page-admin" } },
  toolInfrastructure: { label: "Tool Infrastructure", group: "control", adminOnly: true, parent: "admin", sidebar: { section: "administration", order: 20, icon: "tools" }, action: { id: "navigation.tool-infrastructure", group: "navigation", description: "Tool runtime, settings, permissions, source-control infrastructure, and maintenance.", keywords: ["git", "repositories", "source control"], paletteKey: "page-tools" } },
  integrations: { label: "Integrations", group: "control", tool: "integrations", adminOnly: true, parent: "admin", surface: "standalone-tool", sidebar: { section: "administration", order: 30, icon: "bell" }, action: { id: "navigation.integrations", group: "navigation", description: "External services, providers, webhooks, connections, and delivery configuration.", aliases: ["discord", "providers", "webhooks"], keywords: ["discord", "providers", "webhooks", "connections"], paletteKey: "page-integrations" } },
  desktop: { label: "Desktop", group: "system", sidebar: { section: "system", order: 10, icon: "tools", desktopOnly: true }, action: { id: "navigation.desktop", group: "desktop", description: "Transfers, mounted Libraries, diagnostics, and device services.", keywords: ["native", "device", "mount", "clipboard", "transfers"], paletteKey: "page-desktop" } },
  settings: { label: "Settings", group: "system", tool: "settings", action: { id: "navigation.settings", group: "navigation", description: "Personal preferences, privacy, and shortcuts.", aliases: ["prefs", "preferences", "settings"], keywords: ["preferences"], paletteKey: "page-settings" } },
  studioSettings: { label: "Studio Settings", group: "control", tool: "settings", adminOnly: true, parent: "admin", sidebar: { section: "administration", order: 40, icon: "settings" }, action: { id: "navigation.studio-settings", group: "navigation", description: "Branding, defaults, workflows, and publishing.", paletteKey: "page-studio" } },
  serverConfig: { label: "Server Configuration", group: "control", tool: "serverConfig", adminOnly: true, parent: "admin", sidebar: { section: "administration", order: 50, icon: "cloud" }, action: { id: "navigation.server-configuration", group: "navigation", description: "Network, security, storage, backups, and server runtime.", keywords: ["server", "network"], paletteKey: "page-server" } },
  changelog: { label: "Changelog", group: "hidden" },
} as const satisfies Record<string, ClusterAppRouteDefinition>;

export type ClusterAppRouteId = keyof typeof CLUSTER_APP_ROUTE_MANIFEST;
export const CLUSTER_APP_ROUTE_IDS = Object.freeze(Object.keys(CLUSTER_APP_ROUTE_MANIFEST)) as readonly ClusterAppRouteId[];

export function clusterAppRouteDefinition(id: ClusterAppRouteId) {
  return CLUSTER_APP_ROUTE_MANIFEST[id];
}

/** Built-in standalone tools require a corresponding renderer module.
 * The route manifest controls identity, permissions, navigation, and discovery;
 * the renderer registry controls module loading and presentation only.
 */
export type ClusterStandaloneToolRouteId = {
  [K in ClusterAppRouteId]: (typeof CLUSTER_APP_ROUTE_MANIFEST)[K] extends { surface: "standalone-tool" } ? K : never
}[ClusterAppRouteId];
export const CLUSTER_STANDALONE_TOOL_ROUTE_IDS = Object.freeze(
  CLUSTER_APP_ROUTE_IDS.filter((id): id is ClusterStandaloneToolRouteId => {
    const route = CLUSTER_APP_ROUTE_MANIFEST[id];
    return "surface" in route && route.surface === "standalone-tool";
  }),
) as readonly ClusterStandaloneToolRouteId[];

export type ClusterDashboardWidgetGroup = "core" | "projects" | "work" | "communication" | "production" | "tools" | "admin" | "decorative" | "signals";
export type ClusterDashboardWidgetDefinition = {
  label: string;
  detail: string;
  group: ClusterDashboardWidgetGroup;
  lifecycle: ClusterFeatureLifecycle;
  tool?: ClusterToolPermissionKey;
  route?: ClusterAppRouteId;
  adminOnly?: boolean;
  desktopOnly?: boolean;
  configurable?: boolean;
};

/**
 * Canonical built-in Home widget identity catalog.
 *
 * Rendering, sizing, layout, and runtime data stay renderer-owned. Identity,
 * labels, grouping, tool affiliation, and lifecycle live here so Home,
 * Settings, Admin, search/discovery, and future project dashboards do not grow
 * parallel widget vocabularies.
 */
export const CLUSTER_DASHBOARD_WIDGET_MANIFEST = {
  brief: { label: "Priority brief", detail: "Highest-priority signal and immediate action.", group: "core", lifecycle: "active" },
  roleFocus: { label: "My focus", detail: "Assigned work, overdue items, and today's schedule.", group: "core", lifecycle: "active", tool: "mywork" },
  readiness: { label: "Project readiness", detail: "Recent projects, completeness, and setup gaps.", group: "core", lifecycle: "active", tool: "projects" },

  projects: { label: "Project pulse", detail: "Project health, readiness, coverage, and recent delivery state.", group: "projects", lifecycle: "active", tool: "projects" },
  control: { label: "Project controls", detail: "Dependencies, recurring work, and watched records.", group: "projects", lifecycle: "active", tool: "projects" },
  workflow: { label: "Workflow operations", detail: "Recurring work, watchers, and cross-project dependencies.", group: "projects", lifecycle: "active", tool: "projects" },
  closeout: { label: "Closeout", detail: "Archive readiness and external delivery records.", group: "projects", lifecycle: "active", tool: "projects" },
  attachments: { label: "Attachments", detail: "Cross-project files and review state.", group: "projects", lifecycle: "active", tool: "projects" },
  coverage: { label: "Project coverage", detail: "Source Control, Discord, board, and whiteboard coverage.", group: "projects", lifecycle: "active", tool: "projects" },

  myWork: { label: "My Work summary", detail: "Assigned, overdue, and priority work.", group: "work", lifecycle: "active", tool: "mywork" },
  upcoming: { label: "Upcoming work", detail: "Due cards and near-term work.", group: "work", lifecycle: "active", tool: "mywork" },
  scheduler: { label: "Scheduler", detail: "Clock state, weekly time, and today's schedule.", group: "work", lifecycle: "active", tool: "scheduler" },
  today: { label: "Today", detail: "Today's schedule, due work, blockers, and personal execution focus.", group: "work", lifecycle: "active", tool: "mywork" },
  needs: { label: "Needs attention", detail: "Signals that require a decision or follow-up.", group: "work", lifecycle: "active", tool: "inbox" },

  inbox: { label: "Inbox", detail: "Attention and urgent Inbox counts.", group: "communication", lifecycle: "active", tool: "inbox" },
  people: { label: "People", detail: "Active people and availability.", group: "communication", lifecycle: "active", tool: "people" },
  peopleCapacity: { label: "People capacity", detail: "Configured capacity and current assignment pressure across the team.", group: "communication", lifecycle: "active", tool: "people" },
  departments: { label: "Department pulse", detail: "Department coverage and active people distribution.", group: "communication", lifecycle: "active", tool: "people" },
  activity: { label: "Activity", detail: "Recent studio changes.", group: "communication", lifecycle: "active", tool: "activity" },
  digest: { label: "Session digest", detail: "Changes since this workspace was last opened.", group: "communication", lifecycle: "active", tool: "activity" },

  builds: { label: "Build health", detail: "Build readiness, failures, testing state, and approvals.", group: "production", lifecycle: "active", tool: "builds" },
  qa: { label: "QA pulse", detail: "QA plans and active quality work.", group: "production", lifecycle: "active", tool: "qa" },
  releaseReadiness: { label: "Release readiness", detail: "Draft and published releases with QA and approval readiness.", group: "production", lifecycle: "active", tool: "builds" },
  sourceControl: { label: PRODUCT_TERMS.sourceControl, detail: "Repository synchronization, health, branches, and commit activity.", group: "production", lifecycle: "active", tool: "sourceControl" },
  reviewQueue: { label: "Review queue", detail: "Open source reviews, readiness, and decisions across accessible projects.", group: "production", lifecycle: "active", tool: "sourceControl" },
  integrationHealth: { label: "Integration health", detail: "Configured provider health and integration attention across the Studio.", group: "production", lifecycle: "active", tool: "integrations" },
  timeline: { label: PRODUCT_TERMS.timeline, detail: "Upcoming production milestones.", group: "production", lifecycle: "active", tool: "timeline" },
  tickets: { label: PRODUCT_TERMS.tickets, detail: "Ticket and intake signals routed from project work.", group: "production", lifecycle: "active", tool: "tickets" },
  deliveryAttention: { label: "Delivery attention", detail: "Ticket and review attention across projects.", group: "production", lifecycle: "active", tool: "tickets" },

  library: { label: PRODUCT_TERMS.library, detail: "Library item count and storage status.", group: "tools", lifecycle: "active", tool: "library" },
  libraryActivity: { label: "Library activity", detail: "Recent Library changes, pinned items, and active asset types.", group: "tools", lifecycle: "active", tool: "library" },
  watchlists: { label: "Watchlists", detail: "Canonical watched work grouped by scope and project context.", group: "tools", lifecycle: "active", tool: "projects" },
  savedViews: { label: "Saved views", detail: "Reusable personal and Studio views across Cluster workspaces.", group: "tools", lifecycle: "active" },
  quickCapture: { label: "Quick capture", detail: "Start common work through Cluster's canonical Create workflow.", group: "tools", lifecycle: "active" },
  handoff: { label: "Handoff", detail: "Recent changes, attention items, and next work for resuming or transferring context.", group: "tools", lifecycle: "active", tool: "activity" },
  pulse: { label: "Studio pulse", detail: "Compact cross-system operating metrics.", group: "tools", lifecycle: "active" },
  clipboard: { label: "Clipboard", detail: "User-triggered safe clipboard reader for Desktop.", group: "tools", lifecycle: "active", route: "desktop", desktopOnly: true },

  opsHealth: { label: "Operations health", detail: "Maintenance queue and operating diagnostics.", group: "admin", lifecycle: "active", route: "admin", adminOnly: true },
  adminOverview: { label: "Admin overview", detail: "Studio setup gaps and policy-facing counts.", group: "admin", lifecycle: "active", route: "admin", adminOnly: true },
  adminHealth: { label: "Admin health", detail: "Maintenance, correction, and workflow exception counts.", group: "admin", lifecycle: "active", route: "admin", adminOnly: true },

  clock: { label: "Clock", detail: "Local time and date.", group: "decorative", lifecycle: "active" },
  note: { label: "Editable note", detail: "A small personal text block stored with your user state.", group: "decorative", lifecycle: "active", configurable: true },
} as const satisfies Record<string, ClusterDashboardWidgetDefinition>;

export type ClusterDashboardWidgetKey = keyof typeof CLUSTER_DASHBOARD_WIDGET_MANIFEST;
export const CLUSTER_DASHBOARD_WIDGET_KEYS = Object.freeze(Object.keys(CLUSTER_DASHBOARD_WIDGET_MANIFEST)) as readonly ClusterDashboardWidgetKey[];

export const CLUSTER_DASHBOARD_WIDGET_GROUPS = [
  { key: "core", label: "Core", detail: "Primary Home context" },
  { key: "projects", label: "Projects", detail: "Project planning and delivery" },
  { key: "work", label: "My work", detail: "Personal execution and schedule" },
  { key: "communication", label: "Communication", detail: "Inbox, people, and activity" },
  { key: "production", label: "Production", detail: "Builds, QA, Timeline, Tickets, and delivery attention" },
  { key: "tools", label: "Tools", detail: "Library and Desktop utilities" },
  { key: "admin", label: "Admin", detail: "Administrator-only operating widgets" },
  { key: "decorative", label: "Utility", detail: "Clock and personal notes" },
] as const satisfies readonly { key: ClusterDashboardWidgetGroup; label: string; detail: string }[];

export function clusterDashboardWidgetDefinition(id: ClusterDashboardWidgetKey) {
  return CLUSTER_DASHBOARD_WIDGET_MANIFEST[id];
}

export const CLUSTER_HOME_WIDGET_EXTENSION_TOOL_IDS = [
  "projects", "boards", "whiteboards", "scheduler", "activity", "inbox", "people",
  "builds", "qa", "tickets", "calendar", "library", "packets", "sourceControl", "integrations", "viewer",
  "serverConfig",
] as const satisfies readonly ClusterToolPermissionKey[];
export type ClusterHomeWidgetExtensionToolId = (typeof CLUSTER_HOME_WIDGET_EXTENSION_TOOL_IDS)[number];
export type ClusterHomeWidgetPermission = `${ClusterHomeWidgetExtensionToolId}.read`;
export const CLUSTER_HOME_WIDGET_PERMISSIONS = Object.freeze(
  CLUSTER_HOME_WIDGET_EXTENSION_TOOL_IDS.map((id) => `${id}.read` as ClusterHomeWidgetPermission),
) as readonly ClusterHomeWidgetPermission[];

/**
 * Retired architectural identities.
 *
 * These lists are intentionally scoped by identity surface. Generic words such
 * as `team`, `time`, and `files` remain valid product concepts; they are only
 * forbidden where they previously acted as canonical IDs. Certification uses
 * these contracts to prevent compatibility aliases from silently returning.
 */
export const CLUSTER_RETIRED_IDENTIFIERS = {
  appRoutes: ["reports", "profiles", "notifications"],
  toolPermissions: ["canvas", "files", "reports", "notifications", "time", "team"],
  createModes: ["report", "sprint", "time"],
  projectTools: ["issues", "team"],
  dashboardWidgets: ["reports", "notifications"],
  searchScopes: ["time"],
  serverCompositionModules: ["server-routes-git-discord"],
} as const;

export type ClusterRetiredIdentifierSurface = keyof typeof CLUSTER_RETIRED_IDENTIFIERS;

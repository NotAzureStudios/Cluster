import { CLUSTER_DASHBOARD_WIDGET_GROUPS, CLUSTER_DASHBOARD_WIDGET_KEYS, CLUSTER_DASHBOARD_WIDGET_MANIFEST, CLUSTER_HOME_WIDGET_PERMISSIONS, clusterAppRouteDefinition, clusterToolPermissionDefinition, type ClusterHomeWidgetPermission, type ClusterToolPermissionKey } from "@cluster/shared";
import type { DashboardWidgetDefinition, DashboardWidgetKey } from "../application/application-models";

export type HomeWidgetSize = "micro" | "compact" | "standard" | "wide" | "large" | "feature";
export type HomeWidgetPresentation = "compact" | "standard" | "detailed";
export function homeWidgetPresentationForSize(size: HomeWidgetSize): HomeWidgetPresentation {
  if (size === "micro" || size === "compact") return "compact";
  if (size === "large" || size === "feature") return "detailed";
  return "standard";
}
export type HomeWidgetClockFormat = "time" | "date" | "datetime";
export type HomeWidgetMobileLayout = "stack" | "grid" | "carousel" | "focus";
export type HomeWidgetContextMode = "studio" | "current-project" | "project" | "me" | "my-role" | "user" | "role";
export type HomeWidgetTimeRange = "all" | "today" | "7d" | "30d" | "90d";
export type HomeWidgetDetailLevel = "compact" | "standard" | "detailed";
export type HomeWidgetConfig = {
  listLimit?: number;
  showActions?: boolean;
  clockFormat?: HomeWidgetClockFormat;
  noteTitle?: string;
  context?: HomeWidgetContextMode;
  contextId?: string;
  timeRange?: HomeWidgetTimeRange;
  filterText?: string;
  detailLevel?: HomeWidgetDetailLevel;
  savedViewId?: string;
};
export type HomeWidgetConfigCapability = "listLimit" | "actions" | "clockFormat" | "noteTitle" | "context" | "timeRange" | "filter" | "detailLevel" | "savedView";
export type HomeWidgetRuntimeStatus = { state: "loading" | "ready" | "error"; error?: string; onRetry?: () => void };

export type HomeWidgetLayoutItem = {
  id: string;
  enabled: boolean;
  order: number;
  size: HomeWidgetSize;
  column: number;
  source: "builtin" | "custom";
  config?: HomeWidgetConfig;
};

export type HomeWidgetLayoutState = {
  schema: 2;
  items: HomeWidgetLayoutItem[];
};

export type HomeWidgetLayoutProfile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layout: HomeWidgetLayoutState;
};

export type HomeWidgetLayoutProfileState = {
  schema: 2;
  profiles: HomeWidgetLayoutProfile[];
};

export type HomeWidgetProfileExportBundle = {
  kind: "cluster-home-layout-profiles";
  schema: 2;
  exportedAt: string;
  profiles: HomeWidgetLayoutProfile[];
};

export type HomeWidgetRoleRecommendation = {
  id: string;
  label?: string;
  departmentId?: string;
  homeRecommendedWidgetsCsv?: string;
  enabled?: boolean;
};

export type HomeWidgetDepartmentRecommendation = {
  id: string;
  label?: string;
  homeRecommendedWidgetsCsv?: string;
  enabled?: boolean;
};

export type StudioHomeLayoutTemplate = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  layout: HomeWidgetLayoutState;
};

export type SharedHomeLayoutProfile = {
  id: string;
  name: string;
  ownerUserId: string;
  ownerLabel: string;
  createdAt: string;
  updatedAt: string;
  layout: HomeWidgetLayoutState;
};

export type HomeLayoutSharingState = {
  schema: 2;
  templates: StudioHomeLayoutTemplate[];
  sharedProfiles: SharedHomeLayoutProfile[];
};

export type HomeWidgetGovernance = {
  required: DashboardWidgetKey[];
  unavailable: DashboardWidgetKey[];
  recommended: DashboardWidgetKey[];
};

export type HomeWidgetPermission = ClusterHomeWidgetPermission;
export const HOME_WIDGET_PERMISSIONS: HomeWidgetPermission[] = [...CLUSTER_HOME_WIDGET_PERMISSIONS];
export type HomeWidgetMetricBinding =
  | "projects.total" | "projects.ready" | "projects.needsAttention"
  | "boards.total" | "cards.open" | "cards.assigned"
  | "whiteboards.total"
  | "scheduler.weekMinutes" | "scheduler.running"
  | "activity.recent"
  | "inbox.attention" | "inbox.urgent"
  | "people.total" | "people.active" | "people.capacityPressure"
  | "builds.total" | "builds.failed"
  | "qa.total" | "qa.failed" | "qa.blocked"
  | "tickets.open" | "tickets.priority"
  | "calendar.upcoming"
  | "library.total" | "library.pinned"
  | "packets.required" | "packets.overdue"
  | "automation.recurring"
  | "source.repositories" | "source.reviews"
  | "delivery.ready" | "delivery.blocked"
  | "operations.attention" | "operations.security";
export type HomeWidgetListBinding =
  | "projects.recent" | "boards.assignedCards" | "whiteboards.recent"
  | "activity.recentItems" | "people.activePeople"
  | "builds.recent" | "qa.active" | "tickets.openItems" | "calendar.upcomingItems" | "library.recent"
  | "packets.requiredItems" | "automation.recurringItems" | "source.repositoriesItems" | "source.reviewItems" | "operations.attentionItems";

export type HomeWidgetExtensionPolicyMode = "allow" | "curated-only" | "disabled";
export type HomeWidgetExtensionPolicy = {
  mode: HomeWidgetExtensionPolicyMode;
  allowedPermissions: HomeWidgetPermission[];
  blockedIds: string[];
};

export type CustomHomeWidgetBlock =
  | { type: "text"; text: string }
  | { type: "metric"; label: string; binding: HomeWidgetMetricBinding }
  | { type: "list"; label?: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "clock"; label?: string; format?: "time" | "date" | "datetime" }
  | { type: "status"; label: string; binding: HomeWidgetMetricBinding; goodAt?: number; warningAt?: number }
  | { type: "trend"; label: string; binding: HomeWidgetMetricBinding; direction?: "up-good" | "down-good" | "neutral" }
  | { type: "progress"; label: string; value: HomeWidgetMetricBinding; total: HomeWidgetMetricBinding }
  | { type: "queue"; label?: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "people"; label?: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "action"; label: string; target: "projects" | "boards" | "whiteboards" | "mywork" | "calendar" | "packets" | "sourceControl" | "operations" }
  | { type: "timeline"; label?: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "resource"; label?: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "matrix"; label: string; bindings: HomeWidgetMetricBinding[] }
  | { type: "dataView"; label: string; binding: HomeWidgetListBinding; limit?: number }
  | { type: "operation"; label: string; binding: HomeWidgetMetricBinding; detailBinding?: HomeWidgetListBinding };

export type HomeWidgetGalleryMetadata = { category: string; tags: string[]; introducedIn: string };
export type HomeWidgetProvenance = {
  origin: "desktop-library";
  installedAt?: string;
  updatedAt?: string;
  digest?: string;
  sourceLabel?: string;
};

export type CustomHomeWidgetManifest = {
  schema: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  runtime: "declarative-v1";
  defaultSize?: HomeWidgetSize;
  minSize?: HomeWidgetSize;
  permissions?: HomeWidgetPermission[];
  content?: { blocks: CustomHomeWidgetBlock[] };
  publisher?: string;
  minimumClusterVersion?: string;
  provenance?: HomeWidgetProvenance;
  gallery?: HomeWidgetGalleryMetadata;
};

export const CURATED_HOME_WIDGET_GALLERY: CustomHomeWidgetManifest[] = [
  {
    schema: 1, id: "gallery.project-focus", name: "Project focus", version: "1.1.0", runtime: "declarative-v1",
    gallery: { category: "Projects", tags: ["projects", "readiness", "delivery"], introducedIn: "0.487.0" },
    description: "Ready-vs-attention project pulse with the most recent projects.", defaultSize: "wide",
    permissions: ["projects.read"], content: { blocks: [
      { type: "metric", label: "Ready", binding: "projects.ready" },
      { type: "metric", label: "Needs attention", binding: "projects.needsAttention" },
      { type: "list", label: "Recent projects", binding: "projects.recent", limit: 4 },
    ] },
  },
  {
    schema: 1, id: "gallery.team-now", name: "People now", version: "1.1.0", runtime: "declarative-v1",
    gallery: { category: "People", tags: ["team", "presence", "availability"], introducedIn: "0.487.0" },
    description: "Active people and current team availability without opening People.", defaultSize: "standard",
    permissions: ["people.read"], content: { blocks: [
      { type: "metric", label: "Active", binding: "people.active" },
      { type: "metric", label: "People", binding: "people.total" },
      { type: "list", label: "Available now", binding: "people.activePeople", limit: 4 },
    ] },
  },
  {
    schema: 1, id: "gallery.inbox-focus", name: "Inbox focus", version: "1.1.0", runtime: "declarative-v1",
    gallery: { category: "Communication", tags: ["inbox", "urgent", "inbox"], introducedIn: "0.487.0" },
    description: "Attention and urgent notification counts in a minimal card.", defaultSize: "compact",
    permissions: ["inbox.read"], content: { blocks: [
      { type: "metric", label: "Attention", binding: "inbox.attention" },
      { type: "metric", label: "Urgent", binding: "inbox.urgent" },
    ] },
  },
  {
    schema: 1, id: "gallery.workday", name: "Workday", version: "1.1.0", runtime: "declarative-v1",
    gallery: { category: "Work", tags: ["time", "clock", "workday"], introducedIn: "0.487.0" },
    description: "Clock, running timers, and this week's tracked time.", defaultSize: "standard",
    permissions: ["scheduler.read"], content: { blocks: [
      { type: "clock", label: "Local time", format: "datetime" },
      { type: "metric", label: "Week minutes", binding: "scheduler.weekMinutes" },
      { type: "metric", label: "Running", binding: "scheduler.running" },
    ] },
  },
  {
    schema: 1, id: "gallery.build-watch", name: "Build watch", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Production", tags: ["builds", "artifacts", "delivery"], introducedIn: "0.494.0" },
    description: "Recent build artifacts with failure pressure visible at a glance.", defaultSize: "wide",
    permissions: ["builds.read"], content: { blocks: [
      { type: "metric", label: "Artifacts", binding: "builds.total" },
      { type: "metric", label: "Failed QA", binding: "builds.failed" },
      { type: "list", label: "Recent builds", binding: "builds.recent", limit: 4 },
    ] },
  },
  {
    schema: 1, id: "gallery.qa-watch", name: "QA watch", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Production", tags: ["qa", "testing", "quality"], introducedIn: "0.494.0" },
    description: "Open quality work, failures, and blocked plans without opening QA.", defaultSize: "wide",
    permissions: ["qa.read"], content: { blocks: [
      { type: "metric", label: "Plans", binding: "qa.total" },
      { type: "metric", label: "Failed", binding: "qa.failed" },
      { type: "metric", label: "Blocked", binding: "qa.blocked" },
      { type: "list", label: "Active QA", binding: "qa.active", limit: 4 },
    ] },
  },
  {
    schema: 1, id: "gallery.ticket-queue", name: "Ticket queue", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Work", tags: ["tickets", "intake", "priority"], introducedIn: "0.494.0" },
    description: "Open ticket volume and priority work in a compact intake surface.", defaultSize: "wide",
    permissions: ["tickets.read"], content: { blocks: [
      { type: "metric", label: "Open", binding: "tickets.open" },
      { type: "metric", label: "Priority", binding: "tickets.priority" },
      { type: "list", label: "Queue", binding: "tickets.openItems", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.up-next", name: "Up next", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Planning", tags: ["calendar", "schedule", "upcoming"], introducedIn: "0.494.0" },
    description: "Near-term calendar events and deadlines for the current work window.", defaultSize: "wide",
    permissions: ["calendar.read"], content: { blocks: [
      { type: "metric", label: "Upcoming", binding: "calendar.upcoming" },
      { type: "list", label: "Next events", binding: "calendar.upcomingItems", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.knowledge", name: "Library pulse", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Library", tags: ["library", "docs", "pinned"], introducedIn: "0.494.0" },
    description: "Library volume, pinned items, and recent reference material.", defaultSize: "wide",
    permissions: ["library.read"], content: { blocks: [
      { type: "metric", label: "Items", binding: "library.total" },
      { type: "metric", label: "Pinned", binding: "library.pinned" },
      { type: "list", label: "Recent Library items", binding: "library.recent", limit: 4 },
    ] },
  },
  {
    schema: 1, id: "gallery.board-load", name: "Board load", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Boards", tags: ["boards", "cards", "workload"], introducedIn: "0.504.0" },
    description: "Board and card workload with assigned work surfaced first.", defaultSize: "wide",
    permissions: ["boards.read"], content: { blocks: [
      { type: "metric", label: "Boards", binding: "boards.total" },
      { type: "metric", label: "Open cards", binding: "cards.open" },
      { type: "metric", label: "Assigned", binding: "cards.assigned" },
      { type: "queue", label: "Assigned cards", binding: "boards.assignedCards", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.whiteboard-radar", name: "Whiteboard radar", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Whiteboards", tags: ["whiteboards", "collaboration", "recent"], introducedIn: "0.504.0" },
    description: "Recent collaborative canvases and overall Whiteboard coverage.", defaultSize: "wide",
    permissions: ["whiteboards.read"], content: { blocks: [
      { type: "status", label: "Whiteboards", binding: "whiteboards.total", goodAt: 1 },
      { type: "resource", label: "Recent boards", binding: "whiteboards.recent", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.training-due", name: "Training due", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Knowledge", tags: ["packets", "training", "compliance"], introducedIn: "0.504.0" },
    description: "Required knowledge, overdue training, and the next items that need attention.", defaultSize: "wide",
    permissions: ["packets.read"], content: { blocks: [
      { type: "metric", label: "Required", binding: "packets.required" },
      { type: "status", label: "Overdue", binding: "packets.overdue", goodAt: 0, warningAt: 1 },
      { type: "queue", label: "Required knowledge", binding: "packets.requiredItems", limit: 5 },
      { type: "action", label: "Open Knowledge", target: "packets" },
    ] },
  },
  {
    schema: 1, id: "gallery.automation-watch", name: "Automation watch", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Automation", tags: ["automation", "recurring", "workflow"], introducedIn: "0.504.0" },
    description: "Recurring workflow pressure and the next automated responsibilities.", defaultSize: "wide",
    permissions: ["projects.read"], content: { blocks: [
      { type: "metric", label: "Recurring", binding: "automation.recurring" },
      { type: "timeline", label: "Automation schedule", binding: "automation.recurringItems", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.review-lane", name: "Review lane", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Source", tags: ["source", "reviews", "git"], introducedIn: "0.504.0" },
    description: "Repository and source-review pressure for the current delivery window.", defaultSize: "wide",
    permissions: ["sourceControl.read"], content: { blocks: [
      { type: "metric", label: "Repositories", binding: "source.repositories" },
      { type: "metric", label: "Reviews", binding: "source.reviews" },
      { type: "queue", label: "Review queue", binding: "source.reviewItems", limit: 5 },
      { type: "action", label: "Open Projects", target: "sourceControl" },
    ] },
  },
  {
    schema: 1, id: "gallery.repo-radar", name: "Repository radar", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Source", tags: ["repositories", "source", "git"], introducedIn: "0.504.0" },
    description: "Repository inventory and recent source-control context.", defaultSize: "wide",
    permissions: ["sourceControl.read"], content: { blocks: [
      { type: "dataView", label: "Repositories", binding: "source.repositoriesItems", limit: 6 },
      { type: "action", label: "Open Projects", target: "sourceControl" },
    ] },
  },
  {
    schema: 1, id: "gallery.delivery-readiness", name: "Delivery readiness", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Delivery", tags: ["release", "delivery", "readiness"], introducedIn: "0.504.0" },
    description: "Ready versus blocked delivery state for the current portfolio.", defaultSize: "standard",
    permissions: ["builds.read"], content: { blocks: [
      { type: "progress", label: "Ready", value: "delivery.ready", total: "builds.total" },
      { type: "status", label: "Blocked", binding: "delivery.blocked", goodAt: 0, warningAt: 1 },
    ] },
  },
  {
    schema: 1, id: "gallery.operations-attention", name: "Operations attention", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Operations", tags: ["operations", "health", "admin"], introducedIn: "0.504.0" },
    description: "Operational exceptions and the highest-priority system attention queue.", defaultSize: "wide",
    permissions: ["serverConfig.read"], content: { blocks: [
      { type: "status", label: "Attention", binding: "operations.attention", goodAt: 0, warningAt: 1 },
      { type: "queue", label: "Needs attention", binding: "operations.attentionItems", limit: 5 },
      { type: "action", label: "Open Operations", target: "operations" },
    ] },
  },
  {
    schema: 1, id: "gallery.security-posture", name: "Security posture", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Operations", tags: ["security", "posture", "admin"], introducedIn: "0.504.0" },
    description: "Security findings summarized without exposing raw evidence in Home.", defaultSize: "standard",
    permissions: ["serverConfig.read"], content: { blocks: [
      { type: "status", label: "Security attention", binding: "operations.security", goodAt: 0, warningAt: 1 },
      { type: "action", label: "Open Security Center", target: "operations" },
    ] },
  },
  {
    schema: 1, id: "gallery.capacity-pressure", name: "Capacity pressure", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "People", tags: ["capacity", "availability", "people"], introducedIn: "0.504.0" },
    description: "Capacity pressure with the people currently available to help.", defaultSize: "wide",
    permissions: ["people.read"], content: { blocks: [
      { type: "trend", label: "Capacity pressure", binding: "people.capacityPressure", direction: "down-good" },
      { type: "people", label: "Available people", binding: "people.activePeople", limit: 5 },
    ] },
  },
  {
    schema: 1, id: "gallery.production-radar", name: "Production radar", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Production", tags: ["builds", "qa", "tickets", "delivery"], introducedIn: "0.504.0" },
    description: "A compact state matrix across delivery, QA, and ticket pressure.", defaultSize: "feature",
    permissions: ["builds.read", "qa.read", "tickets.read"], content: { blocks: [
      { type: "matrix", label: "Production state", bindings: ["builds.failed", "qa.failed", "qa.blocked", "tickets.priority"] },
      { type: "status", label: "Delivery blocked", binding: "delivery.blocked", goodAt: 0, warningAt: 1 },
    ] },
  },
  {
    schema: 1, id: "gallery.studio-radar", name: "Studio radar", version: "1.0.0", runtime: "declarative-v1",
    gallery: { category: "Studio", tags: ["studio", "portfolio", "attention"], introducedIn: "0.504.0" },
    description: "High-level portfolio, communication, and operational pressure in one glance.", defaultSize: "feature",
    permissions: ["projects.read", "inbox.read", "serverConfig.read"], content: { blocks: [
      { type: "matrix", label: "Studio state", bindings: ["projects.needsAttention", "inbox.attention", "operations.attention", "operations.security"] },
      { type: "operation", label: "Operations", binding: "operations.attention", detailBinding: "operations.attentionItems" },
    ] },
  },
];

export const DASHBOARD_WIDGET_GROUPS = CLUSTER_DASHBOARD_WIDGET_GROUPS;

export const CORE_DASHBOARD_KEYS: DashboardWidgetKey[] = ["brief", "roleFocus", "readiness"];
export const DEFAULT_HOME_WIDGET_KEYS: DashboardWidgetKey[] = ["brief", "roleFocus", "readiness", "myWork", "upcoming", "builds", "inbox", "people", "scheduler", "activity", "clock"];
export const TOOL_WORKSPACE_WIDGET_KEYS: DashboardWidgetKey[] = ["projects", "control", "workflow", "closeout", "attachments", "coverage", "myWork", "scheduler", "inbox", "people", "departments", "builds", "qa", "timeline", "tickets", "deliveryAttention", "library", "activity", "digest", "pulse", "clipboard"];

export const HOME_WIDGET_SIZE_OPTIONS: Array<{ value: HomeWidgetSize; label: string }> = [
  { value: "micro", label: "Micro" },
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "wide", label: "Wide" },
  { value: "large", label: "Large" },
  { value: "feature", label: "Feature" },
];

export type HomeWidgetPreset = "balanced" | "quiet" | "core-tools" | "everything";
export type HomeWidgetInteractionMode = "navigate" | "embedded" | "edit";
export type HomeWidgetContextCapability = "studio" | "project" | "role" | "user";
export type HomeWidgetRegistryEntry = DashboardWidgetDefinition & {
  defaultSize: HomeWidgetSize;
  supportedSizes: HomeWidgetSize[];
  interaction: HomeWidgetInteractionMode;
  permissions: HomeWidgetPermission[];
  configuration: HomeWidgetConfigCapability[];
  contexts: HomeWidgetContextCapability[];
  navigation?: "projects" | "mywork" | "scheduler" | "inbox" | "people" | "library" | "builds" | "qa" | "timeline" | "tickets" | "activity" | "admin" | "sourceControl" | "desktop";
  renderer: string;
  dataAdapter: string;
  presets: HomeWidgetPreset[];
};

const HOME_WIDGET_ALL_SIZES = HOME_WIDGET_SIZE_OPTIONS.map((option) => option.value);
const HOME_WIDGET_WIDE_DEFAULTS = new Set<DashboardWidgetKey>(["brief", "roleFocus", "readiness", "projects", "control", "workflow", "closeout", "coverage"]);
const LIST_CONFIGURABLE_WIDGETS = new Set<DashboardWidgetKey>([
  "roleFocus", "readiness", "needs", "upcoming", "activity", "digest", "projects", "myWork", "today",
  "scheduler", "people", "peopleCapacity", "departments", "builds", "timeline", "qa", "tickets", "library",
  "libraryActivity", "reviewQueue", "sourceControl", "integrationHealth", "watchlists", "savedViews", "handoff",
]);
const ACTION_CONFIGURABLE_WIDGETS = new Set<DashboardWidgetKey>([
  "brief", "roleFocus", "readiness", "upcoming", "activity", "digest", "projects", "control",
  "workflow", "closeout", "attachments", "myWork", "today", "scheduler", "inbox", "people", "peopleCapacity", "departments", "library", "libraryActivity", "pulse",
  "builds", "qa", "timeline", "tickets", "deliveryAttention", "releaseReadiness", "sourceControl", "reviewQueue", "integrationHealth", "watchlists", "handoff", "opsHealth", "adminOverview", "adminHealth",
]);
const CONTEXTUAL_WIDGETS = new Set<DashboardWidgetKey>([
  "roleFocus", "readiness", "projects", "control", "workflow", "closeout", "attachments", "coverage", "myWork", "upcoming", "today", "scheduler", "people", "peopleCapacity", "departments",
  "builds", "qa", "releaseReadiness", "sourceControl", "reviewQueue", "timeline", "tickets", "deliveryAttention", "library", "libraryActivity", "watchlists", "savedViews", "handoff",
]);
const TIME_RANGE_WIDGETS = new Set<DashboardWidgetKey>(["roleFocus", "projects", "myWork", "upcoming", "today", "scheduler", "activity", "digest", "builds", "qa", "timeline", "tickets", "libraryActivity", "handoff", "sourceControl", "reviewQueue"]);
const FILTER_WIDGETS = new Set<DashboardWidgetKey>(["projects", "myWork", "upcoming", "people", "peopleCapacity", "departments", "builds", "qa", "timeline", "tickets", "library", "libraryActivity", "reviewQueue", "sourceControl", "savedViews", "watchlists"]);
const SAVED_VIEW_WIDGETS = new Set<DashboardWidgetKey>(["projects", "myWork", "builds", "qa", "timeline", "tickets", "library", "savedViews"]);

function descriptorConfiguration(key: DashboardWidgetKey): HomeWidgetConfigCapability[] {
  const capabilities: HomeWidgetConfigCapability[] = [];
  if (LIST_CONFIGURABLE_WIDGETS.has(key)) capabilities.push("listLimit");
  if (ACTION_CONFIGURABLE_WIDGETS.has(key)) capabilities.push("actions");
  if (key === "clock") capabilities.push("clockFormat");
  if (key === "note") capabilities.push("noteTitle");
  if (CONTEXTUAL_WIDGETS.has(key)) capabilities.push("context");
  if (TIME_RANGE_WIDGETS.has(key)) capabilities.push("timeRange");
  if (FILTER_WIDGETS.has(key)) capabilities.push("filter");
  if (key !== "clock" && key !== "note" && key !== "clipboard") capabilities.push("detailLevel");
  if (SAVED_VIEW_WIDGETS.has(key)) capabilities.push("savedView");
  return capabilities;
}

function descriptorPermissions(key: DashboardWidgetKey): HomeWidgetPermission[] {
  const definition = CLUSTER_DASHBOARD_WIDGET_MANIFEST[key];
  if (!("tool" in definition) || !definition.tool) return [];
  const permission = `${definition.tool}.read` as HomeWidgetPermission;
  return HOME_WIDGET_PERMISSIONS.includes(permission) ? [permission] : [];
}

function descriptorNavigation(key: DashboardWidgetKey): HomeWidgetRegistryEntry["navigation"] {
  if (["readiness", "projects", "control", "workflow", "closeout", "attachments", "coverage", "watchlists"].includes(key)) return "projects";
  if (["roleFocus", "myWork", "today", "upcoming"].includes(key)) return "mywork";
  if (["scheduler", "pulse", "clock"].includes(key)) return "scheduler";
  if (["needs", "inbox"].includes(key)) return "inbox";
  if (["people", "peopleCapacity", "departments"].includes(key)) return "people";
  if (["library", "libraryActivity"].includes(key)) return "library";
  if (["builds", "releaseReadiness"].includes(key)) return "builds";
  if (key === "qa") return "qa";
  if (key === "timeline") return "timeline";
  if (["tickets", "deliveryAttention"].includes(key)) return "tickets";
  if (["activity", "digest", "handoff"].includes(key)) return "activity";
  if (["sourceControl", "reviewQueue", "integrationHealth"].includes(key)) return "sourceControl";
  if (["opsHealth", "adminOverview", "adminHealth"].includes(key)) return "admin";
  if (key === "clipboard") return "desktop";
  return undefined;
}

/** Canonical Widget 2.1 descriptor authority. All built-in catalog/runtime projections derive from this registry. */
export const HOME_WIDGET_REGISTRY: HomeWidgetRegistryEntry[] = CLUSTER_DASHBOARD_WIDGET_KEYS.map((key) => {
  const definition = CLUSTER_DASHBOARD_WIDGET_MANIFEST[key];
  const tool = "tool" in definition
    ? clusterToolPermissionDefinition(definition.tool as ClusterToolPermissionKey).label
    : "route" in definition
      ? clusterAppRouteDefinition(definition.route).label
      : undefined;
  return {
    key,
    label: definition.label,
    detail: definition.detail,
    group: definition.group,
    tool,
    adminOnly: "adminOnly" in definition ? definition.adminOnly : undefined,
    desktopOnly: "desktopOnly" in definition ? definition.desktopOnly : undefined,
    configurable: descriptorConfiguration(key).length > 0 || ("configurable" in definition ? definition.configurable : undefined),
    defaultSize: key === "clock" ? "micro" : key === "note" || key === "clipboard" ? "standard" : HOME_WIDGET_WIDE_DEFAULTS.has(key) ? "wide" : "standard",
    supportedSizes: [...HOME_WIDGET_ALL_SIZES],
    interaction: key === "note" ? "edit" : key === "clipboard" ? "embedded" : "navigate",
    permissions: descriptorPermissions(key),
    configuration: descriptorConfiguration(key),
    contexts: CONTEXTUAL_WIDGETS.has(key) ? ["studio", "project", "role", "user"] : ["studio"],
    navigation: descriptorNavigation(key),
    renderer: key,
    dataAdapter: key,
    presets: ["balanced", "core-tools", "everything"],
  };
});

/** Current compact widget-definition projection used by Settings and Home controls. */
export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = HOME_WIDGET_REGISTRY.map(({ key, label, detail, group, tool, adminOnly, desktopOnly, configurable }) => ({ key, label, detail, group, tool, adminOnly, desktopOnly, configurable }));
export const RESIZABLE_HOME_WIDGET_KEYS: DashboardWidgetKey[] = HOME_WIDGET_REGISTRY.map((item) => item.key);

export function homeWidgetRegistryEntry(id: string) {
  return HOME_WIDGET_REGISTRY.find((entry) => entry.key === id);
}

export function homeWidgetConfigurationCapabilities(id: string): HomeWidgetConfigCapability[] {
  const builtin = homeWidgetRegistryEntry(id);
  if (builtin) return [...builtin.configuration];
  return ["listLimit", "actions", "context", "timeRange", "filter", "detailLevel", "savedView"];
}

export function normalizeHomeWidgetConfig(id: string, value: unknown): HomeWidgetConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const capabilities = new Set(homeWidgetConfigurationCapabilities(id));
  if (!capabilities.size) return undefined;
  const config: HomeWidgetConfig = {};
  if (capabilities.has("listLimit") && raw.listLimit !== undefined) {
    const limit = Number(raw.listLimit);
    if (Number.isInteger(limit) && limit >= 1 && limit <= 12) config.listLimit = limit;
  }
  if (capabilities.has("actions") && typeof raw.showActions === "boolean") config.showActions = raw.showActions;
  if (capabilities.has("clockFormat") && ["time", "date", "datetime"].includes(String(raw.clockFormat))) config.clockFormat = raw.clockFormat as HomeWidgetClockFormat;
  if (capabilities.has("noteTitle") && typeof raw.noteTitle === "string") {
    const title = raw.noteTitle.trim().slice(0, 48);
    if (title) config.noteTitle = title;
  }
  if (capabilities.has("context") && ["studio", "current-project", "project", "me", "my-role", "user", "role"].includes(String(raw.context))) config.context = raw.context as HomeWidgetContextMode;
  if (capabilities.has("context") && typeof raw.contextId === "string") { const value = raw.contextId.trim().slice(0, 120); if (value) config.contextId = value; }
  if (capabilities.has("timeRange") && ["all", "today", "7d", "30d", "90d"].includes(String(raw.timeRange))) config.timeRange = raw.timeRange as HomeWidgetTimeRange;
  if (capabilities.has("filter") && typeof raw.filterText === "string") { const value = raw.filterText.trim().slice(0, 120); if (value) config.filterText = value; }
  if (capabilities.has("detailLevel") && ["compact", "standard", "detailed"].includes(String(raw.detailLevel))) config.detailLevel = raw.detailLevel as HomeWidgetDetailLevel;
  if (capabilities.has("savedView") && typeof raw.savedViewId === "string") { const value = raw.savedViewId.trim().slice(0, 160); if (value) config.savedViewId = value; }
  return Object.keys(config).length ? config : undefined;
}

const HOME_WIDGET_SIZE_RANK: Record<HomeWidgetSize, number> = { micro: 0, compact: 1, standard: 2, wide: 3, large: 4, feature: 5 };

export function homeWidgetSizeMeetsMinimum(size: HomeWidgetSize, minimum?: HomeWidgetSize) {
  return !minimum || HOME_WIDGET_SIZE_RANK[size] >= HOME_WIDGET_SIZE_RANK[minimum];
}

export function constrainHomeWidgetSize(size: HomeWidgetSize, minimum?: HomeWidgetSize): HomeWidgetSize {
  return homeWidgetSizeMeetsMinimum(size, minimum) ? size : (minimum || size);
}

const DEFAULT_SIZE: Record<DashboardWidgetKey, HomeWidgetSize> = Object.fromEntries(
  HOME_WIDGET_REGISTRY.map((item) => [item.key, item.defaultSize]),
) as Record<DashboardWidgetKey, HomeWidgetSize>;

export const HOME_WIDGET_LAYOUT_COLUMNS = 20;
export const HOME_WIDGET_BASE_COLUMNS = 12;

export const HOME_WIDGET_COLUMN_SPAN: Record<HomeWidgetSize, number> = {
  micro: 2,
  compact: 3,
  standard: 4,
  wide: 6,
  large: 6,
  feature: HOME_WIDGET_BASE_COLUMNS,
};

export function homeWidgetColumnSpan(size: HomeWidgetSize) {
  return HOME_WIDGET_COLUMN_SPAN[size];
}

export function clampHomeWidgetColumn(column: number, size: HomeWidgetSize, columns = HOME_WIDGET_LAYOUT_COLUMNS) {
  const span = Math.min(homeWidgetColumnSpan(size), columns);
  return Math.max(1, Math.min(Math.max(1, columns - span + 1), Math.trunc(Number(column) || 1)));
}

function defaultHomeWidgetColumns() {
  const columns = new Map<string, number>();
  let cursor = 1;
  for (const widget of DASHBOARD_WIDGETS) {
    const size = DEFAULT_SIZE[widget.key];
    const span = Math.min(homeWidgetColumnSpan(size), HOME_WIDGET_BASE_COLUMNS);
    if (size === "feature" || cursor + span - 1 > HOME_WIDGET_BASE_COLUMNS) cursor = 1;
    columns.set(widget.key, cursor);
    cursor += span;
    if (cursor > HOME_WIDGET_BASE_COLUMNS) cursor = 1;
  }
  return columns;
}

export function defaultHomeWidgetLayout(): HomeWidgetLayoutState {
  const columns = defaultHomeWidgetColumns();
  return {
    schema: 2,
    items: DASHBOARD_WIDGETS.map((widget, order) => ({
      id: widget.key,
      enabled: DEFAULT_HOME_WIDGET_KEYS.includes(widget.key),
      order,
      size: DEFAULT_SIZE[widget.key],
      column: columns.get(widget.key) || 1,
      source: "builtin",
    })),
  };
}

export function normalizeHomeWidgetLayout(value: unknown, fallback = defaultHomeWidgetLayout()): HomeWidgetLayoutState {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<HomeWidgetLayoutState>;
  if (candidate.schema !== 2 || !Array.isArray(candidate.items)) return fallback;
  const known = new Set(DASHBOARD_WIDGETS.map((item) => item.key));
  const incoming = new Map<string, HomeWidgetLayoutItem>();
  for (const raw of candidate.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<HomeWidgetLayoutItem>;
    if (typeof item.id !== "string") continue;
    const builtin = known.has(item.id as DashboardWidgetKey);
    if (!builtin && item.source !== "custom") continue;
    const size = HOME_WIDGET_SIZE_OPTIONS.some((option) => option.value === item.size) ? item.size! : "standard";
    incoming.set(item.id, {
      id: item.id,
      enabled: item.enabled !== false,
      order: Number.isFinite(item.order) ? Math.max(0, Math.trunc(item.order!)) : 999,
      size,
      column: clampHomeWidgetColumn(Number(item.column) || 1, size),
      source: builtin ? "builtin" : "custom",
      config: normalizeHomeWidgetConfig(item.id, item.config),
    });
  }
  const merged = fallback.items.map((item) => incoming.get(item.id) || item);
  for (const item of incoming.values()) if (item.source === "custom" && !merged.some((entry) => entry.id === item.id)) merged.push(item);
  merged.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { schema: 2, items: merged.map((item, order) => ({ ...item, order, column: clampHomeWidgetColumn(item.column, item.size) })) };
}

export function updateHomeWidgetLayout(
  layout: HomeWidgetLayoutState,
  id: string,
  patch: Partial<Pick<HomeWidgetLayoutItem, "enabled" | "size" | "column" | "config">>,
): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  return {
    schema: 2,
    items: normalized.items.map((item) => item.id === id
      ? {
        ...item,
        ...patch,
        column: clampHomeWidgetColumn(patch.column ?? item.column, patch.size ?? item.size),
        config: patch.config === undefined ? item.config : normalizeHomeWidgetConfig(id, patch.config),
      }
      : item),
  };
}

export function updateHomeWidgetConfiguration(layout: HomeWidgetLayoutState, id: string, patch: Partial<HomeWidgetConfig>): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  const placement = normalized.items.find((item) => item.id === id);
  if (!placement) return normalized;
  return updateHomeWidgetLayout(normalized, id, { config: { ...(placement.config || {}), ...patch } });
}

export function parseHomeWidgetKeyCsv(value?: string): DashboardWidgetKey[] {
  const known = new Set(DASHBOARD_WIDGETS.map((item) => item.key));
  const keys = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(keys.filter((key): key is DashboardWidgetKey => known.has(key as DashboardWidgetKey))));
}

export function homeWidgetGovernanceFromCsv(requiredCsv?: string, unavailableCsv?: string, recommendedCsv?: string): HomeWidgetGovernance {
  const required = parseHomeWidgetKeyCsv(requiredCsv);
  const requiredSet = new Set(required);
  const unavailable = parseHomeWidgetKeyCsv(unavailableCsv).filter((key) => !requiredSet.has(key));
  const unavailableSet = new Set(unavailable);
  const recommended = parseHomeWidgetKeyCsv(recommendedCsv).filter((key) => !unavailableSet.has(key));
  for (const key of required) if (!recommended.includes(key)) recommended.push(key);
  return { required, unavailable, recommended };
}

export function applyHomeWidgetGovernance(layout: HomeWidgetLayoutState, governance?: HomeWidgetGovernance): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  if (!governance) return normalized;
  const required = new Set(governance.required);
  const unavailable = new Set(governance.unavailable);
  return {
    schema: 2,
    items: normalized.items.map((item) => item.source !== "builtin" ? item : {
      ...item,
      enabled: required.has(item.id as DashboardWidgetKey) ? true : unavailable.has(item.id as DashboardWidgetKey) ? false : item.enabled,
    }),
  };
}

export function defaultHomeWidgetProfileState(): HomeWidgetLayoutProfileState {
  return { schema: 2, profiles: [] };
}

function normalizeHomeWidgetProfileName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

export function normalizeHomeWidgetProfileState(value: unknown): HomeWidgetLayoutProfileState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultHomeWidgetProfileState();
  const raw = value as Partial<HomeWidgetLayoutProfileState>;
  if (raw.schema !== 2 || !Array.isArray(raw.profiles)) return defaultHomeWidgetProfileState();
  const profiles: HomeWidgetLayoutProfile[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.profiles.slice(0, 8)) {
    if (!candidate || typeof candidate !== "object") continue;
    const profile = candidate as Partial<HomeWidgetLayoutProfile>;
    const name = normalizeHomeWidgetProfileName(profile.name);
    const id = typeof profile.id === "string" ? profile.id.trim().slice(0, 64) : "";
    if (!id || ids.has(id) || !name) continue;
    const createdAt = typeof profile.createdAt === "string" && Number.isFinite(Date.parse(profile.createdAt)) ? profile.createdAt : new Date(0).toISOString();
    const updatedAt = typeof profile.updatedAt === "string" && Number.isFinite(Date.parse(profile.updatedAt)) ? profile.updatedAt : createdAt;
    profiles.push({ id, name, createdAt, updatedAt, layout: normalizeHomeWidgetLayout(profile.layout) });
    ids.add(id);
  }
  profiles.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { schema: 2, profiles };
}

export function saveHomeWidgetProfile(state: HomeWidgetLayoutProfileState, name: string, layout: HomeWidgetLayoutState, existingId?: string): HomeWidgetLayoutProfileState {
  const normalized = normalizeHomeWidgetProfileState(state);
  const safeName = normalizeHomeWidgetProfileName(name);
  if (!safeName) return normalized;
  const now = new Date().toISOString();
  const existing = existingId ? normalized.profiles.find((profile) => profile.id === existingId) : undefined;
  const id = existing?.id || `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next: HomeWidgetLayoutProfile = { id, name: safeName, createdAt: existing?.createdAt || now, updatedAt: now, layout: normalizeHomeWidgetLayout(layout) };
  return { schema: 2, profiles: [next, ...normalized.profiles.filter((profile) => profile.id !== id)].slice(0, 8) };
}

export function deleteHomeWidgetProfile(state: HomeWidgetLayoutProfileState, id: string): HomeWidgetLayoutProfileState {
  const normalized = normalizeHomeWidgetProfileState(state);
  return { schema: 2, profiles: normalized.profiles.filter((profile) => profile.id !== id) };
}

export function serializeHomeWidgetProfiles(state: HomeWidgetLayoutProfileState, profileIds?: string[]): string {
  const normalized = normalizeHomeWidgetProfileState(state);
  const requested = profileIds?.length ? new Set(profileIds.slice(0, 8)) : null;
  const profiles = requested ? normalized.profiles.filter((profile) => requested.has(profile.id)) : normalized.profiles;
  const bundle: HomeWidgetProfileExportBundle = { kind: "cluster-home-layout-profiles", schema: 2, exportedAt: new Date().toISOString(), profiles };
  return JSON.stringify(bundle, null, 2);
}

export function importHomeWidgetProfiles(state: HomeWidgetLayoutProfileState, value: unknown): HomeWidgetLayoutProfileState {
  const current = normalizeHomeWidgetProfileState(state);
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  const raw = value as Partial<HomeWidgetProfileExportBundle>;
  if (raw.kind !== "cluster-home-layout-profiles" || raw.schema !== 2 || !Array.isArray(raw.profiles)) return current;
  const imported = normalizeHomeWidgetProfileState({ schema: 2, profiles: raw.profiles });
  if (!imported.profiles.length) return current;
  const byId = new Map(current.profiles.map((profile) => [profile.id, profile]));
  for (const profile of imported.profiles) byId.set(profile.id, profile);
  return normalizeHomeWidgetProfileState({ schema: 2, profiles: [...byId.values()] });
}

export function parseHomeWidgetProfileImport(text: string): HomeWidgetProfileExportBundle | null {
  if (!text || text.length > 131072) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Partial<HomeWidgetProfileExportBundle>;
    if (raw.kind !== "cluster-home-layout-profiles" || raw.schema !== 2 || !Array.isArray(raw.profiles)) return null;
    const normalized = normalizeHomeWidgetProfileState({ schema: 2, profiles: raw.profiles });
    if (!normalized.profiles.length) return null;
    return { kind: "cluster-home-layout-profiles", schema: 2, exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date(0).toISOString(), profiles: normalized.profiles };
  } catch { return null; }
}

export function departmentAwareHomeWidgetRecommendation(
  roleId: string | null | undefined,
  departmentId: string | null | undefined,
  roles: HomeWidgetRoleRecommendation[] | null | undefined,
  departments: HomeWidgetDepartmentRecommendation[] | null | undefined,
  fallbackCsv?: string,
) {
  const normalizedRole = String(roleId || "").trim().toLowerCase();
  const role = (roles || []).find((item) => item.enabled !== false && item.id.trim().toLowerCase() === normalizedRole);
  const roleKeys = parseHomeWidgetKeyCsv(role?.homeRecommendedWidgetsCsv);
  if (roleKeys.length) return { keys: roleKeys, source: "role" as const, sourceId: role?.id || normalizedRole };
  const normalizedDepartment = String(departmentId || role?.departmentId || "").trim().toLowerCase();
  const department = (departments || []).find((item) => item.enabled !== false && item.id.trim().toLowerCase() === normalizedDepartment);
  const departmentKeys = parseHomeWidgetKeyCsv(department?.homeRecommendedWidgetsCsv);
  if (departmentKeys.length) return { keys: departmentKeys, source: "department" as const, sourceId: department?.id || normalizedDepartment };
  return { keys: parseHomeWidgetKeyCsv(fallbackCsv), source: "studio" as const, sourceId: "studio" };
}

export function roleAwareHomeWidgetRecommendation(roleId: string | null | undefined, roles: HomeWidgetRoleRecommendation[] | null | undefined, fallbackCsv?: string): DashboardWidgetKey[] {
  return departmentAwareHomeWidgetRecommendation(roleId, undefined, roles, undefined, fallbackCsv).keys;
}


export function homeWidgetPresetKeys(preset: HomeWidgetPreset): DashboardWidgetKey[] {
  if (preset === "quiet") return [...CORE_DASHBOARD_KEYS];
  if (preset === "core-tools") return [...CORE_DASHBOARD_KEYS, ...TOOL_WORKSPACE_WIDGET_KEYS];
  if (preset === "everything") return DASHBOARD_WIDGETS.map((item) => item.key);
  return [...DEFAULT_HOME_WIDGET_KEYS];
}

export function placeHomeWidgetLayout(
  layout: HomeWidgetLayoutState,
  id: string,
  options: { enabled?: boolean; column?: number; targetId?: string | null; position?: "before" | "after" },
): HomeWidgetLayoutState {
  let next = normalizeHomeWidgetLayout(layout);
  const placement = next.items.find((item) => item.id === id);
  if (!placement) return next;
  next = updateHomeWidgetLayout(next, id, {
    enabled: options.enabled ?? placement.enabled,
    column: options.column ?? placement.column,
  });
  if (options.targetId && options.targetId !== id) next = reorderHomeWidgetLayout(next, id, options.targetId, options.position || "before");
  return next;
}

export function reorderHomeWidgetLayout(layout: HomeWidgetLayoutState, activeId: string, targetId: string, position: "before" | "after" = "before"): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  if (activeId === targetId) return normalized;
  const active = normalized.items.find((item) => item.id === activeId);
  const targetIndex = normalized.items.findIndex((item) => item.id === targetId);
  if (!active || targetIndex < 0) return normalized;
  const items = normalized.items.filter((item) => item.id !== activeId);
  const normalizedTargetIndex = items.findIndex((item) => item.id === targetId);
  const insertionIndex = position === "after" ? normalizedTargetIndex + 1 : normalizedTargetIndex;
  items.splice(Math.max(0, Math.min(insertionIndex, items.length)), 0, active);
  return { schema: 2, items: items.map((item, order) => ({ ...item, order })) };
}

export function moveHomeWidgetLayout(layout: HomeWidgetLayoutState, id: string, delta: -1 | 1): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  const index = normalized.items.findIndex((item) => item.id === id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= normalized.items.length) return normalized;
  const items = [...normalized.items];
  [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
  return { schema: 2, items: items.map((item, order) => ({ ...item, order })) };
}

export function syncCustomHomeWidgets(layout: HomeWidgetLayoutState, manifests: CustomHomeWidgetManifest[]): HomeWidgetLayoutState {
  const normalized = normalizeHomeWidgetLayout(layout);
  const installed = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const items = normalized.items
    .filter((item) => item.source !== "custom" || installed.has(item.id))
    .map((item) => {
      if (item.source !== "custom") return item;
      const manifest = installed.get(item.id);
      return manifest ? { ...item, size: constrainHomeWidgetSize(item.size, manifest.minSize) } : item;
    });
  const known = new Set(items.map((item) => item.id));
  for (const manifest of manifests) {
    if (known.has(manifest.id)) continue;
    const preferredSize = constrainHomeWidgetSize(manifest.defaultSize || "standard", manifest.minSize);
    items.push({ id: manifest.id, enabled: false, order: items.length, size: preferredSize, column: 1, source: "custom", config: undefined });
  }
  return { schema: 2, items: items.map((item, order) => ({ ...item, order })) };
}

const CUSTOM_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const CUSTOM_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ALLOWED_PERMISSIONS = new Set<HomeWidgetPermission>(HOME_WIDGET_PERMISSIONS);
const ALLOWED_SIZES = new Set<HomeWidgetSize>(HOME_WIDGET_SIZE_OPTIONS.map((item) => item.value));
const METRIC_BINDINGS = new Set<HomeWidgetMetricBinding>([
  "projects.total", "projects.ready", "projects.needsAttention",
  "boards.total", "cards.open", "cards.assigned", "whiteboards.total",
  "scheduler.weekMinutes", "scheduler.running", "activity.recent",
  "inbox.attention", "inbox.urgent", "people.total", "people.active", "people.capacityPressure",
  "builds.total", "builds.failed", "qa.total", "qa.failed", "qa.blocked",
  "tickets.open", "tickets.priority", "calendar.upcoming", "library.total", "library.pinned",
  "packets.required", "packets.overdue", "automation.recurring", "source.repositories", "source.reviews",
  "delivery.ready", "delivery.blocked", "operations.attention", "operations.security",
]);
const LIST_BINDINGS = new Set<HomeWidgetListBinding>([
  "projects.recent", "boards.assignedCards", "whiteboards.recent", "activity.recentItems", "people.activePeople",
  "builds.recent", "qa.active", "tickets.openItems", "calendar.upcomingItems", "library.recent",
  "packets.requiredItems", "automation.recurringItems", "source.repositoriesItems", "source.reviewItems", "operations.attentionItems",
]);

export function homeWidgetBindingPermission(binding: HomeWidgetMetricBinding | HomeWidgetListBinding): HomeWidgetPermission {
  if (binding.startsWith("projects.") || binding.startsWith("automation.")) return "projects.read";
  if (binding.startsWith("boards.") || binding.startsWith("cards.")) return "boards.read";
  if (binding.startsWith("whiteboards.")) return "whiteboards.read";
  if (binding.startsWith("scheduler.")) return "scheduler.read";
  if (binding.startsWith("activity.")) return "activity.read";
  if (binding.startsWith("inbox.")) return "inbox.read";
  if (binding.startsWith("people.")) return "people.read";
  if (binding.startsWith("builds.") || binding.startsWith("delivery.")) return "builds.read";
  if (binding.startsWith("qa.")) return "qa.read";
  if (binding.startsWith("tickets.")) return "tickets.read";
  if (binding.startsWith("calendar.")) return "calendar.read";
  if (binding.startsWith("packets.")) return "packets.read";
  if (binding.startsWith("source.")) return "sourceControl.read";
  if (binding.startsWith("operations.")) return "serverConfig.read";
  return "library.read";
}

function validateBindingPermission(binding: HomeWidgetMetricBinding | HomeWidgetListBinding, granted: Set<HomeWidgetPermission>) {
  const permission = homeWidgetBindingPermission(binding);
  return granted.has(permission) ? null : `Widget content requires ${permission}.`;
}

function parseListBlock(block: Record<string, unknown>, type: "list" | "queue" | "people" | "timeline" | "resource" | "dataView", granted: Set<HomeWidgetPermission>): { ok: true; block: CustomHomeWidgetBlock } | { ok: false; reason: string } {
  if (Object.keys(block).some((key) => !["type", "label", "binding", "limit"].includes(key)) || (block.label !== undefined && (typeof block.label !== "string" || block.label.length > 48)) || typeof block.binding !== "string" || !LIST_BINDINGS.has(block.binding as HomeWidgetListBinding)) return { ok: false, reason: `${type} widget block is invalid.` };
  const binding = block.binding as HomeWidgetListBinding;
  const permissionError = validateBindingPermission(binding, granted);
  if (permissionError) return { ok: false, reason: permissionError };
  const limit = block.limit === undefined ? undefined : Number(block.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 12)) return { ok: false, reason: "Widget list limit must be 1-12." };
  return { ok: true, block: { type, label: typeof block.label === "string" ? block.label.trim() : undefined, binding, limit } as CustomHomeWidgetBlock };
}

function validateCustomBlocks(raw: unknown, permissions: HomeWidgetPermission[]): { ok: true; blocks: CustomHomeWidgetBlock[] } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, blocks: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "Widget content must be an object." };
  const content = raw as Record<string, unknown>;
  if (Object.keys(content).some((key) => key !== "blocks")) return { ok: false, reason: "Widget content contains unsupported fields." };
  if (!Array.isArray(content.blocks) || content.blocks.length > 16) return { ok: false, reason: "Widget content must contain at most 16 blocks." };
  const granted = new Set(permissions);
  const blocks: CustomHomeWidgetBlock[] = [];
  for (const entry of content.blocks) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, reason: "Widget content block is invalid." };
    const block = entry as Record<string, unknown>;
    if (block.type === "text") {
      if (Object.keys(block).some((key) => !["type", "text"].includes(key)) || typeof block.text !== "string" || !block.text.trim() || block.text.length > 320) return { ok: false, reason: "Text widget block is invalid." };
      blocks.push({ type: "text", text: block.text.trim() });
      continue;
    }
    if (block.type === "metric") {
      if (Object.keys(block).some((key) => !["type", "label", "binding"].includes(key)) || typeof block.label !== "string" || !block.label.trim() || block.label.length > 48 || typeof block.binding !== "string" || !METRIC_BINDINGS.has(block.binding as HomeWidgetMetricBinding)) return { ok: false, reason: "Metric widget block is invalid." };
      const binding = block.binding as HomeWidgetMetricBinding;
      const permissionError = validateBindingPermission(binding, granted);
      if (permissionError) return { ok: false, reason: permissionError };
      blocks.push({ type: "metric", label: block.label.trim(), binding });
      continue;
    }
    if (["list", "queue", "people", "timeline", "resource", "dataView"].includes(String(block.type))) {
      const parsed = parseListBlock(block, block.type as "list" | "queue" | "people" | "timeline" | "resource" | "dataView", granted);
      if (!parsed.ok) return parsed;
      blocks.push(parsed.block);
      continue;
    }
    if (block.type === "clock") {
      if (Object.keys(block).some((key) => !["type", "label", "format"].includes(key)) || (block.label !== undefined && (typeof block.label !== "string" || block.label.length > 48)) || (block.format !== undefined && !["time", "date", "datetime"].includes(String(block.format)))) return { ok: false, reason: "Clock widget block is invalid." };
      blocks.push({ type: "clock", label: typeof block.label === "string" ? block.label.trim() : undefined, format: block.format as "time" | "date" | "datetime" | undefined });
      continue;
    }
    if (block.type === "status" || block.type === "trend") {
      const allowed = block.type === "status" ? ["type", "label", "binding", "goodAt", "warningAt"] : ["type", "label", "binding", "direction"];
      if (Object.keys(block).some((key) => !allowed.includes(key)) || typeof block.label !== "string" || !block.label.trim() || block.label.length > 48 || typeof block.binding !== "string" || !METRIC_BINDINGS.has(block.binding as HomeWidgetMetricBinding)) return { ok: false, reason: `${block.type} widget block is invalid.` };
      const binding = block.binding as HomeWidgetMetricBinding;
      const permissionError = validateBindingPermission(binding, granted);
      if (permissionError) return { ok: false, reason: permissionError };
      if (block.type === "status") {
        const goodAt = block.goodAt === undefined ? undefined : Number(block.goodAt);
        const warningAt = block.warningAt === undefined ? undefined : Number(block.warningAt);
        if ((goodAt !== undefined && !Number.isFinite(goodAt)) || (warningAt !== undefined && !Number.isFinite(warningAt))) return { ok: false, reason: "Status thresholds must be numbers." };
        blocks.push({ type: "status", label: block.label.trim(), binding, goodAt, warningAt });
      } else {
        if (block.direction !== undefined && !["up-good", "down-good", "neutral"].includes(String(block.direction))) return { ok: false, reason: "Trend direction is invalid." };
        blocks.push({ type: "trend", label: block.label.trim(), binding, direction: block.direction as "up-good" | "down-good" | "neutral" | undefined });
      }
      continue;
    }
    if (block.type === "progress") {
      if (Object.keys(block).some((key) => !["type", "label", "value", "total"].includes(key)) || typeof block.label !== "string" || !block.label.trim() || typeof block.value !== "string" || typeof block.total !== "string" || !METRIC_BINDINGS.has(block.value as HomeWidgetMetricBinding) || !METRIC_BINDINGS.has(block.total as HomeWidgetMetricBinding)) return { ok: false, reason: "Progress widget block is invalid." };
      const value = block.value as HomeWidgetMetricBinding; const total = block.total as HomeWidgetMetricBinding;
      const permissionError = validateBindingPermission(value, granted) || validateBindingPermission(total, granted);
      if (permissionError) return { ok: false, reason: permissionError };
      blocks.push({ type: "progress", label: block.label.trim(), value, total });
      continue;
    }
    if (block.type === "action") {
      if (Object.keys(block).some((key) => !["type", "label", "target"].includes(key)) || typeof block.label !== "string" || !block.label.trim() || !["projects", "boards", "whiteboards", "mywork", "calendar", "packets", "sourceControl", "operations"].includes(String(block.target))) return { ok: false, reason: "Action widget block is invalid." };
      blocks.push({ type: "action", label: block.label.trim(), target: block.target as Extract<CustomHomeWidgetBlock, { type: "action" }>["target"] });
      continue;
    }
    if (block.type === "matrix") {
      if (Object.keys(block).some((key) => !["type", "label", "bindings"].includes(key)) || typeof block.label !== "string" || !block.label.trim() || !Array.isArray(block.bindings) || !block.bindings.length || block.bindings.length > 8) return { ok: false, reason: "State matrix block is invalid." };
      const bindings = block.bindings.map(String) as HomeWidgetMetricBinding[];
      if (bindings.some((binding) => !METRIC_BINDINGS.has(binding))) return { ok: false, reason: "State matrix binding is invalid." };
      for (const binding of bindings) { const permissionError = validateBindingPermission(binding, granted); if (permissionError) return { ok: false, reason: permissionError }; }
      blocks.push({ type: "matrix", label: block.label.trim(), bindings });
      continue;
    }
    if (block.type === "operation") {
      if (Object.keys(block).some((key) => !["type", "label", "binding", "detailBinding"].includes(key)) || typeof block.label !== "string" || !block.label.trim() || typeof block.binding !== "string" || !METRIC_BINDINGS.has(block.binding as HomeWidgetMetricBinding) || (block.detailBinding !== undefined && (typeof block.detailBinding !== "string" || !LIST_BINDINGS.has(block.detailBinding as HomeWidgetListBinding)))) return { ok: false, reason: "Operation widget block is invalid." };
      const binding = block.binding as HomeWidgetMetricBinding;
      const detailBinding = block.detailBinding as HomeWidgetListBinding | undefined;
      const permissionError = validateBindingPermission(binding, granted) || (detailBinding ? validateBindingPermission(detailBinding, granted) : null);
      if (permissionError) return { ok: false, reason: permissionError };
      blocks.push({ type: "operation", label: block.label.trim(), binding, detailBinding });
      continue;
    }
    return { ok: false, reason: "Widget content uses an unsupported block type." };
  }
  return { ok: true, blocks };
}

export function validateCustomHomeWidgetManifest(value: unknown): { ok: true; manifest: CustomHomeWidgetManifest } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "Manifest must be a JSON object." };
  const raw = value as Record<string, unknown>;
  const allowedFields = new Set(["schema", "id", "name", "version", "description", "runtime", "source", "defaultSize", "minSize", "permissions", "content", "publisher", "minimumClusterVersion", "provenance"]);
  if (Object.keys(raw).some((key) => !allowedFields.has(key))) return { ok: false, reason: "Manifest contains unsupported fields." };
  if (raw.schema !== 2) return { ok: false, reason: "Unsupported widget manifest schema." };
  const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  if (!CUSTOM_ID.test(id)) return { ok: false, reason: "Widget id is invalid." };
  if (DASHBOARD_WIDGETS.some((widget) => widget.key === id)) return { ok: false, reason: "Widget id is reserved by a built-in Home widget." };
  if (!name || name.length > 64) return { ok: false, reason: "Widget name must be 1-64 characters." };
  if (!CUSTOM_VERSION.test(version)) return { ok: false, reason: "Widget version is invalid." };
  if (raw.runtime !== "declarative-v1") return { ok: false, reason: "Only the declarative-v1 widget runtime is allowed." };
  if (raw.source !== undefined && raw.source !== "custom") return { ok: false, reason: "Widget source is invalid." };
  if (raw.description !== undefined && typeof raw.description !== "string") return { ok: false, reason: "Widget description must be text." };
  if (raw.publisher !== undefined && (typeof raw.publisher !== "string" || !raw.publisher.trim() || raw.publisher.trim().length > 80)) return { ok: false, reason: "Widget publisher is invalid." };
  if (raw.minimumClusterVersion !== undefined && (typeof raw.minimumClusterVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.minimumClusterVersion.trim()))) return { ok: false, reason: "Widget minimumClusterVersion is invalid." };
  if (raw.provenance !== undefined && (!raw.provenance || typeof raw.provenance !== "object" || Array.isArray(raw.provenance))) return { ok: false, reason: "Widget provenance is invalid." };
  if (raw.defaultSize !== undefined && (typeof raw.defaultSize !== "string" || !ALLOWED_SIZES.has(raw.defaultSize as HomeWidgetSize))) return { ok: false, reason: "Widget defaultSize is invalid." };
  if (raw.minSize !== undefined && (typeof raw.minSize !== "string" || !ALLOWED_SIZES.has(raw.minSize as HomeWidgetSize))) return { ok: false, reason: "Widget minSize is invalid." };
  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) return { ok: false, reason: "Widget permissions must be a list." };
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((permission): permission is HomeWidgetPermission => typeof permission === "string" && ALLOWED_PERMISSIONS.has(permission as HomeWidgetPermission)).slice(0, 8)
    : [];
  if (Array.isArray(raw.permissions) && permissions.length !== raw.permissions.length) return { ok: false, reason: "Widget requests an unsupported permission." };
  const contentResult = validateCustomBlocks(raw.content, permissions);
  if (!contentResult.ok) return contentResult;
  const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 240) : undefined;
  const defaultSize = ALLOWED_SIZES.has(raw.defaultSize as HomeWidgetSize) ? raw.defaultSize as HomeWidgetSize : undefined;
  const minSize = ALLOWED_SIZES.has(raw.minSize as HomeWidgetSize) ? raw.minSize as HomeWidgetSize : undefined;
  const content = contentResult.blocks.length ? { blocks: contentResult.blocks } : undefined;
  const publisher = typeof raw.publisher === "string" ? raw.publisher.trim().slice(0, 80) : undefined;
  const minimumClusterVersion = typeof raw.minimumClusterVersion === "string" ? raw.minimumClusterVersion.trim() : undefined;
  const provenanceRaw = raw.provenance as Record<string, unknown> | undefined;
  const provenance = provenanceRaw?.origin === "desktop-library" ? {
    origin: "desktop-library" as const,
    installedAt: typeof provenanceRaw.installedAt === "string" ? provenanceRaw.installedAt : undefined,
    updatedAt: typeof provenanceRaw.updatedAt === "string" ? provenanceRaw.updatedAt : undefined,
    digest: typeof provenanceRaw.digest === "string" ? provenanceRaw.digest.slice(0, 80) : undefined,
    sourceLabel: typeof provenanceRaw.sourceLabel === "string" ? provenanceRaw.sourceLabel.slice(0, 80) : undefined,
  } : undefined;
  return { ok: true, manifest: { schema: 1, id, name, version, runtime: "declarative-v1", description, defaultSize, minSize, permissions: permissions.length ? permissions : undefined, content, publisher, minimumClusterVersion, provenance } };
}

export function homeWidgetExtensionPolicyFromSettings(mode?: string, allowedPermissionsCsv?: string, blockedIdsCsv?: string): HomeWidgetExtensionPolicy {
  const normalizedMode: HomeWidgetExtensionPolicyMode = mode === "disabled" || mode === "curated-only" ? mode : "allow";
  const allowedSet = new Set(String(allowedPermissionsCsv || HOME_WIDGET_PERMISSIONS.join(",")).split(",").map((item) => item.trim()).filter(Boolean));
  const allowedPermissions = HOME_WIDGET_PERMISSIONS.filter((permission) => allowedSet.has(permission));
  const blockedIds = Array.from(new Set(String(blockedIdsCsv || "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => CUSTOM_ID.test(item)))).slice(0, 128);
  return { mode: normalizedMode, allowedPermissions, blockedIds };
}

export function homeWidgetManifestPolicyDecision(manifest: CustomHomeWidgetManifest, policy: HomeWidgetExtensionPolicy): { allowed: true } | { allowed: false; reason: string } {
  const curated = Boolean(manifest.gallery);
  if (policy.mode === "disabled") return { allowed: false, reason: "Extension widgets are disabled by Studio policy." };
  if (!curated && policy.mode === "curated-only") return { allowed: false, reason: "Studio policy allows curated widgets only." };
  if (!curated && policy.blockedIds.includes(manifest.id)) return { allowed: false, reason: "This widget ID is blocked by Studio policy." };
  const denied = (manifest.permissions || []).filter((permission) => !policy.allowedPermissions.includes(permission));
  if (denied.length) return { allowed: false, reason: `Studio policy blocks ${denied.join(", ")}.` };
  return { allowed: true };
}


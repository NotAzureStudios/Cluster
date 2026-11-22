import {
  CLUSTER_DASHBOARD_WIDGET_GROUPS,
  CLUSTER_DASHBOARD_WIDGET_KEYS,
  CLUSTER_DASHBOARD_WIDGET_MANIFEST,
} from "@cluster/shared";
import type { ClusterIconName } from "../../components/ClusterIcon";
import type { DashboardWidgetDefinition, DashboardWidgetKey } from "../application/application-models";
import {
  HOME_WIDGET_SIZES,
  addGridItem,
  isHomeWidgetSize,
  packGrid,
  readingOrder,
  sanitizeGrid,
  type GridItem,
  type HomeWidgetSize,
} from "./home-widget-grid";

export type { HomeWidgetSize } from "./home-widget-grid";

/* ---------- Per-widget options ---------- */

export type HomeWidgetClockFormat = "time" | "date" | "datetime";
export type HomeWidgetContextMode = "studio" | "current-project" | "project" | "me" | "my-role" | "user" | "role";
export type HomeWidgetTimeRange = "all" | "today" | "7d" | "30d" | "90d";
export type HomeWidgetConfig = {
  clockFormat?: HomeWidgetClockFormat;
  noteTitle?: string;
  context?: HomeWidgetContextMode;
  contextId?: string;
  timeRange?: HomeWidgetTimeRange;
  filterText?: string;
};
export type HomeWidgetConfigCapability = "clockFormat" | "noteTitle" | "context" | "timeRange" | "filter";
export type HomeWidgetRuntimeStatus = { state: "loading" | "ready" | "error"; error?: string; onRetry?: () => void };

/* ---------- Catalog ---------- */

export type HomeWidgetRegistryEntry = DashboardWidgetDefinition & {
  icon: ClusterIconName;
  defaultSize: HomeWidgetSize;
  sizes: HomeWidgetSize[];
  configuration: HomeWidgetConfigCapability[];
};

const ALL_SIZES: HomeWidgetSize[] = ["small", "medium", "large", "xlarge"];
const LIST_OPTIONS: HomeWidgetConfigCapability[] = ["context", "timeRange", "filter"];

const CATALOG: Record<DashboardWidgetKey, { icon: ClusterIconName; defaultSize: HomeWidgetSize; sizes?: HomeWidgetSize[]; configuration?: HomeWidgetConfigCapability[] }> = {
  brief: { icon: "warning", defaultSize: "medium", sizes: ["small", "medium", "large"] },
  roleFocus: { icon: "work", defaultSize: "large", configuration: ["timeRange", "filter"] },
  upcoming: { icon: "calendar", defaultSize: "large", configuration: LIST_OPTIONS },
  scheduler: { icon: "clock", defaultSize: "small", sizes: ["small", "medium", "large"] },
  projects: { icon: "project", defaultSize: "large", configuration: ["context", "filter"] },
  timeline: { icon: "timeline", defaultSize: "medium", configuration: LIST_OPTIONS },
  builds: { icon: "inventory", defaultSize: "medium", configuration: LIST_OPTIONS },
  qa: { icon: "check", defaultSize: "medium", configuration: LIST_OPTIONS },
  tickets: { icon: "ticket", defaultSize: "medium", configuration: LIST_OPTIONS },
  sourceControl: { icon: "code", defaultSize: "medium", configuration: ["context", "filter"] },
  reviewQueue: { icon: "comment", defaultSize: "medium", configuration: ["context", "filter"] },
  inbox: { icon: "bell", defaultSize: "small", sizes: ["small", "medium"] },
  people: { icon: "users", defaultSize: "medium", configuration: ["filter"] },
  peopleCapacity: { icon: "chart", defaultSize: "medium", configuration: ["filter"] },
  activity: { icon: "activity", defaultSize: "medium", configuration: ["context", "timeRange", "filter"] },
  library: { icon: "library", defaultSize: "medium", configuration: ["context", "filter"] },
  quickCapture: { icon: "plus", defaultSize: "small", sizes: ["small", "medium"] },
  clock: { icon: "clock", defaultSize: "small", sizes: ["small", "medium"], configuration: ["clockFormat"] },
  note: { icon: "note", defaultSize: "small", sizes: ["small", "medium", "large"], configuration: ["noteTitle"] },
  adminOverview: { icon: "settings", defaultSize: "small", sizes: ["small", "medium", "large"] },
};

export const HOME_WIDGET_REGISTRY: HomeWidgetRegistryEntry[] = CLUSTER_DASHBOARD_WIDGET_KEYS.map((key) => {
  const definition = CLUSTER_DASHBOARD_WIDGET_MANIFEST[key] as (typeof CLUSTER_DASHBOARD_WIDGET_MANIFEST)[DashboardWidgetKey] & { adminOnly?: boolean; configurable?: boolean };
  const entry = CATALOG[key];
  const configuration = entry.configuration || [];
  return {
    key,
    label: definition.label,
    detail: definition.detail,
    group: definition.group,
    adminOnly: definition.adminOnly,
    configurable: configuration.length > 0,
    icon: entry.icon,
    defaultSize: entry.defaultSize,
    sizes: entry.sizes || ALL_SIZES,
    configuration,
  };
});

export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = HOME_WIDGET_REGISTRY.map(({ key, label, detail, group, adminOnly, configurable }) => ({ key, label, detail, group, adminOnly, configurable }));
export const DASHBOARD_WIDGET_GROUPS = CLUSTER_DASHBOARD_WIDGET_GROUPS;

const REGISTRY_BY_KEY = new Map(HOME_WIDGET_REGISTRY.map((entry) => [entry.key, entry]));
export function homeWidgetRegistryEntry(id: string) {
  return REGISTRY_BY_KEY.get(id as DashboardWidgetKey);
}
export function isHomeWidgetKey(id: unknown): id is DashboardWidgetKey {
  return typeof id === "string" && REGISTRY_BY_KEY.has(id as DashboardWidgetKey);
}

/** Order matters: the default Home is these, packed in this order. */
export const DEFAULT_HOME_WIDGET_KEYS: DashboardWidgetKey[] = ["brief", "roleFocus", "scheduler", "inbox", "upcoming", "projects", "builds", "people", "activity", "clock", "quickCapture"];

export function normalizeHomeWidgetConfig(id: string, value: unknown): HomeWidgetConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const capabilities = new Set(homeWidgetRegistryEntry(id)?.configuration || []);
  const config: HomeWidgetConfig = {};
  if (capabilities.has("clockFormat") && ["time", "date", "datetime"].includes(String(raw.clockFormat))) config.clockFormat = raw.clockFormat as HomeWidgetClockFormat;
  if (capabilities.has("noteTitle") && typeof raw.noteTitle === "string") { const title = raw.noteTitle.trim().slice(0, 48); if (title) config.noteTitle = title; }
  if (capabilities.has("context") && ["studio", "current-project", "project", "me", "my-role", "user", "role"].includes(String(raw.context))) config.context = raw.context as HomeWidgetContextMode;
  if (capabilities.has("context") && typeof raw.contextId === "string") { const contextId = raw.contextId.trim().slice(0, 120); if (contextId) config.contextId = contextId; }
  if (capabilities.has("timeRange") && ["all", "today", "7d", "30d", "90d"].includes(String(raw.timeRange))) config.timeRange = raw.timeRange as HomeWidgetTimeRange;
  if (capabilities.has("filter") && typeof raw.filterText === "string") { const filterText = raw.filterText.trim().slice(0, 120); if (filterText) config.filterText = filterText; }
  return Object.keys(config).length ? config : undefined;
}

/* ---------- Layout ---------- */

export type HomeWidgetPlacement = GridItem & { id: DashboardWidgetKey; config?: HomeWidgetConfig };
export type HomeWidgetLayout = { schema: 3; items: HomeWidgetPlacement[] };

function allowedSize(id: DashboardWidgetKey, size: unknown): HomeWidgetSize {
  const entry = homeWidgetRegistryEntry(id)!;
  return isHomeWidgetSize(size) && entry.sizes.includes(size) ? size : entry.defaultSize;
}

export function homeLayoutFromKeys(keys: DashboardWidgetKey[]): HomeWidgetLayout {
  let items: HomeWidgetPlacement[] = [];
  for (const id of Array.from(new Set(keys)).filter(isHomeWidgetKey)) items = addGridItem(items, { id, size: homeWidgetRegistryEntry(id)!.defaultSize });
  return { schema: 3, items };
}

export function defaultHomeWidgetLayout(keys: DashboardWidgetKey[] = DEFAULT_HOME_WIDGET_KEYS): HomeWidgetLayout {
  return homeLayoutFromKeys(keys.length ? keys : DEFAULT_HOME_WIDGET_KEYS);
}

/** Accept a stored layout. A schema 2 layout (ordered, column-based) keeps
 *  which widgets were on and their order, repacked at their default sizes. */
export function normalizeHomeWidgetLayout(value: unknown, fallback: HomeWidgetLayout = defaultHomeWidgetLayout()): HomeWidgetLayout {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { schema?: unknown; items?: unknown };
  if (!Array.isArray(candidate.items)) return fallback;
  if (candidate.schema === 2) {
    const enabled = (candidate.items as Array<{ id?: unknown; enabled?: unknown; order?: unknown }>)
      .filter((item) => item && item.enabled !== false && isHomeWidgetKey(item.id))
      .sort((a, b) => Number(a.order ?? 999) - Number(b.order ?? 999))
      .map((item) => item.id as DashboardWidgetKey);
    return enabled.length ? homeLayoutFromKeys(enabled) : fallback;
  }
  if (candidate.schema !== 3) return fallback;
  const seen = new Set<string>();
  const items: HomeWidgetPlacement[] = [];
  for (const raw of candidate.items as Array<Record<string, unknown>>) {
    if (!raw || !isHomeWidgetKey(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const config = normalizeHomeWidgetConfig(raw.id, raw.config);
    items.push({ id: raw.id, x: Number(raw.x) || 0, y: Number(raw.y) || 0, size: allowedSize(raw.id, raw.size), ...(config ? { config } : {}) });
  }
  return { schema: 3, items: sanitizeGrid(items) };
}

export function packHomeWidgetLayout(layout: HomeWidgetLayout): HomeWidgetLayout {
  return { schema: 3, items: packGrid(layout.items) };
}

export function homeWidgetOrder(layout: HomeWidgetLayout) {
  return readingOrder(layout.items);
}

export function homeWidgetFootprint(size: HomeWidgetSize) {
  return HOME_WIDGET_SIZES[size];
}

/* ---------- Studio governance ---------- */

export type HomeWidgetGovernance = {
  required: DashboardWidgetKey[];
  unavailable: DashboardWidgetKey[];
  recommended: DashboardWidgetKey[];
};

export function parseHomeWidgetKeyCsv(value?: string): DashboardWidgetKey[] {
  const keys = String(value || "").split(",").map((item) => item.trim()).filter(isHomeWidgetKey);
  return Array.from(new Set(keys));
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

/** Hidden widgets come off; required ones go into the first gap that fits. */
export function applyHomeWidgetGovernance(layout: HomeWidgetLayout, governance?: HomeWidgetGovernance): HomeWidgetLayout {
  if (!governance) return layout;
  const unavailable = new Set(governance.unavailable);
  let items = layout.items.filter((item) => !unavailable.has(item.id));
  for (const id of governance.required) {
    if (!items.some((item) => item.id === id)) items = addGridItem(items, { id, size: homeWidgetRegistryEntry(id)!.defaultSize });
  }
  return items.length === layout.items.length && items.every((item, index) => item === layout.items[index]) ? layout : { schema: 3, items };
}

export type HomeWidgetRoleRecommendation = { id: string; departmentId?: string; homeRecommendedWidgetsCsv?: string; enabled?: boolean };
export type HomeWidgetDepartmentRecommendation = { id: string; homeRecommendedWidgetsCsv?: string; enabled?: boolean };

/** The widgets a new Home starts with: the role's set, else the department's, else the Studio's. */
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
  if (roleKeys.length) return { keys: roleKeys, source: "role" as const };
  const normalizedDepartment = String(departmentId || role?.departmentId || "").trim().toLowerCase();
  const department = (departments || []).find((item) => item.enabled !== false && item.id.trim().toLowerCase() === normalizedDepartment);
  const departmentKeys = parseHomeWidgetKeyCsv(department?.homeRecommendedWidgetsCsv);
  if (departmentKeys.length) return { keys: departmentKeys, source: "department" as const };
  return { keys: parseHomeWidgetKeyCsv(fallbackCsv), source: "studio" as const };
}

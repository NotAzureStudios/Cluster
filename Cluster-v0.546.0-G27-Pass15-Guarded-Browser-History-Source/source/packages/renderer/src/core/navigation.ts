import {
  CLUSTER_APP_ROUTE_IDS,
  CLUSTER_APP_ROUTE_MANIFEST,
  CLUSTER_APP_SIDEBAR_SECTIONS,
  type ClusterAppNavigationIcon,
  type ClusterAppRouteDefinition,
  type ClusterAppRouteFeatureFlag,
  type ClusterAppRouteGroup,
  type ClusterAppRouteId,
  type ClusterAppSidebarSection,
} from "@cluster/shared";
import { canUseTool, type PermissionUser, type ToolPermissionKey } from "./permissions";

export type AppRouteGroup = ClusterAppRouteGroup;
export type AppSidebarSection = ClusterAppSidebarSection;
export type AppRouteFeatureFlag = ClusterAppRouteFeatureFlag;
export type AppNavigationIcon = ClusterAppNavigationIcon;
export type AppRouteDefinition = ClusterAppRouteDefinition;

export const APP_SIDEBAR_SECTIONS = CLUSTER_APP_SIDEBAR_SECTIONS;
export const APP_ROUTE_DEFINITIONS = CLUSTER_APP_ROUTE_MANIFEST;
export type AppScreen = ClusterAppRouteId;
export const APP_SCREENS = CLUSTER_APP_ROUTE_IDS;

export function isAppScreen(value: unknown): value is AppScreen {
  return typeof value === "string" && Object.hasOwn(APP_ROUTE_DEFINITIONS, value);
}

export function routeDefinition(screen: AppScreen): AppRouteDefinition {
  return APP_ROUTE_DEFINITIONS[screen] as AppRouteDefinition;
}

export function sidebarRouteDefinitions(section: AppSidebarSection) {
  return APP_SCREENS
    .map((screen) => ({ screen, definition: routeDefinition(screen) }))
    .filter((entry) => entry.definition.sidebar?.section === section)
    .sort((a, b) => (a.definition.sidebar?.order || 0) - (b.definition.sidebar?.order || 0));
}

export const SCREEN_TOOL_MAP = Object.freeze(Object.fromEntries(
  APP_SCREENS.flatMap((screen) => {
    const tool = routeDefinition(screen).tool;
    return tool ? [[screen, tool]] : [];
  }),
) as Partial<Record<AppScreen, ToolPermissionKey>>);

export const ADMIN_ONLY_SCREENS = new Set<AppScreen>(APP_SCREENS.filter((screen) => routeDefinition(screen).adminOnly === true));
export const START_SCREEN_OPTIONS = Object.freeze(APP_SCREENS.filter((screen) => routeDefinition(screen).startEligible === true));

export function screenTool(screen: AppScreen): ToolPermissionKey | null {
  return SCREEN_TOOL_MAP[screen] || null;
}

export function screenLabel(screen: AppScreen) {
  return routeDefinition(screen).label;
}

export function screenFromStartSetting(value?: string): AppScreen {
  return isAppScreen(value) && routeDefinition(value).startEligible === true ? value : "dashboard";
}

export function isProjectContextScreen(screen: AppScreen) {
  return routeDefinition(screen).projectContext === true;
}

export function canOpenScreen(user: PermissionUser, screen: AppScreen) {
  const definition = routeDefinition(screen);
  if (definition.adminOnly && !user.isAdmin) return false;
  const tool = definition.tool;
  return tool ? canUseTool(user, tool, "view") : true;
}

export type AppNavigationContext = {
  projectId: string | null;
  boardId: string | null;
  whiteboardId: string | null;
};

export type AppNavigationState = {
  route: AppScreen;
  section: string | null;
  subsection: string | null;
  context: AppNavigationContext;
};

export type AppNavigationSource = "hash" | "history" | "session" | "default" | "invalid";

export const NAVIGATION_SESSION_STORAGE_KEY = "cluster-navigation-state";
const MAX_NAVIGATION_SEGMENT_LENGTH = 128;
const NAVIGATION_SEGMENT = /^[A-Za-z0-9._:-]+$/;

function safeNavigationSegment(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAVIGATION_SEGMENT_LENGTH || !NAVIGATION_SEGMENT.test(trimmed)) return null;
  return trimmed;
}

export function createNavigationState(
  route: AppScreen,
  input: Partial<AppNavigationContext> & { section?: string | null; subsection?: string | null } = {},
): AppNavigationState {
  return {
    route,
    section: safeNavigationSegment(input.section) || null,
    subsection: safeNavigationSegment(input.subsection) || null,
    context: {
      projectId: safeNavigationSegment(input.projectId) || null,
      boardId: safeNavigationSegment(input.boardId) || null,
      whiteboardId: safeNavigationSegment(input.whiteboardId) || null,
    },
  };
}

export function navigationStateFromHistory(value: unknown): AppNavigationState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!isAppScreen(input.route)) return null;
  const context = input.context && typeof input.context === "object" ? input.context as Record<string, unknown> : {};
  return createNavigationState(input.route, {
    section: typeof input.section === "string" ? input.section : null,
    subsection: typeof input.subsection === "string" ? input.subsection : null,
    projectId: typeof context.projectId === "string" ? context.projectId : null,
    boardId: typeof context.boardId === "string" ? context.boardId : null,
    whiteboardId: typeof context.whiteboardId === "string" ? context.whiteboardId : null,
  });
}

export function parseNavigationRoute(value: string): AppNavigationState | null {
  let decoded = String(value || "").trim().replace(/^#/, "");
  if (!decoded) return null;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  decoded = decoded.replace(/^\/+|\/+$/g, "");
  if (!decoded || decoded.length > 420) return null;
  const parts = decoded.split("/").filter(Boolean);
  const route = parts.shift();
  if (!isAppScreen(route)) return null;

  if (route === "project") {
    return createNavigationState(route, { projectId: parts[0], section: parts[1], subsection: parts[2] });
  }
  if (route === "board") {
    if (parts.length >= 2) return createNavigationState(route, { projectId: parts[0], boardId: parts[1], section: parts[2], subsection: parts[3] });
    return createNavigationState(route, { boardId: parts[0], section: parts[1], subsection: parts[2] });
  }
  if (route === "whiteboard") {
    if (parts.length >= 2) return createNavigationState(route, { projectId: parts[0], whiteboardId: parts[1], section: parts[2], subsection: parts[3] });
    return createNavigationState(route, { whiteboardId: parts[0], section: parts[1], subsection: parts[2] });
  }
  return createNavigationState(route, { section: parts[0], subsection: parts[1] });
}

export function serializeNavigationRoute(state: AppNavigationState) {
  const suffix = [state.section, state.subsection].filter(Boolean).join("/");
  const withSuffix = (base: string) => suffix ? `${base}/${suffix}` : base;
  if (state.route === "project" && state.context.projectId) return withSuffix(`project/${state.context.projectId}`);
  if (state.route === "board" && state.context.boardId) {
    return withSuffix(state.context.projectId
      ? `board/${state.context.projectId}/${state.context.boardId}`
      : `board/${state.context.boardId}`);
  }
  if (state.route === "whiteboard" && state.context.whiteboardId) {
    return withSuffix(state.context.projectId
      ? `whiteboard/${state.context.projectId}/${state.context.whiteboardId}`
      : `whiteboard/${state.context.whiteboardId}`);
  }
  return withSuffix(state.route);
}

export function navigationHash(state: AppNavigationState) {
  return `#${serializeNavigationRoute(state)}`;
}

export function navigationParentState(state: AppNavigationState): AppNavigationState | null {
  if (state.subsection) return createNavigationState(state.route, { ...state.context, section: state.section });
  if (state.section) return createNavigationState(state.route, state.context);
  if (state.route === "board" || state.route === "whiteboard") {
    return state.context.projectId
      ? createNavigationState("project", { projectId: state.context.projectId })
      : createNavigationState("projects");
  }
  const parent = routeDefinition(state.route).parent;
  if (!parent || !isAppScreen(parent)) return null;
  return createNavigationState(parent, state.context);
}

export function readNavigationSession(storage: Pick<Storage, "getItem">): AppNavigationState | null {
  try {
    const raw = storage.getItem(NAVIGATION_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return navigationStateFromHistory(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeNavigationSession(storage: Pick<Storage, "setItem">, state: AppNavigationState) {
  try {
    storage.setItem(NAVIGATION_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session restoration is opportunistic. Navigation must still work when storage is unavailable.
  }
}

export function resolveInitialNavigation(input: {
  hash?: string;
  historyState?: unknown;
  sessionState?: AppNavigationState | null;
}): { state: AppNavigationState; source: AppNavigationSource } {
  const rawHash = String(input.hash || "");
  if (rawHash.replace(/^#/, "").trim()) {
    const fromHash = parseNavigationRoute(rawHash);
    if (fromHash) return { state: fromHash, source: "hash" };
    return { state: createNavigationState("dashboard"), source: "invalid" };
  }
  const fromHistory = navigationStateFromHistory(input.historyState);
  if (fromHistory) return { state: fromHistory, source: "history" };
  if (input.sessionState) return { state: input.sessionState, source: "session" };
  return { state: createNavigationState("dashboard"), source: "default" };
}

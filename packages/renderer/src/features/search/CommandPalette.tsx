import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { promptCluster } from "../../components/cluster-dialog-service";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invalidateApiQueries, queryApi } from "../../core/api";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { localId } from "../../core/storage";
import { getNativeRecentWorkspaces, openNativeAppSettings, openNativeServerProfiles, reloadNativeRenderer, type ClusterNativeRecentWorkspace } from "../../core/desktop";
import { copyClusterText } from "../../core/clipboard";
import { createClusterCommandInvocation } from "./cluster-command-invocation";
import { reauthorizeSearchActivation } from "./fresh-search-activation";
import { advanceSearchSessionEpoch, canExposeSearchResult, searchSessionFingerprint } from "./search-session-generation";
import { admitRecentWorkspace, recentWorkspaceIdentity } from "./recent-workspace-admission";
import { canOpenScreen, navigationHash, parseNavigationRoute, screenLabel, type AppScreen } from "../../core/navigation";
import { canonicalWorkspaceFavorite, normalizeWorkspaceFavorites, toggleWorkspaceFavorite, removeWorkspaceFavorite, moveWorkspaceFavorite } from "./navigation-favorites";
import { APPLICATION_ACTION_DEFINITIONS, applicationActionTitle } from "../../core/application-actions";
import { useServerState } from "../../core/server-state";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterFloatingSurface } from "../../components/ClusterFloatingSurface";
import type {
  CommandSearchDiagnostics,
  CommandSearchPayload,
  CommandSearchResult,
  CommandSearchResultKind,
  Project,
  RecentNavigation,
  SavedCommandSearch,
  Settings,
  User,
} from "../application/application-models";
import {
  parseScopedSearch,
  readSearchUsage,
  recordSearchUsage,
  scoreSearchDocument,
  searchKindLabel,
  searchUsageBoost,
  type SearchScope,
} from "./search-ranking";
import { SearchOperatorHelp, SearchOperatorRail, SearchResultPreview } from "./SearchResultDetails";
import { REMOTE_SEARCH_SCOPES, SEARCH_SCOPE_OPTIONS, searchScopeMatches } from "./search-palette-config";
import { recordCommandSearchPerformance } from "./search-performance";
import { useLocalSearchWorker } from "./use-local-search-worker";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import {
  copyWorkLink,
  copyWorkId,
  createRelatedWork,
  requestLinkedWorkManager,
  scheduleWork,
  searchResultWorkContext,
  viewWorkActivity,
  workSourceFromNavigation,
  type ClusterWorkActionContext,
} from "../workflow/work-actions";
import { canOpenDesktopWorkspaceTarget, openCurrentWorkInDesktopWindow, openWorkInDesktopWindow } from "../workflow/workspace-window";
import { openTicketWorkspace } from "../tickets/ticket-navigation";
import { CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT } from "../help/contextual-help";
import { CREATE_MODE_CATALOG } from "../create/create-mode-catalog";
import { availableCreateModes } from "../create/create-mode-access";
import { openSharedCreate } from "../create/shared-create-handoff";
import { CLUSTER_COMMAND_PALETTE_QUERY_EVENT, readPendingCommandPaletteQuery } from "./command-palette-handoff";
import "./search.css";
type PaletteGroup = "context" | "matches" | "recent" | "navigation" | "actions" | "desktop";

const PALETTE_GROUP_LABELS: Record<PaletteGroup, string> = {
  context: "Current context",
  matches: "Matches",
  recent: "Recent",
  navigation: "Navigation",
  actions: "Actions",
  desktop: "Desktop",
};

const COMMAND_DISCOVERY_HINTS: Record<string, { aliases?: string[]; shortcut?: string }> = {
  "desktop-open-current-window": { aliases: ["detach", "new window", "nw"], shortcut: "Ctrl+Enter" },
};

type PaletteItem = {
  key: string;
  kind: CommandSearchResultKind | "action" | "page";
  group: PaletteGroup;
  title: string;
  detail: string;
  keywords?: string[];
  aliases?: string[];
  shortcut?: string | null;
  score: number;
  action: () => void | boolean | Promise<void | boolean>;
  updatedAt?: string | null;
  projectName?: string | null;
  boardName?: string | null;
  listName?: string | null;
  projectTab?: string | null;
  status?: string | null;
  priority?: string | null;
  matchReason?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  personId?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  teamName?: string | null;
  roleName?: string | null;
  presence?: string | null;
  location?: string | null;
  timezone?: string | null;
  labels?: string[];
  categories?: string[];
  flags?: string[];
  relationshipSummary?: CommandSearchResult["relationshipSummary"];
  authoritativeMatch?: boolean;
  workContext?: ClusterWorkActionContext | null;
  remoteSelection?: CommandSearchResult;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  user: User;
  projects: Project[];
  setScreen: (screen: AppScreen) => void;
  onOpenProject: (projectId: string) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenLibrary: (itemId: string, projectId?: string | null) => void;
  onOpenQuickCreate: () => void;
  projectTypeLabel: (project: Project) => string;
  currentScreen: AppScreen;
  currentProjectId?: string | null;
  recentNavigation?: RecentNavigation[];
  settings?: Settings;
};

const WORK_NAVIGATION_SCREENS = new Set(["project", "board", "whiteboard", "tickets", "timeline", "calendar", "scheduler", "library", "people", "activity"]);

function currentWorkTarget(currentScreen: AppScreen, currentProjectId?: string | null): ClusterWorkNavigationTarget | null {
  if (typeof window === "undefined" || !WORK_NAVIGATION_SCREENS.has(currentScreen)) return null;
  const route = parseNavigationRoute(window.location.hash);
  const params = new URLSearchParams(window.location.search);
  const rawInspect = String(params.get("inspect") || "").trim();
  const separator = rawInspect.indexOf(":");
  const inspectScope = separator > 0 ? rawInspect.slice(0, separator) : null;
  const inspectId = separator > 0 ? rawInspect.slice(separator + 1) : null;
  return {
    screen: currentScreen as ClusterWorkNavigationTarget["screen"],
    projectId: currentProjectId || route?.context.projectId || params.get("workProject") || null,
    boardId: route?.context.boardId || null,
    whiteboardId: route?.context.whiteboardId || null,
    projectTab: params.get("projectTab") || null,
    inspectScope,
    inspectId,
  };
}

function contextLabelForTarget(target: ClusterWorkNavigationTarget, project?: Project | null) {
  const scope = String(target.inspectScope || "").replaceAll("-", " ");
  if (target.inspectId && scope) return `Selected ${scope}`;
  if (target.screen === "project" && project?.name) return project.name;
  if (target.screen === "board") return "Current Board";
  if (target.screen === "whiteboard") return "Current Whiteboard";
  return `Current ${target.screen}`;
}
function highlight(value: string, query: string) {
  const tokens = query.trim().split(/\s+/).map((token) => token.trim()).filter((token) => token.length >= 2).slice(0, 8);
  if (!tokens.length) return value;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((left, right) => right.length - left.length);
  const matcher = new RegExp(`(${escaped.join("|")})`, "ig");
  const normalizedTokens = new Set(tokens.map((token) => token.toLowerCase()));
  return value.split(matcher).map((part, index) =>
    normalizedTokens.has(part.toLowerCase()) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  );
}

/** Cached history titles are not fresh access-controlled projections. Do not
 * re-render an old private resource title after a grant is revoked or when a
 * native Desktop recent belongs to an earlier session. */
function recentWorkspaceTitle(route: ReturnType<typeof parseNavigationRoute>, projects: Project[]) {
  if (!route) return "Recent workspace";
  if (route.route === "project") return projects.find((project) => project.id === route.context.projectId)?.name || "Recent Project";
  if (route.route === "board") return projects.flatMap((project) => project.boards).find((board) => board.id === route.context.boardId)?.name || "Recent Board";
  if (route.route === "whiteboard") return "Recent Whiteboard";
  return screenLabel(route.route);
}

function handoffProjectTab(projectId: string, tab: string, _onOpenProject: (projectId: string) => void) {
  openClusterWorkNavigation({ screen: "project", projectId, projectTab: tab });
}

function resultAction(result: CommandSearchResult) {
  const context = searchResultWorkContext(result);
  if (context?.navigation) return () => openClusterWorkNavigation(context.navigation);
  // Activity is a workspace result, even when its referenced resource is gone.
  // Other unresolvable records must not quietly navigate to an unrelated Project.
  if (result.kind === "activity") return () => openClusterWorkNavigation({ screen: "activity", projectId: result.projectId || null });
  return null;
}

function scopeCommand(scope: SearchScope, term: string, user: User, setScreen: (screen: AppScreen) => void): PaletteItem | null {
  if (scope === "ticket" && term && canOpenScreen(user, "tickets")) {
    return {
      key: `scope-ticket-${term}`,
      kind: "action",
      group: "context",
      title: `Search tickets for “${term}”`,
      detail: "Open Tickets with this query applied.",
      score: 500,
      action: () => openTicketWorkspace({ query: term }),
    };
  }
  const screens: Partial<Record<SearchScope, { title: string; detail: string; screen: AppScreen }>> = {
    calendar: { title: "Open Calendar", detail: "Schedule and recurring commitments.", screen: "calendar" },
    build: { title: "Open project Builds", detail: "Build artifacts, gates, and release notes.", screen: "projects" },
    qa: { title: "Open project QA", detail: "Test plans, runs, and release checks.", screen: "projects" },
    scheduler: { title: "Open Scheduler", detail: "Clock, scheduling, and capacity.", screen: "scheduler" },
    activity: { title: "Open Activity", detail: "Recent workspace operations and presence.", screen: user.isAdmin ? "admin" : "activity" },
    inbox: { title: "Open Inbox", detail: "Assignments, mentions, and attention items.", screen: "inbox" },
    settings: { title: "Open Settings", detail: "Preferences, privacy, and shortcuts.", screen: "settings" },
  };
  const target = screens[scope];
  if (!target || !canOpenScreen(user, target.screen)) return null;
  return { key: `scope-${scope}`, kind: "action", group: "context", title: target.title, detail: target.detail, score: 500, action: () => setScreen(target.screen) };
}
export function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, user, projects, setScreen, onOpenProject, onOpenBoard, onOpenWhiteboard, onOpenLibrary, onOpenQuickCreate, projectTypeLabel, currentScreen, currentProjectId, recentNavigation = [], settings } = props;
  const [taskbarSlot, setTaskbarSlot] = useState<HTMLElement | null>(null);
  const searchFieldRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || typeof document === "undefined") { setTaskbarSlot(null); return; }
    const findSlot = () => document.getElementById("cluster-taskbar-search-slot");
    const ready = findSlot();
    if (ready) { setTaskbarSlot(ready); return; }
    // The shell is lazy-loaded. Do not lose Ctrl+K when it is still mounting.
    const observer = new MutationObserver(() => {
      const slot = findSlot();
      if (slot) { setTaskbarSlot(slot); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);
  function closeSearch(restoreFocus = false) {
    if (commandInvocation.current.isExecuting()) return;
    onClose();
    if (restoreFocus) window.requestAnimationFrame(() => document.getElementById("cluster-taskbar-search-trigger")?.focus({ preventScroll: true }));
  }
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [remoteResults, setRemoteResults] = useState<CommandSearchPayload>({ users: [], projects: [], cards: [], results: [] });
  const [remoteResultOwner, setRemoteResultOwner] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const commandInvocation = useRef(createClusterCommandInvocation());
  const [commandBusy, setCommandBusy] = useState(false);
  const commandRunSequence = useRef(0);
  const commandInvocationOwnerRef = useRef("");
  const [commandBusyOwner, setCommandBusyOwner] = useState("");
  const [commandErrorOwner, setCommandErrorOwner] = useState("");
  const [commandError, setCommandError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showOperatorHelp, setShowOperatorHelp] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showFavoritesManager, setShowFavoritesManager] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CommandSearchDiagnostics | null>(null);
  const [diagnosticsOwner, setDiagnosticsOwner] = useState("");
  const diagnosticsSequence = useRef(0);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [savedSearches, setSavedSearches, savedSearchState] = useServerState<SavedCommandSearch[]>("user", "search.saved", []);
  const [recentSearches, setRecentSearches, recentSearchState] = useServerState<string[]>("user", "search.recent", []);
  const [storedFavorites, setStoredFavorites, favoritesState] = useServerState<string[]>("user", "navigation.favorites", []);
  const favoriteRoutes = normalizeWorkspaceFavorites(storedFavorites);
  const commandMode = deferredQuery.trimStart().startsWith(">");
  const commandExpression = commandMode ? deferredQuery.trimStart().slice(1).trimStart() : deferredQuery;
  const parsed = parseScopedSearch(commandExpression);
  const searchTerm = parsed.term;
  const remoteTerm = parsed.expression;
  const operatorSignature = JSON.stringify(parsed.operators);
  const usage = useMemo(() => readSearchUsage(user.id), [user.id, open]);
  const permissionSignature = useMemo(() => JSON.stringify({ role: user.workspaceRole || null, admin: Boolean(user.isAdmin), tools: user.toolPermissions || null, projects: user.projectPermissions || null }), [user.workspaceRole, user.isAdmin, user.toolPermissions, user.projectPermissions]);
  const permissionSignatureRef = useRef(permissionSignature);
  // In addition to aborting effects, render-time ownership masks prevent the
  // previous account's results from appearing even for one render during a
  // synchronous identity or permission change.
  const scopeFingerprint = JSON.stringify([user.id, permissionSignature]);
  const searchSessionEpochRef = useRef({ scope: scopeFingerprint, generation: 0 });
  searchSessionEpochRef.current = advanceSearchSessionEpoch(searchSessionEpochRef.current, scopeFingerprint);
  const searchOwner = searchSessionFingerprint(searchSessionEpochRef.current);
  // A command started under a revoked permission/session must not block the
  // new session while its native/clipboard promise remains unresolved.
  if (commandInvocationOwnerRef.current !== searchOwner) {
    commandInvocationOwnerRef.current = searchOwner;
    commandInvocation.current = createClusterCommandInvocation();
    commandRunSequence.current += 1;
  }
  const currentCommandBusy = commandBusy && commandBusyOwner === searchOwner;
  const currentCommandError = commandErrorOwner === searchOwner ? commandError : "";
  const searchOwnerRef = useRef(searchOwner);
  searchOwnerRef.current = searchOwner;
  const requestIdentity = JSON.stringify([open, searchOwner, query, parsed.scope, remoteTerm, searchEpoch, networkOnline]);
  const requestIdentityRef = useRef(requestIdentity);
  requestIdentityRef.current = requestIdentity;
  const liveActivationContextRef = useRef("");
  const liveActivationContext = JSON.stringify([open, user.id, permissionSignature, query, parsed.scope, remoteTerm, searchEpoch, networkOnline]);
  liveActivationContextRef.current = liveActivationContext;
  useEffect(() => {
    liveActivationContextRef.current = liveActivationContext;
    return () => { liveActivationContextRef.current = ""; };
  }, [liveActivationContext]);
  const projectSearchDocuments = useMemo(() => (!networkOnline ? projects : []).map((project) => ({
    key: `project-${project.id}`,
    title: project.name,
    detail: `${projectTypeLabel(project)} · ${project.clientName || "Internal"} · ${(project.tags || []).join(" ")}`,
    text: `${project.description || ""} ${project.objective || ""} ${project.healthNote || ""}`,
    kind: "project",
    updatedAt: project.updatedAt,
  })), [projects, projectTypeLabel, networkOnline]);
  const localSearch = useLocalSearchWorker(projectSearchDocuments, searchTerm, 100, open && !networkOnline);
  const [desktopRecents, setDesktopRecents] = useState<ClusterNativeRecentWorkspace[]>([]);
  const [desktopRecentsOwner, setDesktopRecentsOwner] = useState("");
  const desktopHost = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const currentProject = currentProjectId ? projects.find((project) => project.id === currentProjectId) || null : null;
  const currentFavoriteTarget = typeof window !== "undefined" ? parseNavigationRoute(window.location.hash) : null;
  const pinnableRoute = currentFavoriteTarget?.route === currentScreen && canOpenScreen(user, currentScreen) &&
    (currentScreen !== "project" || currentFavoriteTarget.context.projectId === currentProjectId && !!currentProject)
    ? currentFavoriteTarget : null;
  const permittedCreateModes = availableCreateModes(user, settings);
  const contextAware = settings?.userSearchContextAware !== false;
  const preferredSearchScope = settings?.userCommandSearchScope || "all";
  const searchUsageContext = useMemo(() => ({ screen: currentScreen, projectId: currentProjectId || null }), [currentScreen, currentProjectId]);
  const activeWorkContext = useMemo<ClusterWorkActionContext | null>(() => {
    if (!canOpenScreen(user, currentScreen)) return null;
    const target = currentWorkTarget(currentScreen, currentProjectId);
    if (target?.projectId && !projects.some((project) => project.id === target.projectId)) return null;
    const source = target ? workSourceFromNavigation(target, contextLabelForTarget(target, currentProject)) : null;
    return target && source ? { source, navigation: target, projectId: target.projectId || null, boardId: target.boardId || null } : null;
  }, [currentScreen, currentProjectId, currentProject?.name, open, projects, user]);

  async function openRecentRoute(route: string): Promise<boolean> {
    const navigation = parseNavigationRoute(route);
    if (!navigation || !canOpenScreen(user, navigation.route)) return false;
    const clickedContext = liveActivationContextRef.current;
    const canUseOfflineCopy = () => {
      const resource = recentWorkspaceIdentity(navigation);
      if (!resource) return true;
      if (resource.kind === "project") return projects.some((project) => project.id === resource.id);
      if (resource.kind === "board") return projects.some((project) =>
        project.boards.some((board) => board.id === resource.id) &&
        // A project Board snapshot is never proof of a standalone Board.
        project.id === resource.projectId);
      // Standalone Whiteboards have no local permission-filtered summary in
      // this palette. Do not claim a durable offline authorization for them.
      return false;
    };
    const success = await admitRecentWorkspace({
      target: navigation, online: networkOnline,
      isCurrent: () => liveActivationContextRef.current === clickedContext,
      hasOfflineCopy: canUseOfflineCopy,
      load: async (kind, id) => queryApi<{ id?: string; projectId?: string | null }>(
        kind === "project" ? `/api/projects/${encodeURIComponent(id)}/snapshot`
          : kind === "board" ? `/api/boards/${encodeURIComponent(id)}`
          : `/api/whiteboards/${encodeURIComponent(id)}`,
        { force: true, persist: false, staleWhileRevalidate: false },
      ),
      navigate: (verified) => {
        // Preserve back/forward and avoid changing the inspector until the
        // current user has passed fresh resource admission.
        const current = new URL(window.location.href);
        current.searchParams.delete("inspect");
        const nextHash = navigationHash({ ...navigation, context: verified.context });
        const nextRoute = { ...navigation, context: verified.context };
        const nextUrl = `${current.pathname}${current.search}${nextHash}`;
        if (window.location.hash === nextHash) window.history.replaceState(nextRoute, "", nextUrl);
        else window.history.pushState(nextRoute, "", nextUrl);
        // pushState does not dispatch hashchange. Explicitly restore the typed
        // route through Cluster's existing navigation listener.
        window.dispatchEvent(new Event("hashchange"));
        return true;
      },
    });
    if (!success && liveActivationContextRef.current === clickedContext) {
      setCommandError("Recent workspace is no longer accessible, changed location, or could not be verified. Refresh before opening it.");
    }
    return success;
  }

  useEffect(() => {
    if (!open) return;
    setQuery(readPendingCommandPaletteQuery() || "");
    setRemoteResults({ users: [], projects: [], cards: [], results: [] });
    setRemoteResultOwner("");
    setSearchError("");
    setActiveIndex(0);
    setShowOperatorHelp(false);
    setShowDiagnostics(false);
    setShowFavoritesManager(false);
    setDiagnostics(null);
    setDiagnosticsOwner("");
    setDiagnosticsError("");
  }, [open, user.id]);
  useEffect(() => {
    const applyQuery = (event: Event) => setQuery(String((event as CustomEvent<string>).detail || "").slice(0, 240));
    window.addEventListener(CLUSTER_COMMAND_PALETTE_QUERY_EVENT, applyQuery);
    return () => window.removeEventListener(CLUSTER_COMMAND_PALETTE_QUERY_EVENT, applyQuery);
  }, []);

  useEffect(() => {
    const online = () => { invalidateApiQueries("/api/command/search"); setNetworkOnline(true); setSearchEpoch((value) => value + 1); };
    const offline = () => setNetworkOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);


  // Search results are authorized snapshots, not enduring grants. Revalidate
  // while the palette is open when another client changes a resource or its ACL.
  // Coalesce bursts through the existing resource-change refresh hook.
  useResourceChangeRefresh(() => {
    setRemoteResults({ users: [], projects: [], cards: [], results: [] });
    setSearchEpoch((value) => value + 1);
  }, { enabled: open, debounceMs: 250, visibleOnly: true });

  useEffect(() => {
    if (permissionSignatureRef.current === permissionSignature) return;
    permissionSignatureRef.current = permissionSignature;
    invalidateApiQueries("/api/command/search");
    if (!open) return;
    setRemoteResults({ users: [], projects: [], cards: [], results: [] });
    setSearchEpoch((value) => value + 1);
  }, [permissionSignature, user.id, open]);

  useEffect(() => {
    setDesktopRecentsOwner("");
    if (!open || !desktopHost) {
      setDesktopRecents([]);
      return;
    }
    let active = true;
    const owner = searchOwner;
    getNativeRecentWorkspaces()
      .then((items) => {
        if (!active || searchOwnerRef.current !== owner) return;
        setDesktopRecents(Array.isArray(items) ? items.slice(0, 8) : []);
        setDesktopRecentsOwner(owner);
      })
      .catch(() => { if (active && searchOwnerRef.current === owner) { setDesktopRecents([]); setDesktopRecentsOwner(owner); } });
    return () => { active = false; };
  }, [open, desktopHost, searchOwner]);

  useEffect(() => {
    if (!open) return;
    // Never display results belonging to a previous query, scope or permission
    // projection while a new remote request is being debounced.
    setRemoteResultOwner("");
    setRemoteResults({ users: [], projects: [], cards: [], results: [] });
    setSearching(false);
    setSearchError("");
    if (!REMOTE_SEARCH_SCOPES.has(parsed.scope)) return;
    const term = remoteTerm.trim();
    if (!networkOnline) {
      setRemoteResults({ users: [], projects: [], cards: [], results: [] });
      setSearching(false);
      setSearchError("Offline · showing local and navigation results only.");
      return;
    }
    if (searchTerm.trim().length < 2 && Object.keys(parsed.operators).length === 0) {
      setRemoteResults({ users: [], projects: [], cards: [], results: [] });
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const owner = requestIdentity;
    const isCurrent = () => canExposeSearchResult(owner, requestIdentityRef.current, controller.signal.aborted);
    const handle = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      const params = new URLSearchParams({ q: term, scope: parsed.scope, limit: "40" });
      queryApi<CommandSearchPayload>(`/api/command/search?${params}`, { signal: controller.signal, force: true, persist: false, staleWhileRevalidate: false })
        .then((payload) => {
          if (!isCurrent()) return;
          setRemoteResultOwner(owner);
          setRemoteResults(payload);
          setSearchError("");
          recordCommandSearchPerformance(payload);
        })
        .catch((error) => {
          if (!isCurrent()) return;
          setRemoteResultOwner("");
          setRemoteResults({ users: [], projects: [], cards: [], results: [] });
          setSearchError(error instanceof Error ? error.message : "Search failed.");
        })
        .finally(() => {
          if (isCurrent()) setSearching(false);
        });
    }, 90);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [open, parsed.scope, operatorSignature, remoteTerm, searchTerm, query, networkOnline, searchEpoch, searchOwner]);

  const items = useMemo(() => {
    const baseActions = (
      [
        { key: "action-help", title: "Help & common tasks", detail: "Open contextual guidance for the current Cluster workspace", keywords: ["help", "guide", "what is this", "troubleshoot", "shortcuts", "documentation"], aliases: ["?", "help"], group: "actions" as const, kind: "action" as const, action: () => window.dispatchEvent(new Event(CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT)) },
        ...(permittedCreateModes.length ? [{ key: "action-create", title: "Quick create", detail: "Choose from the tools you can create in", keywords: ["new", "add", "make", "create", "qc"], aliases: ["qc", "new"], group: "actions" as const, kind: "action" as const, action: onOpenQuickCreate }] : []),
        // Direct Create commands are generated from the same canonical modes,
        // permissions and Studio availability as the Create drawer. Only expose
        // them while the user is actively searching, not on an empty palette.
        ...(searchTerm || commandMode ? CREATE_MODE_CATALOG.filter((entry) => permittedCreateModes.includes(entry.id)).map((entry) => ({
          key: `action-create-${entry.id}`,
          title: `Create ${entry.label}`,
          detail: entry.detail,
          keywords: ["create", "new", "add", ...entry.keywords],
          group: "actions" as const,
          kind: "action" as const,
          action: () => openSharedCreate(entry.id, entry.id !== "project" && currentProject ? { projectId: currentProject.id } : {}),
        })) : []),
        ...(user.isAdmin && canOpenScreen(user, "studioSettings") ? [
          { key: "action-compose-announcement", title: "Compose studio announcement", detail: "Open the announcement draft editor in Studio Settings", keywords: ["announcement", "broadcast", "communications", "publish", "compose"], aliases: ["new announcement"], group: "actions" as const, kind: "action" as const, action: () => openClusterWorkNavigation({ screen: "studioSettings", inspectScope: "studio-announcement-new", inspectId: "new" }) },
          { key: "action-review-announcements", title: "Review studio announcements", detail: "Review drafts, schedules, publication status and delivery evidence", keywords: ["announcements", "communication", "reports", "delivery"], group: "navigation" as const, kind: "action" as const, action: () => openClusterWorkNavigation({ screen: "studioSettings", inspectScope: "studio-announcement-list", inspectId: "list" }) },
        ] : []),
        { key: "action-back", title: "Go back", detail: "Return to the previous Cluster workspace", keywords: ["previous", "history", "back", "gb"], aliases: ["back", "gb"], shortcut: "Alt+←", group: "navigation" as const, kind: "action" as const, action: () => window.history.back() },
        { key: "action-forward", title: "Go forward", detail: "Move forward in Cluster navigation history", keywords: ["next", "history", "forward", "gf"], aliases: ["forward", "gf"], shortcut: "Alt+→", group: "navigation" as const, kind: "action" as const, action: () => window.history.forward() },
        { key: "action-copy-current-link", title: "Copy current workspace link", detail: "Copy a durable link including the current inspector context", keywords: ["permalink", "url", "deep link", "share", "cl"], aliases: ["copy link", "cl"], group: "actions" as const, kind: "action" as const, action: () => copyClusterText(window.location.href) },
        ...APPLICATION_ACTION_DEFINITIONS
          .filter((definition) => definition.id !== "navigation.home")
          .filter((definition) => definition.group !== "desktop" || desktopHost)
          .map((definition) => ({
            key: definition.paletteKey || definition.id,
            title: applicationActionTitle(definition),
            detail: definition.description,
            keywords: [...(definition.keywords || [])],
            aliases: [...(definition.aliases || [])],
            group: definition.group,
            kind: "page" as const,
            screen: definition.route,
          })),
        ...(desktopHost
          ? [
              { key: "desktop-open-current-window", title: "Open current workspace in a new window", detail: "Detach the current project, Board, Whiteboard, or production workspace", keywords: ["detach", "window", "multi window"], group: "desktop" as const, kind: "action" as const, action: () => openCurrentWorkInDesktopWindow(undefined, document.title) },
              { key: "desktop-app-settings", title: "Desktop app settings", detail: "Open native Cluster Desktop preferences · Ctrl+,", keywords: ["preferences"], group: "desktop" as const, kind: "action" as const, action: () => openNativeAppSettings() },
              { key: "desktop-server-profiles", title: "Manage desktop servers", detail: "Switch or manage isolated server profiles · Ctrl+Shift+P", keywords: ["people", "connections"], group: "desktop" as const, kind: "action" as const, action: () => openNativeServerProfiles() },
              { key: "desktop-reload", title: "Reload desktop workspace", detail: "Reload the shared renderer · Ctrl+R", keywords: ["refresh"], group: "desktop" as const, kind: "action" as const, action: () => reloadNativeRenderer() },
            ]
          : []),
      ]
    ).filter((item) => !("screen" in item) || (item.screen !== undefined && canOpenScreen(user, item.screen)));

    // Online project matches are authoritative server results only. Existing
    // signed-in cached Projects remain searchable while genuinely offline.
    const localProjects: PaletteItem[] = (!networkOnline ? projects : []).map((project) => ({
      key: `project-${project.id}`,
      kind: "project",
      group: "matches",
      title: project.name,
      detail: `${projectTypeLabel(project)} · ${project.clientName || "Internal"}${project.targetDate ? ` · ${new Date(project.targetDate).toLocaleDateString()}` : ""}`,
      updatedAt: project.updatedAt,
      score: 0,
      workContext: { source: { kind: "project", id: project.id, projectId: project.id, label: project.name }, navigation: { screen: "project", projectId: project.id }, projectId: project.id },
      action: () => onOpenProject(project.id),
    }));

    const freshRemoteList = networkOnline && canExposeSearchResult(remoteResultOwner, requestIdentity) && !commandMode && query === deferredQuery && remoteResults.meta?.query === remoteTerm && remoteResults.meta?.scope === parsed.scope
      ? remoteResults.results || [] : [];
    const remote: PaletteItem[] = freshRemoteList.flatMap((result) => {
      const action = resultAction(result);
      if (!action) return [];
      return [{
        key: `${result.kind}-${result.id}`,
        kind: result.kind,
        group: "matches",
        title: result.title,
        detail: result.relationshipSummary?.total ? `${result.detail} · ${result.relationshipSummary.total} linked${result.relationshipSummary.blockers ? ` · ${result.relationshipSummary.blockers} blocker${result.relationshipSummary.blockers === 1 ? "" : "s"}` : result.relationshipSummary.critical ? ` · ${result.relationshipSummary.critical} critical` : ""}` : result.detail,
        updatedAt: result.updatedAt,
        projectName: result.projectName,
        boardName: result.boardName,
        listName: result.listName,
        projectTab: result.projectTab,
        status: result.status,
        priority: result.priority,
        matchReason: result.matchReason,
        createdAt: result.createdAt,
        dueDate: result.dueDate,
        personId: result.personId,
        avatarUrl: result.avatarUrl,
        department: result.department,
        teamName: result.teamName,
        roleName: result.roleName,
        presence: result.presence,
        location: result.location,
        timezone: result.timezone,
        labels: result.labels,
        categories: result.categories,
        flags: result.flags,
        relationshipSummary: result.relationshipSummary,
        authoritativeMatch: true,
        remoteSelection: result,
        workContext: searchResultWorkContext(result),
        score: (result.score || 0) + (currentProjectId && result.projectId === currentProjectId ? 72 : 0) + ((currentScreen === "timeline" && result.kind === "timeline") || (currentScreen === "calendar" && result.kind === "calendar") || (currentScreen === "library" && result.kind === "file") || (currentScreen === "people" && result.kind === "person") ? 36 : 0),
        action,
      }];
    });

    const desktopRecentItems: PaletteItem[] = (canExposeSearchResult(desktopRecentsOwner, searchOwner) ? desktopRecents : []).filter((item) => {
      const navigation = parseNavigationRoute(item.route);
      return navigation && canOpenScreen(user, navigation.route) &&
        (navigation.route !== "project" || projects.some((project) => project.id === navigation.context.projectId)) &&
        (!navigation.context.projectId || projects.some((project) => project.id === navigation.context.projectId));
    }).map((item) => ({
      key: `desktop-recent-${item.kind}-${item.resourceId}-${item.route}`,
      kind: "action",
      group: "recent",
      title: recentWorkspaceTitle(parseNavigationRoute(item.route), projects),
      detail: `Recent ${item.kind} · Desktop`,
      updatedAt: item.lastOpenedAt,
      score: 24,
      action: () => openRecentRoute(item.route),
    }));
    const recentNavigationItems: PaletteItem[] = recentNavigation.flatMap((item) => {
      const navigation = parseNavigationRoute(item.route);
      if (!navigation || !canOpenScreen(user, navigation.route)) return [];
      if (navigation.route === "project" && !projects.some((project) => project.id === navigation.context.projectId)) return [];
      if ((navigation.route === "board" || navigation.route === "whiteboard") && navigation.context.projectId &&
        !projects.some((project) => project.id === navigation.context.projectId)) return [];
      return [{
        key: `recent-navigation-${item.route}`,
        kind: "page" as const,
        group: "recent" as const,
        title: recentWorkspaceTitle(navigation, projects),
        detail: `Recently visited · ${screenLabel(navigation.route)}`,
        keywords: [navigation.route, "recent", "history", "visited"],
        updatedAt: item.visitedAt,
        score: 32,
        action: () => openRecentRoute(item.route),
      }];
    });

    const favoriteItems: PaletteItem[] = favoriteRoutes.flatMap((saved) => {
      // Favorite data comes from user-owned preferences but is not an access
      // grant. Never display stale private titles; every Open uses the same
      // fresh, permission-protected route admission as Recent workspaces.
      const navigation = parseNavigationRoute(saved);
      if (!navigation || !canOpenScreen(user, navigation.route)) return [];
      if (navigation.route === "project" && !projects.some((project) => project.id === navigation.context.projectId)) return [];
      if ((navigation.route === "board" || navigation.route === "whiteboard") && navigation.context.projectId &&
          !projects.some((project) => project.id === navigation.context.projectId)) return [];
      return [{
        key: `favorite-navigation-${saved}`,
        kind: "page" as const,
        group: "recent" as const,
        title: navigation.route === "project" ? recentWorkspaceTitle(navigation, projects) : `Favorite ${screenLabel(navigation.route)}`,
        detail: `Favorite · ${screenLabel(navigation.route)}`,
        keywords: ["favorite", "pinned", "bookmark", navigation.route],
        score: 66,
        action: () => openRecentRoute(saved),
      }];
    });

    const localActions: PaletteItem[] = baseActions.map((item) => {
      const discovery = COMMAND_DISCOVERY_HINTS[item.key] || {};
      return {
        key: item.key,
        kind: item.kind,
        group: item.group,
        title: item.title,
        detail: item.detail,
        keywords: "keywords" in item ? item.keywords : undefined,
        aliases: "aliases" in item && item.aliases ? item.aliases : discovery.aliases,
        shortcut: "shortcut" in item && item.shortcut ? item.shortcut : discovery.shortcut || null,
        score: 0,
        action: "action" in item && item.action ? item.action : () => setScreen((item as { screen: AppScreen }).screen),
      };
    });

    const favoriteToggleAction: PaletteItem[] = pinnableRoute && canonicalWorkspaceFavorite(window.location.hash) ? [{
      key: "action-toggle-workspace-favorite",
      kind: "action" as const,
      group: "context" as const,
      title: favoriteRoutes.includes(canonicalWorkspaceFavorite(window.location.hash)!) ? "Remove current workspace favorite" : "Favorite current workspace",
      detail: "Save or remove this workspace from your account's quick navigation.",
      aliases: ["favorite", "pin workspace", "bookmark", "unpin"],
      score: 110,
      action: () => setStoredFavorites((current) => toggleWorkspaceFavorite(current, pinnableRoute)),
    }] : [];

    const activeWorkActions: PaletteItem[] = activeWorkContext ? [
      { key: `context-work-open-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action", group: "context", title: `Open ${activeWorkContext.source.label || "current work"}`, detail: "Open the currently selected or inspected work using canonical navigation.", aliases: ["open selection", "open current"], score: 118, workContext: activeWorkContext, action: () => openClusterWorkNavigation(activeWorkContext.navigation!) },
      { key: `context-work-related-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action", group: "context", title: "Create related work", detail: `Create linked follow-up work from ${activeWorkContext.source.label || "the current selection"}.`, aliases: ["related", "follow up", "cr"], score: 112, action: () => createRelatedWork(activeWorkContext) },
      ...(activeWorkContext.projectId ? [{ key: `context-work-link-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action" as const, group: "context" as const, title: "Manage linked work", detail: "Link this selection to existing project work.", aliases: ["link", "relationships", "lw"], score: 110, action: () => requestLinkedWorkManager(activeWorkContext) }] : []),
      ...(activeWorkContext.source.kind !== "user" ? [{ key: `context-work-schedule-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action" as const, group: "context" as const, title: "Schedule selected work", detail: "Create a Calendar commitment linked to the current selection.", aliases: ["schedule", "calendar", "sc"], score: 108, action: () => scheduleWork(activeWorkContext) }] : []),
      ...(activeWorkContext.navigation ? [{ key: `context-work-copy-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action" as const, group: "context" as const, title: "Copy selected work link", detail: "Copy a durable deep link to the exact selected or inspected work.", aliases: ["copy selected link", "permalink"], score: 104, action: () => copyWorkLink(activeWorkContext) }] : []),
      { key: `context-work-id-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action" as const, group: "context" as const, title: "Copy selected work ID", detail: "Copy the canonical ID of the selected resource.", aliases: ["copy ID", "resource ID", "identifier"], score: 102, action: () => copyWorkId(activeWorkContext) },
      { key: `context-work-activity-${activeWorkContext.source.kind}-${activeWorkContext.source.id}`, kind: "action", group: "context", title: "View selected work activity", detail: "Open Activity filtered to this work item.", aliases: ["activity", "history", "va"], score: 102, action: () => viewWorkActivity(activeWorkContext) },
    ] : [];

    const currentProjectActions: PaletteItem[] = currentProject ? ([
      ["overview", "Open project overview", "Dashboard, status, and current project context", ["home", "summary"]],
      ["builds", "Open project Builds", "Artifacts, release gates, and delivery history", ["build", "artifact"]],
      ["qa", "Open project QA", "Test plans, runs, reports, and verification", ["test", "quality"]],
      ["control", "Open project Control", "Risks, decisions, blockers, and operating control", ["risk", "decision"]],
      ["library", "Open project Library", "Project files, references, and assets", ["files", "assets"]],
    ] as const).map(([tab, title, detail, keywords]) => ({
      key: `context-project-${currentProject.id}-${tab}`,
      kind: "action",
      group: "context",
      title,
      detail: `${currentProject.name} · ${detail}`,
      keywords: [...keywords, currentProject.name],
      score: contextAware ? 92 : 24,
      action: () => handoffProjectTab(currentProject.id, tab, onOpenProject),
    })) : [];

    const scoped = scopeCommand(parsed.scope, searchTerm, user, setScreen);
    const deduped = new Map<string, PaletteItem>();
    const workspaceOnly = !commandMode && !parsed.explicit && preferredSearchScope === "workspace";
    const commandCandidates = commandMode
      ? [...favoriteToggleAction, ...activeWorkActions, ...currentProjectActions, ...(scoped ? [scoped] : []), ...localActions, ...favoriteItems, ...recentNavigationItems, ...desktopRecentItems]
      : workspaceOnly
        ? [...favoriteToggleAction, ...activeWorkActions, ...currentProjectActions, ...(scoped ? [scoped] : []), ...favoriteItems, ...recentNavigationItems, ...desktopRecentItems, ...localProjects, ...remote]
        : [...favoriteToggleAction, ...activeWorkActions, ...currentProjectActions, ...(scoped ? [scoped] : []), ...localActions, ...favoriteItems, ...recentNavigationItems, ...desktopRecentItems, ...localProjects, ...remote];
    for (const item of commandCandidates) {
      if (!searchScopeMatches(parsed.scope, item.kind) && item !== scoped) continue;
      const existing = deduped.get(item.key);
      if (!existing || item.score > existing.score) deduped.set(item.key, item);
    }
    const currentPreferenceBoost = preferredSearchScope === "current" ? 1.45 : 1;
    const scored = [...deduped.values()]
      .map((item) => {
        const usageBoost = searchUsageBoost(usage, item.key, searchUsageContext);
        const contextBoost = !contextAware
          ? 0
          : item === scoped
            ? 120
            : item.group === "context"
              ? Math.round(86 * currentPreferenceBoost)
              : item.kind === "action" || item.kind === "page"
                ? (commandMode ? 90 : currentScreen && item.detail.toLowerCase().includes(currentScreen.toLowerCase()) ? 34 : 12)
                : item.kind === "project" && currentProjectId && item.key === `project-${currentProjectId}`
                  ? Math.round(70 * currentPreferenceBoost)
                  : 0;
        let relevance: number;
        if (item.kind === "project" && localSearch.workerReady && !item.authoritativeMatch) {
          const workerScore = localSearch.scores.get(item.key);
          relevance = workerScore === undefined ? -1 : workerScore + usageBoost + contextBoost;
        } else {
          relevance = scoreSearchDocument(
            {
              id: item.key,
              kind: item.kind,
              title: item.title,
              detail: item.detail,
              keywords: [...(item.keywords || []), ...(item.aliases || [])],
              updatedAt: item.updatedAt,
              usageBoost,
              contextBoost,
            },
            searchTerm,
          );
        }
        const matched = !searchTerm || item === scoped || item.authoritativeMatch === true || relevance >= 0;
        return { ...item, score: item.score + Math.max(0, relevance), matched };
      })
      .filter((item) => item.matched);

    const groupOrder: PaletteGroup[] = commandMode
      ? ["context", "actions", "navigation", "desktop", "recent", "matches"]
      : searchTerm
        ? ["matches", "context", "navigation", "actions", "recent", "desktop"]
        : preferredSearchScope === "workspace"
          ? ["context", "recent", "matches", "navigation", "actions", "desktop"]
          : ["context", "recent", "navigation", "actions", "matches", "desktop"];
    const groupRank = new Map(groupOrder.map((group, index) => [group, index]));
    return scored
      .sort((a, b) => (groupRank.get(a.group) ?? 99) - (groupRank.get(b.group) ?? 99) || b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 40);
  }, [projects, remoteResults, remoteResultOwner, requestIdentity, recentNavigation, desktopRecents, desktopRecentsOwner, searchOwner, desktopHost, parsed.scope, parsed.explicit, remoteTerm, searchTerm, query, deferredQuery, user, usage, localSearch.workerReady, localSearch.scores, networkOnline, onOpenQuickCreate, onOpenProject, onOpenBoard, onOpenWhiteboard, onOpenLibrary, projectTypeLabel, setScreen, commandMode, currentProjectId, currentScreen, currentProject, contextAware, preferredSearchScope, searchUsageContext, activeWorkContext, settings, storedFavorites, currentScreen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, items.length, items[0]?.key]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function rememberSearch() {
    const value = query.trim();
    if (!value) return;
    setRecentSearches([value, ...recentSearches.filter((item) => item !== value)].slice(0, 10));
  }

  function invokeCommand(item: PaletteItem, action: PaletteItem["action"]) {
    const invocationContext = liveActivationContextRef.current;
    const attempt = commandInvocation.current.run(action);
    if (!attempt) return; // Immediate protection from double Enter/click.
    const runId = ++commandRunSequence.current;
    setCommandBusyOwner(searchOwner);
    setCommandBusy(true);
    setCommandErrorOwner(searchOwner);
    setCommandError("");
    void attempt.then((successful) => {
      // A prior session's completion cannot close this palette, report an
      // error or touch this session's search usage history.
      if (liveActivationContextRef.current !== invocationContext || commandRunSequence.current !== runId) return;
      if (!successful) {
        setCommandError((previous) => previous || "Command could not be confirmed. Check its result before retrying.");
        return;
      }
      rememberSearch();
      recordSearchUsage(user.id, item.key, searchUsageContext);
      onClose();
    }).finally(() => {
      if (liveActivationContextRef.current === invocationContext && commandRunSequence.current === runId) setCommandBusy(false);
    });
  }

  async function freshRemoteAction(item: PaletteItem, detached: boolean): Promise<boolean> {
    const selected = item.remoteSelection;
    if (!selected || !networkOnline || commandMode || query !== deferredQuery) return false;
    const contextAtClick = liveActivationContextRef.current;
    const expression = remoteTerm;
    const scope = parsed.scope;
    try {
      // Command Search uses an uncached, per-request authorization and live
      // resource admission path. The original list is not a view capability.
      const params = new URLSearchParams({ q: expression, scope, limit: "40" });
      const admitted = await reauthorizeSearchActivation({
        selected, expression, scope,
        isCurrent: () => liveActivationContextRef.current === contextAtClick,
        load: () => queryApi<CommandSearchPayload>(`/api/command/search?${params}`, {
          force: true, persist: false, staleWhileRevalidate: false,
        }),
        navigate: async (fresh) => {
          const action = resultAction(fresh);
          if (!action) return false;
          const target = searchResultWorkContext(fresh)?.navigation;
          if (detached && target && canOpenDesktopWorkspaceTarget(target)) {
            return (await openWorkInDesktopWindow(target, fresh.title)) !== false;
          }
          return (await action()) !== false;
        },
      });
      if (!admitted && liveActivationContextRef.current === contextAtClick) {
        setCommandError("Access could not be reconfirmed or this result moved. Refresh the search before opening it.");
        setSearchEpoch((value) => value + 1);
      }
      return admitted;
    } catch {
      if (liveActivationContextRef.current === contextAtClick) {
        setCommandError("Could not recheck access to this result. Nothing was opened; retry the search.");
      }
      return false;
    }
  }

  function run(item: PaletteItem) {
    invokeCommand(item, item.remoteSelection ? () => freshRemoteAction(item, false) : item.action);
  }

  function runInWindow(item: PaletteItem) {
    if (item.remoteSelection) {
      invokeCommand(item, () => freshRemoteAction(item, true));
      return;
    }
    const navigation = item.workContext?.navigation;
    if (!navigation || !canOpenDesktopWorkspaceTarget(navigation)) {
      run(item);
      return;
    }
    invokeCommand(item, () => openWorkInDesktopWindow(navigation, item.title));
  }

  async function saveCurrentSearch() {
    const value = query.trim();
    if (!value || savedSearches.some((item) => item.query === value)) return;
    const owner = liveActivationContextRef.current;
    const chosenName = await promptCluster({ title: "Save search", message: "Give this saved search a recognizable name.", label: "Search name", initialValue: value, confirmLabel: "Save search" });
    if (liveActivationContextRef.current !== owner || chosenName == null) return;
    const name = chosenName || value;
    setSavedSearches(
      [{ id: localId("search"), name: name.trim() || value, query: value, createdAt: new Date().toISOString(), pinned: false, lastUsedAt: null }, ...savedSearches].slice(0, 30),
    );
  }

  function useSavedSearch(item: SavedCommandSearch) {
    const now = new Date().toISOString();
    setSavedSearches(savedSearches.map((saved) => saved.id === item.id ? { ...saved, lastUsedAt: now } : saved));
    setQuery(item.query);
  }

  function toggleSavedSearchPin(item: SavedCommandSearch) {
    setSavedSearches(savedSearches.map((saved) => saved.id === item.id ? { ...saved, pinned: !saved.pinned } : saved));
  }

  function loadDiagnostics() {
    if (!open || !showDiagnostics || !user.isAdmin) return;
    const owner = searchOwner;
    const requestId = ++diagnosticsSequence.current;
    const isCurrent = () => diagnosticsSequence.current === requestId && searchOwnerRef.current === owner;
    setDiagnosticsError("");
    queryApi<{ ok: true; diagnostics: CommandSearchDiagnostics }>("/api/command/search/diagnostics", { force: true, staleMs: 0, persist: false })
      .then((payload) => {
        if (!isCurrent()) return;
        setDiagnostics(payload.diagnostics);
        setDiagnosticsOwner(owner);
      })
      .catch((error) => {
        if (!isCurrent()) return;
        setDiagnostics(null);
        setDiagnosticsOwner("");
        setDiagnosticsError(error instanceof Error ? error.message : "Search diagnostics unavailable.");
      });
  }

  function toggleDiagnostics() {
    setShowDiagnostics((value) => !value);
  }

  useEffect(() => {
    diagnosticsSequence.current += 1;
    setDiagnostics(null);
    setDiagnosticsOwner("");
    setDiagnosticsError("");
  }, [searchOwner, open, showDiagnostics, user.isAdmin]);

  useEffect(() => {
    if (!open || !showDiagnostics || !user.isAdmin) return;
    loadDiagnostics();
    return () => { diagnosticsSequence.current += 1; };
  }, [open, showDiagnostics, user.isAdmin, searchOwner]);

  useVisibleRefresh(() => loadDiagnostics(), { enabled: open && showDiagnostics && user.isAdmin, intervalMs: 5_000 });

  function selectScope(scope: SearchScope) {
    const expression = parsed.expression.trim();
    setQuery(scope === "all" ? expression : `${scope}: ${expression}`);
  }

  const resultMeta = canExposeSearchResult(remoteResultOwner, requestIdentity) ? remoteResults.meta : null;
  const visibleDiagnostics = user.isAdmin && showDiagnostics && canExposeSearchResult(diagnosticsOwner, searchOwner) ? diagnostics : null;
  const groupCounts = items.reduce((counts, item) => ({ ...counts, [item.group]: (counts[item.group] || 0) + 1 }), {} as Partial<Record<PaletteGroup, number>>);
  const activeItem = items[activeIndex] || null;
  return (
    <>
      {taskbarSlot ? createPortal(<div className="search-command-input-v294 cluster-taskbar-search-field-v546" ref={searchFieldRef}>

          <ClusterIcon name="search" aria-hidden="true" />
          <ClusterTextInput
            autoFocus
            type={commandMode ? "text" : "search"}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="cluster-search-results"
            aria-activedescendant={items[activeIndex] ? `cluster-search-result-${activeIndex}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch(true);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => items.length ? Math.min(items.length - 1, index + 1) : 0);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Home") {
                event.preventDefault();
                setActiveIndex(0);
              }
              if (event.key === "End") {
                event.preventDefault();
                setActiveIndex(Math.max(0, items.length - 1));
              }
              if (event.key === "PageDown") {
                event.preventDefault();
                setActiveIndex((index) => items.length ? Math.min(items.length - 1, index + 8) : 0);
              }
              if (event.key === "PageUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 8));
              }
              if (event.key === "Enter" && items[activeIndex]) {
                event.preventDefault();
                if ((event.ctrlKey || event.metaKey) && desktopHost) runInWindow(items[activeIndex]);
                else run(items[activeIndex]);
              }
            }}
            placeholder={commandMode ? "Run a command…" : "Search everything… use > for commands, or try is:overdue"}
          />
          {searching && <span className="search-command-spinner-v294" aria-label="Searching" />}
          {!commandMode && <ClusterButton className="" type="button" aria-pressed={showOperatorHelp} onClick={() => setShowOperatorHelp((value) => !value)} variant="quiet" size="compact">Operators</ClusterButton>}
          {!commandMode && <ClusterButton type="button" className="" disabled={!query.trim()} onClick={saveCurrentSearch} variant="quiet" size="compact">Save</ClusterButton>}
          <ClusterButton type="button" className="cluster-taskbar-search-field__close" onClick={() => closeSearch(true)} variant="quiet" size="compact" aria-label="Close search"><ClusterIcon name="close" /></ClusterButton>
        </div>, taskbarSlot) : null}
      <ClusterFloatingSurface
        open={Boolean(open && taskbarSlot)}
        anchorRef={searchFieldRef}
        placement="bottom-start"
        mobileMode="popover"
        label="Cluster search results"
        id="cluster-command-palette"
        aria-describedby="cluster-search-status"
        className="panel search-command-palette-v294 cluster-taskbar-search-results-v546"
        onDismiss={(reason) => closeSearch(reason === "escape")}
      >
        <div className="search-mode-strip-v415" aria-label="Search mode">
          <ClusterButton unstyled type="button" className={!commandMode ? "active" : ""} aria-pressed={!commandMode} onClick={() => setQuery((value) => value.trimStart().startsWith(">") ? value.trimStart().slice(1).trimStart() : value)}>Search</ClusterButton>
          <ClusterButton unstyled type="button" className={commandMode ? "active" : ""} aria-pressed={commandMode} onClick={() => setQuery((value) => value.trimStart().startsWith(">") ? value : `> ${value}`)}>Commands</ClusterButton>
          {(favoriteRoutes.length > 0 || showFavoritesManager) && <ClusterButton type="button" variant="quiet" size="compact" aria-expanded={showFavoritesManager} onClick={() => setShowFavoritesManager((value) => !value)}>{showFavoritesManager ? "Close favorites" : `Manage favorites (${favoriteRoutes.length})`}</ClusterButton>}
          <span>{preferredSearchScope === "workspace" ? "Workspace content" : preferredSearchScope === "current" ? "Current context first" : currentProjectId && contextAware ? "Current project boosted" : "Workspace ranking"}</span>
        </div>

        {!commandMode && <nav className="search-command-scopes-v294" aria-label="Search scope">
          {SEARCH_SCOPE_OPTIONS.map((scope) => (
            <ClusterButton unstyled
              key={scope.value}
              type="button"
              aria-pressed={parsed.scope === scope.value}
              className={parsed.scope === scope.value ? "active" : ""}
              onClick={() => selectScope(scope.value)}
            >
              {scope.label}
            </ClusterButton>
          ))}
        </nav>}

        <div id="cluster-search-status" className="search-command-status-v294" aria-live="polite">
          <span>{commandMode ? "Command mode" : parsed.explicit ? `Scope: ${parsed.scope}` : preferredSearchScope === "workspace" ? "Workspace content only · use a scope prefix to override" : currentProjectId && contextAware ? "Context-aware search · current project first" : "All searchable work"}</span>
          <span>{searchError || (resultMeta ? `${resultMeta.count} results · ${resultMeta.elapsedMs} ms${resultMeta.cached ? " · ranking reused" : ""}${resultMeta.rebuilding || resultMeta.indexDirty ? " · refreshing index" : ""}${user.isAdmin && resultMeta.refreshingProjects ? ` · ${resultMeta.refreshingProjects} project refresh${resultMeta.refreshingProjects === 1 ? "" : "es"}` : ""}` : searching ? "Searching…" : `${items.length} result${items.length === 1 ? "" : "s"}${!networkOnline && localSearch.workerReady ? ` · local index ${localSearch.elapsedMs} ms` : ""}`)}</span>
          {user.isAdmin && <ClusterButton type="button" className="" aria-pressed={showDiagnostics} onClick={toggleDiagnostics} variant="quiet" size="compact">Diagnostics</ClusterButton>}
        </div>
        {currentCommandError ? <div className="search-command-action-error-v546" role="alert">{currentCommandError}</div> : null}
        {(!networkOnline || searchError) && (
          <div className="search-degraded-v495" role="status">
            <span><strong>{networkOnline ? "Server search degraded" : "Offline search"}</strong> · {networkOnline ? "Local resource matches are unavailable until the server recovers; recent navigation and commands remain available." : "Using the local project index, recent work, and commands until the server reconnects."}</span>
            {networkOnline && <ClusterButton type="button" className="" onClick={() => { invalidateApiQueries("/api/command/search"); setSearchEpoch((value) => value + 1); }} variant="quiet" size="compact">Retry</ClusterButton>}
          </div>
        )}
        {user.isAdmin && showDiagnostics && (
          <section className="search-diagnostics-v495" aria-label="Search diagnostics">
            {diagnosticsError ? <span>{diagnosticsError}</span> : visibleDiagnostics ? (
              <>
                <div><strong>{visibleDiagnostics.totalIndexed.toLocaleString()}</strong><span>Indexed records</span></div>
                <div><strong>{visibleDiagnostics.indexAgeMs == null ? "—" : `${Math.max(0, Math.round(visibleDiagnostics.indexAgeMs / 1000))}s`}</strong><span>Index age</span></div>
                <div><strong>{visibleDiagnostics.cacheEntries}</strong><span>Cached queries</span></div>
                <div><strong>{visibleDiagnostics.refreshingProjects}</strong><span>Project refreshes</span></div>
                <div><strong>{visibleDiagnostics.queuedProjectRefreshes || 0}</strong><span>Queued refreshes</span></div>
                <div><strong>{visibleDiagnostics.rebuilding ? "Rebuilding" : visibleDiagnostics.dirty ? "Refresh queued" : "Healthy"}</strong><span>Index state</span></div>
                <div><strong>{visibleDiagnostics.indexRevision ?? "—"}</strong><span>Index revision</span></div>
                <div><strong>{visibleDiagnostics.totalSearches ? `${Math.round(((visibleDiagnostics.cacheHits || 0) / Math.max(1, visibleDiagnostics.totalSearches)) * 100)}%` : "—"}</strong><span>Cache hit rate</span></div>
                <div><strong>{visibleDiagnostics.slowestSearchElapsedMs ?? 0} ms</strong><span>Slowest search</span></div>
                {visibleDiagnostics.corpus && <div><strong>{visibleDiagnostics.corpus.relationships.toLocaleString()}</strong><span>Work relationships</span></div>}
                {visibleDiagnostics.corpus?.saturatedKinds?.length ? <div><strong>{visibleDiagnostics.corpus.saturatedKinds.length}</strong><span>Corpus caps reached · {visibleDiagnostics.corpus.saturatedKinds.slice(0, 3).join(", ")}{visibleDiagnostics.corpus.saturatedKinds.length > 3 ? "…" : ""}</span></div> : <div><strong>0</strong><span>Corpus caps reached</span></div>}
                <ClusterButton type="button" className="" onClick={loadDiagnostics} variant="quiet" size="compact">Refresh diagnostics</ClusterButton>
              </>
            ) : <span>Loading search diagnostics…</span>}
          </section>
        )}
        {showFavoritesManager && <section className="search-favorites-manager-v546" aria-label="Manage navigation favorites">
          <div className="search-favorites-manager-v546__header">
            <strong>Navigation favorites</strong>
            <span>Only generic route types are displayed. Removing a revoked favorite never opens the resource.</span>
            <ClusterButton type="button" variant="quiet" size="compact" disabled={favoriteRoutes.length === 0} onClick={() => setStoredFavorites([])}>Clear all</ClusterButton>
          </div>
          {favoriteRoutes.length === 0 && <p role="status">No favorites saved. Pin a workspace from Command Search to add one.</p>}
          {favoriteRoutes.map((saved, index) => {
            const route = parseNavigationRoute(saved);
            const genericLabel = `${route ? screenLabel(route.route) : "Workspace"} favorite ${index + 1}`;
            return <div className="search-favorites-manager-v546__row" key={saved}>
              <span>{genericLabel}</span>
              <div className="search-favorites-manager-v546__actions">
                <ClusterButton type="button" variant="quiet" size="compact" aria-label={`Move ${genericLabel} up`} disabled={index === 0} onClick={() => setStoredFavorites((current) => moveWorkspaceFavorite(current, saved, -1))}>Up</ClusterButton>
                <ClusterButton type="button" variant="quiet" size="compact" aria-label={`Move ${genericLabel} down`} disabled={index === favoriteRoutes.length - 1} onClick={() => setStoredFavorites((current) => moveWorkspaceFavorite(current, saved, 1))}>Down</ClusterButton>
                <ClusterButton type="button" variant="quiet" size="compact" aria-label={`Remove ${genericLabel}`} onClick={() => setStoredFavorites((current) => removeWorkspaceFavorite(current, saved))}>Remove</ClusterButton>
              </div>
            </div>;
          })}
          {favoritesState.error && <p role="alert">Favorite changes could not be saved. Check your connection and retry.</p>}
        </section>}
        {!commandMode && <SearchOperatorRail operators={parsed.operators} />}
        {!commandMode && showOperatorHelp && (
          <SearchOperatorHelp
            onClose={() => setShowOperatorHelp(false)}
            onUse={(example) => {
              setQuery((value) => `${value.trim()} ${example}`.trim());
              setShowOperatorHelp(false);
            }}
          />
        )}

        {!commandMode && !query.trim() && (savedSearches.length > 0 || recentSearches.length > 0) && (
          <div className="search-query-rails-v294">
            {savedSearches.some((item) => item.pinned) && (
              <div>
                <span>Pinned</span>
                {savedSearches.filter((item) => item.pinned).sort((a, b) => String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt))).slice(0, 6).map((item) => (
                  <span className="search-saved-query-v294" key={item.id}>
                    <ClusterButton unstyled type="button" onClick={() => useSavedSearch(item)} title={item.query}>{item.name}</ClusterButton>
                    <ClusterButton unstyled type="button" aria-label={`Unpin saved search ${item.name}`} title="Unpin" onClick={() => toggleSavedSearchPin(item)}><ClusterIcon name="star-filled" /></ClusterButton>
                    <ClusterButton unstyled type="button" aria-label={`Remove saved search ${item.name}`} onClick={() => setSavedSearches(savedSearches.filter((saved) => saved.id !== item.id))}><ClusterIcon name="close" /></ClusterButton>
                  </span>
                ))}
              </div>
            )}
            {savedSearches.some((item) => !item.pinned) && (
              <div>
                <span>Saved</span>
                {savedSearches.filter((item) => !item.pinned).sort((a, b) => String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt))).slice(0, 6).map((item) => (
                  <span className="search-saved-query-v294" key={item.id}>
                    <ClusterButton unstyled type="button" onClick={() => useSavedSearch(item)} title={item.query}>{item.name}</ClusterButton>
                    <ClusterButton unstyled type="button" aria-label={`Pin saved search ${item.name}`} title="Pin" onClick={() => toggleSavedSearchPin(item)}><ClusterIcon name="star" /></ClusterButton>
                    <ClusterButton unstyled type="button" aria-label={`Remove saved search ${item.name}`} onClick={() => setSavedSearches(savedSearches.filter((saved) => saved.id !== item.id))}><ClusterIcon name="close" /></ClusterButton>
                  </span>
                ))}
              </div>
            )}
            {recentSearches.length > 0 && (
              <div>
                <span>Recent</span>
                {recentSearches.slice(0, 6).map((item) => <ClusterButton unstyled type="button" key={item} onClick={() => setQuery(item)}>{item}</ClusterButton>)}
                <ClusterButton unstyled type="button" className="search-query-clear-v495" onClick={() => setRecentSearches([])}>Clear recent</ClusterButton>
              </div>
            )}
          </div>
        )}

        {!commandMode && (savedSearchState.error || recentSearchState.error || favoritesState.error || savedSearchState.queued || recentSearchState.queued || favoritesState.queued || savedSearchState.saving || recentSearchState.saving || favoritesState.saving) && (
          <div className="search-client-state-feedback-v546"
            role={savedSearchState.error || recentSearchState.error || favoritesState.error ? "alert" : "status"}
            aria-live="polite">
            {savedSearchState.error || recentSearchState.error || favoritesState.error ||
              (savedSearchState.queued || recentSearchState.queued || favoritesState.queued
                ? "Search preference changes are queued for synchronization."
                : "Saving search preferences…")}
          </div>
        )}

        <div className="search-command-body-v303">
          <div id="cluster-search-results" ref={listRef} className="search-command-results-v294" role="listbox" aria-label="Search results" aria-busy={searching || currentCommandBusy}>
          {items.length ? (
            items.map((item, index) => (
              <Fragment key={item.key}>
                {(index === 0 || items[index - 1]?.group !== item.group) && (
                  <div className="search-result-group-v431" role="presentation">
                    <strong>{PALETTE_GROUP_LABELS[item.group]}</strong>
                    <span>{groupCounts[item.group] || 0}</span>
                  </div>
                )}
                <ClusterButton unstyled type="button"
                  id={`cluster-search-result-${index}`}
                  data-search-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? "active" : ""}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span className={`search-kind-v294 kind-${item.kind}`}>{searchKindLabel(item.kind)}</span>
                  <span className="search-result-copy-v495">
                    <strong>{highlight(item.title, searchTerm)}</strong>
                    <em>{highlight(item.detail, searchTerm)}</em>
                    {(item.projectName || item.boardName || item.status || item.priority || item.matchReason) ? <small>{[item.projectName, item.boardName, item.status, item.priority, item.matchReason].filter(Boolean).slice(0, 4).join(" · ")}</small> : null}
                  </span>
                  {(item.shortcut || item.aliases?.length) && <span className="search-command-hint-v495" aria-label={item.shortcut ? `Shortcut ${item.shortcut}` : `Aliases ${(item.aliases || []).join(", ")}`}>{item.shortcut || item.aliases?.slice(0, 2).join(" · ")}</span>}
                  <ClusterIcon name="chevron-right" aria-hidden="true" />
                </ClusterButton>
              </Fragment>
            ))
          ) : (
            <div className="empty-state compact search-empty-v294">
              <strong>{commandMode ? "No matching command" : searchTerm.length < 2 ? "Type two letters to search work" : "No useful matches"}</strong>
              <span>{commandMode ? "Try create, Projects, My Work, Scheduler, Settings, or another workspace." : "Try fewer words, a scope such as project:, or a nearby spelling."}</span>
            </div>
          )}
          </div>
          <SearchResultPreview item={activeItem} onOpen={() => activeItem && run(activeItem)} />
        </div>
        <footer className="search-command-footer-v294">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Home</kbd><kbd>End</kbd> jump</span>
          <span><kbd>Enter</kbd> open</span>
          {desktopHost && <span><kbd>Ctrl</kbd><kbd>Enter</kbd> new window</span>}
          <span><kbd>&gt;</kbd> commands</span>
          {settings?.userCommandPaletteHotkey && <span><kbd>{settings.userCommandPaletteHotkey}</kbd> reopen palette</span>}
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </ClusterFloatingSurface>
    </>
  );
}

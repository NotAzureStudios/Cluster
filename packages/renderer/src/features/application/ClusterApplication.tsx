import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";

import { writePreferenceStorage } from "../../core/privacy-consent";
import { configureClusterSounds, installClusterUiSoundInteractions } from "../../core/cluster-sounds";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useWindowEvent } from "../../core/window-events";
import "./styles/application-shell.css";
import "./styles/application-controls.css";
import "./styles/application-sync.css";
import "./smart-interface.css";
import "./styles/phase1-identity-v473.css";
import { CLUSTER_SESSION_INVALIDATED_EVENT, api, queryApi } from "../../core/api";
import { accessibleDocumentTitle } from "../../core/accessibility";
import { isMeaningfulWorkspaceScreen, type SmartWorkspaceContext } from "../../core/smart-interface";
import { canOpenScreen, createNavigationState, isProjectContextScreen, isAppScreen, navigationHash, navigationParentState, navigationStateFromHistory, parseNavigationRoute, readNavigationSession, resolveInitialNavigation, screenFromStartSetting, screenLabel, serializeNavigationRoute, writeNavigationSession, type AppNavigationState, type AppScreen } from "../../core/navigation";
import { useServerState } from "../../core/server-state";
import { getOfflineConnectivitySnapshot, getOfflineOperationalSnapshot, initializeOfflineRuntime, refreshOfflineSyncState, setOfflineRuntimeAuthenticated, subscribeOfflineSync } from "../../core/offline-runtime-shell";
import { saveWorkspaceRecoverySnapshot, type WorkspaceRecoverySnapshot } from "../../core/workspace-recovery";
import { copyClusterText } from "../../core/clipboard";
import { LazyFeatureBoundary } from "../../components/FeatureBoundary";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionButton } from "../../components/ClusterActionButton";
import { ClusterModal } from "../../components/ClusterModal";
import { CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT } from "../help/contextual-help";
import { deriveSyncOperationalStatus } from "../../components/operational-status";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { hasUnsavedChanges } from "../../components/useUnsavedChangesGuard";
import { delegatedFormDestination, formInspectorFromSearch } from "../workflow/delegated-form-navigation";
import { resolveAuthorizedCardNavigation, type AuthorizedCardRead } from "../workflow/authorized-card-navigation";
import { resolveAuthorizedBoardNavigation, type AuthorizedBoardRead } from "../workflow/authorized-board-navigation";
import { resolveAuthorizedProjectNavigation, type AuthorizedProjectRead } from "../workflow/authorized-project-navigation";
import { admitAuthorizedHistoryNavigation } from "../workflow/authorized-history-navigation";
import { requiresAuthorizedDetailNavigation, resolveAuthorizedDetailNavigation, type DetailNavigationRead } from "../workflow/authorized-detail-navigation";
import { requiresAuthorizedProjectDetailNavigation, resolveAuthorizedProjectDetailNavigation, type ProjectDetailRead } from "../workflow/authorized-project-detail-navigation";
import { requiresAuthorizedProjectExtraNavigation, resolveAuthorizedProjectExtraNavigation } from "../workflow/authorized-project-extra-navigation";
import { CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, requiresAuthorizedPacketNavigation, resolveAuthorizedPacketNavigation, type PacketNavigationCatalogRead } from "../workflow/authorized-packet-navigation";
import { CLUSTER_OPEN_WORK_SOURCE_EVENT, CLUSTER_WORK_NAVIGATION_RECOVERY_EVENT, CLUSTER_WORK_PROJECT_QUERY_KEY, CLUSTER_WORK_PROJECT_TAB_QUERY_KEY, CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT, openClusterWorkNavigation, readPendingDesktopWorkNavigation, clearPendingDesktopWorkNavigation, readPendingDesktopSourceCommit, clearPendingDesktopSourceCommit, queueDesktopWorkNavigation, reportClusterWorkNavigationRecovery } from "../workflow/work-navigation";

import { useManagedNativeKioskExit, useNativeKioskSession } from "../desktop/use-native-kiosk-session";
import { useKioskDocumentState } from "../desktop/use-kiosk-document-state";
import { useServerKioskSession } from "../desktop/use-server-kiosk-session";
import { useKioskIdleReset, useKioskRotation, useKioskScheduleAutomation } from "../desktop/use-kiosk-automation";
import { DEFAULT_KIOSK_POLICY, kioskPolicyFromSettings, kioskSafeScreen, kioskScreenAllowed } from "../desktop/kiosk-policy";
import "../shell/shell.css";
import "./styles/resource-window.css";
import "./styles/mobile-runtime-v495.css";
import "../shell/sidebar.css";
import "../shell/shell-v2.css";
import "../shell/shell-spatial-rc27.css";
import "../../styles/visual-system.css";
import { useRoutePerformance, useRouteScrollRestoration, useShellKeyboardShortcuts, useUserHeartbeat } from "../shell/runtime-hooks";
import { importantBuildEntries, projectCompleteness, projectHealth, projectStatusLabel } from "../projects/projects-utils";
import { displayUserName } from "../people/people-utils";
import { LoadingState, ScreenLoadingState, BoardLoadingState, WorkspaceLoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { SECURITY_PIN_CONFIGURED_EVENT } from "../../core/security-pin";
import { PublicClusterCover } from "../auth/PublicClusterCover";
import { authenticatedEntryScreen } from "../auth/AuthenticatedEntryGate";
import { StudioPolicyGate } from "../legal/StudioPolicyGate";
import { type ToolKey } from "../admin/AdminToolControls";
import { isStandaloneToolRoute, StandaloneToolRoute } from "./modules/application-standalone-tool-registry";
import { CalendarPage, ChangelogPage, OperatorAgreementPage, CopyrightCounterNoticePage, CopyrightPolicyPage, CopyrightReportPage, PrivacyPolicyPage, PublicSharePage, SecurityDisclosurePolicyPage, TermsPolicyPage, ThirdPartyDisclosurePage } from "./application-entrypoints";
import type { User, Project, WhiteboardSummary, Board, AppTheme, SetupStatus, Settings, SettingsSection, ServerConfigSection, RecentNavigation } from "./application-models";
import { boardOptions, projectTypeBadge, writeProjectTypePresetsCache } from "./modules/project-shell-helpers";
import { ClusterBootError, NavigationOperationalStatus, normalizeAccountSettingsSection, normalizeServerConfigSection, usePersistentNavigationSidebarClose, useSettingsSectionNavigation, loadClusterStartup, initialNavigationRecoveryNotice, publicShareToken, type NavigationRecoveryNotice } from "./application-runtime-ux";
import { canUseProject, getProjectPermission } from "../projects/project-access-policy";

import { MAX_PROJECT_TABS, THEME_STORAGE_KEY, applyCustomization, applyTheme, getStoredTheme, userPreferencesFromUser } from "./modules/application-shell-runtime";
import { openSharedCreate } from "../create/shared-create-handoff";
import { clearIncompatibleRouteContext, clearProjectSwitchRouteContext, nextOpenProjectTabs } from "./modules/project-tab-workspace";
import { LazyAccountSettingsPage, LazyActivityPage, LazyAdminPage, LazyBoardPage, LazyBuildsFoldedIntoProjectsPage, LazyCommandPalette, LazyClusterHelpDialog, LazyDesktopPresencePublisher, LazyDesktopWorkspacePage, LazyDashboard, LazyLibraryPage, LazyMyWorkPage, LazyNotificationCenterPage, LazyPacketsPage, LazyProfilesPage, LazyProjectDetailRoute, LazyProjectTabsBar, LazyProjectsRoute, LazyQAFoldedIntoProjectsPage, LazyQuickCreateDrawer, LazyServerConfigPage, LazySetupWizard, LazySignedOutKioskPage, LazyStudioSettingsPage, LazyTicketSystemPage, LazyTimePage, LazyTimelinePage, LazyToolInfrastructurePage, LazyWhiteboardPage } from "./modules/application-lazy-workspaces";
import { toolConfigSettingsPatch } from "./modules/tool-config-settings";
import { Sidebar } from "./modules/ApplicationSidebar";

import { ToolDisabledPage } from "./ToolDisabledPage";
import { useResourceChangeInvalidation } from "./use-resource-change-invalidation";

const WHITEBOARD_IMMEDIATE_SCREENS = new Set<AppScreen>(["projects", "project", "whiteboard", "admin", "people"]);
function screenNeedsWhiteboards(screen: AppScreen) { return WHITEBOARD_IMMEDIATE_SCREENS.has(screen); }

export default function App() {
  const shareToken = publicShareToken();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    if (user?.id) initializeOfflineRuntime();
    setOfflineRuntimeAuthenticated(Boolean(user?.id));
    return () => setOfflineRuntimeAuthenticated(false);
  }, [user?.id]);
  useResourceChangeInvalidation(user?.id);
  useEffect(() => installClusterUiSoundInteractions(), []);
  const initialNavigationRef = useRef(
    resolveInitialNavigation({
      hash: typeof window !== "undefined" ? window.location.hash : "",
      historyState: typeof window !== "undefined" ? window.history.state : null,
      sessionState: typeof window !== "undefined" ? readNavigationSession(window.sessionStorage) : null,
    }),
  );
  const initialNavigation = initialNavigationRef.current;
  const explicitNavigationRef = useRef(initialNavigation.source !== "default");
  const lastNavigationRef = useRef<AppNavigationState>(initialNavigation.state);
  // Every history admission must belong to the exact account epoch that
  // started it. Comparing only the user ID fails for A → B → A transitions.
  const historyAccountRef = useRef<{ id: string | null; epoch: number }>({ id: null, epoch: 0 });
  const historyUserId = user?.id || null;
  if (historyAccountRef.current.id !== historyUserId) {
    historyAccountRef.current = { id: historyUserId, epoch: historyAccountRef.current.epoch + 1 };
  }
  const historyAuthRef = useRef({ user, epoch: historyAccountRef.current.epoch });
  historyAuthRef.current = { user, epoch: historyAccountRef.current.epoch };
  const [navigationNotice, setNavigationNotice] = useState<NavigationRecoveryNotice | null>(() => initialNavigationRecoveryNotice(initialNavigation.source));
  const [sessionRecoveryMessage, setSessionRecoveryMessage] = useState<string | null>(null);
  useWindowEvent(CLUSTER_WORK_NAVIGATION_RECOVERY_EVENT, (event) => {
    const detail = (event as CustomEvent<NavigationRecoveryNotice>).detail;
    if (!detail?.title || !detail?.message) return;
    setNavigationNotice(detail);
  });
  const [screen, setScreenState] = useState<AppScreen>(initialNavigation.state.route);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const kioskActiveRef = useRef(false);
  const kioskPolicyRef = useRef(DEFAULT_KIOSK_POLICY);
  usePersistentNavigationSidebarClose(setMobileSidebarOpen);
  const { settingsInitialSection, setSettingsInitialSection, serverConfigInitialSection, setServerConfigInitialSection } = useSettingsSectionNavigation(initialNavigation.state.route, initialNavigation.state.section);
  const [routeSection, setRouteSection] = useState<string | null>(() => initialNavigation.state.route === "settings" || initialNavigation.state.route === "serverConfig" ? null : initialNavigation.state.section);
  const [routeSubsection, setRouteSubsection] = useState<string | null>(() => initialNavigation.state.subsection);
  const historyRestoreRef = useRef(false);
  const interactiveNavigationEpochRef = useRef(0);
  async function setScreen(next: AppScreen, options: { section?: string | null; subsection?: string | null } = {}) {
    // Explicit navigation supersedes any outstanding asynchronous Back/Forward
    // admission, even if the user ultimately returns to the same route.
    interactiveNavigationEpochRef.current += 1;
    const requestedScreen = next;
    next = kioskActiveRef.current ? kioskSafeScreen(kioskPolicyRef.current, next) : next;
    if (requestedScreen !== next) {
      setNavigationNotice({ title: "Kiosk navigation locked", message: "This display is restricted by the studio kiosk policy. The kiosk Home screen was opened instead.", tone: "info" });
    }
    const requestedSection = options.section ?? (next === "settings" ? settingsInitialSection : next === "serverConfig" ? serverConfigInitialSection : null);
    if (next === "settings") setSettingsInitialSection(normalizeAccountSettingsSection(requestedSection));
    if (next === "serverConfig") setServerConfigInitialSection(normalizeServerConfigSection(requestedSection));
    setMobileSidebarOpen(false);
    if (next !== screen) clearIncompatibleRouteContext(next);
    if (next !== screen && hasUnsavedChanges()) {
      const discard = await confirmCluster({ title: "Discard unsaved changes?", message: "You have unsaved work on this screen. Leave it and discard those changes?", confirmLabel: "Discard changes", tone: "danger" });
      if (!discard) return;
    }
    if (next !== "settings" && next !== "serverConfig") setRouteSection(options.section || null);
    setRouteSubsection(options.subsection || null);
    setScreenState((current) => {
      // Admin deep links may change sections without changing the parent route.
      // Keep URL/history in sync with the section picker rather than leaving stale hashes.
      if (!historyRestoreRef.current && (current !== next || (next === "studioSettings" && (routeSection !== (options.section || null) || routeSubsection !== (options.subsection || null))))) {
        const nextNavigation = createNavigationState(next, {
          projectId: next === "project" || next === "board" || next === "whiteboard" ? projectId : null,
          boardId: next === "board" ? boardId : null,
          whiteboardId: next === "whiteboard" ? whiteboardId : null,
          section: next === "settings" ? normalizeAccountSettingsSection(requestedSection) : next === "serverConfig" ? normalizeServerConfigSection(requestedSection) : options.section || null,
          subsection: options.subsection || null,
        });
        window.history.pushState(nextNavigation, "", `${window.location.pathname}${window.location.search}${navigationHash(nextNavigation)}`);
      }
      return next;
    });
  }
  useWindowEvent("cluster-open-user-profile", (event) => {
    const userId = String((event as CustomEvent<{ userId?: string }>).detail?.userId || "").trim();
    if (!userId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("inspect", `person:${userId}`);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    void setScreen("people");
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(initialNavigation.state.context.projectId);
  const [openProjectTabIds, setOpenProjectTabIds] = useServerState<string[]>("user", "projects.open-tabs", [], { enabled: Boolean(user?.id), merge: (value) => Array.isArray(value) ? value.map(String).slice(-MAX_PROJECT_TABS) : [] });
  const [pinnedProjectTabIds, setPinnedProjectTabIds] = useServerState<string[]>("user", "projects.pinned-tabs", [], { enabled: Boolean(user?.id), merge: (value) => Array.isArray(value) ? value.map(String).slice(0, MAX_PROJECT_TABS) : [] });
  // The board workspace must return to its actual entry point (Projects browser,
  // My Work, or a Project), not blindly jump to its owning Project.
  const lastVisitedScreenRef = useRef<AppScreen>(initialNavigation.state.route);
  const boardReturnOriginRef = useRef<{ screen: AppScreen; projectId: string | null } | null>(null);
  useEffect(() => {
    const previous = lastVisitedScreenRef.current;
    if (screen === "board" && previous !== "board") {
      boardReturnOriginRef.current = { screen: previous === "whiteboard" ? "projects" : previous, projectId };
    }
    lastVisitedScreenRef.current = screen;
  }, [screen, projectId]);
  const [boardId, setBoardId] = useState<string | null>(initialNavigation.state.context.boardId);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardLoadError, setBoardLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<unknown>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [theme, setThemeState] = useState<AppTheme>(() => getStoredTheme());
  const [whiteboards, setWhiteboards] = useState<WhiteboardSummary[]>([]);
  const [whiteboardsLoaded, setWhiteboardsLoaded] = useState(false);
  const [whiteboardId, setWhiteboardId] = useState<string | null>(initialNavigation.state.context.whiteboardId);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [appSettings, setAppSettings] = useState<Settings>({
    appDisplayName: "Cluster",
    studioName: "",
    organizationLogoUrl: "",
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [contextualHelpOpen, setContextualHelpOpen] = useState(false);
  const desktopHost = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const resourceWindow = desktopHost && new URLSearchParams(window.location.search).get("clusterWindow") === "resource";
  const nativeKiosk = useNativeKioskSession(desktopHost);
  const nativeKioskActive = nativeKiosk.active;
  const nativeKioskSessionMode = nativeKiosk.sessionMode;
  const nativeKioskExitShortcut = nativeKiosk.exitShortcut;
  const signedOutKiosk = desktopHost && nativeKioskActive && nativeKioskSessionMode === "signed-out";
  const kioskPolicy = useMemo(() => kioskPolicyFromSettings(appSettings, nativeKioskSessionMode), [
    nativeKioskSessionMode, appSettings.desktopKioskProfiles, appSettings.desktopKioskSignedInProfileId, appSettings.desktopKioskSignedOutProfileId,
  ]);
  const requestManagedKioskExit = useManagedNativeKioskExit({
    active: nativeKioskActive,
    sessionMode: nativeKioskSessionMode,
    pinConfigured: Boolean(user?.pinConfigured),
    managedExitRequired: kioskPolicy.managedExitRequired,
    onNotice: setNavigationNotice,
  });
  useEffect(() => {
    kioskPolicyRef.current = kioskPolicy;
  }, [kioskPolicy]);
  useEffect(() => { kioskActiveRef.current = nativeKioskActive; }, [nativeKioskActive]);
  useKioskDocumentState(nativeKioskActive, nativeKioskSessionMode, kioskPolicy);
  useServerKioskSession({ active: nativeKioskActive, sessionMode: nativeKioskSessionMode, policy: kioskPolicy, userId: user?.id });
  useKioskRotation({ active: nativeKioskActive && nativeKioskSessionMode === "signed-in", policy: kioskPolicy, screen, navigate: (target) => { void setScreen(target); } });
  useKioskScheduleAutomation({ desktopHost, active: nativeKioskActive, sessionMode: nativeKioskSessionMode, settings: appSettings, settingsLoaded: !loading });
  useEffect(() => { if (nativeKioskActive && !kioskScreenAllowed(kioskPolicy, screen)) void setScreen(kioskPolicy.homeScreen); }, [nativeKioskActive, kioskPolicy, screen]);
  useKioskIdleReset({ active: nativeKioskActive, policy: kioskPolicy, screen, navigateHome: () => { void setScreen(kioskPolicy.homeScreen); } });
  useEffect(() => {
    if (!desktopHost || !user?.id || signedOutKiosk) return;
    let cancelled = false;
    const synchronize = async () => {
      try {
        const native = await import("../../core/desktop");
        const current = await native.getNativeSessionStatus().catch(() => ({ ready: false }));
        if (current.ready || cancelled) return;
        const result = await api<{ ok: true; code: string }>("/api/auth/desktop-session-code", { method: "POST", body: "{}", skipCacheInvalidation: true });
        if (!cancelled && result.code) await native.claimNativeSession(result.code);
      } catch {
        // Native services remain visibly unavailable; the web session itself is unaffected.
      }
    };
    void synchronize();
    const onFocus = () => void synchronize();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [desktopHost, user?.id, signedOutKiosk]);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [previewUser, setPreviewUser] = useState<User | null>(null);
  const [resumeContext, setResumeContext] = useServerState<SmartWorkspaceContext | null>("user", "smart.workspace-context", null, { enabled: Boolean(user?.id)});
  const [recentNavigation, setRecentNavigation] = useServerState<RecentNavigation[]>("user", "navigation.recent", [], { enabled: Boolean(user?.id) });
  // Older Form review links use #studioSettings plus a private submission ID.
  // Route them to the non-admin My Forms surface, not to the admin console.
  useEffect(() => {
    if (!user || user.isAdmin || screen !== "studioSettings") return;
    const inspector = formInspectorFromSearch(window.location.search);
    if (!inspector || !delegatedFormDestination({ screen, scope: inspector.scope, id: inspector.id, isAdmin: false })) return;
    void setScreen("settings", { section: "forms" });
  }, [user?.id, user?.isAdmin, screen]);

  const [accessRulesVersion, setAccessRulesVersion] = useState(0);
  const landingAppliedRef = useRef(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const connectivitySnapshot = useSyncExternalStore(subscribeOfflineSync, getOfflineConnectivitySnapshot, getOfflineConnectivitySnapshot);
  const offlineConnectivity = useMemo(() => ({ online: (connectivitySnapshot & 1) !== 0, serverReachable: (connectivitySnapshot & 2) !== 0 }), [connectivitySnapshot]);
  const offlineOperational = useSyncExternalStore(subscribeOfflineSync, getOfflineOperationalSnapshot, getOfflineOperationalSnapshot);
  const operationalStatus = useMemo(() => deriveSyncOperationalStatus(offlineOperational), [offlineOperational]);
  const previousServerReachableRef = useRef(offlineConnectivity.serverReachable);
  useEffect(() => {
    const applyNavigation = (navigation: AppNavigationState) => {
      const safeScreen = kioskActiveRef.current ? kioskSafeScreen(kioskPolicyRef.current, navigation.route) : navigation.route;
      const restricted = safeScreen !== navigation.route;
      historyRestoreRef.current = true;
      setScreenState(safeScreen);
      setProjectId(restricted ? null : navigation.context.projectId);
      setBoardId(restricted ? null : navigation.context.boardId);
      setWhiteboardId(restricted ? null : navigation.context.whiteboardId);
      if (!restricted && navigation.route === "settings") setSettingsInitialSection(normalizeAccountSettingsSection(navigation.section));
      if (!restricted && navigation.route === "serverConfig") setServerConfigInitialSection(normalizeServerConfigSection(navigation.section));
      setRouteSection(!restricted && navigation.route !== "settings" && navigation.route !== "serverConfig" ? navigation.section : null);
      setRouteSubsection(!restricted ? navigation.subsection : null);
      window.setTimeout(() => {
        historyRestoreRef.current = false;
      }, 0);
    };
    const initialState = initialNavigationRef.current.state;
    window.history.replaceState(initialState, "", `${window.location.pathname}${window.location.search}${navigationHash(initialState)}`);
    const confirmHistoryNavigation = async () => {
      if (!hasUnsavedChanges()) return true;
      const discard = await confirmCluster({ title: "Discard unsaved changes?", message: "You have unsaved work on this screen. Continue navigation and discard those changes?", confirmLabel: "Discard changes", tone: "danger" });
      if (discard) return true;
      const current = lastNavigationRef.current;
      window.history.pushState(current, "", `${window.location.pathname}${window.location.search}${navigationHash(current)}`);
      return false;
    };
    let navigationSequence = 0;
    const restore = async (candidate: AppNavigationState | null) => {
      const sequence = ++navigationSequence;
      const owner = historyAuthRef.current;
      const interactiveEpoch = interactiveNavigationEpochRef.current;
      const isCurrent = () => sequence === navigationSequence &&
        interactiveEpoch === interactiveNavigationEpochRef.current &&
        owner.epoch === historyAuthRef.current.epoch && Boolean(historyAuthRef.current.user?.id);
      const keepCurrent = () => {
        if (!isCurrent()) return;
        const current = lastNavigationRef.current;
        window.history.replaceState(current, "", `${window.location.pathname}${window.location.search}${navigationHash(current)}`);
        writeNavigationSession(window.sessionStorage, current);
        setNavigationNotice({ title: "History destination unavailable", message: "The destination could not be verified or your access has changed. Your current workspace was preserved.", tone: "warning" });
      };
      if (!candidate || !owner.user?.id) { keepCurrent(); return; }
      if (!await confirmHistoryNavigation()) return;
      if (!isCurrent()) return;
      const admitted = await admitAuthorizedHistoryNavigation(candidate, {
        isCurrent,
        canOpen: (route) => Boolean(historyAuthRef.current.user && canOpenScreen(historyAuthRef.current.user, route)),
        readProject: (id) => queryApi<AuthorizedProjectRead>(`/api/projects/${encodeURIComponent(id)}/snapshot`, {
          force: true, persist: false, staleWhileRevalidate: false,
        }),
        readBoard: (id) => queryApi<AuthorizedBoardRead>(`/api/boards/${encodeURIComponent(id)}`, {
          force: true, persist: false, staleWhileRevalidate: false,
        }),
        readWhiteboard: (path) => queryApi<DetailNavigationRead>(path, {
          force: true, persist: false, staleWhileRevalidate: false,
        }),
      });
      if (!isCurrent()) return;
      if (!admitted) { keepCurrent(); return; }
      applyNavigation(admitted);
      // The resource may have moved since this history entry was written.
      // Only persist its freshly admitted canonical placement.
      window.history.replaceState(admitted, "", `${window.location.pathname}${window.location.search}${navigationHash(admitted)}`);
      writeNavigationSession(window.sessionStorage, admitted);
    };
    let scheduledRestore: number | null = null;
    const scheduleRestore = (candidate: AppNavigationState | null) => {
      // One browser Back/Forward operation can dispatch both popstate and
      // hashchange. Coalesce those events before any permission/API reads.
      if (scheduledRestore !== null) window.clearTimeout(scheduledRestore);
      const interactiveEpoch = interactiveNavigationEpochRef.current;
      const ownerEpoch = historyAuthRef.current.epoch;
      scheduledRestore = window.setTimeout(() => {
        scheduledRestore = null;
        if (interactiveEpoch !== interactiveNavigationEpochRef.current) return;
        void restore(candidate).catch(() => {
          // Confirmation and routing are best-effort; a rejected async
          // confirmation must not leak an unhandled promise or open a route.
          if (interactiveEpoch !== interactiveNavigationEpochRef.current || ownerEpoch !== historyAuthRef.current.epoch) return;
          const current = lastNavigationRef.current;
          window.history.replaceState(current, "", `${window.location.pathname}${window.location.search}${navigationHash(current)}`);
          writeNavigationSession(window.sessionStorage, current);
        });
      }, 16);
    };
    const restorePopState = (event: PopStateEvent) => {
      scheduleRestore(navigationStateFromHistory(event.state) || parseNavigationRoute(window.location.hash));
    };
    const restoreHash = () => { scheduleRestore(parseNavigationRoute(window.location.hash)); };
    window.addEventListener("popstate", restorePopState);
    window.addEventListener("hashchange", restoreHash);
    return () => {
      navigationSequence += 1;
      if (scheduledRestore !== null) window.clearTimeout(scheduledRestore);
      window.removeEventListener("popstate", restorePopState);
      window.removeEventListener("hashchange", restoreHash);
    };
  }, []);
  const currentNavigation = createNavigationState(screen, {
    projectId: screen === "project" || screen === "board" || screen === "whiteboard" ? projectId : null,
    boardId: screen === "board" ? boardId : null,
    whiteboardId: screen === "whiteboard" ? whiteboardId : null,
    section: screen === "settings" ? settingsInitialSection : screen === "serverConfig" ? serverConfigInitialSection : routeSection,
    subsection: routeSubsection,
  });
  const currentNavigationRoute = serializeNavigationRoute(currentNavigation);
  lastNavigationRef.current = currentNavigation;
  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setTimeout(() => {
      const inspector = new URL(window.location.href).searchParams.get("inspect");
      const recoveryWindowId = resourceWindow
        ? (window.sessionStorage.getItem("cluster.recovery-window-id") || crypto.randomUUID())
        : "primary";
      if (resourceWindow && !window.sessionStorage.getItem("cluster.recovery-window-id"))
        window.sessionStorage.setItem("cluster.recovery-window-id", recoveryWindowId);
      void saveWorkspaceRecoverySnapshot({
        route: currentNavigationRoute,
        projectTabs: openProjectTabIds,
        inspector,
        windowKind: resourceWindow ? "detached" : "primary",
        windowId: recoveryWindowId,
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [user?.id, currentNavigationRoute, openProjectTabIds, resourceWindow]);
  useEffect(() => {
    const recovered = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRecoverySnapshot>).detail;
      if (!detail?.projectTabs?.length) return;
      setOpenProjectTabIds(detail.projectTabs.slice(-MAX_PROJECT_TABS));
    };
    window.addEventListener("cluster:workspace-recovered", recovered);
    return () => window.removeEventListener("cluster:workspace-recovered", recovered);
  }, [setOpenProjectTabIds]);
  useEffect(() => {
    const navigation = createNavigationState(screen, {
      projectId: screen === "project" || screen === "board" || screen === "whiteboard" ? projectId : null,
      boardId: screen === "board" ? boardId : null,
      whiteboardId: screen === "whiteboard" ? whiteboardId : null,
      section: screen === "settings" ? settingsInitialSection : screen === "serverConfig" ? serverConfigInitialSection : routeSection,
      subsection: routeSubsection,
    });
    window.history.replaceState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
    writeNavigationSession(window.sessionStorage, navigation);
  }, [screen, projectId, boardId, whiteboardId, settingsInitialSection, serverConfigInitialSection, routeSection, routeSubsection]);
  useEffect(() => {
    if (!user?.id || !isMeaningfulWorkspaceScreen(screen)) return;
    const context: SmartWorkspaceContext = {
      screen,
      projectId: screen === "project" || screen === "board" || screen === "whiteboard" ? projectId : null,
      boardId: screen === "board" ? boardId : null,
      whiteboardId: screen === "whiteboard" ? whiteboardId : null,
      updatedAt: new Date().toISOString(),
    };
    const timer = window.setTimeout(() => {
      setResumeContext(context);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [user?.id, screen, projectId, boardId, whiteboardId]);
  useWindowEvent("cluster:open-shared-create", () => { if (!resourceWindow) setQuickCreateOpen(true); });
  useWindowEvent(CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT, () => { if (!resourceWindow && user?.id && !nativeKioskActive) setContextualHelpOpen(true); });
  useWindowEvent("cluster-native-command", (event) => {
    const command = (event as CustomEvent<{ command?: string }>).detail?.command;
    if (resourceWindow) return;
    if (command === "command-palette") setCommandOpen(true);
    else if (command === "quick-create") setQuickCreateOpen(true);
    else if (command === "shortcut-help") setShortcutHelpOpen(true);
    else if (command === "kiosk-exit") void requestManagedKioskExit();
  });
  useWindowEvent("cluster:open-account-settings", (event) => {
    const detail = (event as CustomEvent<{ section?: SettingsSection }>).detail;
    const nextSection = normalizeAccountSettingsSection(detail?.section || "privacy");
    setSettingsInitialSection(nextSection);
    void setScreen("settings", { section: nextSection });
  });
  useWindowEvent(SECURITY_PIN_CONFIGURED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ user?: User }>).detail;
    if (detail?.user) setUser(detail.user);
  });
  useWindowEvent("cluster-tool-settings-changed", (event) => {
    const detail = (event as CustomEvent<{ tool?: ToolKey; config?: Record<string, any> }>).detail;
    if (!detail?.tool || !detail.config) return;
    setAppSettings((current) => ({
      ...current,
      ...toolConfigSettingsPatch(detail.tool as ToolKey, detail.config || {}),
    }));
  });
  const clearAuthenticatedUiState = useCallback((options: { preserveNavigation?: boolean } = {}) => {
    setUser(null);
    setProjects([]);
    setProjectsLoaded(false);
    setBoard(null);
    setWhiteboards([]);
    setWhiteboardsLoaded(false);
    setOpenProjectTabIds([]);
    setPreviewUser(null);
    setCommandOpen(false);
    setQuickCreateOpen(false);
    setMobileSidebarOpen(false);
    if (!options.preserveNavigation) {
      const navigation = createNavigationState("dashboard");
      historyRestoreRef.current = true;
      setScreenState("dashboard");
      setProjectId(null);
      setBoardId(null);
      setWhiteboardId(null);
      window.history.replaceState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
      writeNavigationSession(window.sessionStorage, navigation);
      lastNavigationRef.current = navigation;
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
    }
  }, []);
  useEffect(() => {
    if (!signedOutKiosk) return;
    setSessionRecoveryMessage(null);
    setNavigationNotice(null);
    clearAuthenticatedUiState();
    void api<{ ok?: boolean }>("/api/auth/logout", { method: "POST", body: "{}", skipCacheInvalidation: true }).catch(() => undefined);
  }, [signedOutKiosk, clearAuthenticatedUiState]);
  useEffect(() => {
    const onSessionInvalidated = (event: Event) => {
      const navigation = lastNavigationRef.current;
      const route = serializeNavigationRoute(navigation);
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      setSessionRecoveryMessage(`Your session ${detail?.reason === "session_revoked" ? "was revoked" : "expired"}. Sign in again to return to ${route}.`);
      setNavigationNotice(null);
      clearAuthenticatedUiState({ preserveNavigation: true });
    };
    window.addEventListener(CLUSTER_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
    return () => window.removeEventListener(CLUSTER_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
  }, [clearAuthenticatedUiState]);

  async function loadAppSettings() {
    try {
      const settings = await queryApi<Settings>("/api/settings", {
        staleMs: 30_000,
      });
      const nextSettings = {
        appDisplayName: "Cluster",
        ...settings,
        ...userPreferencesFromUser(user),
      };
      setAppSettings(nextSettings);
      writeProjectTypePresetsCache(settings.projectTypePresets);
      applyCustomization(nextSettings, user?.personalAccentColor);
      if (!landingAppliedRef.current && user) {
        const startScreen = screenFromStartSetting(settings.userStartScreen);
        if (!explicitNavigationRef.current && canOpenScreen(user, startScreen)) void setScreen(startScreen);
        landingAppliedRef.current = true;
      }
    } catch {
      // Settings are optional during boot. Continue if they fail to load.
    }
  }
  async function loadMe() {
    const result = await api<{ user: User | null }>("/api/me");
    setUser(result.user);
  }
  async function loadProjects(force = false) {
    const result = await queryApi<Project[]>("/api/projects", {
      force,
      staleMs: 60_000,
      maxAgeMs: 5 * 60_000,
      tags: ["projects"],
    });
    setProjects(result);
    setProjectsLoaded(true);
  }
  async function loadWhiteboards(force = false) {
    const result = await queryApi<WhiteboardSummary[]>("/api/whiteboards", {
      force,
      staleMs: 60_000,
      maxAgeMs: 5 * 60_000,
      tags: ["whiteboards"],
    });
    setWhiteboards(result);
    setWhiteboardsLoaded(true);
  }
  async function loadBoard(id = boardId, force = false) {
    if (!id) {
      setBoard(null);
      setBoardLoadError(null);
      setBoardLoading(false);
      return;
    }
    setBoardLoading(true);
    setBoardLoadError(null);
    try {
      const result = await queryApi<Board>(`/api/boards/${id}`, { force, staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["boards", `board:${id}`] });
      setBoard(result);
    } catch (error) {
      setBoard(null);
      setBoardLoadError(error);
    } finally {
      setBoardLoading(false);
    }
  }
  useEffect(() => {
    if (!user) return;
    let refreshTimer = 0;
    const refreshFromDelta = (event: Event) => {
      const changes = (event as CustomEvent<{ changes?: Array<{ entityType?: string; entityId?: string; boardId?: string }> }>).detail?.changes || [];
      if (!changes.length) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        const entityTypes = new Set(changes.map((change) => change.entityType));
        if (entityTypes.has("project") || (["projects", "project"].includes(screen) && ["board", "list", "card"].some((type) => entityTypes.has(type)))) void loadProjects(true).catch(() => undefined);
        if (entityTypes.has("whiteboard") && (whiteboardsLoaded || screenNeedsWhiteboards(screen))) void loadWhiteboards(true).catch(() => undefined);
        if (screen === "board" && boardId && changes.some((change) => change.entityId === boardId || change.boardId === boardId)) void loadBoard(boardId, true).catch(() => undefined);
      }, 500);
    };
    window.addEventListener("cluster-delta-applied", refreshFromDelta);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener("cluster-delta-applied", refreshFromDelta);
    };
  }, [user?.id, boardId, screen, whiteboardsLoaded]);
  useEffect(() => {
    async function boot() {
      if (shareToken) {
        setBootError(null);
        setLoading(false);
        return;
      }
      setBootError(null);
      try {
        const startup = await loadClusterStartup();
        if (startup.setupStatus) setSetupStatus(startup.setupStatus);
        if (startup.user) setUser(startup.user);
        if (startup.error) setBootError(startup.error);
      } finally {
        setLoading(false);
      }
    }
    void boot();
  }, [shareToken, bootAttempt]);
  useEffect(() => {
    applyTheme(theme);
    writePreferenceStorage(THEME_STORAGE_KEY, theme);
  }, [theme]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(theme);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => {
    applyCustomization(appSettings, user?.personalAccentColor);
    configureClusterSounds(appSettings);
  }, [appSettings, user?.personalAccentColor]);
  useEffect(() => {
    const preferredTheme = userPreferencesFromUser(user).themePreference;
    if (preferredTheme && preferredTheme !== theme) setThemeState(preferredTheme);
  }, [user?.id]);
  function setTheme(nextTheme: AppTheme) {
    setThemeState(nextTheme);
  }
  useEffect(() => {
    if (user && !signedOutKiosk) {
      void Promise.allSettled([loadAppSettings(), loadProjects()]);
    }
  }, [user, signedOutKiosk]);
  useEffect(() => {
    if (!user?.id || signedOutKiosk || whiteboardsLoaded || !screenNeedsWhiteboards(screen)) return;
    void loadWhiteboards().catch(() => undefined);
  }, [user?.id, signedOutKiosk, screen, whiteboardsLoaded]);
  useEffect(() => {
    const wasReachable = previousServerReachableRef.current;
    previousServerReachableRef.current = offlineConnectivity.serverReachable;
    if (!user?.id || !offlineConnectivity.serverReachable || wasReachable) return;
    const route = serializeNavigationRoute(lastNavigationRef.current);
    void Promise.allSettled([
      loadProjects(true),
      (whiteboardsLoaded || screenNeedsWhiteboards(screen)) ? loadWhiteboards(true) : Promise.resolve(),
      screen === "board" && boardId ? loadBoard(boardId, true) : Promise.resolve(),
    ]).then(() => {
      setNavigationNotice({
        title: "Connection restored",
        message: `Cluster revalidated ${route} and kept you in the same workspace.`,
        tone: "success",
      });
    });
  }, [offlineConnectivity.serverReachable, user?.id, screen, boardId, whiteboardsLoaded]);
  useUserHeartbeat(signedOutKiosk ? undefined : user?.id);
  useWindowEvent("cluster-access-rules-changed", () => {
    setAccessRulesVersion((value) => value + 1);
    void loadProjects(true).catch(() => undefined);
  }, Boolean(user?.id));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("cluster:identity-changed", { detail: { userId: user?.id || null } }));
  }, [user?.id]);
  const activeUser = (previewUser || user) as User;
  const visibleProjects = useMemo(() => (activeUser ? projects.filter((project) => (activeUser.isAdmin || !project!.archived) && canUseProject(activeUser, project)) : projects.filter((project) => !project!.archived)), [projects, activeUser, accessRulesVersion]);
  const currentProjectName = visibleProjects.find((project) => project.id === projectId)?.name || null;
  const currentWhiteboardName = whiteboards.find((item) => item.id === whiteboardId)?.name || null;
  const accessibleRouteLabel = screen === "board" ? board?.name || "Board" : screen === "whiteboard" ? currentWhiteboardName || "Whiteboard" : (screen === "project" && currentProjectName ? currentProjectName : screenLabel(screen));
  const contextualParent = navigationParentState(currentNavigation);
  const contextualParentLabel = contextualParent?.route === "project"
    ? `Back to ${currentProjectName || "project"}`
    : contextualParent?.route === "admin"
      ? "Back to Operations"
      : contextualParent
        ? "Back to Projects"
        : null;
  function openContextualParent() {
    if (!contextualParent) return;
    if (contextualParent.route === "project" && contextualParent.context.projectId) {
      openProject(contextualParent.context.projectId);
      return;
    }
    void setScreen(contextualParent.route);
  }
  useEffect(() => {
    document.title = accessibleDocumentTitle(accessibleRouteLabel);
  }, [accessibleRouteLabel]);
  useEffect(() => {
    if (!user?.id || !isMeaningfulWorkspaceScreen(screen)) return;
    const route = currentNavigationRoute;
    const now = new Date().toISOString();
    setRecentNavigation((current) => [
      { route, title: accessibleRouteLabel, screen, projectId: currentNavigation.context.projectId, visitedAt: now },
      ...current.filter((item) => item.route !== route),
    ].slice(0, 24));
  }, [user?.id, currentNavigationRoute, accessibleRouteLabel]);
  useEffect(() => {
    if (!projectsLoaded) return;
    const validProjectIds = new Set(visibleProjects.map((project) => project.id));
    setOpenProjectTabIds((current) => current.filter((id) => validProjectIds.has(id)).slice(-MAX_PROJECT_TABS));
    setPinnedProjectTabIds((current) => current.filter((id) => validProjectIds.has(id)).slice(0, MAX_PROJECT_TABS));

    const replaceWith = (nextScreen: AppScreen, notice: NavigationRecoveryNotice) => {
      const navigation = createNavigationState(nextScreen);
      historyRestoreRef.current = true;
      setScreenState(nextScreen);
      setProjectId(null);
      setBoardId(null);
      setWhiteboardId(null);
      setNavigationNotice(notice);
      window.history.replaceState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
      writeNavigationSession(window.sessionStorage, navigation);
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
    };

    if (screen === "project") {
      if (!projectId || !validProjectIds.has(projectId)) replaceWith("projects", {
        title: "Project unavailable",
        message: "That project may have been removed, archived, or your access may have changed. Projects was opened instead.",
        tone: "warning",
      });
      return;
    }
    if (screen === "board") {
      if (!boardId) return; // Board library is a valid top-level destination.
      const target = boardOptions(visibleProjects).find((item) => item.id === boardId);
      if (!target) {
        replaceWith("projects", {
          title: "Board unavailable",
          message: "That board may have been removed or you may no longer have access. Projects was opened instead.",
          tone: "warning",
        });
        return;
      }
      if (projectId !== target.projectId) setProjectId(target.projectId);
      return;
    }
    if (projectId && !validProjectIds.has(projectId)) setProjectId(null);
  }, [projectsLoaded, visibleProjects, projectId, boardId, screen]);

  useEffect(() => {
    if (screen !== "whiteboard" || !whiteboardsLoaded || !whiteboardId) return;
    const target = whiteboards.find((item) => item.id === whiteboardId);
    if (!target) {
      const navigation = createNavigationState("projects");
      historyRestoreRef.current = true;
      setScreenState("projects");
      setProjectId(null);
      setWhiteboardId(null);
      setNavigationNotice({
        title: "Whiteboard unavailable",
        message: "That whiteboard may have been removed or you may no longer have access. Projects was opened instead.",
        tone: "warning",
      });
      window.history.replaceState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
      writeNavigationSession(window.sessionStorage, navigation);
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
      return;
    }
    if (target.projectId && projectId !== target.projectId) setProjectId(target.projectId);
  }, [screen, whiteboardsLoaded, whiteboards, whiteboardId, projectId]);
  function clearResumeWorkspace() {
    if (!user?.id) return;
    setResumeContext(null);
  }
  function resumeWorkspace() {
    if (!resumeContext || !user?.id) return;
    // The persisted context is only a locator. Never restore an old Board or
    // Project directly from locally cached directory membership: it may have
    // moved or its permissions may have been revoked since the last visit.
    if (resumeContext.screen === "board" && resumeContext.boardId && canOpenScreen(user, "board")) {
      openClusterWorkNavigation({ screen: "board", boardId: resumeContext.boardId, projectId: resumeContext.projectId });
      return;
    }
    if (resumeContext.screen === "whiteboard" && resumeContext.whiteboardId && canOpenScreen(user, "whiteboard")) {
      openClusterWorkNavigation({ screen: "whiteboard", whiteboardId: resumeContext.whiteboardId, projectId: resumeContext.projectId });
      return;
    }
    if (resumeContext.screen === "project" && resumeContext.projectId && canOpenScreen(user, "project")) {
      openClusterWorkNavigation({ screen: "project", projectId: resumeContext.projectId });
      return;
    }
    const candidate = resumeContext.screen as AppScreen;
    if (isAppScreen(candidate) && canOpenScreen(user, candidate) && !["board", "project", "whiteboard"].includes(candidate)) {
      openClusterWorkNavigation({ screen: candidate });
      return;
    }
    clearResumeWorkspace();
  }
  function openServerConfiguration(section: ServerConfigSection = "overview") {
    window.sessionStorage.setItem("cluster-server-config-section", section);
    setScreen("serverConfig");
  }
  function openProject(projectToOpenId: string, preserveRouteContext = false) {
    const target = projects.find((project) => project.id === projectToOpenId);
    if (user && target && !canUseProject(user, target)) {
      setScreen("projects");
      return;
    }
    if (!preserveRouteContext && projectId !== projectToOpenId) clearProjectSwitchRouteContext();
    setOpenProjectTabIds((current) => nextOpenProjectTabs(current, projectToOpenId, pinnedProjectTabIds, MAX_PROJECT_TABS));
    setProjectId(projectToOpenId);
    void setScreen("project");
  }
  useEffect(() => {
    let active = true;
    let navigationSequence = 0;
    const applyLinkedWork = (target: ClusterWorkNavigationTarget) => {
      if (!target?.screen || !activeUser || !isAppScreen(target.screen)) return;
      const delegatedForms = delegatedFormDestination({ screen: target.screen, scope: target.inspectScope, id: target.inspectId, isAdmin: Boolean(activeUser.isAdmin) });
      if (!delegatedForms && !canOpenScreen(activeUser, target.screen)) return;
      // A generic Studio Settings route is not enough: announcement editor
      // links are administrative, and must not leave an inspector token in a
      // non-admin session before the Studio Settings route rejects them.
      if (target.screen === "studioSettings" && !activeUser.isAdmin && !delegatedForms) return;
      // Release a startup protocol handoff only after the authenticated route
      // boundary has accepted it; the resource endpoint still authorizes data.
      clearPendingDesktopWorkNavigation(target);

      const url = new URL(window.location.href);
      const params = url.searchParams;
      if (target.projectId) params.set(CLUSTER_WORK_PROJECT_QUERY_KEY, target.projectId);
      else params.delete(CLUSTER_WORK_PROJECT_QUERY_KEY);
      if (target.projectTab) params.set(CLUSTER_WORK_PROJECT_TAB_QUERY_KEY, target.projectTab);
      else params.delete(CLUSTER_WORK_PROJECT_TAB_QUERY_KEY);
      target.packetId ? params.set("workPacket", target.packetId) : params.delete("workPacket");
      target.policyId ? params.set("workPolicy", target.policyId) : params.delete("workPolicy");
      const previousInspector = params.get("inspect");
      const previousScope = previousInspector?.includes(":") ? previousInspector.slice(0, previousInspector.indexOf(":")) : null;
      if (target.inspectScope && target.inspectId) params.set("inspect", `${target.inspectScope}:${target.inspectId}`);
      else params.delete("inspect");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (target.inspectScope && target.inspectId) {
        window.dispatchEvent(new CustomEvent("cluster:inspector-state-changed", { detail: { scope: target.inspectScope, id: target.inspectId } }));
      } else if (previousScope) {
        window.dispatchEvent(new CustomEvent("cluster:inspector-state-changed", { detail: { scope: previousScope, id: null } }));
      }

      if (delegatedForms) {
        // A scoped review grant authorizes a particular Form response only.
        // It does not grant any Studio Settings privileges or access to other forms.
        void setScreen("settings", { section: delegatedForms });
        return;
      }
      if (target.projectId) setProjectId(target.projectId);
      else if ((target.screen === "board" && target.boardId)
        || (target.screen === "whiteboard" && target.whiteboardId)
        || (target.screen === "packets" && (target.packetId || target.policyId))
        || (target.inspectScope && ["calendar-event", "schedule-block", "timeline-item", "library-item", "person", "ticket", "approval"].includes(target.inspectScope))) {
        // The fresh detail reader established this is standalone, or belongs
        // to the global People directory. Never retain the previous Project.
        setProjectId(null);
      }
      if (target.screen === "project") {
        if (!target.projectId) return;
        openProject(target.projectId, true);
        if (target.projectTab) {
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("cluster-project-tab-command", { detail: { projectId: target.projectId, tab: target.projectTab } })), 0);
        }
        return;
      }
      if (target.screen === "board") {
        if (target.boardId) setBoardId(target.boardId);
        void setScreen("board");
        return;
      }
      if (target.screen === "whiteboard") {
        if (target.whiteboardId) setWhiteboardId(target.whiteboardId);
        void setScreen("whiteboard");
        return;
      }
      if (target.screen === "admin" && target.inspectScope === "approval") {
        if (!activeUser?.isAdmin) return;
        void setScreen("admin", { section: "approvals" });
        return;
      }
      if (target.screen === "studioSettings" && (target.inspectScope === "studio-form" || target.inspectScope === "form-submission" || target.inspectScope === "studio-application" || target.inspectScope === "studio-announcement" || target.inspectScope === "studio-announcement-new" || target.inspectScope === "studio-announcement-list")) {
        void setScreen("studioSettings", { section: "studioSystems" });
        return;
      }
      void setScreen(target.screen);
      if (target.screen === "packets" && (target.packetId || target.policyId)) {
        // Packet readers subscribe only to the post-admission event. Emitting
        // the raw intent before the ACL result would mutate a mounted reader.
        const acceptedSequence = navigationSequence;
        window.setTimeout(() => {
          if (active && acceptedSequence === navigationSequence) {
            window.dispatchEvent(new CustomEvent(CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT, { detail: target }));
          }
        }, 0);
      }
    };
    const openLinkedWork = (event: Event) => {
      const incoming = (event as CustomEvent<ClusterWorkNavigationTarget>).detail;
      const sequence = ++navigationSequence;
      if (!incoming?.screen || !activeUser || !isAppScreen(incoming.screen)) return;
      // Permission failure must be a visible, non-revealing recovery state,
      // not a silent no-op that makes Search or Inbox appear broken. Delegated
      // Form reviewers still use their narrow My Forms authorization boundary.
      const delegatedForms = delegatedFormDestination({ screen: incoming.screen, scope: incoming.inspectScope, id: incoming.inspectId, isAdmin: Boolean(activeUser.isAdmin) });
      if (!canOpenScreen(activeUser, incoming.screen) && !delegatedForms) {
        clearPendingDesktopWorkNavigation(incoming);
        reportClusterWorkNavigationRecovery({
          title: "Workspace unavailable",
          message: "This tool is disabled or you do not have access. Your current workspace was preserved.",
          tone: "warning",
        });
        return;
      }
      if (incoming.screen === "board" && incoming.inspectScope === "card") {
        if (!canOpenScreen(activeUser, "board")) return;
        // Card/Board placement is mutable. Do not keep the previous Board or
        // trust a notification's original Board ID when moving between tools.
        void resolveAuthorizedCardNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (id) => queryApi<AuthorizedCardRead>(`/api/cards/${encodeURIComponent(id)}`, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          if (!resolved) {
            clearPendingDesktopWorkNavigation(incoming);
            reportClusterWorkNavigationRecovery({
              title: "Card link unavailable",
              message: "The Card or its current Board is unavailable, or your access has changed. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          clearPendingDesktopWorkNavigation(incoming);
          applyLinkedWork(resolved);
        });
        return;
      }
      if (incoming.screen === "board" && incoming.inspectScope !== "card") {
        if (!canOpenScreen(activeUser, "board")) return;
        void resolveAuthorizedBoardNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (id) => queryApi<AuthorizedBoardRead>(`/api/boards/${encodeURIComponent(id)}`, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Board link unavailable",
              message: "The Board could not be verified or your access has changed. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      if (requiresAuthorizedProjectDetailNavigation(incoming)) {
        if (!canOpenScreen(activeUser, "project")) return;
        void resolveAuthorizedProjectDetailNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (path) => queryApi<ProjectDetailRead>(path, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Project record unavailable",
              message: "The linked Build, QA or Source record could not be verified, or your access has changed. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      if (requiresAuthorizedProjectExtraNavigation(incoming)) {
        if (!canOpenScreen(activeUser, "project")) return;
        void resolveAuthorizedProjectExtraNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (path) => queryApi(path, { force: true, persist: false, staleWhileRevalidate: false }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Project resource unavailable",
              message: "The linked asset, control, review or repository is no longer available to you. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      if (incoming.screen === "project") {
        if (!canOpenScreen(activeUser, "project")) return;
        void resolveAuthorizedProjectNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (id) => queryApi<AuthorizedProjectRead>(`/api/projects/${encodeURIComponent(id)}/snapshot`, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Project link unavailable",
              message: "The Project could not be verified or your access has changed. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      if (requiresAuthorizedPacketNavigation(incoming)) {
        if (!canOpenScreen(activeUser, "packets")) return;
        void resolveAuthorizedPacketNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (path) => queryApi<PacketNavigationCatalogRead>(path, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Packet or policy link unavailable",
              message: "The linked Packet or Studio Policy is no longer available to you. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      if (requiresAuthorizedDetailNavigation(incoming)) {
        if (!canOpenScreen(activeUser, incoming.screen)) return;
        void resolveAuthorizedDetailNavigation(incoming, {
          isCurrent: () => active && sequence === navigationSequence,
          read: (path) => queryApi<DetailNavigationRead>(path, {
            force: true, persist: false, staleWhileRevalidate: false,
          }),
        }).then((resolved) => {
          if (!active || sequence !== navigationSequence) return;
          clearPendingDesktopWorkNavigation(incoming);
          if (!resolved) {
            reportClusterWorkNavigationRecovery({
              title: "Resource link unavailable",
              message: "The linked record could not be verified or your access has changed. Your current workspace was preserved.",
              tone: "warning",
            });
            return;
          }
          applyLinkedWork(resolved);
        });
        return;
      }
      applyLinkedWork(incoming);
    };
    window.addEventListener(CLUSTER_OPEN_WORK_SOURCE_EVENT, openLinkedWork);
    const pendingDesktopWork = readPendingDesktopWorkNavigation();
    if (pendingDesktopWork && activeUser) {
      openLinkedWork(new CustomEvent(CLUSTER_OPEN_WORK_SOURCE_EVENT, { detail: pendingDesktopWork }));
    }
    return () => {
      active = false;
      navigationSequence += 1;
      window.removeEventListener(CLUSTER_OPEN_WORK_SOURCE_EVENT, openLinkedWork);
    };
  }, [projects, user, activeUser, screen, projectId, boardId, whiteboardId]);

  const resolvingDesktopCommitRef = useRef<object | null>(null);
  useEffect(() => {
    if (!activeUser || !canOpenScreen(activeUser, "project") || !projects.length) return;
    let disposed = false;
    const resolveCommit = () => {
      const intent = readPendingDesktopSourceCommit();
      if (!intent || resolvingDesktopCommitRef.current === intent) return;
      resolvingDesktopCommitRef.current = intent;
      void api<{ ok: true; projectId: string; commitId: string; repositoryId: string }>(
        `/api/source-control/resolve-commit?repositoryId=${encodeURIComponent(intent.repositoryId)}&revision=${encodeURIComponent(intent.revision)}`,
      ).then((resolved) => {
        if (disposed || readPendingDesktopSourceCommit() !== intent) return;
        clearPendingDesktopSourceCommit(intent);
        if (!projects.some((project) => project.id === resolved.projectId && canUseProject(activeUser, project))) {
          reportClusterWorkNavigationRecovery({ title: "Commit link unavailable", message: "The linked Project is not available in this session.", tone: "warning" });
          return;
        }
        queueDesktopWorkNavigation({ screen: "project", projectId: resolved.projectId, projectTab: "source", inspectScope: "source-commit", inspectId: resolved.commitId });
      }).catch(() => {
        if (disposed || readPendingDesktopSourceCommit() !== intent) return;
        clearPendingDesktopSourceCommit(intent);
        reportClusterWorkNavigationRecovery({ title: "Commit link unavailable", message: "This revision was not found or you no longer have access. Refresh Source Control or ask your Project lead.", tone: "warning" });
      }).finally(() => {
        if (resolvingDesktopCommitRef.current === intent) resolvingDesktopCommitRef.current = null;
      });
    };
    window.addEventListener(CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT, resolveCommit);
    resolveCommit();
    return () => {
      disposed = true;
      // A Project refresh/login transition can replace this effect while its
      // request is pending. Allow the new owner to retry the same intent.
      resolvingDesktopCommitRef.current = null;
      window.removeEventListener(CLUSTER_DESKTOP_SOURCE_COMMIT_EVENT, resolveCommit);
    };
  }, [activeUser, projects]);

  function toggleProjectTabPin(projectToPinId: string) {
    setPinnedProjectTabIds((current) => current.includes(projectToPinId) ? current.filter((id) => id !== projectToPinId) : [...current, projectToPinId].slice(0, MAX_PROJECT_TABS));
  }
  function moveProjectTab(projectToMoveId: string, delta: -1 | 1) {
    setOpenProjectTabIds((current) => {
      const index = current.indexOf(projectToMoveId);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }
  function closeOtherProjectTabs(projectToKeepId: string) {
    setOpenProjectTabIds([projectToKeepId]);
    setPinnedProjectTabIds((current) => current.filter((id) => id === projectToKeepId));
    if (projectId !== projectToKeepId) openProject(projectToKeepId);
  }
  function closeProjectTab(projectToCloseId: string) {
    const currentIndex = openProjectTabIds.indexOf(projectToCloseId);
    const nextTabs = openProjectTabIds.filter((id) => id !== projectToCloseId);
    setOpenProjectTabIds(nextTabs);
    setPinnedProjectTabIds((current) => current.filter((id) => id !== projectToCloseId));
    if (isProjectContextScreen(screen) && projectId === projectToCloseId) {
      const fallbackId = nextTabs[Math.max(0, currentIndex - 1)] || nextTabs[0] || null;
      setProjectId(fallbackId);
      void setScreen(fallbackId ? "project" : "projects");
    }
  }
  useEffect(() => {
    if (screen === "board" && boardId) void loadBoard(boardId);
  }, [screen, boardId]);
  useEffect(() => {
    if (screen === "board" || !board) return;
    const timer = window.setTimeout(() => {
      setBoard(null);
      setBoardLoadError(null);
      setBoardLoading(false);
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [screen, board?.id]);
  useEffect(() => {
    if (activeUser && !canOpenScreen(activeUser, screen)) {
      const blockedScreen = screen;
      const navigation = createNavigationState("dashboard");
      historyRestoreRef.current = true;
      setScreenState("dashboard");
      setProjectId(null);
      setBoardId(null);
      setWhiteboardId(null);
      setNavigationNotice({
        title: "Access changed",
        message: `You do not currently have permission to open ${screenLabel(blockedScreen)}. Home was opened instead.`,
        tone: "warning",
      });
      window.history.replaceState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
      writeNavigationSession(window.sessionStorage, navigation);
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
    }
  }, [activeUser, screen]);
  useRouteScrollRestoration(mainContentRef, `${screen}:${projectId || ""}:${boardId || ""}:${whiteboardId || ""}`);
  useRoutePerformance(`${screen}:${projectId || ""}:${boardId || ""}:${whiteboardId || ""}`);
  const pinnedToolScreens = useMemo(() => {
    const aliases: Record<string, AppScreen> = {
      home: "dashboard", dashboard: "dashboard", "my work": "mywork", mywork: "mywork", projects: "projects",
      notifications: "inbox", calendar: "calendar", timeline: "timeline", builds: "builds", qa: "qa", tickets: "tickets",
      scheduler: "scheduler", time: "scheduler", library: "library", people: "people", activity: "activity", operations: "admin", settings: "settings",
    };
    return String(appSettings.userPinnedToolsCsv || "Home, My Work, Projects, Inbox")
      .split(",")
      .map((item) => aliases[item.trim().toLowerCase()])
      .filter((item): item is AppScreen => Boolean(item))
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, 9);
  }, [appSettings.userPinnedToolsCsv]);
  const shellShortcutRegistry = useShellKeyboardShortcuts({
    commandHotkey: appSettings.userCommandPaletteHotkey,
    toggleCommand: useCallback(() => { if (!resourceWindow) setCommandOpen((open) => !open); }, [resourceWindow]),
    closeCommand: useCallback(() => setCommandOpen(false), []),
    closeSidebar: useCallback(() => setMobileSidebarOpen(false), []),
    openShortcutHelp: useCallback(() => { if (!resourceWindow) setShortcutHelpOpen(true); }, [resourceWindow]),
    openPinnedTool: useCallback((index: number) => {
      if (resourceWindow) return;
      const target = pinnedToolScreens[index];
      if (!target || !activeUser || !canOpenScreen(activeUser, target)) return;
      void setScreen(target);
    }, [resourceWindow, pinnedToolScreens, activeUser, setScreen]),
  });
  async function updatePresence(availability: string, message?: string | null, connectionVisibility?: "visible" | "invisible") {
    const result = await api<{ ok: boolean; user: User }>("/api/me/presence", {
      method: "PATCH",
      body: JSON.stringify({ availability, message, connectionVisibility }),
    });
    setUser(result.user);
    window.dispatchEvent(new CustomEvent("cluster:presence-policy-changed"));
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setSessionRecoveryMessage(null);
    clearAuthenticatedUiState();
  }
  const privacyPolicyPath = typeof window !== "undefined" && /^\/legal\/privacy\/?$/.test(window.location.pathname);
  const termsPolicyPath = typeof window !== "undefined" && /^\/legal\/terms\/?$/.test(window.location.pathname);
  const operatorAgreementPath = typeof window !== "undefined" && /^\/legal\/operator-agreement\/?$/.test(window.location.pathname);
  const copyrightPolicyPath = typeof window !== "undefined" && /^\/legal\/copyright\/?$/.test(window.location.pathname);
  const securityDisclosurePolicyPath = typeof window !== "undefined" && /^\/legal\/security\/?$/.test(window.location.pathname);
  const thirdPartyDisclosurePath = typeof window !== "undefined" && /^\/legal\/third-parties\/?$/.test(window.location.pathname);
  const copyrightReportPath = typeof window !== "undefined" && /^\/legal\/copyright\/report\/?$/.test(window.location.pathname);
  const copyrightCounterPath = typeof window !== "undefined" && /^\/legal\/copyright\/counter\/?$/.test(window.location.pathname);
  if (privacyPolicyPath) return <PrivacyPolicyPage />;
  if (termsPolicyPath) return <TermsPolicyPage />;
  if (operatorAgreementPath) return <OperatorAgreementPage />;
  if (copyrightReportPath) return <CopyrightReportPage />;
  if (copyrightCounterPath) return <CopyrightCounterNoticePage />;
  if (copyrightPolicyPath) return <CopyrightPolicyPage />;
  if (securityDisclosurePolicyPath) return <SecurityDisclosurePolicyPage />;
  if (thirdPartyDisclosurePath) return <ThirdPartyDisclosurePage />;
  if (loading) return <WorkspaceLoadingState />;
  if (shareToken) return <PublicSharePage token={shareToken} />;
  if (bootError) return <ClusterBootError error={bootError} onRetry={() => { setLoading(true); setBootError(null); setBootAttempt((current) => current + 1); }} />;
  if (!setupStatus) return <WorkspaceLoadingState />;
  if (!setupStatus.setupComplete) {
    return (
      <LazyFeatureBoundary label="Setup"><LazySetupWizard
        onComplete={(createdUser) => {
          setSetupStatus({
            ...setupStatus,
            setupComplete: true,
            userCount: Math.max(setupStatus.userCount, 1),
            workspaceCount: Math.max(setupStatus.workspaceCount, 1),
          });
          setUser(createdUser);
          loadAppSettings();
        }}
      /></LazyFeatureBoundary>
    );
  }
  if (signedOutKiosk) return <LazyFeatureBoundary label="Kiosk"><LazySignedOutKioskPage exitShortcut={nativeKioskExitShortcut} /></LazyFeatureBoundary>;
  if (!user) {
    return <PublicClusterCover recoveryMessage={sessionRecoveryMessage} onLogin={(loggedInUser) => {
      setUser(loggedInUser as User);
      setSessionRecoveryMessage(null);
    }} />;
  }
  const entryScreen = authenticatedEntryScreen({ user, onUserUpdated: (next) => setUser(next as User), onRefresh: loadMe, onLogout: logout });
  if (entryScreen) return entryScreen;
  return (
    <StudioPolicyGate onLogout={logout}><div className={`app-shell shell-unified-v3430 visual-overhaul-v139 visual-declutter-v140 visual-card-diet-v141 builds-folded-v157 accessibility-pass-v204 ${resourceWindow ? "cluster-resource-window-v489" : ""}`}>
      {desktopHost && !resourceWindow && !signedOutKiosk ? <Suspense fallback={null}><LazyDesktopPresencePublisher enabled navigation={currentNavigation} projects={projects} /></Suspense> : null}
      {!resourceWindow && <Sidebar screen={screen} currentRoute={currentNavigationRoute} setScreen={setScreen} user={activeUser} settings={appSettings} projects={projects} currentProjectId={projectId} onOpenProject={openProject} onOpenChangelog={() => setScreen("changelog")} open={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />}
      {!resourceWindow && <ClusterButton unstyled type="button" className="mobile-sidebar-trigger-v289" data-drawer-open={mobileSidebarOpen ? "true" : "false"} onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation" aria-controls="cluster-sidebar" aria-expanded={mobileSidebarOpen}>
        <ClusterIcon name="menu" />
      </ClusterButton>}
      {!resourceWindow && mobileSidebarOpen && <div className="sidebar-backdrop-v289" data-cluster-backdrop-for="cluster-sidebar" role="presentation" aria-hidden="true" onPointerDown={() => setMobileSidebarOpen(false)} />}
      <main id="cluster-main-content" ref={mainContentRef} className="content-shell" tabIndex={-1} aria-label={`${accessibleRouteLabel} workspace`}>
        <div className="sr-only-v204" role="status" aria-live="polite" aria-atomic="true">
          Opened {accessibleRouteLabel}
        </div>
        {!resourceWindow && <Suspense fallback={<div className="project-tabs-loading-v499" aria-hidden="true" />}><LazyProjectTabsBar projects={visibleProjects} openProjectIds={openProjectTabIds} pinnedProjectIds={pinnedProjectTabIds} activeProjectId={projectId} screen={screen} currentRoute={currentNavigationRoute} user={activeUser} settings={appSettings} onOpenHome={() => setScreen("dashboard")} onOpenProject={openProject} onCloseProject={closeProjectTab} onToggleProjectPin={toggleProjectTabPin} onMoveProjectTab={moveProjectTab} onCloseOtherProjects={closeOtherProjectTabs} onOpenProjects={() => setScreen("projects")} onOpenMyWork={() => setScreen("mywork")} onOpenNotifications={() => setScreen("inbox")} onOpenTickets={() => setScreen("tickets")} onOpenPeople={() => setScreen("people")} onOpenUserAdmin={() => setScreen("people", { section: activeUser.isAdmin ? "admin" : null })} onOpenProfile={() => setScreen("people")} onOpenSettings={() => setScreen("settings")} onOpenQuickCreate={() => setQuickCreateOpen(true)} commandPaletteOpen={commandOpen} resumeContext={resumeContext} onResumeContext={resumeWorkspace} onClearResumeContext={clearResumeWorkspace} onOpenCommandPalette={() => { setMobileSidebarOpen(false); setCommandOpen((current) => !current); }} onOpenNavigation={() => setMobileSidebarOpen(true)} onPresenceChange={updatePresence} onLogout={logout} /></Suspense>}
        {resourceWindow && <nav className="resource-window-toolbar-v493" aria-label="Workspace window navigation">
          <div className="resource-window-history-v493">
            <ClusterButton variant="quiet" size="compact" onClick={() => window.history.back()} aria-label="Go back"><ClusterIcon name="chevron-left" />Back</ClusterButton>
            <ClusterButton variant="quiet" size="compact" onClick={() => window.history.forward()} aria-label="Go forward">Forward<ClusterIcon name="chevron-right" /></ClusterButton>
          </div>
          <strong>{accessibleRouteLabel}</strong>
          <ClusterActionButton variant="quiet" size="compact" action={async () => {
            if (!await copyClusterText(window.location.href)) throw new Error("Clipboard access was denied.");
          }} workingLabel="Copying…" successLabel="Copied" errorLabel="Copy failed">Copy link</ClusterActionButton>
        </nav>}
        {!resourceWindow && screen !== "project" && contextualParent && contextualParentLabel && <nav className="contextual-navigation-v396" aria-label="Context navigation">
          <ClusterButton type="button" className="" onClick={openContextualParent} variant="quiet" size="compact">
            <ClusterIcon name="chevron-left" />
            <span>{contextualParentLabel}</span>
          </ClusterButton>
          <span>{currentNavigationRoute}</span>
        </nav>}
        <NavigationOperationalStatus
          model={operationalStatus}
          onReviewSync={() => { setSettingsInitialSection("desktop"); void setScreen("settings", { section: "desktop" }); }}
          onRetry={() => void refreshOfflineSyncState({ flush: false, pull: true })}
        />
        {navigationNotice && <div className={`navigation-recovery-notice-v396 ${navigationNotice.tone || "info"}`} role={navigationNotice.tone === "warning" ? "alert" : "status"}>
          <div>
            <strong>{navigationNotice.title}</strong>
            <span>{navigationNotice.message}</span>
          </div>
          <ClusterButton type="button" className="" onClick={() => setNavigationNotice(null)} variant="quiet" size="compact">Dismiss</ClusterButton>
        </div>}
        {previewUser && (
          <div className="permission-preview-banner-v111">
            <strong>Previewing as {displayUserName(previewUser)}</strong>
            <span>Permissions and project visibility are filtered for this user.</span>
            <ClusterButton type="button" className="" onClick={() => setPreviewUser(null)} variant="quiet" size="compact">
              Exit preview
            </ClusterButton>
          </div>
        )}
        <Suspense fallback={<ScreenLoadingState screen={screen} />}>
        {screen === "people" && <LazyFeatureBoundary label="People"><section className={`people-unified-workspace-v535 ${routeSection === "admin" && activeUser.isAdmin ? "is-admin-mode" : "is-directory-mode"}`}><LazyProfilesPage currentUser={activeUser} projects={visibleProjects} onOpenProject={openProject} onEditProfile={() => { setSettingsInitialSection("profile"); void setScreen("settings", { section: "profile" }); }} adminMode={routeSection === "admin" && activeUser.isAdmin} /></section></LazyFeatureBoundary>}
        {screen === "dashboard" && (
          <LazyDashboard
            key={activeUser.id}
            projects={visibleProjects}
            onOpenProjects={() => setScreen("projects")}
            onOpenProject={openProject}
            onOpenMyWork={() => setScreen("mywork")}
            onOpenIntegrations={() => setScreen("integrations")}
            onOpenAdmin={() => setScreen("admin")}
            onOpenLibrary={() => setScreen("library")}
            onOpenTime={() => setScreen("scheduler")}
            onOpenTeam={() => setScreen("people")}
            onOpenTimeline={() => setScreen("timeline")}
            onOpenBuilds={() => setScreen("projects")}
            onOpenQA={() => setScreen("qa")}
            onOpenTickets={() => setScreen("tickets")}
            onOpenNotifications={() => setScreen("inbox")}
            onOpenActivity={() => setScreen(activeUser.isAdmin ? "admin" : "activity")}
            isAdmin={Boolean(activeUser.isAdmin)}
            currentUser={activeUser}
            settings={appSettings}
            resumeContext={resumeContext}
            onOpenBoard={(id) => {
              setBoardId(id);
              setScreen("board");
            }}
          />
        )}
        {screen === "mywork" && (
          <LazyFeatureBoundary label="My Work"><LazyMyWorkPage
            user={activeUser}
            projects={visibleProjects}
            onOpenBoard={(id) => {
              setBoardId(id);
              setScreen("board");
            }}
            onOpenTime={() => setScreen("scheduler")}
            onOpenTimeline={() => setScreen("timeline")}
            onOpenProjects={() => setScreen("projects")}
            getProjectCompleteness={projectCompleteness}
            getProjectHealth={projectHealth}
          /></LazyFeatureBoundary>
        )}
        {screen === "inbox" && <LazyNotificationCenterPage key={activeUser.id} currentUser={activeUser} onOpenProject={openProject} onOpenTickets={() => setScreen("tickets")} onOpenTime={() => setScreen("scheduler")} onOpenCalendar={() => setScreen("calendar")} onOpenActivity={() => setScreen(activeUser.isAdmin ? "admin" : "activity")} onOpenUserAdmin={() => setScreen("people", { section: activeUser.isAdmin ? "admin" : null })} />}
        {screen === "builds" && <LazyBuildsFoldedIntoProjectsPage projects={visibleProjects} onOpenProject={openProject} />}
        {screen === "qa" && <LazyQAFoldedIntoProjectsPage projects={visibleProjects} onOpenProject={openProject} />}
        {screen === "tickets" &&
          (appSettings.ticketsEnabled !== false ? (
            <LazyTicketSystemPage
              projects={visibleProjects}
              currentUser={activeUser}
              onOpenTickets={() => setScreen("tickets")}
              onOpenQa={() => setScreen("qa")}
              onOpenBoard={(id) => {
                setBoardId(id);
                setScreen("board");
              }}
              onOpenProject={openProject}
              onOpenUser={(id) => { openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: id }); }}
            />
          ) : (
            <ToolDisabledPage label="Tickets" />
          ))}
        {screen === "activity" && <LazyFeatureBoundary label="Activity"><LazyActivityPage projects={visibleProjects} onOpenProject={openProject} onOpenTickets={() => setScreen("tickets")} onOpenQa={() => setScreen("qa")} onOpenTime={() => setScreen("scheduler")} projectTypeLabel={projectTypeBadge} projectStatusLabel={projectStatusLabel} /></LazyFeatureBoundary>}
        {screen === "projects" && (
          <LazyFeatureBoundary label="Projects"><LazyProjectsRoute
            projects={visibleProjects}
            whiteboards={whiteboards}
            onOpenGit={() => setScreen("toolInfrastructure", { section: "source-control" })}
            onOpenTimeline={() => setScreen("timeline")}
            onOpenBuilds={() => setScreen("projects")}
            onOpenNotifications={() => setScreen("inbox")}
            onOpenActivity={() => setScreen(activeUser.isAdmin ? "admin" : "activity")}
            onOpenReports={() => setScreen("tickets")}
            isAdmin={Boolean(activeUser.isAdmin)}
            onCreateProject={() => openSharedCreate("project")}
            onOpenProject={openProject}
            onOpenBoard={(id) => {
              setBoardId(id);
              setScreen("board");
            }}
            onOpenWhiteboard={(id) => {
              setWhiteboardId(id);
              setScreen("whiteboard");
            }}
          /></LazyFeatureBoundary>
        )}
        {screen === "project" && (
          <LazyFeatureBoundary label="Project"><LazyProjectDetailRoute
            project={visibleProjects.find((project) => project.id === projectId) || visibleProjects[0] || null}
            projects={visibleProjects}
            whiteboards={whiteboards}
            currentUser={activeUser}
            onBack={() => setScreen("projects")}
            onOpenTimeline={() => openClusterWorkNavigation({ screen: "timeline", projectId: projectId || visibleProjects[0]?.id || null })}
            onOpenTickets={(id) => openClusterWorkNavigation({ screen: "tickets", projectId: id })}
            onOpenTime={(id) => openClusterWorkNavigation({ screen: "scheduler", projectId: id })}
            onReloadProjects={loadProjects}
            onReloadWhiteboards={loadWhiteboards}
            onOpenBoard={(id) => {
              setBoardId(id);
              setScreen("board");
            }}
            onOpenWhiteboard={(id) => {
              setWhiteboardId(id);
              setScreen("whiteboard");
            }}
            onOpenLibrary={(folderId) => openClusterWorkNavigation({ screen: "library", projectId: projectId || visibleProjects[0]?.id || null, inspectScope: "library-item", inspectId: folderId })}
          /></LazyFeatureBoundary>
        )}
        {screen === "board" && (boardLoading && boardId ? (
          <BoardLoadingState label="Loading board" columns={4} />
        ) : boardLoadError && boardId ? (
          <RequestErrorState error={boardLoadError} title="Board could not be loaded" onRetry={() => void loadBoard(boardId)} reloadLabel="Reload projects" onReload={() => void loadProjects()} />
        ) : (
          <LazyBoardPage
            board={board}
            projects={visibleProjects}
            currentUser={activeUser}
            currentBoardId={boardId}
            onSelectBoard={(id) => {
              setBoardId(id);
              if (!id) {
                setBoard(null);
                setBoardLoadError(null);
                setBoardLoading(false);
              }
            }}
            onRefresh={() => loadBoard()}
            onRefreshProjects={loadProjects}
            onOpenSettings={() => setScreen("settings")}
            onOpenProject={openProject}
            onOpenTickets={(id) => openClusterWorkNavigation({ screen: "tickets", projectId: id })}
            onOpenTimeline={(id) => openClusterWorkNavigation({ screen: "timeline", projectId: id })}
            onOpenTime={(id) => openClusterWorkNavigation({ screen: "scheduler", projectId: id })}
            onCloseBoard={() => {
              const origin = boardReturnOriginRef.current;
              boardReturnOriginRef.current = null;
              setBoard(null);
              setBoardId(null);
              // The Project workspace is the only case where going to the owning
              // Project is appropriate. All other entry points restore their page.
              if (origin?.screen === "project" && origin.projectId) openProject(origin.projectId);
              else {
                setProjectId(origin?.projectId || null);
                void setScreen(origin?.screen && origin.screen !== "board" ? origin.screen : "projects");
              }
            }}
          />
        ))}
        {screen === "whiteboard" && (
          <LazyWhiteboardPage
            whiteboards={whiteboards}
            projects={visibleProjects}
            selectedWhiteboardId={whiteboardId}
            onSelectWhiteboard={setWhiteboardId}
            onReloadWhiteboards={loadWhiteboards}
            onOpenProject={openProject}
            onOpenTickets={(id) => openClusterWorkNavigation({ screen: "tickets", projectId: id })}
            onOpenTimeline={(id) => openClusterWorkNavigation({ screen: "timeline", projectId: id })}
            onOpenTime={(id) => openClusterWorkNavigation({ screen: "scheduler", projectId: id })}
          />
        )}
        {screen === "calendar" && (appSettings.calendarEnabled !== false ? <CalendarPage key={activeUser.id} projects={visibleProjects} /> : <ToolDisabledPage label="Calendar" />)}
        {screen === "timeline" && (appSettings.timelineEnabled !== false ? <LazyTimelinePage projects={visibleProjects} currentUser={activeUser} /> : <ToolDisabledPage label="Timeline" />)}
        {screen === "scheduler" && (appSettings.schedulerEnabled !== false ? <LazyTimePage projects={visibleProjects} currentUser={activeUser} /> : <ToolDisabledPage label="Scheduler" />)}
        {screen === "library" && (appSettings.libraryEnabled !== false ? <LazyLibraryPage projects={visibleProjects} currentUser={activeUser} /> : <ToolDisabledPage label="Library" />)}
        {(screen === "packets" || screen === "myRecords") &&
          (appSettings.packetsEnabled !== false ? (
            <LazyPacketsPage
              key={activeUser.id}
              currentUser={activeUser}
              settings={appSettings}
              initialView={screen === "myRecords" ? "records" : "packets"}
              onOpenLibrary={(folderId) => openClusterWorkNavigation({ screen: "library", inspectScope: "library-item", inspectId: folderId })}
              onOpenProject={(projectId) => openClusterWorkNavigation({ screen: "project", projectId })}
            />
          ) : (
            <ToolDisabledPage label="Packets" />
          ))}
        {isStandaloneToolRoute(screen) && <StandaloneToolRoute screen={screen} context={{
          isAdmin: Boolean(activeUser.isAdmin),
          pinConfigured: Boolean(activeUser.pinConfigured),
        }} />}
        {screen === "toolInfrastructure" && user.isAdmin && <LazyToolInfrastructurePage projects={projects} settings={appSettings} initialSection={routeSection} />}
        {screen === "admin" && user.isAdmin && (
          <LazyAdminPage
            projects={projects}
            whiteboards={whiteboards}
            currentUser={user}
            onReloadProjects={loadProjects}
            onReloadWhiteboards={loadWhiteboards}
            previewUser={previewUser}
            onStartPreview={(member) => {
              setPreviewUser(member);
              setScreen("dashboard");
            }}
            onStopPreview={() => setPreviewUser(null)}
            onOpenBoard={(id) => {
              setBoardId(id);
              setScreen("board");
            }}
            onOpenWhiteboard={(id) => {
              setWhiteboardId(id);
              setScreen("whiteboard");
            }}
            settings={appSettings}
            scope="operations"
            initialSection={routeSection === "approvals" ? "approvals" : undefined}
            onOpenUserAdmin={() => setScreen("people", { section: "admin" })}
            onOpenProjects={() => setScreen("projects")}
            onOpenProject={openProject}
            onOpenToolInfrastructure={() => setScreen("toolInfrastructure")}
            onOpenServerConfig={() => setScreen("serverConfig")}
            onOpenStudioSettings={() => setScreen("studioSettings")}
            onOpenTickets={() => setScreen("tickets")}
            onOpenQa={() => setScreen("qa")}
            onOpenTime={() => setScreen("scheduler")}
          />
        )}
        {screen === "desktop" && <LazyDesktopWorkspacePage serverSettings={appSettings} />}
        {screen === "changelog" && (
          <section className="page">
            <ChangelogPage />
          </section>
        )}
        {screen === "settings" && (
          <LazyAccountSettingsPage
            theme={theme}
            onThemeChange={setTheme}
            onSettingsSaved={(settings) => {
              setAppSettings(settings);
              applyCustomization(settings, user.personalAccentColor);
            }}
            currentUser={user}
            onUserUpdated={(nextUser) => {
              setUser(nextUser);
              applyCustomization(appSettings, nextUser.personalAccentColor);
            }}
            initialSection={settingsInitialSection}
            onSectionChange={(nextSection) => {
              if (nextSection === settingsInitialSection) return;
              setSettingsInitialSection(nextSection);
              if (!historyRestoreRef.current) {
                const navigation = createNavigationState("settings", { section: nextSection });
                window.history.pushState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
              }
            }}
          />
        )}
        {screen === "studioSettings" && user.isAdmin && (
          <LazyStudioSettingsPage
            currentUser={user}
            initialSection={routeSection}
            initialSubsection={routeSubsection}
            onSubsectionChange={(nextTab) => {
              if (routeSubsection === nextTab) return;
              setRouteSubsection(nextTab);
              if (!historyRestoreRef.current) {
                const navigation = createNavigationState("studioSettings", { section: routeSection, subsection: nextTab });
                window.history.pushState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
              }
            }}
            onSectionChange={(nextSection) => {
              if (nextSection === routeSection) return;
              setRouteSection(nextSection);
              if (!historyRestoreRef.current) {
                const navigation = createNavigationState("studioSettings", { section: nextSection });
                window.history.pushState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
              }
            }}
            onSettingsSaved={(settings) => {
              setAppSettings(settings);
              applyCustomization(settings, user.personalAccentColor);
            }}
          />
        )}
        {screen === "serverConfig" && user.isAdmin && (
          <LazyServerConfigPage
            currentUser={user}
            initialSection={serverConfigInitialSection}
            onSectionChange={(nextSection) => {
              if (nextSection === serverConfigInitialSection) return;
              setServerConfigInitialSection(nextSection);
              if (!historyRestoreRef.current) {
                const navigation = createNavigationState("serverConfig", { section: nextSection });
                window.history.pushState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
              }
            }}
            onSettingsSaved={(settings) => {
              setAppSettings(settings);
              applyCustomization(settings, user.personalAccentColor);
            }}
          />
        )}
        </Suspense>
      </main>
      {!resourceWindow && quickCreateOpen && <Suspense fallback={null}><LazyQuickCreateDrawer
        key={activeUser.id}
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        projects={visibleProjects}
        settings={appSettings}
        currentUser={activeUser}
        context={{
          screen,
          projectId,
          boardId,
          whiteboardId,
          updatedAt: new Date().toISOString(),
        }}
        onReloadProjects={loadProjects}
        onReloadWhiteboards={loadWhiteboards}
        onOpenProject={openProject}
        onOpenBoard={(id) => {
          setBoardId(id);
          setScreen("board");
        }}
        onOpenWhiteboard={(id) => {
          setWhiteboardId(id);
          setScreen("whiteboard");
        }}
        onOpenTime={() => setScreen("scheduler")}
      /></Suspense>}
      {!resourceWindow && !nativeKioskActive && contextualHelpOpen && <Suspense fallback={null}><LazyClusterHelpDialog
        open={contextualHelpOpen}
        screen={screen}
        onClose={() => setContextualHelpOpen(false)}
        canAccess={(candidate) => canOpenScreen(activeUser, candidate)}
        onNavigate={(destination) => { if (canOpenScreen(activeUser, destination)) { setContextualHelpOpen(false); void setScreen(destination); } }}
        onOpenShortcuts={() => { setContextualHelpOpen(false); setShortcutHelpOpen(true); }}
      /></Suspense>}
      <ClusterModal open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} backdropClassName="power-shortcuts-backdrop-v421" className="modal panel power-shortcuts-dialog-v421" labelledBy="power-shortcuts-title-v421">
            <header className="modal-header"><div><p className="eyebrow">Power user</p><h2 id="power-shortcuts-title-v421">Keyboard shortcuts</h2></div><ClusterButton type="button" className="" onClick={() => setShortcutHelpOpen(false)} variant="quiet" size="compact">Close</ClusterButton></header>
            <div className="power-shortcuts-grid-v421">
              {shellShortcutRegistry.definitions.filter((shortcut) => !shortcut.id.startsWith("shell.pinned-tool-")).map((shortcut) => <div key={shortcut.id}><kbd>{shortcut.shortcut}</kbd><span>{shortcut.label}</span></div>)}
              <div><kbd>Alt+1–9</kbd><span>Open your pinned tools</span></div>
              <div><kbd>Alt+← / →</kbd><span>Navigate Back / Forward on Desktop</span></div>
              {desktopHost && <div><kbd>Ctrl+Shift+N</kbd><span>Quick create from the native shell</span></div>}
              {desktopHost && <div><kbd>Ctrl+R</kbd><span>Reload the desktop workspace</span></div>}
              {desktopHost && <div><kbd>Ctrl+Shift+P</kbd><span>Manage desktop server profiles</span></div>}
            </div>
            {shellShortcutRegistry.conflicts.length ? <p className="muted" role="status">{shellShortcutRegistry.conflicts.length} shortcut collision{shellShortcutRegistry.conflicts.length === 1 ? "" : "s"} detected. Higher-priority commands win until the shortcut is changed.</p> : null}
            <div className="power-pinned-tools-v421">
              <strong>Pinned tools</strong>
              {pinnedToolScreens.length ? pinnedToolScreens.map((item, index) => <ClusterButton unstyled type="button" key={item} onClick={() => { setShortcutHelpOpen(false); void setScreen(item); }}><kbd>Alt+{index + 1}</kbd><span>{screenLabel(item)}</span></ClusterButton>) : <span>No valid pinned tools configured.</span>}
            </div>
      </ClusterModal>
      {commandOpen && <Suspense fallback={null}><LazyCommandPalette
        key={activeUser.id}
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        user={activeUser}
        projects={visibleProjects}
        setScreen={setScreen}
        onOpenProject={openProject}
        onOpenBoard={(id) => {
          setBoardId(id);
          setScreen("board");
        }}
        onOpenWhiteboard={(id) => {
          setWhiteboardId(id);
          setScreen("whiteboard");
        }}
        onOpenLibrary={(itemId, projectId) => openClusterWorkNavigation({ screen: "library", projectId: projectId || null, inspectScope: "library-item", inspectId: itemId })}
        projectTypeLabel={projectTypeBadge}
        currentScreen={screen}
        currentProjectId={projectId}
        recentNavigation={recentNavigation}
        settings={appSettings}
        onOpenQuickCreate={() => setQuickCreateOpen(true)}
      /></Suspense>}
    </div></StudioPolicyGate>
  );
}

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { queryApi, setApiQueryData } from "../../core/api";
import { subscribeProjectWorkflowUpdate, useProjectWorkflowList } from "../../core/project-workflow-storage";
import { subscribeProjectDeliveryUpdate, useProjectDeliveryList } from "../../core/project-delivery-storage";
import { useServerState } from "../../core/server-state";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import type {
  BuildArtifactRecord,
  ProjectDashboardPayload,
  ProjectMediaPayload,
  ProjectSnapshot,
  QASessionRecord,
  QATestPlan,
  User,
  WorkLinkRecord,
} from "../application/application-models";
import type { ProjectControlCenterPayload } from "./project-control-model";
import type { ProjectIntelligenceSnapshot } from "./ProjectIntelligencePanel";
import { PROJECT_WORKSPACE_SECTIONS, type ProjectWorkspaceTabId } from "./project-workspace-registry";
import { needsProjectTabLocation, projectTabForWorkspace, projectTabFromUrl, projectTabLocation } from "./project-tab-location";
import { projectWorkspaceRequestPlan } from "./project-request-budget";

const PROJECT_WORKSPACE_TABS = new Set<ProjectWorkspaceTabId>(PROJECT_WORKSPACE_SECTIONS.map((section) => section.id));

function writeProjectTabToLocation(projectId: string, tab: ProjectWorkspaceTabId, mode: "push" | "replace" = "replace") {
  if (typeof window === "undefined" || !PROJECT_WORKSPACE_TABS.has(tab)) return;
  if (!needsProjectTabLocation(window.location.href, projectId, tab, PROJECT_WORKSPACE_TABS)) return;
  const state = { ...(window.history.state || {}), clusterProjectTab: tab, clusterProjectTabProject: projectId };
  window.history[mode === "push" ? "pushState" : "replaceState"](
    state, "", projectTabLocation(window.location.href, projectId, tab),
  );
}

export function useProjectDetailWorkspace(projectId?: string | null) {
  const workflowProjectId = projectId || "";
  const [tab, setTabState] = useState<ProjectWorkspaceTabId>(() => projectTabForWorkspace(
    typeof window === "undefined" ? null : window.location.href, projectId, null, PROJECT_WORKSPACE_TABS,
  ));
  const tabRef = useRef(tab);
  const [tabOwner, setTabOwner] = useState(projectId || "");
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;
  // History changes are event effects, never side effects in a React state
  // updater (React may replay state updater functions in strict mode).
  const setTab = useCallback((next: SetStateAction<ProjectWorkspaceTabId>) => {
    if (!projectId || tabOwner !== projectId) return;
    const current = tabRef.current;
    const resolved = typeof next === "function" ? (next as (value: ProjectWorkspaceTabId) => ProjectWorkspaceTabId)(current) : next;
    if (!PROJECT_WORKSPACE_TABS.has(resolved) || resolved === current) return;
    tabRef.current = resolved;
    setTabState(resolved);
    writeProjectTabToLocation(projectId, resolved, "push");
  }, [projectId, tabOwner]);
  const [storedTabs, setStoredTabs, storedTabsState] = useServerState<Record<string, ProjectWorkspaceTabId>>("user", "projects.last-tabs", {});
  const [media, setMedia] = useState<ProjectMediaPayload>({ reviewAssets: [], files: [] });
  const [mediaStatus, setMediaStatus] = useState("");
  const [dashboard, setDashboard] = useState<ProjectDashboardPayload | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [controlCenter, setControlCenter] = useState<ProjectControlCenterPayload | null>(null);
  const [controlLoading, setControlLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<ProjectIntelligenceSnapshot | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [projectUsers, setProjectUsers] = useState<User[]>([]);
  const pulseRefreshTimer = useRef<number | null>(null);
  const mediaRequestSequence = useRef(0);
  const dashboardRequestSequence = useRef(0);
  const snapshotRequestSequence = useRef(0);
  const controlRequestSequence = useRef(0);
  const intelligenceRequestSequence = useRef(0);
  const usersRequestSequence = useRef(0);
  const [qaPlans] = useProjectDeliveryList<QATestPlan>("qa-plan", workflowProjectId);
  const [buildArtifacts] = useProjectDeliveryList<BuildArtifactRecord>("build", workflowProjectId);
  const [qaSessions] = useProjectDeliveryList<QASessionRecord>("qa-session", workflowProjectId);
  const [workflowLinks] = useProjectWorkflowList<WorkLinkRecord>("dependency", workflowProjectId);

  const loadMedia = useCallback(async (force = false) => {
    if (!projectId) return;
    const sequence = ++mediaRequestSequence.current;
    const next = await queryApi<ProjectMediaPayload>(`/api/projects/${projectId}/media`, {
      force,
      staleMs: 8_000,
      maxAgeMs: 30 * 60_000,
      tags: ["project-media", `project:${projectId}`],
    });
    if (sequence === mediaRequestSequence.current) setMedia(next);
  }, [projectId]);

  const updateMedia = useCallback((update: SetStateAction<ProjectMediaPayload>) => {
    if (!projectId) return;
    setMedia((current) => {
      const next = typeof update === "function" ? (update as (value: ProjectMediaPayload) => ProjectMediaPayload)(current) : update;
      setApiQueryData(`/api/projects/${projectId}/media`, next, {
        staleMs: 8_000,
        maxAgeMs: 30 * 60_000,
        tags: ["project-media", `project:${projectId}`],
      });
      return next;
    });
  }, [projectId]);

  const loadProjectDashboard = useCallback(async (force = false) => {
    if (!projectId) return;
    const sequence = ++dashboardRequestSequence.current;
    setDashboardLoading(true);
    try {
      const next = await queryApi<ProjectDashboardPayload>(`/api/projects/${projectId}/overview`, { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["project-overview", `project:${projectId}`] });
      if (sequence === dashboardRequestSequence.current) setDashboard(next);
    } finally {
      if (sequence === dashboardRequestSequence.current) setDashboardLoading(false);
    }
  }, [projectId]);

  const loadProjectSnapshot = useCallback(async (force = false) => {
    if (!projectId) return;
    const sequence = ++snapshotRequestSequence.current;
    const next = await queryApi<ProjectSnapshot>(`/api/projects/${projectId}/snapshot`, { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["project-snapshot", `project:${projectId}`] });
    if (sequence === snapshotRequestSequence.current) setSnapshot(next);
  }, [projectId]);

  const loadProjectControlCenter = useCallback(async (force = false) => {
    if (!projectId) return;
    const sequence = ++controlRequestSequence.current;
    setControlLoading(true);
    try {
      const next = await queryApi<ProjectControlCenterPayload>(`/api/projects/${projectId}/control-center`, { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["project-control", `project:${projectId}`] });
      if (sequence === controlRequestSequence.current) setControlCenter(next);
    } finally {
      if (sequence === controlRequestSequence.current) setControlLoading(false);
    }
  }, [projectId]);

  const loadProjectIntelligence = useCallback(async (force = false) => {
    if (!projectId) return;
    const sequence = ++intelligenceRequestSequence.current;
    setIntelligenceLoading(true);
    try {
      const next = await queryApi<ProjectIntelligenceSnapshot>(`/api/projects/${projectId}/intelligence`, { force, staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-intelligence", `project:${projectId}`] });
      if (sequence === intelligenceRequestSequence.current) setIntelligence(next);
    } finally {
      if (sequence === intelligenceRequestSequence.current) setIntelligenceLoading(false);
    }
  }, [projectId]);

  const loadProjectUsers = useCallback(async (force = false) => {
    const sequence = ++usersRequestSequence.current;
    const next = await queryApi<User[]>("/api/users", { force, staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["users", "people"] });
    if (sequence === usersRequestSequence.current) setProjectUsers(next);
  }, []);

  useResourceChangeRefresh(async () => {
    if (!projectId || activeProjectRef.current !== projectId) return;
    const requestPlan = projectWorkspaceRequestPlan(tabRef.current);
    await Promise.all([
      loadProjectSnapshot(true).catch(() => undefined),
      requestPlan.media ? loadMedia(true).catch(() => undefined) : Promise.resolve(),
      requestPlan.dashboard ? loadProjectDashboard(true).catch(() => undefined) : Promise.resolve(),
      requestPlan.controlCenter ? loadProjectControlCenter(true).catch(() => undefined) : Promise.resolve(),
      requestPlan.intelligence ? loadProjectIntelligence(true).catch(() => undefined) : Promise.resolve(),
    ]);
  }, {
    enabled: Boolean(projectId),
    projectId,
    kinds: ["project", "board", "card", "ticket", "whiteboard", "review_asset", "build", "qa_plan", "qa_session", "release", "meeting", "control", "calendar", "timeline", "library", "file", "source_review", "source_commit"],
    debounceMs: 180,
  });

  useEffect(() => {
    if (!storedTabsState.hydrated) return;
    const nextTab = projectTabForWorkspace(
      typeof window === "undefined" ? null : window.location.href,
      projectId, projectId ? storedTabs[projectId] : null, PROJECT_WORKSPACE_TABS,
    );
    tabRef.current = nextTab;
    setTabState(nextTab);
    setTabOwner(projectId || "");
    if (projectId) writeProjectTabToLocation(projectId, nextTab, "replace");
    mediaRequestSequence.current += 1;
    dashboardRequestSequence.current += 1;
    snapshotRequestSequence.current += 1;
    controlRequestSequence.current += 1;
    intelligenceRequestSequence.current += 1;
    usersRequestSequence.current += 1;
    setMedia({ reviewAssets: [], files: [] });
    setDashboard(null);
    setSnapshot(null);
    setControlCenter(null);
    setIntelligence(null);
    setMediaStatus("");
    if (!projectId) {
      setProjectUsers([]);
      return;
    }
    // Snapshot serves the universal header. Other heavyweight payloads are
    // tab-scoped below, so opening Project/Plan/People doesn't block on Media,
    // Control Center, or Overview requests it cannot display.
    void loadProjectSnapshot().catch(() => {
      if (activeProjectRef.current === projectId) setSnapshot(null);
    });
    void loadProjectUsers().catch(() => {
      if (activeProjectRef.current === projectId) setProjectUsers([]);
    });
  }, [projectId, storedTabsState.hydrated, loadMedia, loadProjectSnapshot, loadProjectDashboard, loadProjectControlCenter, loadProjectUsers]);

  useEffect(() => {
    if (!projectId || !storedTabsState.hydrated || tabOwner !== projectId || storedTabs[projectId] === tab) return;
    setStoredTabs((current) => ({ ...current, [projectId]: tab }));
  }, [projectId, tab, tabOwner, storedTabsState.hydrated, storedTabs, setStoredTabs]);

  useEffect(() => {
    if (!projectId || !storedTabsState.hydrated) return;
    const restore = () => {
      const restored = projectTabFromUrl(window.location.href, projectId, PROJECT_WORKSPACE_TABS);
      if (!restored) return;
      tabRef.current = restored;
      setTabState(restored);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [projectId, storedTabsState.hydrated]);

  // A tab opens its own data, including after restoring a per-project tab.
  // Keep the tab-owner/ref guards so an old Project never starts another one's
  // requests during React's post-navigation effect flush.
  useEffect(() => {
    if (!projectId || !storedTabsState.hydrated || tabOwner !== projectId || tabRef.current !== tab) return;
    const requestPlan = projectWorkspaceRequestPlan(tab);
    if (requestPlan.media) void loadMedia().catch(() => {
      if (activeProjectRef.current === projectId) setMediaStatus("Media failed to load.");
    });
    if (requestPlan.dashboard) void loadProjectDashboard().catch(() => undefined);
    if (requestPlan.controlCenter) void loadProjectControlCenter().catch(() => undefined);
  }, [projectId, storedTabsState.hydrated, tab, tabOwner, loadMedia, loadProjectDashboard, loadProjectControlCenter]);

  useEffect(() => {
    if (!projectId || tabOwner !== projectId || tab !== "intelligence") return;
    if (!storedTabsState.hydrated || tabRef.current !== tab) return;
    void loadProjectIntelligence().catch(() => {
      if (activeProjectRef.current === projectId) setIntelligence(null);
    });
  }, [projectId, tab, tabOwner, storedTabsState.hydrated, loadProjectIntelligence]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;
    const unsubscribe = subscribeProjectWorkflowUpdate((detail) => {
      if (detail.projectId !== projectId) return;
      if (pulseRefreshTimer.current !== null) window.clearTimeout(pulseRefreshTimer.current);
      pulseRefreshTimer.current = window.setTimeout(() => {
        pulseRefreshTimer.current = null;
        void loadProjectSnapshot().catch(() => undefined);
        void loadProjectDashboard().catch(() => undefined);
        if (tab === "overview" || tab === "control") void loadProjectControlCenter().catch(() => undefined);
        if (tab === "intelligence") void loadProjectIntelligence().catch(() => undefined);
      }, 140);
    });
    return () => {
      unsubscribe();
      if (pulseRefreshTimer.current !== null) {
        window.clearTimeout(pulseRefreshTimer.current);
        pulseRefreshTimer.current = null;
      }
    };
  }, [projectId, tab, loadProjectSnapshot, loadProjectDashboard, loadProjectControlCenter, loadProjectIntelligence]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; tab?: string }>).detail;
      if (!projectId || detail?.projectId !== projectId || !detail.tab || !PROJECT_WORKSPACE_TABS.has(detail.tab as ProjectWorkspaceTabId)) return;
      const nextTab = detail.tab as ProjectWorkspaceTabId;
      tabRef.current = nextTab;
      setTabState(nextTab);
      writeProjectTabToLocation(projectId, nextTab, "replace");
    };
    window.addEventListener("cluster-project-tab-command", onCommand);
    return () => window.removeEventListener("cluster-project-tab-command", onCommand);
  }, [projectId]);

  return {
    tab,
    setTab,
    media,
    mediaStatus,
    setMediaStatus,
    dashboard,
    snapshot,
    dashboardLoading,
    controlCenter,
    controlLoading,
    intelligence,
    intelligenceLoading,
    projectUsers,
    qaPlans,
    buildArtifacts,
    qaSessions,
    workflowLinks,
    loadMedia,
    updateMedia,
    loadProjectSnapshot,
    loadProjectDashboard,
    loadProjectControlCenter,
    loadProjectIntelligence,
  };
}

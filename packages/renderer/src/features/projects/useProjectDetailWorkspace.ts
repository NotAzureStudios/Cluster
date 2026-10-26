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

const PROJECT_WORKSPACE_TABS = new Set<ProjectWorkspaceTabId>(PROJECT_WORKSPACE_SECTIONS.map((section) => section.id));
const PROJECT_TAB_QUERY_KEY = "projectTab";

function projectTabFromLocation() {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get(PROJECT_TAB_QUERY_KEY);
  return value && PROJECT_WORKSPACE_TABS.has(value as ProjectWorkspaceTabId) ? value as ProjectWorkspaceTabId : null;
}

function writeProjectTabToLocation(tab: ProjectWorkspaceTabId, mode: "push" | "replace" = "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(PROJECT_TAB_QUERY_KEY) === tab) return;
  url.searchParams.set(PROJECT_TAB_QUERY_KEY, tab);
  const state = { ...(window.history.state || {}), clusterProjectTab: tab };
  window.history[mode === "push" ? "pushState" : "replaceState"](state, "", `${url.pathname}${url.search}${url.hash}`);
}


export function useProjectDetailWorkspace(projectId?: string | null) {
  const workflowProjectId = projectId || "";
  const [tab, setTabState] = useState<ProjectWorkspaceTabId>(() => projectTabFromLocation() || "overview");
  const historyRestoreRef = useRef(false);
  const setTab = useCallback((next: SetStateAction<ProjectWorkspaceTabId>) => {
    setTabState((current) => {
      const resolved = typeof next === "function" ? (next as (value: ProjectWorkspaceTabId) => ProjectWorkspaceTabId)(current) : next;
      if (resolved !== current && !historyRestoreRef.current) writeProjectTabToLocation(resolved, "push");
      return resolved;
    });
  }, []);
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
    if (!projectId) return;
    await Promise.all([
      loadMedia(true).catch(() => undefined),
      loadProjectSnapshot(true).catch(() => undefined),
      loadProjectDashboard(true).catch(() => undefined),
      loadProjectControlCenter(true).catch(() => undefined),
      tab === "intelligence" ? loadProjectIntelligence(true).catch(() => undefined) : Promise.resolve(),
    ]);
  }, {
    enabled: Boolean(projectId),
    projectId,
    kinds: ["project", "board", "card", "ticket", "whiteboard", "review_asset", "build", "qa_plan", "qa_session", "release", "meeting", "control", "calendar", "timeline", "library", "file", "source_review", "source_commit"],
    debounceMs: 180,
  });

  useEffect(() => {
    if (!storedTabsState.hydrated) return;
    const urlTab = projectTabFromLocation();
    historyRestoreRef.current = true;
    setTabState(urlTab || (projectId && storedTabs[projectId]) || "overview");
    window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
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
    void loadMedia().catch(() => setMediaStatus("Media failed to load."));
    void loadProjectSnapshot().catch(() => setSnapshot(null));
    void loadProjectDashboard().catch(() => setDashboard(null));
    void loadProjectControlCenter().catch(() => setControlCenter(null));
    void loadProjectIntelligence().catch(() => setIntelligence(null));
    void loadProjectUsers().catch(() => setProjectUsers([]));
  }, [projectId, storedTabsState.hydrated, loadMedia, loadProjectSnapshot, loadProjectDashboard, loadProjectControlCenter, loadProjectIntelligence, loadProjectUsers]);

  useEffect(() => {
    if (!projectId || !storedTabsState.hydrated || storedTabs[projectId] === tab) return;
    setStoredTabs((current) => ({ ...current, [projectId]: tab }));
  }, [projectId, tab, storedTabsState.hydrated, storedTabs, setStoredTabs]);

  useEffect(() => {
    if (!projectId) return;
    writeProjectTabToLocation(tab, "replace");
    const restore = () => {
      const restored = projectTabFromLocation();
      if (!restored) return;
      historyRestoreRef.current = true;
      setTabState(restored);
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [projectId, tab]);

  useEffect(() => {
    if (!projectId || tab !== "intelligence") return;
    void loadProjectIntelligence().catch(() => setIntelligence(null));
  }, [projectId, tab, loadProjectIntelligence]);

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
      historyRestoreRef.current = true;
      setTabState(nextTab);
      writeProjectTabToLocation(nextTab, "replace");
      window.setTimeout(() => { historyRestoreRef.current = false; }, 0);
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

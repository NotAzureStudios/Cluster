import { CLUSTER_PROJECT_STATUSES, PROJECT_DATA_FIELDS, clusterDataDerivedSemanticFields, clusterDataSelectionSetFilterGroup, createClusterDataViewLayout, evaluateClusterDataDerivedFields, mergeClusterDataFilterGroups, normalizeClusterDataSorts, planClusterDataDerivedFields, type ClusterDataDerivedField, type ClusterDataExportDelivery, type ClusterDataExportFormat, type ClusterDataGroup, type ClusterDataProjection, type ClusterDataQuery, type ClusterDataSelection, type ClusterDataSelectionSet, type ClusterDataSort, type ClusterDataViewLayout, type ClusterProjectStatus, type ClusterSavedDataView, type ClusterSemanticField } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { DataViewAggregationStrip, DataViewDerivedFieldBuilder, DataViewFacetBar, DataViewGroupControl, DataViewProjection, DataViewProjectionComposer, DataViewSelectionBar, DataViewSelectionSetBar, selectedDataSummary, useDataViewDrilldownHistory } from "../../components/DataView";
import { ClusterTableToolbar } from "../../components/ClusterTableToolbar";
import { ClusterDataView } from "../../components/ClusterDataView";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterFilterPopover } from "../../components/ClusterFilterPopover";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { subscribeResourceChanges, subscribeResourceChangeFeedResets } from "../../core/resource-change-client";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useClusterCursorData, type ClusterCursorPage } from "../../components/useClusterCursorData";
import { clusterDataQueryParameter } from "../../components/data-view-query";
import { addDays } from "../../core/date-time";
import { useServerState } from "../../core/server-state";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { ClusterVisualComposition, ClusterVisualMeter } from "../../components/ClusterVisualMetrics";
import { summarizeLoadedProjectHealth } from "../visual-first/loaded-view-summary";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { requestClusterDataExport } from "../../core/data-export-client";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { DataImportBuilder } from "../../components/DataImportBuilder";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { runtimeStyle } from "../../core/runtime-style";
import type { BuildMilestonePlanItem, Project, ProjectSnapshot, TimelineEntry, TimelinePayload, UserActivitySummary, WhiteboardSummary } from "../application/application-models";
import { projectScheduleState, projectSetupChecklist } from "./project-list-utils";
import { ProjectPortfolioInspector } from "./ProjectPortfolioInspector";
import { ProjectPortfolioItem } from "./ProjectPortfolioItem";
import { projectInspectorReturnFocus } from "./project-inspector-focus";
import { projectAttentionScore, type ProjectPortfolioFocus } from "./project-portfolio-model";
import { planMissingProjectSnapshotBatches, projectRevisionKey, projectSnapshotInvalidationTarget } from "./project-snapshot-batching";
import "./projects.css";

const PROJECT_RENDER_BATCH = 120;
const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PROJECT_PRIORITY_SCORE: Readonly<Record<string, number>> = { urgent: 4, high: 3, medium: 2, low: 1 };

function projectSnapshotHealth(snapshot?: ProjectSnapshot | null) {
  if (!snapshot) return null;
  if (snapshot.health.state === "blocked") return { label: "Blocked", tone: "danger" };
  if (snapshot.health.state === "at_risk") return { label: "At Risk", tone: "danger" };
  if (snapshot.health.state === "attention") return { label: "Needs Attention", tone: "warning" };
  return { label: "Healthy", tone: "good" };
}

function projectSnapshotScheduleTone(snapshot?: ProjectSnapshot | null) {
  if (!snapshot) return "neutral";
  if (snapshot.schedule.state === "overdue") return "danger";
  if (snapshot.schedule.state === "due_soon" || snapshot.schedule.state === "unscheduled") return "warning";
  if (snapshot.schedule.state === "scheduled") return "good";
  return "neutral";
}

const PROJECT_PORTFOLIO_DATA_FIELDS: readonly ClusterSemanticField[] = [
  { id: "project", label: "Project type", type: "text", sortable: true, groupable: true },
  { id: "status", label: "Status", type: "status", sortable: true, filterable: true, groupable: true, facet: true },
  { id: "health", label: "Health", type: "status", sortable: true, groupable: true, facet: true },
  { id: "readiness", label: "Readiness", type: "number", sortable: true, aggregatable: true, display: { format: "percent" } },
  { id: "stage", label: "Stage", type: "enum", sortable: true, groupable: true, facet: true },
  { id: "source", label: "Source", type: "enum", sortable: true, filterable: true, groupable: true, facet: true },
  { id: "people", label: "People", type: "number", sortable: true, aggregatable: true },
  { id: "target", label: "Target", type: "date", sortable: true },
  { id: "priority", label: "Priority", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, enumValues: ["urgent", "high", "medium", "low"] },
  { id: "attention", label: "Attention", type: "number", sortable: true, aggregatable: true },
  { id: "updated", label: "Updated", type: "datetime", sortable: true },
];

const DEFAULT_PROJECT_PROJECTIONS: ClusterDataProjection[] = [
  { id: "project_status", kind: "grouped", dimensions: ["status"], measures: [{ id: "count", kind: "count", label: "Projects" }], limit: 12, drilldown: { mode: "filter", presentation: "table" } },
  { id: "project_status_priority", kind: "matrix", dimensions: ["status", "priority"], measures: [{ id: "count", kind: "count", label: "Projects" }], limit: 64, drilldown: { mode: "filter", presentation: "table" } },
  { id: "project_source", kind: "grouped", dimensions: ["source"], measures: [{ id: "count", kind: "count", label: "Projects" }], limit: 8, drilldown: { mode: "filter", presentation: "table" } },
  { id: "project_schedule", kind: "grouped", dimensions: ["schedule"], measures: [{ id: "count", kind: "count", label: "Projects" }], limit: 8, drilldown: { mode: "filter", presentation: "table" } },
];

type ProjectStatusFilter = "all" | ClusterProjectStatus | "archived" | "ready" | "attention";

type PortfolioIntelligence = {
  generatedAt: string; projectCount: number; atRisk: number; danger: number; crossProjectDependencies: number; criticalCrossProjectDependencies: number; highPressureOwners: number; methodology: string;
  departments?: Array<{ department: string; owners: number; active: number; overdue: number; highPressureOwners: number }>; trend?: { samples: number; atRiskDelta: number; dangerDelta: number; highPressureDelta: number; history: Array<{ generatedAt: string; atRisk: number; danger: number; highPressureOwners: number }> };
  projects: Array<{ id: string; name: string; risk: "good" | "warning" | "danger"; signals: string[]; overdue: number; blocked: number; unowned: number; crossProjectCritical: number }>;
  owners: Array<{ id: string; name: string; department?: string | null; active: number; overdue: number; dueSoon: number; pressure: "normal" | "elevated" | "high"; formula: string }>;
};

export interface ProjectListHelpers {
  projectMembers: (project: Project, users?: UserActivitySummary[]) => UserActivitySummary[];
  projectSetupGaps: (project: Project) => string[];
  projectBuildStage: (project: Project, entries?: TimelineEntry[]) => { label: string; detail: string };
  importantBuildEntries: (entries: TimelineEntry[]) => TimelineEntry[];
  projectTypeBadge: (project: Project) => string;
  projectStatusLabel: (project: Pick<Project, "status" | "archived">) => string;
  projectSourceMeta: (project: Project) => { label: string; icon: ClusterIconName; tone: string };
  projectHealth: (project: Project) => { label: string; tone: string };
  normalizeProjectStatus: (value?: string | null) => string;
  projectHasGit: (project: Project) => boolean;
  isExternalProject: (project?: Pick<Project, "source"> | null) => boolean;
  projectCompleteness: (project: Project) => number;
  projectLatestTimestamp: (project: Project) => number;
  projectBuildMilestones: (project: Project, entries?: TimelineEntry[]) => BuildMilestonePlanItem[];
  projectAssignedIds: (project: Project) => string[];
  projectHasDiscord: (project: Project) => boolean;
  isVideoProject: (project?: Project | null) => boolean;
  projectStatusMeta: (project: Pick<Project, "status" | "archived">) => { value: string; label: string; tone: string; description: string };
}

export interface ProjectsPageProps {
  projects: Project[];
  whiteboards: WhiteboardSummary[];
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenGit: () => void;
  onOpenTimeline: () => void;
  onOpenBuilds: () => void;
  onOpenNotifications: () => void;
  onOpenActivity: () => void;
  onOpenReports: () => void;
  isAdmin: boolean;
  helpers: ProjectListHelpers;
  onCreateProject: () => void;
}

export function ProjectsPage({ projects, whiteboards, onOpenBoard, onOpenWhiteboard, onOpenProject, onOpenTimeline, onOpenBuilds, onOpenActivity, onOpenReports, isAdmin, helpers, onCreateProject }: ProjectsPageProps) {
  const { projectMembers, projectSetupGaps, projectBuildStage, importantBuildEntries, projectTypeBadge, projectStatusLabel, projectSourceMeta, projectHealth, normalizeProjectStatus, projectHasGit, isExternalProject, projectCompleteness, projectLatestTimestamp, projectBuildMilestones, projectAssignedIds, projectHasDiscord, isVideoProject, projectStatusMeta } = helpers;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "git" | "manual" | "external">("all");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "due_soon" | "overdue" | "unscheduled" | "scheduled">("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "low" | "medium" | "high" | "urgent">("all");
  const [projectSorts, setProjectSorts] = useState<ClusterDataSort[]>([{ fieldId: "attention", direction: "desc" }]);
  const [viewMode, setViewMode] = useServerState<"list" | "cards" | "table">("user", "projects.portfolio-view", "cards", { merge: (value, fallback) => value === "list" || value === "cards" || value === "table" ? value : fallback });
  const [density, setDensity] = useServerState<"compact" | "comfortable">("user", "projects.portfolio-density", "comfortable", { merge: (value, fallback) => value === "compact" || value === "comfortable" ? value : fallback });
  const [focus, setFocus] = useServerState<ProjectPortfolioFocus>("user", "projects.portfolio-focus", "all");
  const [pinnedProjectIds, setPinnedProjectIds] = useServerState<string[]>("user", "projects.pinned", [], { merge: (value) => Array.isArray(value) ? value.map(String) : [] });
  const pinnedProjectSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id || null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorPanelRef = useRef<HTMLDivElement | null>(null);
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // The inspector is non-modal; announce the opened panel without trapping
    // focus or stealing focus repeatedly during ordinary data updates.
    if (inspectorOpen) inspectorPanelRef.current?.focus({ preventScroll: true });
  }, [inspectorOpen]);
  const [browserFiltersOpen, setBrowserFiltersOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [projectRenderLimit, setProjectRenderLimit] = useState(PROJECT_RENDER_BATCH);
  const [portfolioIntelligence, setPortfolioIntelligence] = useState<PortfolioIntelligence | null>(null);
  const [projectSnapshots, setProjectSnapshots] = useState<Record<string, ProjectSnapshot>>({});
  const projectSnapshotCacheRef = useRef<Record<string, ProjectSnapshot>>({});
  const projectSnapshotRevisionsRef = useRef<Map<string, string>>(new Map());
  const [projectSnapshotRefreshEpoch, setProjectSnapshotRefreshEpoch] = useState(0);
  const [projectTableLayout, setProjectTableLayout] = useState<ClusterDataViewLayout | null>(null);
  const [projectGroups, setProjectGroups] = useState<ClusterDataGroup[]>([]);
  const [projectProjections, setProjectProjections] = useState<ClusterDataProjection[]>(() => DEFAULT_PROJECT_PROJECTIONS);
  const [projectDerivedFields, setProjectDerivedFields] = useState<ClusterDataDerivedField[]>([]);
  const projectPortableDerivedPlan = useMemo(() => planClusterDataDerivedFields(projectDerivedFields, PROJECT_DATA_FIELDS), [projectDerivedFields]);
  const projectExportFields = useMemo(() => [...PROJECT_DATA_FIELDS, ...clusterDataDerivedSemanticFields(projectPortableDerivedPlan.fields)], [projectPortableDerivedPlan.fields]);
  const [projectAnalyticalSelection, setProjectAnalyticalSelection] = useState<ClusterDataSelection | null>(null);
  const [projectAnalyticalSelectionSet, setProjectAnalyticalSelectionSet] = useState<ClusterDataSelectionSet>({ logic: "or", selections: [] });
  const [projectExporting, setProjectExporting] = useState(false);
  const [projectExportJobId, setProjectExportJobId] = useState("");
  const [projectExportStatus, setProjectExportStatus] = useState("");
  const projectDrilldown = useDataViewDrilldownHistory(
    { statusFilter, sourceFilter, scheduleFilter, priorityFilter, focus, selection: projectAnalyticalSelection, selectionSet: projectAnalyticalSelectionSet, viewMode },
    (snapshot) => { setStatusFilter(snapshot.statusFilter); setSourceFilter(snapshot.sourceFilter); setScheduleFilter(snapshot.scheduleFilter); setPriorityFilter(snapshot.priorityFilter); setFocus(snapshot.focus); setProjectAnalyticalSelection(snapshot.selection); setProjectAnalyticalSelectionSet(snapshot.selectionSet); setViewMode(snapshot.viewMode); },
  );
  const normalizedProjectSorts = useMemo(() => normalizeClusterDataSorts(projectSorts, new Set(["attention", "updated", "readiness", "project", "name", "target", "priority", "status", "health", "stage", "source", "people", ...projectDerivedFields.map((field) => field.id)])), [projectSorts, projectDerivedFields]);
  const projectServerSorts = useMemo<ClusterDataSort[]>(() => {
    if (normalizedProjectSorts.length !== 1) return [];
    const sort = normalizedProjectSorts[0];
    const fieldId = sort.fieldId === "project" || sort.fieldId === "name" ? "name" : sort.fieldId === "status" ? "status" : "";
    return fieldId ? [{ fieldId, direction: sort.direction }] : [];
  }, [normalizedProjectSorts]);
  const projectServerGroups = useMemo<ClusterDataGroup[]>(() => {
    if (["ready", "attention"].includes(statusFilter) || !["all", "due_soon", "unscheduled"].includes(focus)) return [];
    const fieldMap: Record<string, string> = { project: "projectType", status: "status", source: "source", priority: "priority" };
    if (statusFilter === "archived" && projectGroups.some((group) => group.fieldId === "status")) return [];
    if (!projectGroups.length || projectGroups.length > 2 || projectGroups.some((group) => !fieldMap[group.fieldId])) return [];
    return projectGroups.map((group) => ({ ...group, fieldId: fieldMap[group.fieldId] }));
  }, [projectGroups, statusFilter, focus]);
  const projectServerDataQuery = useMemo<ClusterDataQuery>(() => {
    const conditions = [
      ...(statusFilter === "archived" ? [{ fieldId: "archived", operator: "equals" as const, value: true }] : []),
      ...(!["all", "archived", "ready", "attention"].includes(statusFilter) ? [{ fieldId: "status", operator: "equals" as const, value: statusFilter }] : []),
      ...(sourceFilter !== "all" ? [{ fieldId: "source", operator: "equals" as const, value: sourceFilter }] : []),
      ...(scheduleFilter !== "all" ? [{ fieldId: "schedule", operator: "equals" as const, value: scheduleFilter }] : []),
      ...(priorityFilter !== "all" ? [{ fieldId: "priority", operator: "equals" as const, value: priorityFilter }] : []),
      ...(["due_soon", "unscheduled"].includes(focus) ? [{ fieldId: "schedule", operator: "equals" as const, value: focus }] : []),
    ];
    return {
      search: deferredQuery.trim() || undefined,
      filters: mergeClusterDataFilterGroups(conditions.length ? { logic: "and", conditions } : null, clusterDataSelectionSetFilterGroup(projectAnalyticalSelectionSet)),
      sorts: projectServerSorts,
      facets: analyticsOpen ? ["status", "source", "schedule", "priority"] : [],
      aggregations: analyticsOpen ? [{ id: "count", kind: "count", label: "Projects" }] : [],
      groups: viewMode === "table" ? projectServerGroups : [],
      projections: analyticsOpen ? projectProjections : [],
      derivedFields: analyticsOpen ? projectPortableDerivedPlan.fields : [],
    };
  }, [deferredQuery, statusFilter, sourceFilter, scheduleFilter, priorityFilter, focus, projectServerSorts, projectServerGroups, projectProjections, projectPortableDerivedPlan.fields, projectAnalyticalSelectionSet, analyticsOpen, viewMode]);
  const projectServerQueryKey = useMemo(() => JSON.stringify(projectServerDataQuery), [projectServerDataQuery]);
  const projectSeedRevisionKey = useMemo(() => projectRevisionKey(projects), [projects]);
  const projectCursor = useClusterCursorData<Project>({
    resetKey: `${projectSeedRevisionKey}::${projectServerQueryKey}`,
    rowKey: (project) => project.id,
    placeholderRows: deferredQuery.trim() ? [] : projects,
    loadPage: async (cursor): Promise<ClusterCursorPage<Project>> => api<ClusterCursorPage<Project>>(`/api/projects?paged=true&limit=80&dataQuery=${clusterDataQueryParameter(projectServerDataQuery)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  });
  const portfolioProjects = projectCursor.rows;
  const portfolioRevisionKey = useMemo(() => projectRevisionKey(portfolioProjects), [portfolioProjects]);
  const loadedProjectIds = useMemo(() => new Set(portfolioProjects.map((project) => project.id)), [portfolioProjects]);
  const loadedProjectIdsRef = useRef(loadedProjectIds);
  loadedProjectIdsRef.current = loadedProjectIds;

  useEffect(() => {
    let timer = 0;
    let allInvalidated = false;
    const pendingIds = new Set<string>();
    const flush = () => {
      timer = 0;
      if (document.visibilityState !== "visible" || (!allInvalidated && !pendingIds.size)) return;
      const revisions = projectSnapshotRevisionsRef.current;
      const cache = projectSnapshotCacheRef.current;
      if (allInvalidated) {
        revisions.clear();
        for (const id of Object.keys(cache)) delete cache[id];
      } else {
        for (const id of pendingIds) { revisions.delete(id); delete cache[id]; }
      }
      allInvalidated = false;
      pendingIds.clear();
      setProjectSnapshots({ ...cache });
      setProjectSnapshotRefreshEpoch((epoch) => epoch + 1);
    };
    const scheduleFlush = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      // Resource changes are remembered while hidden, but do not wake a
      // background Projects renderer or issue HTTP until visibility resumes.
      if (document.visibilityState === "visible") timer = window.setTimeout(flush, 200);
    };
    const schedule = (id: string | "all") => {
      // An update to a different Project should not re-render or refetch the
      // current portfolio. New rows are already covered when the cursor grows.
      if (id !== "all" && !loadedProjectIdsRef.current.has(id)) return;
      if (id === "all") {
        allInvalidated = true;
        pendingIds.clear();
      } else if (!allInvalidated) pendingIds.add(id);
      scheduleFlush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && (allInvalidated || pendingIds.size)) scheduleFlush();
      else if (timer) { window.clearTimeout(timer); timer = 0; }
    };
    const unsubChanges = subscribeResourceChanges(({ change }) => {
      const target = projectSnapshotInvalidationTarget(change);
      if (target) schedule(target);
    });
    const unsubReset = subscribeResourceChangeFeedResets(() => schedule("all"));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubChanges();
      unsubReset();
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Server-derived badges can change with time, and an SSE gap is possible.
  // Recovery is visible-only: hidden Project pages never retain this timer.
  useVisibleRefresh(() => {
    projectSnapshotRevisionsRef.current.clear();
    setProjectSnapshotRefreshEpoch((epoch) => epoch + 1);
  }, { enabled: portfolioProjects.length > 0, intervalMs: 180_000, minimumGapMs: 1_000, refreshOnFocus: false });

  useEffect(() => {
    // Only retain snapshots for projects in the currently authorized, loaded
    // portfolio, at the exact revision that produced their derived badges.
    const activeRevisions = new Map(portfolioProjects.map((project) => [project.id, project.updatedAt || ""] as const));
    const cache = projectSnapshotCacheRef.current;
    const knownRevisions = projectSnapshotRevisionsRef.current;
    let pruned = false;
    for (const id of Object.keys(cache)) {
      if (!activeRevisions.has(id) || knownRevisions.get(id) !== activeRevisions.get(id)) {
        delete cache[id];
        knownRevisions.delete(id);
        pruned = true;
      }
    }
    if (pruned || !activeRevisions.size) setProjectSnapshots({ ...cache });

    // Adding the next 80 projects must not redownload previous pages.
    // Keep each URL bounded, and avoid a large synchronous response commit.
    const batches = planMissingProjectSnapshotBatches(portfolioProjects, knownRevisions, 80);
    if (!batches.length) return;
    let active = true;
    void (async () => {
      for (let offset = 0; offset < batches.length; offset += 2) {
        const responses = await Promise.allSettled(batches.slice(offset, offset + 2).map((ids) =>
          api<{ schema: 1; snapshots: ProjectSnapshot[] }>(`/api/projects/snapshots?ids=${encodeURIComponent(ids.join(","))}`),
        ));
        if (!active) return;
        let changed = false;
        for (const response of responses) {
          if (response.status !== "fulfilled") continue;
          for (const snapshot of response.value.snapshots || []) {
            if (!activeRevisions.has(snapshot.projectId)) continue;
            const revision = activeRevisions.get(snapshot.projectId)!;
            knownRevisions.set(snapshot.projectId, revision);
            cache[snapshot.projectId] = snapshot;
            changed = true;
          }
        }
        if (changed) setProjectSnapshots({ ...cache });
      }
    })();
    return () => { active = false; };
  }, [portfolioRevisionKey, projectSnapshotRefreshEpoch]);

  useEffect(() => {
    if (!inspectorOpen && !analyticsOpen && !intelligenceOpen) return;
    let active = true;
    api<UserActivitySummary[]>("/api/users").then((result) => { if (active) setUsers(result); }).catch(() => {});
    api<TimelinePayload>(`/api/timeline?start=${encodeURIComponent(new Date().toISOString())}&end=${encodeURIComponent(addDays(new Date(), 180).toISOString())}`).then((result) => { if (active) setTimeline(result); }).catch(() => {});
    return () => { active = false; };
  }, [inspectorOpen, analyticsOpen, intelligenceOpen]);
  useEffect(() => {
    if (!isAdmin || !intelligenceOpen || !portfolioProjects[0]?.id) { setPortfolioIntelligence(null); return; }
    let active = true;
    api<PortfolioIntelligence>("/api/portfolio/intelligence").then((result) => { if (active) setPortfolioIntelligence(result); }).catch(() => { if (active) setPortfolioIntelligence(null); });
    return () => { active = false; };
  }, [isAdmin, portfolioProjects, intelligenceOpen]);
  useEffect(() => {
    if (!portfolioProjects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(portfolioProjects[0]?.id || null);
  }, [portfolioProjects, selectedProjectId]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !target?.closest("input, textarea, select, [contenteditable='true']")) { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const timelineEntries = timeline?.entries || [];
  const timelineEntriesByProject = useMemo(() => {
    const grouped = new Map<string, TimelineEntry[]>();
    for (const entry of timelineEntries) {
      const projectId = entry.project?.id;
      if (!projectId) continue;
      const existing = grouped.get(projectId);
      if (existing) existing.push(entry);
      else grouped.set(projectId, [entry]);
    }
    return grouped;
  }, [timelineEntries]);
  const whiteboardsByProject = useMemo(() => {
    const grouped = new Map<string, WhiteboardSummary[]>();
    for (const whiteboard of whiteboards) {
      if (!whiteboard.projectId) continue;
      const existing = grouped.get(whiteboard.projectId);
      if (existing) existing.push(whiteboard);
      else grouped.set(whiteboard.projectId, [whiteboard]);
    }
    return grouped;
  }, [whiteboards]);
  const facts = useMemo(() => portfolioProjects.map((project) => {
    const entries = importantBuildEntries(timelineEntriesByProject.get(project.id) || []);
    const members = projectMembers(project, users);
    const snapshot = projectSnapshots[project.id] || null;
    const gaps = snapshot?.readiness.gaps || projectSetupGaps(project);
    const status = (snapshot?.lifecycle.archived || project.archived) ? "archived" : normalizeProjectStatus(snapshot?.lifecycle.status || project.status);
    const completeness = snapshot?.readiness.score ?? projectCompleteness(project);
    const source = projectSourceMeta(project);
    const projectWhiteboards = project.whiteboards?.length ? project.whiteboards : (whiteboardsByProject.get(project.id) || []);
    const stage = projectBuildStage(project, entries);
    const health = projectSnapshotHealth(snapshot) || projectHealth(project);
    const memberCount = snapshot ? (snapshot.team.assigned ?? 0) : (members.length || projectAssignedIds(project).length);
    const attentionScore = snapshot?.health.attentionScore ?? projectAttentionScore(project, status, gaps.length, completeness);
    const scheduleState = snapshot?.schedule.state === "closed" ? "scheduled" : (snapshot?.schedule.state || projectScheduleState(project, status));
    return { project, snapshot, entries, members, memberCount, gaps, status, completeness, source, stage, health, attentionScore, scheduleState, projectWhiteboards, latest: projectLatestTimestamp(project) };
  }), [portfolioProjects, projectSnapshots, timelineEntriesByProject, whiteboardsByProject, users, importantBuildEntries, projectMembers, projectSetupGaps, normalizeProjectStatus, projectCompleteness, projectSourceMeta, projectBuildStage, projectLatestTimestamp, projectHealth, projectAssignedIds]);
  const focusCounts = useMemo(() => facts.reduce<Record<ProjectPortfolioFocus, number>>((counts, fact) => {
    const pinned = pinnedProjectSet.has(fact.project.id);
    const matches = (key: ProjectPortfolioFocus) => key === "all" ? true
      : key === "pinned" ? pinned
      : key === "at_risk" ? fact.attentionScore > 0
      : key === "due_soon" ? fact.scheduleState === "due_soon"
      : key === "unscheduled" ? fact.scheduleState === "unscheduled"
      : fact.latest >= Date.now() - 86_400_000 * 14;
    (Object.keys(counts) as ProjectPortfolioFocus[]).forEach((key) => { if (matches(key)) counts[key] += 1; });
    return counts;
  }, { all: 0, pinned: 0, at_risk: 0, due_soon: 0, unscheduled: 0, recent: 0 }), [facts, pinnedProjectSet]);
  const filteredFacts = useMemo(() => facts.filter((fact) => {
    const { project, status, source } = fact;
    const health = fact.health;
    if (statusFilter === "ready" && health.tone !== "good") return false;
    if (statusFilter === "attention" && health.tone === "good") return false;
    if (!["all", "ready", "attention"].includes(statusFilter) && status !== statusFilter) return false;
    const external = isExternalProject(project);
    const gitLinked = projectHasGit(project);
    if (sourceFilter === "git" && (!gitLinked || external)) return false;
    if (sourceFilter === "manual" && (gitLinked || external)) return false;
    if (sourceFilter === "external" && !external) return false;
    if (priorityFilter !== "all" && (project.priority || "medium") !== priorityFilter) return false;
    if (scheduleFilter !== "all" && fact.scheduleState !== scheduleFilter) return false;
    return focus === "all" ? true : focus === "pinned" ? pinnedProjectSet.has(project.id) : focus === "at_risk" ? fact.attentionScore > 0 : focus === "due_soon" ? fact.scheduleState === "due_soon" : focus === "unscheduled" ? fact.scheduleState === "unscheduled" : fact.latest >= Date.now() - 86_400_000 * 14;
  }), [facts, statusFilter, sourceFilter, scheduleFilter, priorityFilter, focus, pinnedProjectSet, projectHasGit, isExternalProject]);
  const rawPrimarySortMode = normalizedProjectSorts[0]?.fieldId === "project" ? "name" : (normalizedProjectSorts[0]?.fieldId || "attention");
  const primarySortMode = (["updated", "readiness", "attention", "name", "target", "priority", "status", "health", "stage", "source", "people"] as readonly string[]).includes(rawPrimarySortMode) ? rawPrimarySortMode : "attention";
  const sortedFacts = useMemo(() => [...filteredFacts].sort((a, b) => {
    const pinDelta = Number(pinnedProjectSet.has(b.project.id)) - Number(pinnedProjectSet.has(a.project.id));
    if (pinDelta) return pinDelta;
    const values = (fact: (typeof facts)[number], fieldId: string): string | number => {
      if (fieldId === "name" || fieldId === "project") return fact.project.name;
      if (fieldId === "target") return fact.project.targetDate ? new Date(fact.project.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (fieldId === "priority") return PROJECT_PRIORITY_SCORE[fact.project.priority || "medium"] || 0;
      if (fieldId === "readiness") return fact.completeness;
      if (fieldId === "attention") return fact.attentionScore + (pinnedProjectSet.has(fact.project.id) ? 2 : 0);
      if (fieldId === "updated") return fact.latest;
      if (fieldId === "status") return fact.status;
      if (fieldId === "health") return fact.health.label;
      if (fieldId === "stage") return fact.stage.label;
      if (fieldId === "source") return fact.source.label;
      if (fieldId === "people") return fact.memberCount;
      return fact.latest;
    };
    for (const sort of normalizedProjectSorts) {
      const left = values(a, sort.fieldId);
      const right = values(b, sort.fieldId);
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : PROJECT_NAME_COLLATOR.compare(String(left), String(right));
      if (comparison) return comparison * (sort.direction === "asc" ? 1 : -1);
    }
    return b.latest - a.latest;
  }), [filteredFacts, pinnedProjectSet, normalizedProjectSorts]);

  const visibleFacts = useMemo(() => sortedFacts.slice(0, projectRenderLimit), [sortedFacts, projectRenderLimit]);
  const hasMoreProjects = visibleFacts.length < sortedFacts.length;
  const loadedHealth = useMemo(() => summarizeLoadedProjectHealth(sortedFacts), [sortedFacts]);
  const projectServerAnalytics = projectCursor.dataView?.analytics || null;
  const projectAnalyticsExact = !["ready", "attention"].includes(statusFilter) && ["all", "due_soon", "unscheduled"].includes(focus);
  const selectedProjectSummary = useMemo(() => selectedDataSummary(sortedFacts, selectedProjectIds, {
    readiness: (rows) => rows.length ? Math.round(rows.reduce((sum, fact) => sum + fact.completeness, 0) / rows.length) : null,
    people: (rows) => rows.reduce((sum, fact) => sum + fact.memberCount, 0),
    attention: (rows) => rows.filter((fact) => fact.health.tone !== "good").length,
  }, (fact) => fact.project.id), [sortedFacts, selectedProjectIds, projectHealth]);
  const projectSummaryRows = useMemo(() => [
    ...(selectedProjectSummary.count ? [{ key: "portfolio-selected", label: "Selected projects", scope: selectedProjectSummary.scope, values: { project: `${selectedProjectSummary.count} project${selectedProjectSummary.count === 1 ? "" : "s"}`, readiness: `${selectedProjectSummary.values.readiness || 0}% avg`, people: `${selectedProjectSummary.values.people || 0} people`, health: `${selectedProjectSummary.values.attention || 0} need attention` } }] : []),
    ...(projectAnalyticsExact && projectServerAnalytics ? [{ key: "portfolio-dataset", label: "Filtered portfolio", scope: "dataset" as const, values: { project: `${projectServerAnalytics.total} project${projectServerAnalytics.total === 1 ? "" : "s"}` } }] : []),
    { key: "portfolio-visible", label: "Loaded portfolio", scope: "visible" as const, values: { project: `${sortedFacts.length} project${sortedFacts.length === 1 ? "" : "s"}`, readiness: sortedFacts.length ? `${Math.round(sortedFacts.reduce((sum, fact) => sum + fact.completeness, 0) / sortedFacts.length)}% avg` : "—", people: `${sortedFacts.reduce((sum, fact) => sum + fact.memberCount, 0)} people` } },
  ], [sortedFacts, selectedProjectSummary, projectAnalyticsExact, projectServerAnalytics]);
  const projectTableColumns = useMemo<ClusterDataTableColumn<(typeof facts)[number]>[]>(() => [
    { id: "project", header: "Project", hideable: false, pinnable: true, defaultWidth: 280, sortValue: (fact) => fact.project.name, groupValue: (fact) => projectTypeBadge(fact.project), groupSummaryValue: (fact) => fact.project.projectType || "", cell: (fact) => <ClusterButton unstyled type="button" onClick={() => onOpenProject(fact.project.id)}><strong>{fact.project.name}</strong><span className="muted">{projectTypeBadge(fact.project)}</span></ClusterButton> },
    { id: "status", header: "Status", defaultWidth: 140, sortValue: (fact) => fact.status, groupValue: (fact) => projectStatusLabel(fact.project), groupSummaryValue: (fact) => fact.status, cell: (fact) => projectStatusLabel(fact.project) },
    { id: "health", header: "Health", defaultWidth: 140, sortValue: (fact) => fact.health.label, groupValue: (fact) => fact.health.label, cell: (fact) => <span className={`soft-pill ${fact.health.tone}`}>{fact.health.label}</span> },
    { id: "readiness", header: "Readiness", defaultWidth: 120, sortValue: (fact) => fact.completeness, cell: (fact) => `${fact.completeness}%` },
    { id: "stage", header: "Stage", defaultWidth: 170, sortValue: (fact) => fact.stage.label, groupValue: (fact) => fact.stage.label, cell: (fact) => fact.stage.label },
    { id: "source", header: "Source", defaultWidth: 150, sortValue: (fact) => fact.source.label, groupValue: (fact) => fact.source.label, groupSummaryValue: (fact) => isExternalProject(fact.project) ? "external" : projectHasGit(fact.project) ? "git" : "manual", cell: (fact) => fact.source.label },
    { id: "people", header: "People", defaultWidth: 100, sortValue: (fact) => fact.memberCount, cell: (fact) => fact.memberCount },
    { id: "target", header: "Target", defaultWidth: 150, sortValue: (fact) => fact.project.targetDate ? new Date(fact.project.targetDate) : null, cell: (fact) => fact.project.targetDate ? new Date(fact.project.targetDate).toLocaleDateString() : "Unscheduled" },
    { id: "attention", header: "Attention", hiddenByDefault: true, sortValue: (fact) => fact.attentionScore, cell: (fact) => fact.attentionScore },
    { id: "updated", header: "Updated", hiddenByDefault: true, sortValue: (fact) => fact.latest, cell: (fact) => new Date(fact.latest).toLocaleString() },
    { id: "priority", header: "Priority", hiddenByDefault: true, sortValue: (fact) => PROJECT_PRIORITY_SCORE[fact.project.priority || "medium"] || 0, groupValue: (fact) => fact.project.priority || "medium", cell: (fact) => fact.project.priority || "medium" },
    ...projectDerivedFields.map((derived): ClusterDataTableColumn<(typeof facts)[number]> => ({
    id: derived.id,
    header: derived.label,
    defaultWidth: 150,
    sortValue: (fact) => {
      const values = { project: projectTypeBadge(fact.project), status: fact.status, health: fact.health.label, readiness: fact.completeness, stage: fact.stage.label, source: fact.source.label.toLowerCase(), people: fact.memberCount, target: fact.project.targetDate || null, priority: fact.project.priority || "medium", attention: fact.attentionScore, updated: fact.project.updatedAt || null };
      return evaluateClusterDataDerivedFields(projectDerivedFields, values, PROJECT_PORTFOLIO_DATA_FIELDS).values[derived.id] as string | number | boolean | null;
    },
    cell: (fact) => {
      const values = { project: projectTypeBadge(fact.project), status: fact.status, health: fact.health.label, readiness: fact.completeness, stage: fact.stage.label, source: fact.source.label.toLowerCase(), people: fact.memberCount, target: fact.project.targetDate || null, priority: fact.project.priority || "medium", attention: fact.attentionScore, updated: fact.project.updatedAt || null };
      const value = evaluateClusterDataDerivedFields(projectDerivedFields, values, PROJECT_PORTFOLIO_DATA_FIELDS).values[derived.id];
      return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: derived.display?.precision ?? 2 }) : String(value ?? "—");
    },
  })),
  ], [projectTypeBadge, projectStatusLabel, projectHasGit, isExternalProject, projectDerivedFields, onOpenProject]);
  useEffect(() => { setProjectRenderLimit(PROJECT_RENDER_BATCH); }, [deferredQuery, statusFilter, sourceFilter, scheduleFilter, priorityFilter, focus, normalizedProjectSorts]);
  useEffect(() => {
    const selectedIndex = sortedFacts.findIndex((fact) => fact.project.id === selectedProjectId);
    if (selectedIndex >= projectRenderLimit) setProjectRenderLimit(Math.ceil((selectedIndex + 1) / PROJECT_RENDER_BATCH) * PROJECT_RENDER_BATCH);
  }, [sortedFacts, selectedProjectId, projectRenderLimit]);

  async function exportProjects(format: ClusterDataExportFormat, fieldIds: string[], scope: "view" | "selection", delivery: ClusterDataExportDelivery) {
    setProjectExporting(true);
    setProjectExportStatus(delivery === "library" || format === "xlsx" ? "Queueing project export..." : "Exporting project data...");
    try {
      if (scope === "view" && !projectAnalyticsExact) throw new Error("Current-view export cannot include local-only Project attention or focus filters. Clear Ready, Attention, Pinned, At risk, or Recent, or export selected projects instead.");
      const result = await requestClusterDataExport({
        resourceKind: "project", format, scope, delivery, fieldIds,
        query: scope === "view" ? projectServerDataQuery : {},
        selectedIds: scope === "selection" ? [...selectedProjectIds] : undefined,
        fileName: `projects-${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.mode === "background") { setProjectExportJobId(result.jobId); setProjectExportStatus("Project export queued. The completed file will be saved to Library."); }
      else setProjectExportStatus(`${result.rowCount} project${result.rowCount === 1 ? "" : "s"} exported${result.truncated ? " (bounded immediate export)" : ""}.`);
    } catch (error) { setProjectExportStatus(error instanceof Error ? error.message : "Project export failed."); }
    finally { setProjectExporting(false); }
  }

  const selectedFact = sortedFacts.find((fact) => fact.project.id === selectedProjectId) || sortedFacts[0] || null;
  const selectedProject = selectedFact?.project || null;
  const selectedIsVideo = selectedFact ? isVideoProject(selectedFact.project) : false;
  const selectedBuildPlan = selectedFact && !selectedIsVideo ? projectBuildMilestones(selectedFact.project, selectedFact.entries) : [];
  const selectedChecklist = selectedFact ? projectSetupChecklist(selectedFact.project, { whiteboardCount: selectedFact.projectWhiteboards.length, assignedCount: projectAssignedIds(selectedFact.project).length, hasGit: projectHasGit(selectedFact.project), hasDiscord: projectHasDiscord(selectedFact.project), milestoneCount: selectedFact.entries.length, videoProject: isVideoProject(selectedFact.project) }) : [];
  const activeFilterCount = [statusFilter !== "all", sourceFilter !== "all", scheduleFilter !== "all", priorityFilter !== "all", focus !== "all", Boolean(query.trim())].filter(Boolean).length;
  const secondaryFilterCount = [sourceFilter !== "all", scheduleFilter !== "all", priorityFilter !== "all"].filter(Boolean).length;
  const portfolioPulse = useMemo(() => {
    const total = facts.length;
    const active = facts.filter((fact) => !fact.project.archived && ["active", "on_hold", "paused"].includes(fact.status)).length;
    const atRisk = facts.filter((fact) => fact.attentionScore > 0).length;
    const overdue = facts.filter((fact) => fact.scheduleState === "overdue").length;
    const unscheduled = facts.filter((fact) => !fact.project.targetDate && !fact.project.archived).length;
    const readiness = total ? Math.round(facts.reduce((sum, fact) => sum + fact.completeness, 0) / total) : 0;
    return { total, active, atRisk, overdue, unscheduled, readiness };
  }, [facts]);
  const browserFilters = [
    { id: "all", label: "All projects", count: focusCounts.all, icon: "project" as const },
    { id: "pinned", label: "Starred", count: focusCounts.pinned, icon: "star" as const },
    { id: "recent", label: "Recently updated", count: focusCounts.recent, icon: "clock" as const },
    { id: "at_risk", label: "Needs attention", count: focusCounts.at_risk, icon: "warning" as const },
    { id: "due_soon", label: "Due soon", count: focusCounts.due_soon, icon: "calendar" as const },
    { id: "unscheduled", label: "No target date", count: focusCounts.unscheduled, icon: "calendar" as const },
  ] as const;
  function openInspector(projectId: string, trigger: HTMLElement) {
    // Row actions can be rendered inside a floating menu. Restore keyboard
    // focus to the stable underlying Project tile, not an unmounted menu item.
    inspectorReturnFocusRef.current = projectInspectorReturnFocus(projectId, trigger, document);
    setSelectedProjectId(projectId);
    setInspectorOpen(true);
  }
  function dismissInspector() {
    setInspectorOpen(false);
    const returnTo = inspectorReturnFocusRef.current;
    inspectorReturnFocusRef.current = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    else searchRef.current?.focus({ preventScroll: true });
  }
  function chooseBrowserFocus(next: ProjectPortfolioFocus) {
    setStatusFilter("all");
    setSourceFilter("all");
    setScheduleFilter("all");
    setPriorityFilter("all");
    setProjectAnalyticalSelection(null);
    setProjectAnalyticalSelectionSet({ logic: "or", selections: [] });
    persistFocus(next);
    setInspectorOpen(false);
  }
  const projectDataFields = PROJECT_PORTFOLIO_DATA_FIELDS;
  const defaultProjectTableLayout = useMemo(() => createClusterDataViewLayout(projectTableColumns.map((column) => column.id), projectTableColumns.filter((column) => !column.hiddenByDefault).map((column) => column.id)), [projectTableColumns]);
  const effectiveProjectTableLayout = projectTableLayout || defaultProjectTableLayout;
  const projectDataView = useMemo(() => ({
    presentation: viewMode,
    density,
    query: {
      search: query,
      sorts: normalizedProjectSorts,
      groups: projectGroups,
      projections: projectProjections,
      derivedFields: projectDerivedFields,
      filters: [
        statusFilter !== "all" ? { fieldId: "status", operator: "equals" as const, value: statusFilter } : null,
        sourceFilter !== "all" ? { fieldId: "source", operator: "equals" as const, value: sourceFilter } : null,
        scheduleFilter !== "all" ? { fieldId: "schedule", operator: "equals" as const, value: scheduleFilter } : null,
        priorityFilter !== "all" ? { fieldId: "priority", operator: "equals" as const, value: priorityFilter } : null,
        focus !== "all" ? { fieldId: "focus", operator: "equals" as const, value: focus } : null,
      ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition)).length ? {
        logic: "and" as const,
        conditions: [
          ...(statusFilter !== "all" ? [{ fieldId: "status", operator: "equals" as const, value: statusFilter }] : []),
          ...(sourceFilter !== "all" ? [{ fieldId: "source", operator: "equals" as const, value: sourceFilter }] : []),
          ...(scheduleFilter !== "all" ? [{ fieldId: "schedule", operator: "equals" as const, value: scheduleFilter }] : []),
          ...(priorityFilter !== "all" ? [{ fieldId: "priority", operator: "equals" as const, value: priorityFilter }] : []),
          ...(focus !== "all" ? [{ fieldId: "focus", operator: "equals" as const, value: focus }] : []),
        ],
      } : null,
    },
    layout: effectiveProjectTableLayout,
  }), [query, statusFilter, sourceFilter, scheduleFilter, priorityFilter, normalizedProjectSorts, projectGroups, projectProjections, projectDerivedFields, focus, viewMode, density, effectiveProjectTableLayout]);
  function applySavedDataView(view: ClusterSavedDataView) {
    setQuery(view.query.search || "");
    const conditions = view.query.filters?.conditions || [];
    const valueFor = (fieldId: string) => { const condition = conditions.find((item) => item.fieldId === fieldId && item.operator === "equals"); return typeof condition?.value === "string" ? condition.value : ""; };
    const nextStatus = valueFor("status");
    const nextSource = valueFor("source");
    const nextSchedule = valueFor("schedule");
    const nextPriority = valueFor("priority");
    const nextFocus = valueFor("focus");
    setStatusFilter((["active", "on_hold", "paused", "completed", "cancelled", "archived", "ready", "attention"] as string[]).includes(nextStatus) ? nextStatus as ProjectStatusFilter : "all");
    setSourceFilter((["git", "manual", "external"] as string[]).includes(nextSource) ? nextSource as typeof sourceFilter : "all");
    setScheduleFilter((["due_soon", "overdue", "unscheduled", "scheduled"] as string[]).includes(nextSchedule) ? nextSchedule as typeof scheduleFilter : "all");
    setPriorityFilter((["low", "medium", "high", "urgent"] as string[]).includes(nextPriority) ? nextPriority as typeof priorityFilter : "all");
    setFocus((["at_risk", "due_soon", "unscheduled", "pinned"] as string[]).includes(nextFocus) ? nextFocus as ProjectPortfolioFocus : "all");
    const savedSorts = normalizeClusterDataSorts(view.query.sorts, new Set(["attention", "updated", "readiness", "name", "target", "priority", "status", "health", "stage", "source", "people"]));
    setProjectSorts(savedSorts.length ? savedSorts : [{ fieldId: "attention", direction: "desc" }]);
    setProjectGroups((view.query.groups || []).filter((group) => projectDataFields.some((field) => field.id === group.fieldId && field.groupable)).slice(0, 3));
    setProjectProjections(view.query.projections?.length ? view.query.projections : DEFAULT_PROJECT_PROJECTIONS);
    setProjectDerivedFields(view.query.derivedFields || []);
    setProjectAnalyticalSelection(null);
    setProjectAnalyticalSelectionSet({ logic: "or", selections: [] });
    if (view.presentation === "list" || view.presentation === "cards" || view.presentation === "table") setViewMode(view.presentation);
    if (view.density === "compact" || view.density === "comfortable") setDensity(view.density);
    setProjectTableLayout(view.layout);
  }
  function persistView(next: "list" | "cards" | "table") { setViewMode(next); }
  function persistDensity(next: "compact" | "comfortable") { setDensity(next); }
  function persistFocus(next: ProjectPortfolioFocus) { setFocus(next); }
  function toggleProjectPin(projectId: string) { setPinnedProjectIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]); }
  function applyProjectAnalyticalSelection(selection: ClusterDataSelection | null) {
    if (selection) projectDrilldown.capture();
    setProjectAnalyticalSelectionSet({ logic: "or", selections: [] });
    setProjectAnalyticalSelection(selection);
    if (!selection) return;
    for (const condition of selection.conditions) {
      const value = condition.operator === "equals" && typeof condition.value === "string" ? condition.value : "";
      if (condition.fieldId === "status" && (CLUSTER_PROJECT_STATUSES as readonly string[]).includes(value)) setStatusFilter(value as ProjectStatusFilter);
      if (condition.fieldId === "source" && ["git", "manual", "external"].includes(value)) setSourceFilter(value as typeof sourceFilter);
      if (condition.fieldId === "schedule" && ["due_soon", "overdue", "unscheduled", "scheduled"].includes(value)) setScheduleFilter(value as typeof scheduleFilter);
      if (condition.fieldId === "priority" && ["low", "medium", "high", "urgent"].includes(value)) setPriorityFilter(value as typeof priorityFilter);
    }
  }
  function clearFilters() { projectDrilldown.reset(); setQuery(""); setStatusFilter("all"); setSourceFilter("all"); setScheduleFilter("all"); setPriorityFilter("all"); setProjectAnalyticalSelection(null); setProjectAnalyticalSelectionSet({ logic: "or", selections: [] }); persistFocus("all"); }
  function navigateSelection(delta: number) { if (!sortedFacts.length) return; const current = sortedFacts.findIndex((fact) => fact.project.id === selectedProject?.id); const next = sortedFacts[(Math.max(0, current) + delta + sortedFacts.length) % sortedFacts.length]; setSelectedProjectId(next.project.id); }

  return (
    <section className="page cluster-page-shell projects-page-v310">
      <ToolPageHeader
        className="projects-primary-header-v459 cluster-page-header"
        title="Projects"
        icon="project"

        actions={
          <>
            {portfolioProjects.length > 0 && <ClusterButton variant="quiet" onClick={onOpenBuilds}>Releases</ClusterButton>}
            {isAdmin && <ClusterButton variant="primary" onClick={onCreateProject}><ClusterIcon name="plus" /> New project</ClusterButton>}
          </>
        }
      />



      {projects.length === 0 && !portfolioProjects.length && !projectCursor.loading && !query.trim() && statusFilter === "all" && sourceFilter === "all" && scheduleFilter === "all" && priorityFilter === "all" && focus === "all" ? (
        <ClusterEmptyState
          kind="first-use"
          icon="project"
          className="projects-empty-start-v344"
          eyebrow="Project portfolio"
          title={isAdmin ? "Create the first project" : "No projects are available yet"}
          description={isAdmin ? "Start with a real project. Boards, Build, QA, Library, ownership, and delivery context will attach to it as the team works." : "A project owner or administrator needs to create or assign a project before project work appears here."}
          actions={isAdmin ? <ClusterButton variant="primary" onClick={onCreateProject}>Create project</ClusterButton> : undefined}
        />
      ) : (
        <div className="projects-browser-layout-rc25">
          <aside className="projects-browser-rail-rc25" aria-label="Project collections">
            <div className="projects-browser-rail-head-rc25"><strong>Browse</strong><span>{portfolioPulse.total}</span></div>
            <nav aria-label="Project collections">
              {browserFilters.map((item) => <ClusterButton unstyled key={item.id}
                type="button" className={`projects-browser-rail-item-rc25 ${statusFilter !== "archived" && focus === item.id ? "active" : ""}`}
                aria-current={statusFilter !== "archived" && focus === item.id ? "page" : undefined}
                onClick={() => chooseBrowserFocus(item.id)}>
                  <ClusterIcon name={item.icon} /><span>{item.label}</span><small>{item.count}</small>
                </ClusterButton>)}
              <ClusterButton unstyled type="button" className={`projects-browser-rail-item-rc25 ${statusFilter === "archived" ? "active" : ""}`}
                aria-current={statusFilter === "archived" ? "page" : undefined}
                onClick={() => { setStatusFilter("archived"); setSourceFilter("all"); setScheduleFilter("all"); setPriorityFilter("all"); persistFocus("all"); setInspectorOpen(false); }}>
                <ClusterIcon name="archive" /><span>Archived</span>
              </ClusterButton>
            </nav>
            {pinnedProjectIds.length > 0 && <div className="projects-browser-pinned-rc25">
              <strong>Shortcuts</strong>
              {pinnedProjectIds.slice(0, 6).map((id) => {
                const pinned = projects.find((project) => project.id === id);
                return pinned ? <ClusterButton key={id} unstyled type="button" title={pinned.name} onClick={() => onOpenProject(pinned.id)}>
                  <i style={runtimeStyle({ background: pinned.color || "#57c1ff" })} /><span>{pinned.name}</span>
                </ClusterButton> : null;
              })}
            </div>}
          </aside>
          <div className="projects-browser-main-rc25">
            <div className="projects-browser-topline-rc25">
              <div><h2>{statusFilter === "archived" ? "Archived" : browserFilters.find((item) => item.id === focus)?.label || "All projects"}</h2></div>
              <ClusterButton size="compact" variant="quiet" aria-expanded={browserFiltersOpen} onClick={() => setBrowserFiltersOpen((open) => !open)}><ClusterIcon name="settings" /> {browserFiltersOpen ? "Hide filters" : "Filters"}{secondaryFilterCount || statusFilter !== "all" ? ` · ${secondaryFilterCount + Number(statusFilter !== "all")}` : ""}</ClusterButton>
            </div>
          <ClusterTableToolbar
            className="projects-toolbar-v146"
            inputRef={searchRef}
            query={query}
            onQueryChange={setQuery}
            onSearchKeyDown={(event) => {
              if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); }
              if (event.key === "ArrowDown") { event.preventDefault(); navigateSelection(1); }
              if (event.key === "ArrowUp") { event.preventDefault(); navigateSelection(-1); }
              if (event.key === "Enter" && selectedProject) onOpenProject(selectedProject.id);
            }}
            searchLabel="Search projects"
            placeholder="Search projects"
            shortcut="/"
            countLabel={`${sortedFacts.length} projects`}
            filters={browserFiltersOpen ?
              <>
                <div className={`projects-filter-pills-v146 ${browserFiltersOpen ? "filters-open" : ""}`} aria-label="Project status filter">
                  {[["all", "All"], ["attention", "Needs work"], ["ready", "Ready"], ["active", "Active"], ["on_hold", "On hold"], ["archived", "Archived"]].map(([value, label]) => (
                    <ClusterButton unstyled type="button" key={value} className={statusFilter === value ? "active" : ""} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value as typeof statusFilter)}>{label}</ClusterButton>
                  ))}
                </div>
                <label className="field projects-sort-v57"><span>Sort</span><ClusterNativeSelect value={primarySortMode} onChange={(event) => { const fieldId = event.target.value; setProjectSorts([{ fieldId, direction: fieldId === "name" || fieldId === "target" ? "asc" : "desc" }]); }}><option value="attention">Attention</option><option value="updated">Updated</option><option value="readiness">Readiness</option><option value="target">Target date</option><option value="priority">Priority</option><option value="name">Name</option></ClusterNativeSelect></label>
                <ClusterFilterPopover className="projects-more-filters-v57" panelClassName="projects-more-filters-panel-v547" label="More filters" count={secondaryFilterCount}>
                  <div className="projects-more-filters-body-v57">
                    <label className="field"><span>Source</span><ClusterNativeSelect value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}><option value="all">All</option><option value="git">Git</option><option value="manual">Manual</option><option value="external">External</option></ClusterNativeSelect></label>
                    <label className="field"><span>Schedule</span><ClusterNativeSelect value={scheduleFilter} onChange={(event) => setScheduleFilter(event.target.value as typeof scheduleFilter)}><option value="all">Any date</option><option value="due_soon">Due in 30 days</option><option value="overdue">Overdue</option><option value="unscheduled">Unscheduled</option><option value="scheduled">Scheduled later</option></ClusterNativeSelect></label>
                    <label className="field"><span>Priority</span><ClusterNativeSelect value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}><option value="all">All</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></ClusterNativeSelect></label>
                  </div>
                </ClusterFilterPopover>
              </> : undefined
            }
            actions={<>{isAdmin ? <DataImportBuilder resourceKind="project" label="Projects" /> : null}<DataExportBuilder fields={projectExportFields} selectionCount={selectedProjectIds.size} busy={projectExporting} onExport={({ format, fieldIds, scope, delivery }) => exportProjects(format, fieldIds, scope, delivery)} />{activeFilterCount > 0 ? <ClusterButton variant="quiet" size="compact" className="projects-clear-v310" onClick={clearFilters}>Clear {activeFilterCount}</ClusterButton> : null}</>}
          />
          <div className={`projects-workspace-v146 projects-browser-rc24 ${inspectorOpen ? "has-inspector" : ""}`}>
            <section className="project-index-v146" aria-label="Project list">
              <div className="project-index-head-v146">
                <div className="projects-index-heading-rc24"><strong>{viewMode === "table" ? "Detailed view" : viewMode === "list" ? "Project list" : "Project gallery"}</strong><span>{projectCursor.hasMore ? "More available" : `${sortedFacts.length} projects`}</span></div>
                <div className="project-index-controls-v310">
                  <ClusterButton variant={inspectorOpen ? "secondary" : "quiet"} size="compact" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><ClusterIcon name="note" /> {inspectorOpen ? "Hide details" : "Details"}</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" onClick={() => persistDensity(density === "compact" ? "comfortable" : "compact")} title="Toggle compact layout"><ClusterIcon name="settings" /> {density === "compact" ? "Spacious" : "Compact"}</ClusterButton>
                  <ClusterSegmentedControl value={viewMode} onChange={persistView} label="Project layout" options={[{ value: "list", label: "List" }, { value: "cards", label: "Cards" }, { value: "table", label: "Table" }]} />
                </div>
              </div>
              {loadedHealth.total > 0 && <div className="project-loaded-snapshot-rc41" aria-label="Loaded portfolio snapshot">
                <ClusterVisualComposition label={projectCursor.hasMore ? "Loaded filtered projects · more on server" : "Loaded filtered projects"} total={loadedHealth.total} parts={[
                  { label: "Healthy", value: loadedHealth.healthy, tone: "good" },
                  { label: "Needs attention", value: loadedHealth.attention, tone: "warning" },
                ]} />
                <ClusterVisualMeter label="Average loaded readiness" value={loadedHealth.averageReadiness} total={100} tone="accent" />
              </div>}
              {viewMode === "table" ? <>
                <DataViewGroupControl fields={projectDataFields} groups={projectGroups} onChange={setProjectGroups} label="Group projects" />
                <ClusterDataTable
                rows={sortedFacts}
                columns={projectTableColumns}
                rowKey={(fact) => fact.project.id}
                rowLabel={(fact) => fact.project.name}
                label="Project portfolio table"
                selectedKeys={selectedProjectIds}
                onSelectionChange={(keys) => setSelectedProjectIds(new Set(keys))}
                onRowActivate={(fact) => onOpenProject(fact.project.id)}
                configurableColumns
                persistKey="project-portfolio"
                controlledLayout={projectTableLayout || undefined}
                onLayoutChange={setProjectTableLayout}
                sorts={normalizedProjectSorts}
                onSortsChange={setProjectSorts}
                groups={projectGroups}
                groupSummaries={projectAnalyticsExact && projectServerGroups.length === projectGroups.length ? projectServerAnalytics?.groupedSummaries : undefined}
                groupSummaryFieldMap={{ project: "projectType" }}
                groupMetrics={[
                  { id: "readiness", label: "Avg", columnId: "readiness", value: (rows) => rows.length ? `${Math.round(rows.reduce((sum, fact) => sum + fact.completeness, 0) / rows.length)}%` : "—" },
                  { id: "people", label: "People", columnId: "people", value: (rows) => rows.reduce((sum, fact) => sum + fact.memberCount, 0) },
                  { id: "attention", label: "Need attention", columnId: "health", value: (rows) => rows.filter((fact) => fact.health.tone !== "good").length },
                ]}
                groupSubtotalMode="row"
                summaryRows={projectSummaryRows}
                virtualization={{ rowHeight: density === "compact" ? 44 : 54, maxHeight: 760, minimumRows: 160, overscan: 12 }}
                incremental={{ hasMore: projectCursor.hasMore, loading: projectCursor.loading, prefetchRows: 24, loadLabel: "Load 80 more projects", onLoadMore: projectCursor.loadMore }}
                empty={<ClusterEmptyState kind="filtered" compact className="flat-empty-v146" title="No projects match this view" description="The portfolio still has projects. Clear the current search and filters to bring them back into view." actions={<ClusterButton variant="secondary" size="compact" onClick={clearFilters}>Clear filters</ClusterButton>} />}
              /></> :               <div className={`project-list-v146 project-list-${viewMode}-v307`}>
                {sortedFacts.length ? visibleFacts.map((fact) => (
                  <ProjectPortfolioItem
                    key={fact.project.id}
                    project={fact.project}
                    selected={selectedProject?.id === fact.project.id}
                    pinned={pinnedProjectSet.has(fact.project.id)}
                    density={density}
                    health={fact.health}
                    schedule={fact.snapshot ? { label: fact.snapshot.schedule.label, tone: projectSnapshotScheduleTone(fact.snapshot), detail: fact.snapshot.schedule.label } : undefined}
                    completeness={fact.completeness}
                    stageLabel={fact.stage.label}
                    statusLabel={projectStatusLabel(fact.project)}
                    typeLabel={projectTypeBadge(fact.project)}
                    gaps={fact.gaps}
                    memberCount={fact.memberCount}
                    onSelect={() => onOpenProject(fact.project.id)}
                    onInspect={(event) => openInspector(fact.project.id, event.currentTarget)}
                    onTogglePin={() => toggleProjectPin(fact.project.id)}
                  />
                )) : (
                  <ClusterEmptyState
                    kind="filtered"
                    compact
                    className="flat-empty-v146"
                    title="No projects match this view"
                    description="The portfolio still has projects. Clear the current search and filters to bring them back into view."
                    actions={<ClusterButton variant="secondary" size="compact" onClick={clearFilters}>Clear filters</ClusterButton>}
                  />
                )}
                {hasMoreProjects ? <div className="project-list-more-v494"><ClusterButton variant="quiet" size="compact" onClick={() => setProjectRenderLimit((current) => current + PROJECT_RENDER_BATCH)}>Show {Math.min(PROJECT_RENDER_BATCH, sortedFacts.length - visibleFacts.length)} more · {sortedFacts.length - visibleFacts.length} loaded locally</ClusterButton></div> : projectCursor.hasMore ? <div className="project-list-more-v494"><ClusterButton variant="quiet" size="compact" disabled={projectCursor.loading} onClick={projectCursor.loadMore}>{projectCursor.loading ? "Loading more…" : "Load 80 more projects from server"}</ClusterButton></div> : null}
              </div>}
            </section>
            {inspectorOpen ? <div ref={inspectorPanelRef} role="dialog" aria-modal="false"
              aria-labelledby="projects-browser-inspector-heading-rc25"
              aria-describedby="projects-browser-inspector-help-v11"
              tabIndex={-1} className="projects-browser-inspector-shell-rc25"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented) return;
                event.preventDefault();
                event.stopPropagation();
                dismissInspector();
              }}>
              <div className="projects-browser-inspector-toolbar-rc25">
                <strong id="projects-browser-inspector-heading-rc25">Project details{selectedProject ? ` · ${selectedProject.name}` : ""}</strong>
                <ClusterButton variant="quiet" size="compact" onClick={dismissInspector} aria-label="Close project details"><ClusterIcon name="close" /></ClusterButton>
              </div>
              <p id="projects-browser-inspector-help-v11" className="sr-only-v204">Read-only project preview. Press Escape to close and return to the project list.</p>
              <ProjectPortfolioInspector
              project={selectedProject}
              health={selectedFact?.health || null}
              schedule={selectedFact?.snapshot ? { label: selectedFact.snapshot.schedule.label, tone: projectSnapshotScheduleTone(selectedFact.snapshot), detail: selectedFact.snapshot.schedule.label } : null}
              completeness={selectedFact?.completeness || 0}
              source={selectedFact?.source || null}
              status={selectedProject ? projectStatusMeta(selectedProject) : null}
              whiteboards={selectedFact?.projectWhiteboards || []}
              members={selectedFact?.members || []}
              checklist={selectedChecklist}
              gaps={selectedFact?.gaps || []}
              buildPlan={selectedBuildPlan}
              videoProject={selectedIsVideo}
              onOpenProject={onOpenProject}
              onOpenBoard={onOpenBoard}
              onOpenWhiteboard={onOpenWhiteboard}
              onOpenTimeline={onOpenTimeline}
              onOpenBuilds={onOpenBuilds}
              onOpenActivity={onOpenActivity}
              onOpenReports={onOpenReports}
            /></div> : null}
          </div>
          <section className="projects-browser-advanced-rc25" aria-label="Portfolio management">
            {isAdmin && portfolioProjects.length > 0 ? (
        <ClusterDisclosureGroup className="projects-intelligence-v30d" title="Portfolio signals"  open={intelligenceOpen} onOpenChange={setIntelligenceOpen} headerTrailing={portfolioIntelligence ? <span className={portfolioIntelligence.danger ? "danger" : portfolioIntelligence.atRisk ? "warning" : "good"}>{portfolioIntelligence.atRisk} at risk · {portfolioIntelligence.highPressureOwners} pressured</span> : null}>
          {intelligenceOpen && portfolioIntelligence ?
          <ClusterMetricStrip
            className="project-portfolio-metrics-v427"
            label="Studio portfolio intelligence"
            items={[
              { label: "Portfolio risk", value: portfolioIntelligence.atRisk, detail: `${portfolioIntelligence.danger} high risk · ${portfolioIntelligence.trend?.samples || 1}d evidence${portfolioIntelligence.trend?.atRiskDelta ? ` · ${portfolioIntelligence.trend.atRiskDelta > 0 ? "+" : ""}${portfolioIntelligence.trend.atRiskDelta}` : ""}`, tone: portfolioIntelligence.danger ? "danger" : portfolioIntelligence.atRisk ? "warning" : "neutral" },
              { label: "Cross-project", value: portfolioIntelligence.crossProjectDependencies, detail: `${portfolioIntelligence.criticalCrossProjectDependencies} critical`, tone: portfolioIntelligence.criticalCrossProjectDependencies ? "warning" : "neutral" },
              { label: "Capacity pressure", value: portfolioIntelligence.highPressureOwners, detail: `${portfolioIntelligence.departments?.filter((item) => item.highPressureOwners).length || 0} departments · ${portfolioIntelligence.trend?.highPressureDelta ? `${portfolioIntelligence.trend.highPressureDelta > 0 ? "+" : ""}${portfolioIntelligence.trend.highPressureDelta} trend` : "trend unavailable"}`, tone: portfolioIntelligence.highPressureOwners ? "warning" : "neutral" },
              { label: "Coverage", value: portfolioIntelligence.projectCount, detail: "visible Studio projects" },
            ]}
          /> : intelligenceOpen ? <p className="muted">Loading…</p> : null}
        </ClusterDisclosureGroup>
      ) : null}
            <ClusterDisclosureGroup className="projects-data-tools-v528" title="Views & analytics"  open={analyticsOpen} onOpenChange={setAnalyticsOpen} contentClassName="projects-data-tools-body-v528">
                {analyticsOpen ? <>
              <ClusterDataView scope="projects.portfolio" label="Project portfolio" resourceKind="project" current={projectDataView} onApply={applySavedDataView} allowStudio={isAdmin} summary="Save search, filters, sorting, analytical projections and drilldowns, focus, density, presentation, and the exact portfolio table layout together." />
              {projectAnalyticsExact && projectServerAnalytics ? <>
                <DataViewAggregationStrip aggregations={projectServerDataQuery.aggregations || []} values={projectServerAnalytics.aggregations} fields={PROJECT_DATA_FIELDS} label="Filtered portfolio totals" />
                <DataViewFacetBar facets={projectServerAnalytics.facets} fields={PROJECT_DATA_FIELDS} selectedValues={{ status: !["all", "archived", "ready", "attention"].includes(statusFilter) ? [statusFilter] : [], source: sourceFilter !== "all" ? [sourceFilter] : [], schedule: scheduleFilter !== "all" ? [scheduleFilter] : [], priority: priorityFilter !== "all" ? [priorityFilter] : [] }} onToggle={(fieldId, value) => { const next = String(value); if (fieldId === "status") setStatusFilter(statusFilter === next ? "all" : next as ProjectStatusFilter); if (fieldId === "source") setSourceFilter(sourceFilter === next ? "all" : next as typeof sourceFilter); if (fieldId === "schedule") setScheduleFilter(scheduleFilter === next ? "all" : next as typeof scheduleFilter); if (fieldId === "priority") setPriorityFilter(priorityFilter === next ? "all" : next as typeof priorityFilter); }} />
                {projectServerAnalytics.projections?.length ? <div className="cluster-data-projections-v504">{projectServerAnalytics.projections.map((projection) => <DataViewProjection key={projection.id} result={projection} fields={PROJECT_DATA_FIELDS} label={`Project ${projection.kind} projection`} selection={projectAnalyticalSelection} selectionSet={projectAnalyticalSelectionSet} onSelectionChange={applyProjectAnalyticalSelection} onSelectionSetChange={(next) => { if (!projectAnalyticalSelectionSet.selections.length && next.selections.length) projectDrilldown.capture(); setProjectAnalyticalSelection(null); setProjectAnalyticalSelectionSet(next); }} onDrilldown={(_selection, drilldown) => { if (drilldown?.presentation === "table") setViewMode("table"); }} />)}</div> : null}
              </> : null}
              <DataViewProjectionComposer fields={projectDataFields} projections={projectProjections} onChange={setProjectProjections} label="Project analytical projections" />
              <DataViewSelectionBar selection={projectAnalyticalSelection} fields={PROJECT_DATA_FIELDS} historyDepth={projectDrilldown.depth} onBack={projectDrilldown.back} onExit={projectDrilldown.exit} onClear={() => setProjectAnalyticalSelection(null)} label="Project analytical selection" />
              <DataViewSelectionSetBar selectionSet={projectAnalyticalSelectionSet} fields={PROJECT_DATA_FIELDS} onChange={(next) => { setProjectAnalyticalSelection(null); setProjectAnalyticalSelectionSet(next); }} label="Project cross-highlight selections" />
              {viewMode === "table" ? <DataViewDerivedFieldBuilder fields={projectDataFields} derivedFields={projectDerivedFields} onChange={(next) => { setProjectDerivedFields(next); setProjectTableLayout(null); }} label="Project formula columns" /> : null}
              {projectExportStatus ? <p className="muted" aria-live="polite">{projectExportStatus}</p> : null}
                </> : null}
          </ClusterDisclosureGroup>
          <DataExportOperationFeedback jobId={projectExportJobId} onDismiss={() => setProjectExportJobId("")} />
          </section>
          </div>
        </div>
      )}
    </section>
  );
}

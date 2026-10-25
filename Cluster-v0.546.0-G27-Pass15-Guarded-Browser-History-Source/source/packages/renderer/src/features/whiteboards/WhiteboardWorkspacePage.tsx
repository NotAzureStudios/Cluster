import { canUseWhiteboardHistory, whiteboardHistoryShortcut, whiteboardHistoryTargetContext } from "./whiteboard-history-shortcuts";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import type * as React from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, queryApi } from "../../core/api";
import { keyboardNudge } from "../../core/accessibility";
import { compactDateTime } from "../../core/date-time";
import { formatRelativeTime, levelLabel } from "../../core/format";
import { downloadJsonFile, localId, readLocalJson, writeLocalJson } from "../../core/storage";
import { readPreferenceStorage, writePreferenceStorage } from "../../core/privacy-consent";
import { NumberStepper } from "../../components/NumberStepper";
import { ClusterSlider } from "../../components/ClusterSlider";
import { CompactColorField } from "../../components/ColorField";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterRecoveryNotice } from "../../components/ClusterContextActions";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ProjectResourceSwitcher, type ProjectResourceSwitcherItem } from "../../components/ProjectResourceSwitcher";
import { ProjectWorkspaceShell } from "../../components/ProjectWorkspaceShell";
import { CanvasLoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import { openDesktopWorkspaceWindow } from "../../core/desktop";
import { ClusterIcon } from "../../components/ClusterIcon";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { collaborationColor, CollaborationQueuePanel, CollaborationStrip, useToolCollaboration } from "../collaboration";
import { projectStatusLabel, projectStatusMeta } from "../projects/projects-utils";
import type {
  Card,
  LocalComment,
  Project,
  Whiteboard,
  WhiteboardCategory,
  WhiteboardConnectorElement,
  WhiteboardElement,
  WhiteboardInteraction,
  WhiteboardLabel,
  WhiteboardPathElement,
  WhiteboardPoint,
  WhiteboardProductionRecord,
  WhiteboardShapeElement,
  WhiteboardShapeType,
  WhiteboardSummary,
  WhiteboardTool,
  UserActivitySummary,
  CommandSearchPayload,
  CommandSearchResult,
} from "../application/application-models";
import { createWhiteboardImageElement } from "./whiteboard-media";
import { arrowHeadPoints, calloutPoints, cloudPath, diamondPoints, eraseWhiteboardElementsAt, getElementText, isShapeElement, makeWhiteboardId, moveWhiteboardElement, normalizeWhiteboardBox, pathFromPoints, reflowWhiteboardConnectors, updateWhiteboardElementStyle, whiteboardElementBounds } from "./whiteboard-elements";
import { buildWhiteboardTemplate, flowTemplateArrow, flowTemplateElement } from "./whiteboard-templates";
import { boundsIntersectWhiteboardViewport, useWhiteboardViewport } from "./use-whiteboard-viewport";
import { useWhiteboardMobileTouchNavigation } from "./whiteboard-mobile-touch";
import { buildWhiteboardOutline, buildWhiteboardPresenceIndex, whiteboardContentBounds, whiteboardElementsBounds } from "./whiteboard-workspace-model";
import {
  alignWhiteboardSelection,
  applyWhiteboardSelectionStyle,
  createWhiteboardSelectionConnector,
  distributeWhiteboardSelection,
  duplicateWhiteboardSelection,
  removeWhiteboardSelection,
  reorderWhiteboardElement,
  resizeWhiteboardSelection,
  setWhiteboardSelectionGroup,
  snapWhiteboardSelectionToGrid,
  type WhiteboardAlignment,
  type WhiteboardDistributionAxis,
} from "./whiteboard-selection-operations";
import { WhiteboardCommandBar, WhiteboardMoreMenu, WhiteboardZoomControls } from "./WhiteboardWorkspaceChrome";
import { WhiteboardDetailsPanel, WhiteboardPresentationControls, WhiteboardRecoveryBanner, WhiteboardRelationshipsPanel, WhiteboardRemotePresenceOverlay } from "./WhiteboardWorkspacePanels";
import "./whiteboard-workspace.css";
import { runtimeStyle } from "../../core/runtime-style";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useProjectWorkflowList } from "../../core/project-workflow-storage";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SavedViewsToolbar } from "../../components/SavedViewsToolbar";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { buildWhiteboardSpatialIndex, queryWhiteboardSpatialIndex } from "./whiteboard-spatial-index";
import { buildProjectRelationshipDiagram, buildSourceControlDiagram, type WhiteboardSourceControlDiagramPayload } from "./whiteboard-generated-diagrams";
import { applyWhiteboardOperations, buildWhiteboardOperations, planWhiteboardFeedSync, whiteboardOperationTargets, type WhiteboardOperation, type WhiteboardOperationBatchResult, type WhiteboardOperationFeed } from "./whiteboard-operations";
import { reviewWhiteboardConflict, type WhiteboardConflictChoice } from "./whiteboard-conflict-review";
import { whiteboardRecoveryStorageKey } from "./whiteboard-recovery-identity";
import type { ProjectControlCenterPayload } from "../projects/project-control-model";

const WHITEBOARD_OUTLINE_BATCH = 300;
const WHITEBOARD_NAVIGATOR_MAX = 600;
const STUDIO_SWATCHES = ["#2563eb", "#39c9f4", "#60a5fa", "#f8fafc", "#cbd5e1", "#94a3b8", "#475569", "#0f172a", "#020617", "#ef4444", "#22c55e", "#f97316"];
const WHITEBOARD_PALETTES = [
  { id: "ocean", label: "Ocean", stroke: "#2563eb", fill: "#dbeafe", text: "#0f172a", background: "#f8fbff", grid: "#bfdbfe" },
  { id: "forest", label: "Forest", stroke: "#15803d", fill: "#dcfce7", text: "#14532d", background: "#f7fff9", grid: "#bbf7d0" },
  { id: "sunset", label: "Sunset", stroke: "#ea580c", fill: "#ffedd5", text: "#7c2d12", background: "#fffaf5", grid: "#fed7aa" },
  { id: "violet", label: "Violet", stroke: "#7c3aed", fill: "#f3e8ff", text: "#4c1d95", background: "#fcfaff", grid: "#ddd6fe" },
  { id: "mono", label: "Mono", stroke: "#334155", fill: "#e2e8f0", text: "#0f172a", background: "#f8fafc", grid: "#cbd5e1" },
] as const;
type WhiteboardSavedHistoryEntry = {
  id: string;
  sequence: number;
  kind: string;
  targets: string[];
  state: "applied" | "undone";
  historyAnchorSequence: number | null;
  createdAt: string;
};
type WhiteboardSavedHistoryResponse = { ok: boolean; entries: WhiteboardSavedHistoryEntry[] };


function whiteboardLocalHistoryLimit(elementCount: number) {
  if (elementCount > 4_000) return 3;
  if (elementCount > 2_000) return 5;
  if (elementCount > 750) return 10;
  return 20;
}

function appendWhiteboardHistory(history: WhiteboardElement[][], snapshot: WhiteboardElement[]) {
  const limit = whiteboardLocalHistoryLimit(snapshot.length);
  // Whiteboard editing is immutable. Retain the element references and copy only the
  // array so unchanged objects/point buffers are structurally shared across undo states.
  return [...history.slice(-Math.max(0, limit - 1)), snapshot.slice()];
}

type WhiteboardDirtySnapshot = {
  name: string; description: string; projectId: string; canvasWidth: number; canvasHeight: number; backgroundColor: string; gridColor: string; gridStyle: string;
  elements: WhiteboardElement[]; categories: WhiteboardCategory[]; labels: WhiteboardLabel[]; productionLinks: Record<string, WhiteboardProductionRecord>;
};

function whiteboardDocumentSignature(input: WhiteboardDirtySnapshot) {
  return JSON.stringify(input);
}

const DEFAULT_WHITEBOARD_LABELS: WhiteboardLabel[] = [
  { id: "idea", name: "Idea", color: "#8b5cf6" },
  { id: "decision", name: "Decision", color: "#2563eb" },
  { id: "risk", name: "Risk", color: "#dc2626" },
  { id: "action", name: "Action", color: "#16a34a" },
];

const WHITEBOARD_TOOL_META: Record<WhiteboardTool, { label: string; shortcut: string }> = {
  select: { label: "Select", shortcut: "V" },
  pen: { label: "Pen", shortcut: "P" },
  line: { label: "Line", shortcut: "L" },
  arrow: { label: "Arrow", shortcut: "A" },
  box: { label: "Box", shortcut: "R" },
  ellipse: { label: "Oval", shortcut: "O" },
  diamond: { label: "Decision", shortcut: "D" },
  sticky: { label: "Note", shortcut: "N" },
  process: { label: "Process", shortcut: "M" },
  terminator: { label: "Start/End", shortcut: "U" },
  database: { label: "Database", shortcut: "B" },
  cloud: { label: "Cloud", shortcut: "C" },
  actor: { label: "Actor", shortcut: "H" },
  frame: { label: "Frame", shortcut: "F" },
  callout: { label: "Callout", shortcut: "Q" },
  swimlane: { label: "Swimlane", shortcut: "S" },
  card: { label: "Card", shortcut: "K" },
  text: { label: "Text", shortcut: "T" },
  eraser: { label: "Erase", shortcut: "E" },
};
const WHITEBOARD_BASIC_TOOLS: WhiteboardTool[] = ["select", "pen", "eraser", "text", "card"];
const WHITEBOARD_CONNECTOR_TOOLS: WhiteboardTool[] = ["line", "arrow"];
const WHITEBOARD_SHAPE_TOOLS: WhiteboardTool[] = ["box", "ellipse", "diamond", "sticky", "process", "terminator", "database", "cloud", "actor", "frame", "callout", "swimlane"];
export type WhiteboardWorkspaceComponents = {
  RelatedRecordsPanel: React.ComponentType<any>;
  CustomFieldValuesPanel: React.ComponentType<any>;
  VersionHistoryPanel: React.ComponentType<any>;
};

export type WhiteboardWorkspacePageProps = {
  whiteboards: WhiteboardSummary[];
  projects: Project[];
  selectedWhiteboardId: string | null;
  onSelectWhiteboard: (id: string | null) => void;
  onReloadWhiteboards: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
  onOpenTickets: (projectId: string) => void;
  onOpenTimeline: (projectId: string) => void;
  onOpenTime: (projectId: string) => void;
  components: WhiteboardWorkspaceComponents;
};

type WhiteboardRecoveryDraft = {
  savedAt: string;
  whiteboard: Whiteboard;
  elements: WhiteboardElement[];
  productionLinks?: Record<string, WhiteboardProductionRecord>;
};

type WhiteboardComponentRecord = {
  id: string;
  projectId: string;
  name: string;
  elements: WhiteboardElement[];
  ownerId: string;
  sourceWhiteboardId?: string | null;
  tags?: string[];
  description?: string | null;
  category?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function WhiteboardWorkspacePage({ whiteboards, projects, selectedWhiteboardId, onSelectWhiteboard, onReloadWhiteboards, onOpenProject, onOpenTickets, onOpenTimeline, onOpenTime, components }: WhiteboardWorkspacePageProps) {
  const { RelatedRecordsPanel: RelatedRecordsPanel, CustomFieldValuesPanel: CustomFieldValuesPanel } = components;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [activeWhiteboard, setActiveWhiteboard] = useState<Whiteboard | null>(null);
  const [whiteboardLoading, setWhiteboardLoading] = useState(false);
  const [whiteboardLoadError, setWhiteboardLoadError] = useState<unknown>(null);
  const [whiteboardReloadNonce, setWhiteboardReloadNonce] = useState(0);
  const [whiteboardName, setWhiteboardName] = useState("Untitled Whiteboard");
  const [whiteboardDescription, setWhiteboardDescription] = useState("");
  const [whiteboardProjectId, setWhiteboardProjectId] = useState("");
  const [tool, setTool] = useState<WhiteboardTool>("select");
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [categories, setCategories] = useState<WhiteboardCategory[]>([]);
  const [labels, setLabels] = useState<WhiteboardLabel[]>(DEFAULT_WHITEBOARD_LABELS);
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [activeLabelId, setActiveLabelId] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#8b5cf6");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#2563eb");
  const [showCategories, setShowCategories] = useState(true);
  const [imageDropActive, setImageDropActive] = useState(false);
  const [history, setHistory] = useState<WhiteboardElement[][]>([]);
  const [redoHistory, setRedoHistory] = useState<WhiteboardElement[][]>([]);
  const [savedHistory, setSavedHistory] = useState<WhiteboardSavedHistoryEntry[]>([]);
  const [recoverableEdit, setRecoverableEdit] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<WhiteboardInteraction | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [showSelectionDiscussion, setShowSelectionDiscussion] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationFrameIndex, setPresentationFrameIndex] = useState(0);
  const [strokeColor, setStrokeColor] = useState("#2563eb");
  const [fillColor, setFillColor] = useState("#0f172a");
  const [textColor, setTextColor] = useState("#f8fafc");
  const [fillEnabled, setFillEnabled] = useState(true);
  const [shapeOpacity, setShapeOpacity] = useState(100);
  const [dashedStroke, setDashedStroke] = useState(false);
  const [shapeShadow, setShapeShadow] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [eraserSize, setEraserSize] = useState(18);
  const [fontSize, setFontSize] = useState(20);
  const [zoom, setZoom] = useState(1);
  const mobileTouchNavigation = useWhiteboardMobileTouchNavigation({ canvasWrapRef, zoom, setZoom, onBlankTap: () => setSelectedId(null) });
  const [eraserCursor, setEraserCursor] = useState<WhiteboardPoint | null>(null);
  const [labelText, setLabelText] = useState("New idea");
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSize, setGridSize] = useState(32);
  const [backgroundColor, setBackgroundColor] = useState("#f8fafc");
  const [gridColor, setGridColor] = useState("#cbd5e1");
  const [gridStyle, setGridStyle] = useState<"lines" | "dots" | "none">("lines");
  const [canvasWidth, setCanvasWidth] = useState(1800);
  const [canvasHeight, setCanvasHeight] = useState(950);
  const [status, setStatus] = useState("Whiteboard tools ready.");
  const [workspaceWindowStatus, setWorkspaceWindowStatus] = useState("");
  const canOpenWorkspaceWindow = typeof window !== "undefined" && Boolean(window.clusterDesktop?.openWorkspaceWindow);
  const resourceWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterWindow") === "resource";
  const [isWhiteboardFullscreen, setIsWhiteboardFullscreen] = useState(false);
  const [showWhiteboardDetails, setShowWhiteboardDetails] = useState(false);
  const [followedUserId, setFollowedUserId] = useState<string | null>(null);
  const [pendingRemote, setPendingRemote] = useState<Whiteboard | null>(null);
  const [whiteboardMergeChoices, setWhiteboardMergeChoices] = useState<Record<string, WhiteboardConflictChoice>>({});
  const [reviewedMergeAwaitingSave, setReviewedMergeAwaitingSave] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<WhiteboardRecoveryDraft | null>(null);
  const [productionMap, setProductionMap] = useState<Record<string, WhiteboardProductionRecord>>({});
  const [productionTargetListId, setProductionTargetListId] = useState("");
  const [productionComment, setProductionComment] = useState("");
  const [productionTemplate, setProductionTemplate] = useState<"feature" | "qa" | "milestone" | "review">("feature");
  const [liveReferenceQuery, setLiveReferenceQuery] = useState("");
  const [liveReferenceResults, setLiveReferenceResults] = useState<CommandSearchResult[]>([]);
  const [liveReferenceLoading, setLiveReferenceLoading] = useState(false);
  const [liveReferenceError, setLiveReferenceError] = useState("");
  const liveReferenceRequestRef = useRef(0);
  const [diagramBusy, setDiagramBusy] = useState<"relationships" | "source" | null>(null);
  const [facilitatorMode, setFacilitatorMode] = useState(false);
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [facilitatorClock, setFacilitatorClock] = useState(() => Date.now());
  const [collaborationUsers, setCollaborationUsers] = useState<UserActivitySummary[]>([]);
  const [showOutline, setShowOutline] = useState(true);
  const [showNavigator, setShowNavigator] = useState(true);
  const [compactToolbar, setCompactToolbar] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [outlineRenderLimit, setOutlineRenderLimit] = useState(WHITEBOARD_OUTLINE_BATCH);
  const [outlineLabelFilter, setOutlineLabelFilter] = useState("");
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => typeof window !== "undefined" && readPreferenceStorage("cluster-whiteboard-autosave") !== "false");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveInFlightRef = useRef(false);
  const workingCopyBaselineRef = useRef<{
    name: string; description: string; projectId: string; canvasWidth: number; canvasHeight: number; backgroundColor: string; gridColor: string; gridStyle: string;
    elements: WhiteboardElement[]; categories: WhiteboardCategory[]; labels: WhiteboardLabel[]; productionLinks: Record<string, WhiteboardProductionRecord>; signature: string;
  } | null>(null);
  const whiteboardCollaboration = useToolCollaboration("whiteboard", activeWhiteboard?.id || selectedWhiteboardId || null, whiteboardProjectId || null);
  const whiteboardHasQueuedSync = whiteboardCollaboration.queuedMutations.some((mutation) => mutation.status === "pending" || mutation.status === "replaying" || mutation.status === "paused");
  const [componentLibrary, setComponentLibrary, componentSync] = useProjectWorkflowList<WhiteboardComponentRecord>("whiteboardComponent", whiteboardProjectId || "");
  const [componentQuery, setComponentQuery] = useState("");
  const [componentCategoryFilter, setComponentCategoryFilter] = useState("");
  const lastWhiteboardChangeRef = useRef<{
    resourceId: string;
    sequence: number;
  }>({ resourceId: "", sequence: 0 });
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const activeWhiteboardProject = projectById.get(whiteboardProjectId) || null;
  const savedWhiteboardView = useMemo<Record<string, string>>(() => ({
    zoom: String(zoom),
    outline: showOutline ? "1" : "0",
    navigator: showNavigator ? "1" : "0",
    layers: showCategories ? "1" : "0",
    grid: showGrid ? "1" : "0",
    snap: snapToGrid ? "1" : "0",
    compact: compactToolbar ? "1" : "0",
    layer: activeCategoryId || "",
    label: outlineLabelFilter || "",
    hiddenLayers: categories.filter((category) => category.hidden).map((category) => category.id).sort().join(","),
  }), [zoom, showOutline, showNavigator, showCategories, showGrid, snapToGrid, compactToolbar, activeCategoryId, outlineLabelFilter, categories]);
  const applyWhiteboardSavedView = useCallback((values: Record<string, string>) => {
    const parsedZoom = Number(values.zoom);
    if (Number.isFinite(parsedZoom)) setZoom(Math.max(0.25, Math.min(3, parsedZoom)));
    setShowOutline(values.outline !== "0");
    setShowNavigator(values.navigator !== "0");
    setShowCategories(values.layers !== "0");
    setShowGrid(values.grid !== "0");
    setSnapToGrid(values.snap === "1");
    setCompactToolbar(values.compact === "1");
    setActiveCategoryId(values.layer || "");
    setOutlineLabelFilter(values.label || "");
    const hiddenLayers = new Set((values.hiddenLayers || "").split(",").map((value) => value.trim()).filter(Boolean));
    setCategories((current) => current.map((category) => ({ ...category, hidden: hiddenLayers.has(category.id) })));
    setStatus("Applied saved whiteboard view.");
  }, []);
  useEffect(() => {
    if (!activeWhiteboardProject) { setCollaborationUsers([]); return; }
    queryApi<UserActivitySummary[]>("/api/users?limit=500", { staleMs: 30_000, maxAgeMs: 30 * 60 * 1000, tags: ["users", "whiteboard"] }).then(setCollaborationUsers).catch(() => setCollaborationUsers([]));
  }, [activeWhiteboardProject?.id]);
  useEffect(() => {
    const query = liveReferenceQuery.trim();
    const projectId = activeWhiteboardProject?.id || "";
    if (query.length < 2 || !projectId) {
      setLiveReferenceResults([]);
      setLiveReferenceError("");
      setLiveReferenceLoading(false);
      return;
    }
    const requestId = ++liveReferenceRequestRef.current;
    const timer = window.setTimeout(() => {
      setLiveReferenceLoading(true);
      setLiveReferenceError("");
      queryApi<CommandSearchPayload>(`/api/command/search?q=${encodeURIComponent(query)}&limit=24`, { force: true, persist: false, staleWhileRevalidate: false })
        .then((payload) => {
          if (requestId !== liveReferenceRequestRef.current) return;
          const results = (payload.results || []).filter((result) => {
            const resource = result.resource;
            if (!resource) return false;
            if (resource.kind === "whiteboard" && resource.id === activeWhiteboard?.id) return false;
            if (resource.kind === "user") return true;
            if (resource.kind === "project") return resource.id === projectId;
            if (resource.kind === "library" && !resource.projectId) return true;
            return resource.projectId === projectId;
          });
          setLiveReferenceResults(results.slice(0, 12));
          setLiveReferenceLoading(false);
        })
        .catch((error) => {
          if (requestId !== liveReferenceRequestRef.current) return;
          setLiveReferenceResults([]);
          setLiveReferenceLoading(false);
          setLiveReferenceError(error instanceof Error ? error.message : "Cluster could not search for live resources.");
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [liveReferenceQuery, activeWhiteboardProject?.id, activeWhiteboard?.id]);
  const whiteboardSwitcherItems = useMemo<ProjectResourceSwitcherItem[]>(() => whiteboards.map((item) => ({
    id: item.id,
    label: item.name,
    projectName: projectById.get(item.projectId || "")?.name || "No project",
    detail: item.description || null,
  })), [whiteboards, projectById]);
  const dirtySnapshot = useMemo<WhiteboardDirtySnapshot>(() => ({
    name: whiteboardName, description: whiteboardDescription, projectId: whiteboardProjectId, canvasWidth, canvasHeight, backgroundColor, gridColor, gridStyle, elements, categories, labels, productionLinks: productionMap,
  }), [whiteboardName, whiteboardDescription, whiteboardProjectId, canvasWidth, canvasHeight, backgroundColor, gridColor, gridStyle, elements, categories, labels, productionMap]);
  const deferredDirtySnapshot = useDeferredValue(dirtySnapshot);
  const pendingWhiteboardReview = useMemo(() => {
    if (!activeWhiteboard || !pendingRemote) return null;
    try {
      return reviewWhiteboardConflict(activeWhiteboard, {
        ...activeWhiteboard, ...dirtySnapshot,
        description: dirtySnapshot.description || null, projectId: dirtySnapshot.projectId || null,
        name: dirtySnapshot.name.trim() || "Untitled Whiteboard",
      }, pendingRemote);
    } catch {
      // Malformed/duplicate remote IDs are never guessed into a merge.
      // Preserve the local recovery route instead of crashing the editor.
      return null;
    }
  }, [activeWhiteboard, pendingRemote, dirtySnapshot]);
  useEffect(() => {
    // A new remote revision invalidates prior decisions. Never carry a stale
    // "keep mine" decision across another collaborator's next commit.
    setWhiteboardMergeChoices({});
  }, [pendingRemote?.id, pendingRemote?.operationSequence, pendingRemote?.revision]);
  const localWhiteboardDirty = useMemo(() => {
    if (!activeWhiteboard) return false;
    const baseline = workingCopyBaselineRef.current;
    if (!baseline) return true;
    const identityDirty = dirtySnapshot.name !== baseline.name
      || dirtySnapshot.description !== baseline.description
      || dirtySnapshot.projectId !== baseline.projectId
      || dirtySnapshot.canvasWidth !== baseline.canvasWidth
      || dirtySnapshot.canvasHeight !== baseline.canvasHeight
      || dirtySnapshot.backgroundColor !== baseline.backgroundColor
      || dirtySnapshot.gridColor !== baseline.gridColor
      || dirtySnapshot.gridStyle !== baseline.gridStyle
      || dirtySnapshot.elements !== baseline.elements
      || dirtySnapshot.categories !== baseline.categories
      || dirtySnapshot.labels !== baseline.labels
      || dirtySnapshot.productionLinks !== baseline.productionLinks;
    if (!identityDirty) return false;
    // During pointer interaction or a deferred transition, the cheap immutable-reference
    // check is enough. Once the UI settles, verify semantic equality exactly so undoing
    // back to the server state clears the dirty flag without serializing on every frame.
    if (interaction || deferredDirtySnapshot !== dirtySnapshot) return true;
    return whiteboardDocumentSignature(deferredDirtySnapshot) !== baseline.signature;
  }, [activeWhiteboard, dirtySnapshot, deferredDirtySnapshot, interaction]);
  const { confirmDiscard: confirmDiscardWhiteboard } = useUnsavedChangesGuard({
    dirty: localWhiteboardDirty,
    title: "Discard unsaved whiteboard changes?",
    message: "This whiteboard has unsaved local changes. Switch away and discard those edits?",
  });
  const whiteboardPresenceIndex = useMemo(() => buildWhiteboardPresenceIndex(whiteboardCollaboration.presence, whiteboardCollaboration.me?.id), [whiteboardCollaboration.presence, whiteboardCollaboration.me?.id]);
  const remoteWhiteboardPresence = whiteboardPresenceIndex.remote;
  function whiteboardDraftKey(id = activeWhiteboard?.id || selectedWhiteboardId || "") {
    return whiteboardRecoveryStorageKey(whiteboardCollaboration.me?.id, id);
  }
  function persistWhiteboardRecovery(id: string, draft: WhiteboardRecoveryDraft): boolean {
    const key = whiteboardDraftKey(id);
    if (!key) return false;
    writeLocalJson(key, draft);
    return true;
  }
  function clearWhiteboardRecovery(id: string) {
    const key = whiteboardDraftKey(id);
    if (key) window.localStorage.removeItem(key);
  }
  async function selectWhiteboardSafely(id: string | null) {
    if ((id || null) === (selectedWhiteboardId || null)) return;
    if (localWhiteboardDirty) {
      if (!await confirmDiscardWhiteboard()) return;
      clearWhiteboardRecovery(activeWhiteboard?.id || selectedWhiteboardId || "");
      setRecoveryDraft(null);
    }
    setReviewedMergeAwaitingSave(false);
    setWhiteboardMergeChoices({});
    onSelectWhiteboard(id);
  }
  function currentWhiteboardDraft(base = activeWhiteboard): Whiteboard | null {
    if (!base) return null;
    return {
      ...base,
      name: whiteboardName.trim() || "Untitled Whiteboard",
      description: whiteboardDescription || null,
      projectId: whiteboardProjectId || null,
      canvasWidth,
      canvasHeight,
      elements,
      categories,
      labels,
      productionLinks: productionMap,
      backgroundColor,
      gridColor,
      gridStyle,
    };
  }
  function applyWhiteboardWorkingCopy(remote: Whiteboard, baselineSource: Whiteboard = remote) {
    const nextElements = remote.elements || [];
    const nextCategories = remote.categories || [];
    const nextLabels = remote.labels?.length ? remote.labels : DEFAULT_WHITEBOARD_LABELS;
    const nextProductionLinks = remote.productionLinks || {};
    const sameBaseline = baselineSource === remote;
    const baselineElements = sameBaseline ? nextElements : (baselineSource.elements || []);
    const baselineCategories = sameBaseline ? nextCategories : (baselineSource.categories || []);
    const baselineLabels = sameBaseline ? nextLabels : (baselineSource.labels?.length ? baselineSource.labels : DEFAULT_WHITEBOARD_LABELS);
    const baselineProductionLinks = sameBaseline ? nextProductionLinks : (baselineSource.productionLinks || {});
    const baselineSnapshot: WhiteboardDirtySnapshot = {
      name: baselineSource.name,
      description: baselineSource.description || "",
      projectId: baselineSource.projectId || "",
      canvasWidth: baselineSource.canvasWidth || 1800,
      canvasHeight: baselineSource.canvasHeight || 950,
      backgroundColor: baselineSource.backgroundColor || "#f8fafc",
      gridColor: baselineSource.gridColor || "#cbd5e1",
      gridStyle: baselineSource.gridStyle || "lines",
      elements: baselineElements,
      categories: baselineCategories,
      labels: baselineLabels,
      productionLinks: baselineProductionLinks,
    };
    workingCopyBaselineRef.current = { ...baselineSnapshot, signature: whiteboardDocumentSignature(baselineSnapshot) };
    setElements(nextElements);
    setCategories(nextCategories);
    setLabels(nextLabels);
    setBackgroundColor(remote.backgroundColor || "#f8fafc");
    setGridColor(remote.gridColor || "#cbd5e1");
    setGridStyle(remote.gridStyle || "lines");
    setWhiteboardName(remote.name);
    setWhiteboardDescription(remote.description || "");
    setWhiteboardProjectId(remote.projectId || "");
    setProductionMap(nextProductionLinks);
    setCanvasWidth(remote.canvasWidth || 1800);
    setCanvasHeight(remote.canvasHeight || 950);
  }
  function applyRemoteWhiteboard(remote: Whiteboard, message = "Live update received.", resetOperationHistory = false) {
    setActiveWhiteboard(remote);
    applyWhiteboardWorkingCopy(remote);
    setPendingRemote(null);
    setWhiteboardMergeChoices({});
    setReviewedMergeAwaitingSave(false);
    if (resetOperationHistory) {
      setHistory([]);
      setRedoHistory([]);
      setSavedHistory([]);
    }
    setStatus(message);
  }
  function applyReviewedWhiteboardMerge() {
    if (!activeWhiteboard || !pendingRemote || !pendingWhiteboardReview) return;
    if (saveInFlightRef.current || interaction || whiteboardHasQueuedSync) {
      setStatus("Finish the current operation or queued sync before reviewing new Whiteboard history.");
      return;
    }
    const merged = pendingWhiteboardReview.resolve(whiteboardMergeChoices);
    if (!merged) { setStatus("Choose Keep mine or Use server for each overlapping change before applying the review."); return; }
    // Persist the resolved draft before altering the working baseline. This is
    // not a publish and must never be displayed as a server-committed change.
    const draft = { savedAt: new Date().toISOString(), whiteboard: merged, elements: merged.elements || [] };
    persistWhiteboardRecovery(activeWhiteboard.id, draft);
    if (!whiteboardDraftKey(activeWhiteboard.id)) {
      setStatus("Cannot preserve a private recovery copy until your user identity is available.");
      return;
    }
    setRecoveryDraft(draft);
    setActiveWhiteboard(pendingRemote);
    applyWhiteboardWorkingCopy(merged, pendingRemote);
    setPendingRemote(null);
    setWhiteboardMergeChoices({});
    setHistory([]);
    setRedoHistory([]);
    setSavedHistory([]);
    setReviewedMergeAwaitingSave(true);
    setStatus("Reviewed merge is saved locally only. Inspect it and choose Save reviewed merge to submit against the latest server sequence.");
  }
  async function checkForRemoteWhiteboard() {
    if (!activeWhiteboard?.id || interaction || saveInFlightRef.current) return;
    const feed = await api<WhiteboardOperationFeed>(`/api/whiteboards/${activeWhiteboard.id}/operations?after=${Number(activeWhiteboard.operationSequence || 0)}&limit=500`).catch(() => null);
    if (!feed) return;
    const feedPlan = planWhiteboardFeedSync(
      Number(activeWhiteboard.operationSequence || 0), Number(activeWhiteboard.revision || 1), feed,
    );
    if (feedPlan.action === "none") return;
    if (feedPlan.action === "refresh") {
      // A partial or reordered page must never be applied with currentSequence
      // set to the server's latest watermark: doing so loses skipped operations.
      const remote = await api<Whiteboard>(`/api/whiteboards/${activeWhiteboard.id}`, { headers: { "Cache-Control": "no-cache" } }).catch(() => null);
      if (!remote) {
        setStatus("Whiteboard operation history was incomplete. Server state could not be verified; local work remains untouched.");
        return;
      }
      if (localWhiteboardDirty) {
        setPendingRemote(remote);
        setStatus("Remote Whiteboard history changed beyond the available replay page. Your local edits are preserved; review the latest server copy before saving.");
        return;
      }
      applyRemoteWhiteboard(remote, "Whiteboard refreshed from verified server state after a missing, compacted or truncated operation feed.", true);
      return;
    }

    const remoteBase = {
      ...applyWhiteboardOperations(activeWhiteboard, feed.operations, feed.currentSequence, feed.revision),
      updatedAt: feed.updatedAt || activeWhiteboard.updatedAt,
    };
    if (!localWhiteboardDirty) {
      applyRemoteWhiteboard(remoteBase, `${feed.operations.length} live Whiteboard change${feed.operations.length === 1 ? "" : "s"} applied.`);
      return;
    }

    const draft = currentWhiteboardDraft(activeWhiteboard);
    if (!draft) return;
    const localOperations = buildWhiteboardOperations(activeWhiteboard, draft);
    const localTargets = new Set(localOperations.flatMap(whiteboardOperationTargets));
    const localDocumentWide = localTargets.has("$document");
    const overlapping = feed.operations.some((operation) => {
      const targets = whiteboardOperationTargets(operation);
      return localDocumentWide || targets.includes("$document") || targets.some((target) => localTargets.has(target));
    });
    if (overlapping) {
      const remote = await api<Whiteboard>(`/api/whiteboards/${activeWhiteboard.id}`).catch(() => remoteBase);
      setPendingRemote(remote);
      setStatus("Another collaborator changed an object you are editing. Local work was preserved for conflict review.");
      return;
    }

    const mergedDraft = applyWhiteboardOperations(remoteBase, localOperations, feed.currentSequence, feed.revision);
    const rebaseElementSnapshot = (snapshot: WhiteboardElement[]) => applyWhiteboardOperations({ ...activeWhiteboard, elements: snapshot }, feed.operations, feed.currentSequence, feed.revision).elements || [];
    setHistory((current) => current.map(rebaseElementSnapshot));
    setRedoHistory((current) => current.map(rebaseElementSnapshot));
    setActiveWhiteboard(remoteBase);
    applyWhiteboardWorkingCopy(mergedDraft, remoteBase);
    setStatus(`${feed.operations.length} remote change${feed.operations.length === 1 ? "" : "s"} merged without touching your local edits.`);
  }
  useEffect(() => {
    if (!activeWhiteboard?.id) return;
    if (lastWhiteboardChangeRef.current.resourceId !== activeWhiteboard.id) {
      lastWhiteboardChangeRef.current = {
        resourceId: activeWhiteboard.id,
        sequence: whiteboardCollaboration.changeSequence,
      };
      return;
    }
    if (!whiteboardCollaboration.changeSequence || whiteboardCollaboration.changeSequence <= lastWhiteboardChangeRef.current.sequence) return;
    lastWhiteboardChangeRef.current.sequence = whiteboardCollaboration.changeSequence;
    const timer = window.setTimeout(() => {
      checkForRemoteWhiteboard().catch(() => null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeWhiteboard?.id, activeWhiteboard?.updatedAt, whiteboardCollaboration.changeSequence, interaction, localWhiteboardDirty]);
  useVisibleRefresh(checkForRemoteWhiteboard, {
    enabled: Boolean(activeWhiteboard?.id) && whiteboardCollaboration.connection.transport !== "stream",
    intervalMs: 60_000,
  });
  useEffect(() => {
    if (!activeWhiteboard?.id || !localWhiteboardDirty) return;
    const timer = window.setTimeout(() => {
      const draft = {
        savedAt: new Date().toISOString(),
        whiteboard: {
          ...activeWhiteboard,
          name: whiteboardName,
          description: whiteboardDescription || null,
          projectId: whiteboardProjectId || null,
          canvasWidth,
          canvasHeight,
          categories,
          labels,
          backgroundColor,
          gridColor,
          gridStyle,
          productionLinks: productionMap,
        },
        elements,
        productionLinks: productionMap,
      };
      persistWhiteboardRecovery(activeWhiteboard.id, draft);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeWhiteboard?.id, whiteboardCollaboration.me?.id, localWhiteboardDirty, whiteboardName, whiteboardDescription, whiteboardProjectId, canvasWidth, canvasHeight, elements, categories, labels, productionMap, backgroundColor, gridColor, gridStyle]);
  useEffect(() => {
    const followed = followedUserId ? remoteWhiteboardPresence.find((item) => item.userId === followedUserId) : null;
    if (!followed?.cursor || !canvasWrapRef.current) return;
    const wrap = canvasWrapRef.current;
    wrap.scrollTo({
      left: Math.max(0, followed.cursor.x * zoom - wrap.clientWidth / 2),
      top: Math.max(0, followed.cursor.y * zoom - wrap.clientHeight / 2),
      behavior: "smooth",
    });
  }, [followedUserId, whiteboardPresenceIndex.cursorSignature, zoom]);
  useEffect(() => {
    document.body.classList.toggle("whiteboard-fullscreen-open-v069", isWhiteboardFullscreen);
    return () => document.body.classList.remove("whiteboard-fullscreen-open-v069");
  }, [isWhiteboardFullscreen]);
  useEffect(() => {
    setSelectedIds((current) => {
      if (!selectedId) return current.size ? new Set() : current;
      if (current.has(selectedId)) return current;
      return new Set([selectedId]);
    });
  }, [selectedId]);
  const elementById = useMemo(() => new Map(elements.map((element) => [element.id, element])), [elements]);
  const selectedElement = useMemo(() => selectedId ? elementById.get(selectedId) || null : null, [elementById, selectedId]);
  const selectedElements = useMemo(() => Array.from(selectedIds, (id) => elementById.get(id)).filter((element): element is WhiteboardElement => Boolean(element)), [elementById, selectedIds]);
  const selectedBounds = useMemo(() => whiteboardElementsBounds(selectedElements), [selectedElements]);
  const whiteboardSelectionAnchor = useMemo(() => {
    if (!selectedElements.length) return null;
    const firstLabel = getElementText(selectedElements[0]) || selectedElements[0].type;
    return {
      kind: "whiteboard-element-selection",
      ids: selectedElements.map((element) => element.id).sort(),
      label: selectedElements.length === 1 ? firstLabel : `${selectedElements.length} selected objects`,
      x: selectedBounds ? selectedBounds.x + selectedBounds.width / 2 : undefined,
      y: selectedBounds ? selectedBounds.y + selectedBounds.height / 2 : undefined,
    };
  }, [selectedElements, selectedBounds]);
  async function saveSelectionAsComponent() {
    if (!activeWhiteboardProject || !selectedBounds || !selectedElements.length || !whiteboardCollaboration.me?.id) {
      setStatus("Select one or more whiteboard items in a project before saving a component.");
      return;
    }
    if (componentLibrary.length >= 80) { setStatus("This project component library has reached its 80-component limit."); return; }
    const name = (await promptCluster({ title: "Save component", message: "Save the selected items as a reusable project component.", label: "Component name", initialValue: getElementText(selectedElements[0]) || "Reusable component", confirmLabel: "Save component" }))?.trim();
    if (!name) return;
    const normalized = selectedElements.map((element) => moveWhiteboardElement({ ...element }, -selectedBounds.x, -selectedBounds.y));
    const id = `whiteboard-component-${Date.now()}`;
    const tagNames = Array.from(new Set(selectedElements.flatMap((element) => (element.labelIds || []).map((labelId) => labels.find((label) => label.id === labelId)?.name).filter(Boolean) as string[]))).slice(0, 12);
    const categoryNames = Array.from(new Set(selectedElements.map((element) => element.categoryId ? categories.find((category) => category.id === element.categoryId)?.name : null).filter(Boolean) as string[]));
    setComponentLibrary((current) => [...current, { id, projectId: activeWhiteboardProject.id, name: name.slice(0, 120), elements: normalized, ownerId: whiteboardCollaboration.me!.id, sourceWhiteboardId: activeWhiteboard?.id || null, tags: tagNames, category: categoryNames.length === 1 ? categoryNames[0] : null, description: `${selectedElements.length} reusable whiteboard object${selectedElements.length === 1 ? "" : "s"}`, createdAt: new Date().toISOString() }]);
    setStatus(`Saved “${name}” to the project component library.`);
    await whiteboardCollaboration.publish("saved a reusable component", name, null, false);
  }
  function insertProjectComponent(component: WhiteboardComponentRecord) {
    if (!component.elements.length) return;
    pushHistory();
    const wrap = canvasWrapRef.current;
    const targetX = Math.max(40, ((wrap?.scrollLeft || 0) / Math.max(zoom, 0.1)) + 80);
    const targetY = Math.max(40, ((wrap?.scrollTop || 0) / Math.max(zoom, 0.1)) + 80);
    const groupMap = new Map<string, string>();
    const idMap = new Map(component.elements.map((element) => [element.id, makeWhiteboardId()]));
    const inserted = component.elements.map((element) => {
      const groupId = element.groupId ? (groupMap.get(element.groupId) || (() => { const id = `group-${makeWhiteboardId()}`; groupMap.set(element.groupId!, id); return id; })()) : null;
      const copied = { ...element, id: idMap.get(element.id)!, groupId } as WhiteboardElement;
      if (copied.type === "line" || copied.type === "arrow") {
        copied.fromId = copied.fromId ? idMap.get(copied.fromId) || null : null;
        copied.toId = copied.toId ? idMap.get(copied.toId) || null : null;
      }
      return moveWhiteboardElement(copied, targetX, targetY);
    });
    setElements((current) => reflowWhiteboardConnectors([...current, ...inserted]));
    setSelectedIds(new Set(inserted.map((item) => item.id)));
    setSelectedId(inserted[0]?.id || null);
    setStatus(`Inserted project component “${component.name}”.`);
    void whiteboardCollaboration.publish("inserted a reusable component", component.name, null, false);
  }
  function removeProjectComponent(component: WhiteboardComponentRecord) {
    if (component.ownerId !== whiteboardCollaboration.me?.id) { setStatus("Only the component owner can remove it from this project library."); return; }
    setComponentLibrary((current) => current.filter((item) => item.id !== component.id));
    setStatus(`Removed “${component.name}” from the project component library.`);
  }
  async function editProjectComponentMetadata(component: WhiteboardComponentRecord) {
    if (component.ownerId !== whiteboardCollaboration.me?.id) { setStatus("Only the component owner can edit its library metadata."); return; }
    const name = (await promptCluster({ title: "Edit component", message: "Rename this reusable project component.", label: "Component name", initialValue: component.name, confirmLabel: "Continue" }))?.trim();
    if (!name) return;
    const tagsValue = await promptCluster({ title: "Component tags", message: "Add comma-separated tags so the library stays searchable and reusable.", label: "Tags", initialValue: (component.tags || []).join(", "), confirmLabel: "Save metadata" });
    if (tagsValue === null || tagsValue === undefined) return;
    const tags = Array.from(new Set(tagsValue.split(",").map((value) => value.trim()).filter(Boolean))).slice(0, 12);
    const categoryValue = await promptCluster({ title: "Component category", message: "Use a category to keep larger project libraries organized.", label: "Category", initialValue: component.category || "", confirmLabel: "Save metadata" });
    if (categoryValue === null || categoryValue === undefined) return;
    const category = categoryValue.trim().slice(0, 80) || null;
    setComponentLibrary((current) => current.map((item) => item.id === component.id ? { ...item, name: name.slice(0, 120), tags, category, updatedAt: new Date().toISOString() } : item));
    setStatus(`Updated component “${name}”.`);
  }
  const selectionGroupIds = useMemo(() => Array.from(new Set(selectedElements.map((element) => element.groupId).filter(Boolean) as string[])), [selectedElements]);
  const hiddenCategoryIds = useMemo(() => new Set(categories.filter((category) => category.hidden).map((category) => category.id)), [categories]);
  const deferredElements = useDeferredValue(elements);
  const componentCategories = useMemo(() => Array.from(new Set(componentLibrary.map((component) => component.category?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [componentLibrary]);
  const filteredComponents = useMemo(() => {
    const term = componentQuery.trim().toLowerCase();
    return componentLibrary.filter((component) => {
      if (componentCategoryFilter && component.category !== componentCategoryFilter) return false;
      if (!term) return true;
      return [component.name, component.description, component.category, ...(component.tags || [])].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [componentLibrary, componentQuery, componentCategoryFilter]);
  const visibleElements = useMemo(() => elements.filter((element) => !element.categoryId || !hiddenCategoryIds.has(element.categoryId)), [elements, hiddenCategoryIds]);
  const deferredVisibleElements = useMemo(() => deferredElements.filter((element) => !element.categoryId || !hiddenCategoryIds.has(element.categoryId)), [deferredElements, hiddenCategoryIds]);
  const presentationFrames = useMemo(() => deferredVisibleElements.filter((element): element is WhiteboardShapeElement & { groupId?: string | null } => isShapeElement(element) && element.type === "frame").sort((left, right) => {
    const a = normalizeWhiteboardBox(left);
    const b = normalizeWhiteboardBox(right);
    return a.y - b.y || a.x - b.x;
  }), [deferredVisibleElements]);
  useEffect(() => {
    if (!presentationMode) return;
    if (!presentationFrames.length) { setPresentationMode(false); return; }
    setPresentationFrameIndex((current) => Math.max(0, Math.min(current, presentationFrames.length - 1)));
  }, [presentationMode, presentationFrames.length]);

  const sectionFrames = useMemo(() => presentationFrames.filter((frame) => Boolean(frame.section)), [presentationFrames]);
  const canvasViewport = useWhiteboardViewport(canvasWrapRef, zoom, canvasWidth, canvasHeight);
  const interactionElementId = interaction && interaction.mode !== "erase" ? interaction.id : null;
  const remoteSelectedElementIds = whiteboardPresenceIndex.selectedElementIds;
  const spatialIndex = useMemo(() => buildWhiteboardSpatialIndex(deferredVisibleElements), [deferredVisibleElements]);
  const renderedElements = useMemo(() => {
    const nearby = queryWhiteboardSpatialIndex(spatialIndex, canvasViewport, 160);
    const keep = new Map<string, WhiteboardElement>();
    for (const deferred of nearby) {
      const current = elementById.get(deferred.id);
      if (current && (!current.categoryId || !hiddenCategoryIds.has(current.categoryId))) keep.set(current.id, current);
    }
    for (const element of visibleElements) {
      const followsSelection = (element.type === "line" || element.type === "arrow")
        && ((element.fromId && selectedIds.has(element.fromId)) || (element.toId && selectedIds.has(element.toId)));
      if (selectedIds.has(element.id) || interactionElementId === element.id || remoteSelectedElementIds.has(element.id) || followsSelection) keep.set(element.id, element);
    }
    return Array.from(keep.values()).filter((element) =>
      selectedIds.has(element.id)
      || interactionElementId === element.id
      || remoteSelectedElementIds.has(element.id)
      || boundsIntersectWhiteboardViewport(whiteboardElementBounds(element), canvasViewport));
  }, [spatialIndex, elementById, hiddenCategoryIds, visibleElements, selectedIds, interactionElementId, remoteSelectedElementIds, canvasViewport]);
  const outlineElements = useMemo(() => buildWhiteboardOutline(deferredElements, hiddenCategoryIds, outlineQuery, outlineLabelFilter, WHITEBOARD_TOOL_META), [deferredElements, hiddenCategoryIds, outlineQuery, outlineLabelFilter]);
  const visibleOutlineElements = useMemo(() => outlineElements.slice(0, outlineRenderLimit), [outlineElements, outlineRenderLimit]);
  const hasMoreOutlineElements = visibleOutlineElements.length < outlineElements.length;
  useEffect(() => { setOutlineRenderLimit(WHITEBOARD_OUTLINE_BATCH); }, [outlineQuery, outlineLabelFilter, activeWhiteboard?.id]);
  const navigatorElements = useMemo(() => {
    if (deferredVisibleElements.length <= WHITEBOARD_NAVIGATOR_MAX) return deferredVisibleElements;
    const keep = new Map<string, WhiteboardElement>();
    for (const element of deferredVisibleElements) if (selectedIds.has(element.id) || remoteSelectedElementIds.has(element.id) || element.type === "frame") keep.set(element.id, element);
    const backgroundBudget = Math.max(0, WHITEBOARD_NAVIGATOR_MAX - keep.size);
    const stride = Math.max(1, Math.ceil(deferredVisibleElements.length / Math.max(1, backgroundBudget)));
    for (let index = 0, sampled = 0; index < deferredVisibleElements.length && sampled < backgroundBudget; index += stride) {
      const element = deferredVisibleElements[index];
      if (keep.has(element.id)) continue;
      keep.set(element.id, element);
      sampled += 1;
    }
    return Array.from(keep.values());
  }, [deferredVisibleElements, selectedIds, remoteSelectedElementIds]);
  const whiteboardStats = useMemo(() => {
    const groups = new Set<string>();
    let images = 0;
    for (const element of deferredElements) {
      if (element.groupId) groups.add(element.groupId);
      if (element.type === "image") images += 1;
    }
    return { groups: groups.size, images };
  }, [deferredElements]);
  const selectedProduction = selectedId ? productionMap[selectedId] || null : null;
  const productionListOptions = useMemo(() => projects.flatMap((project) => (project.boards || []).flatMap((board) => (board.lists || []).map((list) => ({ project, board, list })))), [projects]);
  const facilitatorSessionAction = useMemo(() => [...whiteboardCollaboration.actions].filter((action) => action.action === "started facilitating the whiteboard" || action.action === "ended the facilitated session").sort((left, right) => right.createdAt - left.createdAt)[0] || null, [whiteboardCollaboration.actions]);
  const facilitatorSessionActive = facilitatorMode || facilitatorSessionAction?.action === "started facilitating the whiteboard";
  const facilitatorTimerAction = useMemo(() => [...whiteboardCollaboration.actions].filter((action) => action.action === "started facilitator timer" || action.action === "stopped facilitator timer").sort((left, right) => right.createdAt - left.createdAt)[0] || null, [whiteboardCollaboration.actions]);
  const facilitatorTimerEnd = facilitatorTimerAction?.action === "started facilitator timer" && facilitatorTimerAction.detail ? Date.parse(facilitatorTimerAction.detail) : NaN;
  const facilitatorTimerRemaining = Number.isFinite(facilitatorTimerEnd) ? Math.max(0, facilitatorTimerEnd - facilitatorClock) : 0;
  const selectedVotes = useMemo(() => {
    if (!selectedId) return [] as string[];
    const latest = new Map<string, { action: string; createdAt: number }>();
    for (const action of whiteboardCollaboration.actions) {
      if ((action.action !== "voted on whiteboard item" && action.action !== "removed whiteboard vote") || action.entity?.entityId !== selectedId) continue;
      const previous = latest.get(action.userId);
      if (!previous || action.createdAt > previous.createdAt) latest.set(action.userId, { action: action.action, createdAt: action.createdAt });
    }
    return Array.from(latest.entries()).filter(([, value]) => value.action === "voted on whiteboard item").map(([userId]) => userId);
  }, [whiteboardCollaboration.actions, selectedId]);
  const currentUserVoted = Boolean(whiteboardCollaboration.me?.id && selectedVotes.includes(whiteboardCollaboration.me.id));
  useEffect(() => {
    if (!facilitatorTimerRemaining) return;
    const timer = window.setInterval(() => setFacilitatorClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [facilitatorTimerEnd, facilitatorTimerRemaining > 0]);
  function remoteElementEditor(elementId: string) {
    return whiteboardPresenceIndex.editorByElementId.get(elementId) || null;
  }
  const interactionEntityId = interaction && "id" in interaction ? interaction.id : null;
  useEffect(() => {
    const selection = selectedElement
      ? {
          entityType: "whiteboard-element",
          entityId: selectedElement.id,
          label: getElementText(selectedElement) || selectedElement.type,
        }
      : null;
    const editing = interactionEntityId && selectedElement?.id === interactionEntityId ? selection : null;
    whiteboardCollaboration.updatePresence(
      {
        activity: facilitatorMode ? (presentationMode ? `facilitating frame ${presentationFrameIndex + 1}` : "facilitating the whiteboard") : interaction ? `${interaction.mode === "move" ? "moving" : interaction.mode === "erase" ? "erasing" : "drawing"} on canvas` : selectedElement ? "inspecting an item" : `using ${WHITEBOARD_TOOL_META[tool]?.label || tool}`,
        selection,
        editing,
      },
      true,
    );
  }, [selectedId, interaction?.mode, interactionEntityId, tool, activeWhiteboard?.id, facilitatorMode, presentationMode, presentationFrameIndex]);
  function persistProductionMap(next: Record<string, WhiteboardProductionRecord>) {
    setProductionMap(next);
  }
  function updateSelectedProduction(patch: Partial<WhiteboardProductionRecord>) {
    if (!selectedId) return;
    const current = productionMap[selectedId] || {
      elementId: selectedId,
      reviewState: "draft" as const,
      updatedAt: new Date().toISOString(),
      comments: [],
    };
    persistProductionMap({
      ...productionMap,
      [selectedId]: {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  useEffect(() => {
    if (!selectedWhiteboardId && whiteboards[0]) {
      onSelectWhiteboard(whiteboards[0].id);
    }
  }, [selectedWhiteboardId, whiteboards, onSelectWhiteboard]);
  useEffect(() => {
    let cancelled = false;
    async function loadActive() {
      if (!selectedWhiteboardId) {
        setWhiteboardLoading(false);
        setWhiteboardLoadError(null);
        setActiveWhiteboard(null);
        setElements([]);
        setCategories([]);
        setLabels(DEFAULT_WHITEBOARD_LABELS);
        setBackgroundColor("#f8fafc");
        setGridColor("#cbd5e1");
        setGridStyle("lines");
        setWhiteboardName("Untitled Whiteboard");
        setWhiteboardDescription("");
        setWhiteboardProjectId(projects[0]?.id || "");
        setProductionMap({});
        setProductionTargetListId("");
        setRecoveryDraft(null);
        return;
      }
      setWhiteboardLoading(true);
      setWhiteboardLoadError(null);
      try {
        const resolved = await api<Whiteboard>(`/api/whiteboards/${selectedWhiteboardId}`);
        if (cancelled) return;
        setActiveWhiteboard(resolved);
        setWhiteboardName(resolved.name);
        setWhiteboardDescription(resolved.description || "");
        setWhiteboardProjectId(resolved.projectId || "");
        setElements(resolved.elements || []);
        setCategories(resolved.categories || []);
        setLabels(resolved.labels?.length ? resolved.labels : DEFAULT_WHITEBOARD_LABELS);
        setBackgroundColor(resolved.backgroundColor || "#f8fafc");
        setGridColor(resolved.gridColor || "#cbd5e1");
        setGridStyle(resolved.gridStyle || "lines");
        setCanvasWidth(resolved.canvasWidth || 1800);
        setCanvasHeight(resolved.canvasHeight || 950);
        setHistory([]);
        setRedoHistory([]);
        // Saved history is fetched by the active-id effect and must survive
        // refreshed workspace props. A full reload must not erase the controls.
        setSelectedId(null);
        setProductionMap(resolved.productionLinks || {});
        const firstList = projects.find((project) => project.id === (resolved.projectId || ""))?.boards?.[0]?.lists?.[0]?.id || productionListOptions[0]?.list.id || "";
        setProductionTargetListId(firstList);
        // Account-scoped recovery is loaded separately when authentication
        // has resolved, never from an unscoped key on a shared workstation.
        setRecoveryDraft(null);
        setStatus(`Loaded ${resolved.name}.`);
      } catch (error) {
        if (cancelled) return;
        setActiveWhiteboard(null);
        setWhiteboardLoadError(error);
        setStatus("Whiteboard could not be loaded.");
      } finally {
        if (!cancelled) setWhiteboardLoading(false);
      }
    }
    void loadActive();
    return () => { cancelled = true; };
  }, [selectedWhiteboardId, projects, whiteboardReloadNonce]);
  useEffect(() => {
    setRecoveryDraft(null);
    if (!activeWhiteboard?.id || activeWhiteboard.id !== selectedWhiteboardId) return;
    const key = whiteboardDraftKey(activeWhiteboard.id);
    if (!key) return;
    const draft = readLocalJson<WhiteboardRecoveryDraft | null>(key, null);
    if (draft?.whiteboard?.id !== activeWhiteboard.id || !draft.savedAt) return;
    if (new Date(draft.savedAt).getTime() > new Date(activeWhiteboard.updatedAt || 0).getTime()) {
      setRecoveryDraft(draft);
      setStatus(`Loaded ${activeWhiteboard.name}. Your private local recovery copy is available.`);
    }
  }, [activeWhiteboard?.id, activeWhiteboard?.updatedAt, selectedWhiteboardId, whiteboardCollaboration.me?.id]);
  useEffect(() => {
    let cancelled = false;
    setSavedHistory([]);
    if (selectedWhiteboardId) {
      void api<WhiteboardSavedHistoryResponse>(`/api/whiteboards/${encodeURIComponent(selectedWhiteboardId)}/history`, {
        headers: { "Cache-Control": "no-cache" },
      }).then((value) => { if (!cancelled) setSavedHistory(value.entries); }).catch(() => { if (!cancelled) setSavedHistory([]); });
    }
    return () => { cancelled = true; };
  }, [selectedWhiteboardId]);
  useEffect(() => {
    if (!selectedElement) return;
    if (selectedElement.type !== "path") setLabelText(getElementText(selectedElement) || labelText);
    setActiveCategoryId(selectedElement.categoryId || "");
    if ("stroke" in selectedElement) setStrokeColor(selectedElement.stroke || strokeColor);
    if (selectedElement.type === "path" || selectedElement.type === "line" || selectedElement.type === "arrow") {
      setStrokeWidth(selectedElement.strokeWidth || strokeWidth);
      setShapeOpacity(Math.round((selectedElement.opacity ?? 1) * 100));
      setDashedStroke(Boolean(selectedElement.dashed));
    }
    if (selectedElement.type === "text") setFontSize(selectedElement.fontSize || fontSize);
    if (selectedElement.type === "image") setShapeOpacity(Math.round((selectedElement.opacity ?? 1) * 100));
    if (selectedElement.type === "card") {
      setStrokeColor(selectedElement.accent);
      setFillColor(selectedElement.fill);
      setTextColor(selectedElement.textColor);
      setShapeOpacity(Math.round((selectedElement.opacity ?? 1) * 100));
    }
    if (isShapeElement(selectedElement)) {
      const shape = selectedElement;
      setFillColor(shape.fill === "transparent" ? fillColor : shape.fill);
      setFillEnabled(shape.fill !== "transparent");
      setTextColor(shape.textColor || textColor);
      setStrokeWidth(shape.strokeWidth || strokeWidth);
      setShapeOpacity(Math.round((shape.opacity ?? 1) * 100));
      setDashedStroke(Boolean(shape.dashed));
      setShapeShadow(Boolean(shape.shadow));
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  function pushHistory(snapshot = elements) {
    setHistory((prev) => appendWhiteboardHistory(prev, snapshot));
    setRedoHistory([]);
  }
  function snap(value: number) {
    return snapToGrid ? Math.round(value / gridSize) * gridSize : value;
  }
  function getPoint(event: React.PointerEvent<SVGSVGElement | SVGElement>, raw = false): WhiteboardPoint {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    const x = Math.round(transformed.x);
    const y = Math.round(transformed.y);
    const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : undefined;
    return raw ? { x, y, pressure } : { x: snap(x), y: snap(y), pressure };
  }
  function createElement(id: string, point: WhiteboardPoint): WhiteboardElement | null {
    if (tool === "pen")
      return {
        id,
        type: "path",
        points: [point],
        stroke: strokeColor,
        strokeWidth: point.pressure ? Math.max(1, strokeWidth * (0.65 + point.pressure * 0.9)) : strokeWidth,
        opacity: shapeOpacity / 100,
        dashed: dashedStroke,
        categoryId: activeCategoryId || null,
        labelIds: activeLabelId ? [activeLabelId] : [],
      };
    if (tool === "line" || tool === "arrow")
      return {
        id,
        type: tool,
        x1: point.x,
        y1: point.y,
        x2: point.x + 1,
        y2: point.y + 1,
        text: labelText,
        stroke: strokeColor,
        strokeWidth,
        opacity: shapeOpacity / 100,
        dashed: dashedStroke,
        categoryId: activeCategoryId || null,
        labelIds: activeLabelId ? [activeLabelId] : [],
      };
    if (WHITEBOARD_SHAPE_TOOLS.includes(tool)) {
      return {
        id,
        type: tool as WhiteboardShapeType,
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        text: labelText,
        stroke: strokeColor,
        strokeWidth,
        fill: fillEnabled ? fillColor : "transparent",
        textColor,
        opacity: shapeOpacity / 100,
        dashed: dashedStroke,
        shadow: shapeShadow,
        categoryId: activeCategoryId || null,
        labelIds: activeLabelId ? [activeLabelId] : [],
      };
    }
    if (tool === "card") {
      const [title, ...body] = (labelText || "New card").split("\n");
      return { id, type: "card", x: point.x, y: point.y, width: 280, height: 170, title: title || "New card", text: body.join("\n") || "Add context, references, or next steps.", accent: strokeColor, fill: fillEnabled ? fillColor : "#ffffff", textColor, opacity: shapeOpacity / 100, categoryId: activeCategoryId || null, labelIds: activeLabelId ? [activeLabelId] : [] };
    }
    if (tool === "text")
      return {
        id,
        type: "text",
        x: point.x,
        y: point.y,
        text: labelText || "Text",
        stroke: strokeColor,
        fontSize,
        categoryId: activeCategoryId || null,
        labelIds: activeLabelId ? [activeLabelId] : [],
      };
    return null;
  }
  function insertWhiteboardTemplate(template: import("./whiteboard-templates").WhiteboardTemplate) {
    pushHistory();
    const next = buildWhiteboardTemplate(template, elements.length * 24);
    setElements((prev) => [...prev, ...next]);
    setSelectedId(next[0]?.id || null);
    setStatus(`Inserted ${template} concept template.`);
  }
  function canvasInsertionPoint(): WhiteboardPoint {
    const wrap = canvasWrapRef.current;
    if (!wrap) return { x: 140, y: 140 };
    return { x: Math.max(20, Math.round((wrap.scrollLeft + wrap.clientWidth / 2) / zoom - 260)), y: Math.max(20, Math.round((wrap.scrollTop + wrap.clientHeight / 2) / zoom - 180)) };
  }
  function insertLiveReference(result: CommandSearchResult) {
    if (!result.resource) return;
    const point = canvasInsertionPoint();
    const reference: WhiteboardElement = {
      id: makeWhiteboardId(),
      type: "card",
      x: point.x,
      y: point.y,
      width: 340,
      height: 150,
      title: result.title || levelLabel(result.kind),
      text: result.detail || "Live Cluster resource",
      accent: strokeColor,
      fill: fillEnabled ? fillColor : "#f8fafc",
      textColor: fillEnabled ? textColor : "#0f172a",
      opacity: shapeOpacity / 100,
      categoryId: activeCategoryId || null,
      labelIds: activeLabelId ? [activeLabelId] : [],
      resource: result.resource,
      resourceKindLabel: levelLabel(result.kind),
      resourceStatus: result.status || null,
      resourceDetail: result.detail || null,
      resourceUpdatedAt: result.updatedAt || null,
    };
    pushHistory();
    setElements((current) => [...current, reference]);
    setSelectedIds(new Set([reference.id]));
    setSelectedId(reference.id);
    setTool("select");
    setLiveReferenceQuery("");
    setLiveReferenceResults([]);
    setStatus(`Placed live ${levelLabel(result.kind)} reference: ${result.title}.`);
  }
  function openWhiteboardElementResource(element: WhiteboardElement) {
    if (element.type !== "card" || !element.resource) return false;
    if (element.resourceKindLabel?.startsWith("Source ") && element.resource.projectId) {
      return openClusterWorkNavigation({ screen: "project", projectId: element.resource.projectId, projectTab: "source" });
    }
    return openClusterWorkNavigation(clusterResourceNavigation(element.resource));
  }
  function insertGeneratedDiagram(kind: "relationships" | "source") {
    if (!activeWhiteboardProject || diagramBusy) return;
    const projectId = activeWhiteboardProject.id;
    const origin = canvasInsertionPoint();
    setDiagramBusy(kind);
    setStatus(kind === "relationships" ? "Building relationship diagram…" : "Building Source Control diagram…");
    const request = kind === "relationships"
      ? queryApi<ProjectControlCenterPayload>(`/api/projects/${projectId}/control-center`, { staleMs: 2_000, maxAgeMs: 30_000, persist: false }).then((payload) => buildProjectRelationshipDiagram(payload, origin))
      : queryApi<WhiteboardSourceControlDiagramPayload>(`/api/projects/${projectId}/source-control`, { staleMs: 2_000, maxAgeMs: 30_000, persist: false }).then((payload) => buildSourceControlDiagram(payload, origin));
    void request.then((diagram) => {
      if (!diagram.elements.length) { setStatus("No project data is available for that diagram yet."); return; }
      pushHistory();
      setElements((current) => reflowWhiteboardConnectors([...current, ...diagram.elements]));
      setSelectedIds(new Set(diagram.elements.map((element) => element.id)));
      setSelectedId(diagram.elements[0]?.id || null);
      setTool("select");
      setStatus(`Inserted ${kind === "relationships" ? "project relationship" : "Source Control"} diagram${diagram.truncated ? " (trimmed to keep the canvas responsive)" : ""}.`);
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Cluster could not generate that diagram.");
    }).finally(() => setDiagramBusy(null));
  }
  function toggleFacilitatorMode() {
    const next = !facilitatorMode;
    setFacilitatorMode(next);
    setFollowedUserId(null);
    void whiteboardCollaboration.publish(next ? "started facilitating the whiteboard" : "ended the facilitated session", whiteboardName, null, false).catch(() => undefined);
    setStatus(next ? "Facilitator mode active. Collaborators can follow your cursor and presentation frames." : "Facilitator mode ended.");
  }
  function startFacilitatorTimer(minutes: number) {
    const endsAt = new Date(Date.now() + minutes * 60_000).toISOString();
    setFacilitatorClock(Date.now());
    void whiteboardCollaboration.publish("started facilitator timer", endsAt, null, false);
    setStatus(`Started a ${minutes}-minute facilitator timer.`);
  }
  function stopFacilitatorTimer() {
    void whiteboardCollaboration.publish("stopped facilitator timer", null, null, false);
    setFacilitatorClock(Date.now());
    setStatus("Stopped the facilitator timer.");
  }
  function toggleSelectedVote() {
    if (!selectedElement || !facilitatorSessionActive) return;
    const entity = { entityType: "whiteboard-element", entityId: selectedElement.id, label: getElementText(selectedElement) || selectedElement.type };
    void whiteboardCollaboration.publish(currentUserVoted ? "removed whiteboard vote" : "voted on whiteboard item", null, entity, false);
    setStatus(currentUserVoted ? "Removed your vote." : "Vote recorded for the selected item.");
  }
  function canvasPointFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return canvasInsertionPoint();
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: Math.max(0, Math.round(transformed.x)), y: Math.max(0, Math.round(transformed.y)) };
  }
  async function insertImageFile(file: File, position = canvasInsertionPoint()) {
    try {
      setStatus(`Optimizing ${file.name}…`);
      const imageElement = { ...(await createWhiteboardImageElement(file, position, activeCategoryId || null)), labelIds: activeLabelId ? [activeLabelId] : [] };
      pushHistory();
      setElements((previous) => [...previous, imageElement]);
      setSelectedId(imageElement.id);
      setTool("select");
      setStatus(`Placed ${file.name} on the whiteboard.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Image placement failed.");
    }
  }
  async function handleImageInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await insertImageFile(file);
  }
  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const category: WhiteboardCategory = { id: makeWhiteboardId(), name, color: newCategoryColor };
    setCategories((previous) => [...previous, category]);
    setActiveCategoryId(category.id);
    setNewCategoryName("");
    setStatus(`Created category ${name}.`);
  }
  function patchCategory(categoryId: string, patch: Partial<WhiteboardCategory>) {
    setCategories((previous) => previous.map((category) => category.id === categoryId ? { ...category, ...patch } : category));
  }
  async function renameCategory(category: WhiteboardCategory) {
    const name = (await promptCluster({ title: "Rename category", message: "Choose a new category name.", label: "Category name", initialValue: category.name, confirmLabel: "Rename" }))?.trim();
    if (name && name !== category.name) patchCategory(category.id, { name });
  }
  async function removeCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    const used = elements.filter((element) => element.categoryId === categoryId).length;
    if (used && !await confirmCluster({ title: "Remove category?", message: `Remove ${category?.name || "this category"}? ${used} object(s) will become Uncategorized.`, confirmLabel: "Remove category", tone: "danger" })) return;
    setCategories((previous) => previous.filter((item) => item.id !== categoryId));
    setElements((previous) => previous.map((element) => element.categoryId === categoryId ? { ...element, categoryId: null } : element));
    if (activeCategoryId === categoryId) setActiveCategoryId("");
  }
  function assignSelectedCategory(categoryId: string) {
    if (!selectedIds.size) { setActiveCategoryId(categoryId); return; }
    pushHistory();
    setElements((previous) => previous.map((element) => selectedIds.has(element.id) ? { ...element, categoryId: categoryId || null } : element));
    setActiveCategoryId(categoryId);
    setStatus(`Moved ${selectedIds.size} selected object${selectedIds.size === 1 ? "" : "s"} to ${categories.find((item) => item.id === categoryId)?.name || "Uncategorized"}.`);
  }
  function addWhiteboardLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    if (labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      setStatus("That whiteboard label already exists.");
      return;
    }
    const label: WhiteboardLabel = { id: `whiteboard-label-${Date.now()}`, name, color: newLabelColor };
    setLabels((current) => [...current, label]);
    setActiveLabelId(label.id);
    setNewLabelName("");
    setStatus(`Created label ${name}.`);
  }
  async function removeWhiteboardLabel(labelId: string) {
    const used = elements.filter((element) => (element.labelIds || []).includes(labelId)).length;
    if (used && !await confirmCluster({ title: "Remove label?", message: `Remove this label from ${used} object(s)?`, confirmLabel: "Remove label", tone: "danger" })) return;
    setLabels((current) => current.filter((label) => label.id !== labelId));
    setElements((current) => current.map((element) => ({ ...element, labelIds: (element.labelIds || []).filter((id) => id !== labelId) } as WhiteboardElement)));
    if (activeLabelId === labelId) setActiveLabelId("");
    if (outlineLabelFilter === labelId) setOutlineLabelFilter("");
  }
  function toggleSelectedLabel(labelId: string) {
    if (!selectedIds.size) {
      setActiveLabelId((current) => current === labelId ? "" : labelId);
      return;
    }
    const everySelectedHasLabel = selectedElements.every((element) => (element.labelIds || []).includes(labelId));
    pushHistory();
    setElements((current) => current.map((element) => {
      if (!selectedIds.has(element.id)) return element;
      const currentLabels = element.labelIds || [];
      return { ...element, labelIds: everySelectedHasLabel ? currentLabels.filter((id) => id !== labelId) : Array.from(new Set([...currentLabels, labelId])) } as WhiteboardElement;
    }));
  }
  function applyWhiteboardPalette(palette: typeof WHITEBOARD_PALETTES[number]) {
    setStrokeColor(palette.stroke);
    setFillColor(palette.fill);
    setTextColor(palette.text);
    setBackgroundColor(palette.background);
    setGridColor(palette.grid);
    setFillEnabled(true);
    if (selectedIds.size) {
      pushHistory();
      setElements((current) => current.map((element) => selectedIds.has(element.id) ? updateWhiteboardElementStyle(element, {
        stroke: palette.stroke,
        fill: palette.fill,
        fillEnabled: true,
        textColor: palette.text,
        strokeWidth,
        fontSize,
        labelText,
        opacity: shapeOpacity / 100,
        dashed: dashedStroke,
        shadow: shapeShadow,
      }) : element));
    }
    setStatus(`Applied ${palette.label} palette${selectedIds.size ? ` to ${selectedIds.size} selected object${selectedIds.size === 1 ? "" : "s"}` : ""}.`);
  }
  function toggleSelectedLock() {
    if (!selectedIds.size) return;
    const shouldLock = selectedElements.some((element) => !element.locked);
    pushHistory();
    setElements((previous) => previous.map((element) => selectedIds.has(element.id) ? { ...element, locked: shouldLock } : element));
    setStatus(`${shouldLock ? "Locked" : "Unlocked"} ${selectedIds.size} selected object${selectedIds.size === 1 ? "" : "s"}.`);
  }
  function resizeSelectionToDimension(dimension: "width" | "height", value: number) {
    if (!selectedBounds || !selectedElements.length) return;
    if (selectedElements.some((element) => element.locked)) { setStatus("Unlock the full selection before resizing it."); return; }
    const bounded = Math.max(24, Math.min(dimension === "width" ? canvasWidth : canvasHeight, Math.round(value)));
    const current = dimension === "width" ? selectedBounds.width : selectedBounds.height;
    if (Math.abs(current - bounded) < 1) return;
    pushHistory();
    setElements((previous) => resizeWhiteboardSelection(previous, selectedIds, selectedElements, dimension, bounded));
    setStatus(`Resized ${selectedElements.length} selected object${selectedElements.length === 1 ? "" : "s"} to ${Math.round(bounded)} px ${dimension}.`);
  }
  function nudgeSelectionBy(dx: number, dy: number) {
    if (!selectedElements.length || (!dx && !dy)) return;
    if (selectedElements.some((element) => element.locked)) { setStatus("Unlock the full selection before moving it."); return; }
    pushHistory();
    setElements((previous) => reflowWhiteboardConnectors(previous.map((element) => selectedIds.has(element.id) ? moveWhiteboardElement(element, dx, dy) : element)));
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    setStatus(`Moved ${selectedElements.length} selected object${selectedElements.length === 1 ? "" : "s"} ${distance} pixel${distance === 1 ? "" : "s"}.`);
  }

  function moveSelectionToCoordinate(axis: "x" | "y", value: number) {
    if (!selectedBounds || !selectedElements.length) return;
    if (selectedElements.some((element) => element.locked)) { setStatus("Unlock the full selection before changing its position."); return; }
    const current = axis === "x" ? selectedBounds.x : selectedBounds.y;
    const bounded = Math.max(0, Math.min(axis === "x" ? canvasWidth : canvasHeight, Math.round(value)));
    const delta = bounded - current;
    if (!delta) return;
    pushHistory();
    setElements((previous) => reflowWhiteboardConnectors(previous.map((element) => selectedIds.has(element.id) ? moveWhiteboardElement(element, axis === "x" ? delta : 0, axis === "y" ? delta : 0) : element)));
    setStatus(`Moved ${selectedElements.length} selected object${selectedElements.length === 1 ? "" : "s"} to ${axis.toUpperCase()} ${bounded}.`);
  }
  async function createWhiteboard() {
    const created = await api<Whiteboard>("/api/whiteboards", {
      method: "POST",
      body: JSON.stringify({
        name: whiteboardName.trim() || "Untitled Whiteboard",
        description: whiteboardDescription || null,
        projectId: whiteboardProjectId || null,
        elements: [],
        categories,
        labels,
        productionLinks: productionMap,
        backgroundColor,
        gridColor,
        gridStyle,
        canvasWidth,
        canvasHeight,
      }),
    });
    await onReloadWhiteboards();
    onSelectWhiteboard(created.id);
    setStatus("Whiteboard created.");
  }
  async function saveWhiteboard(options: { silent?: boolean } = {}) {
    if (saveInFlightRef.current) return;
    if (!activeWhiteboard) {
      await createWhiteboard();
      return;
    }
    if (pendingRemote) {
      setStatus("Remote changes require review. Preserve the local recovery copy or load the server version before saving.");
      return;
    }
    if (reviewedMergeAwaitingSave && typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("Reviewed conflict merges require a fresh online server commit. Your local recovery copy is preserved.");
      return;
    }
    if (whiteboardHasQueuedSync) {
      const draftWhiteboard = currentWhiteboardDraft(activeWhiteboard)!;
      const draft = { savedAt: new Date().toISOString(), whiteboard: draftWhiteboard, elements };
      const recoveryStored = persistWhiteboardRecovery(activeWhiteboard.id, draft);
      if (recoveryStored) setRecoveryDraft(draft);
      if (!options.silent) setStatus(recoveryStored
        ? "An earlier Whiteboard operation batch is already queued. Newer edits are preserved locally until ordered replay catches up."
        : "An earlier Whiteboard operation is queued, but private recovery storage is unavailable until your identity resolves. Keep this editor open.");
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    const baseWhiteboard = activeWhiteboard;
    const draftWhiteboard = currentWhiteboardDraft(baseWhiteboard)!;
    const draft = {
      savedAt: new Date().toISOString(),
      whiteboard: draftWhiteboard,
      elements,
    };
    const recoveryStored = persistWhiteboardRecovery(activeWhiteboard.id, draft);
    if (recoveryStored) setRecoveryDraft(draft);
    try {
      const operations = buildWhiteboardOperations(baseWhiteboard, draftWhiteboard);
      if (!operations.length) {
        setRecoveryDraft(null);
        clearWhiteboardRecovery(activeWhiteboard.id);
        setLastSavedAt(new Date().toISOString());
        setReviewedMergeAwaitingSave(false);
        if (!options.silent) setStatus("Whiteboard is already synced.");
        return;
      }
      const operationPath = `/api/whiteboards/${encodeURIComponent(activeWhiteboard.id)}/operations`;
      const operationBody = {
        clientId: whiteboardCollaboration.clientId,
        baseSequence: Number(baseWhiteboard.operationSequence || 0),
        operations,
      };
      // A deliberately reviewed merge must not fall back to offline mutation
      // queuing; an old review is only valid against the exact server sequence.
      const result = reviewedMergeAwaitingSave
        ? { queued: false, result: await api<WhiteboardOperationBatchResult>(operationPath, {
          method: "POST", body: JSON.stringify(operationBody), headers: { "Cache-Control": "no-cache" },
        }) }
        : await whiteboardCollaboration.mutate<WhiteboardOperationBatchResult>({
          path: operationPath,
          method: "POST",
          body: operationBody,
          label: `Sync ${operations.length} Whiteboard change${operations.length === 1 ? "" : "s"}`,
          entityType: "whiteboard",
          entityId: activeWhiteboard.id,
        });
      if (result.queued) {
        setLastSavedAt(new Date().toISOString());
        if (!options.silent) setStatus(`${operations.length} Whiteboard change${operations.length === 1 ? "" : "s"} queued locally for ordered replay.`);
        return;
      }
      const saved = (result.result as WhiteboardOperationBatchResult).whiteboard;
      // Saved undo is server-owned. Never reconstruct a whole-board inverse from a
      // stale client snapshot; only the authoritative operation history may reverse it.
      void refreshWhiteboardSavedHistory(saved.id);
      setHistory([]);
      setRedoHistory([]);
      setActiveWhiteboard(saved);
      applyWhiteboardWorkingCopy(saved);
      setPendingRemote(null);
      setReviewedMergeAwaitingSave(false);
      setRecoveryDraft(null);
      clearWhiteboardRecovery(activeWhiteboard.id);
      await whiteboardCollaboration.publish("synced whiteboard changes", `${operations.length} operation${operations.length === 1 ? "" : "s"} · ${elements.length} elements`, null, false);
      await onReloadWhiteboards();
      setLastSavedAt(new Date().toISOString());
      setStatus(options.silent ? `Whiteboard autosaved ${operations.length} change${operations.length === 1 ? "" : "s"}.` : `Whiteboard synced ${operations.length} granular change${operations.length === 1 ? "" : "s"}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const remote = await api<Whiteboard>(`/api/whiteboards/${activeWhiteboard.id}`).catch(() => null);
        if (remote) setPendingRemote(remote);
        setStatus("A collaborator changed the same Whiteboard object before your save completed. Local work is preserved for conflict review.");
        return;
      }
      setStatus(whiteboardDraftKey(activeWhiteboard.id)
        ? `Server save failed. A private local recovery draft was kept${navigator.onLine ? "." : " while offline."}`
        : "Server save failed. Local recovery storage is unavailable without an authenticated identity; keep this editor open.");
      if (!options.silent) throw error;
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }
  useEffect(() => {
    writePreferenceStorage("cluster-whiteboard-autosave", String(autoSaveEnabled));
  }, [autoSaveEnabled]);
  useEffect(() => {
    if (!autoSaveEnabled || !activeWhiteboard || !localWhiteboardDirty || reviewedMergeAwaitingSave || interaction || pendingRemote || saveInFlightRef.current || whiteboardHasQueuedSync) return;
    const timer = window.setTimeout(() => {
      void saveWhiteboard({ silent: true });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, activeWhiteboard?.id, localWhiteboardDirty, reviewedMergeAwaitingSave, interaction, pendingRemote, whiteboardHasQueuedSync, whiteboardName, whiteboardDescription, whiteboardProjectId, canvasWidth, canvasHeight, elements, categories, labels, productionMap, backgroundColor, gridColor, gridStyle]);

  async function duplicateWhiteboard() {
    const created = await api<Whiteboard>("/api/whiteboards", {
      method: "POST",
      body: JSON.stringify({
        name: `${whiteboardName || "Whiteboard"} Copy`,
        description: whiteboardDescription || null,
        projectId: whiteboardProjectId || null,
        elements,
        categories,
        labels,
        productionLinks: productionMap,
        backgroundColor,
        gridColor,
        gridStyle,
        canvasWidth,
        canvasHeight,
      }),
    });
    await onReloadWhiteboards();
    onSelectWhiteboard(created.id);
    setStatus("Whiteboard duplicated.");
  }
  async function deleteWhiteboard() {
    if (!activeWhiteboard) return;
    if (!await confirmCluster({ title: "Delete whiteboard?", message: `Delete whiteboard "${activeWhiteboard.name}"?`, confirmLabel: "Delete whiteboard", tone: "danger" })) return;
    await api(`/api/whiteboards/${activeWhiteboard.id}`, { method: "DELETE" });
    const next = whiteboards.find((item) => item.id !== activeWhiteboard.id) || null;
    setActiveWhiteboard(null);
    setElements([]);
    setCategories([]);
    setLabels(DEFAULT_WHITEBOARD_LABELS);
    setBackgroundColor("#f8fafc");
    setGridColor("#cbd5e1");
    setGridStyle("lines");
    onSelectWhiteboard(next?.id || null);
    await onReloadWhiteboards();
    setStatus("Whiteboard deleted.");
  }
  function applyProductionTemplate() {
    const baseX = 120 + elements.length * 12;
    const templates: Record<typeof productionTemplate, WhiteboardElement[]> = {
      feature: [flowTemplateElement("frame", baseX, 90, 760, 360, "Feature production map", "#2563eb", "rgba(37,99,235,0.05)"), flowTemplateElement("sticky", baseX + 50, 170, 190, 90, "Design note", "#2563eb", "#dbeafe"), flowTemplateElement("process", baseX + 300, 170, 190, 90, "Implementation card", "#7c3aed", "#f3e8ff"), flowTemplateElement("diamond", baseX + 560, 160, 160, 110, "Review?", "#f97316", "#ffedd5"), flowTemplateArrow(baseX + 240, 215, baseX + 300, 215), flowTemplateArrow(baseX + 490, 215, baseX + 560, 215)],
      qa: [flowTemplateElement("frame", baseX, 90, 760, 380, "QA report flow", "#ef4444", "rgba(239,68,68,0.05)"), flowTemplateElement("sticky", baseX + 60, 165, 210, 100, "Observed issue", "#ef4444", "#fee2e2"), flowTemplateElement("process", baseX + 330, 170, 190, 90, "Repro steps", "#f97316", "#ffedd5"), flowTemplateElement("process", baseX + 585, 170, 150, 90, "Fix card", "#16a34a", "#dcfce7"), flowTemplateArrow(baseX + 270, 215, baseX + 330, 215), flowTemplateArrow(baseX + 520, 215, baseX + 585, 215)],
      milestone: [flowTemplateElement("swimlane", baseX, 120, 900, 330, "Milestone slice", "#7c3aed", "rgba(124,58,237,0.05)"), flowTemplateElement("process", baseX + 70, 220, 180, 80, "Scope lock", "#2563eb", "#dbeafe"), flowTemplateElement("process", baseX + 350, 220, 180, 80, "Content pass", "#f97316", "#ffedd5"), flowTemplateElement("process", baseX + 630, 220, 180, 80, "Sign-off", "#16a34a", "#dcfce7"), flowTemplateArrow(baseX + 250, 260, baseX + 350, 260), flowTemplateArrow(baseX + 530, 260, baseX + 630, 260)],
      review: [flowTemplateElement("frame", baseX, 100, 720, 330, "Review board", "#0f172a", "rgba(15,23,42,0.05)"), flowTemplateElement("sticky", baseX + 55, 180, 180, 92, "Needs update", "#f97316", "#ffedd5"), flowTemplateElement("sticky", baseX + 275, 180, 180, 92, "In review", "#2563eb", "#dbeafe"), flowTemplateElement("sticky", baseX + 495, 180, 180, 92, "Approved", "#16a34a", "#dcfce7")],
    };
    pushHistory();
    setElements((prev) => [...prev, ...templates[productionTemplate]]);
    setStatus(`Inserted ${productionTemplate} production template.`);
  }
  async function convertSelectedToCard() {
    if (!selectedElement || selectedElement.type === "path") {
      setStatus("Select a sticky, shape, or text item before converting it to a card.");
      return;
    }
    if (!productionTargetListId) {
      setStatus("Pick a target board list first.");
      return;
    }
    const title = getElementText(selectedElement).trim() || `${whiteboardName} note`;
    const card = await api<Card>("/api/cards", {
      method: "POST",
      body: JSON.stringify({
        listId: productionTargetListId,
        title,
        description: `Created from whiteboard "${whiteboardName}". Element ${selectedElement.id}.`,
        priority: "medium",
        labels: ["whiteboard", "planning"],
      }),
    });
    const target = productionListOptions.find((option) => option.list.id === productionTargetListId);
    const sourceBounds = whiteboardElementBounds(selectedElement);
    const reference: WhiteboardElement = {
      id: makeWhiteboardId(),
      type: "card",
      x: sourceBounds.x + sourceBounds.width + 120,
      y: sourceBounds.y,
      width: 340,
      height: 150,
      title: card.title,
      text: `Live Card reference\n${target ? `${target.board.name} · ${target.list.title}` : "Created from whiteboard"}`,
      accent: "#2563eb",
      fill: "#f8fafc",
      textColor: "#0f172a",
      resource: { kind: "card", id: card.id, projectId: target?.project.id || activeWhiteboardProject?.id || null },
      resourceKindLabel: "Card",
      resourceStatus: "created",
      resourceDetail: target ? `${target.project.name} · ${target.board.name} · ${target.list.title}` : "Created from whiteboard",
      resourceUpdatedAt: new Date().toISOString(),
    };
    const connector: WhiteboardElement = {
      id: makeWhiteboardId(),
      type: "arrow",
      x1: sourceBounds.x + sourceBounds.width,
      y1: sourceBounds.y + sourceBounds.height / 2,
      x2: reference.x,
      y2: reference.y + reference.height / 2,
      text: "converted to",
      stroke: "#2563eb",
      strokeWidth: 2,
      fromId: selectedElement.id,
      toId: reference.id,
    };
    pushHistory();
    setElements((current) => reflowWhiteboardConnectors([...current, reference, connector]));
    updateSelectedProduction({ reviewState: "in-review" });
    setSelectedIds(new Set([reference.id]));
    setSelectedId(reference.id);
    setStatus(`Created Card and placed a live reference: ${card.title}.`);
  }
  function addSelectedProductionComment() {
    if (!selectedId || !productionComment.trim()) return;
    const current = productionMap[selectedId] || {
      elementId: selectedId,
      reviewState: "draft" as const,
      updatedAt: new Date().toISOString(),
      comments: [],
    };
    const comment: LocalComment = {
      id: localId("wb-comment"),
      scope: `whiteboard:${activeWhiteboard?.id || "draft"}:${selectedId}`,
      body: productionComment.trim(),
      author: "Cluster user",
      createdAt: new Date().toISOString(),
    };
    persistProductionMap({
      ...productionMap,
      [selectedId]: {
        ...current,
        comments: [comment, ...(current.comments || [])].slice(0, 30),
        updatedAt: new Date().toISOString(),
      },
    });
    setProductionComment("");
    setStatus("Whiteboard item comment added.");
  }
  function exportWhiteboardSnapshot() {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      whiteboard: {
        id: activeWhiteboard?.id || null,
        name: whiteboardName,
        projectId: whiteboardProjectId || null,
        canvasWidth,
        canvasHeight,
        backgroundColor,
        gridColor,
        gridStyle,
      },
      labels,
      elementCount: elements.length,
      categories,
      productionLinks: Object.values(productionMap),
      elements,
    };
    downloadJsonFile(
      `${
        whiteboardName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "whiteboard"
      }-snapshot.json`,
      snapshot,
    );
    if (svgRef.current) {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(svgBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${
        whiteboardName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "whiteboard"
      }-snapshot.svg`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setStatus("Exported whiteboard snapshot JSON and SVG.");
  }
  function selectWhiteboardElement(element: WhiteboardElement, additive = false) {
    const groupMembers = !additive && element.groupId ? elements.filter((item) => item.groupId === element.groupId) : [element];
    if (!additive) {
      setSelectedIds(new Set(groupMembers.map((item) => item.id)));
      setSelectedId(element.id);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(element.id)) next.delete(element.id); else next.add(element.id);
      const nextPrimary = next.has(element.id) ? element.id : Array.from(next)[next.size - 1] || null;
      setSelectedId(nextPrimary);
      return next;
    });
  }
  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !activeWhiteboard) return;
    if (tool === "select" && mobileTouchNavigation.pointerDown(event)) return;
    if (tool !== "select") event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = getPoint(event, tool === "eraser");
    if (tool === "select") {
      setSelectedId(null);
      return;
    }
    if (tool === "eraser") {
      pushHistory();
      setSelectedId(null);
      setEraserCursor(point);
      setElements((prev) => eraseWhiteboardElementsAt(prev, point, eraserSize));
      setInteraction({ mode: "erase" });
      return;
    }
    const id = makeWhiteboardId();
    const element = createElement(id, point);
    if (!element) return;
    pushHistory();
    setSelectedId(id);
    setElements((prev) => [...prev, element]);
    if (tool !== "text" && tool !== "card") setInteraction({ mode: "create", id, start: point });
  }
  function handleElementPointerDown(event: React.PointerEvent<SVGElement>, element: WhiteboardElement) {
    event.stopPropagation();
    if (event.pointerType === "touch" || event.pointerType === "pen") { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); }
    const editor = remoteElementEditor(element.id);
    if (editor && tool !== "eraser") {
      setStatus(`${editor.userName} is currently editing this item. Their live edit has a temporary soft lock.`);
      return;
    }
    const point = getPoint(event, tool === "eraser");
    if (tool === "eraser") {
      pushHistory();
      setElements((prev) => eraseWhiteboardElementsAt(prev, point, eraserSize));
      setSelectedId(null);
      setEraserCursor(point);
      setInteraction({ mode: "erase" });
      setStatus("Erased the selected area.");
      return;
    }
    if (tool === "select") {
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      if (additive) {
        selectWhiteboardElement(element, true);
        setStatus("Updated multi-selection.");
        return;
      }
      const moveSelection = element.groupId
        ? elements.filter((item) => item.groupId === element.groupId)
        : selectedIds.has(element.id) && selectedIds.size > 1
          ? selectedElements
          : [element];
      selectWhiteboardElement(element, false);
      if (moveSelection.some((item) => item.locked)) { setStatus("Unlock the selected item or group before moving it."); return; }
      pushHistory();
      setInteraction({
        mode: "move",
        id: element.id,
        start: point,
        original: element,
        originals: moveSelection.map((item) => ({ ...item })),
      });
    }
  }
  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (tool === "select" && mobileTouchNavigation.pointerMove(event)) return;
    const point = getPoint(event, tool === "eraser");
    const wrap = canvasWrapRef.current;
    whiteboardCollaboration.updatePresence(
      {
        cursor: point,
        viewport: wrap ? { x: wrap.scrollLeft / zoom, y: wrap.scrollTop / zoom, zoom } : null,
      },
      false,
    );
    if (tool === "eraser") setEraserCursor(point);
    if (!interaction) return;
    if (interaction.mode === "erase") {
      setElements((prev) => eraseWhiteboardElementsAt(prev, point, eraserSize));
      return;
    }
    if (interaction.mode === "move") {
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      const originals = interaction.originals?.length ? interaction.originals : [interaction.original];
      const originalById = new Map(originals.map((item) => [item.id, item]));
      setElements((prev) => reflowWhiteboardConnectors(prev.map((element) => {
        const original = originalById.get(element.id);
        return original ? moveWhiteboardElement(original, dx, dy) : element;
      })));
      return;
    }
    setElements((prev) => reflowWhiteboardConnectors(
      prev.map((element) => {
        if (element.id !== interaction.id) return element;
        if (element.type === "path") return { ...element, points: [...element.points, point] };
        if (element.type === "line" || element.type === "arrow") return { ...element, x2: point.x, y2: point.y };
        if (isShapeElement(element))
          return {
            ...element,
            width: point.x - element.x,
            height: point.y - element.y,
          };
        return element;
      }),
    ));
  }
  function stopDrawing() {
    const completed = interaction;
    setInteraction(null);
    if (completed)
      whiteboardCollaboration
        .publish(
          completed.mode === "move" ? "moved an item" : completed.mode === "erase" ? "erased canvas content" : "edited the canvas",
          selectedElement ? getElementText(selectedElement) || selectedElement.type : null,
          selectedElement
            ? {
                entityType: "whiteboard-element",
                entityId: selectedElement.id,
                label: getElementText(selectedElement) || selectedElement.type,
              }
            : null,
          false,
        )
        .catch(() => null);
  }
  function handleCanvasLeave() {
    setInteraction(null);
    setEraserCursor(null);
    whiteboardCollaboration.updatePresence({ cursor: null, editing: null }, true);
  }
  function deleteSelected() {
    if (!selectedIds.size) return;
    const lockedCount = selectedElements.filter((element) => element.locked).length;
    if (lockedCount) { setStatus(`Unlock ${lockedCount} selected object${lockedCount === 1 ? "" : "s"} before deleting the selection.`); return; }
    pushHistory();
    setElements((previous) => removeWhiteboardSelection(previous, selectedIds));
    setProductionMap((current) => Object.fromEntries(Object.entries(current).filter(([elementId]) => !selectedIds.has(elementId))));
    const count = selectedIds.size;
    setSelectedIds(new Set());
    setSelectedId(null);
    setStatus(`Deleted ${count} selected whiteboard object${count === 1 ? "" : "s"}.`);
    setRecoverableEdit(`Deleted ${count} object${count === 1 ? "" : "s"}.`);
  }
  function duplicateSelected() {
    if (!selectedElements.length) return;
    pushHistory();
    const copies = duplicateWhiteboardSelection(selectedElements);
    setElements((previous) => reflowWhiteboardConnectors([...previous, ...copies]));
    setSelectedIds(new Set(copies.map((item) => item.id)));
    setSelectedId(copies[copies.length - 1]?.id || null);
    setStatus(`Duplicated ${copies.length} selected object${copies.length === 1 ? "" : "s"}.`);
  }
  function groupSelected() {
    if (selectedElements.length < 2) { setStatus("Select at least two objects to create a group."); return; }
    pushHistory();
    setElements((current) => setWhiteboardSelectionGroup(current, selectedIds, `whiteboard-group-${Date.now()}`));
    setStatus(`Grouped ${selectedElements.length} objects. Selecting one group member now selects the group.`);
  }
  function ungroupSelected() {
    const groupIds = new Set(selectedElements.map((element) => element.groupId).filter(Boolean) as string[]);
    if (!groupIds.size) { setStatus("The current selection is not grouped."); return; }
    pushHistory();
    setElements((current) => setWhiteboardSelectionGroup(current, selectedIds, null, groupIds));
    setStatus(`Removed ${groupIds.size} group${groupIds.size === 1 ? "" : "s"} from the selection.`);
  }
  async function createSectionFromSelection() {
    if (!selectedElements.length) { setStatus("Select one or more objects before creating a section."); return; }
    const bounds = whiteboardElementsBounds(selectedElements);
    if (!bounds) return;
    const name = (await promptCluster({ title: "Create whiteboard section", message: "Sections are navigable frames around related whiteboard work.", label: "Section name", initialValue: `Section ${sectionFrames.length + 1}`, confirmLabel: "Create section" }))?.trim();
    if (!name) return;
    pushHistory();
    const frame: WhiteboardShapeElement = {
      id: makeWhiteboardId(), type: "frame", section: true,
      x: Math.max(0, bounds.x - 36), y: Math.max(0, bounds.y - 54), width: Math.max(180, bounds.width + 72), height: Math.max(140, bounds.height + 90),
      text: name.slice(0, 120), stroke: strokeColor, strokeWidth: Math.max(2, strokeWidth), fill: "transparent", textColor: strokeColor,
      opacity: 1, dashed: true, shadow: false, categoryId: activeCategoryId || null, labelIds: [], locked: false,
    };
    setElements((current) => [frame, ...current]);
    setSelectedIds(new Set([frame.id]));
    setSelectedId(frame.id);
    setStatus(`Created section “${frame.text}”.`);
  }
  function connectSelected() {
    const targets = selectedElements.filter((element) => element.type !== "line" && element.type !== "arrow");
    if (targets.length !== 2) { setStatus("Select exactly two non-connector objects to link them."); return; }
    pushHistory();
    const connector = createWhiteboardSelectionConnector(targets, { stroke: strokeColor, strokeWidth, opacity: shapeOpacity / 100, dashed: dashedStroke, categoryId: activeCategoryId, labelId: activeLabelId });
    setElements((current) => reflowWhiteboardConnectors([...current, connector]));
    setSelectedIds(new Set([connector.id]));
    setSelectedId(connector.id);
    setStatus(`Connected ${getElementText(targets[0]) || targets[0].type} to ${getElementText(targets[1]) || targets[1].type}.`);
  }
  function applySelectedStyle() {
    if (!selectedIds.size) return;
    pushHistory();
    setElements((previous) => applyWhiteboardSelectionStyle(previous, selectedIds, { stroke: strokeColor, fill: fillColor, fillEnabled, textColor, strokeWidth, fontSize, labelText, opacity: shapeOpacity / 100, dashed: dashedStroke, shadow: shapeShadow }));
    setStatus(`Updated ${selectedIds.size} selected object${selectedIds.size === 1 ? "" : "s"}.`);
  }
  function bringForward() {
    if (!selectedId) return;
    pushHistory();
    setElements((previous) => reorderWhiteboardElement(previous, selectedId, "forward"));
  }
  function sendBackward() {
    if (!selectedId) return;
    pushHistory();
    setElements((previous) => reorderWhiteboardElement(previous, selectedId, "backward"));
  }
  function alignSelected(mode: WhiteboardAlignment) {
    if (!selectedElements.length) return;
    pushHistory();
    setElements((previous) => alignWhiteboardSelection(previous, selectedIds, selectedElements, mode, canvasWidth, canvasHeight));
    setStatus(selectedElements.length > 1 ? `Aligned ${selectedElements.length} selected objects ${mode}.` : `Aligned selected item ${mode}.`);
  }
  function distributeSelected(axis: WhiteboardDistributionAxis) {
    const targets = selectedElements.filter((element) => element.type !== "line" && element.type !== "arrow");
    if (targets.length < 3) { setStatus("Select at least three objects to distribute spacing."); return; }
    pushHistory();
    setElements((current) => distributeWhiteboardSelection(current, selectedElements, axis));
    setStatus(`Distributed ${targets.length} objects ${axis === "horizontal" ? "horizontally" : "vertically"}.`);
  }
  function snapSelectedToGrid() {
    if (!selectedElements.length) return;
    pushHistory();
    setElements((previous) => snapWhiteboardSelectionToGrid(previous, selectedIds, gridSize));
    setStatus(`Snapped ${selectedElements.length} selected object${selectedElements.length === 1 ? "" : "s"} to the grid.`);
  }
  async function refreshWhiteboardSavedHistory(whiteboardId: string) {
    const result = await api<WhiteboardSavedHistoryResponse>(`/api/whiteboards/${encodeURIComponent(whiteboardId)}/history`, { headers: { "Cache-Control": "no-cache" } });
    if (selectedWhiteboardId === whiteboardId) setSavedHistory(result.entries);
  }
  async function replayWhiteboardHistory(entry: WhiteboardSavedHistoryEntry, direction: "undo" | "redo") {
    if (!activeWhiteboard || pendingRemote || saveInFlightRef.current) return false;
    if (localWhiteboardDirty) { setStatus(`Save or discard local edits before ${direction} of a saved Whiteboard change.`); return false; }
    if (whiteboardHasQueuedSync) { setStatus("Wait for queued Whiteboard changes before reversing saved history."); return false; }
    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      // Reversals are deliberately online-only and never replayed from an offline
      // queue, because permissions and the current target revision must be checked.
      const result = await api<{ ok: boolean; currentSequence: number; whiteboard: Whiteboard }>(
        `/api/whiteboards/${encodeURIComponent(activeWhiteboard.id)}/history/${encodeURIComponent(entry.id)}/${direction}`,
        { method: "POST", headers: { "Cache-Control": "no-cache" } },
      );
      setActiveWhiteboard(result.whiteboard);
      applyWhiteboardWorkingCopy(result.whiteboard);
      setPendingRemote(null);
      setHistory([]);
      setRedoHistory([]);
      setRecoveryDraft(null);
      clearWhiteboardRecovery(activeWhiteboard.id);
      setLastSavedAt(new Date().toISOString());
      await refreshWhiteboardSavedHistory(result.whiteboard.id);
      await whiteboardCollaboration.publish(`${direction} saved whiteboard edit`, entry.kind, null, false);
      await onReloadWhiteboards();
      setStatus(`${direction === "undo" ? "Undid" : "Redid"} your saved ${entry.kind.replace("element.", "")} operation.`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        await refreshWhiteboardSavedHistory(activeWhiteboard.id).catch(() => setSavedHistory([]));
        const remote = await api<Whiteboard>(`/api/whiteboards/${activeWhiteboard.id}`, { headers: { "Cache-Control": "no-cache" } }).catch(() => null);
        if (remote) setPendingRemote(remote);
        setStatus("Saved history cannot be reversed: it was superseded, changed by a collaborator, or is no longer authorized. Review the current Whiteboard.");
        return false;
      }
      setStatus(`Whiteboard saved ${direction} failed. No local replay was queued.`);
      throw error;
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }
  async function undo() {
    if (history.length) {
      const previous = history[history.length - 1];
      setRedoHistory((current) => appendWhiteboardHistory(current, elements));
      setHistory((current) => current.slice(0, -1));
      setElements(previous);
      setSelectedId(null);
      setStatus("Undid the last local Whiteboard action.");
      setRecoverableEdit(null);
      return;
    }
    const entry = savedHistory.find((item) => item.state === "applied");
    if (entry) await replayWhiteboardHistory(entry, "undo");
  }
  async function redo() {
    if (redoHistory.length) {
      const next = redoHistory[redoHistory.length - 1];
      setHistory((current) => appendWhiteboardHistory(current, elements));
      setRedoHistory((current) => current.slice(0, -1));
      setElements(next);
      setSelectedId(null);
      setStatus("Redid the last local Whiteboard action.");
      setRecoverableEdit(null);
      return;
    }
    const entry = savedHistory.find((item) => item.state === "undone");
    if (entry) await replayWhiteboardHistory(entry, "redo");
  }
  async function clearBoard() {
    if (!await confirmCluster({ title: "Clear whiteboard?", message: "Remove every object from this whiteboard? Save is still required to persist the change.", confirmLabel: "Clear whiteboard", tone: "danger" })) return;
    pushHistory();
    setElements([]);
    setSelectedId(null);
    setStatus("Whiteboard cleared. Save to keep the change.");
    setRecoverableEdit("Whiteboard cleared.");
  }
  function exportSvg() {
    if (!svgRef.current) return;
    const serialized = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([serialized], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${whiteboardName || "cluster-whiteboard"}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported SVG.");
  }
  function exportJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            name: whiteboardName,
            description: whiteboardDescription,
            elements,
            canvasWidth,
            canvasHeight,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${whiteboardName || "cluster-whiteboard"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported JSON.");
  }
  async function exportPng() {
    if (!svgRef.current) return;
    const serialized = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([serialized], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#f8fafc";
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      context.drawImage(image, 0, 0);
      const pngUrl = canvas.toDataURL("image/png");
      const anchor = document.createElement("a");
      anchor.href = pngUrl;
      anchor.download = `${whiteboardName || "cluster-whiteboard"}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("Exported PNG.");
    };
    image.src = url;
  }
  function focusCanvasBounds(bounds: { x: number; y: number; width: number; height: number }, padding = 140) {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const safeWidth = Math.max(1, bounds.width + padding * 2);
    const safeHeight = Math.max(1, bounds.height + padding * 2);
    const nextZoom = Math.max(0.35, Math.min(2.5, Math.min(wrap.clientWidth / safeWidth, wrap.clientHeight / safeHeight)));
    setZoom(Number(nextZoom.toFixed(2)));
    window.requestAnimationFrame(() => {
      wrap.scrollTo({
        left: Math.max(0, (bounds.x + bounds.width / 2) * nextZoom - wrap.clientWidth / 2),
        top: Math.max(0, (bounds.y + bounds.height / 2) * nextZoom - wrap.clientHeight / 2),
        behavior: "smooth",
      });
    });
  }
  function fitToContent() {
    const bounds = elements.length
      ? whiteboardContentBounds(visibleElements, canvasWidth, canvasHeight)
      : { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    focusCanvasBounds(bounds, elements.length ? 100 : 0);
    setStatus(elements.length ? "Fit canvas to whiteboard content." : "Fit the empty canvas to the workspace.");
  }
  function focusSelectedElement() {
    const bounds = whiteboardElementsBounds(selectedElements.length ? selectedElements : selectedElement ? [selectedElement] : []);
    if (!bounds) return;
    focusCanvasBounds(bounds, 220);
  }
  function focusPresentationFrame(index: number) {
    const frame = presentationFrames[index];
    if (!frame) return;
    setPresentationFrameIndex(index);
    setSelectedIds(new Set([frame.id]));
    setSelectedId(frame.id);
    focusCanvasBounds(whiteboardElementBounds(frame), 32);
    if (facilitatorMode) void whiteboardCollaboration.publish(`focused presentation frame ${index + 1}`, getElementText(frame) || `Frame ${index + 1}`, null, false).catch(() => undefined);
  }
  function startPresentation() {
    if (!presentationFrames.length) { setStatus("Add at least one Frame to use presentation mode."); return; }
    setPresentationMode(true);
    setPresentationFrameIndex(0);
    setShowOutline(false);
    setShowCategories(false);
    window.requestAnimationFrame(() => focusPresentationFrame(0));
    setStatus(`Presentation mode started with ${presentationFrames.length} frame${presentationFrames.length === 1 ? "" : "s"}.`);
  }
  function stopPresentation() {
    setPresentationMode(false);
    setStatus("Exited presentation mode.");
  }
  function handleNavigatorPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvasWidth;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvasHeight;
    wrap.scrollTo({
      left: Math.max(0, x * zoom - wrap.clientWidth / 2),
      top: Math.max(0, y * zoom - wrap.clientHeight / 2),
      behavior: "smooth",
    });
  }

  function zoomIn() {
    setZoom((value) => Math.min(2.5, Number((value + 0.1).toFixed(2))));
  }
  function zoomOut() {
    setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))));
  }
  function resetZoom() {
    setZoom(1);
  }
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const focus = whiteboardHistoryTargetContext(target);
      const isTyping = focus.editingText;
      // A different modal or workspace owns its own shortcuts and selection.
      if (focus.inDialog || !focus.inWorkspace) return;
      // Native field undo/redo must win inside editors and accessible textboxes.
      // Whiteboard history shortcuts are for the canvas, not someone's draft.
      if (isTyping && (event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) return;
      if (event.key === "Escape" && presentationMode) {
        event.preventDefault();
        stopPresentation();
        return;
      }
      if (event.key === "Escape" && isWhiteboardFullscreen) {
        event.preventDefault();
        setIsWhiteboardFullscreen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveWhiteboard().catch((err) => setStatus(err instanceof Error ? err.message : "Save failed."));
        return;
      }
      const historyDirection = whiteboardHistoryShortcut({
        key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, shiftKey: event.shiftKey, editingText: isTyping,
      });
      if (historyDirection) {
        event.preventDefault();
        if (historyDirection === "undo") void undo(); else void redo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        fitToContent();
        return;
      }
      if (isTyping) return;
      if (presentationMode && ["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        focusPresentationFrame(Math.min(presentationFrames.length - 1, presentationFrameIndex + 1));
        return;
      }
      if (presentationMode && ["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        focusPresentationFrame(Math.max(0, presentationFrameIndex - 1));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(new Set(visibleElements.map((element) => element.id)));
        setSelectedId(visibleElements[visibleElements.length - 1]?.id || null);
        setStatus(`Selected ${visibleElements.length} visible object${visibleElements.length === 1 ? "" : "s"}.`);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelected(); else groupSelected();
        return;
      }
      const nudge = selectedElements.length ? keyboardNudge(event.key, event.shiftKey) : null;
      if (selectedElements.length && nudge) {
        event.preventDefault();
        nudgeSelectionBy(nudge.dx, nudge.dy);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
        return;
      }
      const shortcuts: Record<string, WhiteboardTool> = {
        v: "select",
        p: "pen",
        l: "line",
        a: "arrow",
        r: "box",
        o: "ellipse",
        d: "diamond",
        n: "sticky",
        m: "process",
        u: "terminator",
        b: "database",
        c: "cloud",
        h: "actor",
        f: "frame",
        q: "callout",
        s: "swimlane",
        k: "card",
        t: "text",
        e: "eraser",
      };
      const nextTool = shortcuts[event.key.toLowerCase()];
      if (nextTool) {
        event.preventDefault();
        setTool(nextTool);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const image = Array.from(event.clipboardData?.files || []).find((file) => file.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      void insertImageFile(image);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeCategoryId, zoom, elements]);
  async function openWhiteboardResourceWindow(item: ProjectResourceSwitcherItem) {
    const target = whiteboards.find((candidate) => candidate.id === item.id);
    if (!target) return false;
    setWorkspaceWindowStatus(`Opening ${target.name}…`);
    try {
      const route = target.projectId ? `whiteboard/${target.projectId}/${target.id}` : `whiteboard/${target.id}`;
      const opened = await openDesktopWorkspaceWindow(route, `${target.name} · Whiteboard`);
      setWorkspaceWindowStatus(opened ? `${target.name} opened in a separate Cluster window.` : "Separate windows are available in Cluster Desktop.");
      return opened;
    } catch (error) {
      setWorkspaceWindowStatus(error instanceof Error ? error.message : "Cluster could not open a separate whiteboard window.");
      return false;
    }
  }
  async function openWhiteboardInNewWindow() {
    if (!activeWhiteboard) return;
    await openWhiteboardResourceWindow({ id: activeWhiteboard.id, label: activeWhiteboard.name, projectName: activeWhiteboardProject?.name || "No project" });
  }

  function renderElement(element: WhiteboardElement) {
    const liveEditor = remoteElementEditor(element.id);
    const remoteSelector = whiteboardPresenceIndex.selectorByElementId.get(element.id);
    const common = {
      className: `whiteboard-element ${selectedIds.has(element.id) ? "selected" : ""} ${element.locked ? "is-locked-v300" : ""} ${liveEditor ? "remote-editing-v196" : ""} ${remoteSelector ? "remote-selected-v196" : ""}`,
      "data-element-type": element.type,
      onPointerDown: (event: React.PointerEvent<SVGElement>) => handleElementPointerDown(event, element),
      onDoubleClick: () => { if (openWhiteboardElementResource(element)) setStatus("Opened the linked Cluster resource."); },
    };
    if (element.type === "path") {
      const pressureAware = element.points.length > 1 && element.points.some((point) => typeof point.pressure === "number");
      if (pressureAware) return (
        <g key={element.id} {...common} opacity={element.opacity ?? 1}>
          {element.points.slice(1).map((point, index) => {
            const previous = element.points[index];
            const pressure = ((previous.pressure ?? point.pressure ?? 0.5) + (point.pressure ?? previous.pressure ?? 0.5)) / 2;
            const width = Math.max(1, element.strokeWidth * (0.65 + pressure * 0.9));
            return <line key={`${element.id}-pressure-${index}`} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} stroke={element.stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={element.dashed ? "10 8" : undefined} />;
          })}
        </g>
      );
      return <path key={element.id} {...common} d={pathFromPoints(element.points)} fill="none" stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={element.opacity ?? 1} strokeDasharray={element.dashed ? "10 8" : undefined} />;
    }
    if (element.type === "line" || element.type === "arrow") {
      const midX = (element.x1 + element.x2) / 2;
      const midY = (element.y1 + element.y2) / 2;
      return (
        <g key={element.id} {...common}>
          <line x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" opacity={element.opacity ?? 1} strokeDasharray={element.dashed ? "10 8" : undefined} />
          {element.type === "arrow" && <polygon points={arrowHeadPoints(element.x1, element.y1, element.x2, element.y2, Math.max(10, element.strokeWidth * 4))} fill={element.stroke} />}
          {element.text && (
            <text x={midX + 8} y={midY - 8} fill="#0f172a" stroke="#f8fafc" strokeWidth="3" paintOrder="stroke" fontSize="13" fontWeight="800">
              {element.text}
            </text>
          )}
        </g>
      );
    }
    if (element.type === "text")
      return (<text key={element.id} {...common} x={element.x} y={element.y} fill={element.stroke} fontSize={element.fontSize} fontWeight="850">{element.text}</text>);
    if (element.type === "image") {
      return (
        <g key={element.id} {...common} opacity={element.opacity ?? 1}>
          <rect x={element.x - 4} y={element.y - 4} width={element.width + 8} height={element.height + 8} rx="12" fill="#fff" stroke={selectedIds.has(element.id) ? "#2563eb" : "rgba(15,23,42,.2)"} strokeWidth={selectedIds.has(element.id) ? 4 : 1} />
          <image href={element.src} x={element.x} y={element.y} width={element.width} height={element.height} preserveAspectRatio="xMidYMid meet" />
          <text x={element.x + 10} y={element.y + element.height - 10} fill="#fff" stroke="rgba(15,23,42,.8)" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="800">{element.alt}</text>
        </g>
      );
    }
    if (element.type === "card") {
      return (
        <g key={element.id} {...common} opacity={element.opacity ?? 1} filter="url(#softShadow)">
          <rect x={element.x} y={element.y} width={element.width} height={element.height} rx="14" fill={element.fill} stroke={element.accent} strokeWidth="2" />
          <rect x={element.x} y={element.y} width="10" height={element.height} rx="5" fill={element.accent} />
          <text x={element.x + 26} y={element.y + 34} fill={element.textColor} fontSize="18" fontWeight="900">{element.title.slice(0, 38)}</text>
          <text x={element.x + 26} y={element.y + 64} fill={element.textColor} fontSize="13" opacity=".84">
            {element.text.split("\n").slice(0, element.resource ? 3 : 5).map((line, index) => <tspan key={`${element.id}-body-${index}`} x={element.x + 26} dy={index === 0 ? 0 : 20}>{line.slice(0, 44)}</tspan>)}
          </text>
          {element.resource ? (
            <text x={element.x + 26} y={element.y + element.height - 14} fill={element.accent} fontSize="11" fontWeight="850">
              {[element.resourceKindLabel || levelLabel(element.resource.kind), element.resourceStatus].filter(Boolean).join(" · ").slice(0, 48)}
            </text>
          ) : null}
        </g>
      );
    }
    if (!isShapeElement(element)) return null;
    const rect = normalizeWhiteboardBox(element);
    const shapeFill = element.type === "sticky" && element.fill === "transparent" ? "#f8fafc" : element.fill;
    const textX = rect.x + 14;
    const textY = element.type === "frame" ? rect.y + 25 : rect.y + 30;
    const swimlaneDividerX = rect.x + rect.width * 0.34;
    const swimlaneDividerX2 = rect.x + rect.width * 0.67;
    return (
      <g key={element.id} {...common} opacity={element.opacity ?? 1} filter={element.shadow ? "url(#softShadow)" : undefined}>
        {(element.type === "box" || element.type === "process") && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={element.type === "process" ? "8" : "3"} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "sticky" && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="10" fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "terminator" && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={Math.max(18, Math.min(rect.height / 2, 38))} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "ellipse" && <ellipse cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "diamond" && <polygon points={diamondPoints(rect)} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "cloud" && <path d={cloudPath(rect)} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinejoin="round" strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "callout" && <polygon points={calloutPoints(rect)} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinejoin="round" strokeDasharray={element.dashed ? "10 8" : undefined} />}
        {element.type === "frame" && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="10" fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : "10 7"} />}
        {element.type === "swimlane" && (
          <g>
            <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="8" fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />
            <rect x={rect.x} y={rect.y} width={rect.width} height="44" rx="8" fill={element.stroke} opacity="0.12" />
            <line x1={swimlaneDividerX} y1={rect.y + 44} x2={swimlaneDividerX} y2={rect.y + rect.height} stroke={element.stroke} strokeWidth="2" opacity="0.35" />
            <line x1={swimlaneDividerX2} y1={rect.y + 44} x2={swimlaneDividerX2} y2={rect.y + rect.height} stroke={element.stroke} strokeWidth="2" opacity="0.35" />
          </g>
        )}
        {element.type === "database" && (
          <g>
            <path d={`M ${rect.x} ${rect.y + 18} C ${rect.x} ${rect.y - 6}, ${rect.x + rect.width} ${rect.y - 6}, ${rect.x + rect.width} ${rect.y + 18} L ${rect.x + rect.width} ${rect.y + rect.height - 18} C ${rect.x + rect.width} ${rect.y + rect.height + 6}, ${rect.x} ${rect.y + rect.height + 6}, ${rect.x} ${rect.y + rect.height - 18} Z`} fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />
            <ellipse cx={rect.x + rect.width / 2} cy={rect.y + 18} rx={rect.width / 2} ry="18" fill={shapeFill} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />
            <path d={`M ${rect.x} ${rect.y + rect.height - 18} C ${rect.x} ${rect.y + rect.height + 6}, ${rect.x + rect.width} ${rect.y + rect.height + 6}, ${rect.x + rect.width} ${rect.y + rect.height - 18}`} fill="none" stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />
          </g>
        )}
        {element.type === "actor" && (
          <g>
            <circle cx={rect.x + rect.width / 2} cy={rect.y + rect.height * 0.18} r={Math.min(rect.width, rect.height) * 0.11} fill="none" stroke={element.stroke} strokeWidth={element.strokeWidth} strokeDasharray={element.dashed ? "10 8" : undefined} />
            <line x1={rect.x + rect.width / 2} y1={rect.y + rect.height * 0.3} x2={rect.x + rect.width / 2} y2={rect.y + rect.height * 0.6} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" />
            <line x1={rect.x + rect.width * 0.23} y1={rect.y + rect.height * 0.43} x2={rect.x + rect.width * 0.77} y2={rect.y + rect.height * 0.43} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" />
            <line x1={rect.x + rect.width / 2} y1={rect.y + rect.height * 0.6} x2={rect.x + rect.width * 0.26} y2={rect.y + rect.height * 0.84} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" />
            <line x1={rect.x + rect.width / 2} y1={rect.y + rect.height * 0.6} x2={rect.x + rect.width * 0.74} y2={rect.y + rect.height * 0.84} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinecap="round" />
          </g>
        )}
        {element.text && (
          <text x={element.type === "actor" ? rect.x + rect.width / 2 : textX} y={element.type === "actor" ? rect.y + rect.height + 22 : textY} textAnchor={element.type === "actor" ? "middle" : "start"} fill={element.textColor} fontSize="14" fontWeight="850">
            {element.text
              .split("\n")
              .slice(0, 6)
              .map((line, index) => (
                <tspan key={`${element.id}-line-${index}`} x={element.type === "actor" ? rect.x + rect.width / 2 : textX} dy={index === 0 ? 0 : 18}>
                  {line}
                </tspan>
              ))}
          </text>
        )}
      </g>
    );
  }
  return (
    <ProjectWorkspaceShell
      className={`cluster-specialist-workspace cluster-whiteboard-workspace whiteboard-page cohesive-page-v043 canvas-page-v067 whiteboard-page-v069 whiteboard-page-v194 ${isWhiteboardFullscreen ? "whiteboard-fullscreen-v069" : ""} ${presentationMode ? "whiteboard-presentation-page-v489" : ""}`}
      headerClassName="page-header compact standard-header-v043 whiteboard-hero-v194 cluster-workspace-header-v391"
      eyebrow={`${activeWhiteboardProject?.name || "Production"} · Whiteboard`}
      title={activeWhiteboard?.name || "Whiteboards"}
      icon="palette"
      description={activeWhiteboard?.description || (activeWhiteboard ? "Visual planning canvas for project flows, references, decisions, and production links." : "Create or open a project whiteboard.")}
      metrics={activeWhiteboard ? [
        { label: "Elements", value: elements.length },
        { label: selectedIds.size ? "Selected" : "Visible", value: selectedIds.size || renderedElements.length },
        { label: "Frames", value: presentationFrames.length },
        { label: "Collaborators", value: Math.max(1, whiteboardCollaboration.presence.length) },
      ] : []}
      headerActions={<>
        <ClusterButton variant="primary" onClick={activeWhiteboard ? () => void saveWhiteboard() : createWhiteboard} busy={isSaving} busyLabel="Saving…">
          {activeWhiteboard ? (reviewedMergeAwaitingSave ? "Save reviewed merge" : localWhiteboardDirty ? "Save changes" : "Saved") : "Create"}
        </ClusterButton>
        {canOpenWorkspaceWindow && <ClusterButton variant="secondary" onClick={() => void openWhiteboardInNewWindow()} disabled={!activeWhiteboard}>Open window</ClusterButton>}
        <ClusterButton variant="secondary" onClick={focusSelectedElement} disabled={!selectedElements.length}>Focus</ClusterButton>
        <ClusterButton variant="secondary" onClick={() => void undo()} disabled={!canUseWhiteboardHistory({ saving: isSaving, localCount: history.length, savedAvailable: savedHistory.some((entry) => entry.state === "applied"), localDirty: localWhiteboardDirty, pendingRemote: Boolean(pendingRemote), queuedSync: whiteboardHasQueuedSync })} title={history.length ? "Undo an unsaved canvas edit" : "Undo your latest saved operation after resolving local drafts and conflicts"}>Undo</ClusterButton>
        <ClusterButton variant="secondary" onClick={() => void redo()} disabled={!canUseWhiteboardHistory({ saving: isSaving, localCount: redoHistory.length, savedAvailable: savedHistory.some((entry) => entry.state === "undone"), localDirty: localWhiteboardDirty, pendingRemote: Boolean(pendingRemote), queuedSync: whiteboardHasQueuedSync })} title={redoHistory.length ? "Redo an unsaved canvas edit" : "Redo your latest saved operation after resolving local drafts and conflicts"}>Redo</ClusterButton>
        <WhiteboardZoomControls zoom={zoom} onZoomOut={zoomOut} onZoomIn={zoomIn} onReset={resetZoom} />
        <WhiteboardMoreMenu
          active={Boolean(activeWhiteboard)} selectedCount={selectedIds.size} groupCount={selectionGroupIds.length}
          presentationMode={presentationMode} facilitatorMode={facilitatorMode} frameCount={presentationFrames.length} fullscreen={isWhiteboardFullscreen}
          outline={showOutline} navigator={showNavigator} compactToolbar={compactToolbar} autoSave={autoSaveEnabled} showDetails={showWhiteboardDetails} showSavedViews={showSavedViews}
          onToggleDetails={() => setShowWhiteboardDetails((value) => !value)} onToggleSavedViews={() => setShowSavedViews((value) => !value)} onCreate={createWhiteboard} onDuplicateSelection={duplicateSelected}
          onDeleteSelection={deleteSelected} onGroup={groupSelected} onUngroup={ungroupSelected} onTogglePresentation={presentationMode ? stopPresentation : startPresentation} onToggleFacilitator={toggleFacilitatorMode}
          onDuplicateWhiteboard={duplicateWhiteboard} onToggleFullscreen={() => setIsWhiteboardFullscreen((value) => !value)} onToggleOutline={() => setShowOutline((value) => !value)}
          onToggleNavigator={() => setShowNavigator((value) => !value)} onToggleCompactToolbar={() => setCompactToolbar((value) => !value)} onToggleAutoSave={() => setAutoSaveEnabled((value) => !value)}
          onExportPng={exportPng} onExportSvg={exportSvg} onExportJson={exportJson} onClear={clearBoard} onDeleteWhiteboard={deleteWhiteboard}
        />
      </>}
      projectName={activeWhiteboardProject?.name}
      projectStatus={activeWhiteboardProject ? projectStatusLabel(activeWhiteboardProject) : null}
      projectStatusTone={activeWhiteboardProject ? projectStatusMeta(activeWhiteboardProject).tone : "muted"}
      toolLabel="Whiteboard"
      resourceLabel={activeWhiteboard?.name || whiteboardName || "New whiteboard"}
      resourceSelector={
        <ProjectResourceSwitcher
          label="Whiteboard"
          value={selectedWhiteboardId || ""}
          items={whiteboardSwitcherItems}
          onChange={(value) => void selectWhiteboardSafely(value || null)}
          canOpenWindow={canOpenWorkspaceWindow}
          onOpenWindow={openWhiteboardResourceWindow}
        />
      }
      projectActions={!resourceWindow ? (
        <>
          <ClusterButton size="compact" variant="quiet" disabled={!activeWhiteboardProject} onClick={() => activeWhiteboardProject && onOpenProject(activeWhiteboardProject.id)}>Project</ClusterButton>
          <ClusterButton size="compact" variant="quiet" disabled={!activeWhiteboardProject} onClick={() => activeWhiteboardProject && onOpenTickets(activeWhiteboardProject.id)}>Tickets</ClusterButton>
          <ClusterButton size="compact" variant="quiet" disabled={!activeWhiteboardProject} onClick={() => activeWhiteboardProject && onOpenTimeline(activeWhiteboardProject.id)}>Timeline</ClusterButton>
          <ClusterButton size="compact" variant="quiet" disabled={!activeWhiteboardProject} onClick={() => activeWhiteboardProject && onOpenTime(activeWhiteboardProject.id)}>Scheduler</ClusterButton>
        </>
      ) : undefined}
      collaboration={<CollaborationStrip presence={whiteboardCollaboration.presence} actions={whiteboardCollaboration.actions} currentUserId={whiteboardCollaboration.me?.id} followedUserId={followedUserId} onFollowUser={(person) => setFollowedUserId((current) => (current === person.userId ? null : person.userId))} connection={whiteboardCollaboration.connection} />}
      notices={<>
        {facilitatorMode ? <div className="inline-status" role="status">Facilitator session active. Collaborators can follow your cursor and presentation frames from the presence bar.</div> : null}
        <CollaborationQueuePanel mutations={whiteboardCollaboration.queuedMutations} onReplay={whiteboardCollaboration.replayQueued} />
      </>}
      status={workspaceWindowStatus || undefined}
    >
      {followedUserId && (
        <div className="collaboration-following-v196">
          <span>Following {remoteWhiteboardPresence.find((item) => item.userId === followedUserId)?.userName || "collaborator"}</span>
          <ClusterButton size="compact" variant="quiet" className="" onClick={() => setFollowedUserId(null)}>
            Stop following
          </ClusterButton>
        </div>
      )}
      {reviewedMergeAwaitingSave && !pendingRemote ? (
        <div className="whiteboard-review-pending-g25" role="status">
          Reviewed merge is local only. Autosave is paused until you select <strong>Save reviewed merge</strong>. If the server changes again, a new review is required.
        </div>
      ) : null}
      {pendingRemote && (
        <div className="collaboration-conflict-v196">
          <div>
            <strong>Review concurrent Whiteboard changes</strong>
            <span>Server revision {pendingRemote.revision}. {pendingWhiteboardReview?.localChanges ?? 0} local and {pendingWhiteboardReview?.remoteChanges ?? 0} remote field changes. Nothing has been overwritten or published.</span>
            <span>{pendingWhiteboardReview ? `${pendingWhiteboardReview.conflicts.length} overlapping field(s) need an explicit choice. Disjoint changes will be kept from both versions.` : "A safe merge could not be verified. Preserve your recovery copy or load the server version."}</span>
          </div>
          {pendingWhiteboardReview?.conflicts.length ? (
            <section className="whiteboard-conflict-fields-g25" aria-label="Review overlapping Whiteboard changes">
              {pendingWhiteboardReview.conflicts.map((entry) => (
                <div className="whiteboard-conflict-field-g25" key={entry.key}>
                  <strong>{entry.label}</strong>
                  <div className="whiteboard-conflict-values-g25">
                    <div><span>Your draft</span><code>{entry.minePreview}</code></div>
                    <div><span>Current server</span><code>{entry.serverPreview}</code></div>
                  </div>
                  <div role="group" aria-label={`Resolve ${entry.label}`}>
                    <ClusterButton type="button" size="compact" variant={whiteboardMergeChoices[entry.key] === "mine" ? "primary" : "secondary"} onClick={() => setWhiteboardMergeChoices((previous) => ({ ...previous, [entry.key]: "mine" }))}>Keep mine</ClusterButton>
                    <ClusterButton type="button" size="compact" variant={whiteboardMergeChoices[entry.key] === "server" ? "primary" : "secondary"} onClick={() => setWhiteboardMergeChoices((previous) => ({ ...previous, [entry.key]: "server" }))}>Use server</ClusterButton>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
          <ClusterButton variant="primary" disabled={isSaving || whiteboardHasQueuedSync || !pendingWhiteboardReview || pendingWhiteboardReview.conflicts.some((entry) => !whiteboardMergeChoices[entry.key])} onClick={applyReviewedWhiteboardMerge}>
            Apply reviewed changes locally
          </ClusterButton>
          <ClusterButton variant="secondary" onClick={async () => {
            if (!await confirmCluster({ title: "Discard local Whiteboard edits?", message: "Your unsaved local edits will be replaced with the newer server version. Preserve a recovery copy first if you may need them later.", confirmLabel: "Load server copy", tone: "danger" })) return;
            applyRemoteWhiteboard(pendingRemote, "Loaded the newer remote version.", true);
          }}>
            Discard local and load server
          </ClusterButton>
          <ClusterButton variant="secondary"
            onClick={() => {
              if (!activeWhiteboard) return;
              const whiteboard = currentWhiteboardDraft(activeWhiteboard);
              if (!whiteboard) return;
              const draft = { savedAt: new Date().toISOString(), whiteboard, elements };
              if (!persistWhiteboardRecovery(activeWhiteboard.id, draft)) {
                setStatus("Recovery storage unavailable until the authenticated user is known. Keep this editor open.");
                return;
              }
              setRecoveryDraft(draft);
              // Keep the conflict barrier active. Saving with a stale base
              // must not become an implicit replace-server operation.
              setStatus("Local recovery copy saved on this device. Review the newer server copy before publishing; offline drafts are not synced.");
            }}
          >
            Preserve local recovery copy
          </ClusterButton>
        </div>
      )}
      <WhiteboardRecoveryBanner
        draft={recoveryDraft}
        staleServerSequence={Boolean(recoveryDraft && activeWhiteboard && Number(recoveryDraft.whiteboard.operationSequence || 0) !== Number(activeWhiteboard.operationSequence || 0))}
        onExport={() => { if (recoveryDraft) downloadJsonFile(`whiteboard-recovery-${activeWhiteboard?.id || "draft"}.json`, recoveryDraft); }}
        onRecover={() => { if (!recoveryDraft) return;
          if (activeWhiteboard && Number(recoveryDraft.whiteboard.operationSequence || 0) !== Number(activeWhiteboard.operationSequence || 0)) {
            setStatus("Cannot directly restore a draft from an older server sequence. Export it for reference or use the guarded conflict reviewer.");
            return;
          }
          setElements(recoveryDraft.elements || []); setCategories(recoveryDraft.whiteboard.categories || []); setLabels(recoveryDraft.whiteboard.labels?.length ? recoveryDraft.whiteboard.labels : DEFAULT_WHITEBOARD_LABELS); setProductionMap(recoveryDraft.productionLinks || recoveryDraft.whiteboard.productionLinks || {}); setBackgroundColor(recoveryDraft.whiteboard.backgroundColor || "#f8fafc"); setGridColor(recoveryDraft.whiteboard.gridColor || "#cbd5e1"); setGridStyle(recoveryDraft.whiteboard.gridStyle || "lines"); setWhiteboardName(recoveryDraft.whiteboard.name || whiteboardName); setWhiteboardDescription(recoveryDraft.whiteboard.description || ""); setCanvasWidth(recoveryDraft.whiteboard.canvasWidth || canvasWidth); setCanvasHeight(recoveryDraft.whiteboard.canvasHeight || canvasHeight); setRecoveryDraft(null); setStatus("Recovered local draft. Save to publish it."); }}
        onDiscard={() => { clearWhiteboardRecovery(activeWhiteboard?.id || selectedWhiteboardId || ""); setRecoveryDraft(null); }}
      />
      {recoverableEdit ? <ClusterRecoveryNotice message={recoverableEdit} onAction={undo} onDismiss={() => setRecoverableEdit(null)} /> : null}
      <WhiteboardRelationshipsPanel
        activeWhiteboard={activeWhiteboard} whiteboardName={whiteboardName} whiteboardProjectId={whiteboardProjectId}
        RelatedRecordsPanel={RelatedRecordsPanel} CustomFieldValuesPanel={CustomFieldValuesPanel}
        collaborationUsers={collaborationUsers as any} currentUser={whiteboardCollaboration.me as any} selectedCount={selectedElements.length} showSelectionDiscussion={showSelectionDiscussion} selectionAnchor={whiteboardSelectionAnchor}
        dirty={localWhiteboardDirty}
        onServerRestore={(restored, restoredSequence) => { applyRemoteWhiteboard(restored, `Restored authoritative Whiteboard snapshot from sequence ${restoredSequence}.`); setHistory([]); setRedoHistory([]); setSavedHistory([]); setRecoverableEdit(null); setPendingRemote(null); setSelectedIds(new Set()); setSelectedId(null); setShowSelectionDiscussion(false); setLastSavedAt(new Date().toISOString()); clearWhiteboardRecovery(restored.id); setRecoveryDraft(null); void onReloadWhiteboards(); }}
        onAnchorSelect={(anchor) => { const ids = (anchor.ids || []).filter((id: string) => elements.some((element) => element.id === id)); if (ids.length) { setSelectedIds(new Set(ids)); setSelectedId(ids[0]); setShowSelectionDiscussion(true); } if (typeof anchor.x === "number" && typeof anchor.y === "number" && canvasWrapRef.current) canvasWrapRef.current.scrollTo({ left: Math.max(0, anchor.x * zoom - canvasWrapRef.current.clientWidth / 2), top: Math.max(0, anchor.y * zoom - canvasWrapRef.current.clientHeight / 2), behavior: "smooth" }); }}
      />


      <WhiteboardDetailsPanel visible={showWhiteboardDetails || !activeWhiteboard} activeWhiteboard={activeWhiteboard} projects={projects} name={whiteboardName} projectId={whiteboardProjectId} description={whiteboardDescription} onNameChange={setWhiteboardName} onProjectChange={setWhiteboardProjectId} onDescriptionChange={setWhiteboardDescription} onSave={() => void saveWhiteboard()} onCreate={createWhiteboard} />

      {activeWhiteboard && showSavedViews ? (
        <SavedViewsToolbar
          scope={`whiteboard.${activeWhiteboard.id}`}
          label="Whiteboard workspace"
          current={savedWhiteboardView}
          onApply={applyWhiteboardSavedView}
          summary="Remember zoom, layers, grid, navigator, and canvas-view preferences without copying the whiteboard."
        />
      ) : null}

      {whiteboardLoading && selectedWhiteboardId ? (
        <CanvasLoadingState label="Loading whiteboard canvas" />
      ) : whiteboardLoadError && selectedWhiteboardId ? (
        <RequestErrorState error={whiteboardLoadError} title="Whiteboard could not be loaded" onRetry={() => setWhiteboardReloadNonce((value) => value + 1)} reloadLabel="Reload whiteboards" onReload={() => void onReloadWhiteboards()} />
      ) : !activeWhiteboard ? (
        <ClusterEmptyState
          kind="first-use"
          icon="palette"
          eyebrow="Whiteboards"
          title="No whiteboard selected"
          description="Create or select a whiteboard to begin drawing, diagramming, and planning."
          actions={<ClusterButton variant="primary" onClick={createWhiteboard}>Create whiteboard</ClusterButton>}
        />
      ) : (
        <div className={`whiteboard-shell panel whiteboard-workspace-v299 ${compactToolbar ? "compact-tools-v299" : ""} ${showOutline ? "outline-open-v299" : ""} ${presentationMode ? "presentation-mode-v489" : ""}`}>
          {presentationMode && <WhiteboardPresentationControls frames={presentationFrames} index={presentationFrameIndex} onFocus={focusPresentationFrame} onExit={stopPresentation} />}
          <WhiteboardCommandBar
            dirty={localWhiteboardDirty} saving={isSaving} lastSavedAt={lastSavedAt} autoSave={autoSaveEnabled}
            outline={showOutline} categories={showCategories} navigator={showNavigator} imageInputRef={imageInputRef}
            onImageInput={handleImageInput} onFit={fitToContent} onResetZoom={resetZoom} onToggleOutline={() => setShowOutline((value) => !value)}
            onAddImage={() => imageInputRef.current?.click()} onToggleCategories={() => setShowCategories((value) => !value)}
            onToggleNavigator={() => setShowNavigator((value) => !value)} onAutoSave={setAutoSaveEnabled}
          />
          {facilitatorSessionActive ? (
            <div className="whiteboard-commandbar-v299 cluster-dense-toolbar" role="group" aria-label="Facilitator session controls">
              <div className="whiteboard-save-state-v299">
                <span className="save-dot-v299 clean" />
                <strong>Facilitator session</strong>
                <span>{facilitatorTimerRemaining > 0 ? `Timer ${Math.floor(facilitatorTimerRemaining / 60000)}:${String(Math.floor((facilitatorTimerRemaining % 60000) / 1000)).padStart(2, "0")}` : "No active timer"}</span>
              </div>
              <div className="whiteboard-view-actions-v299">
                {facilitatorMode ? <>
                  <ClusterButton size="compact" variant="quiet" onClick={() => startFacilitatorTimer(5)}>5 min</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" onClick={() => startFacilitatorTimer(10)}>10 min</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" onClick={() => startFacilitatorTimer(15)}>15 min</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" disabled={!facilitatorTimerRemaining} onClick={stopFacilitatorTimer}>Stop timer</ClusterButton>
                </> : null}
                <ClusterButton size="compact" variant="quiet" selected={currentUserVoted} disabled={!selectedElement} onClick={toggleSelectedVote}>
                  {currentUserVoted ? "Remove vote" : "Vote selected"}{selectedElement ? ` · ${selectedVotes.length}` : ""}
                </ClusterButton>
              </div>
            </div>
          ) : null}
          {sectionFrames.length > 0 && (
            <nav className="whiteboard-sections-v495" aria-label="Whiteboard sections">
              <strong>Sections</strong>
              <div>{sectionFrames.map((section, index) => <ClusterButton size="compact" variant="quiet" key={section.id} selected={selectedId === section.id} onClick={() => { setSelectedIds(new Set([section.id])); setSelectedId(section.id); focusCanvasBounds(whiteboardElementBounds(section), 36); setStatus(`Opened section ${getElementText(section) || index + 1}.`); }}>{getElementText(section) || `Section ${index + 1}`}</ClusterButton>)}</div>
            </nav>
          )}
          {showCategories && (
            <section className="whiteboard-categories-v300" aria-label="Whiteboard layers">
              <div className="whiteboard-category-create-v300">
                <strong>Layers</strong>
                <ClusterTextInput value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Gameplay, UI, references…" aria-label="New layer name" onKeyDown={(event) => { if (event.key === "Enter") addCategory(); }} />
                <CompactColorField label="Color" value={newCategoryColor} onChange={setNewCategoryColor} showValue={false} />
                <ClusterButton size="compact" variant="secondary" onClick={addCategory} disabled={!newCategoryName.trim()}>Add</ClusterButton>
              </div>
              <div className="whiteboard-category-list-v300">
                <ClusterButton unstyled type="button" className={!activeCategoryId ? "active" : ""} onClick={() => setActiveCategoryId("")}><span />No layer</ClusterButton>
                {categories.map((category) => (
                  <div key={category.id} className={category.hidden ? "hidden-category-v300" : ""}>
                    <CompactColorField label="Color" ariaLabel={`${category.name} color`} value={category.color} onChange={(value) => patchCategory(category.id, { color: value })} showValue={false} showLabel={false} />
                    <ClusterButton unstyled type="button" className={activeCategoryId === category.id ? "active" : ""} onClick={() => { setActiveCategoryId(category.id); if (category.hidden) patchCategory(category.id, { hidden: false }); }}><span style={runtimeStyle({ background: category.color })} />{category.name}</ClusterButton>
                    <ClusterButton unstyled type="button" onClick={() => renameCategory(category)}>Rename</ClusterButton>
                    <ClusterButton unstyled type="button" onClick={() => patchCategory(category.id, { hidden: !category.hidden })} aria-label={`${category.hidden ? "Show" : "Hide"} ${category.name}`}>{category.hidden ? "Show" : "Hide"}</ClusterButton>
                    <ClusterButton unstyled type="button" onClick={() => removeCategory(category.id)} aria-label={`Delete ${category.name}`}><ClusterIcon name="trash" /></ClusterButton>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="whiteboard-labels-v308" aria-label="Whiteboard labels and canvas appearance">
            <div className="whiteboard-label-manager-v308">
              <div>
                <strong>Labels</strong>
                <span>Apply reusable labels to objects, then filter the outline by them.</span>
              </div>
              <div className="whiteboard-label-create-v308">
                <ClusterTextInput value={newLabelName} onChange={(event) => setNewLabelName(event.target.value)} placeholder="Decision, risk, action…" maxLength={80} onKeyDown={(event) => { if (event.key === "Enter") addWhiteboardLabel(); }} />
                <CompactColorField label="Color" value={newLabelColor} onChange={setNewLabelColor} showValue={false} />
                <ClusterButton size="compact" variant="secondary" onClick={addWhiteboardLabel} disabled={!newLabelName.trim()}>Add</ClusterButton>
              </div>
              <div className="whiteboard-label-list-v308">
                {labels.map((label) => {
                  const active = selectedElement ? (selectedElement.labelIds || []).includes(label.id) : activeLabelId === label.id;
                  return <span key={label.id} style={runtimeStyle({ "--whiteboard-label": label.color })}><ClusterButton unstyled type="button" className={active ? "active" : ""} onClick={() => toggleSelectedLabel(label.id)}><i />{label.name}</ClusterButton><ClusterButton unstyled type="button" onClick={() => removeWhiteboardLabel(label.id)} aria-label={`Remove ${label.name}`}><ClusterIcon name="close" /></ClusterButton></span>;
                })}
              </div>
            </div>
            <div className="whiteboard-canvas-theme-v308">
              <strong>Canvas</strong>
              <div>
                <CompactColorField label="Background" value={backgroundColor} onChange={setBackgroundColor} />
                <CompactColorField label="Grid" value={gridColor} onChange={setGridColor} />
                <label>Style<ClusterSelect ariaLabel="Canvas grid style" value={gridStyle} onChange={(value) => setGridStyle(value as typeof gridStyle)} options={[{ value: "lines", label: "Lines" }, { value: "dots", label: "Dots" }, { value: "none", label: "None" }]} /></label>
              </div>
            </div>
          </section>

          <div className="whiteboard-style-topbar-v069">
            <div className="style-topbar-section-v069 color-controls-v069">
              <span className="tool-block-title">Colors</span>
              <div className="whiteboard-palette-presets-v308">
                {WHITEBOARD_PALETTES.map((palette) => <ClusterButton unstyled type="button" key={palette.id} onClick={() => applyWhiteboardPalette(palette)} title={`Apply ${palette.label} palette`} style={runtimeStyle({ "--palette-stroke": palette.stroke, "--palette-fill": palette.fill })}><i /><span>{palette.label}</span></ClusterButton>)}
              </div>
              <div className="color-row">
                <div className="tool-field color-field">
                  <CompactColorField label="Stroke" value={strokeColor} onChange={setStrokeColor} showValue={false} />
                </div>
                <div className="tool-field color-field">
                  <CompactColorField label="Fill" value={fillColor} onChange={setFillColor} disabled={!fillEnabled} showValue={false} />
                </div>
                <div className="tool-field color-field">
                  <CompactColorField label="Text" value={textColor} onChange={setTextColor} showValue={false} />
                </div>
              </div>
              <div className="tool-group swatches" aria-label="Color presets">
                {STUDIO_SWATCHES.map((color) => (
                  <ClusterButton unstyled type="button" key={color} className="swatch" style={runtimeStyle({ background: color })} title={color} onClick={() => setStrokeColor(color)} />
                ))}
              </div>
            </div>
            <div className="style-topbar-section-v069 range-controls-v069">
              <div className="tool-field range-field">
                <label>Stroke {strokeWidth}px</label>
                <ClusterSlider min="1" max="18" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} aria-label="Stroke width" />
              </div>
              <div className="tool-field range-field">
                <label>Opacity {shapeOpacity}%</label>
                <ClusterSlider min="15" max="100" value={shapeOpacity} onChange={(event) => setShapeOpacity(Number(event.target.value))} aria-label="Shape opacity" />
              </div>
              <div className="tool-field range-field">
                <label>Eraser {eraserSize}px</label>
                <ClusterSlider min="4" max="80" value={eraserSize} onChange={(event) => setEraserSize(Number(event.target.value))} aria-label="Eraser size" />
              </div>
              <div className="tool-field range-field">
                <label>Font {fontSize}px</label>
                <ClusterSlider min="10" max="72" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Font size" />
              </div>
            </div>
            <div className="style-topbar-section-v069 toggles-v069">
              <label className="tool-check">
                <ClusterInput type="checkbox" checked={fillEnabled} onChange={(event) => setFillEnabled(event.target.checked)} /> Fill
              </label>
              <label className="tool-check">
                <ClusterInput type="checkbox" checked={dashedStroke} onChange={(event) => setDashedStroke(event.target.checked)} /> Dashed
              </label>
              <label className="tool-check">
                <ClusterInput type="checkbox" checked={shapeShadow} onChange={(event) => setShapeShadow(event.target.checked)} /> Shadow
              </label>
              <label className="tool-check">
                <ClusterInput type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> Grid
              </label>
              <label className="tool-check">
                <ClusterInput type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} /> Snap
              </label>
            </div>
          </div>

          <div className="whiteboard-toolbar expanded cluster-dense-toolbar">
            <div className="tool-block">
              <span className="tool-block-title">Core tools</span>
              <div className="tool-grid compact-tools">
                {WHITEBOARD_BASIC_TOOLS.map((item) => (
                  <ClusterButton unstyled type="button" key={item} title={`${WHITEBOARD_TOOL_META[item].label} (${WHITEBOARD_TOOL_META[item].shortcut})`} className={tool === item ? "active" : ""} onClick={() => setTool(item)}>
                    <span>{WHITEBOARD_TOOL_META[item].label}</span>
                    <kbd>{WHITEBOARD_TOOL_META[item].shortcut}</kbd>
                  </ClusterButton>
                ))}
              </div>
              <span className="tool-subtitle">Connectors</span>
              <div className="tool-grid compact-tools">
                {WHITEBOARD_CONNECTOR_TOOLS.map((item) => (
                  <ClusterButton unstyled type="button" key={item} title={`${WHITEBOARD_TOOL_META[item].label} (${WHITEBOARD_TOOL_META[item].shortcut})`} className={tool === item ? "active" : ""} onClick={() => setTool(item)}>
                    <span>{WHITEBOARD_TOOL_META[item].label}</span>
                    <kbd>{WHITEBOARD_TOOL_META[item].shortcut}</kbd>
                  </ClusterButton>
                ))}
              </div>
            </div>

            <div className="tool-block">
              <span className="tool-block-title">Diagram shapes</span>
              <div className="tool-grid diagram-tool-grid">
                {WHITEBOARD_SHAPE_TOOLS.map((item) => (
                  <ClusterButton unstyled type="button" key={item} title={`${WHITEBOARD_TOOL_META[item].label} (${WHITEBOARD_TOOL_META[item].shortcut})`} className={tool === item ? "active" : ""} onClick={() => setTool(item)}>
                    <span>{WHITEBOARD_TOOL_META[item].label}</span>
                    <kbd>{WHITEBOARD_TOOL_META[item].shortcut}</kbd>
                  </ClusterButton>
                ))}
              </div>
            </div>

            <div className="tool-block">
              <span className="tool-block-title">Templates</span>
              <div className="template-grid">
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("flow")}>Flowchart</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("loop")}>Gameplay loop</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("system")}>System map</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("dialogue")}>Dialogue tree</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("wireframe")}>Wireframe</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("mindmap")}>Mind map</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("roadmap")}>Roadmap</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("sequence")}>Sequence</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => insertWhiteboardTemplate("er")}>Data model</ClusterButton>
              </div>
            </div>

            <div className="tool-block whiteboard-component-library-v495">
              <span className="tool-block-title">Project components</span>
              <div className="whiteboard-component-actions-v495">
                <ClusterButton size="compact" variant="secondary" onClick={() => void saveSelectionAsComponent()} disabled={!selectedElements.length || !activeWhiteboardProject || componentSync.pending > 0}>Save selection</ClusterButton>
                <span>{componentLibrary.length}/80 shared components</span>
              </div>
              {componentSync.error ? <div className="inline-status danger" role="alert">{componentSync.error}</div> : null}
              <div className="whiteboard-component-filters-v495">
                <ClusterTextInput type="search" value={componentQuery} onChange={(event) => setComponentQuery(event.target.value)} placeholder="Search components or tags…" />
                <ClusterNativeSelect value={componentCategoryFilter} onChange={(event) => setComponentCategoryFilter(event.target.value)} aria-label="Filter project components by category"><option value="">All categories</option>{componentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</ClusterNativeSelect>
              </div>
              <div className="whiteboard-component-list-v495">
                {filteredComponents.slice(0, 32).map((component) => (
                  <div key={component.id}>
                    <div className="whiteboard-component-main-v495">
                      <ClusterButton size="compact" variant="quiet" onClick={() => insertProjectComponent(component)} title={`Insert ${component.name}`}>{component.name}</ClusterButton>
                      <small>{[component.category, ...(component.tags || []).slice(0, 3)].filter(Boolean).join(" · ") || "Reusable component"}</small>
                    </div>
                    <span>{component.elements.length} item{component.elements.length === 1 ? "" : "s"}</span>
                    {component.ownerId === whiteboardCollaboration.me?.id ? <div className="whiteboard-component-row-actions-v495"><ClusterButton size="compact" variant="quiet" onClick={() => void editProjectComponentMetadata(component)} aria-label={`Edit ${component.name}`}>Edit</ClusterButton><ClusterButton size="compact" variant="quiet" onClick={() => removeProjectComponent(component)} aria-label={`Remove ${component.name}`}>Remove</ClusterButton></div> : null}
                  </div>
                ))}
                {!componentLibrary.length ? <span className="muted tight">Select reusable items and save them for everyone on this project.</span> : !filteredComponents.length ? <span className="muted tight">No project components match these filters.</span> : null}
              </div>
            </div>

            <div className="tool-block whiteboard-production-tools-v127">
              <span className="tool-block-title">Production</span>
              <div className="field compact">
                <label>Production template</label>
                <ClusterNativeSelect value={productionTemplate} onChange={(event) => setProductionTemplate(event.target.value as typeof productionTemplate)}>
                  <option value="feature">Feature map</option>
                  <option value="qa">QA flow</option>
                  <option value="milestone">Milestone slice</option>
                  <option value="review">Review board</option>
                </ClusterNativeSelect>
              </div>
              <ClusterButton type="button" className="" onClick={applyProductionTemplate} variant="quiet" size="compact">
                Insert production template
              </ClusterButton>
              <div className="whiteboard-selected-card-v127">
                <strong>{selectedElement ? getElementText(selectedElement) || selectedElement.type : "No item selected"}</strong>
                <span>{selectedElement?.type === "card" && selectedElement.resource ? `Live ${selectedElement.resourceKindLabel || levelLabel(selectedElement.resource.kind)} reference` : "Select an item to review, convert, or connect to live Cluster work."}</span>
              </div>
              <div className="field compact">
                <label>Target board list</label>
                <ClusterNativeSelect value={productionTargetListId} onChange={(event) => setProductionTargetListId(event.target.value)}>
                  <option value="">Pick target list</option>
                  {productionListOptions.map((option) => (
                    <option key={option.list.id} value={option.list.id}>
                      {option.project.name} / {option.board.name} / {option.list.title}
                    </option>
                  ))}
                </ClusterNativeSelect>
              </div>
              <ClusterButton type="button" className="" disabled={!selectedElement || !productionTargetListId} onClick={convertSelectedToCard} variant="quiet" size="compact">
                Convert selected to card
              </ClusterButton>
              <div className="field compact">
                <label>Review</label>
                <ClusterNativeSelect
                  value={selectedProduction?.reviewState || "draft"}
                  disabled={!selectedId}
                  onChange={(event) => updateSelectedProduction({ reviewState: event.target.value as WhiteboardProductionRecord["reviewState"] })}
                >
                  <option value="draft">Draft</option>
                  <option value="in-review">In review</option>
                  <option value="approved">Approved</option>
                  <option value="needs-update">Needs update</option>
                </ClusterNativeSelect>
              </div>
              <div className="field compact">
                <label>Live Cluster object</label>
                <ClusterTextInput type="search" value={liveReferenceQuery} onChange={(event) => setLiveReferenceQuery(event.target.value)} placeholder="Search cards, tickets, builds, QA, Library, people…" />
                <small>{liveReferenceLoading ? "Searching…" : liveReferenceError || "Insert a live reference card. Double-click it later to open the source."}</small>
              </div>
              {liveReferenceResults.length ? (
                <div className="whiteboard-component-list-v495" role="list" aria-label="Live Cluster resource results">
                  {liveReferenceResults.map((result) => (
                    <div key={`${result.kind}:${result.id}`} role="listitem">
                      <div className="whiteboard-component-main-v495">
                        <ClusterButton size="compact" variant="quiet" onClick={() => insertLiveReference(result)}>{result.title}</ClusterButton>
                        <small>{[levelLabel(result.kind), result.projectName, result.status].filter(Boolean).join(" · ")}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedElement?.type === "card" && selectedElement.resource ? (
                <ClusterButton type="button" variant="quiet" size="compact" onClick={() => openWhiteboardElementResource(selectedElement)}>Open linked object</ClusterButton>
              ) : null}
              <div className="two-col compact-fields-v092">
                <ClusterButton type="button" variant="quiet" size="compact" busy={diagramBusy === "relationships"} busyLabel="Building…" disabled={!activeWhiteboardProject || Boolean(diagramBusy)} onClick={() => insertGeneratedDiagram("relationships")}>Generate relationship diagram</ClusterButton>
                <ClusterButton type="button" variant="quiet" size="compact" busy={diagramBusy === "source"} busyLabel="Building…" disabled={!activeWhiteboardProject || Boolean(diagramBusy)} onClick={() => insertGeneratedDiagram("source")}>Generate Source Control diagram</ClusterButton>
              </div>
              <div className="field compact">
                <label>Comment on item</label>
                <ClusterTextArea rows={2} value={productionComment} onChange={(event) => setProductionComment(event.target.value)} placeholder="Review note, question, sign-off..." />
              </div>
              <ClusterButton type="button" className="" disabled={!selectedId || !productionComment.trim()} onClick={addSelectedProductionComment} variant="quiet" size="compact">
                Add comment
              </ClusterButton>
              <div className="whiteboard-comment-list-v127">
                {(selectedProduction?.comments || []).slice(0, 3).map((comment) => (
                  <p key={comment.id}>
                    {comment.body}
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </p>
                ))}
              </div>
              <ClusterButton type="button" className="" onClick={exportWhiteboardSnapshot} variant="quiet" size="compact">
                Export snapshot
              </ClusterButton>
            </div>

            <div className="tool-block">
              <span className="tool-block-title">Inspector{selectedBounds ? ` · ${Math.round(selectedBounds.width)}×${Math.round(selectedBounds.height)}` : ""}</span>
              <div className="tool-field grow">
                <label>Label / selected text</label>
                <ClusterTextArea value={labelText} onChange={(event) => setLabelText(event.target.value)} placeholder="UI flow, boss phase, system note..." rows={3} />
              </div>
              <div className="tool-grid mini-grid">
                <div className="tool-field mini-field">
                  <label>Layer</label>
                  <ClusterSelect
                    ariaLabel="Selected object layer"
                    value={selectedElement?.categoryId || activeCategoryId}
                    onChange={assignSelectedCategory}
                    options={[{ value: "", label: "No layer" }, ...categories.map((category) => ({ value: category.id, label: category.name, meta: category.hidden ? "Hidden" : undefined }))]}
                  />
                </div>
                <div className="tool-field mini-field whiteboard-inspector-labels-v308">
                  <label>Labels</label>
                  <span>{selectedElement ? `${selectedElement.labelIds?.length || 0} applied` : activeLabelId ? "Applied to new items" : "None"}</span>
                </div>
                {selectedBounds && (
                  <>
                    <div className="tool-field mini-field">
                      <label>Selection X</label>
                      <NumberStepper min={0} max={canvasWidth} value={Math.round(selectedBounds.x)} onValueChange={(value) => moveSelectionToCoordinate("x", Number(value) || 0)} ariaLabel="Selected object X position" />
                    </div>
                    <div className="tool-field mini-field">
                      <label>Selection Y</label>
                      <NumberStepper min={0} max={canvasHeight} value={Math.round(selectedBounds.y)} onValueChange={(value) => moveSelectionToCoordinate("y", Number(value) || 0)} ariaLabel="Selected object Y position" />
                    </div>
                    <div className="tool-field mini-field">
                      <label>Move selection</label>
                      <div className="tool-group selected-actions" role="group" aria-label={`Move selection by ${gridSize} pixels`}>
                        <ClusterButton size="compact" variant="quiet" aria-label={`Move selection left ${gridSize} pixels`} onClick={() => nudgeSelectionBy(-gridSize, 0)}><ClusterIcon name="chevron-left" /></ClusterButton>
                        <ClusterButton size="compact" variant="quiet" aria-label={`Move selection up ${gridSize} pixels`} onClick={() => nudgeSelectionBy(0, -gridSize)}><ClusterIcon name="chevron-up" /></ClusterButton>
                        <ClusterButton size="compact" variant="quiet" aria-label={`Move selection down ${gridSize} pixels`} onClick={() => nudgeSelectionBy(0, gridSize)}><ClusterIcon name="chevron-down" /></ClusterButton>
                        <ClusterButton size="compact" variant="quiet" aria-label={`Move selection right ${gridSize} pixels`} onClick={() => nudgeSelectionBy(gridSize, 0)}><ClusterIcon name="chevron-right" /></ClusterButton>
                      </div>
                    </div>
                  </>
                )}
                {selectedBounds && (
                  <>
                    <div className="tool-field mini-field">
                      <label>Selection width</label>
                      <NumberStepper min={24} max={canvasWidth} value={Math.round(selectedBounds.width)} onValueChange={(value) => resizeSelectionToDimension("width", Number(value) || selectedBounds.width)} ariaLabel="Selected objects width" />
                    </div>
                    <div className="tool-field mini-field">
                      <label>Selection height</label>
                      <NumberStepper min={24} max={canvasHeight} value={Math.round(selectedBounds.height)} onValueChange={(value) => resizeSelectionToDimension("height", Number(value) || selectedBounds.height)} ariaLabel="Selected objects height" />
                    </div>
                  </>
                )}
                <div className="tool-field mini-field">
                  <label>Grid</label>
                  <NumberStepper min={8} max={96} value={gridSize} onValueChange={(value) => setGridSize(Number(value) || 32)} ariaLabel="Grid size" />
                </div>
                <div className="tool-field mini-field">
                  <label>Width</label>
                  <NumberStepper min={600} max={4000} value={canvasWidth} onValueChange={(value) => setCanvasWidth(Number(value) || 1800)} ariaLabel="Canvas width" />
                </div>
                <div className="tool-field mini-field">
                  <label>Height</label>
                  <NumberStepper min={400} max={2400} value={canvasHeight} onValueChange={(value) => setCanvasHeight(Number(value) || 950)} ariaLabel="Canvas height" />
                </div>
              </div>
              <div className="tool-group selected-actions">
                <ClusterButton unstyled type="button" onClick={applySelectedStyle} disabled={!selectedId}>
                  Apply
                </ClusterButton>
                <ClusterButton unstyled type="button" onClick={bringForward} disabled={!selectedId}>
                  Forward
                </ClusterButton>
                <ClusterButton unstyled type="button" onClick={sendBackward} disabled={!selectedId}>
                  Backward
                </ClusterButton>
                <ClusterButton unstyled type="button" onClick={snapSelectedToGrid} disabled={!selectedIds.size}>Snap selection</ClusterButton>
                <ClusterButton unstyled type="button" onClick={toggleSelectedLock} disabled={!selectedIds.size}>{selectedElements.some((element) => element.locked) ? "Unlock selection" : "Lock selection"}</ClusterButton>
                <ClusterButton unstyled type="button" onClick={groupSelected} disabled={selectedIds.size < 2}>Group</ClusterButton>
                <ClusterButton unstyled type="button" onClick={ungroupSelected} disabled={!selectionGroupIds.length}>Ungroup</ClusterButton>
                <ClusterButton unstyled type="button" onClick={connectSelected} disabled={selectedElements.filter((element) => element.type !== "line" && element.type !== "arrow").length !== 2}>Connect</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => void createSectionFromSelection()} disabled={!selectedIds.size}>Create section</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => setShowSelectionDiscussion((value) => !value)} disabled={!selectedIds.size}>{showSelectionDiscussion ? "Hide review" : "Review selection"}</ClusterButton>
              </div>
              <div className="tool-group selected-actions">
                <ClusterButton unstyled type="button" onClick={() => alignSelected("left")} disabled={!selectedId}>Left</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => alignSelected("center")} disabled={!selectedId}>Center</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => alignSelected("right")} disabled={!selectedId}>Right</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => alignSelected("top")} disabled={!selectedId}>Top</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => alignSelected("middle")} disabled={!selectedId}>Middle</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => alignSelected("bottom")} disabled={!selectedId}>Bottom</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => distributeSelected("horizontal")} disabled={selectedElements.length < 3}>Distribute X</ClusterButton>
                <ClusterButton unstyled type="button" onClick={() => distributeSelected("vertical")} disabled={selectedElements.length < 3}>Distribute Y</ClusterButton>
              </div>
              <p className="shortcut-help">Shortcuts: V/P/L/A/R/O/D/M/U/B/C/H/F/Q/S/N/K/T/E · Ctrl+S save · Ctrl+Z undo · Ctrl+Shift+Z/Ctrl+Y redo · Ctrl+G group · Ctrl+Shift+G ungroup · Delete removes selected.</p>
            </div>
          </div>

          {showOutline && (
            <aside className="whiteboard-outline-v299" aria-label="Whiteboard object outline">
              <div className="whiteboard-outline-head-v299">
                <div><strong>Outline</strong><span>{elements.length} objects</span></div>
                <ClusterButton unstyled type="button" onClick={() => setShowOutline(false)} aria-label="Close outline"><ClusterIcon name="close" /></ClusterButton>
              </div>
              <div className="whiteboard-outline-filters-v308">
                <ClusterTextInput value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} placeholder="Find object…" />
                <ClusterNativeSelect value={outlineLabelFilter} onChange={(event) => setOutlineLabelFilter(event.target.value)} aria-label="Filter outline by label">
                  <option value="">All labels</option>
                  {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
                </ClusterNativeSelect>
              </div>
              <div className="whiteboard-outline-list-v299">
                {outlineElements.length ? visibleOutlineElements.map(({ element, index, label }) => (
                  <ClusterButton unstyled type="button" key={element.id} className={selectedIds.has(element.id) ? "active" : ""} onClick={(event) => selectWhiteboardElement(element, event.metaKey || event.ctrlKey || event.shiftKey)}>
                    <span>{String(elements.length - index).padStart(2, "0")}</span>
                    <strong>{label}</strong>
                    <span className="whiteboard-outline-label-dots-v308">{(element.labelIds || []).slice(0, 3).map((labelId) => <i key={labelId} style={runtimeStyle({ background: labels.find((label) => label.id === labelId)?.color })} />)}</span>
                    {element.categoryId && <i style={runtimeStyle({ background: categories.find((category) => category.id === element.categoryId)?.color })} />}
                    <em>{[element.type, element.groupId ? "grouped" : "", element.locked ? "locked" : ""].filter(Boolean).join(" · ")}</em>
                  </ClusterButton>
                )) : <p>No matching objects.</p>}
                {hasMoreOutlineElements ? <ClusterButton variant="quiet" size="compact" onClick={() => setOutlineRenderLimit((current) => current + WHITEBOARD_OUTLINE_BATCH)}>Show {Math.min(WHITEBOARD_OUTLINE_BATCH, outlineElements.length - visibleOutlineElements.length)} more · {outlineElements.length - visibleOutlineElements.length} remaining</ClusterButton> : null}
              </div>
            </aside>
          )}

          <div id="whiteboard-keyboard-instructions-v370" className="sr-only-v370">Use the Object outline to select a whiteboard item with the keyboard. Arrow keys move the selected item by one pixel, Shift plus an arrow key moves it by ten pixels, and Delete removes an unlocked selection. Use Add image as the keyboard alternative to dropping an image onto the canvas.</div>
          <div className={`whiteboard-canvas-wrap ${imageDropActive ? "is-image-drop-target-v300" : ""}`} ref={canvasWrapRef} onDragEnter={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) { event.preventDefault(); setImageDropActive(true); } }} onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) event.preventDefault(); }} onDragLeave={() => setImageDropActive(false)} onDrop={(event) => { setImageDropActive(false); const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); void insertImageFile(file, canvasPointFromClient(event.clientX, event.clientY)); } }}>
            <svg ref={svgRef} className={`whiteboard-canvas ${tool === "eraser" ? "eraser-mode" : ""}`} data-whiteboard-tool={tool} width={Math.round(canvasWidth * zoom)} height={Math.round(canvasHeight * zoom)} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label={`${whiteboardName || "Whiteboard"} canvas`} aria-describedby="whiteboard-keyboard-instructions-v370" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => { if (!mobileTouchNavigation.pointerEnd(event)) stopDrawing(); }} onPointerCancel={(event) => { mobileTouchNavigation.pointerEnd(event); mobileTouchNavigation.cancel(); stopDrawing(); }} onPointerLeave={(event) => { if (event.pointerType !== "touch") handleCanvasLeave(); }} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                  {gridStyle === "dots" ? <circle cx={gridSize / 2} cy={gridSize / 2} r="1.6" fill={gridColor} opacity="0.65" /> : <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke={gridColor} strokeOpacity="0.55" strokeWidth="1" />}
                </pattern>
                <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.18" />
                </filter>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
                </marker>
              </defs>
              <rect width="100%" height="100%" fill={backgroundColor} />
              {showGrid && gridStyle !== "none" && <rect width="100%" height="100%" fill="url(#grid)" />}
              {renderedElements.map(renderElement)}
              {selectedElements.length > 1 && selectedBounds && (
                <rect
                  className="whiteboard-multi-selection-v489"
                  x={selectedBounds.x - 10}
                  y={selectedBounds.y - 10}
                  width={selectedBounds.width + 20}
                  height={selectedBounds.height + 20}
                  rx="12"
                  pointerEvents="none"
                />
              )}
              <WhiteboardRemotePresenceOverlay presence={remoteWhiteboardPresence} elements={elements} />
              {tool === "eraser" && eraserCursor && <circle className="eraser-cursor" cx={eraserCursor.x} cy={eraserCursor.y} r={eraserSize} fill="rgba(37, 99, 235, 0.08)" stroke="#2563eb" strokeDasharray="5 4" strokeWidth="2" />}
            </svg>
          </div>
          {showNavigator && (
            <div className="whiteboard-navigator-v299">
              <div><strong>Navigator</strong><span>{Math.round(zoom * 100)}%</span></div>
              <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} onPointerDown={handleNavigatorPointerDown} aria-label="Whiteboard navigator">
                <rect width="100%" height="100%" className="navigator-background-v299" />
                {navigatorElements.map((element) => {
                  const bounds = whiteboardElementBounds(element);
                  return <rect key={`nav-${element.id}`} x={bounds.x} y={bounds.y} width={Math.max(4, bounds.width)} height={Math.max(4, bounds.height)} className={selectedIds.has(element.id) ? "selected" : ""} />;
                })}
              </svg>
            </div>
          )}
        </div>
      )}

      <div className="whiteboard-footer-row">
        {selectedElements.length > 1 ? (
          <span>Selected: {selectedElements.length} objects{selectionGroupIds.length ? ` · ${selectionGroupIds.length} group${selectionGroupIds.length === 1 ? "" : "s"}` : ""}</span>
        ) : selectedElement ? (
          <span>
            Selected: {selectedElement.type}
            {getElementText(selectedElement) ? ` · ${getElementText(selectedElement)}` : ""}
          </span>
        ) : (
          <span>No item selected.</span>
        )}
        <span>
          {elements.length} item{elements.length === 1 ? "" : "s"} · {categories.length} layer{categories.length === 1 ? "" : "s"} · {whiteboardStats.groups} group{whiteboardStats.groups === 1 ? "" : "s"} · {presentationFrames.length} frame{presentationFrames.length === 1 ? "" : "s"} · {sectionFrames.length} section{sectionFrames.length === 1 ? "" : "s"} · {labels.length} label{labels.length === 1 ? "" : "s"} · {whiteboardStats.images} images · {Object.keys(productionMap).length} production links · {whiteboards.length} whiteboard{whiteboards.length === 1 ? "" : "s"} · zoom {Math.round(zoom * 100)}% · {autoSaveEnabled ? "autosave on" : "manual save"}
        </span>
      </div>

      {status && <div className="status-box system-status-box-v053">{status}</div>}
    </ProjectWorkspaceShell>
  );
}

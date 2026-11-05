import { boardHistoryShortcut, boardHistoryTargetContext } from "./board-history-shortcuts";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import type { BoardPlanningPayload } from "@cluster/shared";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { WorkspaceDirectory } from "../workspaces/WorkspaceDirectory";
import { DndContext, KeyboardSensor, PointerSensor, closestCorners, type DragEndEvent, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { ApiError, api, mutateApi, queryApi } from "../../core/api";
import { unique } from "../../core/storage";
import { readServerState, writeServerState } from "../../core/server-state";
import { formatDueDate } from "../../core/format";
import { runtimeStyle } from "../../core/runtime-style";
import { NumberStepper } from "../../components/NumberStepper";
import { CompactColorField } from "../../components/ColorField";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterActionMenu, ClusterBulkActionBar, ClusterRecoveryNotice } from "../../components/ClusterContextActions";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ProjectResourceSwitcher, type ProjectResourceSwitcherItem } from "../../components/ProjectResourceSwitcher";
import { ProjectWorkspaceShell } from "../../components/ProjectWorkspaceShell";
import { useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { openDesktopWorkspaceWindow } from "../../core/desktop";
import { ClusterIcon } from "../../components/ClusterIcon";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { displayUserName, presenceLabel, presenceState, userInitial } from "../people/people-utils";
import { PeoplePicker } from "../people/PeoplePicker";
import { openContextualCreate } from "../create/shared-create-handoff";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { BoardCardPlanningFields } from "./BoardCardPlanningFields";
import { BoardFilterPanel } from "./BoardFilterPanel";
import { BoardCalendarView, BoardListView, BoardTableView, BoardTimelineView, type BoardViewMode, type BoardViewRow } from "./BoardAlternativeViews";
import { BoardCardTile, isCardOverdue } from "./BoardCardTile";
import { BoardPlanningInsights } from "./BoardPlanningInsights";
import { boardActiveBlockerRows } from "./board-planning-intelligence";
import { addVisibleBoardSelection, countVisibleBoardSelection, pruneBoardSelection, removeVisibleBoardSelection } from "./board-selection-projection";
import { BOARD_TEMPLATES, boardTemplateColumns, type BoardTemplateId } from "./board-templates";
import { BOARD_APPEARANCE_PRESETS, DEFAULT_BOARD_LABELS, boardThemeBackground } from "./board-appearance";
import { EMPTY_BOARD_MOVE_HISTORY, recordBoardCardMove, completeBoardCardMove, discardConflictedBoardCard, canReplayBoardSavedMove, type BoardCardMoveHistory } from "./board-card-move-history";
import { executeBoardBulk, describeBoardBulkOutcome, type BoardBulkResult } from "./board-bulk-runner";
import { boardCardMatches, buildBoardCardSearchIndex, buildBoardUserIndex, collectBoardCategories, collectBoardLabels, flattenBoardCards, sortBoardCards, summarizeBoardCards, type BoardIssueFilter, type BoardSortMode, type BoardViewPreset } from "./board-workspace-model";
import { projectStatusLabel, projectStatusMeta } from "../projects/projects-utils";
import { CollaborationQueuePanel, CollaborationStrip, collaborationColor, useToolCollaboration, type CollaborationEntityRef, type CollaborationPresence } from "../collaboration";
import type { Board, BoardLabelDefinition, BoardList, BoardSummary, Card, ChecklistItem, Priority, Project, Settings, User, UserActivitySummary } from "../application/application-models";
import "./board-performance.css";
import "./board-workspace.css";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { subscribeProjectWorkflowUpdate, useProjectWorkflowList } from "../../core/project-workflow-storage";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SharedWorkActivityPanel } from "../../components/SharedWorkActivityPanel";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { ResourceSyncBadge } from "../../components/SyncStatusIndicator";
import { BoardArchiveTray, BoardManagerModal, CardModal, ColumnSettingsModal } from "./BoardWorkspaceDialogs";
import {
  BOARD_CARD_RENDER_BATCH,
  DroppableList,
  boardOptions,
  boardSavedViewName,
  toDateInputValue,
  type BoardGroupMode,
  type BoardSavedView,
  type BoardSharedViewRecord,
} from "./board-workspace-state";

export type BoardWorkspacePageProps = {
  board: Board | null;
  projects: Project[];
  currentUser: User;
  currentBoardId: string | null;
  onSelectBoard: (boardId: string | null) => void;
  onRefresh: () => Promise<void>;
  onRefreshProjects: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenTickets: (projectId: string) => void;
  onOpenTimeline: (projectId: string) => void;
  onOpenTime: (projectId: string) => void;
  onCloseBoard: () => void;
  components: {
    RelatedRecordsPanel: ComponentType<any>;
    CustomFieldValuesPanel: ComponentType<any>;
    VersionHistoryPanel: ComponentType<any>;
  };
};

export function BoardWorkspacePage({ board, projects, currentUser, currentBoardId, onSelectBoard, onRefresh, onRefreshProjects, onOpenSettings, onOpenProject, onOpenTickets, onOpenTimeline, onOpenTime, components }: BoardWorkspacePageProps) {
  const { RelatedRecordsPanel, CustomFieldValuesPanel, VersionHistoryPanel } = components;
  const [newCardListId, setNewCardListId] = useState<string | null>(null);
  const [quickCardListId, setQuickCardListId] = useState<string | null>(null);
  const [quickCardTitle, setQuickCardTitle] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [labelFilter, setLabelFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortMode, setSortMode] = useState<BoardSortMode>("manual");
  const [viewMode, setViewMode] = useState<BoardViewMode>("kanban");
  const [savedViews, setSavedViews] = useState<BoardSavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => new Set());
  const [bulkListId, setBulkListId] = useState("");
  const [bulkPriority, setBulkPriority] = useState<Priority | "">("");
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [bulkDeferredUntil, setBulkDeferredUntil] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkOperationBusyRef = useRef(false);
  const bulkOperationAbortRef = useRef<AbortController | null>(null);
  const [showSelectionDiscussion, setShowSelectionDiscussion] = useState(false);
  const [issueFilter, setIssueFilter] = useState<BoardIssueFilter>("all");
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [hideDone, setHideDone] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAdvancedView, setShowAdvancedView] = useState(false);
  const [showBoardManager, setShowBoardManager] = useState(false);
  const [showArchiveTray, setShowArchiveTray] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [planningPayload, setPlanningPayload] = useState<BoardPlanningPayload | null>(null);
  const [planningError, setPlanningError] = useState("");
  const [planningRefreshTick, setPlanningRefreshTick] = useState(0);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [inlineListTitles, setInlineListTitles] = useState<Record<string, string>>({});
  const [showColumnCreator, setShowColumnCreator] = useState(false);
  const [showBoardSetup, setShowBoardSetup] = useState(false);
  const [editingColumn, setEditingColumn] = useState<BoardList | null>(null);
  const [categoryStatus, setCategoryStatus] = useState("");
  const [moveHistory, setMoveHistory] = useState<BoardCardMoveHistory>(EMPTY_BOARD_MOVE_HISTORY);
  const moveOperationBusyRef = useRef(false);
  const [lastArchivedCard, setLastArchivedCard] = useState<{ cardId: string; title: string; revision: number } | null>(null);
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [viewPreset, setViewPreset] = useState<BoardViewPreset>("all");
  const [hideEmptyLists, setHideEmptyLists] = useState(false);
  const [laneWidth, setLaneWidth] = useState<"narrow" | "standard" | "wide">("standard");
  const [groupMode, setGroupMode] = useState<BoardGroupMode>("none");
  const [collapsedListState, setCollapsedListState] = useState<Record<string, boolean>>({});
  const [renderLimitByList, setRenderLimitByList] = useState<Record<string, number>>({});
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hydratedBoardViewRef = useRef<string | null>(null);
  const [boardName, setBoardName] = useState(board?.name || "New Board");
  const [boardDescription, setBoardDescription] = useState(board?.description || "");
  const [boardBackgroundColor, setBoardBackgroundColor] = useState(board?.backgroundColor || "#2563eb");
  const [boardBackgroundStyle, setBoardBackgroundStyle] = useState<"soft" | "solid" | "gradient">(board?.backgroundStyle || "soft");
  const [boardLabelDefinitions, setBoardLabelDefinitions] = useState<BoardLabelDefinition[]>(board?.labelDefinitions?.length ? board.labelDefinitions : DEFAULT_BOARD_LABELS);
  const [newBoardLabelName, setNewBoardLabelName] = useState("");
  const [newBoardLabelColor, setNewBoardLabelColor] = useState("#2563eb");
  const [boardProjectId, setBoardProjectId] = useState(board?.project.id || projects[0]?.id || "");
  const [boardTemplate, setBoardTemplate] = useState<BoardTemplateId>("kanban");
  const [boardManagerStatus, setBoardManagerStatus] = useState("");
  const [workspaceWindowStatus, setWorkspaceWindowStatus] = useState("");
  const resourceWindow = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterWindow") === "resource";
  const canOpenWorkspaceWindow = typeof window !== "undefined" && Boolean(window.clusterDesktop?.openWorkspaceWindow);
  const boardCollaboration = useToolCollaboration("board", board?.id || null, board?.project.id || null);
  const [sharedViews, setSharedViews, sharedViewSync] = useProjectWorkflowList<BoardSharedViewRecord>("boardView", board?.project.id || "");
  const boardSharedViews = useMemo(() => sharedViews.filter((item) => item.boardId === board?.id).slice(0, 24), [sharedViews, board?.id]);
  const allSavedViews = useMemo(() => [...savedViews, ...boardSharedViews], [savedViews, boardSharedViews]);
  const remoteBoardPresence = useMemo(() => boardCollaboration.presence.filter((item) => item.userId !== boardCollaboration.me?.id), [boardCollaboration.presence, boardCollaboration.me?.id]);
  const remoteEditorByEntity = useMemo(() => {
    const editors = new Map<string, CollaborationPresence>();
    remoteBoardPresence.forEach((item) => {
      if (item.editing?.entityType && item.editing.entityId) editors.set(`${item.editing.entityType}:${item.editing.entityId}`, item);
    });
    return editors;
  }, [remoteBoardPresence]);
  const lastBoardChangeRef = useRef<{ resourceId: string; sequence: number }>({
    resourceId: "",
    sequence: 0,
  });
  const remoteEditor = useCallback((entityType: string, entityId: string) => remoteEditorByEntity.get(`${entityType}:${entityId}`) || null, [remoteEditorByEntity]);
  const restoreCardDetail = useCallback((id: string | null) => {
    if (!id) { setSelectedCard(null); return; }
    const card = board?.lists.flatMap((list) => list.cards).find((item) => item.id === id) || null;
    if (card) setSelectedCard(card);
  }, [board]);
  const cardDetailHistory = useClusterDetailHistory("card", selectedCard?.id || null, restoreCardDetail);
  const openCardForEdit = useCallback(async (card: Card) => {
    const editor = remoteEditor("card", card.id);
    if (editor && !await confirmCluster({ title: "Open card being edited?", message: `${editor.userName} is currently editing “${card.title}”. Open it anyway?`, confirmLabel: "Open anyway" })) return;
    cardDetailHistory.openDetail(card.id);
  }, [remoteEditor, cardDetailHistory]);
  const startListRename = useCallback(async (list: BoardList) => {
    const editor = remoteEditor("board-list", list.id);
    if (editor && !await confirmCluster({ title: "Rename list being edited?", message: `${editor.userName} is currently editing “${list.title}”. Open it anyway?`, confirmLabel: "Open anyway" })) return;
    setEditingListId(list.id);
  }, [remoteEditor]);
  useEffect(() => {
    let activity = "viewing board";
    let selection: CollaborationEntityRef | null = null;
    let editing: CollaborationEntityRef | null = null;
    if (selectedCard) {
      activity = "editing a card";
      selection = {
        entityType: "card",
        entityId: selectedCard.id,
        label: selectedCard.title,
      };
      editing = selection;
    } else if (editingColumn) {
      activity = "editing column settings";
      selection = {
        entityType: "board-list",
        entityId: editingColumn.id,
        label: editingColumn.title,
      };
      editing = selection;
    } else if (editingListId) {
      const list = board?.lists.find((item) => item.id === editingListId);
      activity = "renaming a column";
      selection = {
        entityType: "board-list",
        entityId: editingListId,
        label: list?.title || "Column",
      };
      editing = selection;
    } else if (newCardListId || quickCardListId) {
      activity = "creating a card";
      selection = {
        entityType: "board-list",
        entityId: newCardListId || quickCardListId || "",
        label: board?.lists.find((item) => item.id === (newCardListId || quickCardListId))?.title || "Column",
      };
    } else if (moving) {
      activity = "moving a card";
    }
    boardCollaboration.updatePresence({ activity, selection, editing }, true);
  }, [selectedCard?.id, editingColumn?.id, editingListId, newCardListId, quickCardListId, moving, board?.id]);
  useEffect(() => {
    if (!board?.id) return;
    if (lastBoardChangeRef.current.resourceId !== board.id) {
      lastBoardChangeRef.current = {
        resourceId: board.id,
        sequence: boardCollaboration.changeSequence,
      };
      return;
    }
    if (!boardCollaboration.changeSequence || boardCollaboration.changeSequence <= lastBoardChangeRef.current.sequence) return;
    lastBoardChangeRef.current.sequence = boardCollaboration.changeSequence;
    if (selectedCard || editingColumn || editingListId || newCardListId || moving) return;
    const timer = window.setTimeout(() => {
      onRefresh().catch(() => null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [board?.id, boardCollaboration.changeSequence, selectedCard?.id, editingColumn?.id, editingListId, newCardListId, moving, onRefresh]);
  useVisibleRefresh(onRefresh, {
    enabled: Boolean(board?.id) && boardCollaboration.connection.transport !== "stream" && !selectedCard && !editingColumn && !editingListId && !newCardListId && !moving,
    intervalMs: 60_000,
  });
  const loadAdminUsers = useCallback(async () => {
    const result = await queryApi<UserActivitySummary[]>("/api/users?limit=500", { staleMs: 30_000, maxAgeMs: 30 * 60 * 1000, tags: ["users", "board"] });
    setUsers(result);
    return result;
  }, []);
  useEffect(() => {
    void loadAdminUsers().catch(() => setUsers([]));
  }, [loadAdminUsers]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const boards = useMemo(() => boardOptions(projects), [projects]);
  const listSignature = board?.lists.map((list) => `${list.id}:${list.title}`).join("|") || "";
  useEffect(() => {
    if (!board) return;
    setInlineListTitles(Object.fromEntries(board.lists.map((list) => [list.id, list.title])));
  }, [board?.id, listSignature]);
  useEffect(() => {
    if (board) {
      setBoardName(board.name);
      setBoardDescription(board.description || "");
      setBoardProjectId(board.project.id);
      setBoardBackgroundColor(board.backgroundColor || "#2563eb");
      setBoardBackgroundStyle(board.backgroundStyle || "soft");
      setBoardLabelDefinitions(board.labelDefinitions?.length ? board.labelDefinitions : DEFAULT_BOARD_LABELS);
      setShowBoardSetup(false);
      return;
    }
    setBoardName("New Board");
    setBoardDescription("");
    setBoardProjectId((current) => current || projects[0]?.id || "");
    setBoardBackgroundColor("#2563eb");
    setBoardBackgroundStyle("soft");
    setBoardLabelDefinitions(DEFAULT_BOARD_LABELS);
    setShowBoardSetup(true);
  }, [board?.id, projects]);
  useEffect(() => {
    setMoveHistory(EMPTY_BOARD_MOVE_HISTORY);
  }, [board?.id]);
  useEffect(() => {
    if (!board?.id) return;
    hydratedBoardViewRef.current = "";
    void readServerState<{
      density?: "compact" | "comfortable";
      hideDone?: boolean;
      hideEmptyLists?: boolean;
      laneWidth?: "narrow" | "standard" | "wide";
      viewPreset?: BoardViewPreset;
      sortMode?: "manual" | "due" | "priority" | "title";
      viewMode?: BoardViewMode;
      savedViews?: BoardSavedView[];
      collapsedListState?: Record<string, boolean>;
      groupMode?: BoardGroupMode;
    }>("user", `boards.view.${board.id}`, {}, true).then((stored) => {
      setDensity(stored.density === "compact" ? "compact" : "comfortable");
      setHideDone(Boolean(stored.hideDone));
      setHideEmptyLists(Boolean(stored.hideEmptyLists));
      setLaneWidth(stored.laneWidth || "standard");
      setViewPreset(stored.viewPreset || "all");
      setSortMode(stored.sortMode || "manual");
      setViewMode(["kanban", "list", "table", "timeline", "calendar"].includes(String(stored.viewMode)) ? stored.viewMode as BoardViewMode : "kanban");
      setSavedViews(Array.isArray(stored.savedViews) ? stored.savedViews.slice(0, 8) : []);
      setActiveSavedViewId("");
      setSelectedCardIds(new Set());
      setCollapsedListState(stored.collapsedListState || {});
      setGroupMode(["assignee", "priority", "category"].includes(String(stored.groupMode)) ? stored.groupMode as BoardGroupMode : "none");
      hydratedBoardViewRef.current = board.id;
    }).catch(() => { setCollapsedListState({}); hydratedBoardViewRef.current = board.id; });
  }, [board?.id]);
  useEffect(() => {
    if (!board?.id || hydratedBoardViewRef.current !== board.id) return;
    const timer = window.setTimeout(() => {
      void writeServerState("user", `boards.view.${board.id}`, { density, hideDone, hideEmptyLists, laneWidth, viewPreset, sortMode, viewMode, savedViews, collapsedListState, groupMode });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [board?.id, density, hideDone, hideEmptyLists, laneWidth, viewPreset, sortMode, viewMode, savedViews, collapsedListState, groupMode]);
  useEffect(() => {
    function handleBoardShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (!typing && event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current && query) {
        event.preventDefault();
        setQuery("");
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleBoardShortcut);
    return () => window.removeEventListener("keydown", handleBoardShortcut);
  }, [query]);
  const moveCardToList = useCallback(async (cardId: string, targetListId: string, targetIndex?: number) => {
    if (!board || !targetListId || moveOperationBusyRef.current) return;
    moveOperationBusyRef.current = true;
    const currentList = board.lists.find((list) => list.cards.some((card) => card.id === cardId));
    if (!currentList) { moveOperationBusyRef.current = false; return; }
    const fromIndex = currentList.cards.findIndex((item) => item.id === cardId);
    if (currentList.id === targetListId && (targetIndex === undefined || targetIndex === fromIndex)) { moveOperationBusyRef.current = false; return; }
    setMoving(true);
    try {
      const card = currentList.cards.find((item) => item.id === cardId);
      const targetList = board.lists.find((list) => list.id === targetListId);
      const targetLabel = targetList?.title || "column";
      if (!targetList) throw new Error("Destination column is no longer available.");
      const result = await boardCollaboration.mutate<Card>({
        path: `/api/cards/${cardId}/move`,
        method: "POST",
        body: { listId: targetListId, ...(targetIndex === undefined ? {} : { index: targetIndex }), expectedRevision: card?.revision || 1 },
        label: currentList.id === targetListId ? `Reorder ${card?.title || "card"}` : `Move ${card?.title || "card"} to ${targetLabel}`,
        entityType: "card",
        entityId: cardId,
      });
      if (result.queued) {
        setMoveHistory(EMPTY_BOARD_MOVE_HISTORY);
        setCategoryStatus(`Move queued for reconnect: ${card?.title || "card"} → ${targetLabel}.`);
      } else {
        const movedCard = result.result || card;
        await boardCollaboration.publish(
          currentList.id === targetListId ? "reordered a card" : "moved a card",
          targetLabel,
          { entityType: "card", entityId: cardId, label: movedCard?.title || "Card" },
          false,
        ).catch(() => undefined);
        // Never invent an expectedRevision for history when the server omitted one.
        if (Number.isSafeInteger(result.result?.revision) && Number(result.result?.revision) > (card?.revision || 0)) {
          setMoveHistory((history) => recordBoardCardMove(history, {
            cardId, title: movedCard?.title || card?.title || "Card", fromListId: currentList.id, fromIndex,
            toListId: targetListId,
            toIndex: targetIndex === undefined ? (currentList.id === targetListId ? Math.max(0, targetList.cards.length - 1) : targetList.cards.length) : targetIndex,
            revision: Number(result.result?.revision),
          }));
        } else {
          setMoveHistory(EMPTY_BOARD_MOVE_HISTORY);
          setCategoryStatus("Card moved, but no reliable server revision was returned. Move history has been cleared.");
        }
        if (Number.isSafeInteger(result.result?.revision)) setCategoryStatus(currentList.id === targetListId ? `${movedCard?.title || card?.title || "Card"} reordered in ${targetLabel}.` : `${movedCard?.title || card?.title || "Card"} moved to ${targetLabel}.`);
        await onRefresh();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setMoveHistory((history) => discardConflictedBoardCard(history, cardId));
      setCategoryStatus(error instanceof ApiError && error.status === 409 ? "Card changed remotely. The board has been refreshed; review the new position before moving it again." : error instanceof Error ? error.message : "Card move failed.");
      await onRefresh().catch(() => undefined);
    } finally {
      setMoving(false);
      moveOperationBusyRef.current = false;
    }
  }, [board, boardCollaboration, onRefresh]);
  const boardSavedMoveAllowed = canReplayBoardSavedMove({
    connection: boardCollaboration.connection.state,
    queuedStatuses: boardCollaboration.queuedMutations.map((mutation) => mutation.status),
    busy: moving,
  });
  async function replayBoardCardMove(direction: "undo" | "redo") {
    if (!board || moveOperationBusyRef.current) return;
    if (!boardSavedMoveAllowed) {
      setCategoryStatus("Saved move history is paused while disconnected, reconnecting or resolving queued Board edits. Keep the current revision safe and retry after sync.");
      return;
    }
    const entry = moveHistory[direction].at(-1);
    if (!entry) return;
    moveOperationBusyRef.current = true;
    setMoving(true);
    try {
      const result = await boardCollaboration.mutate<Card>({
        path: `/api/cards/${entry.cardId}/move`, method: "POST",
        body: { listId: direction === "undo" ? entry.fromListId : entry.toListId,
          index: direction === "undo" ? entry.fromIndex : entry.toIndex,
          expectedRevision: entry.revision },
        label: `${direction === "undo" ? "Undo" : "Redo"} move ${entry.title}`,
        entityType: "card", entityId: entry.cardId,
      });
      if (result.queued) {
        // A queued operation has no authoritative new revision and must not be
        // replayed a second time through local history.
        setMoveHistory(EMPTY_BOARD_MOVE_HISTORY);
        setCategoryStatus(`${direction === "undo" ? "Undo" : "Redo"} queued for reconnect. History cleared until the server confirms the move.`);
        return;
      }
      const nextRevision = result.result?.revision;
      if (!Number.isSafeInteger(nextRevision) || Number(nextRevision) <= entry.revision) {
        setMoveHistory(EMPTY_BOARD_MOVE_HISTORY);
        setCategoryStatus("Move was applied, but the server did not return a trustworthy revision. Refresh before editing again.");
        return;
      }
      setMoveHistory((history) => completeBoardCardMove(history, direction, entry.cardId, Number(nextRevision)));
      await boardCollaboration.publish(direction === "undo" ? "undid a card move" : "redid a card move", entry.title,
        { entityType: "card", entityId: entry.cardId, label: entry.title }, false).catch(() => undefined);
      await onRefresh();
      setCategoryStatus(`${direction === "undo" ? "Undid" : "Redid"} move for ${entry.title}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMoveHistory((history) => discardConflictedBoardCard(history, entry.cardId));
        setCategoryStatus(`Cannot ${direction} ${entry.title}: someone changed this card. Its stale history was discarded.`);
      } else setCategoryStatus(error instanceof Error ? `Could not ${direction} move: ${error.message}` : `Could not ${direction} the card move.`);
      await onRefresh().catch(() => undefined);
    } finally {
      setMoving(false);
      moveOperationBusyRef.current = false;
    }
  }
  async function undoLastCardMove() { await replayBoardCardMove("undo"); }
  async function redoLastCardMove() { await replayBoardCardMove("redo"); }
  useEffect(() => {
    function handleMoveHistoryShortcuts(event: KeyboardEvent) {
      if (!board) return;
      const context = boardHistoryTargetContext(event.target as Element | null);
      const direction = boardHistoryShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, shiftKey: event.shiftKey, ...context });
      if (!direction || !moveHistory[direction].length || moveOperationBusyRef.current || !boardSavedMoveAllowed) return;
      event.preventDefault();
      void replayBoardCardMove(direction);
    }
    window.addEventListener("keydown", handleMoveHistoryShortcuts);
    return () => window.removeEventListener("keydown", handleMoveHistoryShortcuts);
  }, [board?.id, moveHistory, boardSavedMoveAllowed, boardCollaboration, onRefresh]);
  async function undoLastCardArchive() {
    if (!lastArchivedCard) return;
    const archived = lastArchivedCard;
    setLastArchivedCard(null);
    try {
      const result = await mutateApi<Card>(`/api/cards/${archived.cardId}`, {
        method: "PATCH",
        body: { archived: false, expectedRevision: archived.revision },
        label: `Restore ${archived.title}`,
        dedupeKey: `card:${archived.cardId}`,
        entityType: "card",
        entityId: archived.cardId,
        resourceKind: "card",
        resourceId: archived.cardId,
        baseRevision: archived.revision,
        localSnapshot: { archived: false },
        changedFields: ["archived"],
        invalidate: ["/api/projects", "/api/boards"],
      });
      setCategoryStatus(result.queued ? `${archived.title} restore queued for synchronization.` : `${archived.title} restored to the board.`);
      if (!result.queued) {
        await boardCollaboration.publish("restored a card", archived.title, { entityType: "card", entityId: archived.cardId, label: archived.title }, false);
        await onRefresh();
      }
    } catch (error) {
      setCategoryStatus(error instanceof Error ? `Could not restore archived card: ${error.message}` : "Could not restore the archived card.");
      await onRefresh().catch(() => undefined);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!board || !activeId.startsWith("card:") || !overId) return;
    const cardId = activeId.replace("card:", "");
    let targetListId = "";
    let targetIndex: number | undefined;
    if (overId.startsWith("list:")) {
      targetListId = overId.replace("list:", "");
      targetIndex = board.lists.find((list) => list.id === targetListId)?.cards.length || 0;
    }
    if (overId.startsWith("card:")) {
      const overCardId = overId.replace("card:", "");
      const targetList = board.lists.find((list) => list.cards.some((card) => card.id === overCardId));
      targetListId = targetList?.id || "";
      targetIndex = targetList?.cards.findIndex((card) => card.id === overCardId);
    }
    await moveCardToList(cardId, targetListId, targetIndex);
  }
  const moveCardByColumn = useCallback((card: Card, direction: "previous" | "next") => {
    if (!board) return;
    const currentIndex = board.lists.findIndex((list) => list.id === card.listId || list.cards.some((item) => item.id === card.id));
    const targetIndex = currentIndex + (direction === "previous" ? -1 : 1);
    const target = board.lists[targetIndex];
    if (!target) return;
    void moveCardToList(card.id, target.id, target.cards.length);
  }, [board, moveCardToList]);
  const reorderCardWithinColumn = useCallback((card: Card, direction: "up" | "down") => {
    if (!board) return;
    const list = board.lists.find((item) => item.id === card.listId || item.cards.some((candidate) => candidate.id === card.id));
    if (!list) return;
    const currentIndex = list.cards.findIndex((candidate) => candidate.id === card.id);
    const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= list.cards.length) return;
    void moveCardToList(card.id, list.id, targetIndex);
  }, [board, moveCardToList]);
  async function saveColumn(settings: { title: string; description?: string; color?: string; wipLimit?: number | null; isDone?: boolean; collapsed?: boolean; assignedUserIds?: string[] }) {
    if (!board) return;
    setCategoryStatus(editingColumn ? "Saving column settings..." : "Creating column...");
    if (editingColumn) {
      const result = await boardCollaboration.mutate({
        path: `/api/lists/${editingColumn.id}`,
        method: "PATCH",
        body: { ...settings, expectedRevision: editingColumn.revision || 1 },
        label: `Update column ${settings.title}`,
        entityType: "board-list",
        entityId: editingColumn.id,
      });
      if (result.queued) {
        setEditingColumn(null);
        setCategoryStatus(`Column change queued for reconnect: ${settings.title}.`);
        return;
      }
      await boardCollaboration.publish(
        "updated a column",
        settings.title,
        {
          entityType: "board-list",
          entityId: editingColumn.id,
          label: settings.title,
        },
        false,
      );
      setEditingColumn(null);
      setCategoryStatus("Column updated.");
    } else {
      await api(`/api/boards/${board.id}/lists`, {
        method: "POST",
        body: JSON.stringify(settings),
      });
      await boardCollaboration.publish("created a column", settings.title, null, false);
      setShowColumnCreator(false);
      setCategoryStatus("Column created.");
    }
    await onRefresh();
  }
  async function renameCategory(list: BoardList) {
    const title = inlineListTitles[list.id]?.trim();
    if (!title || title === list.title) {
      setEditingListId(null);
      return;
    }
    setCategoryStatus("Saving column...");
    const result = await boardCollaboration.mutate({
      path: `/api/lists/${list.id}`,
      method: "PATCH",
      body: { title, expectedRevision: list.revision || 1 },
      label: `Rename column ${list.title}`,
      entityType: "board-list",
      entityId: list.id,
    });
    if (result.queued) {
      setEditingListId(null);
      setCategoryStatus(`Column rename queued for reconnect: ${title}.`);
      return;
    }
    setEditingListId(null);
    await onRefresh();
    setCategoryStatus("Column renamed.");
  }
  async function deleteCategory(list: BoardList) {
    if (!Number.isSafeInteger(list.revision) || !list.revision) { setCategoryStatus("Refresh the column before archiving it."); return; }
    if (!await confirmCluster({ title: "Archive column?", message: `Archive "${list.title}"? Active Cards and Tickets must be moved or archived first. Historical archived Cards are preserved and the column can be restored from Board tools.`, confirmLabel: "Archive column", tone: "danger" })) return;
    setCategoryStatus("Archiving column...");
    try {
      await api(`/api/lists/${list.id}/lifecycle`, { method: "POST", body: JSON.stringify({ action: "archive", expectedRevision: list.revision }) });
      await onRefresh();
      setCategoryStatus("Column archived. Restore it from Board tools when needed.");
    } catch (error) { setCategoryStatus(error instanceof Error ? error.message : "Could not archive column."); }
  }
  async function moveCategory(list: BoardList, direction: "left" | "right") {
    if (!Number.isSafeInteger(list.revision) || !list.revision) {
      setCategoryStatus("This column needs a fresh revision before it can move.");
      await onRefresh();
      return;
    }
    setCategoryStatus("Moving column...");
    try {
      await api(`/api/lists/${list.id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ direction, expectedRevision: list.revision }),
      });
      await onRefresh();
      setCategoryStatus("Column moved.");
    } catch (error) {
      await onRefresh();
      setCategoryStatus(error instanceof Error ? error.message : "Column changed elsewhere. Refresh and retry.");
    }
  }
  async function restoreColumnSettings(list: BoardList, direction: "undo" | "redo") {
    if (!boardSavedMoveAllowed) {
      setCategoryStatus("Column history is paused until this Board is connected and its queued changes are resolved.");
      return;
    }
    setCategoryStatus(`Checking saved settings for ${list.title}...`);
    try {
      // Fetch on intent, not once per column: history must be current and permission-filtered.
      const history = await api<{ currentRevision: number; canUndo: boolean; canRedo: boolean;
        operations: Array<{ id: string; action: string }> }>(`/api/lists/${list.id}/saved-history`);
      if (!(direction === "undo" ? history.canUndo : history.canRedo) || !history.operations[0]) {
        setCategoryStatus(`No reversible ${direction} is available for ${list.title}. Only your latest uninterrupted saved column edit can be reversed.`);
        return;
      }
      await api(`/api/lists/${list.id}/saved-history/${direction}`, { method: "POST",
        body: JSON.stringify({ expectedRevision: history.currentRevision, operationId: history.operations[0].id }) });
      await onRefresh();
      setCategoryStatus(`Column edit ${direction === "undo" ? "undone" : "redone"} and saved on the server.`);
    } catch (error) {
      await onRefresh();
      setCategoryStatus(error instanceof Error ? `Column history not changed: ${error.message}` : "Column history not changed. Refresh and try again.");
    }
  }

  async function createBoardFromPanel() {
    if (!boardProjectId) {
      setBoardManagerStatus("Pick a project first.");
      return;
    }
    setBoardManagerStatus("Creating board...");
    const created = await api<BoardSummary>(`/api/projects/${boardProjectId}/boards`, {
      method: "POST",
      body: JSON.stringify({
        name: boardName.trim() || "New Board",
        description: boardDescription.trim() || null,
        backgroundColor: boardBackgroundColor || null,
        backgroundStyle: boardBackgroundStyle,
        labelDefinitions: boardLabelDefinitions,
        columns: boardTemplateColumns(boardTemplate),
        template: boardTemplate === "project-default" ? "project-default" : undefined,
      }),
    });
    await onRefreshProjects();
    onSelectBoard(created.id);
    setBoardManagerStatus("Board created.");
  }
  async function quickCreateCard(listId: string) {
    const title = quickCardTitle.trim();
    if (!title || quickAdding) return;
    setQuickAdding(true);
    setCategoryStatus("Adding card...");
    try {
      await api("/api/cards", { method: "POST", body: JSON.stringify({ listId, title, description: "", priority: "medium", labels: [], memberIds: [], watcherIds: [] }) });
      setQuickCardTitle("");
      await onRefresh();
      setCategoryStatus("Card added. Keep typing to add another.");
    } catch (error) {
      setCategoryStatus(error instanceof Error ? error.message : "Card could not be added.");
    } finally {
      setQuickAdding(false);
    }
  }
  async function saveBoardFromPanel() {
    if (!board) {
      await createBoardFromPanel();
      return;
    }
    setBoardManagerStatus("Saving board...");
    const result = await boardCollaboration.mutate({
      path: `/api/boards/${board.id}`,
      method: "PATCH",
      body: {
        name: boardName.trim() || board.name,
        description: boardDescription.trim() || null,
        backgroundColor: boardBackgroundColor || null,
        backgroundStyle: boardBackgroundStyle,
        labelDefinitions: boardLabelDefinitions,
        expectedRevision: board.revision || 1,
      },
      label: `Update board ${board.name}`,
      entityType: "board",
      entityId: board.id,
    });
    if (result.queued) {
      setBoardManagerStatus("Board settings queued for reconnect.");
      return;
    }
    await onRefreshProjects();
    await onRefresh();
    setBoardManagerStatus("Board saved.");
  }
  function startNewBoard() {
    onSelectBoard(null);
    setBoardName("New Board");
    setBoardDescription("");
    setBoardProjectId(board?.project.id || projects[0]?.id || "");
    setBoardBackgroundColor("#2563eb");
    setBoardBackgroundStyle("soft");
    setBoardLabelDefinitions(DEFAULT_BOARD_LABELS);
    setBoardTemplate("kanban");
    setBoardManagerStatus("Ready for a new board.");
  }
  async function deleteBoardFromPanel() {
    if (!board) return;
    if (!await confirmCluster({ title: "Delete board?", message: `Delete board "${board.name}" and every card in it?`, confirmLabel: "Delete board", tone: "danger" })) return;
    setBoardManagerStatus("Deleting board...");
    const nextBoard = boards.find((item) => item.projectId === board.project.id && item.id !== board.id) || boards.find((item) => item.id !== board.id) || null;
    await api(`/api/boards/${board.id}`, { method: "DELETE" });
    onSelectBoard(nextBoard?.id || null);
    await onRefreshProjects().catch(() => undefined);
    setBoardManagerStatus("Board deleted.");
  }
  const cards = useMemo(() => flattenBoardCards(board), [board]);
  const cardRevisionKey = useMemo(() => cards.map((card) => `${card.id}:${card.revision || 0}`).join("|"), [cards]);
  useEffect(() => {
    if (!board?.project.id) return undefined;
    return subscribeProjectWorkflowUpdate((detail) => {
      if (detail.kind !== "relationship" || detail.projectId !== board.project.id) return;
      setPlanningRefreshTick((value) => value + 1);
    });
  }, [board?.project.id]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    if (!board?.id) { setPlanningPayload(null); setPlanningError(""); return () => { cancelled = true; }; }
    setPlanningError("");
    timer = window.setTimeout(() => {
      queryApi<BoardPlanningPayload>(`/api/boards/${encodeURIComponent(board.id)}/planning`, { staleMs: 15_000, maxAgeMs: 60_000, tags: ["boards", "planning", board.id] })
        .then((payload) => { if (!cancelled) setPlanningPayload(payload); })
        .catch((error) => { if (!cancelled) { setPlanningPayload(null); setPlanningError(error instanceof Error ? error.message : "Board planning intelligence could not be loaded."); } });
    }, 180);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [board?.id, cardRevisionKey, planningRefreshTick]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const labels = useMemo(() => collectBoardLabels(cards), [cards]);
  const cardCategories = useMemo(() => collectBoardCategories(cards), [cards]);
  const userById = useMemo(() => buildBoardUserIndex(users), [users]);
  const cardSearchIndex = useMemo(() => buildBoardCardSearchIndex(cards, userById), [cards, userById]);
  const doneList = useMemo(() => board?.lists.find((list) => list.isDone || list.title.toLowerCase().includes("done")) || null, [board]);
  const backlogList = useMemo(() => (board ? board.lists.find((list) => list.title.toLowerCase().includes("backlog")) || board.lists[0] : null), [board]);
  const visibleLists = useMemo(() => (!board ? [] : hideDone && doneList ? board.lists.filter((list) => list.id !== doneList.id) : board.lists), [board, hideDone, doneList]);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  // Planning responses can outlive a Board switch. Never apply the old
  // Board's relationships or projected Done states to the newly selected one.
  const activePlanningPayload = planningPayload?.boardId === board?.id ? planningPayload : null;
  const localCardIds = useMemo(() => new Set(cards.map((card) => card.id)), [cards]);
  const doneCardIds = useMemo(() => {
    const ids = new Set((board?.lists || []).filter((list) => list.isDone).flatMap((list) => list.cards.map((card) => card.id)));
    for (const projection of activePlanningPayload?.projections || []) {
      if (projection.owningListDone) ids.add(projection.cardId);
    }
    return ids;
  }, [board, activePlanningPayload?.projections]);
  const blockedCardIds = useMemo(() => new Set(
    boardActiveBlockerRows(activePlanningPayload?.dependencies || [], doneCardIds, localCardIds)
      .map((row) => row.blockedCardId),
  ), [activePlanningPayload?.dependencies, doneCardIds, localCardIds]);
  const cardFilters = useMemo(() => ({ normalizedQuery, priorityFilter, labelFilter, categoryFilter, issueFilter, assigneeFilter, viewPreset, currentUserId: currentUser.id, blockedCardIds }), [normalizedQuery, priorityFilter, labelFilter, categoryFilter, issueFilter, assigneeFilter, viewPreset, currentUser.id, blockedCardIds]);
  const visibleCardsByList = useMemo(() => new Map(visibleLists.map((list) => [
    list.id,
    sortBoardCards(list.cards.filter((card) => boardCardMatches(card, cardSearchIndex.get(card.id) || "", cardFilters)), sortMode),
  ])), [visibleLists, cardSearchIndex, cardFilters, sortMode]);
  const renderedLists = useMemo(() => hideEmptyLists ? visibleLists.filter((list) => (visibleCardsByList.get(list.id) || []).length > 0) : visibleLists, [hideEmptyLists, visibleLists, visibleCardsByList]);
  useEffect(() => {
    setRenderLimitByList({});
  }, [board?.id, deferredQuery, priorityFilter, labelFilter, categoryFilter, issueFilter, assigneeFilter, viewPreset, hideDone, sortMode]);
  const filteredCount = useMemo(() => Array.from(visibleCardsByList.values()).reduce((total, rows) => total + rows.length, 0), [visibleCardsByList]);
  const boardStats = useMemo(() => summarizeBoardCards(cards, currentUser.id), [cards, currentUser.id]);
  const { linked: linkedCount, overdue: overdueCount, unassigned: unassignedCount, watching: watchingCount } = boardStats;
  const doneCount = doneList?.cards.length || 0;
  const completionPercent = cards.length ? Math.round((doneCount / cards.length) * 100) : 0;
  const activeFilterCount = [priorityFilter !== "all", Boolean(labelFilter), Boolean(categoryFilter), issueFilter !== "all", Boolean(assigneeFilter), hideDone, hideEmptyLists, viewPreset !== "all", sortMode !== "manual"].filter(Boolean).length;
  const visibleRows = useMemo<BoardViewRow[]>(() => visibleLists.flatMap((list) => (visibleCardsByList.get(list.id) || []).map((card) => ({ card, list }))), [visibleLists, visibleCardsByList]);
  const boardGroupLabel = useCallback((card: Card) => {
    if (groupMode === "priority") return card.priority[0].toUpperCase() + card.priority.slice(1);
    if (groupMode === "category") return card.category || "No category";
    if (groupMode === "assignee") {
      const user = card.assigneeId ? userById.get(card.assigneeId) : null;
      return user?.displayName || user?.username || "Unassigned";
    }
    return "Cards";
  }, [groupMode, userById]);
  const selectedCards = useMemo(() => Array.from(selectedCardIds, (id) => cardById.get(id)).filter((card): card is Card => Boolean(card)), [cardById, selectedCardIds]);
  const visibleCardIds = useMemo(() => visibleRows.map((row) => row.card.id), [visibleRows]);
  const visibleSelectedCount = countVisibleBoardSelection(selectedCardIds, visibleCardIds);
  const selectedOutsideViewCount = selectedCards.length - visibleSelectedCount;
  useEffect(() => {
    if (!board?.id) return;
    const currentBoardIds = new Set(cardById.keys());
    setSelectedCardIds((current) => pruneBoardSelection(current, currentBoardIds));
  }, [board?.id, cardById]);
  const boardSelectionAnchor = useMemo(() => {
    if (!selectedCards.length) return null;
    const labels = selectedCards.slice(0, 3).map((card) => card.title);
    return {
      kind: "board-card-selection",
      ids: selectedCards.map((card) => card.id).sort(),
      label: selectedCards.length === 1 ? labels[0] : `${labels.join(", ")}${selectedCards.length > 3 ? ` +${selectedCards.length - 3}` : ""}`,
    };
  }, [selectedCards]);
  const boardSwitcherItems = useMemo<ProjectResourceSwitcherItem[]>(() => boards.map((item) => ({ id: item.id, label: item.name, projectName: item.projectName, detail: item.description || null })), [boards]);

  function currentSavedViewSnapshot(): Omit<BoardSavedView, "id" | "name"> {
    return { viewMode, viewPreset, priorityFilter, labelFilter, categoryFilter, issueFilter, assigneeFilter, sortMode, hideDone, hideEmptyLists, laneWidth, density, groupMode };
  }
  function saveCurrentView() {
    const snapshot = currentSavedViewSnapshot();
    const id = `board-view-${Date.now()}`;
    const entry: BoardSavedView = { id, name: boardSavedViewName(snapshot, savedViews.length), ...snapshot };
    setSavedViews((current) => [...current.slice(-7), entry]);
    setActiveSavedViewId(id);
    setCategoryStatus(`Saved view “${entry.name}”.`);
  }
  function applySavedView(id: string) {
    setActiveSavedViewId(id);
    if (!id) return;
    const saved = allSavedViews.find((item) => item.id === id);
    if (!saved) return;
    setViewMode(saved.viewMode || "kanban");
    setViewPreset(saved.viewPreset || "all");
    setPriorityFilter(saved.priorityFilter || "all");
    setLabelFilter(saved.labelFilter || "");
    setCategoryFilter(saved.categoryFilter || "");
    setIssueFilter(saved.issueFilter || "all");
    setAssigneeFilter(saved.assigneeFilter || "");
    setSortMode(saved.sortMode || "manual");
    setHideDone(Boolean(saved.hideDone));
    setHideEmptyLists(Boolean(saved.hideEmptyLists));
    setLaneWidth(saved.laneWidth || "standard");
    setDensity(saved.density || "comfortable");
    setGroupMode(saved.groupMode || "none");
    setSelectedCardIds(new Set());
    setCategoryStatus(`Applied saved view “${saved.name}”.`);
  }
  function shareCurrentView() {
    if (!board) return;
    const snapshot = currentSavedViewSnapshot();
    const id = `board-shared-view-${Date.now()}`;
    const entry: BoardSharedViewRecord = { id, name: boardSavedViewName(snapshot, boardSharedViews.length), ...snapshot, projectId: board.project.id, boardId: board.id, ownerId: currentUser.id, scope: "project", shared: true };
    setSharedViews((current) => [...current, entry]);
    setActiveSavedViewId(id);
    setCategoryStatus(`Shared view “${entry.name}” with the project.`);
    void boardCollaboration.publish("shared a board view", entry.name, null, false);
  }
  function removeActiveSavedView() {
    if (!activeSavedViewId) return;
    const personal = savedViews.find((item) => item.id === activeSavedViewId);
    if (personal) setSavedViews((current) => current.filter((item) => item.id !== activeSavedViewId));
    const shared = boardSharedViews.find((item) => item.id === activeSavedViewId);
    if (shared && (shared.ownerId === currentUser.id || Boolean((currentUser as any).isAdmin))) setSharedViews((current) => current.filter((item) => item.id !== activeSavedViewId));
    setActiveSavedViewId("");
    const removed = personal || shared;
    if (removed) setCategoryStatus(`Removed saved view “${removed.name}”.`);
  }
  function toggleCardSelected(cardId: string) {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }
  function selectAllVisibleCards() {
    setSelectedCardIds((current) => addVisibleBoardSelection(current, visibleCardIds));
  }
  function deselectVisibleCards() {
    setSelectedCardIds((current) => removeVisibleBoardSelection(current, visibleCardIds));
  }
  async function runSelectedBoardBulk(
    label: string,
    mutation: (card: Card) => Promise<BoardBulkResult | "skip">,
    resetInput: () => void,
  ) {
    if (!selectedCards.length || bulkOperationBusyRef.current || moveOperationBusyRef.current) return;
    const snapshot = [...selectedCards];
    bulkOperationBusyRef.current = true;
    setBulkBusy(true);
    try {
      if (snapshot.length >= 20 && !(await confirmCluster({
        title: `Update ${snapshot.length} cards?`,
        message: `${label}. This performs one revision-checked operation per card. It is not an atomic change: some cards may succeed while others fail or queue offline.`,
        confirmLabel: "Apply to selected",
      }))) return;
      setCategoryStatus(`${label} · 0/${snapshot.length} processed…`);
      const controller = new AbortController();
      bulkOperationAbortRef.current = controller;
      const outcome = await executeBoardBulk(snapshot, mutation, (completed, total) => setCategoryStatus(`${label} · ${completed}/${total} processed…`), controller.signal);
      if (outcome.applied) {
        await boardCollaboration.publish(`Bulk: ${label}`, `${outcome.applied} applied`, null, false).catch(() => undefined);
      }
      // A bulk metadata edit or move can invalidate an older move history revision.
      // Keep history for unrelated cards only; never replay against stale revisions.
      if (outcome.applied || outcome.queued) {
        const affected = new Set([...outcome.appliedIds, ...outcome.queuedIds]);
        setMoveHistory((history) => ({ undo: history.undo.filter((entry) => !affected.has(entry.cardId)), redo: history.redo.filter((entry) => !affected.has(entry.cardId)) }));
      }
      // Preserve failed selections for retry; don't misreport queued offline work as saved.
      setSelectedCardIds(new Set([...outcome.failures.map((failure) => failure.id), ...outcome.remainingIds]));
      if (!outcome.failures.length && !outcome.queued && !outcome.cancelled) resetInput();
      await onRefresh().catch(() => undefined);
      setCategoryStatus(`${label}. ${describeBoardBulkOutcome(outcome)}`);
    } catch (error) {
      setCategoryStatus(error instanceof Error ? error.message : "The selected changes did not complete.");
      await onRefresh().catch(() => undefined);
    } finally {
      bulkOperationAbortRef.current = null;
      bulkOperationBusyRef.current = false;
      setBulkBusy(false);
    }
  }
  async function bulkSetSelectedPriority() {
    if (!bulkPriority) return;
    await runSelectedBoardBulk(`Set priority to ${bulkPriority}`, (card) => boardCollaboration.mutate<Card>({
      path: `/api/cards/${card.id}`, method: "PATCH",
      body: { priority: bulkPriority, expectedRevision: card.revision || 1 },
      label: `Set ${card.title} priority to ${bulkPriority}`, entityType: "card", entityId: card.id,
    }), () => setBulkPriority(""));
  }
  async function bulkAssignSelectedCards() {
    const assignee = users.find((user) => user.id === bulkAssigneeId);
    const assigneeLabel = assignee ? (assignee.displayName || assignee.username) : "Unassigned";
    await runSelectedBoardBulk(`Assign cards: ${assigneeLabel}`, (card) => boardCollaboration.mutate<Card>({
      path: `/api/cards/${card.id}`, method: "PATCH",
      body: { assigneeId: bulkAssigneeId || null, expectedRevision: card.revision || 1 },
      label: `Assign ${card.title}`, entityType: "card", entityId: card.id,
    }), () => setBulkAssigneeId(""));
  }
  async function bulkSetSelectedDueDate() {
    const dueDate = bulkDueDate ? new Date(`${bulkDueDate}T12:00:00`).toISOString() : null;
    await runSelectedBoardBulk(dueDate ? `Set due ${bulkDueDate}` : "Clear due dates", (card) => boardCollaboration.mutate<Card>({
      path: `/api/cards/${card.id}`, method: "PATCH",
      body: { dueDate, expectedRevision: card.revision || 1 },
      label: `${dueDate ? "Set" : "Clear"} ${card.title} due date`, entityType: "card", entityId: card.id,
    }), () => setBulkDueDate(""));
  }
  async function bulkDeferSelectedCards() {
    const deferredUntil = bulkDeferredUntil ? new Date(`${bulkDeferredUntil}T12:00:00`).toISOString() : null;
    await runSelectedBoardBulk(deferredUntil ? `Defer until ${bulkDeferredUntil}` : "Resume cards", (card) => boardCollaboration.mutate<Card>({
      path: `/api/cards/${card.id}`, method: "PATCH",
      body: { deferredUntil, expectedRevision: card.revision || 1 },
      label: `${deferredUntil ? "Defer" : "Resume"} ${card.title}`, entityType: "card", entityId: card.id,
    }), () => setBulkDeferredUntil(""));
  }
  async function bulkMoveSelectedCards() {
    if (!bulkListId) return;
    const target = board?.lists.find((list) => list.id === bulkListId);
    if (!target) return;
    await runSelectedBoardBulk(`Move to ${target.title}`, (card) => card.listId === target.id ? Promise.resolve("skip") : boardCollaboration.mutate<Card>({
      path: `/api/cards/${card.id}/move`, method: "POST",
      body: { listId: target.id, expectedRevision: card.revision || 1 },
      label: `Move ${card.title} to ${target.title}`, entityType: "card", entityId: card.id,
    }), () => setBulkListId(""));
  }
  function listCollapsed(list: BoardList) {
    return collapsedListState[list.id] ?? Boolean(list.collapsed);
  }
  function setAllListsCollapsed(collapsed: boolean) {
    if (!board) return;
    setCollapsedListState(Object.fromEntries(board.lists.map((list) => [list.id, collapsed])));
  }
  function addBoardLabelDefinition() {
    const name = newBoardLabelName.trim();
    if (!name) return;
    if (boardLabelDefinitions.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setBoardManagerStatus("That board label already exists.");
      return;
    }
    setBoardLabelDefinitions((current) => [...current, { id: `board-label-${Date.now()}`, name, color: newBoardLabelColor }]);
    setNewBoardLabelName("");
    setBoardManagerStatus("Label added. Save the board to share it.");
  }
  function removeBoardLabelDefinition(id: string) {
    setBoardLabelDefinitions((current) => current.filter((item) => item.id !== id));
  }
  async function openBoardResourceWindow(item: ProjectResourceSwitcherItem) {
    const target = boards.find((candidate) => candidate.id === item.id);
    if (!target) return false;
    setWorkspaceWindowStatus(`Opening ${target.name}…`);
    try {
      const opened = await openDesktopWorkspaceWindow(`board/${target.projectId}/${target.id}`, `${target.name} · ${target.projectName}`);
      setWorkspaceWindowStatus(opened ? `${target.name} opened in a separate Cluster window.` : "Separate windows are available in Cluster Desktop.");
      return opened;
    } catch (error) {
      setWorkspaceWindowStatus(error instanceof Error ? error.message : "Cluster could not open a separate board window.");
      return false;
    }
  }
  async function openBoardInNewWindow() {
    if (!board) return;
    await openBoardResourceWindow({ id: board.id, label: board.name, projectName: board.project.name });
  }

  const boardAppearanceStyle = runtimeStyle({
    "--board-theme-color": board?.backgroundColor || "var(--cluster-blue-600)",
    "--board-theme-background": boardThemeBackground(board?.backgroundColor || "var(--cluster-blue-600)", board?.backgroundStyle || "soft"),
  });
  const activeProjectName = board?.project.name || projects.find((project) => project.id === boardProjectId)?.name || "No project";
  const boardManagerPanel = (
    <div className="resource-manager-v043 board-manager-v043 panel">
      <div className="resource-manager-head-v043">
        <div>
          <p className="eyebrow">Boards</p>
          <h2>{board ? board.name : "New board"}</h2>
          <p className="muted tight">Separate boards for milestones, bugs, art, design, playtests, or release work.</p>
        </div>
        <div className="resource-manager-actions-v043">
          <ClusterButton type="button" className="" onClick={startNewBoard} variant="secondary">
            New
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={saveBoardFromPanel} variant="primary">
            {board ? "Save" : "Create"}
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={deleteBoardFromPanel} disabled={!board} variant="danger">
            Delete
          </ClusterButton>
        </div>
      </div>
      <div className="resource-manager-grid-v043">
        <div className="field">
          <label>Open board</label>
          <ClusterNativeSelect value={currentBoardId || ""} onChange={(event) => onSelectBoard(event.target.value || null)}>
            <option value="">New / no board selected</option>
            {boards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.projectName} / {item.name}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Name</label>
          <ClusterTextInput value={boardName} onChange={(event) => setBoardName(event.target.value)} placeholder="Milestone, Bugs, Art, Design..." />
        </div>
        <div className="field">
          <label>Project</label>
          <ClusterNativeSelect value={boardProjectId} onChange={(event) => setBoardProjectId(event.target.value)} disabled={Boolean(board)}>
            <option value="">Pick project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </ClusterNativeSelect>
        </div>
        <div className="field">
          <label>Workflow template</label>
          <ClusterNativeSelect value={boardTemplate} onChange={(event) => setBoardTemplate(event.target.value as BoardTemplateId)} disabled={Boolean(board)}>
            {BOARD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
          </ClusterNativeSelect>
          {!board && <small className="muted">{BOARD_TEMPLATES.find((template) => template.id === boardTemplate)?.description}</small>}
        </div>
        <div className="field board-desc-field-v043">
          <label>Description</label>
          <ClusterTextInput value={boardDescription} onChange={(event) => setBoardDescription(event.target.value)} placeholder="What this board tracks for the team" />
        </div>
        <div className="field board-appearance-field-v308">
          <label>Board appearance</label>
          <div className="board-theme-presets-v308">
            {BOARD_APPEARANCE_PRESETS.map((preset) => (
              <ClusterButton unstyled key={preset.id} type="button" className={boardBackgroundColor === preset.color && boardBackgroundStyle === preset.style ? "active" : ""} style={runtimeStyle({ "--theme-preview": preset.color })} onClick={() => { setBoardBackgroundColor(preset.color); setBoardBackgroundStyle(preset.style); }}><span />{preset.label}</ClusterButton>
            ))}
          </div>
          <div className="board-theme-custom-v308">
            <CompactColorField label="Custom" value={boardBackgroundColor} onChange={setBoardBackgroundColor} />
            <ClusterNativeSelect value={boardBackgroundStyle} onChange={(event) => setBoardBackgroundStyle(event.target.value as typeof boardBackgroundStyle)} aria-label="Board background style">
              <option value="soft">Soft wash</option>
              <option value="solid">Solid</option>
              <option value="gradient">Gradient</option>
            </ClusterNativeSelect>
          </div>
        </div>
        <div className="field board-label-library-v308">
          <label>Board labels</label>
          <div className="board-label-definition-list-v308">
            {boardLabelDefinitions.map((definition) => <span key={definition.id} style={runtimeStyle({ "--label-color": definition.color })}><i />{definition.name}<ClusterButton unstyled type="button" onClick={() => removeBoardLabelDefinition(definition.id)} aria-label={`Remove ${definition.name}`}><ClusterIcon name="close" /></ClusterButton></span>)}
          </div>
          <div className="board-label-create-v308">
            <ClusterTextInput value={newBoardLabelName} onChange={(event) => setNewBoardLabelName(event.target.value)} placeholder="New label" maxLength={80} />
            <CompactColorField label="Color" value={newBoardLabelColor} onChange={setNewBoardLabelColor} showValue={false} />
            <ClusterButton type="button" className="" onClick={addBoardLabelDefinition} variant="quiet" size="compact">Add</ClusterButton>
          </div>
        </div>
        <label className="tool-check manager-check-v043">
        </label>
      </div>
      <div className="resource-context-row-v043">
        <span>
          {boards.length} board{boards.length === 1 ? "" : "s"}
        </span>
        <span>{activeProjectName}</span>
        {board && <span>{board.lists.length} columns</span>}
        {board && <span>{cards.length} cards</span>}
        {boardManagerStatus && <em>{boardManagerStatus}</em>}
      </div>
    </div>
  );
  if (!board) {
    return <WorkspaceDirectory kind="Boards" icon="work" items={boards.map((item) => ({ id: item.id, name: item.name, projectName: item.projectName, detail: item.description }))}
      onOpen={(id) => onSelectBoard(id)} onCreate={() => setShowBoardManager((value) => !value)} creating={showBoardManager}>
      <div className="board-simple-create-v28">
        <ClusterTextInput autoFocus aria-label="Board name" value={boardName} onChange={(event) => setBoardName(event.target.value)} placeholder="Board name" maxLength={120} />
        <ClusterNativeSelect aria-label="Project" value={boardProjectId} onChange={(event) => setBoardProjectId(event.target.value)}>
          <option value="">Select project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </ClusterNativeSelect>
        <ClusterNativeSelect aria-label="Starting layout" value={boardTemplate} onChange={(event) => setBoardTemplate(event.target.value as BoardTemplateId)}>
          {BOARD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
        </ClusterNativeSelect>
        <ClusterButton variant="primary" disabled={!boardProjectId || !boardName.trim()} onClick={() => void createBoardFromPanel()}>Create board</ClusterButton>
        {boardManagerStatus && <span role="status">{boardManagerStatus}</span>}
      </div>
    </WorkspaceDirectory>;
  }
  return (
    <ProjectWorkspaceShell
      style={boardAppearanceStyle}
      className={`cluster-specialist-workspace cluster-board-workspace board-page cohesive-page-v043 board-page-v194 board-inline-v28 board-workspace-v257 board-lanes-${laneWidth}-v299 board-theme-${board.backgroundStyle || "soft"}-v308`}
      headerClassName="page-header compact board-hero standard-header-v043 board-hero-v194 board-workspace-header-v256 cluster-workspace-header-v391"
      eyebrow={board.project.name}
      title={board.name}
      icon="work"
      description={undefined}
      metrics={[
        { label: "Cards", value: cards.length },
        { label: "Overdue", value: overdueCount, tone: overdueCount ? "warning" : "neutral" },
      ]}
      headerActions={<>
        {!resourceWindow && <ClusterButton variant="secondary" onClick={() => { onSelectBoard(null); }}>All boards</ClusterButton>}
        {canOpenWorkspaceWindow && <ClusterButton variant="secondary" onClick={() => void openBoardInNewWindow()}>Open window</ClusterButton>}
        {backlogList && <ClusterButton variant="primary" onClick={() => setNewCardListId(backlogList.id)}>New card</ClusterButton>}
        <ClusterButton variant="secondary" selected={showFilters} onClick={() => setShowFilters((value) => !value)}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</ClusterButton>
        <ClusterActionMenu
          label="Board actions"
          triggerLabel="More"
          items={[
            { id: "add-column", label: "Add column", onSelect: () => setShowColumnCreator(true) },
            { id: "setup", label: showBoardSetup ? "Hide setup" : "Board setup", onSelect: () => setShowBoardSetup((value) => !value) },
            { id: "view", label: showAdvancedView ? "Hide view options" : "View options", onSelect: () => setShowAdvancedView((value) => !value) },
            { id: "manage", label: "Manage boards", onSelect: () => setShowBoardManager(true) },
            { id: "archive", label: "Archived cards", onSelect: () => setShowArchiveTray(true) },
            { id: "stats", label: showInsights ? "Hide planning" : "Planning intelligence", onSelect: () => setShowInsights((value) => !value) },
            { id: "collapse", label: "Collapse all columns", separatorBefore: true, onSelect: () => setAllListsCollapsed(true) },
            { id: "expand", label: "Expand all columns", onSelect: () => setAllListsCollapsed(false) },
            { id: "empty", label: hideEmptyLists ? "Show empty columns" : "Hide empty columns", onSelect: () => setHideEmptyLists((value) => !value) },
            { id: "width", label: `Column width: ${laneWidth}`, onSelect: () => setLaneWidth((value) => value === "narrow" ? "standard" : value === "standard" ? "wide" : "narrow") },
            ...(!resourceWindow ? [{ id: "settings", label: "Board settings", separatorBefore: true, onSelect: onOpenSettings }] : []),
            { id: "refresh", label: "Refresh", separatorBefore: Boolean(resourceWindow), onSelect: onRefresh },
          ]}
        />
      </>}
      projectName={board.project.name}
      projectStatus={projectStatusLabel(board.project)}
      projectStatusTone={projectStatusMeta(board.project).tone}
      toolLabel="Board"
      resourceLabel={board.name}
      resourceSelector={
        <ProjectResourceSwitcher
          label="Board"
          value={currentBoardId || ""}
          items={boardSwitcherItems}
          onChange={(value) => onSelectBoard(value || null)}
          canOpenWindow={canOpenWorkspaceWindow}
          onOpenWindow={openBoardResourceWindow}
        />
      }
      projectActions={!resourceWindow ? (
        <>
          <ClusterButton unstyled type="button" onClick={() => onOpenProject(board.project.id)}>Project</ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onOpenTickets(board.project.id)}>Tickets</ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onOpenTimeline(board.project.id)}>Timeline</ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onOpenTime(board.project.id)}>Scheduler</ClusterButton>
        </>
      ) : undefined}
      collaboration={<CollaborationStrip presence={boardCollaboration.presence} actions={boardCollaboration.actions} currentUserId={boardCollaboration.me?.id} connection={boardCollaboration.connection} />}
      notices={<CollaborationQueuePanel mutations={boardCollaboration.queuedMutations} onReplay={boardCollaboration.replayQueued} />}
      status={workspaceWindowStatus || undefined}
    >
      <div className="board-workspace-chrome-v257">
        <ClusterDisclosureGroup title="Relationships, fields & history" className="project-tool-meta-v195" contentClassName="project-tool-meta-grid-v195">
            <RelatedRecordsPanel
              compact
              entity={{
                kind: "board",
                id: board.id,
                label: board.name,
                projectId: board.project.id,
              }}
              projectId={board.project.id}
            />
            <CustomFieldValuesPanel compact entity="board" entityId={board.id} projectId={board.project.id} title="Board fields" />
            <VersionHistoryPanel entityType="board" entityId={board.id} projectId={board.project.id} label={board.name} data={board} />
            <CollaborationPanel entityType="board" entityId={board.id} title="Board discussion" users={users as any} currentUser={currentUser as any} compact onAnchorSelect={(anchor) => { const ids = (anchor.ids || []).filter((id) => cards.some((card) => card.id === id)); if (!ids.length) return; setSelectedCardIds(new Set(ids)); const first = cards.find((card) => card.id === ids[0]); if (first) openCardForEdit(first); }} />
            <SharedWorkWatchControl entity={{ kind: "board", id: board.id, projectId: board.project.id, label: board.name }} compact />
            <SharedWorkActivityPanel entity={{ kind: "board", id: board.id, projectId: board.project.id, label: board.name }} title="Board discussion activity" compact />
          
        </ClusterDisclosureGroup>

        {showBoardSetup && boardManagerPanel}

        {showInsights && (
          <div className="subpage-grid-v043 board-insights-v043">
            <article className="panel">
              <span>Cards</span><strong>{cards.length}</strong><em>{filteredCount} shown · {completionPercent}% complete</em>
            </article>
            <article className="panel">
              <span>Unassigned</span><strong>{unassignedCount}</strong><em>{linkedCount} linked to Source Control</em>
            </article>
            <BoardPlanningInsights board={board} cards={cards} users={users} payload={activePlanningPayload} error={planningError} />
          </div>
        )}

        <div className="board-toolbar panel board-workspace-search-v256 cluster-dense-toolbar">
          <div className="field board-search-field">
            <ClusterTextInput ref={searchInputRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cards, labels, assignees, Source Control issues…  /" aria-label="Search board cards" />
          </div>
          <span className="control-result">{filteredCount} cards</span>
          <ClusterButton size="compact" variant="quiet" className="board-select-visible-v11"
            onClick={selectAllVisibleCards} disabled={bulkBusy || !visibleCardIds.length || visibleSelectedCount === visibleCardIds.length}
            aria-label={`Add ${visibleCardIds.length - visibleSelectedCount} visible Board Cards to selection`}>
            Select visible
          </ClusterButton>
          <div className="board-view-mode-v489" role="group" aria-label="Board layout">
            {([
              ["kanban", "Board"],
              ["list", "List"],
              ["table", "Table"],
              ["timeline", "Timeline"],
              ["calendar", "Calendar"],
            ] as const).map(([mode, label]) => (
              <ClusterButton key={mode} size="compact" variant="quiet" selected={viewMode === mode} onClick={() => { setViewMode(mode); setSelectedCardIds(new Set()); }}>{label}</ClusterButton>
            ))}
          </div>
          <ClusterButton size="compact" variant="quiet" selected={showAdvancedView} onClick={() => setShowAdvancedView((value) => !value)}>View options</ClusterButton>
          {showAdvancedView && <div className="board-view-presets-v299" aria-label="Board view presets">
            {([
              ["all", "All"],
              ["mine", "My cards"],
              ["watching", `Watching ${watchingCount}`],
              ["overdue", `Overdue ${overdueCount}`],
              ["urgent", "Urgent"],
              ["unassigned", `Unassigned ${unassignedCount}`],
              ["blocked", `Blocked ${blockedCardIds.size}`],
              ["stale", "Stale"],
              ["deferred", "Deferred"],
            ] as const).map(([value, label]) => (
              <ClusterButton key={value} size="compact" variant="quiet" selected={viewPreset === value} onClick={() => setViewPreset(value)}>{label}</ClusterButton>
            ))}
          </div>}
          {showAdvancedView && <div className="board-layout-controls-v299">
            <ClusterButton size="compact" variant="quiet" selected={hideEmptyLists} onClick={() => setHideEmptyLists((value) => !value)}>Non-empty</ClusterButton>
            <ClusterSelect
              ariaLabel="Sort cards"
              value={sortMode}
              onChange={(value) => setSortMode(value as typeof sortMode)}
              options={[
                { value: "manual", label: "Manual order" },
                { value: "due", label: "Due date" },
                { value: "priority", label: "Priority" },
                { value: "title", label: "Title" },
              ]}
            />
            {viewMode === "kanban" ? (
              <ClusterSelect
                ariaLabel="Swimlane grouping"
                value={groupMode}
                onChange={(value) => setGroupMode(value as BoardGroupMode)}
                options={[
                  { value: "none", label: "No swimlanes" },
                  { value: "assignee", label: "Swimlanes by owner" },
                  { value: "priority", label: "Swimlanes by priority" },
                  { value: "category", label: "Swimlanes by category" },
                ]}
              />
            ) : null}
            {viewMode === "kanban" ? (
              <ClusterSelect
                ariaLabel="Column width"
                value={laneWidth}
                onChange={(value) => setLaneWidth(value as typeof laneWidth)}
                options={[
                  { value: "narrow", label: "Narrow lanes" },
                  { value: "standard", label: "Standard lanes" },
                  { value: "wide", label: "Wide lanes" },
                ]}
              />
            ) : null}
          </div>}
          {showAdvancedView && <div className="board-saved-views-v489">
            <ClusterSelect
              ariaLabel="Saved board views"
              value={activeSavedViewId}
              placeholder="Saved views"
              onChange={applySavedView}
              options={[{ value: "", label: "Current view" }, ...savedViews.map((item) => ({ value: item.id, label: item.name, meta: `Personal · ${item.viewMode}` })), ...boardSharedViews.map((item) => ({ value: item.id, label: item.name, meta: `Project · ${item.viewMode}` }))]}
            />
            <ClusterButton size="compact" variant="quiet" onClick={saveCurrentView} disabled={savedViews.length >= 8}>Save view</ClusterButton>
            <ClusterButton size="compact" variant="quiet" onClick={shareCurrentView} disabled={boardSharedViews.length >= 24 || sharedViewSync.pending > 0}>Share view</ClusterButton>
            {activeSavedViewId ? <ClusterButton size="compact" variant="quiet" onClick={removeActiveSavedView}>Remove</ClusterButton> : null}
          </div>}
          {sharedViewSync.error ? <span className="board-shared-view-status-v495" role="alert">{sharedViewSync.error}</span> : null}
        </div>

        {showFilters && (
          <BoardFilterPanel
            filteredCount={filteredCount}
            cardCount={cards.length}
            priorityFilter={priorityFilter}
            labelFilter={labelFilter}
            categoryFilter={categoryFilter}
            assigneeFilter={assigneeFilter}
            issueFilter={issueFilter}
            density={density}
            hideDone={hideDone}
            labels={labels}
            categories={cardCategories}
            users={users}
            onPriorityFilter={setPriorityFilter}
            onLabelFilter={setLabelFilter}
            onCategoryFilter={setCategoryFilter}
            onAssigneeFilter={setAssigneeFilter}
            onIssueFilter={setIssueFilter}
            onDensity={setDensity}
            onHideDone={setHideDone}
            onReset={() => {
              setPriorityFilter("all");
              setLabelFilter("");
              setCategoryFilter("");
              setIssueFilter("all");
              setAssigneeFilter("");
              setViewPreset("all");
              setHideDone(false);
              setHideEmptyLists(false);
              setSortMode("manual");
            }}
          />
        )}

        <ClusterBulkActionBar selectionCount={selectedCards.length} label="Selected card actions" onClear={() => setSelectedCardIds(new Set())} className="board-bulk-bar-v489">
          <ClusterButton size="compact" variant="quiet" onClick={deselectVisibleCards}
            disabled={bulkBusy || !visibleSelectedCount} aria-label={`Deselect ${visibleSelectedCount} Cards in the current filtered view`}>
            Deselect visible
          </ClusterButton>
          {selectedOutsideViewCount > 0 ? <span className="board-selection-hidden-v11" role="status">
            {selectedOutsideViewCount} selected outside current filters
          </span> : null}
          {bulkBusy && bulkOperationAbortRef.current ? <ClusterButton size="compact" variant="secondary" onClick={() => { bulkOperationAbortRef.current?.abort(); setCategoryStatus("Stopping after the current card. Already submitted changes are preserved."); }}>Cancel remaining</ClusterButton> : null}
          <ClusterButton size="compact" variant="quiet" selected={showSelectionDiscussion} onClick={() => setShowSelectionDiscussion((value) => !value)}>Discuss selection</ClusterButton>
          <ClusterSelect ariaLabel="Bulk priority" value={bulkPriority} placeholder="Set priority" onChange={(value) => setBulkPriority(value as Priority | "")} options={[{ value: "", label: "Set priority" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <ClusterButton size="compact" variant="secondary" busy={bulkBusy} busyLabel="Updating…" disabled={!bulkPriority} onClick={() => void bulkSetSelectedPriority()}>Apply priority</ClusterButton>
          <ClusterSelect ariaLabel="Bulk assignee" value={bulkAssigneeId} placeholder="Set assignee" onChange={setBulkAssigneeId} options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: user.displayName || user.username }))]} />
          <ClusterButton size="compact" variant="secondary" busy={bulkBusy} busyLabel="Assigning…" onClick={() => void bulkAssignSelectedCards()}>{bulkAssigneeId ? "Assign" : "Clear assignee"}</ClusterButton>
          <label className="board-bulk-date-v494"><span className="sr-only">Bulk due date</span><ClusterTextInput type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} aria-label="Bulk due date" /></label>
          <ClusterButton size="compact" variant="secondary" busy={bulkBusy} busyLabel="Dating…" onClick={() => void bulkSetSelectedDueDate()}>{bulkDueDate ? "Set due" : "Clear due"}</ClusterButton>
          <label className="board-bulk-date-v494"><span className="sr-only">Bulk defer until</span><ClusterTextInput type="date" value={bulkDeferredUntil} onChange={(event) => setBulkDeferredUntil(event.target.value)} aria-label="Bulk defer until" /></label>
          <ClusterButton size="compact" variant="secondary" busy={bulkBusy} busyLabel="Deferring…" onClick={() => void bulkDeferSelectedCards()}>{bulkDeferredUntil ? "Defer" : "Resume"}</ClusterButton>
          <ClusterSelect ariaLabel="Move selected cards" value={bulkListId} placeholder="Move to column" onChange={setBulkListId} options={[{ value: "", label: "Move to column" }, ...board.lists.map((list) => ({ value: list.id, label: list.title }))]} />
          <ClusterButton size="compact" variant="secondary" busy={bulkBusy} busyLabel="Moving…" disabled={!bulkListId} onClick={() => void bulkMoveSelectedCards()}>Move</ClusterButton>
        </ClusterBulkActionBar>
        {selectedCardIds.size && showSelectionDiscussion && boardSelectionAnchor ? (
          <div className="board-selection-discussion-v495">
            <CollaborationPanel
              entityType="board"
              entityId={board.id}
              title="Selection review"
              users={users as any}
              currentUser={currentUser as any}
              anchor={boardSelectionAnchor}
              anchorLabel={boardSelectionAnchor.label}
              filterToAnchor
              compact
            />
          </div>
        ) : null}
        {(moveHistory.undo.length > 0 || moveHistory.redo.length > 0) ? <div className="board-move-history-v528" role="group" aria-label="Board move history">
          <ClusterButton size="compact" variant="secondary" disabled={!boardSavedMoveAllowed || !moveHistory.undo.length} title={boardSavedMoveAllowed ? "Undo card move (Ctrl+Z)" : "Offline or queued Board work must finish before undoing a saved move"} onClick={() => void undoLastCardMove()}>Undo move ({moveHistory.undo.length})</ClusterButton>
          <ClusterButton size="compact" variant="secondary" disabled={!boardSavedMoveAllowed || !moveHistory.redo.length} title={boardSavedMoveAllowed ? "Redo card move (Ctrl+Y or Ctrl+Shift+Z)" : "Offline or queued Board work must finish before redoing a saved move"} onClick={() => void redoLastCardMove()}>Redo move ({moveHistory.redo.length})</ClusterButton>
          <span className="muted" role="status">{boardSavedMoveAllowed ? "Session history · revision checked" : "History paused · reconnect and resolve queued changes before Undo/Redo"}</span>
        </div> : null}
        {lastArchivedCard ? <ClusterRecoveryNotice message={`${lastArchivedCard.title} archived.`} actionLabel="Restore" onAction={undoLastCardArchive} onDismiss={() => setLastArchivedCard(null)} /> : null}
        {categoryStatus && <div className="status-box compact board-status-v194">{categoryStatus}</div>}
        {moving && <div className="toast">Moving card...</div>}
      </div>

      {viewMode === "kanban" ? (
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(event) => { const id = String(event.active.id).replace("card:", ""); const card = cards.find((item) => item.id === id); setCategoryStatus(`Picked up ${card?.title || "card"}. Choose a destination column.`); }} onDragCancel={() => setCategoryStatus("Card move cancelled.")} onDragEnd={handleDragEnd}>
        <div className="board-columns board-columns-v257">
          {renderedLists.map((list) => {
            const visibleCards = visibleCardsByList.get(list.id) || [];
            const renderLimit = renderLimitByList[list.id] || BOARD_CARD_RENDER_BATCH;
            const renderedCards = visibleCards.slice(0, renderLimit);
            return (
              <DroppableList list={list} collapsed={listCollapsed(list)} key={list.id}>
                <div className="list-header editable-list-header">
                  <div className="list-title-editor">
                    {editingListId === list.id ? (
                      <ClusterTextInput
                        value={inlineListTitles[list.id] || ""}
                        onChange={(event) =>
                          setInlineListTitles((prev) => ({
                            ...prev,
                            [list.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") renameCategory(list);
                          if (event.key === "Escape") setEditingListId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <h2>{list.title}</h2>
                    )}
                    <span>
                      {visibleCards.length}/{list.cards.length}
                    </span>
                    {remoteEditor("board-list", list.id) && <em className="live-list-editor-v196">{remoteEditor("board-list", list.id)?.userName} editing</em>}
                  </div>
                  <ClusterActionMenu
                    label={`${list.title} column actions`}
                    iconOnly
                    items={[
                      { id: "rename", label: editingListId === list.id ? "Save rename" : "Quick rename", onSelect: () => editingListId === list.id ? renameCategory(list) : startListRename(list) },
                      { id: "collapse", label: listCollapsed(list) ? "Expand column" : "Collapse column", onSelect: () => setCollapsedListState((current) => ({ ...current, [list.id]: !listCollapsed(list) })) },
                      { id: "settings", label: "Column settings", onSelect: () => setEditingColumn(list) },
                      { id: "undo-settings", label: "Undo my last saved column edit", disabled: !boardSavedMoveAllowed, separatorBefore: true, onSelect: () => void restoreColumnSettings(list, "undo") },
                      { id: "redo-settings", label: "Redo my last saved column edit", disabled: !boardSavedMoveAllowed, onSelect: () => void restoreColumnSettings(list, "redo") },
                      { id: "left", label: "Move left", disabled: board.lists[0]?.id === list.id, separatorBefore: true, onSelect: () => moveCategory(list, "left") },
                      { id: "right", label: "Move right", disabled: board.lists[board.lists.length - 1]?.id === list.id, onSelect: () => moveCategory(list, "right") },
                      { id: "add-card", label: "Add card", separatorBefore: true, onSelect: () => setNewCardListId(list.id) },
                      { id: "archive", label: "Archive column", separatorBefore: true, onSelect: () => deleteCategory(list) },
                    ]}
                  />
                </div>
                {!listCollapsed(list) ? (
                  <>
                    <div className={`list-cards ${groupMode !== "none" ? "board-swimlanes-v495" : ""}`}>
                      {Array.from(renderedCards.reduce((groups, card) => {
                        const label = boardGroupLabel(card);
                        const rows = groups.get(label) || [];
                        rows.push(card);
                        groups.set(label, rows);
                        return groups;
                      }, new Map<string, Card[]>())).map(([label, groupedCards]) => (
                        <section key={label} className="board-swimlane-v495">
                          {groupMode !== "none" ? <header><strong>{label}</strong><span>{groupedCards.length}</span></header> : null}
                          <div>
                            {groupedCards.map((card) => (
                              <BoardCardTile card={card} key={card.id} onOpen={openCardForEdit} onMove={moveCardByColumn} onReorder={reorderCardWithinColumn} canMovePrevious={board.lists[0]?.id !== list.id} canMoveNext={board.lists[board.lists.length - 1]?.id !== list.id} canMoveUp={list.cards.findIndex((item) => item.id === card.id) > 0} canMoveDown={list.cards.findIndex((item) => item.id === card.id) < list.cards.length - 1} density={density} liveEditor={remoteEditor("card", card.id)} userById={userById} currentUserId={currentUser.id} labelDefinitions={boardLabelDefinitions} listDone={Boolean(list.isDone)} blocked={blockedCardIds.has(card.id)} />
                            ))}
                          </div>
                        </section>
                      ))}
                      {renderedCards.length < visibleCards.length && (
                        <ClusterButton unstyled
                          type="button"
                          className="board-load-more-v303"
                          onClick={() => setRenderLimitByList((current) => ({ ...current, [list.id]: renderLimit + BOARD_CARD_RENDER_BATCH }))}
                        >
                          Show {Math.min(BOARD_CARD_RENDER_BATCH, visibleCards.length - renderedCards.length)} more · {visibleCards.length - renderedCards.length} remaining
                        </ClusterButton>
                      )}
                    </div>
                    {list.wipLimit && list.cards.length > list.wipLimit && (
                      <div className="wip-warning">
                        WIP limit exceeded: {list.cards.length}/{list.wipLimit}
                      </div>
                    )}
                    {quickCardListId === list.id ? (
                      <div className="quick-card-composer-v300">
                        <ClusterTextArea value={quickCardTitle} onChange={(event) => setQuickCardTitle(event.target.value)} placeholder="Enter a title for this card…" autoFocus onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey || !event.shiftKey) && event.key === "Enter") { event.preventDefault(); void quickCreateCard(list.id); } if (event.key === "Escape") { setQuickCardListId(null); setQuickCardTitle(""); } }} />
                        <div><ClusterButton type="button" className="small" onClick={() => void quickCreateCard(list.id)} disabled={quickAdding || !quickCardTitle.trim()} variant="primary">{quickAdding ? "Adding…" : "Add card"}</ClusterButton><ClusterButton type="button" className="" onClick={() => { setNewCardListId(list.id); setQuickCardListId(null); }} variant="quiet" size="compact">Details</ClusterButton><ClusterButton type="button" className="" onClick={() => { setQuickCardListId(null); setQuickCardTitle(""); }} variant="quiet" size="compact">Cancel</ClusterButton></div>
                      </div>
                    ) : (
                      <ClusterButton unstyled type="button" className="add-card-button" onClick={() => { setQuickCardListId(list.id); setQuickCardTitle(""); }}>+ Add card</ClusterButton>
                    )}
                  </>
                ) : (
                  <ClusterButton unstyled type="button" className="collapsed-column-card" onClick={() => setCollapsedListState((current) => ({ ...current, [list.id]: false }))}>
                    Collapsed · {visibleCards.length} visible card
                    {visibleCards.length === 1 ? "" : "s"}
                  </ClusterButton>
                )}
              </DroppableList>
            );
          })}
          {!renderedLists.length && (
            <div className="board-empty-filter-state-v299" role="status">
              <strong>{board.lists.length ? "No matching lists" : "Start with a list"}</strong>
              {board.lists.length ? <ClusterButton variant="secondary" onClick={() => { setViewPreset("all"); setHideEmptyLists(false); setQuery(""); }}>Clear filters</ClusterButton> : null}
              <ClusterButton variant="primary" onClick={() => setShowColumnCreator(true)}>+ Add list</ClusterButton>
            </div>
          )}
          {renderedLists.length > 0 && <ClusterButton unstyled type="button" className="board-add-list-v28" onClick={() => setShowColumnCreator(true)}><ClusterIcon name="plus" /> Add list</ClusterButton>}
        </div>
      </DndContext>
      ) : viewMode === "list" ? (
        <BoardListView rows={visibleRows} users={users} selectedIds={selectedCardIds} onToggleSelected={toggleCardSelected} onOpen={openCardForEdit} />
      ) : viewMode === "table" ? (
        <BoardTableView rows={visibleRows} users={users} selectedIds={selectedCardIds} onToggleSelected={toggleCardSelected} onOpen={openCardForEdit} />
      ) : viewMode === "timeline" ? (
        <BoardTimelineView rows={visibleRows} selectedIds={selectedCardIds} onToggleSelected={toggleCardSelected} onOpen={openCardForEdit} />
      ) : (
        <BoardCalendarView rows={visibleRows} selectedIds={selectedCardIds} onToggleSelected={toggleCardSelected} onOpen={openCardForEdit} />
      )}

      {(showColumnCreator || editingColumn) && (
        <ColumnSettingsModal
          list={editingColumn}
          users={users}
          onClose={() => {
            setShowColumnCreator(false);
            setEditingColumn(null);
          }}
          onSave={saveColumn}
        />
      )}

      {showBoardManager && (
        <BoardManagerModal
          board={board}
          projects={projects}
          currentBoardId={currentBoardId}
          onSelectBoard={onSelectBoard}
          onClose={() => setShowBoardManager(false)}
          onChanged={async () => {
            await onRefreshProjects();
            await onRefresh();
          }}
        />
      )}

      {showArchiveTray && (
        <BoardArchiveTray
          board={board}
          onClose={() => setShowArchiveTray(false)}
          onChanged={async () => { await onRefresh(); }}
        />
      )}

      {newCardListId && (
        <CardModal
          mode="create"
          listId={newCardListId}
          projectId={board.project.id}
          boardId={board.id}
          users={users}
          currentUser={currentUser}
          labelDefinitions={boardLabelDefinitions}
          projectBoards={projects.find((project) => project.id === board.project.id)?.boards || []}
          CustomFieldValuesPanel={CustomFieldValuesPanel}
          onClose={() => setNewCardListId(null)}
          onSaved={async () => {
            await boardCollaboration.publish("created a card", board.lists.find((list) => list.id === newCardListId)?.title || null, null, false);
            setNewCardListId(null);
            await onRefresh();
          }}
        />
      )}

      {selectedCard && (
        <CardModal
          mode="edit"
          card={selectedCard}
          listId={selectedCard.listId}
          projectId={board.project.id}
          boardId={board.id}
          users={users}
          currentUser={currentUser}
          labelDefinitions={boardLabelDefinitions}
          projectBoards={projects.find((project) => project.id === board.project.id)?.boards || []}
          CustomFieldValuesPanel={CustomFieldValuesPanel}
          onClose={cardDetailHistory.closeDetail}
          key={selectedCard.id}
          onActivitySaved={async () => {
            await onRefresh();
            const refreshed = await queryApi<Board>(`/api/boards/${encodeURIComponent(board.id)}`, {
              staleMs: 0, maxAgeMs: 0, tags: ["boards", board.id, "card-activity"],
            });
            return refreshed.lists.flatMap((list) => list.cards).find((item) => item.id === selectedCard.id) || null;
          }}
          onArchived={async (archivedCard) => {
            setLastArchivedCard({ cardId: archivedCard.id, title: archivedCard.title, revision: archivedCard.revision || (selectedCard.revision || 1) + 1 });
            await boardCollaboration.publish("archived a card", archivedCard.title, { entityType: "card", entityId: archivedCard.id, label: archivedCard.title }, false);
            cardDetailHistory.closeDetail();
            await onRefresh();
          }}
          onSaved={async () => {
            await boardCollaboration.publish(
              "updated a card",
              selectedCard.title,
              {
                entityType: "card",
                entityId: selectedCard.id,
                label: selectedCard.title,
              },
              false,
            );
            cardDetailHistory.closeDetail();
            await onRefresh();
          }}
        />
      )}
    </ProjectWorkspaceShell>
  );
}

import { boardHistoryShortcut, boardHistoryTargetContext } from "./board-history-shortcuts";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCorners, type DragEndEvent, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { ApiError, api, mutateApi, queryApi } from "../../core/api";
import { unique } from "../../core/storage";
import { readServerState, writeServerState } from "../../core/server-state";
import { formatDueDate } from "../../core/format";
import { NumberStepper } from "../../components/NumberStepper";
import { CompactColorField } from "../../components/ColorField";
import { ClusterButton, ClusterIconButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { SharedWorkEvidencePanel } from "../../components/SharedWorkEvidencePanel";
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
import { requestLinkedWorkManager } from "../workflow/work-actions";
import { BoardCardPlanningFields } from "./BoardCardPlanningFields";
import { recordBoardCardDraft, startBoardCardDraftHistory, traverseBoardCardDraft, type BoardCardDraft, type BoardCardDraftHistory } from "./board-card-draft-history";
import { cardToBoardDraft, describeBoardDraftValue, resolveBoardCardChanges, reviewBoardCardChanges, type BoardDraftField, type BoardConflictChoice } from "./board-card-conflict-resolution";
import { CardProjectionPanel } from "./CardProjectionPanel";
import { BoardFilterPanel } from "./BoardFilterPanel";
import { BoardCalendarView, BoardListView, BoardTableView, type BoardViewMode, type BoardViewRow } from "./BoardAlternativeViews";
import { BoardCardTile, isCardOverdue } from "./BoardCardTile";
import { BOARD_TEMPLATES, boardTemplateColumns, type BoardTemplateId } from "./board-templates";
import { BOARD_APPEARANCE_PRESETS, DEFAULT_BOARD_LABELS, boardThemeBackground } from "./board-appearance";
import { boardCardMatches, buildBoardCardSearchIndex, buildBoardUserIndex, cardSourceIssue, collectBoardCategories, collectBoardLabels, flattenBoardCards, sortBoardCards, summarizeBoardCards, type BoardIssueFilter, type BoardSortMode, type BoardViewPreset } from "./board-workspace-model";
import { projectStatusLabel, projectStatusMeta } from "../projects/projects-utils";
import { CollaborationQueuePanel, CollaborationStrip, collaborationColor, useToolCollaboration, type CollaborationEntityRef, type CollaborationPresence } from "../collaboration";
import type { Board, BoardLabelDefinition, BoardList, BoardSummary, Card, ChecklistItem, Priority, Project, Settings, User, UserActivitySummary } from "../application/application-models";
import "./board-performance.css";
import "./board-workspace.css";
import { runtimeStyle } from "../../core/runtime-style";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useProjectWorkflowList } from "../../core/project-workflow-storage";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { ResourceSyncBadge } from "../../components/SyncStatusIndicator";
import { getOfflineResourceSyncState, getOfflineSyncSnapshot, subscribeOfflineSync } from "../../core/offline-runtime";
import { RequestErrorState } from "../../components/RequestState";
import { ClusterOperationFeedback } from "../../components/ClusterOperationFeedback";
import { ClusterModal } from "../../components/ClusterModal";


type SourceIssue = {
  id: string;
  number: number | null;
  title: string;
  state: string;
  body?: string;
  url?: string | null;
  labels: string[];
  assignee?: string | null;
  updatedAt?: string | null;
};

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function ColumnSettingsModal({ list, users, onClose, onSave }: { list?: BoardList | null; users: UserActivitySummary[]; onClose: () => void; onSave: (settings: { title: string; description?: string; color?: string; wipLimit?: number | null; isDone?: boolean; collapsed?: boolean; assignedUserIds?: string[] }) => Promise<void> }) {
  const [title, setTitle] = useState(list?.title || "New column");
  const [description, setDescription] = useState(list?.description || "");
  const [color, setColor] = useState(list?.color || "#3b82f6");
  const [wipLimit, setWipLimit] = useState(list?.wipLimit ? String(list.wipLimit) : "");
  const [isDone, setIsDone] = useState(Boolean(list?.isDone));
  const [collapsed, setCollapsed] = useState(Boolean(list?.collapsed));
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(list?.assignedUserIds || []);
  const [status, setStatus] = useState("");
  const colorPresets = ["#3b82f6", "#22c55e", "#06b6d4", "#8b5cf6", "#f97316", "#ef4444", "#64748b"];
  async function submit() {
    if (!title.trim()) {
      setStatus("Enter a column name before saving.");
      return;
    }
    setStatus(list ? "Saving column..." : "Creating column...");
    await onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      color,
      wipLimit: wipLimit.trim() ? Number(wipLimit) : null,
      isDone,
      collapsed,
      assignedUserIds,
    });
  }
  return (
    <ClusterModal open onClose={onClose} backdropClassName="soft-backdrop" className="modal panel column-settings-modal column-settings-modal-v19" labelledBy="column-settings-title-v35">
        <div className="modal-header column-modal-header-v19">
          <div className="modal-title-pack">
            <span className="modal-glyph" aria-hidden="true"><ClusterIcon name="grid" /></span>
            <div>
              <p className="eyebrow">Column setup</p>
              <h2 id="column-settings-title-v35">{list ? "Edit column" : "Create column"}</h2>
              <p className="muted tight">Tune the workflow stage before it shows up on the board.</p>
            </div>
          </div>
          <ClusterIconButton className="modal-close-v19" onClick={onClose} label="Close">
            <ClusterIcon name="close" />
          </ClusterIconButton>
        </div>

        <div className="column-modal-layout-v19">
          <div className="column-form-card-v19">
            <div className="field">
              <label>Column name</label>
              <ClusterTextInput value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Description</label>
              <ClusterTextArea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs in this stage?" />
            </div>
          </div>

          <div className="column-form-card-v19">
            <div className="two-col column-control-row-v19">
              <div className="field color-picker-field">
                <label>Accent</label>
                <div className="color-swatch-row" aria-label="Accent color presets">
                  {colorPresets.map((preset) => (
                    <ClusterButton unstyled key={preset} type="button" className={`color-swatch ${color.toLowerCase() === preset.toLowerCase() ? "active" : ""}`} style={runtimeStyle({ background: preset })} onClick={() => setColor(preset)} aria-label={`Use ${preset}`} />
                  ))}
                </div>
                <CompactColorField label="Custom" value={color} onChange={setColor} />
              </div>
              <div className="field">
                <label>WIP limit</label>
                <NumberStepper min={1} max={999} value={wipLimit} onValueChange={setWipLimit} placeholder="Optional" ariaLabel="WIP limit" />
              </div>
            </div>

            <div className="field span-2">
              <label>Column owners</label>
              <ClusterNativeSelect multiple value={assignedUserIds} onChange={(event) => setAssignedUserIds(Array.from(event.target.selectedOptions).map((option) => option.value))}>
                {users.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName || member.username}
                  </option>
                ))}
              </ClusterNativeSelect>
              <small className="muted">Ctrl-click to select more than one person.</small>
            </div>

            <div className="column-toggle-stack-v19">
              <label className="toggle-card-v19">
                <ClusterInput type="checkbox" checked={isDone} onChange={(event) => setIsDone(event.target.checked)} />
                <span>
                  <strong>Done column</strong>
                  <em>Cards here count as complete.</em>
                </span>
              </label>
              <label className="toggle-card-v19">
                <ClusterInput type="checkbox" checked={collapsed} onChange={(event) => setCollapsed(event.target.checked)} />
                <span>
                  <strong>Start collapsed</strong>
                  <em>Keep this stage tucked away by default.</em>
                </span>
              </label>
            </div>
          </div>

          <div className="column-preview-shell-v19 span-2">
            <div className="column-preview-card" style={runtimeStyle({ "--column-accent": color })}>
              <strong>{title || "Column preview"}</strong>
              <span>{description || "Cards pass through this stage."}</span>
              {wipLimit && <em>WIP limit {wipLimit}</em>}
              {assignedUserIds.length > 0 && (
                <em>
                  {assignedUserIds.length} owner
                  {assignedUserIds.length === 1 ? "" : "s"}
                </em>
              )}
            </div>
          </div>
        </div>

        {status && <div className="status-box system-status-box-v053">{status}</div>}
        <div className="modal-actions column-modal-actions-v19">
          <ClusterButton type="button" className="" onClick={onClose} variant="secondary">
            Cancel
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={submit} variant="primary">
            {list ? "Save column" : "Create column"}
          </ClusterButton>
        </div>
    </ClusterModal>
  );
}
export function BoardManagerModal({ board, projects, currentBoardId, onSelectBoard, onClose, onChanged }: { board: Board; projects: Project[]; currentBoardId: string | null; onSelectBoard: (boardId: string | null) => void; onClose: () => void; onChanged: () => Promise<void> }) {
  const project = projects.find((item) => item.id === board.project.id) || projects[0];
  const [newBoardName, setNewBoardName] = useState("New Board");
  const [newBoardTemplate, setNewBoardTemplate] = useState<BoardTemplateId>("blank");
  const [renameBoardName, setRenameBoardName] = useState(board.name);
  const [newListTitle, setNewListTitle] = useState("New List");
  const [listNames, setListNames] = useState<Record<string, string>>(() => Object.fromEntries(board.lists.map((list) => [list.id, list.title])));
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [archivedColumns, setArchivedColumns] = useState<Array<{ id: string; title: string; revision: number; archived: true }>>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const actionInFlight = useRef(false);
  const boardRevisionRef = useRef(board.revision);
  const listRevisionRef = useRef<Record<string, number | undefined>>({});
  useEffect(() => {
    boardRevisionRef.current = board.revision;
    listRevisionRef.current = Object.fromEntries(board.lists.map((list) => [list.id, list.revision]));
  }, [board.id, board.revision, board.lists]);
  async function runManagerAction(label: string, operation: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(label);
    setStatus(`${label}…`);
    try { await operation(); }
    catch (error) {
      setStatus(error instanceof ApiError && error.status === 409
        ? `Cannot ${label.toLowerCase()}: the item changed on another client. Reload the board before retrying.`
        : error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      actionInFlight.current = false;
      setBusyAction("");
    }
  }

  const canOpenWorkspaceWindow = typeof window !== "undefined" && Boolean(window.clusterDesktop?.openWorkspaceWindow);
  useEffect(() => {
    setRenameBoardName(board.name);
    setListNames(Object.fromEntries(board.lists.map((list) => [list.id, list.title])));
  }, [board.id]);
  async function createBoard() {
    if (!project || !newBoardName.trim()) return;
    await runManagerAction("Creating board", async () => {
      const created = await api<BoardSummary>(`/api/projects/${project.id}/boards`, { method: "POST", body: JSON.stringify({ name: newBoardName.trim(), columns: boardTemplateColumns(newBoardTemplate), template: newBoardTemplate === "project-default" ? "project-default" : undefined }) });
      onSelectBoard(created.id);
      setNewBoardName("New Board");
      await onChanged();
      setStatus("Board created.");
    });
  }
  async function openManagedBoardWindow(boardToOpen: BoardSummary) {
    if (!project) return;
    setStatus(`Opening ${boardToOpen.name} in a separate window…`);
    try {
      const opened = await openDesktopWorkspaceWindow(`board/${project.id}/${boardToOpen.id}`, `${boardToOpen.name} · ${project.name}`);
      setStatus(opened ? `${boardToOpen.name} opened in a separate window.` : "Separate board windows are available in Cluster Desktop.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cluster could not open that board window.");
    }
  }
  async function renameBoard() {
    if (!renameBoardName.trim() || renameBoardName.trim() === board.name) return;
    await runManagerAction("Renaming board", async () => {
      const revision = boardRevisionRef.current;
      if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error("Board revision is missing. Reload before renaming.");
      const updated = await api<Board>(`/api/boards/${board.id}`, { method: "PATCH", body: JSON.stringify({ name: renameBoardName.trim(), expectedRevision: revision }) });
      if (!Number.isSafeInteger(updated.revision)) throw new Error("Board renamed, but its new revision could not be confirmed. Reload before editing again.");
      boardRevisionRef.current = updated.revision;
      await onChanged();
      setStatus("Board renamed.");
    });
  }
  async function deleteBoard(boardToDeleteId: string) {
    if (actionInFlight.current) return;
    const allBoards = project?.boards || [];
    const target = allBoards.find((item) => item.id === boardToDeleteId);
    const expectedRevision = boardToDeleteId === board.id ? boardRevisionRef.current : target?.revision;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) { setStatus("Board revision is missing. Reload before deleting."); return; }
    if (!await confirmCluster({ title: "Delete board?", message: "Delete this board and all cards inside it?", confirmLabel: "Delete board", tone: "danger" })) return;
    await runManagerAction("Deleting board", async () => {
      await api(`/api/boards/${boardToDeleteId}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) });
      const nextBoard = allBoards.find((item) => item.id !== boardToDeleteId) || null;
      onSelectBoard(nextBoard?.id || null);
      await onChanged();
      setStatus("Board deleted.");
    });
  }
  async function createList() {
    if (!newListTitle.trim()) return;
    await runManagerAction("Creating column", async () => {
      await api(`/api/boards/${board.id}/lists`, { method: "POST", body: JSON.stringify({ title: newListTitle.trim() }) });
      setNewListTitle("New List");
      await onChanged();
      setStatus("List added.");
    });
  }
  async function renameList(listId: string) {
    const title = listNames[listId]?.trim();
    if (!title || title === board.lists.find((list) => list.id === listId)?.title) return;
    await runManagerAction("Renaming column", async () => {
      const revision = listRevisionRef.current[listId];
      if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error("Column revision is missing. Reload before renaming.");
      const updated = await api<BoardList>(`/api/lists/${listId}`, { method: "PATCH", body: JSON.stringify({ title, expectedRevision: revision }) });
      if (!Number.isSafeInteger(updated.revision)) throw new Error("Column renamed, but its new revision could not be confirmed. Reload before editing again.");
      listRevisionRef.current[listId] = updated.revision;
      await onChanged();
      setStatus("List renamed.");
    });
  }
  const loadArchivedColumns = useCallback(async () => {
    setArchivedLoading(true);
    try { setArchivedColumns(await queryApi<typeof archivedColumns>(`/api/boards/${board.id}/archived-lists`, { staleMs: 0, maxAgeMs: 0 })); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Archived columns could not be loaded."); }
    finally { setArchivedLoading(false); }
  }, [board.id]);
  useEffect(() => { void loadArchivedColumns(); }, [loadArchivedColumns]);
  async function archiveList(list: BoardList) {
    const revision = listRevisionRef.current[list.id];
    if (!Number.isSafeInteger(revision) || !revision) { setStatus("Refresh this column before archiving."); return; }
    if (!await confirmCluster({ title: "Archive column?", message: `Archive "${list.title}"? Move or archive active Cards and Tickets first. This preserves historical work and can be restored.`, confirmLabel: "Archive column", tone: "danger" })) return;
    await runManagerAction("Archiving column", async () => {
      await api(`/api/lists/${list.id}/lifecycle`, { method: "POST", body: JSON.stringify({ action: "archive", expectedRevision: revision }) });
      await onChanged(); await loadArchivedColumns();
      setStatus("Column archived. All retained work and links were preserved.");
    });
  }
  async function restoreList(list: { id: string; title: string; revision: number }) {
    await runManagerAction("Restoring column", async () => {
      await api(`/api/lists/${list.id}/lifecycle`, { method: "POST", body: JSON.stringify({ action: "restore", expectedRevision: list.revision }) });
      await onChanged(); await loadArchivedColumns();
      setStatus("Column restored with its archived history.");
    });
  }
  async function deleteList(list: BoardList) {
    if (actionInFlight.current) return;
    const expectedRevision = listRevisionRef.current[list.id];
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) { setStatus("Column revision is missing. Reload before deleting."); return; }
    if (list.cards.length) { setStatus("Only entirely unused columns can be permanently deleted. Archive this column instead."); return; }
    if (!await confirmCluster({ title: "Permanently delete unused column?", message: `Delete "${list.title}"? Any retained Card, Ticket or saved history will block deletion. Archiving is recommended.`, confirmLabel: "Delete unused", tone: "danger" })) return;
    await runManagerAction("Deleting column", async () => {
      await api(`/api/lists/${list.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) });
      await onChanged();
      setStatus("List deleted.");
    });
  }
  return (
    <ClusterModal open onClose={onClose} className="modal panel management-modal" labelledBy="board-tools-title-v422">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Board system</p>
            <h2 id="board-tools-title-v422">Board tools</h2>
            <p className="muted tight">Create, rename, switch, and remove boards or columns.</p>
          </div>
          <ClusterIconButton label="Close board tools" type="button" onClick={onClose} title="Close">
            <ClusterIcon name="close" />
          </ClusterIconButton>
        </div>

        <div className="management-grid">
          <section className="manager-section">
            <h3>Boards in {project?.name || "project"}</h3>
            <div className="mini-list board-picker-list">
              {(project?.boards || []).map((item) => (
                <div className={`manager-row ${item.id === currentBoardId ? "active" : ""}`} key={item.id}>
                  <ClusterButton unstyled type="button" className="text-button inline" onClick={() => onSelectBoard(item.id)}>
                    {item.name}
                  </ClusterButton>
                  {canOpenWorkspaceWindow && <ClusterButton size="compact" variant="quiet" onClick={() => void openManagedBoardWindow(item)}>Window</ClusterButton>}
                  <ClusterButton type="button" className="" onClick={() => deleteBoard(item.id)} disabled={Boolean(busyAction) || (project?.boards || []).length <= 1} variant="quiet" size="compact">
                    Delete
                  </ClusterButton>
                </div>
              ))}
            </div>
            <div className="field compact-field"><label>New board template</label><ClusterNativeSelect value={newBoardTemplate} onChange={(event) => setNewBoardTemplate(event.target.value as BoardTemplateId)}>{BOARD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</ClusterNativeSelect></div>
            <div className="inline-form">
              <ClusterTextInput value={newBoardName} onChange={(event) => setNewBoardName(event.target.value)} placeholder="Board name" />
              <ClusterButton type="button" className="" onClick={createBoard} disabled={Boolean(busyAction)} variant="secondary">
                Add board
              </ClusterButton>
            </div>
          </section>

          <section className="manager-section">
            <h3>Current board</h3>
            <div className="inline-form">
              <ClusterTextInput value={renameBoardName} onChange={(event) => setRenameBoardName(event.target.value)} placeholder="Rename current board" />
              <ClusterButton type="button" className="" onClick={renameBoard} disabled={Boolean(busyAction)} variant="secondary">
                Rename
              </ClusterButton>
            </div>
            <p className="muted tight">
              Current: <strong>{board.name}</strong>
            </p>
          </section>

          <section className="manager-section span-2">
            <h3>Lists / columns</h3>
            <div className="manager-list-table">
              {board.lists.map((list) => (
                <div className="manager-row" key={list.id}>
                  <span className="manager-count">
                    {list.cards.length} card{list.cards.length === 1 ? "" : "s"}
                  </span>
                  <ClusterTextInput
                    value={listNames[list.id] || ""}
                    onChange={(event) =>
                      setListNames((prev) => ({
                        ...prev,
                        [list.id]: event.target.value,
                      }))
                    }
                  />
                  <ClusterButton type="button" className="" onClick={() => renameList(list.id)} disabled={Boolean(busyAction)} variant="quiet" size="compact">
                    Save
                  </ClusterButton>
                  <ClusterButton type="button" onClick={() => archiveList(list)} disabled={Boolean(busyAction)} variant="quiet" size="compact">Archive</ClusterButton>
                  <ClusterButton type="button" className="danger-micro" onClick={() => deleteList(list)} disabled={Boolean(busyAction) || Boolean(list.cards.length)} title="Permanent deletion is allowed only for unused columns with no saved history" variant="quiet" size="compact">Delete unused</ClusterButton>
                </div>
              ))}
            </div>
            <div className="board-archived-columns-v546" role="region" aria-label="Archived columns">
              <div className="row"><h4>Archived columns</h4><ClusterButton size="compact" variant="quiet" onClick={() => void loadArchivedColumns()} disabled={archivedLoading || Boolean(busyAction)}>Refresh</ClusterButton></div>
              {archivedLoading ? <p className="muted">Loading archived columns…</p> : archivedColumns.length ? archivedColumns.map((item) =>
                <div className="manager-row" key={item.id}><strong>{item.title}</strong><span className="muted">History preserved</span><ClusterButton size="compact" variant="secondary" onClick={() => void restoreList(item)} disabled={Boolean(busyAction)}>Restore</ClusterButton></div>) : <p className="muted">No archived columns.</p>}
            </div>
            <div className="inline-form">
              <ClusterTextInput value={newListTitle} onChange={(event) => setNewListTitle(event.target.value)} placeholder="New list title" />
              <ClusterButton type="button" className="" onClick={createList} disabled={Boolean(busyAction)} variant="secondary">
                Add list
              </ClusterButton>
            </div>
          </section>
        </div>

        {status && <div className="status-box system-status-box-v053">{status}</div>}
    </ClusterModal>
  );
}
type ArchivedBoardCard = Card & { listTitle?: string; listArchived?: boolean };
export function BoardArchiveTray({ board, onClose, onChanged }: { board: Board; onClose: () => void; onChanged: () => Promise<void> }) {
  const [cards, setCards] = useState<ArchivedBoardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setCards(await queryApi<ArchivedBoardCard[]>(`/api/boards/${encodeURIComponent(board.id)}/archived-cards`, { staleMs: 0, maxAgeMs: 60_000, tags: ["boards", "archived-cards"] })); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Archived cards could not be loaded."); }
    finally { setLoading(false); }
  }, [board.id]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => { const term = query.trim().toLowerCase(); return !term ? cards : cards.filter((card) => [card.title, card.description, card.listTitle, ...(card.labels || [])].some((value) => String(value || "").toLowerCase().includes(term))); }, [cards, query]);
  async function restore(card: ArchivedBoardCard) {
    setBusyId(card.id); setStatus("");
    try {
      const result = await mutateApi<Card>(`/api/cards/${card.id}`, { method: "PATCH", body: { archived: false, expectedRevision: card.revision || 1 }, label: `Restore ${card.title}`, dedupeKey: `card:${card.id}`, entityType: "card", entityId: card.id, resourceKind: "card", resourceId: card.id, baseRevision: card.revision || 1, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: { archived: false }, changedFields: ["archived"], invalidate: ["/api/projects", "/api/boards", `/api/boards/${board.id}/archived-cards`] });
      if (result.queued) setStatus("Restore queued for synchronization.");
      else { setCards((items) => items.filter((item) => item.id !== card.id)); setStatus(`Restored ${card.title}.`); await onChanged(); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Card could not be restored."); }
    finally { setBusyId(null); }
  }
  return <ClusterModal open onClose={onClose} backdropClassName="card-editor-backdrop-v254" className="modal large-modal board-archive-tray-v495" labelledBy="board-archive-title-v36">
    <header className="modal-header"><div><p className="eyebrow">Recovery</p><h2 id="board-archive-title-v36">Archived cards</h2><p className="muted tight">Restore archived cards to the Board while preserving their existing history.</p></div><ClusterButton variant="quiet" onClick={onClose}>Close</ClusterButton></header>
    <div className="field"><label>Find archived card</label><ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, label, column…" /></div>
    {loading ? <div className="status-box">Loading archived cards…</div> : <div className="board-archive-list-v495">{visible.map((card) => <article key={card.id}><div><strong>{card.title}</strong><span>{card.listTitle || "Unknown column"} · {card.priority}</span><small>{card.listArchived ? "Restore this column from Board tools first" : card.labels?.slice(0, 4).join(" · ") || "No labels"}</small></div><ClusterButton size="compact" variant="secondary" disabled={Boolean(card.listArchived)} title={card.listArchived ? "Restore its archived column before restoring this Card" : "Restore Card"} busy={busyId === card.id} busyLabel="Restoring" onClick={() => void restore(card)}>Restore</ClusterButton></article>)}{!visible.length ? <ClusterEmptyState kind="empty" icon="work" title="No archived cards" description={query ? "Nothing in the archive matches this search." : "This board has no archived cards."} /> : null}</div>}
    {status ? <div className="status-box system-status-box-v053">{status}</div> : null}
  </ClusterModal>;
}

type CardSavedHistoryEntry = {
  id: string; actorUserId: string | null; action: 'update' | 'undo' | 'redo' | 'barrier';
  appliedRevision: number; fields: string[]; createdAt: string;
};
type CardSavedHistoryView = {
  currentRevision: number; canUndo: boolean; canRedo: boolean;
  operations: CardSavedHistoryEntry[];
};

export function CardModal({ mode, listId, projectId, boardId, card: initialCard, users, currentUser, labelDefinitions, projectBoards = [], CustomFieldValuesPanel, onClose, onSaved, onActivitySaved, onArchived }: { mode: "create" | "edit"; listId: string; projectId: string; boardId: string; card?: Card; users: UserActivitySummary[]; currentUser: User; labelDefinitions: BoardLabelDefinition[]; projectBoards?: BoardSummary[]; CustomFieldValuesPanel: ComponentType<any>; onClose: () => void; onSaved: () => Promise<void>; onActivitySaved?: () => Promise<Card | null>; onArchived?: (archivedCard: Card) => Promise<void> }) {
  const [card, setCard] = useState<Card | undefined>(initialCard);
  // A secondary action (comment/checklist/link) may refresh Card details, but must
  // never advance the revision against which unsaved editor fields were opened.
  const [openedRevision, setOpenedRevision] = useState(initialCard?.revision);
  const [savedHistory, setSavedHistory] = useState<CardSavedHistoryView | null>(null);
  // Saved Card history is an online, server-sequenced action. An outstanding
  // local queue must be resolved first; reversing an earlier server revision
  // could otherwise race queued edits when connectivity returns.
  const offlineRevision = useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
  const resourceSyncState = useMemo(() => getOfflineResourceSyncState("card", card?.id), [card?.id, offlineRevision]);
  const savedHistoryBlocked = resourceSyncState.state !== "synced" || (typeof navigator !== "undefined" && !navigator.onLine);
  const [savedHistoryBusy, setSavedHistoryBusy] = useState(false);
  const savedHistoryPendingRef = useRef(false);
  async function loadSavedHistory(cardId: string) {
    const result = await api<CardSavedHistoryView>(`/api/cards/${encodeURIComponent(cardId)}/saved-history`, { headers: { "Cache-Control": "no-cache" } });
    setSavedHistory(result);
    return result;
  }
  useEffect(() => {
    if (mode !== 'edit' || !initialCard?.id) return;
    const cardId = initialCard.id;
    let active = true;
    api<CardSavedHistoryView>(`/api/cards/${encodeURIComponent(cardId)}/saved-history`, { headers: { "Cache-Control": "no-cache" } })
      .then((result) => { if (active) setSavedHistory(result); })
      .catch(() => { if (active) setSavedHistory(null); });
    return () => { active = false; };
  }, [initialCard?.id, mode]);
  // This baseline is intentionally anchored until the user explicitly accepts
  // a newer server revision. Checklist/comment refreshes must not rebase it.
  const [reviewBaseline, setReviewBaseline] = useState<BoardCardDraft>(() => initialCard ? cardToBoardDraft(initialCard, currentUser.id) : cardToBoardDraft({ id: "", listId: "", title: "", priority: "medium", labels: [], memberIds: [], watcherIds: [], checklistItems: [], comments: [] } satisfies Card, currentUser.id));
  const [conflictCard, setConflictCard] = useState<Card | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Partial<Record<BoardDraftField, BoardConflictChoice>>>({});
  const [conflictLoading, setConflictLoading] = useState(false);
  const conflictPendingRef = useRef(false);
  async function refreshCardActivity() {
    if (!onActivitySaved) { await onSaved(); return; }
    const refreshed = await onActivitySaved();
    if (refreshed) setCard(refreshed);
  }
  const [title, setTitle] = useState(card?.title || "");
  const [description, setDescription] = useState(card?.description || "");
  const [priority, setPriority] = useState<Priority>(card?.priority || "medium");
  const [assigneeId, setAssigneeId] = useState(card?.assigneeId || "");
  const [dueDate, setDueDate] = useState(toDateInputValue(card?.dueDate));
  const [startDate, setStartDate] = useState(toDateInputValue(card?.startDate));
  const [deferredUntil, setDeferredUntil] = useState(toDateInputValue(card?.deferredUntil));
  const [completionCriteria, setCompletionCriteria] = useState(card?.completionCriteria || "");
  const [category, setCategory] = useState(card?.category || "");
  const [coverColor, setCoverColor] = useState(card?.coverColor || "");
  const [coverImage, setCoverImage] = useState(card?.coverImage || "");
  const [estimatePoints, setEstimatePoints] = useState(card?.estimatePoints == null ? "" : String(card.estimatePoints));
  const [memberIds, setMemberIds] = useState<string[]>(card?.memberIds || []);
  const [watching, setWatching] = useState(Boolean(card?.watcherIds?.includes(currentUser.id)));
  const [labels, setLabels] = useState(card?.labels.join(", ") || "");
  const initialSourceIssue = card ? cardSourceIssue(card) : null;
  const [sourceIssueId, setSourceIssueId] = useState(initialSourceIssue?.id || "");
  const [sourceIssueUrl, setSourceIssueUrl] = useState(initialSourceIssue?.url || "");
  const [sourceIssueNumber, setSourceIssueNumber] = useState<number | null>(initialSourceIssue?.number || null);
  const [sourceIssueTitle, setSourceIssueTitle] = useState(initialSourceIssue?.title || "");
  const [sourceIssueState, setSourceIssueState] = useState(initialSourceIssue?.state || "");
  const [sourceIssueLabels, setSourceIssueLabels] = useState<string[]>(initialSourceIssue?.labels || []);
  const [sourceIssueAssignee, setSourceIssueAssignee] = useState(initialSourceIssue?.assignee || "");
  const [sourceIssueUpdatedAt, setSourceIssueUpdatedAt] = useState(initialSourceIssue?.updatedAt || "");
  const [externalUrl, setExternalUrl] = useState(card?.externalUrl || "");
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [sourceIssueComment, setSourceIssueComment] = useState("");
  const [createIssueExtra, setCreateIssueExtra] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState<"day" | "week">("week");
  const [repeatDueInDays, setRepeatDueInDays] = useState(7);
  const [recurringBusy, setRecurringBusy] = useState(false);
  const [sourceIssues, setSourceIssues] = useState<SourceIssue[]>([]);
  const [sourceIssueProviderAvailable, setSourceIssueProviderAvailable] = useState<boolean | null>(null);
  const [tagPresets, setTagPresets] = useState<string[]>([]);
  const labelArray = useMemo(() => unique(labels.split(",")), [labels]);
  const editorSnapshot = useMemo<BoardCardDraft>(() => ({
    title, description, priority, assigneeId, dueDate, startDate, deferredUntil, completionCriteria,
    category, coverColor, coverImage, estimatePoints, memberIds: [...memberIds], watching, labels, externalUrl,
  }), [assigneeId, category, completionCriteria, coverColor, coverImage, deferredUntil, description, dueDate, estimatePoints, externalUrl, labels, memberIds, priority, startDate, title, watching]);
  const editorBaseline = reviewBaseline;
  const editorDirty = useMemo(() => JSON.stringify(editorSnapshot) !== JSON.stringify(editorBaseline), [editorSnapshot, editorBaseline]);
  const [draftHistory, setDraftHistory] = useState<BoardCardDraftHistory>(() => startBoardCardDraftHistory(editorSnapshot));
  const restoringDraftRef = useRef(false);
  const savePendingRef = useRef(false);
  useEffect(() => {
    if (restoringDraftRef.current) { restoringDraftRef.current = false; return; }
    setDraftHistory((history) => recordBoardCardDraft(history, editorSnapshot));
  }, [editorSnapshot]);
  function applyEditorDraft(value: BoardCardDraft) {
    restoringDraftRef.current = JSON.stringify(value) !== JSON.stringify(editorSnapshot);
    setTitle(value.title); setDescription(value.description); setPriority(value.priority as Priority);
    setAssigneeId(value.assigneeId); setDueDate(value.dueDate); setStartDate(value.startDate);
    setDeferredUntil(value.deferredUntil); setCompletionCriteria(value.completionCriteria);
    setCategory(value.category); setCoverColor(value.coverColor); setCoverImage(value.coverImage);
    setEstimatePoints(value.estimatePoints); setMemberIds([...value.memberIds]); setWatching(value.watching);
    setLabels(value.labels); setExternalUrl(value.externalUrl);
  }
  const conflictReview = useMemo(() => conflictCard
    ? reviewBoardCardChanges(reviewBaseline, editorSnapshot, cardToBoardDraft(conflictCard, currentUser.id))
    : null, [conflictCard, reviewBaseline, editorSnapshot, currentUser.id]);
  async function fetchConflictVersion() {
    if (!card || conflictPendingRef.current) return;
    conflictPendingRef.current = true;
    setConflictLoading(true);
    try {
      const latest = await api<Card>(`/api/cards/${encodeURIComponent(card.id)}`, { headers: { "Cache-Control": "no-cache" } });
      if (!Number.isSafeInteger(latest.revision) || !latest.revision) throw new Error("Server Card revision was unavailable.");
      if (latest.id !== card.id) throw new Error("Server returned a different Card.");
      setConflictCard(latest);
      setConflictChoices({});
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load the latest Card for conflict review.");
    } finally {
      conflictPendingRef.current = false;
      setConflictLoading(false);
    }
  }
  function applyConflictReview() {
    if (!conflictCard || !conflictReview || saving) return;
    const merged = resolveBoardCardChanges(conflictReview, conflictChoices);
    if (!merged || !Number.isSafeInteger(conflictCard.revision)) return;
    const serverBaseline = cardToBoardDraft(conflictCard, currentUser.id);
    setReviewBaseline(serverBaseline);
    setOpenedRevision(conflictCard.revision);
    setCard(conflictCard);
    applyEditorDraft(merged);
    // A rebase begins a new local draft-history epoch, not a silent server save.
    setDraftHistory(startBoardCardDraftHistory(merged));
    setConflictCard(null);
    setConflictChoices({});
    setSaveError(null);
    setStatus("Reviewed changes applied to your draft. Check the fields and Save to submit against the latest revision.");
  }
  function restoreDraft(direction: 'undo' | 'redo') {
    if (savePendingRef.current) return;
    const next = traverseBoardCardDraft(draftHistory, direction);
    if (next === draftHistory) return;
    setDraftHistory(next);
    applyEditorDraft(next.present);
  }
  useEffect(() => {
    function onDraftShortcut(event: KeyboardEvent) {
      if (savePendingRef.current) return;
      // This listener is window-level because the editor contains portal controls.
      // It must NEVER commandeer shortcuts from another open modal or workspace.
      const target = event.target as Element | null;
      if (!target?.closest?.('.card-editor-fullscreen-v254')) return;
      const context = boardHistoryTargetContext(event.target as Element | null);
      const direction = boardHistoryShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, shiftKey: event.shiftKey, editingText: context.editingText, inDialog: false });
      if (!direction || !draftHistory[direction].length) return;
      event.preventDefault(); restoreDraft(direction);
    }
    window.addEventListener('keydown', onDraftShortcut);
    return () => window.removeEventListener('keydown', onDraftShortcut);
  }, [draftHistory]);
  async function requestClose() {
    if (saving) {
      setStatus("Card save is still running. Keep this editor open until Cluster finishes or reports an error.");
      return false;
    }
    if (!editorDirty) { onClose(); return true; }
    const discard = await confirmCluster({
      title: mode === "create" ? "Discard card draft?" : "Discard unsaved card changes?",
      message: mode === "create" ? "This card has not been created yet. Closing now will discard the draft." : "This card has unsaved edits. Closing now will discard those local changes.",
      confirmLabel: "Discard changes", cancelLabel: "Keep editing", tone: "danger",
    });
    if (!discard) return false;
    onClose();
    return true;
  }
  useEffect(() => {
    if (!editorDirty && !saving) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [editorDirty, saving]);
  useEffect(() => {
    document.body.classList.add("card-editor-fullscreen-open-v254");
    return () => document.body.classList.remove("card-editor-fullscreen-open-v254");
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function loadSettingsAndSourceIssues() {
      const [settingsResult, issuesResult] = await Promise.allSettled([
        queryApi<Settings>("/api/settings", {
          staleMs: 60_000,
          maxAgeMs: 15 * 60_000,
          tags: ["settings", "board-card-editor"],
        }),
        card ? queryApi<{ issues: SourceIssue[]; providerAvailable?: boolean }>(`/api/projects/${projectId}/source-control/issues?state=all`, { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["source-control", "issues", projectId] }) : Promise.resolve({ issues: [] as SourceIssue[], providerAvailable: false }),
      ]);
      if (cancelled) return;
      if (settingsResult.status === "fulfilled") {
        const loadedSettings = settingsResult.value;
        setTagPresets(unique((loadedSettings.tagPresetCsv || "").split(",")));
        if (mode === "create") {
          setPriority((loadedSettings.defaultCardPriority as Priority) || "medium");
          if (loadedSettings.defaultCardLabels) setLabels(loadedSettings.defaultCardLabels);
        }
      }
      if (issuesResult.status === "fulfilled") { setSourceIssues(issuesResult.value.issues || []); setSourceIssueProviderAvailable(issuesResult.value.providerAvailable !== false); }
      else setSourceIssueProviderAvailable(false);
    }
    void loadSettingsAndSourceIssues();
    return () => {
      cancelled = true;
    };
  }, [mode]);
  function addLabel(label: string) {
    setLabels(unique([...labelArray, label]).join(", "));
  }
  function applySourceIssue(issue: SourceIssue) {
    setSourceIssueId(String(issue.id));
    setSourceIssueNumber(issue.number);
    setSourceIssueTitle(issue.title);
    setSourceIssueState(issue.state);
    setSourceIssueUrl(issue.url || "");
    setSourceIssueLabels(issue.labels || []);
    setSourceIssueAssignee(issue.assignee || "");
    setSourceIssueUpdatedAt(issue.updatedAt || "");
  }
  async function linkSourceIssue(issue: SourceIssue) {
    if (!card) return;
    setStatus("Linking Source Control issue…");
    try {
      const result = await api<{ issue: SourceIssue }>(`/api/cards/${card.id}/source-issue/link`, { method: "POST", body: JSON.stringify({ issueId: issue.id }) });
      applySourceIssue(result.issue);
      setLabels(unique([...labelArray, ...(result.issue.labels || [])]).join(", "));
      setStatus(`${result.issue.number ? `#${result.issue.number} ` : ""}${result.issue.title} linked.`);
      await refreshCardActivity();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control issue could not be linked."); }
  }
  function scheduleCard(target: "calendar" | "time") {
    if (!card) return;
    const preferredStart = startDate || dueDate;
    const start = preferredStart ? new Date(`${preferredStart}T09:00:00`) : new Date();
    if (Number.isNaN(start.getTime())) start.setTime(Date.now());
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    openContextualCreate(target === "time" ? "scheduler" : target, {
      projectId,
      boardId,
      assigneeId: assigneeId || undefined,
      priority,
      dueDate: dueDate || undefined,
      labels: labelArray,
      title: `${target === "calendar" ? "Review" : "Work"}: ${title || card.title}`,
      details: description || undefined,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      calendarType: target === "calendar" ? "review" : undefined,
      timeBlockType: target === "time" ? "work" : undefined,
      source: { kind: "card", id: card.id, projectId, label: title || card.title },
      relationship: "scheduled_by",
    });
  }
  async function createRecurringCardRule() {
    if (!card || recurringBusy) return;
    setRecurringBusy(true);
    setStatus("");
    try {
      const controlCenter = await api<{ records?: Array<{ id: string; kind?: string; category?: string | null; status?: string; linkedEntityType?: string | null; linkedEntityId?: string | null }> }>(`/api/projects/${projectId}/control-center`);
      const existing = (controlCenter.records || []).find((record) => record.kind === "automation" && record.category === "board-recurring-card" && record.linkedEntityType === "card" && record.linkedEntityId === card.id && record.status !== "paused" && record.status !== "archived");
      if (existing) {
        setStatus("This card already has an active recurrence rule. Manage it in Project Control.");
        return;
      }
      const action = {
        type: "create_ticket",
        title: title.trim() || card.title,
        description: description || card.description || "",
        priority,
        targetBoardId: boardId,
        targetListId: listId,
        startInDays: startDate ? 0 : null,
        dueInDays: repeatDueInDays,
        labels: labelArray,
        category: category.trim() || null,
        coverColor: coverColor || null,
        estimatePoints: estimatePoints === "" ? null : Math.max(0, Math.min(999, Number(estimatePoints) || 0)),
        memberIds,
        watcherIds: Array.from(new Set([...(card.watcherIds || []).filter((id) => id !== currentUser.id), ...(watching ? [currentUser.id] : [])])),
        ownerId: assigneeId || null,
        relationship: "parent_of",
      };
      await api(`/api/projects/${projectId}/control-records`, {
        method: "POST",
        body: JSON.stringify({
          kind: "automation",
          title: `Recurring card: ${title.trim() || card.title}`.slice(0, 240),
          description: `Creates a new copy of ${title.trim() || card.title} every ${repeatEvery} ${repeatUnit}${repeatEvery === 1 ? "" : "s"}.`,
          status: "active",
          priority: "medium",
          ownerId: assigneeId || currentUser.id || null,
          category: "board-recurring-card",
          linkedEntityType: "card",
          linkedEntityId: card.id,
          payload: {
            trigger: "recurring",
            enabled: true,
            recurrence: { every: repeatEvery, unit: repeatUnit },
            conditions: [],
            actions: [action],
            retryPolicy: { maxAttempts: 3, backoffMinutes: 5, pauseAfterFailures: 3 },
            notifyOnFailure: true,
            governance: { state: "published", version: 1 },
            lastRunAt: new Date().toISOString(),
            source: { kind: "card", id: card.id, boardId, listId },
          },
        }),
      });
      setStatus("Recurring card rule created in Project Control. Future copies will use this board and column.");
    } catch (error) {
      setStatus(error instanceof ApiError && error.status === 403 ? "Creating recurrence requires Project management permission." : error instanceof Error ? error.message : "Recurring card rule could not be created.");
    } finally {
      setRecurringBusy(false);
    }
  }
  async function changeSavedCardHistory(direction: 'undo' | 'redo') {
    if (!card || !savedHistory || saving || savedHistoryPendingRef.current || editorDirty || conflictCard || savePendingRef.current) return;
    if (savedHistoryBlocked) {
      setStatus(resourceSyncState.state !== "synced" ? `Resolve ${resourceSyncState.state} Card sync work before reversing saved history.` : "Connect to the server before reversing saved Card history.");
      return;
    }
    const latest = savedHistory.operations[0];
    if (!latest || savedHistory.currentRevision !== openedRevision ||
      !(direction === 'undo' ? savedHistory.canUndo : savedHistory.canRedo)) return;
    savedHistoryPendingRef.current = true;
    setSavedHistoryBusy(true);
    setError('');
    try {
      const updated = await api<Card>(`/api/cards/${encodeURIComponent(card.id)}/saved-history/${direction}`, {
        method: 'POST', body: JSON.stringify({ expectedRevision: savedHistory.currentRevision, operationId: latest.id }),
      });
      if (updated.id !== card.id || !Number.isSafeInteger(updated.revision)) throw new Error('Server returned an invalid saved Card revision.');
      const baseline = cardToBoardDraft(updated, currentUser.id);
      setCard(updated); setOpenedRevision(updated.revision); setReviewBaseline(baseline);
      applyEditorDraft(baseline); setDraftHistory(startBoardCardDraftHistory(baseline));
      setConflictCard(null); setSaveError(null);
      setStatus(direction === 'undo' ? 'Your most recent saved edit was undone.' : 'Your saved edit was redone.');
      await loadSavedHistory(card.id).catch(() => setSavedHistory(null));
      await onSaved().catch(() => setStatus('Saved edit updated, but the Board refresh failed. Reload to see the latest state.'));
    } catch (cause) {
      setSavedHistory(null);
      setError(cause instanceof Error ? cause.message : 'Saved history could not be changed. Refresh this Card before trying again.');
      // A failed request may have committed before the response was lost. Never retry automatically.
    } finally { savedHistoryPendingRef.current = false; setSavedHistoryBusy(false); }
  }

  async function saveCard() {
    if (savePendingRef.current) return;
    if (conflictCard) { setError("Finish reviewing the server changes before saving this Card."); return; }
    savePendingRef.current = true;
    setError("");
    setSaveError(null);
    setStatus("Saving card…");
    setSaving(true);
    try {
      let queued = false;
      const payload = {
        listId,
        title,
        description,
        priority,
        dueDate: dueDate || null,
        startDate: startDate || null,
        deferredUntil: deferredUntil || null,
        completionCriteria: completionCriteria.trim() || null,
        labels: labelArray,
        category: category.trim() || null,
        coverColor: coverColor || null,
        coverImage: coverImage || null,
        estimatePoints: estimatePoints === "" ? null : Math.max(0, Math.min(999, Number(estimatePoints) || 0)),
        memberIds,
        watcherIds: Array.from(new Set([...(card?.watcherIds || []).filter((id) => id !== currentUser.id), ...(watching ? [currentUser.id] : [])])),
        assigneeId: assigneeId || null,
        externalUrl: externalUrl || null,
      };
      // Metadata Save must not implicitly move a Card that a collaborator moved.
      // Moving columns is a separate explicit Board operation.
      const { listId: _creationListId, ...cardMetadata } = payload;
      if (mode === "create") {
        const save = await mutateApi<Card>("/api/cards", {
          method: "POST",
          body: payload,
          label: `Create ${title.trim() || "card"}`,
          entityType: "card",
          resourceKind: "board",
          resourceId: listId,
          localSnapshot: payload,
          changedFields: Object.keys(payload),
          invalidate: ["/api/projects", "/api/boards"],
        });
        queued = save.queued;
        if (save.queued) setStatus("Card saved on this device and queued for synchronization.");
      } else if (card) {
        if (!Number.isSafeInteger(openedRevision) || Number(openedRevision) < 1) throw new Error('Cannot safely save: card revision is missing. Reload the board first.');
        const save = await mutateApi<Card>(`/api/cards/${card.id}`, {
          method: "PATCH",
          body: { ...cardMetadata, expectedRevision: openedRevision },
          label: `Update ${card.title}`,
          dedupeKey: `card:${card.id}`,
          entityType: "card",
          entityId: card.id,
          resourceKind: "card",
          resourceId: card.id,
          baseRevision: openedRevision,
          baseSnapshot: card as unknown as Record<string, unknown>,
          localSnapshot: cardMetadata,
          changedFields: Object.keys(cardMetadata),
          optimisticResult: { ...card, ...cardMetadata },
          invalidate: ["/api/projects", "/api/boards", `/api/cards/${card.id}`],
        });
        const savedCard = save.result;
        queued = save.queued;
        if (!queued && savedCard?.id === card.id && Number.isSafeInteger(savedCard.revision)) {
          const baseline = cardToBoardDraft(savedCard, currentUser.id);
          setCard(savedCard); setOpenedRevision(savedCard.revision); setReviewBaseline(baseline);
          applyEditorDraft(baseline); setDraftHistory(startBoardCardDraftHistory(baseline));
          await loadSavedHistory(card.id).catch(() => setSavedHistory(null));
        } else if (queued) setSavedHistory(null);
        if (save.queued) setStatus("Card changes saved on this device and queued for synchronization.");
      }
      await onSaved();
      if (!queued) setStatus(mode === "create" ? "Card created." : "Card saved.");
      setSaveError(null);
    } catch (err) {
      setStatus("");
      setSaveError(err);
      if (err instanceof ApiError && err.status === 409) {
        // The 409 includes an authorization-filtered current Card. Keep the
        // user's local fields intact; never silently retry with a new revision.
        const latest = (err.payload as { current?: Card } | undefined)?.current;
        if (latest && latest.id === card?.id && Number.isSafeInteger(latest.revision)) {
          setConflictCard(latest);
          setConflictChoices({});
        }
        setError("Your edits are preserved. Review the newest Card and resolve overlapping changes before saving.");
      } else setError("");
    } finally {
      setSaving(false);
      savePendingRef.current = false;
    }
  }
  async function syncSourceIssue() {
    if (!card || !sourceIssueId) return;
    setStatus("Refreshing Source Control issue…");
    try {
      const result = await api<{ issue: SourceIssue }>(`/api/cards/${card.id}/source-issue/sync`, { method: "POST" });
      applySourceIssue(result.issue);
      setStatus("Source Control issue refreshed.");
      await refreshCardActivity();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control issue could not be refreshed."); }
  }
  async function createSourceIssueFromCard() {
    if (!card) return;
    setStatus("Creating Source Control issue…");
    try {
      const result = await api<{ issue: SourceIssue }>(`/api/cards/${card.id}/source-issue/create`, { method: "POST", body: JSON.stringify({ extraBody: createIssueExtra || undefined }) });
      applySourceIssue(result.issue);
      setStatus(`Created${result.issue.number ? ` #${result.issue.number}` : ""} and linked it to this card.`);
      await refreshCardActivity();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control issue could not be created."); }
  }
  async function setLinkedSourceIssueState(nextState: "open" | "closed") {
    if (!card || !sourceIssueId) return;
    setStatus(nextState === "closed" ? "Closing Source Control issue…" : "Reopening Source Control issue…");
    try {
      const result = await api<{ issue: SourceIssue }>(`/api/cards/${card.id}/source-issue/state`, { method: "POST", body: JSON.stringify({ state: nextState }) });
      applySourceIssue(result.issue);
      setStatus(`Source Control issue marked ${nextState}.`);
      await refreshCardActivity();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control issue state could not be changed."); }
  }
  async function postCommentToSourceIssue() {
    if (!card || !sourceIssueId || !sourceIssueComment.trim()) return;
    setStatus("Posting Source Control comment…");
    try {
      await api(`/api/cards/${card.id}/source-issue/comment`, { method: "POST", body: JSON.stringify({ body: sourceIssueComment.trim() }) });
      setSourceIssueComment("");
      setStatus("Comment posted to the linked Source Control issue.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control comment could not be posted."); }
  }
  async function unlinkSourceIssue() {
    if (!card || !sourceIssueId) return;
    setStatus("Unlinking Source Control issue…");
    try {
      await api(`/api/cards/${card.id}/source-issue`, { method: "DELETE" });
      setSourceIssueId(""); setSourceIssueNumber(null); setSourceIssueTitle(""); setSourceIssueState(""); setSourceIssueUrl(""); setSourceIssueLabels([]); setSourceIssueAssignee(""); setSourceIssueUpdatedAt("");
      setStatus("Source Control issue unlinked.");
      await refreshCardActivity();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Source Control issue could not be unlinked."); }
  }
  async function addChecklistItem() {
    if (!card || !newChecklistItem.trim()) return;
    const result = await mutateApi(`/api/cards/${card.id}/checklist`, {
      method: "POST", body: { text: newChecklistItem.trim() }, label: `Add checklist item to ${card.title}`,
      entityType: "checklist_item", resourceKind: "card", resourceId: card.id, invalidate: [`/api/cards/${card.id}`],
    });
    setNewChecklistItem("");
    if (result.queued) setStatus("Checklist item queued for synchronization.");
    else await refreshCardActivity();
  }
  async function toggleChecklistItem(item: ChecklistItem) {
    const result = await mutateApi(`/api/checklist/${item.id}`, {
      method: "PATCH", body: { completed: !item.completed }, label: `${!item.completed ? "Complete" : "Reopen"} ${item.text}`,
      dedupeKey: `checklist:${item.id}`, entityType: "checklist_item", entityId: item.id, resourceKind: "card", resourceId: card?.id || null,
      baseSnapshot: item as unknown as Record<string, unknown>, localSnapshot: { completed: !item.completed }, changedFields: ["completed"], invalidate: card ? [`/api/cards/${card.id}`] : undefined,
    });
    if (!result.queued) await refreshCardActivity(); else setStatus("Checklist change queued for synchronization.");
  }
  async function deleteChecklistItem(item: ChecklistItem) {
    const result = await mutateApi(`/api/checklist/${item.id}`, { method: "DELETE", label: `Delete ${item.text}`, entityType: "checklist_item", entityId: item.id, resourceKind: "card", resourceId: card?.id || null, invalidate: card ? [`/api/cards/${card.id}`] : undefined });
    if (!result.queued) await refreshCardActivity(); else setStatus("Checklist deletion queued for synchronization.");
  }
  async function promoteChecklistItem(item: ChecklistItem) {
    if (!card) return;
    const result = await mutateApi<Card>(`/api/checklist/${item.id}/promote`, {
      method: "POST", body: { targetListId: card.listId }, label: `Promote ${item.text} to Card`, entityType: "checklist_item", entityId: item.id, resourceKind: "card", resourceId: card.id, invalidate: ["/api/projects", "/api/boards", `/api/cards/${card.id}`],
    });
    if (result.queued) setStatus("Checklist promotion queued for synchronization.");
    else { setStatus(`Promoted “${item.text}” to a child Card.`); await refreshCardActivity(); }
  }
  async function duplicateCard() {
    if (!card) return;
    setStatus("Duplicating card...");
    try {
      const result = await mutateApi(`/api/cards/${card.id}/duplicate`, { method: "POST", body: { title: `${title.trim() || card.title} copy`.slice(0, 240) }, label: `Duplicate ${card.title}`, entityType: "card", resourceKind: "card", resourceId: card.id, invalidate: ["/api/projects", "/api/boards"] });
      setStatus(result.queued ? "Card duplication queued for synchronization." : "Card duplicated with its checklist and planning fields.");
      if (!result.queued) await refreshCardActivity();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Card could not be duplicated.");
    }
  }
  async function archiveCard() {
    if (!card) return;
    if (!await confirmCluster({ title: "Archive card?", message: "Archive this card? It will be hidden from the active board and can be restored.", confirmLabel: "Archive card" })) return;
    const result = await mutateApi<Card>(`/api/cards/${card.id}`, { method: "PATCH", body: { archived: true, expectedRevision: card.revision || 1 }, label: `Archive ${card.title}`, dedupeKey: `card:${card.id}`, entityType: "card", entityId: card.id, resourceKind: "card", resourceId: card.id, baseRevision: card.revision || 1, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: { archived: true }, changedFields: ["archived"], invalidate: ["/api/projects", "/api/boards"] });
    if (result.queued) {
      setStatus("Card archive queued for synchronization.");
      return;
    }
    if (result.result && onArchived) await onArchived(result.result);
    else await onSaved();
  }
  async function deleteCard() {
    if (!card) return;
    if (!await confirmCluster({ title: "Delete card permanently?", message: "This action cannot be undone.", confirmLabel: "Delete card", tone: "danger" })) return;
    const result = await mutateApi(`/api/cards/${card.id}`, { method: "DELETE", body: { expectedRevision: card.revision }, label: `Delete ${card.title}`, entityType: "card", entityId: card.id, resourceKind: "card", resourceId: card.id, baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, invalidate: ["/api/projects", "/api/boards"] });
    if (!result.queued) await onSaved(); else setStatus("Card deletion queued for synchronization.");
  }
  async function addComment() {
    if (!card || !newComment.trim()) return;
    const result = await mutateApi(`/api/cards/${card.id}/comments`, { method: "POST", body: { body: newComment.trim() }, label: `Comment on ${card.title}`, entityType: "comment", resourceKind: "card", resourceId: card.id, localSnapshot: { body: newComment.trim() }, changedFields: ["body"], invalidate: [`/api/cards/${card.id}`] });
    setNewComment("");
    if (!result.queued) await refreshCardActivity(); else setStatus("Comment saved on this device and queued for synchronization.");
  }
  return (
    <ClusterModal open onClose={() => { void requestClose(); }} busy={saving} backdropClassName="workspace-detail-backdrop-v254 card-editor-backdrop-v254" className="modal panel card-editor card-editor-fullscreen-v254" labelledBy="card-editor-title-v393">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{mode === "create" ? "New card" : "Edit card"}</p>
            <h2 id="card-editor-title-v393">{mode === "create" ? "Create card" : "Card details"}</h2>
          </div>
          <div className="button-row">{card ? <ResourceSyncBadge resourceKind="card" resourceId={card.id} /> : null}{card ? <WorkActionMenu context={{ source: { kind: "card", id: card.id, projectId, label: title || card.title }, navigation: { screen: "board", projectId, boardId, inspectScope: "card", inspectId: card.id }, projectId, boardId, assigneeId: assigneeId || null, dueDate: dueDate || null }} label={`${title || card.title} work actions`} allowAssign allowMention onAssign={() => document.querySelector<HTMLElement>('[aria-label="Card assignee"]')?.focus()} onMention={() => document.querySelector<HTMLTextAreaElement>('[data-work-mention-target="card"]')?.focus()} /> : null}<ClusterIconButton label="Close card editor" type="button" onClick={() => { void requestClose(); }} title="Close"><ClusterIcon name="close" /></ClusterIconButton></div>
        </div>

        <div className="editor-grid">
          <div className="field span-2">
            <label>Title</label>
            <ClusterTextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix inventory crash" />
          </div>

          <div className="field span-2">
            <label>Description</label>
            <ClusterTextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to happen? Include scope, acceptance notes, and references." />
          </div>

          <div className="field">
            <label>Priority</label>
            <ClusterNativeSelect value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </ClusterNativeSelect>
          </div>

          <PeoplePicker value={assigneeId} onChange={setAssigneeId} people={users} label="Assignee" ariaLabel="Card assignee" />

          <BoardCardPlanningFields
            category={category}
            onCategoryChange={setCategory}
            startDate={startDate}
            onStartDateChange={setStartDate}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
            deferredUntil={deferredUntil}
            onDeferredUntilChange={setDeferredUntil}
            completionCriteria={completionCriteria}
            onCompletionCriteriaChange={setCompletionCriteria}
            estimatePoints={estimatePoints}
            onEstimatePointsChange={setEstimatePoints}
            coverColor={coverColor}
            onCoverColorChange={setCoverColor}
            coverImage={coverImage}
            onCoverImageChange={setCoverImage}
            memberIds={memberIds}
            onMemberIdsChange={setMemberIds}
            watching={watching}
            onWatchingChange={setWatching}
            users={users}
          />

          <div className="field span-2">
            <label>Colored board labels</label>
            <div className="board-card-label-picker-v308">
              {labelDefinitions.map((definition) => {
                const selected = labelArray.some((label) => label.toLowerCase() === definition.name.toLowerCase());
                return <ClusterButton unstyled key={definition.id} type="button" className={selected ? "selected" : ""} style={runtimeStyle({ "--label-color": definition.color })} onClick={() => setLabels(selected ? labelArray.filter((label) => label.toLowerCase() !== definition.name.toLowerCase()).join(", ") : unique([...labelArray, definition.name]).join(", "))}><span />{definition.name}</ClusterButton>;
              })}
            </div>
            <label>Additional tags</label>
            <ClusterTextInput value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="bug, ui, high-risk" />
            {tagPresets.length > 0 && (
              <div className="chip-picker tag-preset-picker">
                {tagPresets.map((label) => (
                  <ClusterButton unstyled type="button" key={`preset-${label}`} onClick={() => addLabel(label)}>
                    {label}
                  </ClusterButton>
                ))}
              </div>
            )}
          </div>

          {card && sourceIssueProviderAvailable ? <div className="field span-2">
            <label>External issue link</label>
            <ClusterNativeSelect
              value={sourceIssueId}
              onChange={(event) => {
                const issue = sourceIssues.find((item) => String(item.id) === String(event.target.value));
                if (issue) void linkSourceIssue(issue);
              }}
            >
              <option value="">No linked external issue</option>
              {sourceIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  {issue.number ? `#${issue.number} ` : ""}[{issue.state}] {issue.title}
                </option>
              ))}
            </ClusterNativeSelect>
          </div> : null}

          {card && sourceIssueId ? (
            <div className="issue-panel span-2">
              <div>
                <strong>{sourceIssueNumber ? `#${sourceIssueNumber} ` : ""}{sourceIssueTitle || "External issue"}</strong>
                <span>
                  {sourceIssueState || "open"}
                  {sourceIssueAssignee ? ` · assigned to ${sourceIssueAssignee}` : ""}
                  {sourceIssueUpdatedAt ? ` · updated ${new Date(sourceIssueUpdatedAt).toLocaleDateString()}` : ""}
                </span>
              </div>
              <div className="label-row">
                {sourceIssueLabels.map((label) => <span className="label git" key={label}>{label}</span>)}
              </div>
              <div className="button-row">
                {sourceIssueUrl ? <ClusterLinkButton href={sourceIssueUrl} target="_blank" variant="secondary" size="compact">Open issue</ClusterLinkButton> : null}
                <ClusterButton type="button" onClick={() => void syncSourceIssue()} disabled={!sourceIssueProviderAvailable} variant="secondary" size="compact">Refresh</ClusterButton>
                <ClusterButton type="button" onClick={() => void setLinkedSourceIssueState("closed")} disabled={!sourceIssueProviderAvailable} variant="secondary" size="compact">Close issue</ClusterButton>
                <ClusterButton type="button" onClick={() => void setLinkedSourceIssueState("open")} disabled={!sourceIssueProviderAvailable} variant="secondary" size="compact">Reopen issue</ClusterButton>
                <ClusterButton type="button" onClick={() => void unlinkSourceIssue()} variant="quiet" size="compact">Unlink</ClusterButton>
              </div>
            </div>
          ) : card && sourceIssueProviderAvailable === false ? (
            <div className="issue-panel span-2">
              <strong>External issue linking is off</strong>
              <span>Cluster Source Control works without an external Git provider. Configure an optional remote/provider in Tool Infrastructure only if this project needs external issue linking.</span>
            </div>
          ) : card ? (
            <div className="issue-panel span-2">
              <strong>No external issue linked</strong>
              <span>Create an issue through the configured external provider and link it to this card. The card remains the Cluster source of truth.</span>
              <ClusterTextArea value={createIssueExtra} onChange={(event) => setCreateIssueExtra(event.target.value)} placeholder="Optional additional issue context" />
              <ClusterButton type="button" onClick={() => void createSourceIssueFromCard()} variant="secondary" size="compact">Create external issue</ClusterButton>
            </div>
          ) : null}

          <div className="field span-2 compact-field">
            <label>External link</label>
            <ClusterTextInput value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="Design doc, asset folder, reference link..." />
          </div>
        </div>

        {card && (
          <div className="card-subsections">
            <section>
              <h3>Checklist</h3>
              <div className="checklist">
                {card.checklistItems.map((item) => (
                  <div key={item.id} className="check-item">
                    <label>
                      <ClusterInput type="checkbox" checked={item.completed} onChange={() => toggleChecklistItem(item)} />
                      <span className={item.completed ? "done" : ""}>{item.text}</span>
                    </label>
                    <div className="button-row">
                      <ClusterButton type="button" className="" onClick={() => void promoteChecklistItem(item)} variant="quiet" size="compact">Promote</ClusterButton>
                      <ClusterButton type="button" className="" onClick={() => deleteChecklistItem(item)} variant="quiet" size="compact">Delete</ClusterButton>
                    </div>
                  </div>
                ))}
              </div>
              <div className="inline-form">
                <ClusterTextInput value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} placeholder="Add checklist item" />
                <ClusterButton type="button" className="" onClick={addChecklistItem} variant="secondary">
                  Add
                </ClusterButton>
              </div>
            </section>

            <section>
              <h3>External issue</h3>
              <p className="muted tight">Optional provider issue linked to this card. Native Cluster Source Control does not depend on it.</p>
              <div className="inline-form">
                <ClusterTextInput value={sourceIssueComment} onChange={(event) => setSourceIssueComment(event.target.value)} placeholder="Comment on linked issue" disabled={!sourceIssueId || !sourceIssueProviderAvailable} />
                <ClusterButton type="button" onClick={() => void postCommentToSourceIssue()} disabled={!sourceIssueId || !sourceIssueProviderAvailable || !sourceIssueComment.trim()} variant="secondary">Post</ClusterButton>
              </div>
            </section>

            <section className="span-2 card-discussion-v227">
              <div className="card-discussion-head-v227">
                <div className="collaboration-title-icon-v227">
                  <ClusterIcon name="comment" />
                </div>
                <div>
                  <h3>Card discussion</h3>
                  <p>
                    {card.comments.length} comment
                    {card.comments.length === 1 ? "" : "s"} attached to this card
                  </p>
                </div>
              </div>
              <div className="card-comment-compose-v227">
                <PresenceAvatar userId={currentUser.id} imageUrl={currentUser.avatarUrl} label={displayUserName(currentUser)} fallback={userInitial(currentUser)} state={presenceState(currentUser)} title={presenceLabel(currentUser)} className="comment-avatar-v227" />
                <ClusterTextArea
                  data-work-mention-target="card"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add context, a decision, or a question…"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void addComment();
                  }}
                />
                <ClusterButton type="button" className="" onClick={addComment} disabled={!newComment.trim()} variant="primary">
                  Post
                </ClusterButton>
              </div>
              <div className="card-comment-list-v227">
                {card.comments.map((comment) => {
                  const author = comment.user;
                  return (
                    <article key={comment.id}>
                      <PresenceAvatar userId={author?.id} imageUrl={author?.avatarUrl} label={displayUserName(author)} fallback={userInitial(author || ({ username: "Cluster" } as User))} state={author ? presenceState(author) : "offline"} title={author ? presenceLabel(author) : "Former user"} className="comment-avatar-v227" />
                      <div>
                        <header>
                          <strong>{displayUserName(author)}</strong>
                          <span>{new Date(comment.createdAt).toLocaleString()}</span>
                        </header>
                        <p>{comment.body}</p>
                      </div>
                    </article>
                  );
                })}
                {!card.comments.length && <p className="card-comments-empty-v227">No comments on this card yet.</p>}
              </div>
            </section>

            <section className="span-2">
              <div className="panel-title-row">
                <div><h3>Planning relationships</h3><p className="muted tight">Dependencies and release association use Cluster's canonical work graph.</p></div>
                <div className="button-row">
                  <ClusterButton size="compact" variant="secondary" onClick={() => requestLinkedWorkManager({ source: { kind: "card", id: card.id, projectId, label: card.title }, projectId, boardId, relationship: "depends_on", targetKind: "card" })}>Add dependency</ClusterButton>
                  <ClusterButton size="compact" variant="quiet" onClick={() => requestLinkedWorkManager({ source: { kind: "card", id: card.id, projectId, label: card.title }, projectId, boardId, relationship: "ships_in", targetKind: "release" })}>Associate release</ClusterButton>
                </div>
              </div>
              <LinkedWorkPanel projectId={projectId} kind="card" entityId={card.id} compact title="Dependencies & linked work" />
              <CardProjectionPanel projectId={projectId} currentBoardId={boardId} card={card} boards={projectBoards} />
              <SharedWorkEvidencePanel projectId={projectId} kind="card" entityId={card.id} label={card.title} compact />
              <SharedWorkWatchControl entity={{ kind: "card", id: card.id, projectId, label: card.title }} compact />
            </section>

            <section className="span-2">
              <CustomFieldValuesPanel compact entity="card" entityId={card.id} projectId={projectId} title="Card fields" />
            </section>

            <section className="span-2 board-recurring-card-v495">
              <div className="board-recurring-card-head-v495">
                <div><h3>Recurring card</h3><p>Create future copies through the project automation engine. The original card stays untouched.</p></div>
                <ClusterButton variant="secondary" size="compact" busy={recurringBusy} busyLabel="Creating…" onClick={() => void createRecurringCardRule()}>Create recurrence</ClusterButton>
              </div>
              <div className="board-recurring-card-fields-v495">
                <div className="field compact-field"><label>Repeat every</label><NumberStepper min={1} max={90} value={repeatEvery} onValueChange={(value) => setRepeatEvery(Math.max(1, Number(value) || 1))} ariaLabel="Recurring card interval" /></div>
                <div className="field compact-field"><label>Unit</label><ClusterSelect value={repeatUnit} onChange={(value) => setRepeatUnit(value as "day" | "week")} ariaLabel="Recurring card unit" options={[{ value: "day", label: "Days" }, { value: "week", label: "Weeks" }]} /></div>
                <div className="field compact-field"><label>Due after</label><NumberStepper min={0} max={3650} value={repeatDueInDays} onValueChange={(value) => setRepeatDueInDays(Math.max(0, Number(value) || 0))} ariaLabel="Recurring card due offset in days" /></div>
                <span className="muted">days after each copy is created</span>
              </div>
            </section>

            <section className="span-2">
              <h3>Activity</h3>
              <div className="activity-list">
                {(card.activity || []).length ? (
                  (card.activity || []).map((item) => (
                    <article key={item.id} className="activity-item">
                      <span>{item.type}</span>
                      <strong>{item.message}</strong>
                      <em>{new Date(item.createdAt).toLocaleString()}</em>
                    </article>
                  ))
                ) : (
                  <p className="muted">No activity yet.</p>
                )}
              </div>
            </section>
          </div>
        )}

        {saveError ? <RequestErrorState compact error={saveError} title={saveError instanceof ApiError && saveError.status === 409 ? "Card changed on another client" : "Card was not saved"} onRetry={saveError instanceof ApiError && saveError.status === 409 ? () => void fetchConflictVersion() : () => void saveCard()} retryLabel={saveError instanceof ApiError && saveError.status === 409 ? "Refresh conflict review" : "Try saving again"} /> : null}
        {saveError instanceof ApiError && saveError.status === 409 && !conflictCard ? <ClusterButton type="button" variant="secondary" disabled={conflictLoading} onClick={() => void fetchConflictVersion()}>{conflictLoading ? "Loading latest Card…" : "Compare with latest Card"}</ClusterButton> : null}
        {conflictCard && conflictReview ? <section className="board-card-conflict-review-v535" role="region" aria-label="Card edit conflict review">
          <h3>Review concurrent edits</h3>
          <p>Server revision {conflictCard.revision}; your draft is still local. {conflictReview.localChanges.length} field(s) edited here, {conflictReview.serverChanges.length} changed on the server. Independent edits are preserved after your review; member and label additions or removals reconcile individually.</p>
          {conflictCard.listId !== initialCard?.listId ? <p className="status-box">This Card moved to another column while you were editing. Its current column will be preserved.</p> : null}
          {conflictReview.conflicts.length ? <div className="board-card-conflict-list-v535">{conflictReview.conflicts.map((item) => <div className="board-card-conflict-field-v535" key={item.field}>
            <strong>{item.field.replace(/([A-Z])/g, " $1")}</strong>
            <div><small>Your version: {describeBoardDraftValue(item.mine)}</small><small>Server version: {describeBoardDraftValue(item.server)}</small></div>
            <div className="button-row" role="group" aria-label={`Resolve ${item.field}`}>
              <ClusterButton type="button" size="compact" variant={conflictChoices[item.field] === "mine" ? "primary" : "secondary"} onClick={() => setConflictChoices((current) => ({ ...current, [item.field]: "mine" }))}>Keep mine</ClusterButton>
              <ClusterButton type="button" size="compact" variant={conflictChoices[item.field] === "server" ? "primary" : "secondary"} onClick={() => setConflictChoices((current) => ({ ...current, [item.field]: "server" }))}>Use server</ClusterButton>
            </div>
          </div>)}</div> : <p>No fields overlap. Your independent changes can be combined with the latest Card.</p>}
          <div className="button-row">
            <ClusterButton type="button" variant="primary" disabled={conflictReview.conflicts.some((item) => !conflictChoices[item.field])} onClick={applyConflictReview}>Apply reviewed changes to draft</ClusterButton>
            <ClusterButton type="button" variant="secondary" disabled={conflictLoading} onClick={() => void fetchConflictVersion()}>Check latest revision again</ClusterButton>
          </div>
          <small>Applying a merge does not save. Another server edit will require a new review.</small>
        </section> : null}
        {mode === 'edit' && savedHistory?.operations.length ? <section className="board-saved-history-v546" aria-label="Saved Card edit history">
          <h3>Saved edit history</h3>
          <p className="muted tight">Up to 40 recent saved metadata changes. Only your latest uninterrupted save can be undone or redone; moves and other editors' work are protected.</p>
          <ol>{savedHistory.operations.slice(0, 5).map((operation) => <li key={operation.id}>
            <strong>{operation.action === 'update' ? 'Saved' : operation.action === 'undo' ? 'Undid' : operation.action === 'redo' ? 'Redid' : 'Saved (not reversible)'} revision {operation.appliedRevision}</strong>
            <span> · {operation.actorUserId === currentUser.id ? 'You' : 'Another editor'} · {operation.fields.join(', ')} · {new Date(operation.createdAt).toLocaleString()}</span>
          </li>)}</ol>
        </section> : null}
        {status ? <ClusterOperationFeedback state={saving ? "working" : "success"} message={status} /> : null}
        {error && <div className="error-box" role="alert">{error}</div>}

        <div className="modal-actions split-actions">
          <div className="button-row">
            {card && <ClusterButton variant="secondary" onClick={() => scheduleCard("calendar")}>Add to Calendar</ClusterButton>}
            {card && <ClusterButton variant="secondary" onClick={() => scheduleCard("time")}>Schedule work</ClusterButton>}
            {card && (
              <ClusterButton type="button" className="" onClick={duplicateCard} variant="secondary">
                Duplicate
              </ClusterButton>
            )}
            {card && (
              <ClusterButton type="button" className="" onClick={archiveCard} variant="secondary">
                Archive
              </ClusterButton>
            )}
            {card && (
              <ClusterButton type="button" className="" onClick={deleteCard} variant="danger">
                Delete
              </ClusterButton>
            )}
          </div>
          <div className="button-row">
            <ClusterButton type="button" size="compact" variant="secondary" disabled={saving || !draftHistory.undo.length} title="Undo unsaved edits (Ctrl+Z outside text fields)" onClick={() => restoreDraft('undo')}>Undo draft ({draftHistory.undo.length})</ClusterButton>
            <ClusterButton type="button" size="compact" variant="secondary" disabled={saving || !draftHistory.redo.length} title="Redo unsaved edits (Ctrl+Y outside text fields)" onClick={() => restoreDraft('redo')}>Redo ({draftHistory.redo.length})</ClusterButton>
            {mode === 'edit' && savedHistory && savedHistoryBlocked ? <span className="muted" role="status" title={resourceSyncState.lastError || undefined}>{resourceSyncState.state !== "synced" ? `Saved history paused: ${resourceSyncState.state} Card changes` : "Saved history requires a server connection"}</span> : null}
            {mode === 'edit' && savedHistory ? <>
              <ClusterButton type="button" size="compact" variant="secondary" title="Reverse your most recent saved Card edit. Unavailable after another edit or move." disabled={saving || savedHistoryBusy || savedHistoryBlocked || editorDirty || Boolean(conflictCard) || savedHistory.currentRevision !== openedRevision || !savedHistory.canUndo} onClick={() => void changeSavedCardHistory('undo')}>Undo saved</ClusterButton>
              <ClusterButton type="button" size="compact" variant="secondary" title="Reapply the saved edit you just undid." disabled={saving || savedHistoryBusy || savedHistoryBlocked || editorDirty || Boolean(conflictCard) || savedHistory.currentRevision !== openedRevision || !savedHistory.canRedo} onClick={() => void changeSavedCardHistory('redo')}>Redo saved</ClusterButton>
            </> : null}
            <ClusterButton type="button" className="" onClick={() => void requestClose()} disabled={saving} variant="secondary">
              Cancel
            </ClusterButton>
            <ClusterButton type="button" className="" onClick={() => void saveCard()} disabled={saving || Boolean(conflictCard) || !title.trim()} busy={saving} busyLabel="Saving…" variant="primary">
              {mode === "create" ? "Create" : "Save"}
            </ClusterButton>
          </div>
        </div>
    </ClusterModal>
  );
}

import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { boardCardDeadlineNeedsAttention, boardCardOverdue, formatBoardCivilDate } from "./board-civil-date";
import { ClusterIcon } from "../../components/ClusterIcon";
import { displayUserName, userInitial } from "../people/people-utils";
import { collaborationColor, type CollaborationPresence } from "../collaboration";
import type { BoardLabelDefinition, Card, Priority, UserActivitySummary } from "../application/application-models";
import { boardLabelColor } from "./board-appearance";
import { cardSourceIssue } from "./board-workspace-model";
import { cardDeferredUntil, cardStateAgeDays, cardStaleDays } from "./board-planning-intelligence";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterContextMenuSurface, useClusterContextMenu } from "../../components/ClusterContextMenu";

function priorityIcon(priority: Priority) {
  if (priority === "urgent") return "!!";
  if (priority === "high") return "!";
  if (priority === "medium") return "•";
  return "-";
}

export function isCardOverdue(value?: string | null) {
  return boardCardOverdue(value);
}

function memberInitial(member?: UserActivitySummary) {
  return (member?.displayName || member?.username || "?").slice(0, 1).toUpperCase();
}

export const BoardCardTile = memo(function BoardCardTile({ card, onOpen, onMove, onReorder, canMovePrevious, canMoveNext, canMoveUp, canMoveDown, density, liveEditor, userById, currentUserId, labelDefinitions, listDone = false, blocked = false }: { card: Card; onOpen: (card: Card) => void; onMove?: (card: Card, direction: "previous" | "next") => void; onReorder?: (card: Card, direction: "up" | "down") => void; canMovePrevious?: boolean; canMoveNext?: boolean; canMoveUp?: boolean; canMoveDown?: boolean; density: "compact" | "comfortable"; liveEditor?: CollaborationPresence | null; userById: Map<string, UserActivitySummary>; currentUserId: string; labelDefinitions: BoardLabelDefinition[]; listDone?: boolean; blocked?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `card:${card.id}`, disabled: Boolean(liveEditor) });
  const contextMenu = useClusterContextMenu<HTMLButtonElement>({ disabled: Boolean(liveEditor) });
  const checklistDone = card.checklistItems.filter((item) => item.completed).length;
  const overdue = boardCardDeadlineNeedsAttention(card.dueDate, listDone);
  const memberIds = Array.from(new Set([...(card.memberIds || []), ...(card.assigneeId ? [card.assigneeId] : [])]));
  const members = memberIds.map((id) => userById.get(id)).filter(Boolean) as UserActivitySummary[];
  const watching = (card.watcherIds || []).includes(currentUserId);
  const deferred = cardDeferredUntil(card);
  const stateAgeDays = cardStateAgeDays(card);
  const staleDays = listDone || deferred ? 0 : cardStaleDays(card);
  const sourceIssue = cardSourceIssue(card);
  const contextItems = [
    { id: "open", label: "Open card", description: "Open the Card inspector.", icon: "forward" as const, onSelect: () => onOpen(card) },
    ...(onReorder && canMoveUp ? [{ id: "move-up", label: "Move up", icon: "chevron-up" as const, onSelect: () => onReorder(card, "up" as const) }] : []),
    ...(onReorder && canMoveDown ? [{ id: "move-down", label: "Move down", icon: "chevron-down" as const, onSelect: () => onReorder(card, "down" as const) }] : []),
    ...(onMove && canMovePrevious ? [{ id: "move-previous", label: "Previous column", icon: "chevron-left" as const, onSelect: () => onMove(card, "previous" as const) }] : []),
    ...(onMove && canMoveNext ? [{ id: "move-next", label: "Next column", icon: "chevron-right" as const, onSelect: () => onMove(card, "next" as const) }] : []),
  ];
  const style = runtimeStyle({
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    "--card-cover-color": card.coverColor || "transparent",
  });
  return (
    <article ref={setNodeRef} style={style} className={`task-card ${density} ${isDragging ? "dragging" : ""} ${overdue ? "overdue" : ""} ${blocked ? "blocked" : ""} ${liveEditor ? "live-edit-locked-v196" : ""} ${card.coverImage || card.coverColor ? "has-card-cover-v300" : ""}`}>
      {(card.coverImage || card.coverColor) && <div className="task-card-cover-v300" style={runtimeStyle({ backgroundImage: card.coverImage ? `url(${card.coverImage})` : undefined })} />}
      <ClusterButton unstyled type="button" className="drag-handle" {...listeners} {...attributes} onKeyDownCapture={(event) => { const handled = event.altKey && ((event.key === "ArrowUp" && onReorder && canMoveUp && (onReorder(card, "up"), true)) || (event.key === "ArrowDown" && onReorder && canMoveDown && (onReorder(card, "down"), true)) || (event.key === "ArrowLeft" && onMove && canMovePrevious && (onMove(card, "previous"), true)) || (event.key === "ArrowRight" && onMove && canMoveNext && (onMove(card, "next"), true))); if (handled) { event.preventDefault(); event.stopPropagation(); } }} aria-label={liveEditor ? `${liveEditor.userName} is editing ${card.title}` : `Move ${card.title}. Space starts drag. Alt plus arrow keys reorders or moves between columns.`} title={liveEditor ? `${liveEditor.userName} is editing this card` : "Move card"} disabled={Boolean(liveEditor)}><ClusterIcon name="drag" aria-hidden="true" /></ClusterButton>
      <ClusterButton ref={contextMenu.anchorRef} {...contextMenu.targetProps} unstyled type="button" className="card-main" onClick={() => onOpen(card)}>
        {card.category && <span className="card-category-v300">{card.category}</span>}
        <div className="card-title-row"><strong>{card.title}</strong><span className={`priority ${card.priority}`}>{priorityIcon(card.priority)} {card.priority}</span></div>
        {liveEditor && <div className="live-edit-badge-v196"><span style={runtimeStyle({ background: collaborationColor(liveEditor.userId) })} />{liveEditor.userName} is editing</div>}
        {density === "comfortable" && card.description && <p>{card.description}</p>}
        {(card.labels.length > 0 || (sourceIssue?.labels || []).length > 0) && <div className="label-row">
          {card.labels.slice(0, density === "compact" ? 3 : 8).map((label) => <span className="label board-label-chip-v308" style={runtimeStyle({ "--label-color": boardLabelColor(label, labelDefinitions) })} key={label}>{label}</span>)}
          {(sourceIssue?.labels || []).slice(0, density === "compact" ? 2 : 8).map((label) => <span className="label git" key={`source-${label}`}>{label}</span>)}
        </div>}
        {sourceIssue && <div className="issue-strip"><span>{sourceIssue.number ? `#${sourceIssue.number}` : "Issue"}</span><strong>{sourceIssue.title}</strong><em>{sourceIssue.state}</em></div>}
        <div className="meta-row card-meta-row-v300">
          {card.startDate && <span>Starts {formatBoardCivilDate(card.startDate)}</span>}
          {card.dueDate && <span className={overdue ? "meta-danger" : ""}>Due {formatBoardCivilDate(card.dueDate)}</span>}
          {deferred && card.deferredUntil && <span>Deferred to {formatBoardCivilDate(card.deferredUntil)}</span>}
          {!listDone && stateAgeDays > 0 && <span>{stateAgeDays}d in state</span>}
          {staleDays >= 7 && <span className="meta-danger">Stale {staleDays}d</span>}
          {blocked && <span className="meta-danger">Blocked</span>}
          {card.completionCriteria && <span>Criteria</span>}
          {card.estimatePoints != null && <span>{card.estimatePoints} pts</span>}
          {card.checklistItems.length > 0 && <span>{checklistDone}/{card.checklistItems.length} checks</span>}
          {card.comments.length > 0 && <span>{card.comments.length} comments</span>}
          {watching && <span className="watching-badge-v300">Watching</span>}
          {sourceIssue && <span>Source</span>}
          {card.externalUrl && <span>Link</span>}
        </div>
        {members.length > 0 && <div className="card-member-row-v300" aria-label={`${members.length} members`}>
          {members.slice(0, 4).map((member) => <span key={member.id} title={member.displayName || member.username}>{member.avatarUrl ? <img loading="lazy" decoding="async" src={member.avatarUrl} alt="" /> : memberInitial(member)}</span>)}
          {members.length > 4 && <span>+{members.length - 4}</span>}
          {card.assignee && <em>Lead: {displayUserName(card.assignee)} ({userInitial(card.assignee)})</em>}
        </div>}
      </ClusterButton>
      <ClusterContextMenuSurface id={contextMenu.id} open={contextMenu.open} label={`${card.title} actions`} items={contextItems} anchorRef={contextMenu.anchorRef} surfaceRef={contextMenu.surfaceRef} onDismiss={() => contextMenu.setOpen(false)} />
      {(onMove || onReorder) && (canMovePrevious || canMoveNext || canMoveUp || canMoveDown) ? (
        <div className="board-card-touch-move-v495" role="group" aria-label={`Reorder or move ${card.title}`}>
          <ClusterButton unstyled type="button" onClick={() => onReorder?.(card, "up")} disabled={!canMoveUp || Boolean(liveEditor)} aria-label={`Move ${card.title} up in this column`}><ClusterIcon name="chevron-up" /><span>Up</span></ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onReorder?.(card, "down")} disabled={!canMoveDown || Boolean(liveEditor)} aria-label={`Move ${card.title} down in this column`}><ClusterIcon name="chevron-down" /><span>Down</span></ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onMove?.(card, "previous")} disabled={!canMovePrevious || Boolean(liveEditor)} aria-label={`Move ${card.title} to previous column`}><ClusterIcon name="chevron-left" /><span>Previous</span></ClusterButton>
          <ClusterButton unstyled type="button" onClick={() => onMove?.(card, "next")} disabled={!canMoveNext || Boolean(liveEditor)} aria-label={`Move ${card.title} to next column`}><span>Next</span><ClusterIcon name="chevron-right" /></ClusterButton>
        </div>
      ) : null}
    </article>
  );
}, (previous, next) => previous.card.id === next.card.id && previous.card.revision === next.card.revision && previous.card.listId === next.card.listId && previous.density === next.density && previous.onOpen === next.onOpen && previous.onMove === next.onMove && previous.onReorder === next.onReorder && previous.canMovePrevious === next.canMovePrevious && previous.canMoveNext === next.canMoveNext && previous.canMoveUp === next.canMoveUp && previous.canMoveDown === next.canMoveDown && previous.liveEditor?.userId === next.liveEditor?.userId && previous.liveEditor?.editing?.entityId === next.liveEditor?.editing?.entityId && previous.currentUserId === next.currentUserId && previous.userById === next.userById && previous.labelDefinitions === next.labelDefinitions && previous.listDone === next.listDone && previous.blocked === next.blocked);

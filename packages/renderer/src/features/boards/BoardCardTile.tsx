import { memo, type KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { boardCardDeadlineNeedsAttention, boardCardOverdue, formatBoardCivilDate } from "./board-civil-date";
import { ClusterIcon } from "../../components/ClusterIcon";
import { displayUserName } from "../people/people-utils";
import { collaborationColor, type CollaborationPresence } from "../collaboration";
import type { BoardLabelDefinition, Card, Priority, UserActivitySummary } from "../application/application-models";
import { boardLabelColor } from "./board-appearance";
import { cardSourceIssue } from "./board-workspace-model";
import { cardDeferredUntil, cardStateAgeDays, cardStaleDays } from "./board-planning-intelligence";
import { runtimeStyle } from "../../core/runtime-style";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterContextMenuSurface, useClusterContextMenu } from "../../components/ClusterContextMenu";
import "./board-card.css";

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
  const sourceLabels = sourceIssue?.labels || [];
  const keyboardMove = (event: KeyboardEvent) => {
    const handled = event.altKey && ((event.key === "ArrowUp" && onReorder && canMoveUp && (onReorder(card, "up"), true)) || (event.key === "ArrowDown" && onReorder && canMoveDown && (onReorder(card, "down"), true)) || (event.key === "ArrowLeft" && onMove && canMovePrevious && (onMove(card, "previous"), true)) || (event.key === "ArrowRight" && onMove && canMoveNext && (onMove(card, "next"), true)));
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  // Trello-style tile: cover, labels, title, then one row of badges and faces.
  // The whole card drags (after a few pixels, so a click still opens it);
  // Alt + arrows move it from the keyboard, and right-click offers the moves.
  return (
    <article ref={setNodeRef} style={style} {...listeners} {...attributes} tabIndex={-1} className={`tc ${density} ${isDragging ? "dragging" : ""} ${overdue ? "overdue" : ""} ${blocked ? "blocked" : ""} ${liveEditor ? "live-edit-locked-v196" : ""}`} data-priority={card.priority}>
      {(card.coverImage || card.coverColor) && <div className="tc-cover" style={runtimeStyle({ backgroundImage: card.coverImage ? `url(${card.coverImage})` : undefined })} />}
      <ClusterButton ref={contextMenu.anchorRef} {...contextMenu.targetProps} unstyled type="button" className="tc-main" onClick={() => onOpen(card)} onKeyDownCapture={keyboardMove}
        aria-label={liveEditor ? `${card.title}. ${liveEditor.userName} is editing.` : `${card.title}. Alt plus arrow keys moves the card.`}>
        {(card.labels.length > 0 || sourceLabels.length > 0) && <span className="tc-labels">
          {card.labels.slice(0, 6).map((label) => <span className="tc-label" style={runtimeStyle({ "--label-color": boardLabelColor(label, labelDefinitions) })} key={label}>{label}</span>)}
          {sourceLabels.slice(0, 3).map((label) => <span className="tc-label tc-label--source" key={`source-${label}`}>{label}</span>)}
        </span>}
        <strong className="tc-title">{card.title}</strong>
        {liveEditor && <span className="tc-live"><i style={runtimeStyle({ background: collaborationColor(liveEditor.userId) })} />{liveEditor.userName} is editing</span>}
        {density === "comfortable" && card.description && <span className="tc-desc">{card.description}</span>}
        {sourceIssue && <span className="tc-issue"><b>{sourceIssue.number ? `#${sourceIssue.number}` : "Issue"}</b>{sourceIssue.title}</span>}
        <span className="tc-foot">
          {card.priority === "urgent" || card.priority === "high" ? <span className="tc-badge tc-badge--priority" title={`${card.priority} priority`}><ClusterIcon name="warning" />{priorityIcon(card.priority)}</span> : null}
          {(card.dueDate || card.startDate) && <span className={`tc-badge${overdue ? " tc-badge--danger" : ""}`} title={overdue ? "Overdue" : card.dueDate ? "Due" : "Starts"}><ClusterIcon name="clock" />{card.startDate && card.dueDate ? `${formatBoardCivilDate(card.startDate)} – ${formatBoardCivilDate(card.dueDate)}` : card.dueDate ? formatBoardCivilDate(card.dueDate) : formatBoardCivilDate(card.startDate)}</span>}
          {deferred && card.deferredUntil && <span className="tc-badge" title="Deferred"><ClusterIcon name="pause" />{formatBoardCivilDate(card.deferredUntil)}</span>}
          {blocked && <span className="tc-badge tc-badge--danger" title="Blocked"><ClusterIcon name="lock" />Blocked</span>}
          {staleDays >= 7 && <span className="tc-badge tc-badge--warning" title={`No change for ${staleDays} days`}><ClusterIcon name="clock" />{staleDays}d</span>}
          {card.checklistItems.length > 0 && <span className={`tc-badge${checklistDone === card.checklistItems.length ? " tc-badge--done" : ""}`} title="Checklist"><ClusterIcon name="check" />{checklistDone}/{card.checklistItems.length}</span>}
          {card.comments.length > 0 && <span className="tc-badge" title="Comments"><ClusterIcon name="comment" />{card.comments.length}</span>}
          {card.description && density !== "comfortable" && <span className="tc-badge" title="Has a description"><ClusterIcon name="text" /></span>}
          {card.externalUrl && <span className="tc-badge" title="Link"><ClusterIcon name="link" /></span>}
          {watching && <span className="tc-badge" title="Watching"><ClusterIcon name="bell" /></span>}
          {card.estimatePoints != null && <span className="tc-badge tc-badge--points" title="Estimate">{card.estimatePoints}</span>}
          {!listDone && stateAgeDays > 0 && density === "comfortable" && <span className="tc-badge" title="Days in this column">{stateAgeDays}d</span>}
          {members.length > 0 && <span className="tc-members" aria-label={`${members.length} members`}>
            {members.slice(0, 3).map((member) => <span key={member.id} title={`${displayUserName(member)}${card.assigneeId === member.id ? " · lead" : ""}`}>{member.avatarUrl ? <img loading="lazy" decoding="async" src={member.avatarUrl} alt="" /> : memberInitial(member)}</span>)}
            {members.length > 3 && <span>+{members.length - 3}</span>}
          </span>}
        </span>
      </ClusterButton>
      <ClusterContextMenuSurface id={contextMenu.id} open={contextMenu.open} label={`${card.title} actions`} items={contextItems} anchorRef={contextMenu.anchorRef} surfaceRef={contextMenu.surfaceRef} onDismiss={() => contextMenu.setOpen(false)} />
    </article>
  );
}, (previous, next) => previous.card.id === next.card.id && previous.card.revision === next.card.revision && previous.card.listId === next.card.listId && previous.density === next.density && previous.onOpen === next.onOpen && previous.onMove === next.onMove && previous.onReorder === next.onReorder && previous.canMovePrevious === next.canMovePrevious && previous.canMoveNext === next.canMoveNext && previous.canMoveUp === next.canMoveUp && previous.canMoveDown === next.canMoveDown && previous.liveEditor?.userId === next.liveEditor?.userId && previous.liveEditor?.editing?.entityId === next.liveEditor?.editing?.entityId && previous.currentUserId === next.currentUserId && previous.userById === next.userById && previous.labelDefinitions === next.labelDefinitions && previous.listDone === next.listDone && previous.blocked === next.blocked);

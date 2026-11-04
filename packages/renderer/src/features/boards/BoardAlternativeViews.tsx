import { useMemo, useState, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterContextMenuSurface, useClusterContextMenu } from "../../components/ClusterContextMenu";
import { boardCivilDateKey, formatBoardCivilDate } from "./board-civil-date";
import { runtimeStyle } from "../../core/runtime-style";
import type { BoardList, Card, Priority, UserActivitySummary } from "../application/application-models";
import { displayUserName } from "../people/people-utils";
import { isCardOverdue } from "./BoardCardTile";
import { projectBoardTimelineRows, timelineWeekStart } from "./board-timeline-projection";

export type BoardViewMode = "kanban" | "list" | "table" | "timeline" | "calendar";

export type BoardViewRow = {
  card: Card;
  list: BoardList;
};

const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low"];

function priorityTone(priority: Priority) {
  return priority === "urgent" ? "danger" : priority === "high" ? "warning" : priority === "low" ? "muted" : "neutral";
}

function cardAssignee(card: Card, users: UserActivitySummary[]) {
  if (card.assignee) return displayUserName(card.assignee);
  const user = users.find((item) => item.id === card.assigneeId);
  return user?.displayName || user?.username || "Unassigned";
}

function CardSelectButton({ selected, onToggle, label }: { selected: boolean; onToggle: () => void; label: string }) {
  return (
    <ClusterButton
      size="compact"
      variant="quiet"
      selected={selected}
      onClick={onToggle}
      className="board-row-select-v489"
      aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
      title={`${selected ? "Deselect" : "Select"} ${label}`}
    >
      <ClusterIcon name={selected ? "check" : "plus"} />
    </ClusterButton>
  );
}



function ContextualCardOpenButton({ card, selected, onToggleSelected, onOpen, className, title, children }: {
  card: Card;
  selected: boolean;
  onToggleSelected: (cardId: string) => void;
  onOpen: (card: Card) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const menu = useClusterContextMenu<HTMLButtonElement>();
  const items = [
    { id: "open", label: "Open card", icon: "forward" as const, onSelect: () => onOpen(card) },
    { id: "select", label: selected ? "Remove from selection" : "Add to selection", icon: selected ? "check" as const : "plus" as const, onSelect: () => onToggleSelected(card.id) },
  ];
  return <>
    <ClusterButton ref={menu.anchorRef} {...menu.targetProps} variant="quiet" selected={selected} className={className} onClick={() => onOpen(card)} title={title}>
      {children}
    </ClusterButton>
    <ClusterContextMenuSurface id={menu.id} open={menu.open} label={`${card.title} actions`} items={items} anchorRef={menu.anchorRef} surfaceRef={menu.surfaceRef} onDismiss={() => menu.setOpen(false)} />
  </>;
}

function CalendarCardButton({ card, list, selected, onToggleSelected, onOpen }: { card: Card; list: BoardList; selected: boolean; onToggleSelected: (cardId: string) => void; onOpen: (card: Card) => void }) {
  return (
    <ContextualCardOpenButton card={card} selected={selected} onToggleSelected={onToggleSelected} onOpen={onOpen} className={`board-calendar-card-v489 priority-${priorityTone(card.priority)}`} title={`${card.title} · ${list.title}`}>
      <span>{card.title}</span><em>{list.title}</em>
    </ContextualCardOpenButton>
  );
}

function CardFacts({ card, users }: { card: Card; users: UserActivitySummary[] }) {
  const checklistTotal = card.checklistItems?.length || 0;
  const checklistDone = card.checklistItems?.filter((item) => item.completed).length || 0;
  return (
    <div className="board-view-card-facts-v489">
      <span className={`priority-${priorityTone(card.priority)}`}>{card.priority}</span>
      <span>{cardAssignee(card, users)}</span>
      {card.dueDate ? <span className={isCardOverdue(card.dueDate) ? "overdue" : ""}>{formatBoardCivilDate(card.dueDate)}</span> : <span>No due date</span>}
      {checklistTotal ? <span>{checklistDone}/{checklistTotal} checklist</span> : null}
      {card.estimatePoints !== null && card.estimatePoints !== undefined ? <span>{card.estimatePoints} pt</span> : null}
    </div>
  );
}

export function BoardListView({ rows, users, selectedIds, onToggleSelected, onOpen }: {
  rows: BoardViewRow[];
  users: UserActivitySummary[];
  selectedIds: Set<string>;
  onToggleSelected: (cardId: string) => void;
  onOpen: (card: Card) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, { list: BoardList; rows: BoardViewRow[] }>();
    rows.forEach((row) => {
      const current = groups.get(row.list.id) || { list: row.list, rows: [] };
      current.rows.push(row);
      groups.set(row.list.id, current);
    });
    return Array.from(groups.values());
  }, [rows]);

  return (
    <div className="board-alt-view-v489 board-list-view-v489">
      {grouped.map(({ list, rows: listRows }) => (
        <section key={list.id} className="board-list-view-section-v489 panel">
          <header>
            <div><i style={runtimeStyle({ background: list.color || "var(--cluster-blue-500)" })} /><strong>{list.title}</strong></div>
            <span>{listRows.length} card{listRows.length === 1 ? "" : "s"}</span>
          </header>
          <div className="board-list-view-rows-v489">
            {listRows.map(({ card }) => (
              <article key={card.id} className={selectedIds.has(card.id) ? "selected" : ""}>
                <CardSelectButton selected={selectedIds.has(card.id)} onToggle={() => onToggleSelected(card.id)} label={card.title} />
                <ContextualCardOpenButton card={card} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen} className="board-list-view-open-v489">
                  <span className="board-view-card-title-v489">{card.title}</span>
                  <CardFacts card={card} users={users} />
                </ContextualCardOpenButton>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!rows.length ? <ClusterEmptyState compact kind="filtered" icon="grid" className="board-alt-empty-v489" title="No cards match this view" description="Clear a filter or choose another saved view." /> : null}
    </div>
  );
}

export function BoardTableView({ rows, users, selectedIds, onToggleSelected, onOpen }: {
  rows: BoardViewRow[];
  users: UserActivitySummary[];
  selectedIds: Set<string>;
  onToggleSelected: (cardId: string) => void;
  onOpen: (card: Card) => void;
}) {
  return (
    <div className="board-alt-view-v489 board-table-view-v489 panel" role="table" aria-label="Board table view" aria-rowcount={rows.length}>
      <div className="board-table-header-v489" role="row">
        <span role="columnheader" aria-label="Selection" />
        <span role="columnheader">Card</span>
        <span role="columnheader">Column</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader">Owner</span>
        <span role="columnheader">Due</span>
        <span role="columnheader">Checklist</span>
        <span role="columnheader">Points</span>
      </div>
      <div className="board-table-body-v489" role="rowgroup">
        {rows.map(({ card, list }) => (
          <div key={card.id} className={`board-table-row-v489 ${selectedIds.has(card.id) ? "selected" : ""}`} role="row" aria-selected={selectedIds.has(card.id)}>
            <span role="cell"><CardSelectButton selected={selectedIds.has(card.id)} onToggle={() => onToggleSelected(card.id)} label={card.title} /></span>
            <span role="cell"><ContextualCardOpenButton card={card} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen} className="board-table-card-v489">{card.title}</ContextualCardOpenButton></span>
            <span role="cell">{list.title}</span>
            <span role="cell" className={`priority-${priorityTone(card.priority)}`}>{card.priority}</span>
            <span role="cell">{cardAssignee(card, users)}</span>
            <span role="cell" className={card.dueDate && isCardOverdue(card.dueDate) ? "overdue" : ""}>{card.dueDate ? formatBoardCivilDate(card.dueDate) : "—"}</span>
            <span role="cell">{card.checklistItems?.length ? `${card.checklistItems.filter((item) => item.completed).length}/${card.checklistItems.length}` : "—"}</span>
            <span role="cell">{card.estimatePoints ?? "—"}</span>
          </div>
        ))}
      </div>
      {!rows.length ? <ClusterEmptyState compact kind="filtered" icon="grid" className="board-alt-empty-v489" title="No cards match this view" description="Clear a filter or choose another saved view." /> : null}
    </div>
  );
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarStart(date: Date) {
  const start = monthStart(date);
  const day = start.getDay();
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - day);
}


export function BoardCalendarView({ rows, selectedIds, onToggleSelected, onOpen }: {
  rows: BoardViewRow[];
  selectedIds: Set<string>;
  onToggleSelected: (cardId: string) => void;
  onOpen: (card: Card) => void;
}) {
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(() => {
    const start = calendarStart(month);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);
  const dueByDay = useMemo(() => {
    const map = new Map<string, BoardViewRow[]>();
    rows.forEach((row) => {
      if (!row.card.dueDate) return;
      const key = boardCivilDateKey(row.card.dueDate);
      if (!key) return;
      const current = map.get(key) || [];
      current.push(row);
      map.set(key, current);
    });
    return map;
  }, [rows]);
  const undated = rows.filter((row) => !row.card.dueDate);

  return (
    <div className="board-alt-view-v489 board-calendar-view-v489">
      <section className="board-calendar-main-v489 panel">
        <header className="board-calendar-header-v489">
          <div>
            <ClusterButton size="compact" variant="quiet" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ClusterIcon name="chevron-left" /></ClusterButton>
            <strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <ClusterButton size="compact" variant="quiet" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ClusterIcon name="chevron-right" /></ClusterButton>
          </div>
          <ClusterButton size="compact" variant="quiet" onClick={() => setMonth(monthStart(new Date()))}>Today</ClusterButton>
        </header>
        <div className="board-calendar-weekdays-v489" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="board-calendar-grid-v489">
          {days.map((day) => {
            const key = boardCivilDateKey(day);
            const dayRows = dueByDay.get(key) || [];
            const outside = day.getMonth() !== month.getMonth();
            const today = key === boardCivilDateKey(new Date());
            return (
              <section key={key} className={`${outside ? "outside" : ""} ${today ? "today" : ""}`} aria-label={day.toLocaleDateString()}>
                <header><span>{day.getDate()}</span>{dayRows.length ? <em>{dayRows.length}</em> : null}</header>
                <div>
                  {dayRows.slice(0, 5).map(({ card, list }) => (
                    <CalendarCardButton key={card.id} card={card} list={list} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen} />
                  ))}
                  {dayRows.length > 5 ? <span className="board-calendar-more-v489">+{dayRows.length - 5} more</span> : null}
                </div>
              </section>
            );
          })}
        </div>
      </section>
      {undated.length ? (
        <aside className="board-calendar-undated-v489 panel">
          <header><strong>No due date</strong><span>{undated.length}</span></header>
          {undated.slice(0, 20).map(({ card, list }) => (
            <div key={card.id}>
              <CardSelectButton selected={selectedIds.has(card.id)} onToggle={() => onToggleSelected(card.id)} label={card.title} />
              <ContextualCardOpenButton card={card} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen}><span>{card.title}</span><em>{list.title}</em></ContextualCardOpenButton>
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  );
}

/** Timeline is a read-only lens over canonical Card dates, not a duplicated task model. */
export function BoardTimelineView({ rows, selectedIds, onToggleSelected, onOpen }: {
  rows: BoardViewRow[];
  selectedIds: Set<string>;
  onToggleSelected: (cardId: string) => void;
  onOpen: (card: Card) => void;
}) {
  const [firstWeek, setFirstWeek] = useState(() => timelineWeekStart(new Date()));
  const weekCount = 12;
  const weeks = useMemo(() => Array.from({ length: weekCount }, (_, index) => new Date(firstWeek.getFullYear(), firstWeek.getMonth(), firstWeek.getDate() + 7 * index)), [firstWeek]);
  const { scheduled, undated, outOfRange } = useMemo(() => projectBoardTimelineRows(rows, firstWeek), [rows, firstWeek]);
  const shift = (weeksToShift: number) => setFirstWeek((value) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + weeksToShift * 7));

  return (
    <section className="board-alt-view-v489 board-timeline-v509 panel" aria-label="Board work timeline">
      <header className="board-timeline-toolbar-v509">
        <div><strong>Timeline</strong><span>Dates belong to the original cards</span></div>
        <div>
          <ClusterButton size="compact" variant="quiet" onClick={() => shift(-weekCount)} aria-label="Previous twelve weeks"><ClusterIcon name="chevron-left" /></ClusterButton>
          <ClusterButton size="compact" variant="quiet" onClick={() => setFirstWeek(timelineWeekStart(new Date()))}>Today</ClusterButton>
          <ClusterButton size="compact" variant="quiet" onClick={() => shift(weekCount)} aria-label="Next twelve weeks"><ClusterIcon name="chevron-right" /></ClusterButton>
        </div>
      </header>
      <div className="board-timeline-scroll-v509">
        <div className="board-timeline-axis-v509"><span>Work item</span><div>{weeks.map((week) => <span key={boardCivilDateKey(week)}>{week.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>)}</div></div>
        {scheduled.map(({ card, list, left, width, reversed }) => (
          <div className="board-timeline-row-v509" key={card.id}>
            <div className="board-timeline-row-label-v509">
              <CardSelectButton selected={selectedIds.has(card.id)} onToggle={() => onToggleSelected(card.id)} label={card.title} />
              <span title={card.title}><strong>{card.title}</strong><em>{list.title}{reversed ? " · Dates reversed" : ""}</em></span>
            </div>
            <div className="board-timeline-track-v509">
              <div className="board-timeline-span-v509" style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }}>
                <ContextualCardOpenButton card={card} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen} title={`${card.title} · ${list.title}`}>
                  <span>{card.title}</span>
                </ContextualCardOpenButton>
              </div>
            </div>
          </div>
        ))}
      </div>
      {outOfRange ? <p className="board-timeline-caption-v509">{outOfRange} dated item{outOfRange === 1 ? " is" : "s are"} outside these twelve weeks. Navigate to another period to see them.</p> : null}
      {undated.length ? <div className="board-timeline-undated-v509"><strong>Unscheduled ({undated.length})</strong><div>{undated.map(({card}) => <ContextualCardOpenButton key={card.id} card={card} selected={selectedIds.has(card.id)} onToggleSelected={onToggleSelected} onOpen={onOpen}>{card.title}</ContextualCardOpenButton>)}</div></div> : null}
      {!rows.length ? <ClusterEmptyState compact kind="filtered" icon="grid" title="No work matches this view" description="Clear filters or choose another saved view." /> : null}
    </section>
  );
}

export function sortBoardViewRows(rows: BoardViewRow[], mode: "manual" | "due" | "priority" | "title") {
  if (mode === "manual") return rows;
  return [...rows].sort((left, right) => {
    if (mode === "title") return left.card.title.localeCompare(right.card.title);
    if (mode === "priority") return PRIORITY_ORDER.indexOf(left.card.priority) - PRIORITY_ORDER.indexOf(right.card.priority) || left.card.title.localeCompare(right.card.title);
    const leftDue = left.card.dueDate ? new Date(left.card.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.card.dueDate ? new Date(right.card.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    return leftDue - rightDue || left.card.title.localeCompare(right.card.title);
  });
}
